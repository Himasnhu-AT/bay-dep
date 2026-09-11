//! Building the Kokoro virtualenv, in Rust, from runtimes bay downloaded itself.
//!
//! This is `script/setup-speech.sh` moved where a shipped app can reach it. That script is a
//! *dev* script run by `./build.sh` — someone who downloads bay.app never runs it, and it
//! required `uv` to already be on the machine. Neither assumption survives shipping, so the
//! logic lives here and drives the `uv` and the CPython that [`crate::install_blocking`]
//! placed under bay's runtime directory.
//!
//! Everything is pinned to that directory, deliberately and with a flag each:
//!
//! - `--python <our interpreter>` so uv never reaches for a system Python,
//! - `--no-project` so a `pyproject.toml` in whatever directory bay was launched from cannot
//!   change what gets installed,
//! - `UV_CACHE_DIR` inside the runtime directory, so bay's wheels are bay's to delete,
//! - `UV_PYTHON_INSTALL_DIR` likewise, verified to be a real redirect rather than an extra
//!   search path: with it set, `uv python list --only-installed` reports nothing despite five
//!   managed Pythons in `HOME`,
//! - `--no-config` so a user-level `uv.toml` — an index URL, say — cannot redirect where these
//!   packages come from.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::ProvisionError;
use crate::manifest::KokoroVenv;

/// The interpreter inside a venv, per platform.
pub fn venv_python(root: &Path, venv: &KokoroVenv) -> PathBuf {
    let base = root.join(&venv.venv);
    if cfg!(windows) {
        base.join("Scripts").join("python.exe")
    } else {
        base.join("bin").join("python")
    }
}

/// Every interpreter bay would accept for narration, best first.
///
/// The single definition of that list. `bay-speech` resolves the interpreter it runs from here,
/// and [`crate::report`] decides whether narration needs installing from here, so the two cannot
/// drift into disagreeing — which would show up as narration reporting "not installed" beside a
/// working 858 MB environment, or as bay offering to download one it already has.
///
/// The legacy `~/.local/share/bay/kokoro-venv` stays in the list, on macOS too, because
/// `script/setup-speech.sh` put it there on every development machine and moving the lookup to
/// the platform data directory would strand all of them.
pub fn interpreter_candidates() -> Vec<PathBuf> {
    let interpreter_in = |venv: PathBuf| {
        if cfg!(windows) {
            venv.join("Scripts").join("python.exe")
        } else {
            venv.join("bin").join("python")
        }
    };

    let mut candidates = Vec::new();
    // The same override the shell script honours, so setting it once configures both.
    if let Ok(explicit) = std::env::var("BAY_SPEECH_VENV") {
        candidates.push(interpreter_in(PathBuf::from(explicit)));
    }
    if let Some(runtime) = bay_paths::runtime_dir() {
        candidates.push(venv_python(
            &runtime,
            &crate::Manifest::embedded().kokoro_venv,
        ));
    }
    if let Some(home) = bay_paths::home() {
        candidates.push(interpreter_in(home.join(".local/share/bay/kokoro-venv")));
        // Where the setup script put it when the app was called vii. An 858 MB environment that
        // works is worth four lines of lookup — dropping this at the rename would have made
        // narration report "not installed" on every machine that had ever provisioned it, and
        // the fix would have looked like a fresh 1.2 GB download.
        candidates.push(interpreter_in(home.join(".local/share/vii/kokoro-venv")));
    }
    if let Some(data) = bay_paths::data_dir() {
        candidates.push(interpreter_in(data.join("kokoro-venv")));
    }
    candidates
}

/// The first interpreter that is actually there, if any.
pub fn existing_interpreter() -> Option<PathBuf> {
    interpreter_candidates().into_iter().find(|p| p.is_file())
}

/// The CPython bay downloaded.
fn managed_python(root: &Path, venv: &KokoroVenv) -> PathBuf {
    let base = root.join("python").join(&venv.python);
    if cfg!(windows) {
        base.join("python.exe")
    } else {
        base.join("bin").join("python3.12")
    }
}

fn managed_uv(root: &Path) -> PathBuf {
    let name = if cfg!(windows) { "uv.exe" } else { "uv" };
    root.join("bin").join(name)
}

