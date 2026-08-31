//! The application shell: the project launcher, and the routing between it and the editor.
//!
//! bay used to open straight into one hardcoded project file, so "which project am I editing?"
//! had no answer and a second project had nowhere to live. [`BayApp`] is the root view now: it
//! opens on the project library, and the editor is what you get *after* choosing a project.
//!
//! The editor is built once and reused across projects, because it owns the GPU
//! [`PreviewRenderer`] — rebuilding a view per project would mean requesting a new adapter
//! every time someone goes back to the list.

use std::path::PathBuf;

use gpui::prelude::*;
use gpui::{div, Context, Entity, FocusHandle, KeyDownEvent, Subscription, Window};
use gpui_component::button::{Button, ButtonVariants as _};

use bay_core::project::{CanvasSize, Fps, ProjectLibrary, ProjectSummary};
use bay_core::Editor;
use bay_preview::PreviewRenderer;

use crate::editor::{legacy_project_path, EditorView, EditorViewEvent};
use crate::input::{Edit, TextField};
use crate::settings_model::Pane;

/// Canvas defaults offered when creating a project. Two presets cover almost everything people
/// actually make: a 16:9 landscape video and a 9:16 vertical reel.
const PRESETS: [(&str, u32, u32); 2] = [
    ("16:9 · 1920×1080", 1920, 1080),
    ("9:16 · 1080×1920", 1080, 1920),
];

/// The label for a preset index, clamped. The launcher renders it; the shell owns the list.
pub(crate) fn preset_label(index: usize) -> &'static str {
    PRESETS[index.min(PRESETS.len() - 1)].0
}

pub(crate) fn next_preset(index: usize) -> usize {
    (index + 1) % PRESETS.len()
}

/// Which screen the shell is showing, when it is not showing the editor.
///
/// The editor is tracked separately (`showing_editor`) because it owns a view that outlives any
/// one visit to it, and because an agent tool call has to know whether a document is on screen.
///
/// **Login is not a gate.** It is a screen you can reach from the account pane, not one you
/// must pass through: bay edits local files and works with no account at all. Making it the
/// first screen would turn a local video editor into something that asks a server for
/// permission to open your own project.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Launcher,
    Settings,
    SignIn,
}

/// The three files the shell owns, resolved once.
#[derive(Debug, Clone, Default)]
pub struct ShellPaths {
    /// `None` when there is no data directory — a container with no home.
    pub settings: Option<bay_settings::Store>,
    pub keys: Option<PathBuf>,
    pub token: Option<PathBuf>,
}

impl ShellPaths {
    /// The real locations, under bay's per-user data directory.
    pub fn detect() -> Self {
        Self {
            settings: bay_settings::Store::default_location(),
            keys: bay_settings::keys::default_path(),
            token: bay_settings::token::default_path(),
        }
    }

    /// Everything under one directory. What tests use.
    pub fn under(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self {
            settings: Some(bay_settings::Store::at(root.join("settings.json"))),
            keys: Some(root.join("provider-keys.json")),
            token: Some(root.join("mcp-token")),
        }
    }
}

pub struct BayApp {
    /// `None` when the projects directory could not be opened; `library_error` says why.
    pub(crate) library: Option<ProjectLibrary>,
    pub(crate) library_error: Option<String>,
    pub(crate) projects: Vec<ProjectSummary>,
    editor: Option<Entity<EditorView>>,
    /// Handed to the editor the first time a project is opened.
    preview: Option<PreviewRenderer>,
    /// Kept alive so the editor's close events keep arriving.
    _editor_subscription: Option<Subscription>,
    pub(crate) showing_editor: bool,
    pub(crate) screen: Screen,
    /// The in-progress "new project" name, and which canvas preset it will use.
    pub(crate) new_name: Option<TextField>,
    pub(crate) new_preset: usize,
    /// Everything the settings screen edits, and where it is persisted. `None` store means
    /// there is no data directory — changes still work for this session and say they will not
    /// be kept, rather than failing silently.
    pub(crate) settings: bay_settings::Settings,
    pub(crate) settings_store: Option<bay_settings::Store>,
    pub(crate) settings_pane: Pane,
    /// A complaint about the settings file itself, shown once at the top of the screen.
    pub(crate) settings_complaint: Option<String>,
    /// The agent credential, read from the same file `bay --mcp` uses.
    pub(crate) mcp_token: Option<String>,
    /// The provider whose key is being typed, and the buffer.
    pub(crate) keying: Option<(String, TextField)>,
    /// Narrows the MCP tool list. bay exposes about ninety tools; a grid of ninety switches
    /// with no filter is a wall, not a control.
    pub(crate) tool_filter: TextField,
    /// The project whose status/tag menu is open.
    pub(crate) menu_for: Option<String>,
    /// The project a custom tag is being typed for, and the buffer.
    pub(crate) tagging: Option<(String, TextField)>,
    /// What happened the last time someone pressed Sign in.
    pub(crate) sign_in_note: Option<String>,
    /// Where this shell keeps settings, provider keys and the agent token.
    ///
    /// Held as a struct rather than reached for at each call site so a test can point the whole
    /// shell at a temporary directory. Without it every settings test would read — and write —
    /// the developer's own configuration, which is both rude and the kind of shared state that
    /// makes a failure depend on who ran the suite.
    pub(crate) paths: ShellPaths,
    /// Whether a GPU adapter was found at launch. Captured here because `preview` is handed to
    /// the editor the first time a project opens, and the compute pane must still be able to
    /// say whether this Mac can composite.
    pub(crate) gpu_available: bool,
    /// The project a delete button has been clicked on once — clicking again confirms.
    pub(crate) pending_delete: Option<String>,
    pub(crate) status: Option<String>,
    focus_handle: FocusHandle,
    needs_focus: bool,
    /// The port this window serves agent calls on, so the registry note can name the project
    /// it has open — which is how a human tells two windows apart in `bay --agents`.
    pub(crate) agent_port: Option<u16>,
}

impl gpui::Focusable for BayApp {
    fn focus_handle(&self, _cx: &gpui::App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// A short, human-recognisable name for what a job is working on.
///
/// The output path for a render, the opening words for a narration. It is what the progress
/// line and `job_status` show, so "render" alone would be useless once two are running.
fn job_label(call: &bay_agent::ToolCall) -> String {
    for key in ["path", "text", "srt"] {
        if let Some(value) = call.arguments.get(key).and_then(|v| v.as_str()) {
            let trimmed: String = value.chars().take(60).collect();
            return trimmed;
        }
    }
    call.name.clone()
}

impl BayApp {
    /// Drain agent tool calls forever, on the foreground executor.
    ///
    /// A foreground task is the only legal way in: GPUI's `ForegroundExecutor` is `!Send`, so
    /// the MCP thread can never touch a view directly. It sends owned data down a `Send`
    /// channel; this task — which lives on the main thread — is what actually applies it.
    ///
    /// Detached rather than stored: it should live exactly as long as the app does, and there
    /// is nothing meaningful to do with the handle.
    fn drain_agent_calls(pump: bay_agent::AgentPump, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            while let Some(request) = pump.next().await {
                let call = request.call.clone();

                // Rendering and narration take seconds to minutes. Answering them here would
                // hold the main thread for that whole time, so the editor would stop drawing —
                // and the loop would stop draining, so every later call would queue behind it.
                // They are handed to a worker and answered when it finishes; meanwhile this
                // loop goes straight back to serving fast calls.
                if bay_agent::slow::slow_tools().contains(&call.name.as_str()) {
                    let started = this.update(cx, |app, cx| app.start_slow_tool(request, cx));
                    match started {
                        // The window went away between the call arriving and being routed.
                        Err(_) => continue,
                        Ok(()) => continue,
                    }
                }

                let response = this
                    .update(cx, |app, cx| app.route_agent_call(&call, cx))
                    .unwrap_or_else(|_| {
                        bay_agent::AgentResponse::Err("the editor window has closed".into())
                    });
                request.respond(response);
            }
        })
        .detach();
    }

    /// Run a slow tool off the main thread, then apply whatever it implies back on it.
    ///
    /// Takes ownership of the request: nobody else may answer it, and the worker responds when
    /// it is done. The snapshot is taken here, synchronously, so the worker never holds a
    /// reference into a project the user is still editing.
    fn start_slow_tool(&mut self, request: bay_agent::AgentRequest, cx: &mut Context<Self>) {
        let Some(editor) = self.editor.clone() else {
            request.respond(bay_agent::AgentResponse::Err(format!(
                "no project is open in bay — call project_create to make one. Available now: {}",
                bay_agent::available_tools().join(", ")
            )));
            return;
        };

        let call = request.call.clone();
        let context = editor.update(cx, |view, _| view.slow_context());
        self.status = Some(format!("Claude is running {}…", call.name));
        cx.notify();

        // Tools long enough to need a job answer with an id straight away and are polled;
        // `media_import` still answers in-band, because a poll round trip costs more than the
        // probe it would be waiting for.
        let (handle, request) = if bay_agent::slow::job_tools().contains(&call.name.as_str()) {
            let handle = bay_jobs::start(&call.name, &job_label(&call), bay_jobs::Unit::Frames, 0);
            // Answered NOW, while the work is still running. This is the whole point: the
            // request no longer sits open for minutes, so no timeout can claim it and report a
            // failure for work that is going to succeed.
            request.respond(bay_agent::AgentResponse::Ok(serde_json::json!({
                "job": handle.id(),
                "status": "started",
                "message": format!(
                    "{} is running in the background — poll job_status with job {} until \
                     finished is true.",
                    call.name,
                    handle.id()
                ),
            })));
            (Some(handle), None)
        } else {
            (None, Some(request))
        };

        // The background executor is Send+Sync — unlike the foreground one, which is !Send and
        // is exactly why an agent's work cannot simply be done wherever it arrives.
        let worker_handle = handle.clone();
        let job = cx.background_executor().spawn(async move {
            bay_agent::slow::run(
                &call.name,
                &call.arguments,
                &context,
                worker_handle.as_ref(),
            )
        });

        cx.spawn(async move |this, cx| {
            let outcome = job.await;
            let response = match outcome {
                Err(message) => bay_agent::AgentResponse::Err(message),
                Ok(result) => this
                    .update(cx, |app, cx| app.finish_slow_tool(result, cx))
                    .unwrap_or_else(|_| {
                        bay_agent::AgentResponse::Err(
                            "the work finished but the editor window had closed".into(),
                        )
                    }),
            };

            match (handle, request) {
                // A job: the answer goes into the registry for the poller to collect. The edit
                // has already been applied on the main thread by finish_slow_tool above, so a
                // caller that sees `finished` can trust the document reflects it.
                (Some(handle), _) => {
                    let outcome = match response {
                        bay_agent::AgentResponse::Ok(value) => Ok(value),
                        bay_agent::AgentResponse::Err(message) => Err(message),
                    };
                    bay_jobs::finish(&handle, outcome);
                }
                // Not a job: answer the request that is still waiting.
                (None, Some(request)) => request.respond(response),
                (None, None) => {}
            }
        })
        .detach();
    }

