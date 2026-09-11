//! HTML compositions, rasterised.
//!
//! An overlay card, a lower third, a chart — anything easier to author as markup than as a
//! stack of `add_shape` calls — becomes an RGBA PNG with a real alpha channel, which
//! `media_import` then treats like any other image. WebKit does the drawing, so this is the
//! system's own web engine rather than a headless Chrome bay would have to fetch, verify and
//! keep up to date. Nothing downloads.
//!
//! Three rules from the rest of bay apply here and are worth restating, because each one has a
//! specific failure it prevents:
//!
//! - **Absent is not broken.** [`available`] answers whether WebKit can be reached at all.
//!   Off macOS the crate compiles and reports unavailable, exactly as `bay-detect` does.
//! - **A blank page is a failure, not a picture.** A composition that renders nothing produces
//!   a fully transparent PNG, which is indistinguishable from a correct overlay until it is
//!   composited over footage and nothing appears. [`Shot::render_to`] reports the fraction of
//!   non-transparent pixels it wrote, and the MCP tool refuses a frame that is entirely empty.
//! - **The renderer runs in a child process.** WKWebView is AppKit: it wants the main thread
//!   and a run loop. `bay --mcp` is already using its main thread for the JSON-RPC loop and the
//!   editor is using its for GPUI, so hosting a web view in either means restructuring the
//!   process around one. Instead the parent writes a spec, spawns `bay --html-shot`, and waits.
//!   A composition with a runaway script kills a child rather than wedging the server.
//!
//! ## Time
//!
//! A composition may declare an animation timeline; [`Shot::at_seconds`] seeks it before the
//! snapshot, so one HTML file yields any frame of its animation. The contract is the one the
//! HyperFrames compositions in this repository already use — a paused GSAP timeline registered
//! at `window.__timelines[id]` — and is duck-typed: anything exposing `pause()` and `time(t)`
//! works. A composition with no timeline ignores the seek, which is the common case and is not
//! an error.

use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
mod webview;

/// The environment variable that overrides which binary does the rasterising.
///
/// The parent normally re-executes itself (`current_exe`), which is right in production: the
/// `bay` binary dispatches `--html-shot` to [`shot_main`]. Under `cargo test` `current_exe` is
/// the test harness, which knows no such flag, so the tests that want a real render point this
/// at a built `bay`. Without it they skip rather than fail — see [`available`].
pub const SHOT_BIN_ENV: &str = "BAY_HTML_SHOT_BIN";

/// Turn "WebKit is not reachable" from a skip into a hard failure.
///
/// The same shape as `BAY_REQUIRE_GPU` and `BAY_REQUIRE_FFMPEG`: a capability check that is
/// allowed to skip by default must be able to stop skipping on demand, or the suite cannot be
/// used to verify the capability is really there.
pub const REQUIRE_ENV: &str = "BAY_REQUIRE_HTML";

/// The command-line flag the child is spawned with.
pub const SHOT_FLAG: &str = "--html-shot";

#[derive(Debug, thiserror::Error)]
pub enum HtmlError {
    #[error("HTML rendering is unavailable: {0}")]
    Unavailable(String),
    #[error("could not read {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not write {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("the renderer could not be started: {0}")]
    Spawn(String),
    /// The child ran and failed. Carries the child's own stderr, because "exit code 1" alone
    /// sends the caller looking in the wrong process.
    #[error("rendering failed: {0}")]
    Render(String),
    #[error("rendering timed out after {0} ms")]
    Timeout(u64),
    #[error("{0}")]
    Invalid(String),
}

/// What to render.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// A file on disk. Its directory is granted read access, so relative `<link>`, `<img>` and
    /// `@font-face` references resolve — which is what makes a self-contained composition
    /// directory work.
    File(PathBuf),
    /// Markup held in memory. Relative references have nothing to resolve against; use
    /// [`Source::File`] for anything with assets beside it.
    Html(String),
}

