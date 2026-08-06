//! The Kokoro sidecar's lifecycle and wire protocol.
//!
//! Modelled directly on the transcription sidecar in the meeting assistant, for the same
//! reason vii already shells out to ffmpeg: a ~2 GB Python/torch runtime has no business
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
//! authentication, and the PID lets the sidecar exit if vii dies rather than leaving a
//! multi-gigabyte model resident.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::{SpeechError, SpeechResult, Utterance, WordSpan};

/// Loopback port the sidecar listens on. Fixed rather than ephemeral so a stale child from a
/// previous run is detectable (and reusable) instead of invisible.
pub const DEFAULT_PORT: u16 = 7334;

/// How long to wait for the model to load and the port to answer. Kokoro's first start also
/// downloads weights, which dominates this.
const READY_TIMEOUT: Duration = Duration::from_secs(180);

/// How long a single synthesis may take before the caller is told it failed.
const SPEAK_TIMEOUT: Duration = Duration::from_secs(300);

/// Where the sidecar and its interpreter live. Both are overridable so a machine that keeps
/// its virtualenv elsewhere does not have to patch the source.
#[derive(Debug, Clone)]
pub struct SpeechConfig {
    /// Python interpreter with `kokoro` installed.
    pub python: String,
    /// Path to `vii-kokoro.py`.
    pub script: String,
    pub port: u16,
    /// Shared secret for the sidecar's `Authorization: Bearer` check.
    pub token: String,
}

impl Default for SpeechConfig {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_default();
        Self {
            python: std::env::var("VII_KOKORO_PYTHON")
                .unwrap_or_else(|_| format!("{home}/.local/share/vii/kokoro-venv/bin/python")),
            script: std::env::var("VII_KOKORO_SCRIPT").unwrap_or_else(|_| default_script_path()),
            port: std::env::var("VII_KOKORO_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            // Not a security boundary against a determined local attacker — it is what stops
            // an unrelated local process from driving the sidecar by accident.
            token: format!(
                "vii-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.subsec_nanos())
                    .unwrap_or(0)
            ),
        }
    }
}

/// `script/vii-kokoro.py` relative to the workspace, resolved from this file's location so a
/// `cargo run` from anywhere in the repo still finds it.
fn default_script_path() -> String {
    let manifest = env!("CARGO_MANIFEST_DIR");
    std::path::Path::new(manifest)
        .ancestors()
        .nth(3)
        .map(|root| root.join("script").join("vii-kokoro.py"))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "script/vii-kokoro.py".to_string())
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

        // A sidecar left over from an earlier vii run is reusable — if it accepts our token.
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
            return Err(SpeechError::NotInstalled(format!(
                "no Python interpreter at {} — create one with \
                 `uv venv --python 3.12 ~/.local/share/vii/kokoro-venv` and \
                 `uv pip install kokoro soundfile`, or set VII_KOKORO_PYTHON",
                self.config.python
            )));
        }
        if !std::path::Path::new(&self.config.script).is_file() {
            return Err(SpeechError::NotInstalled(format!(
                "no sidecar script at {} — set VII_KOKORO_SCRIPT",
                self.config.script
            )));
        }

        let child = Command::new(&self.config.python)
            .arg(&self.config.script)
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &self.config.port.to_string(),
            ])
            .env("VII_KOKORO_TOKEN", &self.config.token)
            // So a crashed editor cannot leave the model resident.
            .env("VII_KOKORO_PARENT_PID", std::process::id().to_string())
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