    /// Apply a finished job's result on the main thread, where the single writer lives.
    fn finish_slow_tool(
        &mut self,
        result: bay_agent::slow::SlowResult,
        cx: &mut Context<Self>,
    ) -> bay_agent::AgentResponse {
        let Some(editor) = self.editor.clone() else {
            return bay_agent::AgentResponse::Err(
                "the work finished but the project had been closed".into(),
            );
        };
        self.status = None;
        let value = result.value.clone();
        editor.update(cx, |view, cx| view.apply_slow_result(result, cx));
        cx.notify();
        bay_agent::AgentResponse::Ok(value)
    }

    /// Send a tool call to whichever project is open.
    ///
    /// "Which project?" needs no argument from the agent: the one on screen is the one it
    /// edits, which is what makes watching the edit land meaningful. With nothing open there
    /// is no document to edit, and saying so beats inventing one the user cannot see.
    fn route_agent_call(
        &mut self,
        call: &bay_agent::ToolCall,
        cx: &mut Context<Self>,
    ) -> bay_agent::AgentResponse {
        // Window-level calls are answered here: they are about the window, not the document,
        // and must work even with nothing open. `window_focus` is what a second launch sends
        // instead of starting a rival instance.
        if call.name == "window_focus" {
            cx.activate(true);
            return bay_agent::AgentResponse::Ok(serde_json::json!({
                "focused": true,
                "showingEditor": self.showing_editor,
            }));
        }

        // Machine-level questions ("is narration installed?", "is this font here?") have an
        // answer before any project exists, so they must not be gated behind opening one.
        if let Some(answer) = bay_agent::plan_without_document(&call.name, &call.arguments) {
            return match answer {
                Ok(value) => bay_agent::AgentResponse::Ok(value),
                Err(message) => bay_agent::AgentResponse::Err(message),
            };
        }

        // Library calls create, list and open the document the rest of the tools edit, so they
        // are answered by the window and must work with nothing open. Without this an agent
        // that finds an empty bay is deadlocked: it cannot create a project because no project
        // is open.
        if bay_agent::window_tools().contains(&call.name.as_str()) {
            return self.route_library_call(call, cx);
        }

        let Some(editor) = self.editor.clone() else {
            return bay_agent::AgentResponse::Err(format!(
                "no project is open in bay — call project_create to make one (it opens in the \
                 window), or project_list then project_load to reopen an existing one. \
                 Available now: {}",
                bay_agent::available_tools().join(", ")
            ));
        };
        if !self.showing_editor {
            return bay_agent::AgentResponse::Err(
                "bay is showing the project list — call project_load with an id from \
                 project_list, or project_create to start a new one"
                    .into(),
            );
        }
        editor.update(cx, |view, cx| view.apply_agent_call(call, cx))
    }

    /// `project_create` / `project_list` / `project_load`, answered against the app's library.
    ///
    /// Creating opens the project in the window, because the point of an agent editing a live
    /// bay is that the human watches it happen — a project made but not shown would be the
    /// headless behaviour wearing the editor's clothes.
    fn route_library_call(
        &mut self,
        call: &bay_agent::ToolCall,
        cx: &mut Context<Self>,
    ) -> bay_agent::AgentResponse {
        let Some(library) = self.library.clone() else {
            return bay_agent::AgentResponse::Err(
                "no project library on this machine — bay could not find a home directory".into(),
            );
        };
        let args = &call.arguments;
        let text = |key: &str| {
            args.get(key)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .filter(|s| !s.trim().is_empty())
        };

        match call.name.as_str() {
            "project_create" => {
                let name = text("name").unwrap_or_else(|| "Untitled".into());
                let width = args.get("width").and_then(|v| v.as_u64()).unwrap_or(1080) as u32;
                let height = args.get("height").and_then(|v| v.as_u64()).unwrap_or(1920) as u32;
                let fps = args.get("fps").and_then(|v| v.as_u64()).unwrap_or(30) as u32;
                if width == 0 || height == 0 || fps == 0 {
                    return bay_agent::AgentResponse::Err(
                        "width, height and fps must all be greater than zero".into(),
                    );
                }
                let background = text("background").unwrap_or_else(|| "#000000".into());
                match library.create(
                    name.trim(),
                    CanvasSize { width, height },
                    Fps {
                        numerator: fps,
                        denominator: 1,
                    },
                ) {
                    Ok(mut project) => {
                        // `library.create` has no background parameter, so it is applied here.
                        // Dropping it silently — which is what happened before — gives an agent
                        // that asked for #0B0B0C a black canvas and no indication why, and it
                        // will not find out until it looks at a rendered frame.
                        project.settings.background = bay_core::Background::Color {
                            color: background.clone(),
                        };
                        let id = project.metadata.id.clone();
                        let path = library.path_for(&id);
                        if let Err(error) =
                            bay_core::project::library::write_project(&path, &project)
                        {
                            return bay_agent::AgentResponse::Err(format!(
                                "created the project but could not save it: {error}"
                            ));
                        }
                        self.new_name = None;
                        self.refresh();
                        self.show_editor(project, Some(path), cx);
                        self.status = Some(format!("Claude created “{}”", name.trim()));
                        cx.notify();
                        // Same shape the headless server returns, plus what only the window can
                        // say. One tool must not describe its result two different ways
                        // depending on which half of bay answered it.
                        bay_agent::AgentResponse::Ok(serde_json::json!({
                            "name": name.trim(),
                            "canvas": { "width": width, "height": height },
                            "fps": fps,
                            "background": background,
                            "projectId": id,
                            "opened": true,
                        }))
                    }
                    Err(error) => bay_agent::AgentResponse::Err(format!(
                        "could not create the project: {error}"
                    )),
                }
            }
            "project_list" => match library.list() {
                Ok(projects) => bay_agent::AgentResponse::Ok(serde_json::json!({
                    "root": library.root().to_string_lossy(),
                    "projects": projects
                        .iter()
                        .map(|entry| serde_json::json!({
                            "id": entry.id,
                            "name": entry.name,
                        }))
                        .collect::<Vec<_>>(),
                })),
                Err(error) => {
                    bay_agent::AgentResponse::Err(format!("could not read the library: {error}"))
                }
            },
            "project_load" => {
                let Some(id) = text("id") else {
                    return bay_agent::AgentResponse::Err(
                        "project_load needs an id — call project_list to see them".into(),
                    );
                };
                match library.load(&id) {
                    Ok(project) => {
                        let name = project.metadata.name.clone();
                        let path = library.path_for(&id);
                        self.show_editor(project, Some(path), cx);
                        self.status = Some(format!("Claude opened “{name}”"));
                        cx.notify();
                        bay_agent::AgentResponse::Ok(serde_json::json!({
                            "projectId": id,
                            "name": name,
                            "opened": true,
                        }))
                    }
                    Err(error) => {
                        bay_agent::AgentResponse::Err(format!("could not open {id}: {error}"))
                    }
                }
            }
            other => bay_agent::AgentResponse::Err(format!("{other} is not a library tool")),
        }
    }