/// One frame to rasterise.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub source: Source,
    /// Canvas size in CSS pixels. The PNG comes out this size unless [`Shot::scale`] says
    /// otherwise.
    pub width: u32,
    pub height: u32,
    /// Device pixel ratio. 2.0 renders a 540×960 composition as a 1080×1920 PNG with the type
    /// laid out at 540×960 — which is how an overlay authored at half size stays sharp on a
    /// full-resolution canvas instead of being upscaled after the fact.
    pub scale: f32,
    /// Leave the page background transparent, so the PNG carries a real alpha channel.
    pub transparent: bool,
    /// Seconds to seek the declared timeline to before snapping.
    pub at_seconds: f64,
    /// Which timeline to seek. Defaults to the sole entry in `window.__timelines` when there is
    /// exactly one, which is the common case and saves the caller naming it.
    pub timeline_id: Option<String>,
    /// Milliseconds to wait after the page reports ready, before snapping. Fonts and the first
    /// paint land here.
    pub settle_ms: u64,
    /// How long the whole render may take before the child is killed.
    pub timeout_ms: u64,
}

impl Shot {
    /// A shot with bay's defaults: opaque-free, one CSS pixel per output pixel, frame zero.
    pub fn new(source: Source, width: u32, height: u32) -> Self {
        Self {
            source,
            width,
            height,
            scale: 1.0,
            transparent: true,
            at_seconds: 0.0,
            timeline_id: None,
            settle_ms: DEFAULT_SETTLE_MS,
            timeout_ms: DEFAULT_TIMEOUT_MS,
        }
    }

    /// Pixel dimensions of the PNG this shot produces.
    pub fn output_size(&self) -> (u32, u32) {
        let scale = if self.scale.is_finite() && self.scale > 0.0 {
            self.scale
        } else {
            1.0
        };
        (
            ((self.width as f32) * scale).round().max(1.0) as u32,
            ((self.height as f32) * scale).round().max(1.0) as u32,
        )
    }

    fn validate(&self) -> Result<(), HtmlError> {
        if self.width == 0 || self.height == 0 {
            return Err(HtmlError::Invalid(
                "width and height must both be greater than zero".to_string(),
            ));
        }
        // 16384 is the point where Core Graphics stops allocating backing stores on this
        // hardware; a request past it fails inside WebKit with nothing useful to report.
        let (w, h) = self.output_size();
        if w > MAX_DIMENSION || h > MAX_DIMENSION {
            return Err(HtmlError::Invalid(format!(
                "{w}×{h} is past the {MAX_DIMENSION} px limit — lower `scale` or the canvas size"
            )));
        }
        if !self.scale.is_finite() || self.scale <= 0.0 {
            return Err(HtmlError::Invalid(format!(
                "scale must be a positive number, got {}",
                self.scale
            )));
        }
        if !self.at_seconds.is_finite() || self.at_seconds < 0.0 {
            return Err(HtmlError::Invalid(format!(
                "atSeconds must be zero or more, got {}",
                self.at_seconds
            )));
        }
        if let Source::File(path) = &self.source
            && !path.exists()
        {
            return Err(HtmlError::Read {
                path: path.clone(),
                source: std::io::Error::new(std::io::ErrorKind::NotFound, "no such file"),
            });
        }
        Ok(())
    }

    /// Rasterise to `output`, returning what was written.
    pub fn render_to(&self, output: &Path) -> Result<Rendered, HtmlError> {
        self.validate()?;
        if !available() {
            return Err(HtmlError::Unavailable(
                unavailable_reason().unwrap_or_default(),
            ));
        }
        render_via_child(self, output)
    }
}

/// What a completed render produced.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    /// Fraction of pixels with any opacity at all, 0.0 to 1.0.
    ///
    /// This is the check that a composition actually drew something. A blank overlay and a
    /// correct one are the same file size and the same dimensions; they differ here, and only
    /// here, until somebody composites them over footage and looks.
    pub ink: f32,
}

impl Rendered {
    /// Did this frame draw anything at all?
    pub fn is_blank(&self) -> bool {
        self.ink <= 0.0
    }
}

const DEFAULT_SETTLE_MS: u64 = 150;
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_DIMENSION: u32 = 16_384;

/// Can HTML be rasterised on this machine?
pub fn available() -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    shot_binary().is_some()
}

/// Why it cannot be, in a sentence fit to show someone.
pub fn unavailable_reason() -> Option<String> {
    if available() {
        return None;
    }
    Some(if !cfg!(target_os = "macos") {
        "HTML rendering uses WebKit through AppKit and is macOS only".to_string()
    } else {
        format!(
            "no renderer binary: this process is not bay, and {SHOT_BIN_ENV} is unset or does \
             not point at one"
        )
    })
}

