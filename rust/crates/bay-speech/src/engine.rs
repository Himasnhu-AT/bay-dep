//! The Kokoro sidecar's lifecycle and wire protocol.
//!
//! Modelled directly on the transcription sidecar in the meeting assistant, for the same
//! reason bay already shells out to ffmpeg: a ~2 GB Python/torch runtime has no business
//! being linked into an editor. [`SpeechEngine`] owns a child process that loads Kokoro once
//! and holds it hot, and every call goes through [`SpeechEngine::ensure`], which:
//!
//! 1. reuses a child that is alive **and** answers an authenticated health probe,
//! 2. kills and replaces one that is alive but unhealthy — otherwise every later call pays
//!    the same long timeout,
//! 3. refuses to start if an untrusted process already holds the port,
//! 4. polls readiness with a bounded loop rather than sleeping a fixed guess.
//!
//! The child is given a bearer token and the editor's PID: loopback binding is not treated as
//! authentication, and the PID lets the sidecar exit if bay dies rather than leaving a
//! multi-gigabyte model resident.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::{SpeechError, SpeechResult, Utterance, WordSpan};

/// Loopback port the sidecar listens on. Fixed rather than ephemeral so a stale child from a
/// previous run is detectable (and reusable) instead of invisible.
pub const DEFAULT_PORT: u16 = 7334;

/// How long to wait for the model to load and the port to answer.
///
/// It used to say the first start "also downloads weights, which dominates this", and that was
/// wrong twice over. The sidecar is spawned without `--preload`, so it builds no pipeline at
/// startup and `/health` answers in about a second; and the weights are now provisioned like
/// every other artifact, so nothing is fetched at speak time either. This is a process-start
/// budget again, which is what it should always have been.
const READY_TIMEOUT: Duration = Duration::from_secs(60);

/// How long a single synthesis may take before the caller is told it failed.
const SPEAK_TIMEOUT: Duration = Duration::from_secs(300);

/// Where the sidecar and its interpreter live. Both are overridable so a machine that keeps
/// its virtualenv elsewhere does not have to patch the source.
#[derive(Debug, Clone)]
pub struct SpeechConfig {
    /// Python interpreter with `kokoro` installed.
    pub python: String,
    /// Path to `bay-kokoro.py`.
    pub script: String,
    pub port: u16,
    /// Shared secret for the sidecar's `Authorization: Bearer` check.
    pub token: String,
}