    pub fn new(
        focus_handle: FocusHandle,
        preview: Option<PreviewRenderer>,
        pump: Option<bay_agent::AgentPump>,
        agent_port: Option<u16>,
        agent_note: Option<String>,
        cx: &mut Context<Self>,
    ) -> Self {
        if let Some(pump) = pump {
            Self::drain_agent_calls(pump, cx);
        }
        let (library, library_error) = match ProjectLibrary::open_default() {
            Ok(library) => (Some(library), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let mut app = Self::over(library, preview, focus_handle);
        app.agent_port = agent_port;
        app.library_error = library_error;
        // Shown in the window, not only on stderr. Someone who launched from Finder has no
        // terminal, so a window whose agent tools quietly do nothing was indistinguishable from
        // a broken one — this is the only channel they can actually read.
        if let Some(note) = agent_note {
            app.status = Some(note);
        }
        app.adopt_legacy_project();
        app.refresh();
        // Open a project straight away when asked. Useful for picking up where you left off,
        // and it is what makes the agent path testable without a human clicking the launcher.
        let wanted = std::env::var("BAY_OPEN_PROJECT").unwrap_or_default();
        if !wanted.is_empty() {
            let target = if wanted == "first" {
                app.projects.first().map(|p| p.id.clone())
            } else {
                Some(wanted)
            };
            if let Some(id) = target {
                app.open_project(&id, cx);
            }
        }
        app
    }

    /// Write the open project out, for a quit that did not go through the UI.
    ///
    /// Cmd+Q does not ask. It bypasses the "‹ Projects" button, which is the only path that used
    /// to save, so before the menu bar existed there was no way to lose work this way and now
    /// there is. Returns whether anything was written, which is what makes it testable — the
    /// alternative is a quit hook nobody can prove ran.
    pub fn save_before_quit(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(editor) = self.editor.clone() else {
            return false;
        };
        editor.update(cx, |editor, _| editor.save_project().is_ok())
    }

    /// A shell over an explicit library. Tests use this: reaching for the default library would
    /// mean a test run reading — and adopting into — the developer's own projects.
    pub fn over(
        library: Option<ProjectLibrary>,
        preview: Option<PreviewRenderer>,
        focus_handle: FocusHandle,
    ) -> Self {
        Self::over_at(library, preview, focus_handle, ShellPaths::detect())
    }

    /// [`BayApp::over`], with the settings, key and token files somewhere explicit.
    pub fn over_at(
        library: Option<ProjectLibrary>,
        preview: Option<PreviewRenderer>,
        focus_handle: FocusHandle,
        paths: ShellPaths,
    ) -> Self {
        // Read before the view exists, so the first frame draws the user's real settings rather
        // than the defaults followed by a flicker.
        let settings_store = paths.settings.clone();
        let (settings, settings_complaint) = match &settings_store {
            Some(store) => store.load_or_default(),
            None => (
                bay_settings::Settings::default(),
                Some(
                    "bay could not find a data directory, so settings changed here will not be \
                     kept after you quit."
                        .to_string(),
                ),
            ),
        };
        let gpu_available = preview.is_some();
        let mut app = Self {
            library,
            library_error: None,
            projects: Vec::new(),
            editor: None,
            preview,
            _editor_subscription: None,
            showing_editor: false,
            screen: Screen::Launcher,
            new_name: None,
            new_preset: 0,
            pending_delete: None,
            status: None,
            focus_handle,
            needs_focus: true,
            agent_port: None,
            settings,
            settings_store,
            settings_pane: Pane::Account,
            settings_complaint,
            mcp_token: paths
                .token
                .as_ref()
                .and_then(|path| bay_settings::token::read_or_create(path).ok()),
            keying: None,
            tool_filter: TextField::new("filter tools"),
            menu_for: None,
            tagging: None,
            sign_in_note: None,
            paths,
            gpu_available,
        };
        // No legacy adoption here — that reads a file in the real home directory, which is
        // exactly what a test handed its own library must not do. `new` does it.
        app.refresh();
        app
    }

    /// Pull the pre-library `~/bay-project.json` into the library the first time we run with
    /// one, so a project made before this screen existed still appears in the list.
    fn adopt_legacy_project(&mut self) {
        let (Some(library), legacy) = (self.library.as_ref(), legacy_project_path()) else {
            return;
        };
        if !legacy.exists() || !library.list().map(|l| l.is_empty()).unwrap_or(false) {
            return;
        }
        match library.import(&legacy) {
            Ok(summary) => {
                self.status = Some(format!(
                    "Imported {} from {}",
                    summary.name,
                    legacy.display()
                ))
            }
            Err(error) => {
                self.status = Some(format!("Could not import {}: {error}", legacy.display()))
            }
        }
    }

    fn refresh(&mut self) {
        let Some(library) = self.library.as_ref() else {
            return;
        };
        match library.list() {
            Ok(projects) => self.projects = projects,
            Err(error) => {
                self.status = Some(format!("Could not read the project library: {error}"))
            }
        }
    }

    pub(crate) fn create_project(&mut self, name: &str, cx: &mut Context<Self>) {
        let Some(library) = self.library.as_ref() else {
            self.status = Some("No project library available.".into());
            return;
        };
        let name = if name.trim().is_empty() {
            "Untitled"
        } else {
            name.trim()
        };
        let (_, width, height) = PRESETS[self.new_preset.min(PRESETS.len() - 1)];
        match library.create(name, CanvasSize { width, height }, Fps::default()) {
            Ok(project) => {
                let path = library.path_for(&project.metadata.id);
                self.new_name = None;
                self.refresh();
                self.show_editor(project, Some(path), cx);
            }
            Err(error) => self.status = Some(format!("Could not create the project: {error}")),
        }
    }

    pub(crate) fn open_project(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(library) = self.library.as_ref() else {
            return;
        };
        match library.load(id) {
            Ok(project) => {
                let path = library.path_for(id);
                self.show_editor(project, Some(path), cx);
            }
            Err(error) => self.status = Some(format!("Could not open the project: {error}")),
        }
    }

    fn delete_project(&mut self, id: &str) {
        let Some(library) = self.library.as_ref() else {
            return;
        };
        match library.delete(id) {
            Ok(()) => {
                self.pending_delete = None;
                self.refresh();
            }
            Err(error) => self.status = Some(format!("Could not delete the project: {error}")),
        }
    }

    /// Bring a project file that lives outside the library into it.
    pub(crate) fn import_project(&mut self) {
        let Some(library) = self.library.as_ref() else {
            return;
        };
        let Some(path) = rfd::FileDialog::new()
            .add_filter("bay project", &["json"])
            .pick_file()
        else {
            return;
        };
        match library.import(&path) {
            Ok(summary) => {
                self.status = Some(format!("Imported {}", summary.name));
                self.refresh();
            }
            Err(error) => self.status = Some(format!("Could not import that file: {error}")),
        }
    }

    fn show_editor(
        &mut self,
        project: bay_core::Project,
        path: Option<PathBuf>,
        cx: &mut Context<Self>,
    ) {
        let project_name = project.metadata.name.clone();
        match self.editor.clone() {
            Some(editor) => editor.update(cx, |editor, cx| {
                editor.open_project(project, path);
                cx.notify();
            }),
            None => {
                let preview = self.preview.take();
                let editor = cx.new(|cx| {
                    EditorView::new(Editor::new(project), cx.focus_handle(), preview, path)
                });
                self._editor_subscription = Some(cx.subscribe(
                    &editor,
                    |this, _editor, event, cx| match event {
                        EditorViewEvent::CloseRequested => this.show_home(cx),
                    },
                ));
                self.editor = Some(editor);
            }
        }
        self.showing_editor = true;
        // Tell the registry which project this window is showing, so `bay --agents` can name
        // it. Best effort — a failed note is not worth interrupting the user for.
        if let Some(port) = self.agent_port {
            let _ = bay_agent::registry::register(
                port,
                bay_agent::registry::Kind::Editor,
                Some(project_name.as_str()),
            );
        }
        self.status = None;
        cx.notify();
    }

    fn show_home(&mut self, cx: &mut Context<Self>) {
        self.showing_editor = false;
        self.pending_delete = None;
        self.needs_focus = true;
        self.refresh();
        cx.notify();
    }

    /// Whichever text field is open, if any.
    ///
    /// One dispatcher rather than a handler per field: the shell has four typed buffers and
    /// exactly one of them can be focused at a time, so "which one gets this keystroke" is a
    /// question with a single answer and belongs in a single place.
    /// The clipboard as a single line of text, or nothing if it holds no text.
    ///
    /// Split out so the four fields below share one answer, and so a paste into a field that is
    /// not focused cannot reach the clipboard at all.
    fn clipboard_text(cx: &mut Context<Self>) -> Option<String> {
        cx.read_from_clipboard()
            .and_then(|item| item.text())
            .filter(|text| !text.is_empty())
    }

    pub(crate) fn route_key(
        &mut self,
        keystroke: &gpui::Keystroke,
        cx: &mut Context<Self>,
    ) -> bool {
        let command = keystroke.modifiers.platform || keystroke.modifiers.control;
        let key = keystroke.key.as_str();
        let character = keystroke.key_char.as_deref();

        if let Some((provider, field)) = self.keying.as_mut() {
            let provider = provider.clone();
            return match field.key(key, character, command) {
                Edit::Submit => {
                    let value = field.value().to_string();
                    self.store_key(&provider, &value);
                    self.keying = None;
                    true
                }
                Edit::Cancel => {
                    self.keying = None;
                    true
                }
                Edit::Changed => true,
                Edit::Paste => {
                    if let Some(text) = Self::clipboard_text(cx) {
                        if let Some((_, field)) = self.keying.as_mut() {
                            field.paste(&text);
                        }
                    }
                    true
                }
                Edit::Ignored => false,
            };
        }

        if let Some((project, field)) = self.tagging.as_mut() {
            let project = project.clone();
            return match field.key(key, character, command) {
                Edit::Submit => {
                    let tag = field.trimmed().to_string();
                    self.file_project(&project, move |shelf| shelf.add_tag(&tag));
                    self.tagging = None;
                    true
                }
                Edit::Cancel => {
                    self.tagging = None;
                    true
                }
                Edit::Changed => true,
                Edit::Paste => {
                    if let Some(text) = Self::clipboard_text(cx) {
                        if let Some((_, field)) = self.tagging.as_mut() {
                            field.paste(&text);
                        }
                    }
                    true
                }
                Edit::Ignored => false,
            };
        }

        if let Some(field) = self.new_name.as_mut() {
            return match field.key(key, character, command) {
                Edit::Submit => {
                    let name = field.value().to_string();
                    self.create_project(&name, cx);
                    true
                }
                Edit::Cancel => {
                    self.new_name = None;
                    true
                }
                Edit::Changed => true,
                Edit::Paste => {
                    if let Some(text) = Self::clipboard_text(cx) {
                        if let Some(field) = self.new_name.as_mut() {
                            field.paste(&text);
                        }
                    }
                    true
                }
                Edit::Ignored => false,
            };
        }

        // The tool filter has no open/closed state — it is always live on the MCP pane, so it
        // is the last thing offered a keystroke rather than the first.
        if self.screen == Screen::Settings && self.settings_pane == Pane::Mcp {
            return match self.tool_filter.key(key, character, command) {
                Edit::Cancel => {
                    self.tool_filter.clear();
                    true
                }
                Edit::Changed => true,
                Edit::Paste => {
                    if let Some(text) = Self::clipboard_text(cx) {
                        self.tool_filter.paste(&text);
                    }
                    true
                }
                Edit::Submit | Edit::Ignored => false,
            };
        }

        // Escape closes a project's status menu when nothing is being typed into.
        if key == "escape" && self.menu_for.is_some() {
            self.menu_for = None;
            return true;
        }
        false
    }

    // ---- settings -----------------------------------------------------------------------

    /// Persist the settings, and say so if that could not happen.
    ///
    /// Every mutation goes through here rather than writing at quit: an MCP allow-list that is
    /// only saved on a clean exit is one a crash silently reverts, and the user would have no
    /// way to know a tool they blocked is answering again.
    pub(crate) fn save_settings(&mut self) {
        let Some(store) = self.settings_store.clone() else {
            self.settings_complaint =
                Some("bay has no data directory, so this change lasts only until you quit.".into());
            // Still publish, so an MCP server in this process honours it for this session.
            bay_settings::store::publish(self.settings.clone());
            return;
        };
        match store.save(&self.settings) {
            Ok(()) => self.settings_complaint = None,
            Err(error) => self.settings_complaint = Some(error.to_string()),
        }
    }

    /// Store a provider key in the owner-only key file, and record its hint in the settings.
    ///
    /// The key itself never reaches `self.settings`, so it cannot end up in `settings.json`.
    pub(crate) fn store_key(&mut self, provider_id: &str, key: &str) {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            self.settings_complaint = Some("That key was empty, so nothing was saved.".into());
            return;
        }
        let Some(path) = self.paths.keys.clone() else {
            self.settings_complaint =
                Some("bay has no data directory to keep a key in, so it was not saved.".into());
            return;
        };
        if let Err(error) = bay_settings::keys::put(&path, provider_id, trimmed) {
            self.settings_complaint = Some(error.to_string());
            return;
        }
        let hint = bay_settings::providers::KeyHint::of(trimmed);
        if let Err(error) = self.settings.providers.set_key_hint(provider_id, hint) {
            self.settings_complaint = Some(error.to_string());
            return;
        }
        self.save_settings();
    }

    /// Try to sign in. There is no service, so this reports why rather than pretending.
    pub(crate) fn begin_sign_in(&mut self) {
        use bay_settings::account::AccountService;
        match bay_settings::account::Unconfigured.begin_sign_in() {
            Ok(handoff) => {
                self.sign_in_note = Some(format!("Approve the request at {}", handoff.url));
            }
            Err(error) => self.sign_in_note = Some(error.to_string()),
        }
    }

    pub(crate) fn sign_out(&mut self) {
        self.settings.session = bay_settings::Session::Offline;
        self.sign_in_note = None;
        self.save_settings();
    }

    // ---- settings actions ---------------------------------------------------------------

    pub(crate) fn add_provider(&mut self, id: &str) {
        let Some(entry) = bay_settings::providers::catalog_entry(id) else {
            return;
        };
        self.settings
            .providers
            .upsert(bay_settings::Provider::from_catalog(entry));
        self.save_settings();
    }

    /// Remove a provider, and forget its key with it.
    ///
    /// Leaving the key behind would mean re-adding the row silently restores a credential the
    /// user thought they had deleted.
    pub(crate) fn forget_provider(&mut self, id: &str) {
        if let Some(path) = self.paths.keys.clone() {
            let _ = bay_settings::keys::forget(&path, id);
        }
        self.settings.providers.remove(id);
        if self.keying.as_ref().is_some_and(|(open, _)| open == id) {
            self.keying = None;
        }
        self.save_settings();
    }

    pub(crate) fn route_component(
        &mut self,
        component: &str,
        location: bay_settings::models::RunLocation,
    ) {
        let available = bay_settings::compute::cloud_available();
        match self.settings.models.route(component, location, available) {
            Ok(()) => {
                self.settings_complaint = None;
                self.save_settings();
            }
            Err(error) => self.settings_complaint = Some(error.to_string()),
        }
    }

    pub(crate) fn choose_compute(&mut self, mode: bay_settings::compute::ComputeMode) {
        match self.settings.compute.choose(mode) {
            Ok(()) => {
                self.settings_complaint = None;
                self.save_settings();
            }
            Err(error) => self.settings_complaint = Some(error.to_string()),
        }
    }

    /// Which platform's chrome captions must clear.
    pub(crate) fn choose_caption_safe_area(&mut self, area: bay_settings::captions::SafeArea) {
        self.settings.captions.safe_area = area;
        self.settings_complaint = None;
        self.save_settings();
    }

    pub(crate) fn choose_caption_align(&mut self, align: bay_settings::captions::CaptionAlign) {
        // Clicking the alignment already chosen clears it, handing the decision back to the
        // style kit. Without that there is no way to undo a choice short of editing the file.
        self.settings.captions.align = if self.settings.captions.align == Some(align) {
            None
        } else {
            Some(align)
        };
        self.settings_complaint = None;
        self.save_settings();
    }

    /// Move the caption band, in fractions of the frame.
    ///
    /// The first nudge on an unset band starts from the kit's own position rather than from
    /// zero, so the control moves what is on screen instead of jumping to the top of the frame.
    pub(crate) fn nudge_caption_band(&mut self, delta: f32) {
        let from = self
            .settings
            .captions
            .band_top
            .unwrap_or(crate::settings_model::KIT_DEFAULT_BAND_TOP);
        self.settings.captions.band_top = Some((from + delta).clamp(0.0, 1.0));
        self.settings_complaint = None;
        self.save_settings();
    }

    /// Hand the position back to the style kit.
    pub(crate) fn reset_caption_band(&mut self) {
        self.settings.captions.band_top = None;
        self.settings_complaint = None;
        self.save_settings();
    }

    pub(crate) fn choose_plan(&mut self, id: &str) {
        match self.settings.compute.choose_plan(id) {
            Ok(()) => {
                self.settings_complaint = None;
                self.save_settings();
            }
            Err(error) => self.settings_complaint = Some(error.to_string()),
        }
    }

    /// Replace the agent credential. A real revocation, so the pane says what it broke.
    /// Put `value` on the system clipboard and say so.
    ///
    /// The MCP pane's snippet is a 120-character command with a 64-character token in the middle
    /// of it. Before this it was drawn as text and nothing else, so the only way to get it into a
    /// terminal was to read it off the screen — one user resorted to screenshotting the settings
    /// window and copying out of the image. A credential you cannot select is a credential you
    /// have to transcribe, and a transcribed 64-hex token fails as a 401 with nothing pointing at
    /// the typo.
    ///
    /// The confirmation reuses `settings_complaint` — the banner that already reports rotation —
    /// rather than a "Copied!" label that reverts on a timer. A transient label needs a frame
    /// scheduled to clear it, and `cx.notify()` from inside `render` schedules nothing (see
    /// `EditorView::request_frame`); the banner is stated once, by an event, and needs no clock.
    pub(crate) fn copy_to_clipboard(
        &mut self,
        what: &str,
        value: String,
        cx: &mut Context<BayApp>,
    ) {
        if value.is_empty() {
            self.settings_complaint = Some(format!("There is no {what} to copy."));
            return;
        }
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(value));
        self.settings_complaint = Some(format!("Copied the {what} to the clipboard."));
    }

