//! The sidecar's supervision: it must not outlive whatever started it.
//!
//! A sidecar was observed still holding its port long after every test process was gone, which
//! then failed an unrelated test with `PortBusy`. Two causes were plausible — pid reuse making
//! `os.kill(ppid, 0)` succeed forever, and the watchdog thread never arming — and both are
//! closed by the pipe watchdog and the idle timeout these tests exercise.
//!
//! Unlike `kokoro.rs` these need **only `python3`**, not an installed model: the sidecar imports
//! kokoro lazily inside `pipeline_for`, so it starts, serves `/health` and runs its watchdogs on
//! a bare interpreter. That matters — supervision is exactly the behaviour you want covered on
//! machines that have not paid for a 2 GB torch stack.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// The sidecar script as it ships. Testing the repo file rather than a copy keeps this honest:
/// `engine.rs` embeds this exact path with `include_str!`.
fn script() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../script/bay-kokoro.py")
        .canonicalize()
        .expect("the sidecar script should be in the repo")
}

/// Skip when there is no interpreter, the way `engine.rs`'s own script tests do.
fn python() -> Option<&'static str> {
    for candidate in ["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    eprintln!("skipping: no python3 on PATH");
    None
}

/// Ports used only here. Never 7334 — a test that takes the real agent port fails whenever a
/// sidecar is running, and a test that fails for reasons outside the repository teaches people
/// to re-run until green.
const PIPE_PORT: u16 = 7441;
const IDLE_PORT: u16 = 7442;
const RESET_PORT: u16 = 7443;
const UNSUPERVISED_PORT: u16 = 7444;

struct Sidecar {
    child: Child,
    port: u16,
}

impl Sidecar {
    fn spawn(port: u16, envs: &[(&str, &str)], pipe_stdin: bool) -> Option<Self> {
        let python = python()?;
        let mut command = Command::new(python);
        command
            .arg(script())
            .args(["--host", "127.0.0.1", "--port", &port.to_string()])
            .env("BAY_KOKORO_TOKEN", "test-token")
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        for (key, value) in envs {
            command.env(key, value);
        }
        command.stdin(if pipe_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        let child = command.spawn().ok()?;
        Some(Self { child, port })
    }

    /// Poll `/health` until it answers. Returns false if it never does.
    fn wait_until_up(&self) -> bool {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if self.health() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    }

    /// One authenticated `/health` request over a hand-rolled HTTP/1.1 exchange — bay-speech has
    /// no HTTP client dependency and neither does this test.
    fn health(&self) -> bool {
        use std::io::Write;
        let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", self.port)) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let request = "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\
             Authorization: Bearer test-token\r\nConnection: close\r\n\r\n";
        if stream.write_all(request.as_bytes()).is_err() {
            return false;
        }
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response.contains("200") && response.contains("\"status\"")
    }

    /// Wait for the process to exit. `None` if it outlived the deadline.
    fn wait_for_exit(&mut self, within: Duration) -> Option<Duration> {
        let started = Instant::now();
        while started.elapsed() < within {
            match self.child.try_wait() {
                Ok(Some(_)) => return Some(started.elapsed()),
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => return None,
            }
        }
        None
    }

    fn stderr(&mut self) -> String {
        let mut buf = String::new();
        if let Some(mut err) = self.child.stderr.take() {
            let _ = err.read_to_string(&mut buf);
        }
        buf
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The exact watchdog: closing the parent's pipe kills the sidecar.
///
/// This is what makes pid reuse irrelevant. If the OS recycles the parent's pid, `os.kill(pid, 0)`
/// succeeds forever and the pid watchdog never fires; a pipe closes when the process does,
/// whatever killed it.
#[test]
fn the_sidecar_exits_when_its_parent_pipe_closes() {
    let Some(mut sidecar) = Sidecar::spawn(
        PIPE_PORT,
        // No pid watchdog and no idle timeout, so only the pipe can be responsible.
        &[
            ("BAY_KOKORO_PARENT_PIPE", "1"),
            ("BAY_KOKORO_IDLE_TIMEOUT", "0"),
        ],
        true,
    ) else {
        return;
    };
    assert!(
        sidecar.wait_until_up(),
        "the sidecar should serve /health without kokoro installed — the import is lazy"
    );

    // Close the pipe, which is what the OS does for us when a parent dies.
    drop(sidecar.child.stdin.take());

    let exited = sidecar.wait_for_exit(Duration::from_secs(10));
    assert!(
        exited.is_some(),
        "the sidecar must exit once its parent pipe closes, or it outlives the editor"
    );
}

/// The backstop: a sidecar nobody is talking to exits on its own.
///
/// This is the layer that would actually have prevented the observed failure, whatever went
/// wrong with the parent watchdog.
#[test]
fn the_sidecar_exits_after_its_idle_timeout() {
    let Some(mut sidecar) = Sidecar::spawn(IDLE_PORT, &[("BAY_KOKORO_IDLE_TIMEOUT", "2")], false)
    else {
        return;
    };
    assert!(sidecar.wait_until_up(), "the sidecar should come up");

    let exited = sidecar.wait_for_exit(Duration::from_secs(15));
    assert!(
        exited.is_some(),
        "a sidecar with a 2s idle timeout must not still be holding its port"
    );
}

/// A sidecar in use must not be killed by its own idle timeout.
///
/// Without this the previous test could be satisfied by a sidecar that exits on a timer
/// regardless of whether anyone is using it — which would end a narration mid-script.
#[test]
fn a_request_resets_the_idle_clock() {
    let Some(sidecar) = Sidecar::spawn(RESET_PORT, &[("BAY_KOKORO_IDLE_TIMEOUT", "3")], false)
    else {
        return;
    };
    assert!(sidecar.wait_until_up(), "the sidecar should come up");

    // Keep it busy across more than one whole timeout.
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            sidecar.health(),
            "a sidecar being polled every 500ms must not exit on a 3s idle timeout \
             ({}s in)",
            started.elapsed().as_secs_f32()
        );
    }
}

/// An unsupervised sidecar says so.
///
/// It used to start silently when `BAY_KOKORO_PARENT_PID` was missing or non-numeric, so a
/// process that would run until something killed it looked exactly like a healthy one.
#[test]
fn a_sidecar_with_nothing_watching_it_warns() {
    let Some(mut sidecar) = Sidecar::spawn(
        UNSUPERVISED_PORT,
        &[
            ("BAY_KOKORO_PARENT_PID", "not-a-number"),
            ("BAY_KOKORO_IDLE_TIMEOUT", "0"),
        ],
        false,
    ) else {
        return;
    };
    assert!(sidecar.wait_until_up(), "the sidecar should come up");

    let _ = sidecar.child.kill();
    let _ = sidecar.child.wait();
    let stderr = sidecar.stderr();
    assert!(
        stderr.contains("WARNING") && stderr.contains("run until it is killed"),
        "an unsupervised sidecar must announce it, got: {stderr:?}"
    );
}
