//! Where the external programs bay shells out to actually live.
//!
//! macOS gives a Finder-launched app launchd's `_PATH_STDPATH` — `/usr/bin:/bin:/usr/sbin:/sbin`
//! and nothing else. A Homebrew ffmpeg at `/opt/homebrew/bin` is therefore invisible to
//! `bay.app` while `ffmpeg` works perfectly in the user's terminal, in `./run.sh` and in
//! `cargo test`. The bug cannot be reproduced in any development loop, which is why the rules
//! below are pure functions of an environment lookup and a file test: the Finder environment is
//! *simulated in a unit test* rather than discovered by someone whose render failed.
//!
//! **This resolves a binary; it does not repair `PATH`.** Every comparable project (Tauri's
//! `fix-path-env`, VS Code's `resolveShellEnv`, Zed's login-shell import) fixes the process
//! environment with `std::env::set_var`. That is the wrong trade here for three reasons:
//! `set_var` is only sound before any thread exists, so it must run as the first statement of
//! `main`; putting a shell spawn there costs 0.1–3s before first paint; and it imports the
//! user's entire shell environment when the question was "where is one file". Asking for an
//! absolute path instead makes the answer verifiable (is this executable?) and keeps the blast
//! radius to one `Command`.
//!
//! **Nothing here executes user-controlled code.** An earlier draft ended with
//! `$SHELL -l -i -c 'command -v ffmpeg'`, the trick the projects above use. An adversarial
//! review killed it: an interactive shell runs `.zshrc`, so a `Documents` access or a Touch ID
//! prompt would appear attributed to *bay*, seconds after launch, with no user action; the
//! child would inherit whatever secrets an agent runtime passed bay; aliases make
//! `command -v` print an alias rather than a path; `tcsh` has no `-l`; and — decisively —
//! `bay` serves MCP on an unauthenticated loopback port, so any web page could POST a tool call
//! and make bay execute the user's dotfiles. The tiers below cover Homebrew on both
//! architectures, MacPorts and Fink; anything more exotic is what `BAY_FFMPEG` is for, and the
//! failure message says so.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// An external program bay runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    pub const fn binary(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
        }
    }

    /// The environment variable that overrides this tool's location.
    pub const fn override_var(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "BAY_FFMPEG",
            Tool::Ffprobe => "BAY_FFPROBE",
        }
    }

    pub const fn all() -> [Tool; 2] {
        [Tool::Ffmpeg, Tool::Ffprobe]
    }
}

impl std::fmt::Display for Tool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.binary())
    }
}

/// How a tool was found. Reported so a failure message can be honest about what was searched,
/// and so a surprising resolution (a shim in a user directory) is visible rather than silent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Override,
    Bundled,
    Managed,
    KnownPrefix,
    Path,
    PathHelper,
}

impl Via {
    pub const fn describe(self) -> &'static str {
        match self {
            Via::Override => "an explicit override",
            Via::Bundled => "the application bundle",
            Via::Managed => "bay's own runtime directory",
            Via::KnownPrefix => "a known install location",
            Via::Path => "PATH",
            Via::PathHelper => "/etc/paths.d",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    pub via: Via,
}

/// Why a tool could not be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Missing {
    /// Searched everywhere and found nothing.
    NotInstalled { tool: Tool, searched: Vec<PathBuf> },
    /// An override was set and is wrong. Deliberately fatal rather than a fallback: a packager
    /// who typos the path would otherwise silently get the system ffmpeg and never find out.
    BadOverride {
        tool: Tool,
        var: &'static str,
        path: PathBuf,
    },
}

impl Missing {
    /// One line, for a status bar.
    pub fn short(&self) -> String {
        match self {
            Missing::NotInstalled { tool, .. } => {
                format!(
                    "{tool} was not found — install it, or set {}",
                    tool.override_var()
                )
            }
            Missing::BadOverride { var, path, .. } => {
                format!(
                    "{var} points at {}, which is not executable",
                    path.display()
                )
            }
        }
    }