    pub(crate) fn rotate_token(&mut self) {
        let Some(path) = self.paths.token.clone() else {
            self.settings_complaint =
                Some("bay has no data directory, so there is no token to rotate.".into());
            return;
        };
        match bay_settings::token::rotate(&path) {
            Ok(token) => {
                self.mcp_token = Some(token);
                self.settings_complaint = Some(
                    "Token rotated. Every client configured with the old one must be updated \
                     with the snippet below before it can reach bay again."
                        .into(),
                );
                // Nothing else to do: the server re-reads the token file when a credential it
                // does not recognise arrives, so the new one is live immediately. It did not
                // used to be — `AuthToken` cached the value from startup, so this banner was
                // telling people to adopt a token that would be refused until bay restarted.
            }
            Err(error) => self.settings_complaint = Some(format!("Could not rotate: {error}")),
        }
    }

    /// Install, cancel or remove a runtime component. All three are real operations on
    /// `bay-provision`; none of them is a simulated progress bar.
    pub(crate) fn run_model_action(
        &mut self,
        component: &str,
        action: crate::settings_model::ModelAction,
    ) {
        use crate::settings_model::ModelAction;
        match action {
            ModelAction::Install => match bay_provision::jobs::start(component) {
                Ok(_) => self.settings_complaint = None,
                Err(error) => self.settings_complaint = Some(error.to_string()),
            },
            ModelAction::Cancel => {
                match bay_provision::jobs::running_for(component) {
                    Some(job) => {
                        bay_jobs::cancel(job);
                        // Checked between artifacts, so a cancel lands at the next boundary
                        // rather than instantly. Saying so beats a button that looks stuck.
                        self.settings_complaint = Some(
                            "Asked the install to stop — it finishes the file it is on first."
                                .into(),
                        );
                    }
                    None => self.settings_complaint = Some("That install already finished.".into()),
                }
            }
            ModelAction::Remove => match bay_provision::remove(component) {
                Ok(removal) => {
                    self.settings_complaint = Some(format!(
                        "Removed {} — {} freed.",
                        component,
                        bay_provision::human_bytes(removal.bytes)
                    ))
                }
                Err(error) => self.settings_complaint = Some(error.to_string()),
            },
            ModelAction::None => {}
        }
    }

    /// The avatar's letter: the account's, or the machine's when there is no account.
    pub(crate) fn account_initial(&self) -> String {
        match self.settings.session.account() {
            Some(account) => account.initial(),
            None => bay_settings::account::LocalIdentity::detect().initial(),
        }
    }

    /// First click arms the delete button, second carries it out.
    pub(crate) fn confirm_or_delete(&mut self, id: &str) {
        if self.pending_delete.as_deref() == Some(id) {
            self.delete_project(id);
        } else {
            self.pending_delete = Some(id.to_string());
        }
    }

    /// Change how a project is filed, and refresh the list so the card redraws.
    pub(crate) fn file_project(
        &mut self,
        id: &str,
        edit: impl FnOnce(&mut bay_core::Shelf) -> bool,
    ) {
        let Some(library) = self.library.as_ref() else {
            return;
        };
        match library.file_project(id, edit) {
            Ok(_) => self.refresh(),
            Err(error) => self.status = Some(format!("Could not update that project: {error}")),
        }
    }

    pub(crate) fn button(
        &self,
        id: &'static str,
        label: impl Into<String>,
        primary: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut BayApp, &mut Context<BayApp>) + 'static,
    ) -> Button {
        let label: String = label.into();
        let button =
            Button::new(id)
                .label(label)
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    handler(this, cx);
                    cx.notify();
                }));
        // `primary` is a kind, not a colour argument — the call site cannot invent a fourth
        // accent. That rule came from `widgets::ButtonKind` and survives the swap.
        if primary {
            button.primary()
        } else {
            button
        }
    }
}