impl Default for SpeechConfig {
    fn default() -> Self {
        Self {
            python: std::env::var("BAY_KOKORO_PYTHON").unwrap_or_else(|_| default_python()),
            script: std::env::var("BAY_KOKORO_SCRIPT").unwrap_or_else(|_| default_script_path()),
            port: std::env::var("BAY_KOKORO_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            // Not a security boundary against a determined local attacker — it is what stops
            // an unrelated local process from driving the sidecar by accident.
            token: format!(
                "bay-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.subsec_nanos())
                    .unwrap_or(0)
            ),
        }
    }
}

/// The environment the sidecar child is started with.
///
/// **Every one of these must be set on the child, not inside the Python.** `huggingface_hub`
/// reads its configuration at *import* time, so a variable set after the import silently does
/// nothing — which is the kind of bug that looks like it works until someone checks where the
/// weights actually landed.
fn sidecar_env(token: &str, weights_provisioned: bool) -> Vec<(String, std::ffi::OsString)> {
    let mut env = vec![
        ("BAY_KOKORO_TOKEN".into(), token.into()),
        // The exact watchdog: the child blocks reading the stdin pipe we give it and exits on
        // EOF. The OS closes that pipe however this process goes away, including `kill -9`, so
        // unlike a pid check it cannot be defeated by the OS recycling our pid.
        ("BAY_KOKORO_PARENT_PIPE".into(), "1".into()),
        // Second belt. Kept because it costs nothing and covers a pipe we somehow fail to give.
        (
            "BAY_KOKORO_PARENT_PID".into(),
            std::process::id().to_string().into(),
        ),
        // huggingface_hub reports usage on every download unless told not to. bay has no
        // telemetry, and a dependency phoning home on the user's behalf is the same thing
        // wearing a different name — so it is switched off explicitly rather than left to a
        // default that could change.
        ("HF_HUB_DISABLE_TELEMETRY".into(), "1".into()),
        // Do not read the user's HuggingFace login. bay downloads one public model; sending
        // someone's API token to do it is not something they asked for.
        ("HF_HUB_DISABLE_IMPLICIT_TOKEN".into(), "1".into()),
        // Kokoro's ~328 MB of weights belong to bay, so they go in bay's own directory rather
        // than the shared ~/.cache/huggingface — where they are indistinguishable from every
        // other tool's models, cannot be reported as bay's disk usage, and survive uninstall.
        ("HF_HOME".into(), model_cache().into_os_string()),
    ];

    // Only once the weights are actually on disk. Setting this unconditionally would break an
    // install that predates the pin, whose fallback is precisely the Hub fetch it forbids.
    //
    // Where it does apply it is what makes "nothing leaves the Mac unless you send it" true
    // rather than nearly true: a missing file now fails loudly instead of quietly pulling a few
    // hundred megabytes over the user's connection with no progress and no consent.
    if weights_provisioned {
        env.push(("HF_HUB_OFFLINE".into(), "1".into()));
    }
    env
}

/// Where bay's *provisioned* Kokoro weights live.
///
/// Under `runtime_dir()`, alongside every other artifact bay installs — not `data_dir()/models`,
/// which is outside it. That mattered: "delete the one directory bay downloaded into" used to
/// leave ~339 MB behind, uncounted, because the weights were the one thing living somewhere else.
///
/// `None` when there is no runtime directory, in which case the sidecar falls back to fetching
/// from the Hub exactly as it did before.
pub fn provisioned_model_dir() -> Option<std::path::PathBuf> {
    let dir = bay_paths::runtime_dir()?.join("models").join("kokoro");
    dir.join("kokoro-v1_0.pth").is_file().then_some(dir)
}

/// Where model weights live: bay's own directory, not the shared HuggingFace cache.
///
/// `HF_HOME` is the parent that moves the hub cache, the assets cache and the token in one
/// go — `HF_HUB_CACHE` alone would leave the others behind. Overridable so a machine that
/// already has the weights somewhere can point at them instead of downloading 328 MB again.
pub fn model_cache() -> std::path::PathBuf {
    if let Ok(explicit) = std::env::var("BAY_MODEL_DIR") {
        return std::path::PathBuf::from(explicit);
    }
    bay_paths::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("models")
}

/// The interpreter narration runs on.
///
/// The candidate list lives in `bay-provision` because two things need it and they must not
/// disagree: this, to decide what to run, and the runtime status readout, to decide whether
/// narration needs installing. When those two drifted apart the symptom was narration reporting
/// "not installed" beside a working 858 MB venv — a bug with no symptom except a wrong answer.
///
/// It deliberately still includes `~/.local/share/bay/kokoro-venv`, which is not where macOS
/// data otherwise lives: `script/setup-speech.sh` put it there on every development machine,
/// and resolving "properly" through the platform data directory would strand all of them.
///
/// When nothing exists, the *provisioned* path is reported rather than `python3`. That makes the
/// unavailable message name the place bay will install into, instead of a system interpreter
/// that was never going to have kokoro in it.
fn default_python() -> String {
    let candidates = bay_provision::speech::interpreter_candidates();
    candidates
        .iter()
        .find(|path| path.is_file())
        .or_else(|| candidates.first())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "python3".to_string())
}

/// Where `bay-kokoro.py` lives, searched in the order that gets the right answer for each way
/// bay can be running, ending at the copy compiled into the binary.
///
/// `CARGO_MANIFEST_DIR` alone is wrong for anything shipped: it is baked in at compile time and
/// points at the *build machine's* source tree, so a distributed .app would look for the
/// sidecar in a directory that exists only on the machine that built it, and narration would
/// report "not installed" with a path the user has never seen.
fn default_script_path() -> String {
    const SCRIPT: &str = "bay-kokoro.py";

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        // Alongside the binary — a zip/portable layout, and Windows.
        candidates.push(dir.join(SCRIPT));
        // macOS bundle: Contents/MacOS/bay -> Contents/Resources/bay-kokoro.py
        candidates.push(dir.join("../Resources").join(SCRIPT));
        // A plain `cargo run` puts the binary in target/<profile>/, so the repo root is three
        // levels up from there.
        candidates.push(dir.join("../../../script").join(SCRIPT));
    }
    // The source tree this was compiled from — correct for `cargo test` and a dev checkout.
    candidates.push(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .map(|root| root.join("script").join(SCRIPT))
            .unwrap_or_else(|| std::path::PathBuf::from("script").join(SCRIPT)),
    );

    candidates
        .iter()
        .find(|path| path.is_file())
        // Canonicalize so the reported path is readable: the bundle candidate is built as
        // `Contents/MacOS/../Resources/…`, which is correct but reads like a mistake in an
        // error message.
        .map(|path| {
            std::fs::canonicalize(path)
                .unwrap_or_else(|_| path.to_path_buf())
                .to_string_lossy()
                .to_string()
        })
        // Nothing on disk: bay ships as a single executable, so fall back to the copy compiled
        // into it.
        .unwrap_or_else(|| {
            unpack_script().unwrap_or_else(|_| {
                candidates
                    .first()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| SCRIPT.to_string())
            })
        })
}