/// Create the venv and install Kokoro into it.
///
/// `on_step` is called with a line per phase — this takes minutes and a silent progress bar
/// during a 1 GB resolve reads as a hang.
pub fn provision_venv(
    root: &Path,
    venv: &KokoroVenv,
    on_step: &mut dyn FnMut(String),
) -> Result<(), ProvisionError> {
    let uv = managed_uv(root);
    let python = managed_python(root, venv);
    for (what, path) in [("uv", &uv), ("python", &python)] {
        if !path.is_file() {
            return Err(ProvisionError::Step {
                step: "kokoro-venv".into(),
                detail: format!(
                    "{what} is not where bay installed it ({}) — the download step must run first",
                    path.display()
                ),
            });
        }
    }

    let venv_dir = root.join(&venv.venv);
    let interpreter = venv_python(root, venv);

    on_step("creating the Python environment".into());
    run(
        &uv,
        &[
            "venv".as_ref(),
            "--python".as_ref(),
            python.as_os_str(),
            "--no-project".as_ref(),
            venv_dir.as_os_str(),
        ],
        root,
        "creating the virtualenv",
    )?;

    on_step("installing Kokoro — about 1 GB, this is the slow part".into());
    let mut install: Vec<&std::ffi::OsStr> = vec![
        "pip".as_ref(),
        "install".as_ref(),
        "--python".as_ref(),
        interpreter.as_os_str(),
    ];
    for package in &venv.packages {
        install.push(package.as_ref());
    }
    run(&uv, &install, root, "installing kokoro")?;

    // Pre-installed rather than left to runtime, and this is load-bearing: misaki's English G2P
    // calls spacy.load() and, when the model is absent, shells out to pip from inside the
    // running sidecar. That fails, and it takes narration down with an error that points
    // nowhere useful.
    on_step("installing the English pronunciation model".into());
    run(
        &uv,
        &[
            "pip".as_ref(),
            "install".as_ref(),
            "--python".as_ref(),
            interpreter.as_os_str(),
            venv.spacy_model.as_ref(),
        ],
        root,
        "installing en_core_web_sm",
    )?;

    on_step("checking it imports".into());
    verify_imports(&interpreter, venv)?;
    on_step("narration is ready".into());
    Ok(())
}

/// Whether the venv exists *and* imports what narration needs.
///
/// Costs an interpreter start, so it is not what a status readout calls — that checks for the
/// interpreter file. This is the answer that matters before trusting narration to work.
pub fn venv_is_ready(root: &Path, venv: &KokoroVenv) -> bool {
    let interpreter = venv_python(root, venv);
    interpreter.is_file() && verify_imports(&interpreter, venv).is_ok()
}

fn verify_imports(interpreter: &Path, venv: &KokoroVenv) -> Result<(), ProvisionError> {
    let modules = venv.provides.join("','");
    let program = format!(
        "import importlib.util,sys; \
         missing=[m for m in ['{modules}'] if importlib.util.find_spec(m) is None]; \
         sys.exit(0 if not missing else 1)"
    );
    let status = Command::new(interpreter)
        .arg("-c")
        .arg(&program)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| ProvisionError::Step {
            step: "kokoro-venv".into(),
            detail: format!("could not run {}: {error}", interpreter.display()),
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(ProvisionError::Step {
            step: "kokoro-venv".into(),
            detail: format!(
                "the environment was built but {} does not import — see the install output above",
                venv.provides.join(" and ")
            ),
        })
    }
}

/// Run a uv command with everything pointed inside bay's runtime directory.
fn run(
    program: &Path,
    args: &[&std::ffi::OsStr],
    root: &Path,
    doing: &str,
) -> Result<(), ProvisionError> {
    let output = Command::new(program)
        .args(args)
        // Never read a user-level uv.toml: an index URL configured there would silently change
        // where these packages come from, on a machine bay is trying to make reproducible.
        .arg("--no-config")
        .env("UV_CACHE_DIR", root.join("cache"))
        .env("UV_PYTHON_INSTALL_DIR", root.join("python"))
        // uv resolves a managed Python by asking the network unless told the one to use is
        // already here. Everything bay needs is downloaded and verified by then.
        .env("UV_PYTHON_DOWNLOADS", "never")
        .env("UV_NO_PROGRESS", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| ProvisionError::Step {
            step: "kokoro-venv".into(),
            detail: format!("could not run {}: {error}", program.display()),
        })?;

    if output.status.success() {
        return Ok(());
    }

    // uv puts the actual reason on stderr. Truncated because a failed resolve can print
    // hundreds of lines of version conflicts, and the tail is where the reason lives.
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr
        .lines()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    Err(ProvisionError::Step {
        step: "kokoro-venv".into(),
        detail: format!("{doing} failed.\n{detail}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Manifest;

    fn venv() -> &'static KokoroVenv {
        &Manifest::embedded().kokoro_venv
    }

    /// The manifest and this module must agree on where the interpreter is, or narration reports
    /// "not installed" while sitting next to a working venv — a regression with no symptom
    /// except a wrong answer.
    #[test]
    fn the_venv_marker_is_the_interpreter_this_module_runs() {
        let root = Path::new("/runtime");
        assert_eq!(
            root.join(crate::manifest::venv_marker(venv())),
            venv_python(root, venv())
        );
    }

    #[test]
    fn the_managed_interpreter_matches_the_version_the_manifest_pins() {
        let path = managed_python(Path::new("/runtime"), venv());
        assert!(
            path.to_string_lossy().contains(&venv().python),
            "{path:?} should sit under the pinned version directory"
        );
    }

    /// Building the venv before the downloads have landed must say which piece is missing, not
    /// fail somewhere inside uv.
    #[test]
    fn provisioning_without_the_downloads_says_what_is_missing() {
        let empty = std::env::temp_dir().join(format!("bay-speech-empty-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&empty);
        let error = provision_venv(&empty, venv(), &mut |_| {})
            .expect_err("nothing is installed under this root");
        let message = error.to_string();
        assert!(message.contains("uv"), "{message}");
        assert!(
            message.contains("download step must run first"),
            "{message}"
        );
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn a_missing_venv_is_not_ready() {
        let empty = std::env::temp_dir().join(format!("bay-speech-none-{}", std::process::id()));
        assert!(!venv_is_ready(&empty, venv()));
    }
}