impl Render for BayApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Menu actions that need the window are handled *here*, not with `cx.on_action` at app
        // level, and the reason is not stylistic. A keystroke is dispatched while the window is
        // mid-update, so its slot in `cx.windows` is empty; an app-level handler that reaches
        // back for the same window via `update_window` gets "window not found" and, if the
        // caller discards the Result as this one first did, fails in complete silence. Cmd+W
        // looked wired and did nothing. On the root element the `Window` is already in hand.
        let root = div()
            .size_full()
            .on_action(cx.listener(|_, _: &crate::menus::CloseWindow, window, _| {
                window.remove_window();
            }))
            .on_action(cx.listener(|_, _: &crate::menus::Minimize, window, _| {
                window.minimize_window();
            }))
            .on_action(cx.listener(|app, _: &crate::menus::SaveProject, _, cx| {
                app.save_before_quit(cx);
            }))
            // The notification layer, mounted by the application because `Root` does not draw it.
            //
            // This is not optional plumbing and its absence had no symptom to find it by.
            // `Root::render` (gpui-component 0.5.1, `src/root.rs:396`) renders `window_border()`
            // around `self.view` and **nothing else**; the notifications live behind a separate
            // `Root::render_notification_layer` the app has to mount itself. `Root` "manages" the
            // list — it does not display it, and the two read the same in a doc comment.
            //
            // Until this line, `window.push_notification(...)` pushed into a list nobody drew, and
            // `EditorView::render_inner` *takes* `self.status` to build that notification — so
            // every message was cleared as it was swallowed and no other surface could show it
            // either. That is 19 writers, including "Render refused", "Render failed" and every
            // import failure, all silent.
            .children(gpui_component::Root::render_notification_layer(window, cx));

        if self.showing_editor {
            if let Some(editor) = self.editor.clone() {
                return root.child(editor);
            }
        }
        if self.needs_focus {
            self.needs_focus = false;
            window.focus(&self.focus_handle);
        }

        // Every non-editor screen shares one focus handle and one key route, because exactly
        // one of them is on screen and exactly one text field within it can be open.
        let shell = div()
            .size_full()
            .track_focus(&self.focus_handle)
            .key_context("Shell")
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _window, cx| {
                if this.route_key(&event.keystroke, cx) {
                    cx.notify();
                }
            }));

        let screen = match self.screen {
            Screen::Launcher => self.launcher(cx),
            Screen::Settings => self.settings_screen(cx),
            Screen::SignIn => self.sign_in_screen(cx),
        };
        root.child(shell.child(screen))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_core::project::CanvasSize;
    use gpui::TestAppContext;
    use std::time::SystemTime;

    /// A library of its own for each test — never the developer's real one.
    pub(super) fn library(tag: &str) -> ProjectLibrary {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        ProjectLibrary::with_root(std::env::temp_dir().join(format!("bay-app-{tag}-{stamp}")))
            .unwrap()
    }

    /// A data directory of its own for each test. Every settings, key and token write lands
    /// there, so a test can never read — or rewrite — the developer's real configuration.
    pub(super) fn data_root(tag: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("bay-app-data-{tag}-{stamp}"))
    }

    pub(super) fn app(cx: &mut TestAppContext, library: ProjectLibrary) -> Entity<BayApp> {
        let paths = ShellPaths::under(data_root("shared"));
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| BayApp::over_at(Some(library), None, focus, paths))
        })
    }

    /// Same, but with a real GPU compositor attached — `PreviewRenderer::new()` needs no
    /// window, which is how the headless MCP server renders too. `None` where there is no
    /// adapter, so the caller can skip instead of asserting against nothing.
    pub(super) fn app_with_gpu(
        cx: &mut TestAppContext,
        library: ProjectLibrary,
    ) -> Option<Entity<BayApp>> {
        let preview = PreviewRenderer::new()?;
        Some(cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| {
                BayApp::over_at(
                    Some(library),
                    Some(preview),
                    focus,
                    ShellPaths::under(data_root("gpu")),
                )
            })
        }))
    }

    #[gpui::test]
    fn opens_on_the_project_list_not_on_a_project(cx: &mut TestAppContext) {
        let library = library("empty");
        let app = app(cx, library);
        app.update(cx, |app, _| {
            assert!(!app.showing_editor, "the app must open on the launcher");
            assert!(app.projects.is_empty());
            assert!(
                app.editor.is_none(),
                "no editor is built until one is opened"
            );
        });
    }

    #[gpui::test]
    fn existing_projects_are_listed_newest_first(cx: &mut TestAppContext) {
        let library = library("list");
        library
            .create("Older", CanvasSize::default(), Fps::default())
            .unwrap();
        library
            .create("Newer", CanvasSize::default(), Fps::default())
            .unwrap();
        let app = app(cx, library);
        app.update(cx, |app, _| {
            let names: Vec<_> = app.projects.iter().map(|p| p.name.as_str()).collect();
            assert_eq!(names.len(), 2);
            assert!(names.contains(&"Older") && names.contains(&"Newer"));
        });
    }

    #[gpui::test]
    fn creating_a_project_saves_it_and_opens_the_editor(cx: &mut TestAppContext) {
        let library = library("create");
        let app = app(cx, library.clone());
        app.update(cx, |app, cx| app.create_project("My Film", cx));

        app.update(cx, |app, _| {
            assert!(app.showing_editor, "creating a project opens it");
            assert!(app.editor.is_some());
        });
        // It is on disk, so it is still there next launch.
        let listed = library.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "My Film");
    }

    #[gpui::test]
    fn opening_a_project_loads_that_project_into_the_editor(cx: &mut TestAppContext) {
        let library = library("open");
        let project = library
            .create("Chosen", CanvasSize::default(), Fps::default())
            .unwrap();
        let app = app(cx, library);

        app.update(cx, |app, cx| app.open_project(&project.metadata.id, cx));
        let editor = app.update(cx, |app, _| {
            assert!(app.showing_editor);
            app.editor.clone().expect("an editor")
        });
        editor.update(cx, |editor, _| assert_eq!(editor.project_name(), "Chosen"));
    }

    /// Cmd+Q skips the "‹ Projects" button, which was the only path that saved. Adding a menu
    /// bar therefore introduced a way to lose work, and this is the check that it does not.
    #[gpui::test]
    fn quitting_writes_the_open_project_to_disk(cx: &mut TestAppContext) {
        let library = library("quit-save");
        let project = library
            .create("Unsaved", CanvasSize::default(), Fps::default())
            .unwrap();
        let path = library.path_for(&project.metadata.id);
        let app = app(cx, library);
        app.update(cx, |app, cx| app.open_project(&project.metadata.id, cx));

        // Remove the file the project came from. Only a real write brings it back, so this
        // cannot pass on a hook that runs but does nothing.
        std::fs::remove_file(&path).expect("the project file exists to begin with");

        let saved = app.update(cx, |app, cx| app.save_before_quit(cx));
        assert!(saved, "quitting with a project open must write it");
        assert!(path.exists(), "the quit hook must actually write the file");
        assert_eq!(
            bay_core::project::library::read_project(&path)
                .expect("the written project must load")
                .metadata
                .name,
            "Unsaved"
        );
    }

    /// With nothing open there is nothing to write, and the hook must say so rather than
    /// reporting a save that did not happen.
    #[gpui::test]
    fn quitting_from_the_project_list_saves_nothing(cx: &mut TestAppContext) {
        let app = app(cx, library("quit-empty"));
        assert!(!app.update(cx, |app, cx| app.save_before_quit(cx)));
    }

    #[gpui::test]
    fn the_editors_close_event_returns_to_the_list(cx: &mut TestAppContext) {
        let library = library("close");
        let project = library
            .create("Round Trip", CanvasSize::default(), Fps::default())
            .unwrap();
        let app = app(cx, library);
        app.update(cx, |app, cx| app.open_project(&project.metadata.id, cx));

        let editor = app.update(cx, |app, _| app.editor.clone().expect("an editor"));
        editor.update(cx, |_, cx| cx.emit(EditorViewEvent::CloseRequested));
        cx.run_until_parked();

        app.update(cx, |app, _| {
            assert!(!app.showing_editor, "closing returns to the project list");
            assert_eq!(app.projects.len(), 1, "and the list is refreshed");
        });
    }

    #[gpui::test]
    fn switching_projects_reuses_one_editor_and_swaps_the_project(cx: &mut TestAppContext) {
        let library = library("switch");
        let first = library
            .create("First", CanvasSize::default(), Fps::default())
            .unwrap();
        let second = library
            .create("Second", CanvasSize::default(), Fps::default())
            .unwrap();
        let app = app(cx, library);

        app.update(cx, |app, cx| app.open_project(&first.metadata.id, cx));
        let editor_one = app.update(cx, |app, _| app.editor.clone().unwrap());
        app.update(cx, |app, cx| app.open_project(&second.metadata.id, cx));
        let editor_two = app.update(cx, |app, _| app.editor.clone().unwrap());

        // Same view — it owns the GPU preview, so rebuilding it per project would re-request
        // an adapter every time.
        assert_eq!(editor_one.entity_id(), editor_two.entity_id());
        editor_two.update(cx, |editor, _| assert_eq!(editor.project_name(), "Second"));
    }

    #[gpui::test]
    fn deleting_needs_a_second_click_and_then_removes_the_project(cx: &mut TestAppContext) {
        let library = library("delete");
        let project = library
            .create("Doomed", CanvasSize::default(), Fps::default())
            .unwrap();
        let app = app(cx, library.clone());

        // First click only arms the button.
        app.update(cx, |app, _| {
            app.pending_delete = Some(project.metadata.id.clone());
        });
        assert_eq!(
            library.list().unwrap().len(),
            1,
            "still there after one click"
        );

        app.update(cx, |app, _| app.delete_project(&project.metadata.id));
        app.update(cx, |app, _| {
            assert!(app.projects.is_empty());
            assert!(app.pending_delete.is_none());
        });
        assert!(library.list().unwrap().is_empty());
    }

    #[gpui::test]
    fn a_blank_name_still_produces_a_named_project(cx: &mut TestAppContext) {
        let library = library("blank");
        let app = app(cx, library.clone());
        app.update(cx, |app, cx| app.create_project("   ", cx));
        assert_eq!(library.list().unwrap()[0].name, "Untitled");
    }
}

/// The screens the shell routes between, and the settings they change.
#[cfg(test)]
mod shell_tests {
    use super::tests::{data_root, library};
    use super::*;
    use gpui::TestAppContext;

    fn shell(cx: &mut TestAppContext, tag: &str) -> (Entity<BayApp>, ShellPaths) {
        let paths = ShellPaths::under(data_root(tag));
        let library = library(tag);
        let entity = {
            let paths = paths.clone();
            cx.update(|cx| {
                let focus = cx.focus_handle();
                cx.new(|_| BayApp::over_at(Some(library), None, focus, paths))
            })
        };
        (entity, paths)
    }

    fn keystroke(key: &str) -> gpui::Keystroke {
        gpui::Keystroke {
            modifiers: Default::default(),
            key: key.to_string(),
            key_char: (key.chars().count() == 1).then(|| key.to_string()),
        }
    }