/// Should an unavailable renderer fail rather than skip?
pub fn required() -> bool {
    std::env::var(REQUIRE_ENV).is_ok_and(|value| value != "0" && !value.is_empty())
}

/// Which binary rasterises.
///
/// `current_exe` when this process is bay itself, the override when it is not. The override is
/// checked first so a test can aim at a freshly built binary even when running inside one.
fn shot_binary() -> Option<PathBuf> {
    if let Ok(path) = std::env::var(SHOT_BIN_ENV) {
        let path = PathBuf::from(path);
        return path.is_file().then_some(path);
    }
    let exe = std::env::current_exe().ok()?;
    // A test harness is not bay. Without this the parent would spawn the test binary with a flag
    // it does not know, which exits zero having run the tests again — a render that "succeeds"
    // and writes no file.
    is_bay_binary(&exe).then_some(exe)
}

/// Is this the shipped `bay` binary, as opposed to a test harness that happens to link us?
fn is_bay_binary(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "bay" || name == "bay.exe")
}

/// Spawn the child, wait for it, and read back what it wrote.
fn render_via_child(shot: &Shot, output: &Path) -> Result<Rendered, HtmlError> {
    let binary = shot_binary()
        .ok_or_else(|| HtmlError::Unavailable(unavailable_reason().unwrap_or_default()))?;

    if let Some(parent) = output.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|source| HtmlError::Write {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let spec = Spec {
        shot: shot.clone(),
        output: output.to_path_buf(),
    };
    let payload = serde_json::to_string(&spec).map_err(|error| {
        HtmlError::Invalid(format!("could not encode the render spec: {error}"))
    })?;

    // The spec goes on stdin rather than argv: a composition passed as `Source::Html` can be
    // megabytes, and argv has a hard limit that would turn a large card into a spawn failure.
    let mut child = std::process::Command::new(&binary)
        .arg(SHOT_FLAG)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| HtmlError::Spawn(format!("{}: {error}", binary.display())))?;

    {
        use std::io::Write as _;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| HtmlError::Spawn("the renderer refused its input".to_string()))?;
        stdin
            .write_all(payload.as_bytes())
            .map_err(|error| HtmlError::Spawn(format!("could not send the spec: {error}")))?;
    }

    let finished = wait_with_timeout(&mut child, shot.timeout_ms)?;
    let out = finished.wait_with_output().map_err(|error| {
        HtmlError::Render(format!("could not collect the renderer's output: {error}"))
    })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(HtmlError::Render(if stderr.is_empty() {
            format!("the renderer exited with {}", out.status)
        } else {
            stderr
        }));
    }

    serde_json::from_slice(&out.stdout).map_err(|error| {
        HtmlError::Render(format!(
            "the renderer returned something unreadable ({error}): {}",
            String::from_utf8_lossy(&out.stdout).trim()
        ))
    })
}

/// Wait for the child, killing it if it overruns.
///
/// `Child::wait` has no timeout, so a composition with `while(true)` in it would hang the
/// server that spawned it — which is the failure the child process exists to prevent, and would
/// be reintroduced by waiting forever here.
fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout_ms: u64,
) -> Result<std::process::Child, HtmlError> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(error) => return Err(HtmlError::Render(format!("lost the renderer: {error}"))),
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(HtmlError::Timeout(timeout_ms));
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    // `wait_with_output` consumes the child, and we only hold a borrow. Swapping in a fresh
    // placeholder is not possible, so the caller re-reads through a raw take of the pipes.
    Ok(std::mem::replace(child, dummy_child()))
}

/// A already-exited process to leave in place of one we are taking ownership of.
fn dummy_child() -> std::process::Child {
    // `true` exists on every unix and on Windows we never reach here in practice; if the spawn
    // fails the placeholder is simply never waited on.
    std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawning `true` as a placeholder")
}

/// The spec the parent hands the child.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Spec {
    #[serde(flatten)]
    shot: Shot,
    output: PathBuf,
}