    /// The full explanation, naming everywhere that was looked.
    ///
    /// Listing the directories matters: the common case is that ffmpeg *is* installed and bay
    /// simply could not see it, and a message that only says "not found" sends someone to
    /// reinstall a working ffmpeg.
    pub fn detail(&self) -> String {
        match self {
            Missing::BadOverride { var, path, tool } => format!(
                "{var} is set to {}, but that is not an executable file.\n\
                 Point it at a real {tool} binary, or unset it to search normally.",
                path.display()
            ),
            Missing::NotInstalled { tool, searched } => {
                let mut message = format!(
                    "bay could not find {tool}, which it needs to decode, probe and export video.\n\nLooked in:\n"
                );
                for dir in searched {
                    message.push_str(&format!("  {}\n", tilde(dir)));
                }
                // bay can install this itself, so that is the first thing offered — telling
                // someone to go and find a package manager when the app in front of them can
                // do it is the whole problem this tier exists to remove. The alternatives stay
                // listed because a machine that already has ffmpeg should not download another.
                message.push_str(&format!(
                    "\nbay can install it for you — about 57 MB, from the FFmpeg project's \
                     published builds. Nothing else needs installing first.\n\
                     Or use one you already have:  brew install ffmpeg\n\
                     Or, if it is somewhere unusual:  {}=/full/path/to/{tool}\n",
                    tool.override_var()
                ));
                if cfg!(target_os = "macos") {
                    message.push_str(
                        "\nNote: an app launched from Finder does not inherit your shell's PATH, \
                         so a tool that works in Terminal can still be invisible here. bay checks \
                         the usual install locations directly for that reason — if yours is \
                         somewhere else, the override above is the fix.\n",
                    );
                }
                message
            }
        }
    }
}

impl std::fmt::Display for Missing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.short())
    }
}

impl std::error::Error for Missing {}

/// Shorten a path under the home directory, so a message can be shown or logged without
/// spelling out someone's account name.
fn tilde(path: &Path) -> String {
    match crate::home() {
        Some(home) => match path.strip_prefix(&home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => path.display().to_string(),
        },
        None => path.display().to_string(),
    }
}