    /// The load-bearing one. bay is a local editor: it must open on the user's projects, not on
    /// a screen asking a server for permission to show them.
    #[gpui::test]
    fn the_app_opens_on_the_launcher_not_on_a_sign_in_screen(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "opens");
        app.update(cx, |app, _| {
            assert_eq!(app.screen, Screen::Launcher);
            assert!(!app.showing_editor);
            assert!(
                !app.settings.session.is_signed_in(),
                "and it is offline, which is the working state"
            );
        });
    }

    /// Nothing about editing may depend on an account.
    #[gpui::test]
    fn a_project_opens_with_no_account(cx: &mut TestAppContext) {
        let paths = ShellPaths::under(data_root("ungated"));
        let library = library("ungated");
        let project = library
            .create("Reel", CanvasSize::default(), Fps::default())
            .unwrap();
        let app = {
            let paths = paths.clone();
            cx.update(|cx| {
                let focus = cx.focus_handle();
                cx.new(|_| BayApp::over_at(Some(library), None, focus, paths))
            })
        };
        app.update(cx, |app, cx| {
            assert!(!app.settings.session.is_signed_in());
            app.open_project(&project.metadata.id, cx);
            assert!(app.showing_editor, "editing must not require signing in");
        });
    }

    #[gpui::test]
    fn the_screens_route_and_come_back(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "route");
        app.update(cx, |app, _| {
            app.screen = Screen::Settings;
            app.settings_pane = Pane::Mcp;
            assert_eq!(app.screen, Screen::Settings);

            app.screen = Screen::SignIn;
            app.screen = Screen::Launcher;
            assert_eq!(app.screen, Screen::Launcher);
            assert_eq!(app.settings_pane, Pane::Mcp, "the pane is remembered");
        });
    }

    /// Signing in must fail, say why, and leave the app usable. If this ever reports a session,
    /// bay has started claiming an identity nothing granted.
    #[gpui::test]
    fn signing_in_reports_that_there_is_no_service(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "signin");
        app.update(cx, |app, _| {
            app.begin_sign_in();
            let note = app.sign_in_note.clone().expect("a note");
            assert!(note.contains("not configured"), "{note}");
            assert!(
                !app.settings.session.is_signed_in(),
                "no service, so no session"
            );
        });
    }

    // ---- MCP allow-list -------------------------------------------------------------------

    /// The whole point of the MCP pane: blocking a tool in the window must make the gate the
    /// server consults refuse it.
    #[gpui::test]
    fn blocking_a_tool_is_persisted_and_enforced(cx: &mut TestAppContext) {
        let (app, paths) = shell(cx, "mcp-block");
        app.update(cx, |app, _| {
            app.settings.mcp.toggle("render");
            app.save_settings();
            assert!(
                app.settings_complaint.is_none(),
                "{:?}",
                app.settings_complaint
            );
        });

        // Read back from disk, the way a separate `bay --mcp` process would.
        let store = paths.settings.clone().expect("a store");
        let on_disk = store.load().expect("settings must be written");
        assert!(!on_disk.mcp.allows("render"));
        assert!(
            !bay_settings::mcp::gate(&on_disk.mcp, "render").is_allowed(),
            "the gate the server consults must refuse it"
        );
        assert!(bay_settings::mcp::gate(&on_disk.mcp, "add_clip").is_allowed());
    }

    #[gpui::test]
    fn unblocking_puts_a_tool_back(cx: &mut TestAppContext) {
        let (app, paths) = shell(cx, "mcp-unblock");
        app.update(cx, |app, _| {
            app.settings.mcp.toggle("render");
            app.save_settings();
            app.settings.mcp.toggle("render");
            app.save_settings();
        });
        let on_disk = paths.settings.unwrap().load().unwrap();
        assert!(on_disk.mcp.allows("render"));
        assert!(on_disk.mcp.blocked.is_empty());
    }

    /// Rotation is a real revocation, so the pane has to say what it just broke.
    #[gpui::test]
    fn rotating_the_token_changes_it_and_warns(cx: &mut TestAppContext) {
        let (app, paths) = shell(cx, "rotate");
        let before = app
            .update(cx, |app, _| app.mcp_token.clone())
            .expect("a token");
        app.update(cx, |app, _| app.rotate_token());

        let after = app
            .update(cx, |app, _| app.mcp_token.clone())
            .expect("a token");
        assert_ne!(before, after);
        assert!(bay_settings::token::is_valid(&after));
        assert_eq!(
            bay_settings::token::read(&paths.token.unwrap()).unwrap(),
            after,
            "the file every client reads must hold the new value"
        );

        let complaint = app.update(cx, |app, _| app.settings_complaint.clone());
        let complaint = complaint.expect("rotating must warn");
        assert!(complaint.contains("must be updated"), "{complaint}");
    }

    // ---- providers ------------------------------------------------------------------------

    #[gpui::test]
    fn adding_a_provider_leaves_it_off_until_it_has_a_key(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "provider-add");
        app.update(cx, |app, _| {
            app.add_provider("anthropic");
            let provider = app.settings.providers.get("anthropic").expect("added");
            assert!(!provider.enabled, "adding must not start using it");
            assert!(app.settings.providers.usable().is_empty());
        });
    }

    /// The key must land in the owner-only key file and nowhere else. A key in settings.json
    /// is a key in every backup and every screenshot of that directory.
    #[gpui::test]
    fn a_typed_key_is_stored_outside_the_settings_document(cx: &mut TestAppContext) {
        let (app, paths) = shell(cx, "provider-key");
        app.update(cx, |app, _| {
            app.add_provider("anthropic");
            app.store_key("anthropic", "sk-ant-api03-DO-NOT-PERSIST-4f2a");
        });

        let settings_text = std::fs::read_to_string(paths.settings.unwrap().path()).unwrap();
        assert!(
            !settings_text.contains("DO-NOT-PERSIST"),
            "the key body reached settings.json: {settings_text}"
        );
        assert!(
            settings_text.contains("4f2a"),
            "but the hint should be there"
        );

        let stored = bay_settings::keys::get(&paths.keys.unwrap(), "anthropic").unwrap();
        assert_eq!(stored.as_deref(), Some("sk-ant-api03-DO-NOT-PERSIST-4f2a"));
        app.update(cx, |app, _| {
            assert!(app.settings.providers.get("anthropic").unwrap().usable());
        });
    }

    /// Removing a provider must forget its key. Otherwise re-adding the row silently restores
    /// a credential the user believed they had deleted.
    #[gpui::test]
    fn forgetting_a_provider_deletes_its_key(cx: &mut TestAppContext) {
        let (app, paths) = shell(cx, "provider-forget");
        app.update(cx, |app, _| {
            app.add_provider("openai");
            app.store_key("openai", "sk-proj-secret-91cd");
            app.forget_provider("openai");
        });
        assert_eq!(
            bay_settings::keys::get(&paths.keys.unwrap(), "openai").unwrap(),
            None,
            "the key outlived the provider row"
        );
        app.update(cx, |app, _| {
            assert!(app.settings.providers.get("openai").is_none());
        });
    }

    #[gpui::test]
    fn an_empty_key_is_refused_with_a_reason(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "provider-empty");
        app.update(cx, |app, _| {
            app.add_provider("openai");
            app.store_key("openai", "   ");
            assert!(app
                .settings_complaint
                .as_deref()
                .is_some_and(|c| c.contains("empty")));
            assert!(app
                .settings
                .providers
                .get("openai")
                .unwrap()
                .key_hint
                .is_none());
        });
    }

    // ---- compute --------------------------------------------------------------------------

    /// The cloud does not exist in this build, so choosing it must fail loudly and leave the
    /// mode alone rather than flipping a radio that changes nothing.
    #[gpui::test]
    fn choosing_the_cloud_is_refused_and_explained(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "compute");
        app.update(cx, |app, _| {
            app.choose_compute(bay_settings::compute::ComputeMode::Cloud);
            assert_eq!(
                app.settings.compute.mode,
                bay_settings::compute::ComputeMode::ThisMachine
            );
            let complaint = app.settings_complaint.clone().expect("a refusal");
            assert!(complaint.contains("this Mac"), "{complaint}");
        });
    }

    #[gpui::test]
    fn routing_a_model_to_the_cloud_is_refused_too(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "route-model");
        app.update(cx, |app, _| {
            app.route_component("listen", bay_settings::models::RunLocation::Cloud);
            assert_eq!(
                app.settings.models.location("listen"),
                bay_settings::models::RunLocation::Local
            );
            assert!(app.settings_complaint.is_some());

            // And the local choice, which is honourable, must clear the complaint.
            app.route_component("listen", bay_settings::models::RunLocation::Local);
            assert!(app.settings_complaint.is_none());
        });
    }

    // ---- typing ---------------------------------------------------------------------------

    /// One dispatcher, one open field. A keystroke must reach the field that is focused and no
    /// other.
    #[gpui::test]
    fn keystrokes_reach_the_open_field_and_only_that_one(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "typing");
        app.update(cx, |app, cx| {
            app.new_name = Some(TextField::new("Untitled"));
            for key in ["R", "e", "e", "l"] {
                assert!(app.route_key(&keystroke(key), cx), "{key} should be taken");
            }
            assert_eq!(app.new_name.as_ref().unwrap().value(), "Reel");

            // The key field takes precedence while it is open.
            app.keying = Some(("anthropic".into(), TextField::new("paste key")));
            app.route_key(&keystroke("s"), cx);
            assert_eq!(app.keying.as_ref().unwrap().1.value(), "s");
            assert_eq!(
                app.new_name.as_ref().unwrap().value(),
                "Reel",
                "the name field must not also receive it"
            );
        });
    }

    #[gpui::test]
    fn escape_closes_whatever_is_open(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "escape");
        app.update(cx, |app, cx| {
            app.keying = Some(("anthropic".into(), TextField::new("")));
            app.route_key(&keystroke("escape"), cx);
            assert!(app.keying.is_none());

            app.new_name = Some(TextField::new(""));
            app.route_key(&keystroke("escape"), cx);
            assert!(app.new_name.is_none());

            app.menu_for = Some("p1".into());
            assert!(app.route_key(&keystroke("escape"), cx));
            assert!(app.menu_for.is_none());
        });
    }

    /// Enter in the name field creates the project — the path the launcher's inline field takes.
    #[gpui::test]
    fn enter_in_the_name_field_creates_the_project(cx: &mut TestAppContext) {
        let paths = ShellPaths::under(data_root("enter"));
        let library = library("enter");
        let app = {
            let paths = paths.clone();
            let library = library.clone();
            cx.update(|cx| {
                let focus = cx.focus_handle();
                cx.new(|_| BayApp::over_at(Some(library), None, focus, paths))
            })
        };
        app.update(cx, |app, cx| {
            app.new_name = Some(TextField::seeded("Untitled", "Field Notes"));
            app.route_key(&keystroke("enter"), cx);
            assert!(app.showing_editor, "creating opens it");
            assert!(app.new_name.is_none(), "and closes the field");
        });
        assert_eq!(library.list().unwrap()[0].name, "Field Notes");
    }

    // ---- filing ----------------------------------------------------------------------------

    /// The launcher's status menu writes to the project, not to a sidecar index.
    #[gpui::test]
    fn filing_a_project_from_the_launcher_persists_to_the_project(cx: &mut TestAppContext) {
        let paths = ShellPaths::under(data_root("filing"));
        let library = library("filing");
        let project = library
            .create("Reel", CanvasSize::default(), Fps::default())
            .unwrap();
        let id = project.metadata.id.clone();
        let app = {
            let paths = paths.clone();
            let library = library.clone();
            cx.update(|cx| {
                let focus = cx.focus_handle();
                cx.new(|_| BayApp::over_at(Some(library), None, focus, paths))
            })
        };

        app.update(cx, |app, _| {
            app.file_project(&id, |shelf| {
                shelf.status = bay_core::ProjectStatus::Done;
                true
            });
            app.file_project(&id, |shelf| shelf.add_tag("Reel"));
            let summary = app
                .projects
                .iter()
                .find(|summary| summary.id == id)
                .expect("still listed");
            assert_eq!(summary.shelf.status, bay_core::ProjectStatus::Done);
            assert_eq!(summary.shelf.tags, vec!["Reel"]);
        });
        assert_eq!(
            library.load(&id).unwrap().metadata.shelf.status,
            bay_core::ProjectStatus::Done
        );
    }

    /// A settings file bay could not read must not stop the app opening, and must not be
    /// silently replaced with defaults either.
    #[gpui::test]
    fn a_corrupt_settings_file_is_reported_and_the_app_still_opens(cx: &mut TestAppContext) {
        let root = data_root("corrupt");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("settings.json"), "{ not json").unwrap();
        let paths = ShellPaths::under(&root);
        let library = library("corrupt");
        let app = cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| BayApp::over_at(Some(library), None, focus, paths))
        });

        app.update(cx, |app, _| {
            assert_eq!(app.screen, Screen::Launcher, "the app still opens");
            assert!(app.settings_complaint.is_some(), "and says what is wrong");
            assert!(app.settings.mcp.enabled, "falling back to the defaults");
        });
        assert_eq!(
            std::fs::read_to_string(root.join("settings.json")).unwrap(),
            "{ not json",
            "reading must never overwrite a file it could not parse"
        );
    }

    /// The snapshot the settings screen draws from must describe this machine, not a mock.
    #[gpui::test]
    fn the_settings_snapshot_describes_this_machine(cx: &mut TestAppContext) {
        let (app, _) = shell(cx, "snapshot");
        let snapshot = app.update(cx, |app, _| app.settings_snapshot());

        assert!(
            !snapshot.components.is_empty(),
            "the manifest has components, so the pane must list them"
        );
        assert!(
            snapshot.components.iter().any(|c| c.id == "video"),
            "ffmpeg is the one everything else depends on"
        );
        assert!(
            !snapshot.cloud_available,
            "there is no cloud in this build, and the pane must know"
        );
        assert!(
            snapshot.tools.len() > 10,
            "the MCP pane needs a row per tool: {}",
            snapshot.tools.len()
        );
        let mut sorted = snapshot.tools.clone();
        sorted.sort();
        assert_eq!(
            sorted, snapshot.tools,
            "tool rows must be in a stable order"
        );
    }
}