/// The child's entry point: `bay --html-shot`, spec on stdin, [`Rendered`] on stdout.
///
/// Never returns — it exits the process, because this mode owns the main thread and there is no
/// editor or server to hand it back to.
pub fn shot_main() -> ! {
    let mut payload = String::new();
    if let Err(error) = std::io::Read::read_to_string(&mut std::io::stdin(), &mut payload) {
        eprintln!("bay: could not read the render spec: {error}");
        std::process::exit(2);
    }
    let spec: Spec = match serde_json::from_str(&payload) {
        Ok(spec) => spec,
        Err(error) => {
            eprintln!("bay: unreadable render spec: {error}");
            std::process::exit(2);
        }
    };

    #[cfg(target_os = "macos")]
    {
        match webview::render(&spec.shot, &spec.output) {
            Ok(rendered) => {
                match serde_json::to_string(&rendered) {
                    Ok(json) => println!("{json}"),
                    Err(error) => {
                        eprintln!("bay: could not report the result: {error}");
                        std::process::exit(1);
                    }
                }
                std::process::exit(0);
            }
            Err(error) => {
                eprintln!("bay: {error}");
                std::process::exit(1);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = spec;
        eprintln!(
            "bay: {}",
            unavailable_reason().unwrap_or_else(|| "HTML rendering is unavailable".to_string())
        );
        std::process::exit(1);
    }
}

/// The JavaScript that seeks a declared timeline, built for one shot.
///
/// Public so the seek contract is testable without a web engine: what this returns is the whole
/// of what bay asks a composition to do, and it is the part most likely to be wrong.
pub fn seek_script(shot: &Shot) -> String {
    let time = if shot.at_seconds.is_finite() {
        shot.at_seconds.max(0.0)
    } else {
        0.0
    };
    let id = match &shot.timeline_id {
        Some(id) => serde_json::to_string(id).unwrap_or_else(|_| "null".to_string()),
        None => "null".to_string(),
    };
    // Duck-typed on purpose: GSAP's timeline is what the compositions in this repository use,
    // but anything with pause() and time() seeks the same way, and a composition with no
    // timeline at all is the common case rather than an error.
    format!(
        r#"(function () {{
  var registry = window.__timelines;
  if (!registry) {{ return "no-timelines"; }}
  var id = {id};
  var timeline = null;
  if (id !== null) {{
    timeline = registry[id];
    if (!timeline) {{ return "no-such-timeline"; }}
  }} else {{
    var keys = Object.keys(registry);
    if (keys.length === 0) {{ return "no-timelines"; }}
    if (keys.length > 1) {{ return "ambiguous:" + keys.join(","); }}
    timeline = registry[keys[0]];
  }}
  if (typeof timeline.pause === "function") {{ timeline.pause(); }}
  if (typeof timeline.time === "function") {{ timeline.time({time}); }}
  else if (typeof timeline.seek === "function") {{ timeline.seek({time}); }}
  else {{ return "not-seekable"; }}
  return "seeked";
}})()"#
    )
}

/// The readiness probe injected after load.
///
/// `document.readyState` alone is not enough: it reaches `complete` before webfonts resolve, and
/// a card snapped in that window renders in the fallback face. `document.fonts.ready` is a
/// promise, so it is latched onto a global the parent can poll.
pub const READY_SCRIPT: &str = r#"(function () {
  if (window.__bayReady === undefined) {
    window.__bayReady = false;
    var done = function () { window.__bayReady = true; };
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
      document.fonts.ready.then(done, done);
    } else {
      done();
    }
  }
  return window.__bayReady === true && document.readyState === "complete";
})()"#;