/// Install locations checked directly, in order.
///
/// This is the tier that actually fixes the Finder bug, and it is deliberately ahead of `PATH`:
/// a `stat` on a dead network mount blocks in uninterruptible I/O for the mount's timeout, and
/// an inherited `PATH` is where such an entry would be. Checking the fixed local prefixes first
/// means the overwhelmingly common case never touches one.
fn known_prefixes() -> &'static [&'static str] {
    #[cfg(target_os = "macos")]
    {
        &[
            "/opt/homebrew/bin",            // Homebrew, Apple Silicon
            "/usr/local/bin",               // Homebrew, Intel
            "/opt/homebrew/opt/ffmpeg/bin", // keg-only or unlinked
            "/usr/local/opt/ffmpeg/bin",
            "/opt/local/bin", // MacPorts
            "/sw/bin",        // Fink
        ]
    }
    #[cfg(target_os = "windows")]
    {
        &[
            r"C:\Program Files\ffmpeg\bin",
            r"C:\ffmpeg\bin",
            r"C:\ProgramData\chocolatey\bin",
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        &["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"]
    }
}

/// Deliberately NOT searched: `~/.local/bin` and `~/bin`.
///
/// Neither is on macOS's default PATH, so a user's own shell would not resolve ffmpeg there —
/// but bay would, and would run it with bay's notarized identity, its TCC grants and
/// `disable-library-validation`. A pip/npm-vendored shim landing there would silently become
/// the binary bay executes while the user's terminal keeps using a different one. That
/// divergence is worse than not finding it: `BAY_FFMPEG` covers the genuine case.
const _: () = ();

/// Candidate file names for `binary` in a directory.
///
/// Windows needs the extension: `Command::new("ffmpeg")` finds `ffmpeg.exe` only because the
/// loader appends `PATHEXT`, and a `stat` on `<dir>\ffmpeg` misses every time. Without this,
/// resolving by hand would break every Windows user — who, per the shipped README, are told to
/// put ffmpeg on PATH.
fn candidate_names(binary: &str, get: &dyn Fn(&str) -> Option<OsString>) -> Vec<String> {
    if !cfg!(windows) {
        return vec![binary.to_string()];
    }
    let pathext = get("PATHEXT")
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut names: Vec<String> = pathext
        .split(';')
        .map(str::trim)
        .filter(|ext| !ext.is_empty())
        .map(|ext| format!("{binary}{}", ext.to_lowercase()))
        .collect();
    // A bare name last: some installs drop an extensionless shim.
    names.push(binary.to_string());
    names
}

/// Resolve `tool` from an injected environment and file test.
///
/// Pure, so every platform's rules are exercised on whichever machine runs the tests — the
/// same discipline the rest of this crate uses, and the only way a Finder-shaped environment
/// gets tested at all.
pub fn resolve_with(
    tool: Tool,
    get: &dyn Fn(&str) -> Option<OsString>,
    exe_dir: Option<&Path>,
    managed_dir: Option<&Path>,
    is_exe: &dyn Fn(&Path) -> bool,
) -> Result<Found, Missing> {
    let names = candidate_names(tool.binary(), get);
    let mut searched: Vec<PathBuf> = Vec::new();

    // 1. An explicit override wins, and a wrong one is fatal rather than a fallback.
    if let Some(raw) = get(tool.override_var()).filter(|v| !v.is_empty()) {
        let path = PathBuf::from(&raw);
        return if is_exe(&path) {
            Ok(Found {
                path,
                via: Via::Override,
            })
        } else {
            Err(Missing::BadOverride {
                tool,
                var: tool.override_var(),
                path,
            })
        };
    }

    // 2. Shipped beside the binary. Nothing lands here today; it costs two stats and means
    //    bundling ffmpeg later touches no call site.
    if let Some(dir) = exe_dir {
        for base in [dir.join("../Helpers"), dir.to_path_buf()] {
            for name in &names {
                let candidate = base.join(name);
                if is_exe(&candidate) {
                    return Ok(Found {
                        path: candidate,
                        via: Via::Bundled,
                    });
                }
            }
            searched.push(base);
        }
    }

    // 3. What bay provisioned for the user. Ahead of the system prefixes on purpose: this is the
    //    exact build bay pinned and tested, so a machine that has provisioned gets a
    //    deterministic ffmpeg rather than whichever one Homebrew happens to hold. It sits
    //    *behind* the bundle tier because a copy shipped inside bay.app was chosen by the
    //    packager and signed with the app.
    if let Some(dir) = managed_dir {
        for name in &names {
            let candidate = dir.join(name);
            if is_exe(&candidate) {
                return Ok(Found {
                    path: candidate,
                    via: Via::Managed,
                });
            }
        }
        searched.push(dir.to_path_buf());
    }

    // 4. Known install locations — the tier that fixes the reported bug.
    for prefix in known_prefixes() {
        let dir = PathBuf::from(prefix);
        for name in &names {
            let candidate = dir.join(name);
            if is_exe(&candidate) {
                return Ok(Found {
                    path: candidate,
                    via: Via::KnownPrefix,
                });
            }
        }
        searched.push(dir);
    }

    // 5. The inherited PATH — what keeps a terminal, `cargo test` and CI working unchanged.
    //    Absolute entries only: POSIX says an empty element means the current directory, and
    //    bay's working directory when an agent runtime launches it is that agent's repo. A
    //    relative entry there would let a checked-in `./ffmpeg` be executed.
    if let Some(path) = get("PATH") {
        for dir in std::env::split_paths(&path) {
            if dir.as_os_str().is_empty() || !dir.is_absolute() {
                continue;
            }
            for name in &names {
                let candidate = dir.join(name);
                if is_exe(&candidate) {
                    return Ok(Found {
                        path: candidate,
                        via: Via::Path,
                    });
                }
            }
            searched.push(dir);
        }
    }

    searched.dedup();
    Err(Missing::NotInstalled { tool, searched })
}

/// Directories registered in `/etc/paths` and `/etc/paths.d`, via `path_helper`.
///
/// The Homebrew installer writes `/etc/paths.d/` for any prefix that is not `/usr/local`, so
/// this recovers a custom prefix without guessing. Safe to run where the login shell was not:
/// `path_helper` executes no user code, it only concatenates files.
#[cfg(target_os = "macos")]
fn path_helper_dirs() -> Vec<PathBuf> {
    let Ok(output) = std::process::Command::new("/usr/libexec/path_helper")
        .arg("-s")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    // PATH="/usr/bin:/bin"; export PATH;
    let Some(start) = text.find("PATH=\"") else {
        return Vec::new();
    };
    let rest = &text[start + 6..];
    let Some(end) = rest.find('"') else {
        return Vec::new();
    };
    std::env::split_paths(&rest[..end])
        .filter(|dir| dir.is_absolute())
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn path_helper_dirs() -> Vec<PathBuf> {
    Vec::new()
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn env_var(key: &str) -> Option<OsString> {
    std::env::var_os(key)
}

/// Resolve `tool` against the real environment, consulting `/etc/paths.d` as a last resort.
pub fn resolve(tool: Tool) -> Result<Found, Missing> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let managed_dir = crate::managed_bin_dir();

    match resolve_with(
        tool,
        &env_var,
        exe_dir.as_deref(),
        managed_dir.as_deref(),
        &is_executable,
    ) {
        Ok(found) => Ok(found),
        Err(Missing::BadOverride { tool, var, path }) => {
            Err(Missing::BadOverride { tool, var, path })
        }
        Err(Missing::NotInstalled { tool, mut searched }) => {
            let names = candidate_names(tool.binary(), &env_var);
            for dir in path_helper_dirs() {
                for name in &names {
                    let candidate = dir.join(name);
                    if is_executable(&candidate) {
                        return Ok(Found {
                            path: candidate,
                            via: Via::PathHelper,
                        });
                    }
                }
                if !searched.contains(&dir) {
                    searched.push(dir);
                }
            }
            Err(Missing::NotInstalled { tool, searched })
        }
    }
}

/// Cached resolution. Resolving is a handful of `stat` calls, but every decode would otherwise
/// repeat them.
/// One resolved tool, cached.
type Cached = (Tool, Result<Found, Missing>);

static CACHE: std::sync::OnceLock<std::sync::Mutex<Vec<Cached>>> = std::sync::OnceLock::new();

fn cache_handle() -> &'static std::sync::OnceLock<std::sync::Mutex<Vec<Cached>>> {
    &CACHE
}

fn cached(tool: Tool) -> Result<Found, Missing> {
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(Vec::new()));

    if let Ok(entries) = cache.lock()
        && let Some((_, result)) = entries.iter().find(|(t, _)| *t == tool)
    {
        return result.clone();
    }
    let result = resolve(tool);
    if let Ok(mut entries) = cache.lock() {
        entries.retain(|(t, _)| *t != tool);
        entries.push((tool, result.clone()));
    }
    result
}