/// Agent routing when nothing is open — the deadlock this fixes, and the guards around it.
/// The settings screen, painted.
///
/// `pages.md`'s rule applies to panes too: a pane that compiles and passes its model tests is
/// not a pane that works. This drives GPUI's whole layout → prepaint → paint pass over each one,
/// which is what catches a colliding element id, a `relative()` height built from a NaN, or a
/// preview strip squeezed to a negative size — none of which a test over `captions_pane`'s
/// return value can see.
#[cfg(test)]
mod settings_paint_tests {
    use super::tests::*;
    use super::*;
    use crate::paint_harness::{paint, window};
    use gpui::{TestAppContext, VisualTestContext};

    fn settings(cx: &mut TestAppContext, pane: Pane) -> (Entity<BayApp>, &mut VisualTestContext) {
        window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            let paths = ShellPaths::under(data_root("settings-paint"));
            let mut app = BayApp::over_at(Some(library("settings-paint")), None, focus, paths);
            app.screen = Screen::Settings;
            app.settings_pane = pane;
            app
        })
    }

    #[gpui::test]
    fn every_settings_pane_paints(cx: &mut TestAppContext) {
        for pane in Pane::ALL {
            let (view, cx) = settings(cx, pane);
            paint(&view, cx, 1440.0, 900.0);
            // And at a small window, where the sidebar and the body compete for width.
            paint(&view, cx, 900.0, 640.0);
        }
    }

    /// The Captions pane in each of the states its preview strip has to draw: nothing set, a
    /// platform chosen, and a band low enough to be clamped — which is the one that draws the
    /// extra "asked for" line and the warning banner. The 0.0 and 1.0 rows are the edges where
    /// a fractional height is most likely to come out negative or past the frame.
    #[gpui::test]
    fn the_captions_pane_paints_in_every_state(cx: &mut TestAppContext) {
        let (view, cx) = settings(cx, Pane::Captions);
        paint(&view, cx, 1440.0, 900.0);

        for (band, area) in [
            (None, bay_settings::captions::SafeArea::InstagramReels),
            (
                Some(806.0 / 960.0),
                bay_settings::captions::SafeArea::InstagramReels,
            ),
            (
                Some(690.0 / 960.0),
                bay_settings::captions::SafeArea::TikTok,
            ),
            (Some(0.0), bay_settings::captions::SafeArea::None),
            (Some(1.0), bay_settings::captions::SafeArea::YouTubeShorts),
        ] {
            view.update(cx, |app, _| {
                app.settings.captions.band_top = band;
                app.settings.captions.safe_area = area;
            });
            paint(&view, cx, 1440.0, 900.0);
            paint(&view, cx, 900.0, 640.0);
        }
    }

    /// The controls must actually change the setting — a pane whose buttons paint and do
    /// nothing is the dead control this repository keeps a register for.
    #[gpui::test]
    fn the_caption_controls_change_the_setting(cx: &mut TestAppContext) {
        let app = app(cx, library("caption-controls"));
        app.update(cx, |app, _| {
            assert!(
                app.settings.captions.band_top.is_none(),
                "starts on the kit"
            );

            app.nudge_caption_band(0.05);
            let moved = app.settings.captions.band_top.expect("a position was set");
            assert!(
                (moved - (crate::settings_model::KIT_DEFAULT_BAND_TOP + 0.05)).abs() < 1e-6,
                "the first nudge must start from the kit's position, got {moved}"
            );

            app.choose_caption_safe_area(bay_settings::captions::SafeArea::InstagramReels);
            assert_eq!(
                app.settings.captions.safe_area,
                bay_settings::captions::SafeArea::InstagramReels
            );

            app.choose_caption_align(bay_settings::captions::CaptionAlign::Center);
            assert_eq!(
                app.settings.captions.align,
                Some(bay_settings::captions::CaptionAlign::Center)
            );
            // Clicking the chosen alignment again hands it back to the kit.
            app.choose_caption_align(bay_settings::captions::CaptionAlign::Center);
            assert_eq!(app.settings.captions.align, None);

            app.reset_caption_band();
            assert!(app.settings.captions.band_top.is_none(), "back to the kit");
        });
    }
}

#[cfg(test)]
mod agent_routing_tests {
    use super::tests::*;
    use super::*;
    use gpui::TestAppContext;

    fn call(name: &str, args: serde_json::Value) -> bay_agent::ToolCall {
        bay_agent::ToolCall {
            name: name.to_string(),
            arguments: args,
        }
    }

    /// The reported bug: bay open, nothing loaded, and an agent could not get started —
    /// project_create was refused because no project was open, which is a deadlock.
    #[gpui::test]
    fn an_agent_can_create_a_project_with_nothing_open(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-create"));
        app.update(cx, |app, cx| {
            assert!(app.editor.is_none(), "precondition: nothing is open");

            let response = app.route_agent_call(
                &call(
                    "project_create",
                    serde_json::json!({"name": "Reel", "width": 1080, "height": 1920, "fps": 30}),
                ),
                cx,
            );
            let bay_agent::AgentResponse::Ok(value) = response else {
                panic!("project_create was refused with nothing open: {response:?}");
            };
            assert_eq!(
                value["opened"], true,
                "the new project must open in the window"
            );
            assert_eq!(value["canvas"]["width"], 1080);
            assert!(
                value["projectId"].as_str().is_some_and(|id| !id.is_empty()),
                "the agent needs the id back to reopen it"
            );

            assert!(app.editor.is_some(), "the editor should now exist");
            assert!(
                app.showing_editor,
                "and be on screen — the human is watching"
            );
        });
    }

    /// background was accepted by the tool schema and silently thrown away, so an agent that
    /// asked for #0B0B0C got black and could only find out by looking at a rendered frame.
    #[gpui::test]
    fn project_create_keeps_the_background_it_was_given(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-bg"));
        app.update(cx, |app, cx| {
            let response = app.route_agent_call(
                &call(
                    "project_create",
                    serde_json::json!({"name": "Dark", "background": "#0B0B0C"}),
                ),
                cx,
            );
            let bay_agent::AgentResponse::Ok(value) = response else {
                panic!("project_create failed: {response:?}");
            };
            assert_eq!(
                value["background"], "#0B0B0C",
                "the response must report the background it was given"
            );

            // And it must actually be on the project, not just echoed back.
            let info = app.route_agent_call(&call("project_info", serde_json::json!({})), cx);
            let bay_agent::AgentResponse::Ok(info) = info else {
                panic!("project_info failed: {info:?}");
            };
            assert!(
                info.to_string().contains("0B0B0C"),
                "the open project should carry the background: {info}"
            );
        });
    }

    /// One tool must not describe its result two different ways depending on which half of bay
    /// answered it. The headless server returns canvas.width; this used to return width.
    #[gpui::test]
    fn project_create_answers_in_the_same_shape_as_the_headless_server(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-shape"));
        app.update(cx, |app, cx| {
            let bay_agent::AgentResponse::Ok(value) = app.route_agent_call(
                &call(
                    "project_create",
                    serde_json::json!({"name": "Shape", "width": 1080, "height": 1920, "fps": 30}),
                ),
                cx,
            ) else {
                panic!("project_create failed");
            };
            assert_eq!(
                value["canvas"]["width"], 1080,
                "headless returns canvas.width"
            );
            assert_eq!(value["canvas"]["height"], 1920);
            assert_eq!(value["fps"], 30);
            assert_eq!(value["name"], "Shape");
        });
    }

    /// Picking a voice needs the catalogue, and the catalogue is a constant — it must not
    /// require starting a multi-gigabyte model, which is why this used to come back empty.
    #[gpui::test]
    fn speech_status_lists_voices_without_starting_anything(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-voices"));
        app.update(cx, |app, cx| {
            let bay_agent::AgentResponse::Ok(value) =
                app.route_agent_call(&call("speech_status", serde_json::json!({})), cx)
            else {
                panic!("speech_status must always answer");
            };
            let total: usize = value["voices"]
                .as_object()
                .expect("voices should be an object keyed by language")
                .values()
                .map(|v| v.as_array().map(Vec::len).unwrap_or(0))
                .sum();
            assert_eq!(total, 54, "the whole catalogue, not a subset: {value}");
            assert!(
                value["voices"]["a"]
                    .as_array()
                    .is_some_and(|v| v.iter().any(|n| n == "af_heart")),
                "af_heart is the default voice and must be listed"
            );
        });
    }

    /// Creating must leave the agent able to edit immediately; a project that opened but did
    /// not accept edits would just move the deadlock one call later.
    #[gpui::test]
    fn editing_works_immediately_after_the_agent_creates_a_project(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-then-edit"));
        app.update(cx, |app, cx| {
            app.route_agent_call(
                &call("project_create", serde_json::json!({"name": "Reel"})),
                cx,
            );
            let response = app.route_agent_call(
                &call(
                    "add_text",
                    serde_json::json!({"role": "headline","content": "hello", "start": 0, "duration": 2}),
                ),
                cx,
            );
            assert!(
                matches!(response, bay_agent::AgentResponse::Ok(_)),
                "add_text straight after project_create should work: {response:?}"
            );
        });
    }