/// The sidecar, compiled into the binary.
///
/// bay is distributed as one executable — a loose `.py` next to it is one more thing to lose in
/// a copy, and a version skew between the two is silent and baffling. Python needs a *file* to
/// run, so the embedded copy is written out on first use.
const EMBEDDED_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../script/bay-kokoro.py"
));

/// Write the embedded sidecar somewhere Python can run it, and return that path.
///
/// The filename carries a hash of the contents, so upgrading bay writes a new file rather than
/// silently reusing the previous version's script — which would be a genuinely awful bug to
/// track down, the symptom being an old sidecar behaviour in a new build.
fn unpack_script() -> std::io::Result<String> {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in EMBEDDED_SCRIPT.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }

    let dir = state_dir().join("sidecar");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("bay-kokoro-{hash:016x}.py"));

    // Content-addressed, so an existing file of the right name is already the right script.
    if !path.is_file() {
        // Write-then-rename: two bay processes starting at once must not have one of them read
        // a half-written script.
        let staging = dir.join(format!("bay-kokoro-{hash:016x}.{}.tmp", std::process::id()));
        std::fs::write(&staging, EMBEDDED_SCRIPT)?;
        std::fs::rename(&staging, &path)?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// Where the unpacked sidecar goes. `BAY_STATE_DIR` stays supported so a test can redirect it
/// without touching the real one.
fn state_dir() -> std::path::PathBuf {
    if let Ok(explicit) = std::env::var("BAY_STATE_DIR") {
        return std::path::PathBuf::from(explicit);
    }
    bay_paths::data_dir().unwrap_or_else(std::env::temp_dir)
}

pub struct SpeechEngine {
    config: SpeechConfig,
    child: Option<Child>,
    last_used: Option<Instant>,
}

impl SpeechEngine {
    pub fn new(config: SpeechConfig) -> Self {
        Self {
            config,
            child: None,
            last_used: None,
        }
    }

    pub fn config(&self) -> &SpeechConfig {
        &self.config
    }

    /// Whether the sidecar could even be started here: both the interpreter and the script
    /// must exist. Tests use this to skip rather than fail on a machine without Kokoro.
    pub fn is_installed(&self) -> bool {
        std::path::Path::new(&self.config.python).is_file()
            && std::path::Path::new(&self.config.script).is_file()
    }

    /// Start the sidecar if it is not already serving, and leave it ready for a request.
    pub fn ensure(&mut self) -> Result<(), SpeechError> {
        // A child we already own: keep it only if it is both alive and answering.
        let alive = match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        };
        if alive {
            if self.health().is_ok() {
                self.last_used = Some(Instant::now());
                return Ok(());
            }
            // Alive but not answering. Replacing it now beats making every future call wait
            // out the same timeout.
            self.shutdown();
        }

        // A sidecar left over from an earlier bay run is reusable — if it accepts our token.
        // (It will not, since the token is per-process, which is exactly why an occupied port
        // we cannot authenticate against is an error rather than something to stomp on.)
        if port_open(self.config.port) {
            return if self.health().is_ok() {
                self.last_used = Some(Instant::now());
                Ok(())
            } else {
                Err(SpeechError::PortBusy(self.config.port))
            };
        }

        if !std::path::Path::new(&self.config.python).is_file() {
            // This is the message an end user actually hits the first time they ask for
            // narration on a clean machine, and it used to tell them to run `uv venv` and
            // `uv pip install` — tools they do not have and should never need. bay installs
            // this itself; the error has to say so, or the whole "install nothing" promise
            // fails at the one moment the user is looking.
            return Err(SpeechError::NotInstalled(format!(
                "narration is not installed yet. bay can install it for you (~1.2 GB): call \
                 runtime_install with component \"speech\", or press \"Install narration\" in \
                 the toolbar. Nothing needs to be installed first.\n\
                 Looked for an interpreter at {}.\n\
                 To use one you already have instead, set BAY_KOKORO_PYTHON.",
                self.config.python
            )));
        }
        if !std::path::Path::new(&self.config.script).is_file() {
            return Err(SpeechError::NotInstalled(format!(
                "no sidecar script at {} — set BAY_KOKORO_SCRIPT",
                self.config.script
            )));
        }

        let mut command = Command::new(&self.config.python);
        command.arg(&self.config.script).args([
            "--host",
            "127.0.0.1",
            "--port",
            &self.config.port.to_string(),
        ]);
        // Only when the weights are actually there. An install that predates the pin keeps
        // working off its HuggingFace cache rather than failing on a directory bay never filled.
        let models = provisioned_model_dir();
        if let Some(models) = &models {
            command.arg("--model-dir").arg(models);
        }
        let child = command
            .envs(sidecar_env(&self.config.token, models.is_some()))
            // The pipe IS the watchdog — see BAY_KOKORO_PARENT_PIPE. The handle is kept alive by
            // `child`, so it closes exactly when this process does. Nothing is ever written to it.
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| SpeechError::Spawn(error.to_string()))?;
        self.child = Some(child);

        let deadline = Instant::now() + READY_TIMEOUT;
        while Instant::now() < deadline {
            if self.health().is_ok() {
                self.last_used = Some(Instant::now());
                return Ok(());
            }
            // If the child died, say why instead of waiting out the full timeout.
            if let Some(child) = self.child.as_mut()
                && let Ok(Some(status)) = child.try_wait()
            {
                let mut stderr = String::new();
                if let Some(pipe) = child.stderr.as_mut() {
                    let _ = pipe.take(4096).read_to_string(&mut stderr);
                }
                self.child = None;
                return Err(SpeechError::Spawn(format!(
                    "the Kokoro sidecar exited with {status}: {}",
                    stderr.trim()
                )));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        self.shutdown();
        Err(SpeechError::Timeout(
            "the Kokoro sidecar did not become ready in time".into(),
        ))
    }

    fn health(&self) -> Result<String, SpeechError> {
        self.request("GET", "/health", None, Duration::from_secs(3))
    }

    /// Voice catalogue, keyed by language code.
    pub fn voices(&mut self) -> Result<serde_json::Value, SpeechError> {
        self.ensure()?;
        let body = self.request("GET", "/voices", None, Duration::from_secs(5))?;
        serde_json::from_str(&body).map_err(|e| SpeechError::Protocol(e.to_string()))
    }

    /// Speak `text` into `out_path`, returning the audio's duration and per-word timings.
    ///
    /// Uses the sidecar's default peak normalization. See [`SpeechEngine::speak_normalized`]
    /// when the level matters.
    pub fn speak(
        &mut self,
        text: &str,
        voice: &str,
        speed: f32,
        lang_code: &str,
        out_path: &str,
    ) -> Result<Utterance, SpeechError> {
        self.speak_normalized(text, voice, speed, lang_code, out_path, Some(-2.0))
    }

    /// Speak `text`, normalizing the utterance to `peak_db` dBFS.
    ///
    /// Kokoro's raw level varies about 5 dB line to line, which reads as uneven delivery and
    /// makes any single mix gain either too quiet or clipping. Normalizing per utterance is
    /// what lets a caller pick one voice gain and trust it. Pass `None` to keep Kokoro's
    /// untouched output.
    #[allow(clippy::too_many_arguments)]
    pub fn speak_normalized(
        &mut self,
        text: &str,
        voice: &str,
        speed: f32,
        lang_code: &str,
        out_path: &str,
        peak_db: Option<f32>,
    ) -> Result<Utterance, SpeechError> {
        if text.trim().is_empty() {
            return Err(SpeechError::BadRequest("there is no text to speak".into()));
        }
        if !(0.1..=5.0).contains(&speed) {
            return Err(SpeechError::BadRequest(format!(
                "speed {speed} is outside the usable range 0.1..=5.0"
            )));
        }
        if let Some(peak) = peak_db
            && peak > 0.0
        {
            return Err(SpeechError::BadRequest(format!(
                "peak_db {peak} is above full scale; dBFS targets are <= 0"
            )));
        }
        self.ensure()?;

        let request = serde_json::json!({
            "text": text,
            "voice": voice,
            "speed": speed,
            "langCode": lang_code,
            "outPath": out_path,
            "peakDb": peak_db,
        });
        let body = self.request("POST", "/speak", Some(&request.to_string()), SPEAK_TIMEOUT)?;
        let parsed: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| SpeechError::Protocol(e.to_string()))?;

        if let Some(error) = parsed.get("error").and_then(|e| e.as_str()) {
            return Err(SpeechError::Synthesis(error.to_string()));
        }
        let duration = parsed
            .get("durationSeconds")
            .and_then(|d| d.as_f64())
            .ok_or_else(|| SpeechError::Protocol("no durationSeconds in the reply".into()))?;
        let words = parsed
            .get("words")
            .and_then(|w| w.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| {
                        Some(WordSpan {
                            text: entry.get("text")?.as_str()?.to_string(),
                            start: entry.get("start")?.as_f64()?,
                            end: entry.get("end")?.as_f64()?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        self.last_used = Some(Instant::now());
        Ok(Utterance {
            path: parsed
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or(out_path)
                .to_string(),
            duration_seconds: duration,
            sample_rate: parsed
                .get("sampleRate")
                .and_then(|r| r.as_u64())
                .unwrap_or(24_000) as u32,
            voice: voice.to_string(),
            words,
        })
    }

    /// Stop the sidecar and give its memory back. Safe to call when nothing is running.
    pub fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.last_used = None;
    }

    /// Stop the sidecar if it has been idle for `idle`. The model is hundreds of megabytes
    /// resident; a long editing session should not hold it for one narration.
    pub fn shutdown_if_idle(&mut self, idle: Duration) -> bool {
        let due = self
            .last_used
            .map(|last| last.elapsed() >= idle)
            .unwrap_or(false);
        if due && self.child.is_some() {
            self.shutdown();
            return true;
        }
        false
    }

    /// One HTTP round trip to the sidecar. Hand-rolled for the same reason the MCP transport
    /// is: this is the entire protocol we need, and an HTTP client would pull in an async
    /// runtime the workspace otherwise does not have.
    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        timeout: Duration,
    ) -> Result<String, SpeechError> {
        let address = format!("127.0.0.1:{}", self.config.port);
        let socket = address
            .to_socket_addrs()
            .map_err(|e| SpeechError::Transport(e.to_string()))?
            .next()
            .ok_or_else(|| SpeechError::Transport("could not resolve loopback".into()))?;
        let mut stream = TcpStream::connect_timeout(&socket, Duration::from_secs(3))
            .map_err(|e| SpeechError::Transport(e.to_string()))?;
        stream
            .set_read_timeout(Some(timeout))
            .map_err(|e| SpeechError::Transport(e.to_string()))?;

        let payload = body.unwrap_or("");
        let request = format!(
            "{method} {path} HTTP/1.1\r\n\
             Host: 127.0.0.1\r\n\
             Authorization: Bearer {token}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {length}\r\n\
             Connection: close\r\n\r\n{payload}",
            token = self.config.token,
            length = payload.len(),
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| SpeechError::Transport(e.to_string()))?;

        let mut reader = BufReader::new(stream);
        let mut status_line = String::new();
        reader
            .read_line(&mut status_line)
            .map_err(|e| SpeechError::Transport(e.to_string()))?;
        let status: u16 = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .ok_or_else(|| SpeechError::Protocol(format!("bad status line {status_line:?}")))?;

        let mut content_length = 0usize;
        loop {
            let mut header = String::new();
            if reader
                .read_line(&mut header)
                .map_err(|e| SpeechError::Transport(e.to_string()))?
                == 0
            {
                break;
            }
            let header = header.trim_end();
            if header.is_empty() {
                break;
            }
            if let Some(value) = header
                .strip_prefix("Content-Length:")
                .or_else(|| header.strip_prefix("content-length:"))
            {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; content_length];
        reader
            .read_exact(&mut body)
            .map_err(|e| SpeechError::Transport(e.to_string()))?;
        let body = String::from_utf8_lossy(&body).to_string();

        match status {
            200 => Ok(body),
            401 => Err(SpeechError::Unauthorized),
            400 => Err(SpeechError::BadRequest(body)),
            _ => Err(SpeechError::Synthesis(format!("HTTP {status}: {body}"))),
        }
    }
}

impl Drop for SpeechEngine {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Whether anything is listening on the loopback port.
fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .to_socket_addrs()
            .ok()
            .and_then(|mut addresses| addresses.next())
            .expect("loopback address always resolves"),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// A convenience wrapper so a caller that only wants one utterance does not have to manage the
/// engine's lifetime.
pub fn speak_once(
    text: &str,
    voice: &str,
    speed: f32,
    lang_code: &str,
    out_path: &str,
) -> SpeechResult<Utterance> {
    let mut engine = SpeechEngine::new(SpeechConfig::default());
    engine.speak(text, voice, speed, lang_code, out_path)
}

#[cfg(test)]
mod embedded_script_tests {
    use super::*;

    /// The venv location is decided in TWO places — this crate and `script/setup-speech.sh` —
    /// and nothing but this test ties them together. They drifted once already: resolving the
    /// path through the platform data directory sent macOS to Application Support while the
    /// script kept provisioning into `.local/share`, and narration reported "not installed"
    /// on a machine that had it. The symptom was a wrong answer, not a crash.
    #[test]
    fn the_default_interpreter_matches_where_setup_speech_puts_it() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("repo root")
            .join("script/setup-speech.sh");
        let Ok(source) = std::fs::read_to_string(&script) else {
            eprintln!("skipping: {} not found", script.display());
            return;
        };

        let line = source
            .lines()
            .find(|line| line.trim_start().starts_with("VENV="))
            .expect("setup-speech.sh must define VENV=");
        // VENV="${BAY_SPEECH_VENV:-$HOME/.local/share/bay/kokoro-venv}"
        let provisioned = line
            .split(":-")
            .nth(1)
            .expect("VENV= should carry a default")
            .trim_end_matches(['}', '"'])
            .replace("$HOME/", "");

        // Asserted against the candidate *list*, not against whichever candidate happens to win
        // here. bay now prefers the venv it provisions itself, so on a machine with nothing
        // installed the winner is correctly the managed path — and requiring the script's path
        // to win would fail on exactly the clean machine the check matters least on. What must
        // hold is that the script's location is still somewhere bay looks.
        let candidates: Vec<String> = bay_provision::speech::interpreter_candidates()
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        assert!(
            candidates.iter().any(|path| path.contains(&provisioned)),
            "setup-speech.sh provisions {provisioned}, which bay never looks in: {candidates:#?}"
        );
    }

    /// The rename from vii to bay must not strand an environment that already works. The old
    /// setup script wrote `~/.local/share/vii/kokoro-venv`, and dropping that path would report
    /// narration as missing on every machine that had ever provisioned it — with a 1.2 GB
    /// re-download as the apparent fix.
    #[test]
    fn a_venv_from_before_the_rename_is_still_found() {
        let candidates: Vec<String> = bay_provision::speech::interpreter_candidates()
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        if bay_paths::home().is_none() {
            return;
        }
        assert!(
            candidates
                .iter()
                .any(|path| path.contains(".local/share/vii/kokoro-venv")),
            "the pre-rename venv location must still be searched: {candidates:#?}"
        );
    }

    /// The whole point of embedding is that a lone `bay.exe` still has a sidecar. If the
    /// `include_str!` path ever drifts this fails to compile; if the script is truncated or
    /// swapped for something else, this catches it.
    #[test]
    fn the_embedded_script_is_the_real_sidecar() {
        assert!(
            EMBEDDED_SCRIPT.contains("kokoro"),
            "embedded script does not mention kokoro — wrong file?"
        );
        assert!(
            EMBEDDED_SCRIPT.contains("def "),
            "embedded script has no function definitions — truncated?"
        );
    }

    #[test]
    fn unpacking_writes_a_runnable_file_and_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("bay-unpack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // SAFETY: single-threaded test scope; the variable is read once inside unpack_script.
        unsafe { std::env::set_var("BAY_STATE_DIR", &dir) };

        let first = unpack_script().expect("unpack");
        assert_eq!(
            std::fs::read_to_string(&first).expect("read back"),
            EMBEDDED_SCRIPT,
            "unpacked file differs from what is compiled in"
        );

        // Twice must not duplicate or rewrite — a second bay process starting is the normal case.
        let second = unpack_script().expect("unpack again");
        assert_eq!(
            first, second,
            "the path is content-addressed, so it is stable"
        );
        let stray: Vec<_> = std::fs::read_dir(dir.join("sidecar"))
            .expect("listing")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|e| e == "tmp"))
            .collect();
        assert!(stray.is_empty(), "left staging files behind: {stray:?}");

        unsafe { std::env::remove_var("BAY_STATE_DIR") };
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Python must be able to parse it. A syntax error in the sidecar would otherwise only show
    /// up as narration failing at runtime, on a user's machine.
    #[test]
    fn the_embedded_script_is_valid_python() {
        let Ok(check) = Command::new("python3")
            .args(["-c", "import ast,sys; ast.parse(sys.stdin.read())"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
        else {
            eprintln!("skipping: no python3 on PATH");
            return;
        };
        let mut check = check;
        check
            .stdin
            .as_mut()
            .expect("stdin")
            .write_all(EMBEDDED_SCRIPT.as_bytes())
            .expect("write script");
        let out = check.wait_with_output().expect("wait");
        assert!(
            out.status.success(),
            "embedded sidecar is not valid Python:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

#[cfg(test)]
mod sidecar_env_tests {
    use super::*;

    fn value<'a>(
        env: &'a [(String, std::ffi::OsString)],
        key: &str,
    ) -> Option<&'a std::ffi::OsStr> {
        env.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_os_str())
    }

    /// The manifesto says nothing leaves the Mac unless the user sends it on purpose.
    /// huggingface_hub's default is to report usage, so silence has to be explicit.
    #[test]
    fn the_sidecar_never_phones_home() {
        let _serial = serially();
        let env = sidecar_env("t", false);
        assert_eq!(value(&env, "HF_HUB_DISABLE_TELEMETRY"), Some("1".as_ref()));
        assert_eq!(
            value(&env, "HF_HUB_DISABLE_IMPLICIT_TOKEN"),
            Some("1".as_ref()),
            "bay downloads one public model; it must not send the user's HF token to do it"
        );
        assert!(
            value(&env, "HF_HUB_OFFLINE").is_none(),
            "an install predating the pin still needs the Hub fallback, so offline must not be \
             forced on it"
        );

        // Once bay has provisioned the weights there is nothing left to fetch, and saying so is
        // what turns "no surprise network calls" from nearly true into true: a missing file
        // fails loudly instead of quietly pulling a few hundred megabytes.
        let provisioned = sidecar_env("t", true);
        assert_eq!(
            value(&provisioned, "HF_HUB_OFFLINE"),
            Some("1".as_ref()),
            "with the weights on disk the sidecar must not be able to reach the network"
        );
    }

    /// `BAY_MODEL_DIR` is process-global, so a test that sets it and a test that reads it must
    /// not run at the same time. Cargo runs these on parallel threads, which made
    /// `weights_land_in_bays_own_directory` fail intermittently — observing the redirect that
    /// `the_model_directory_can_be_redirected` had just installed. Same guard the agent
    /// registry's tests use, for the same reason.
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn serially() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// Weights are bay's, so they live in bay's directory — not mixed into a shared cache it
    /// cannot measure, report or clean up.
    #[test]
    fn weights_land_in_bays_own_directory() {
        let _serial = serially();
        let env = sidecar_env("t", false);
        let home = value(&env, "HF_HOME").expect("HF_HOME must be set on the child");
        let home = std::path::Path::new(home);
        assert!(
            home.ends_with("models"),
            "HF_HOME should be bay's model directory, got {home:?}"
        );
        assert!(
            !home.starts_with(
                bay_paths::home()
                    .unwrap_or_default()
                    .join(".cache/huggingface")
            ),
            "the shared HuggingFace cache is exactly what this avoids: {home:?}"
        );
    }

    #[test]
    fn the_model_directory_can_be_redirected() {
        let _serial = serially();
        // SAFETY: serialised against every other reader of this variable by `serially`.
        unsafe { std::env::set_var("BAY_MODEL_DIR", "/tmp/bay-models-test") };
        assert_eq!(
            model_cache(),
            std::path::PathBuf::from("/tmp/bay-models-test")
        );
        unsafe { std::env::remove_var("BAY_MODEL_DIR") };
    }
}