/// Drop the cached resolutions, so the next lookup searches again.
///
/// Exists for exactly one moment: bay has just installed ffmpeg into its own runtime directory,
/// and the cached answer from before the install still says it is missing. Without this the
/// user watches a download finish and is told to install ffmpeg — until they restart bay.
pub fn forget_cached() {
    if let Some(cache) = cache_handle().get()
        && let Ok(mut entries) = cache.lock()
    {
        entries.clear();
    }
}

/// The absolute path to ffmpeg, or why there isn't one.
pub fn ffmpeg() -> Result<PathBuf, Missing> {
    cached(Tool::Ffmpeg).map(|found| found.path)
}

/// The absolute path to ffprobe, or why there isn't one.
pub fn ffprobe() -> Result<PathBuf, Missing> {
    cached(Tool::Ffprobe).map(|found| found.path)
}

/// A `Command` already pointed at the resolved absolute path, so `execvp` never consults PATH.
pub fn command(tool: Tool) -> Result<std::process::Command, Missing> {
    cached(tool).map(|found| std::process::Command::new(found.path))
}

/// Whether a tool is usable, and where it came from — for a status readout.
pub fn status(tool: Tool) -> Result<Found, Missing> {
    cached(tool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// The PATH a Finder- or launchd-launched app actually gets. This constant is the whole
    /// reason this module exists.
    const LAUNCHD_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> + use<> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        move |key| map.get(key).map(OsString::from)
    }

    fn present(paths: &[&str]) -> impl Fn(&Path) -> bool + use<> {
        let set: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |p| set.iter().any(|known| known == p)
    }

    /// The reported bug, as a test: Finder's PATH, Homebrew's ffmpeg, and bay must find it.
    #[test]
    fn a_finder_launched_app_finds_homebrew_ffmpeg() {
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            None,
            None,
            &present(&["/opt/homebrew/bin/ffmpeg"]),
        )
        .expect("Homebrew ffmpeg must be found despite the launchd PATH");
        assert_eq!(found.path, PathBuf::from("/opt/homebrew/bin/ffmpeg"));
        assert_eq!(found.via, Via::KnownPrefix);
    }

    #[test]
    fn an_intel_mac_finds_ffmpeg_in_usr_local() {
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            None,
            None,
            &present(&["/usr/local/bin/ffmpeg"]),
        )
        .expect("Intel Homebrew");
        assert_eq!(found.path, PathBuf::from("/usr/local/bin/ffmpeg"));
    }

    #[test]
    fn macports_and_fink_are_found_too() {
        for prefix in ["/opt/local/bin", "/sw/bin"] {
            let binary = format!("{prefix}/ffprobe");
            let found = resolve_with(
                Tool::Ffprobe,
                &env(&[("PATH", LAUNCHD_PATH)]),
                None,
                None,
                &present(&[&binary]),
            )
            .unwrap_or_else(|_| panic!("{prefix} should be searched"));
            assert_eq!(found.path, PathBuf::from(&binary));
        }
    }

    #[test]
    fn an_override_wins_over_everything() {
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[
                ("BAY_FFMPEG", "/custom/ffmpeg"),
                ("PATH", "/opt/homebrew/bin"),
            ]),
            None,
            None,
            &present(&["/custom/ffmpeg", "/opt/homebrew/bin/ffmpeg"]),
        )
        .expect("the override");
        assert_eq!(found.path, PathBuf::from("/custom/ffmpeg"));
        assert_eq!(found.via, Via::Override);
    }

    /// A typo'd override must be loud. Falling through would hand the packager a different
    /// ffmpeg than the one they asked for, and they would never learn.
    #[test]
    fn a_broken_override_is_fatal_rather_than_a_fallback() {
        let error = resolve_with(
            Tool::Ffmpeg,
            &env(&[
                ("BAY_FFMPEG", "/typo/ffmpeg"),
                ("PATH", "/opt/homebrew/bin"),
            ]),
            None,
            None,
            &present(&["/opt/homebrew/bin/ffmpeg"]),
        )
        .expect_err("a wrong override must not silently fall back");
        assert!(matches!(error, Missing::BadOverride { .. }));
        assert!(
            error.detail().contains("/typo/ffmpeg"),
            "{}",
            error.detail()
        );
    }

    /// An empty override is a misconfiguration, not a request to use the current directory.
    #[test]
    fn an_empty_override_is_ignored() {
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("BAY_FFMPEG", ""), ("PATH", LAUNCHD_PATH)]),
            None,
            None,
            &present(&["/opt/homebrew/bin/ffmpeg"]),
        )
        .expect("an empty override should be treated as unset");
        assert_eq!(found.via, Via::KnownPrefix);
    }

    /// POSIX says an empty PATH element means the current directory. bay is launched by agent
    /// runtimes with their working directory set to a repo, so searching it would let a
    /// checked-in `./ffmpeg` be executed.
    #[test]
    fn the_working_directory_is_never_searched() {
        let error = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", "::.:relative/bin:")]),
            None,
            None,
            &present(&["ffmpeg", "./ffmpeg", "relative/bin/ffmpeg"]),
        )
        .expect_err("no absolute candidate exists, so nothing may be found");
        assert!(matches!(error, Missing::NotInstalled { .. }));
    }

    /// The point of provisioning: once bay has installed ffmpeg itself, that is the one it runs,
    /// even on a machine whose Homebrew copy is perfectly visible. Otherwise a user who
    /// provisioned to fix a broken render would still be running the broken ffmpeg.
    #[test]
    fn a_provisioned_tool_beats_the_system_one() {
        let managed = PathBuf::from("/Users/ada/Library/Application Support/bay/runtime/bin");
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            None,
            Some(&managed),
            &present(&[
                &format!("{}/ffmpeg", managed.display()),
                "/opt/homebrew/bin/ffmpeg",
            ]),
        )
        .expect("the provisioned copy");
        assert_eq!(found.path, managed.join("ffmpeg"));
        assert_eq!(found.via, Via::Managed);
    }

    /// Provisioning is optional. A machine that never ran it must keep resolving exactly as
    /// before — this is the regression that would silently break every existing install.
    #[test]
    fn an_empty_runtime_directory_falls_through_to_the_system_copy() {
        let managed = PathBuf::from("/Users/ada/Library/Application Support/bay/runtime/bin");
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            None,
            Some(&managed),
            &present(&["/opt/homebrew/bin/ffmpeg"]),
        )
        .expect("Homebrew still works");
        assert_eq!(found.via, Via::KnownPrefix);
    }

    /// A packager who ships ffmpeg inside bay.app signed it with the app. That must outrank a
    /// downloaded copy.
    #[test]
    fn a_bundled_copy_beats_a_provisioned_one() {
        let managed = PathBuf::from("/data/bay/runtime/bin");
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            Some(Path::new("/Applications/bay.app/Contents/MacOS")),
            Some(&managed),
            &present(&[
                "/Applications/bay.app/Contents/MacOS/../Helpers/ffmpeg",
                "/data/bay/runtime/bin/ffmpeg",
            ]),
        )
        .expect("bundled");
        assert_eq!(found.via, Via::Bundled);
    }

    #[test]
    fn a_bundled_copy_beats_an_installed_one() {
        let found = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            Some(Path::new("/Applications/bay.app/Contents/MacOS")),
            None,
            &present(&[
                "/Applications/bay.app/Contents/MacOS/../Helpers/ffmpeg",
                "/opt/homebrew/bin/ffmpeg",
            ]),
        )
        .expect("bundled");
        assert_eq!(found.via, Via::Bundled);
    }

    /// A `stat` on `<dir>\ffmpeg` misses on Windows, where the file is `ffmpeg.exe` — the
    /// loader appends PATHEXT. Resolving by hand without this would break every Windows user,
    /// who are told by the shipped README to put ffmpeg on PATH.
    #[test]
    fn windows_names_carry_an_extension() {
        let names = candidate_names("ffmpeg", &env(&[("PATHEXT", ".COM;.EXE;.BAT")]));
        if cfg!(windows) {
            assert!(
                names.contains(&"ffmpeg.exe".to_string()),
                "PATHEXT must be applied: {names:?}"
            );
        } else {
            assert_eq!(names, vec!["ffmpeg".to_string()]);
        }
    }

    #[test]
    fn a_missing_tool_names_where_it_looked_and_how_to_fix_it() {
        let error = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            None,
            None,
            &present(&[]),
        )
        .expect_err("nothing is installed");
        let detail = error.detail();
        assert!(detail.contains("/opt/homebrew/bin"), "{detail}");
        assert!(detail.contains("BAY_FFMPEG"), "{detail}");
        assert!(
            detail.contains("bay can install it for you"),
            "the app can provision this itself and must say so first: {detail}"
        );
        assert!(
            !detail.contains("close the app") && !detail.contains("headless"),
            "the message must not push work elsewhere: {detail}"
        );
    }

    /// The message is read by someone whose ffmpeg works in Terminal. If it only said "not
    /// found" they would reinstall a working ffmpeg and still be stuck.
    #[test]
    fn the_message_explains_why_a_working_ffmpeg_was_invisible() {
        let error = resolve_with(Tool::Ffmpeg, &env(&[]), None, None, &present(&[]))
            .expect_err("nothing installed");
        if cfg!(target_os = "macos") {
            assert!(
                error.detail().contains("Finder"),
                "the macOS message must name the actual cause: {}",
                error.detail()
            );
        }
    }

    /// User-writable directories that are not on the default PATH are deliberately excluded: a
    /// vendored shim landing there would be executed by bay with bay's identity while the
    /// user's own shell kept using a different binary.
    #[test]
    fn user_local_bin_is_not_searched() {
        let home_shim = format!(
            "{}/.local/bin/ffmpeg",
            crate::home().unwrap_or_default().display()
        );
        let error = resolve_with(
            Tool::Ffmpeg,
            &env(&[("PATH", LAUNCHD_PATH)]),
            None,
            None,
            &present(&[&home_shim]),
        );
        assert!(
            error.is_err(),
            "~/.local/bin must not be searched implicitly"
        );
    }

    #[test]
    fn a_reported_path_is_shortened_so_a_message_does_not_spell_out_an_account_name() {
        let Some(home) = crate::home() else { return };
        assert_eq!(tilde(&home.join("x")), "~/x");
    }

    /// Every tool resolves through the same rules, so a new one cannot quietly skip a tier.
    #[test]
    fn both_tools_resolve_by_the_same_rules() {
        for tool in Tool::all() {
            let binary = format!("/opt/homebrew/bin/{}", tool.binary());
            let found = resolve_with(
                tool,
                &env(&[("PATH", LAUNCHD_PATH)]),
                None,
                None,
                &present(&[&binary]),
            )
            .unwrap_or_else(|_| panic!("{tool} should resolve"));
            assert_eq!(found.path, PathBuf::from(&binary));
        }
    }
}