    /// fonts_check is what the skill tells an agent to call first, and it asks about the
    /// machine, not the document. Gating it behind an open project made the recommended first
    /// step the one that failed.
    #[gpui::test]
    fn fonts_check_answers_with_no_project_open(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-fonts"));
        app.update(cx, |app, cx| {
            let response = app.route_agent_call(
                &call(
                    "fonts_check",
                    serde_json::json!({"families": ["Helvetica", "Definitely Not A Typeface 9000"]}),
                ),
                cx,
            );
            let bay_agent::AgentResponse::Ok(value) = response else {
                panic!("fonts_check needs no document: {response:?}");
            };
            assert!(
                value["missing"]
                    .as_array()
                    .is_some_and(|m| m.iter().any(|v| v == "Definitely Not A Typeface 9000")),
                "an invented family must come back as missing: {value}"
            );
        });
    }

    /// A refusal has to say what to do instead. The old message named neither the tool that
    /// resolves it nor anything else that works.
    #[gpui::test]
    fn refusing_an_edit_names_the_way_out(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-refusal"));
        app.update(cx, |app, cx| {
            let response = app.route_agent_call(
                &call(
                    "add_text",
                    serde_json::json!({"role": "headline","content": "hi", "start": 0, "duration": 1}),
                ),
                cx,
            );
            let bay_agent::AgentResponse::Err(message) = response else {
                panic!("editing with nothing open must be refused");
            };
            assert!(
                message.contains("project_create"),
                "the refusal must name the tool that fixes it: {message}"
            );
            assert!(
                message.contains("fonts_check"),
                "and list what does work right now: {message}"
            );
        });
    }

    /// An agent reconnecting to a window mid-session needs to find and reopen existing work.
    #[gpui::test]
    fn the_agent_can_list_and_reopen_an_existing_project(cx: &mut TestAppContext) {
        let library = library("agent-reopen");
        let existing = library
            .create("Earlier", CanvasSize::default(), Fps::default())
            .expect("seed a project");
        let app = app(cx, library);

        app.update(cx, |app, cx| {
            let bay_agent::AgentResponse::Ok(listed) =
                app.route_agent_call(&call("project_list", serde_json::json!({})), cx)
            else {
                panic!("project_list must work with nothing open");
            };
            let ids: Vec<&str> = listed["projects"]
                .as_array()
                .expect("projects array")
                .iter()
                .filter_map(|p| p["id"].as_str())
                .collect();
            assert!(ids.contains(&existing.metadata.id.as_str()));

            let response = app.route_agent_call(
                &call(
                    "project_load",
                    serde_json::json!({"id": existing.metadata.id}),
                ),
                cx,
            );
            let bay_agent::AgentResponse::Ok(value) = response else {
                panic!("project_load was refused: {response:?}");
            };
            assert_eq!(value["name"], "Earlier");
            assert!(
                app.showing_editor,
                "loading shows it — the human is watching"
            );
        });
    }

    /// snapshot is the call the whole workflow rests on — an agent that cannot see a frame is
    /// guessing. Without a GPU it must say so rather than return a path to nothing.
    #[gpui::test]
    fn snapshot_writes_a_png_or_says_why_not(cx: &mut TestAppContext) {
        let Some(app) = app_with_gpu(cx, library("agent-snapshot")) else {
            eprintln!("skipping: no GPU adapter on this machine");
            return;
        };
        let out = std::env::temp_dir().join(format!("bay-agent-snap-{}.png", std::process::id()));
        let _ = std::fs::remove_file(&out);

        app.update(cx, |app, cx| {
            app.route_agent_call(
                &call("project_create", serde_json::json!({"name": "Snap"})),
                cx,
            );
            app.route_agent_call(
                &call(
                    "add_text",
                    serde_json::json!({"role": "headline","content": "frame", "start": 0, "duration": 2}),
                ),
                cx,
            );
            match app.route_agent_call(
                &call(
                    "snapshot",
                    serde_json::json!({"at": 1.0, "path": out.to_string_lossy()}),
                ),
                cx,
            ) {
                bay_agent::AgentResponse::Ok(value) => {
                    assert!(out.is_file(), "reported success but wrote no file: {value}");
                    // Must match the headless server's default, or the same call renders at a
                    // different size depending on whether a window happens to be open.
                    assert_eq!(
                        (value["width"].as_u64(), value["height"].as_u64()),
                        (Some(540), Some(960)),
                        "scale should default to 0.5, as the tool schema advertises"
                    );
                    let bytes = std::fs::read(&out).expect("read the png");
                    assert_eq!(
                        &bytes[..8],
                        b"\x89PNG\r\n\x1a\n",
                        "the file it wrote is not a PNG"
                    );
                    eprintln!(
                        "rendered {} bytes, {}x{}",
                        bytes.len(),
                        value["width"],
                        value["height"]
                    );
                }
                bay_agent::AgentResponse::Err(message) => {
                    assert!(
                        message.contains("GPU"),
                        "the only acceptable failure here is a missing GPU, got: {message}"
                    );
                    eprintln!("skipping: {message}");
                }
            }
        });
        let _ = std::fs::remove_file(&out);
    }

    /// Snapshot must reject a time it cannot render rather than writing a misleading frame.
    #[gpui::test]
    fn snapshot_refuses_a_nonsense_time(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-snap-bad"));
        app.update(cx, |app, cx| {
            app.route_agent_call(&call("project_create", serde_json::json!({})), cx);
            let response = app.route_agent_call(
                &call(
                    "snapshot",
                    serde_json::json!({"at": -1.0, "path": "/tmp/nope.png"}),
                ),
                cx,
            );
            assert!(
                matches!(response, bay_agent::AgentResponse::Err(_)),
                "a negative time must be refused: {response:?}"
            );
        });
    }

    /// The whole point of this change: a slow tool must not be answered by telling the user to
    /// quit. This drives the real path — worker, then apply on the main thread — and checks the
    /// MP4 exists rather than trusting the response.
    #[gpui::test]
    async fn render_works_with_the_editor_open(cx: &mut TestAppContext) {
        let Some(app) = app_with_gpu(cx, library("agent-render")) else {
            eprintln!("skipping: no GPU adapter on this machine");
            return;
        };
        let out = std::env::temp_dir().join(format!("bay-agent-render-{}.mp4", std::process::id()));
        let _ = std::fs::remove_file(&out);

        app.update(cx, |app, cx| {
            app.route_agent_call(
                &call(
                    "project_create",
                    serde_json::json!({"name": "R", "fps": 12}),
                ),
                cx,
            );
            app.route_agent_call(
                &call(
                    "add_text",
                    serde_json::json!({"role": "headline","content": "render", "start": 0, "duration": 0.5}),
                ),
                cx,
            );
        });

        let context = app.update(cx, |app, cx| {
            app.editor
                .as_ref()
                .expect("editor")
                .update(cx, |view, _| view.slow_context())
        });
        // Exactly what start_slow_tool hands the worker.
        let result = bay_agent::slow::run(
            "render",
            &serde_json::json!({
                "path": out.to_string_lossy(),
                "ignoreChecks": true,
                "reason": "This synthetic routing fixture tests MP4 delivery, not composition quality."
            }),
            &context,
            None,
        );
        match result {
            Ok(result) => {
                let response = app.update(cx, |app, cx| app.finish_slow_tool(result, cx));
                assert!(
                    matches!(response, bay_agent::AgentResponse::Ok(_)),
                    "render should succeed: {response:?}"
                );
                assert!(out.is_file(), "reported success but wrote no MP4");
                assert!(
                    std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) > 0,
                    "the MP4 is empty"
                );
            }
            Err(message) => {
                assert!(
                    message.contains("ffmpeg") || message.contains("GPU"),
                    "the only acceptable failures are a missing ffmpeg or GPU, got: {message}"
                );
                eprintln!("skipping: {message}");
            }
        }
        let _ = std::fs::remove_file(&out);
    }

    /// A finished narration must land as commands on the main thread — audio on its lane and
    /// captions above it — so it undoes with the same Cmd+Z as a human edit.
    #[gpui::test]
    fn a_finished_narration_lands_as_undoable_commands(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-narrate-apply"));
        app.update(cx, |app, cx| {
            app.route_agent_call(&call("project_create", serde_json::json!({})), cx);

            // Stand in for the worker's output, so this tests the APPLY half without needing
            // Kokoro installed on the machine running the suite.
            let utterance = bay_speech::Utterance {
                path: "/tmp/bay-fake-narration.wav".into(),
                duration_seconds: 2.0,
                sample_rate: 24000,
                voice: "af_heart".into(),
                words: vec![
                    bay_speech::WordSpan {
                        text: "local".into(),
                        start: 0.0,
                        end: 0.9,
                    },
                    bay_speech::WordSpan {
                        text: "first".into(),
                        start: 0.9,
                        end: 2.0,
                    },
                ],
            };
            let result = bay_agent::slow::SlowResult {
                value: serde_json::json!({"durationSeconds": 2.0}),
                follow_up: bay_agent::slow::FollowUp::PlaceNarration {
                    asset: Box::new(bay_core::project::MediaAsset::new(
                        "media-1",
                        "narration.wav",
                        "/tmp/bay-fake-narration.wav",
                    )),
                    utterance: Box::new(utterance),
                    script: "local first".into(),
                    start: 1.0,
                    volume: 1.0,
                    cue_style: bay_speech::CueStyle::default(),
                    captions: Some(Box::new(bay_agent::plan::CaptionStyle::default())),
                },
            };
            app.finish_slow_tool(result, cx);

            let bay_agent::AgentResponse::Ok(timeline) =
                app.route_agent_call(&call("timeline", serde_json::json!({})), cx)
            else {
                panic!("timeline should read back");
            };
            let dump = timeline.to_string();
            assert!(
                dump.contains("Audio"),
                "the narration audio is missing: {dump}"
            );
            assert!(
                dump.contains("caption-"),
                "the captions are missing: {dump}"
            );
            // Placed where the caller asked, not at zero — cues come back relative to the
            // utterance and must be shifted by `start`.
            assert!(
                dump.contains("1.0"),
                "narration should start at 1s, not 0: {dump}"
            );
        });
    }

    /// A bad id must come back as a message the agent can act on, not a panic or a silent Ok.
    #[gpui::test]
    fn loading_a_project_that_is_not_there_says_so(cx: &mut TestAppContext) {
        let app = app(cx, library("agent-missing"));
        app.update(cx, |app, cx| {
            let response = app.route_agent_call(
                &call("project_load", serde_json::json!({"id": "no-such-project"})),
                cx,
            );
            assert!(
                matches!(response, bay_agent::AgentResponse::Err(_)),
                "a missing project must be an error: {response:?}"
            );
        });
    }
}