/// Make the rendered PNG exactly the size that was asked for, and say what it really is.
///
/// **WebKit snapshots at the display's backing scale.** On a Retina Mac a 1080x1920 request
/// comes back 2160x3840, and until this existed [`Rendered`] reported the size that had been
/// *asked for* rather than the size on disk — a number that could not be wrong because nothing
/// ever measured it. It shipped a composition at twice its intended size into a 1:1 composite,
/// where it landed as the top-left quarter of itself, and every test passed: `ink` is a
/// fraction and so is blind to scale, and the dimension assertions were comparing the declared
/// value with itself.
///
/// Conforming down rather than rendering at 1:1 is deliberate — it makes the extra pixels a
/// supersample instead of waste, so an overlay on a Retina machine is *sharper* than one
/// rasterised at exactly the requested size.
fn conform(bytes: &[u8], want: (u32, u32)) -> Result<(Vec<u8>, u32, u32), HtmlError> {
    let decoded =
        image::load_from_memory_with_format(bytes, image::ImageFormat::Png).map_err(|error| {
            HtmlError::Render(format!("the rendered PNG could not be read: {error}"))
        })?;
    let (actual_w, actual_h) = (decoded.width(), decoded.height());
    if (actual_w, actual_h) == want {
        return Ok((bytes.to_vec(), actual_w, actual_h));
    }
    let resized = decoded.resize_exact(want.0, want.1, image::imageops::FilterType::Lanczos3);
    let mut out = std::io::Cursor::new(Vec::new());
    resized
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|error| {
            HtmlError::Render(format!("the conformed PNG could not be encoded: {error}"))
        })?;
    Ok((out.into_inner(), want.0, want.1))
}

/// What fraction of a PNG's pixels carry any opacity at all.
///
/// The one measurement that separates a correct overlay from a composition that silently drew
/// nothing: both are valid PNGs of the right size, and only this tells them apart before the
/// frame reaches a timeline. An image with no alpha channel is fully opaque by definition and
/// reads as 1.0.
pub fn ink_of_png(bytes: &[u8]) -> Result<f32, HtmlError> {
    let decoded =
        image::load_from_memory_with_format(bytes, image::ImageFormat::Png).map_err(|error| {
            HtmlError::Render(format!("the rendered PNG could not be read: {error}"))
        })?;
    let rgba = decoded.to_rgba8();
    let total = rgba.pixels().len();
    if total == 0 {
        return Ok(0.0);
    }
    let inked = rgba.pixels().filter(|pixel| pixel.0[3] > 0).count();
    Ok(inked as f32 / total as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shot() -> Shot {
        Shot::new(Source::Html("<p>hi</p>".to_string()), 540, 960)
    }

    #[test]
    fn output_size_follows_scale() {
        let mut s = shot();
        assert_eq!(s.output_size(), (540, 960));
        s.scale = 2.0;
        assert_eq!(s.output_size(), (1080, 1920));
    }

    /// A scale of zero or NaN must not produce a zero-pixel image; it falls back to 1:1.
    #[test]
    fn a_broken_scale_does_not_produce_a_zero_sized_image() {
        let mut s = shot();
        s.scale = 0.0;
        assert_eq!(s.output_size(), (540, 960));
        s.scale = f32::NAN;
        assert_eq!(s.output_size(), (540, 960));
    }

    #[test]
    fn a_zero_canvas_is_refused() {
        let mut s = shot();
        s.width = 0;
        assert!(matches!(s.validate(), Err(HtmlError::Invalid(_))));
    }

    #[test]
    fn a_scale_past_the_backing_store_limit_is_refused() {
        let mut s = shot();
        s.scale = 64.0;
        let message = s.validate().unwrap_err().to_string();
        assert!(message.contains("16384"), "{message}");
    }

    #[test]
    fn a_negative_seek_is_refused() {
        let mut s = shot();
        s.at_seconds = -1.0;
        assert!(matches!(s.validate(), Err(HtmlError::Invalid(_))));
    }

    #[test]
    fn a_missing_file_is_reported_as_a_read_error_not_a_render_one() {
        let s = Shot::new(Source::File(PathBuf::from("/nonexistent/x.html")), 10, 10);
        assert!(matches!(s.validate(), Err(HtmlError::Read { .. })));
    }

    /// The seek script must name the timeline the caller asked for, and must quote it — an id
    /// with a quote in it would otherwise close the string and run as code.
    #[test]
    fn seek_script_quotes_the_timeline_id() {
        let mut s = shot();
        s.timeline_id = Some("g4\"; alert(1); //".to_string());
        s.at_seconds = 1.5;
        let script = seek_script(&s);
        assert!(
            script.contains(r#"var id = "g4\"; alert(1); //""#),
            "{script}"
        );
        assert!(script.contains("1.5"), "{script}");
    }

    /// With no id and no registry the script reports rather than throwing: a composition
    /// without a timeline is a still card, which is the common case.
    #[test]
    fn seek_script_handles_a_composition_with_no_timeline() {
        let script = seek_script(&shot());
        assert!(script.contains("no-timelines"), "{script}");
        assert!(script.contains("var id = null"), "{script}");
    }

    #[test]
    fn a_non_finite_seek_becomes_zero_in_the_script() {
        let mut s = shot();
        s.at_seconds = f64::INFINITY;
        assert!(seek_script(&s).contains("time(0)"));
    }

    /// A test harness must never be mistaken for the renderer. This is what stops the parent
    /// spawning the test binary with a flag it does not understand.
    #[test]
    fn a_test_harness_is_not_a_renderer() {
        assert!(!is_bay_binary(Path::new("/x/bay-html-abc123")));
        assert!(!is_bay_binary(Path::new("/x/deps/bay_html-9f2")));
        assert!(is_bay_binary(Path::new("/x/release/bay")));
    }

    #[test]
    fn the_spec_round_trips() {
        let spec = Spec {
            shot: shot(),
            output: PathBuf::from("/tmp/out.png"),
        };
        let encoded = serde_json::to_string(&spec).unwrap();
        let decoded: Spec = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.output, spec.output);
        assert_eq!(decoded.shot.width, 540);
    }

    /// Off macOS, and in any process that is not bay, this reports a reason rather than
    /// claiming to work.
    #[test]
    fn unavailable_always_carries_a_reason() {
        if !available() {
            assert!(unavailable_reason().is_some_and(|r| !r.is_empty()));
        }
    }

    fn png_of(pixels: &[[u8; 4]], width: u32, height: u32) -> Vec<u8> {
        let mut buffer = image::RgbaImage::new(width, height);
        for (index, pixel) in pixels.iter().enumerate() {
            buffer.put_pixel(
                index as u32 % width,
                index as u32 / width,
                image::Rgba(*pixel),
            );
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    /// A composition that drew nothing is a fully transparent PNG. This is the only signal that
    /// separates it from a correct overlay, so it is the one the tool refuses on.
    #[test]
    fn a_fully_transparent_png_has_no_ink() {
        let png = png_of(&[[0, 0, 0, 0]; 4], 2, 2);
        assert_eq!(ink_of_png(&png).unwrap(), 0.0);
    }

    #[test]
    fn a_half_covered_png_reads_as_half_ink() {
        let png = png_of(
            &[
                [255, 0, 0, 255],
                [0, 0, 0, 0],
                [255, 0, 0, 255],
                [0, 0, 0, 0],
            ],
            2,
            2,
        );
        assert_eq!(ink_of_png(&png).unwrap(), 0.5);
    }

    /// Any opacity counts, including a barely-there anti-aliased edge — the question is
    /// "did anything draw", not "is it bold enough".
    #[test]
    fn a_single_faint_pixel_still_counts_as_ink() {
        let png = png_of(
            &[[255, 255, 255, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
            2,
            2,
        );
        assert_eq!(ink_of_png(&png).unwrap(), 0.25);
    }

    #[test]
    fn something_that_is_not_a_png_is_an_error_not_a_blank() {
        assert!(ink_of_png(b"not a png at all").is_err());
    }

    /// The regression: a snapshot that came back at the display's backing scale must be
    /// conformed to the size that was asked for, not reported as if it already were.
    #[test]
    fn a_retina_sized_snapshot_is_conformed_down() {
        let doubled = png_of(&[[9, 9, 9, 255]; 16], 4, 4);
        let (bytes, w, h) = conform(&doubled, (2, 2)).unwrap();
        assert_eq!((w, h), (2, 2));
        let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        assert_eq!(
            (decoded.width(), decoded.height()),
            (2, 2),
            "the BYTES must be resized too"
        );
    }

    #[test]
    fn a_snapshot_already_the_right_size_is_left_alone() {
        let exact = png_of(&[[9, 9, 9, 255]; 4], 2, 2);
        let (bytes, w, h) = conform(&exact, (2, 2)).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(
            bytes, exact,
            "an already-correct PNG must not be re-encoded"
        );
    }

    #[test]
    fn blankness_is_read_from_ink() {
        let blank = Rendered {
            path: PathBuf::new(),
            width: 1,
            height: 1,
            ink: 0.0,
        };
        assert!(blank.is_blank());
        assert!(!Rendered { ink: 0.01, ..blank }.is_blank());
    }
}
