//! The application shell: the project launcher, and the routing between it and the editor.
//!
//! vii used to open straight into one hardcoded project file, so "which project am I editing?"
//! had no answer and a second project had nowhere to live. [`ViiApp`] is the root view now: it
//! opens on the project library, and the editor is what you get *after* choosing a project.
//!
//! The editor is built once and reused across projects, because it owns the GPU
//! [`PreviewRenderer`] — rebuilding a view per project would mean requesting a new adapter
//! every time someone goes back to the list.

use std::path::PathBuf;
use std::time::SystemTime;

use gpui::prelude::*;
use gpui::{
    div, px, rgb, Context, Div, Entity, FocusHandle, KeyDownEvent, SharedString, Subscription,
    Window,
};

use vii_core::project::{CanvasSize, Fps, ProjectLibrary, ProjectSummary};
use vii_core::Editor;
use vii_preview::PreviewRenderer;

use crate::editor_view::{legacy_project_path, EditorView, EditorViewEvent};
use crate::theme;
use crate::view_model::{HomeViewModel, ProjectCard};

/// Canvas defaults offered when creating a project. Two presets cover almost everything people
/// actually make: a 16:9 landscape video and a 9:16 vertical reel.
const PRESETS: [(&str, u32, u32); 2] = [
    ("16:9 · 1920×1080", 1920, 1080),
    ("9:16 · 1080×1920", 1080, 1920),
];

pub struct ViiApp {
    /// `None` when the projects directory could not be opened; `library_error` says why.
    library: Option<ProjectLibrary>,
    library_error: Option<String>,
    projects: Vec<ProjectSummary>,
    editor: Option<Entity<EditorView>>,
    /// Handed to the editor the first time a project is opened.
    preview: Option<PreviewRenderer>,
    /// Kept alive so the editor's close events keep arriving.
    _editor_subscription: Option<Subscription>,
    showing_editor: bool,
    /// The in-progress "new project" name, and which canvas preset it will use.
    new_name: Option<String>,
    new_preset: usize,
    /// The project a delete button has been clicked on once — clicking again confirms.
    pending_delete: Option<String>,
    status: Option<String>,
    focus_handle: FocusHandle,
    needs_focus: bool,
    /// The port this window serves agent calls on, so the registry note can name the project
    /// it has open — which is how a human tells two windows apart in `vii --agents`.
    agent_port: Option<u16>,
}

impl gpui::Focusable for ViiApp {
    fn focus_handle(&self, _cx: &gpui::App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl ViiApp {
    /// Drain agent tool calls forever, on the foreground executor.
    ///
    /// A foreground task is the only legal way in: GPUI's `ForegroundExecutor` is `!Send`, so
    /// the MCP thread can never touch a view directly. It sends owned data down a `Send`
    /// channel; this task — which lives on the main thread — is what actually applies it.
    ///
    /// Detached rather than stored: it should live exactly as long as the app does, and there
    /// is nothing meaningful to do with the handle.
    fn drain_agent_calls(pump: vii_agent::AgentPump, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            while let Some(request) = pump.next().await {
                let call = request.call.clone();
                let response = this
                    .update(cx, |app, cx| app.route_agent_call(&call, cx))
                    .unwrap_or_else(|_| {
                        vii_agent::AgentResponse::Err("the editor window has closed".into())
                    });
                request.respond(response);
            }
        })
        .detach();
    }

    /// Send a tool call to whichever project is open.
    ///
    /// "Which project?" needs no argument from the agent: the one on screen is the one it
    /// edits, which is what makes watching the edit land meaningful. With nothing open there
    /// is no document to edit, and saying so beats inventing one the user cannot see.
    fn route_agent_call(
        &mut self,
        call: &vii_agent::ToolCall,
        cx: &mut Context<Self>,
    ) -> vii_agent::AgentResponse {
        // Window-level calls are answered here: they are about the window, not the document,
        // and must work even with nothing open. `window_focus` is what a second launch sends
        // instead of starting a rival instance.
        if call.name == "window_focus" {
            cx.activate(true);
            return vii_agent::AgentResponse::Ok(serde_json::json!({
                "focused": true,
                "showingEditor": self.showing_editor,
            }));
        }

        // Machine-level questions ("is narration installed?", "is this font here?") have an
        // answer before any project exists, so they must not be gated behind opening one.
        if let Some(answer) = vii_agent::plan_without_document(&call.name, &call.arguments) {
            return match answer {
                Ok(value) => vii_agent::AgentResponse::Ok(value),
                Err(message) => vii_agent::AgentResponse::Err(message),
            };
        }

        // Library calls create, list and open the document the rest of the tools edit, so they
        // are answered by the window and must work with nothing open. Without this an agent
        // that finds an empty vii is deadlocked: it cannot create a project because no project
        // is open.
        if vii_agent::window_tools().contains(&call.name.as_str()) {
            return self.route_library_call(call, cx);
        }

        let Some(editor) = self.editor.clone() else {
            return vii_agent::AgentResponse::Err(format!(
                "no project is open in vii — call project_create to make one (it opens in the \
                 window), or project_list then project_load to reopen an existing one. \
                 Available now: {}",
                vii_agent::available_tools().join(", ")
            ));
        };
        if !self.showing_editor {
            return vii_agent::AgentResponse::Err(
                "vii is showing the project list — call project_load with an id from \
                 project_list, or project_create to start a new one"
                    .into(),
            );
        }
        editor.update(cx, |view, cx| view.apply_agent_call(call, cx))
    }

    /// `project_create` / `project_list` / `project_load`, answered against the app's library.
    ///
    /// Creating opens the project in the window, because the point of an agent editing a live
    /// vii is that the human watches it happen — a project made but not shown would be the
    /// headless behaviour wearing the editor's clothes.
    fn route_library_call(
        &mut self,
        call: &vii_agent::ToolCall,
        cx: &mut Context<Self>,
    ) -> vii_agent::AgentResponse {
        let Some(library) = self.library.clone() else {
            return vii_agent::AgentResponse::Err(
                "no project library on this machine — vii could not find a home directory".into(),
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
                    return vii_agent::AgentResponse::Err(
                        "width, height and fps must all be greater than zero".into(),
                    );
                }
                match library.create(
                    name.trim(),
                    CanvasSize { width, height },
                    Fps {
                        numerator: fps,
                        denominator: 1,
                    },
                ) {
                    Ok(project) => {
                        let id = project.metadata.id.clone();
                        let path = library.path_for(&id);
                        self.new_name = None;
                        self.refresh();
                        self.show_editor(project, Some(path), cx);
                        self.status = Some(format!("Claude created “{}”", name.trim()));
                        cx.notify();
                        vii_agent::AgentResponse::Ok(serde_json::json!({
                            "projectId": id,
                            "name": name.trim(),
                            "width": width,
                            "height": height,
                            "fps": fps,
                            "opened": true,
                        }))
                    }
                    Err(error) => vii_agent::AgentResponse::Err(format!(
                        "could not create the project: {error}"
                    )),
                }
            }
            "project_list" => match library.list() {
                Ok(projects) => vii_agent::AgentResponse::Ok(serde_json::json!({
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
                    vii_agent::AgentResponse::Err(format!("could not read the library: {error}"))
                }
            },
            "project_load" => {
                let Some(id) = text("id") else {
                    return vii_agent::AgentResponse::Err(
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
                        vii_agent::AgentResponse::Ok(serde_json::json!({
                            "projectId": id,
                            "name": name,
                            "opened": true,
                        }))
                    }
                    Err(error) => {
                        vii_agent::AgentResponse::Err(format!("could not open {id}: {error}"))
                    }
                }
            }
            other => vii_agent::AgentResponse::Err(format!("{other} is not a library tool")),
        }
    }

    pub fn new(
        focus_handle: FocusHandle,
        preview: Option<PreviewRenderer>,
        pump: Option<vii_agent::AgentPump>,
        agent_port: Option<u16>,
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
        app.adopt_legacy_project();
        app.refresh();
        // Open a project straight away when asked. Useful for picking up where you left off,
        // and it is what makes the agent path testable without a human clicking the launcher.
        let wanted = std::env::var("VII_OPEN_PROJECT").unwrap_or_default();
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

    /// A shell over an explicit library. Tests use this: reaching for the default library would
    /// mean a test run reading — and adopting into — the developer's own projects.
    pub fn over(
        library: Option<ProjectLibrary>,
        preview: Option<PreviewRenderer>,
        focus_handle: FocusHandle,
    ) -> Self {
        let mut app = Self {
            library,
            library_error: None,
            projects: Vec::new(),
            editor: None,
            preview,
            _editor_subscription: None,
            showing_editor: false,
            new_name: None,
            new_preset: 0,
            pending_delete: None,
            status: None,
            focus_handle,
            needs_focus: true,
            agent_port: None,
        };
        // No legacy adoption here — that reads a file in the real home directory, which is
        // exactly what a test handed its own library must not do. `new` does it.
        app.refresh();
        app
    }

    /// Pull the pre-library `~/vii-project.json` into the library the first time we run with
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

    fn create_project(&mut self, name: &str, cx: &mut Context<Self>) {
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

    fn open_project(&mut self, id: &str, cx: &mut Context<Self>) {
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
    fn import_project(&mut self) {
        let Some(library) = self.library.as_ref() else {
            return;
        };
        let Some(path) = rfd::FileDialog::new()
            .add_filter("vii project", &["json"])
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
        project: vii_core::Project,
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
        // Tell the registry which project this window is showing, so `vii --agents` can name
        // it. Best effort — a failed note is not worth interrupting the user for.
        if let Some(port) = self.agent_port {
            let _ = vii_agent::registry::register(port, Some(project_name.as_str()));
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

    /// Keystrokes while the new-project name field is open. Enter creates, Escape cancels.
    fn handle_name_key(&mut self, keystroke: &gpui::Keystroke, cx: &mut Context<Self>) {
        match keystroke.key.as_str() {
            "enter" => {
                if let Some(name) = self.new_name.clone() {
                    self.create_project(&name, cx);
                }
            }
            "escape" => self.new_name = None,
            "backspace" => {
                if let Some(buffer) = self.new_name.as_mut() {
                    buffer.pop();
                }
            }
            "space" => {
                if let Some(buffer) = self.new_name.as_mut() {
                    buffer.push(' ');
                }
            }
            _ => {
                if let (Some(buffer), Some(ch)) =
                    (self.new_name.as_mut(), keystroke.key_char.as_ref())
                {
                    buffer.push_str(ch);
                }
            }
        }
    }

    fn shared(text: impl Into<String>) -> SharedString {
        SharedString::from(text.into())
    }

    fn button(
        &self,
        id: &'static str,
        label: impl Into<String>,
        primary: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut ViiApp, &mut Context<ViiApp>) + 'static,
    ) -> gpui::Stateful<Div> {
        div()
            .id(id)
            .px_3()
            .py_2()
            .rounded_md()
            .bg(rgb(if primary {
                theme::ACCENT
            } else {
                theme::PANEL_ALT
            }))
            .text_sm()
            .text_color(rgb(if primary { 0xffffff } else { theme::TEXT }))
            .child(Self::shared(label))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this, cx);
                cx.notify();
            }))
    }

    fn header(&self, count: usize, cx: &mut Context<Self>) -> Div {
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .mb_6()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().text_2xl().text_color(rgb(theme::TEXT)).child("vii"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(match count {
                                0 => "No projects yet".to_string(),
                                1 => "1 project".to_string(),
                                n => format!("{n} projects"),
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .gap_2()
                    .child(self.button("import", "Open File…", false, cx, |this, _cx| {
                        this.import_project()
                    }))
                    .child(self.button("new", "New Project", true, cx, |this, _cx| {
                        this.new_name = Some(String::new());
                    })),
            )
    }

    /// The inline name field shown after "New Project" — a typed buffer, like the editor's
    /// text-clip editing, rather than a modal dialog.
    fn new_project_row(&self, name: &str, cx: &mut Context<Self>) -> Div {
        let preset_label = PRESETS[self.new_preset.min(PRESETS.len() - 1)].0;
        div()
            .flex()
            .flex_col()
            .gap_2()
            .mb_4()
            .p_4()
            .rounded_lg()
            .bg(rgb(theme::PANEL))
            .border_1()
            .border_color(rgb(theme::ACCENT))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("NEW PROJECT — type a name, Enter to create, Esc to cancel"),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .flex_1()
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(rgb(theme::LANE))
                            .text_color(rgb(if name.is_empty() {
                                theme::MUTED
                            } else {
                                theme::TEXT
                            }))
                            .child(Self::shared(if name.is_empty() {
                                "Untitled".to_string()
                            } else {
                                format!("{name}|")
                            })),
                    )
                    .child(self.button("preset", preset_label, false, cx, |this, _cx| {
                        this.new_preset = (this.new_preset + 1) % PRESETS.len();
                    }))
                    .child(self.button("create", "Create", true, cx, |this, cx| {
                        if let Some(name) = this.new_name.clone() {
                            this.create_project(&name, cx);
                        }
                    })),
            )
    }

    fn project_row(&self, card: &ProjectCard, cx: &mut Context<Self>) -> Div {
        let id = card.id.clone();
        let open_id = card.id.clone();
        let confirming = self.pending_delete.as_deref() == Some(card.id.as_str());

        div()
            .flex()
            .flex_row()
            .items_center()
            .gap_4()
            .mb_2()
            .p_4()
            .rounded_lg()
            .bg(rgb(theme::PANEL))
            .border_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .id(SharedString::from(format!("open-{open_id}")))
                    .flex()
                    .flex_col()
                    .gap_1()
                    .flex_1()
                    .child(
                        div()
                            .text_lg()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(card.name.clone())),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(card.detail.clone())),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.open_project(&open_id, cx);
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap_1()
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(card.duration.clone())),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(card.modified.clone())),
                    ),
            )
            .child(
                div()
                    .id(SharedString::from(format!("delete-{id}")))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .bg(rgb(if confirming {
                        0x7a2f3a
                    } else {
                        theme::PANEL_ALT
                    }))
                    .text_sm()
                    .text_color(rgb(if confirming { 0xffdde3 } else { theme::MUTED }))
                    .child(if confirming { "Confirm" } else { "Delete" })
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        if this.pending_delete.as_deref() == Some(id.as_str()) {
                            this.delete_project(&id);
                        } else {
                            this.pending_delete = Some(id.clone());
                        }
                        cx.notify();
                    })),
            )
    }

    fn empty_state(&self) -> Div {
        div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .py_16()
            .rounded_lg()
            .border_1()
            .border_color(rgb(theme::BORDER))
            .child(div().text_color(rgb(theme::TEXT)).child("No projects yet"))
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::MUTED))
                    .child("Create one to start editing, or open an existing project file."),
            )
    }

    fn home(&mut self, cx: &mut Context<Self>) -> Div {
        let vm = HomeViewModel::build(&self.projects, SystemTime::now());
        let rows: Vec<Div> = vm
            .projects
            .iter()
            .map(|card| self.project_row(card, cx))
            .collect();

        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .bg(rgb(theme::BG))
            .text_color(rgb(theme::TEXT))
            .track_focus(&self.focus_handle)
            .key_context("Home")
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _window, cx| {
                if this.new_name.is_some() {
                    this.handle_name_key(&event.keystroke, cx);
                    cx.notify();
                }
            }))
            .child(
                div()
                    .id("home-scroll")
                    .w(px(880.0))
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h(px(0.0))
                    .px_8()
                    .py_10()
                    .overflow_y_scroll()
                    .child(self.header(self.projects.len(), cx))
                    .children(
                        self.library_error.clone().map(|error| {
                            self.notice(format!("Project library unavailable: {error}"))
                        }),
                    )
                    .children(self.status.clone().map(|message| self.notice(message)))
                    .children(
                        self.new_name
                            .clone()
                            .map(|name| self.new_project_row(&name, cx)),
                    )
                    .child(if rows.is_empty() {
                        self.empty_state()
                    } else {
                        div().flex().flex_col().children(rows)
                    }),
            )
    }

    fn notice(&self, message: String) -> Div {
        div()
            .mb_4()
            .px_3()
            .py_2()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_sm()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(message))
    }
}

impl Render for ViiApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.showing_editor {
            if let Some(editor) = self.editor.clone() {
                return div().size_full().child(editor);
            }
        }
        if self.needs_focus {
            self.needs_focus = false;
            window.focus(&self.focus_handle);
        }
        div().size_full().child(self.home(cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use vii_core::project::CanvasSize;

    /// A library of its own for each test — never the developer's real one.
    pub(super) fn library(tag: &str) -> ProjectLibrary {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        ProjectLibrary::with_root(std::env::temp_dir().join(format!("vii-app-{tag}-{stamp}")))
            .unwrap()
    }

    pub(super) fn app(cx: &mut TestAppContext, library: ProjectLibrary) -> Entity<ViiApp> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| ViiApp::over(Some(library), None, focus))
        })
    }

    /// Same, but with a real GPU compositor attached — `PreviewRenderer::new()` needs no
    /// window, which is how the headless MCP server renders too. `None` where there is no
    /// adapter, so the caller can skip instead of asserting against nothing.
    pub(super) fn app_with_gpu(
        cx: &mut TestAppContext,
        library: ProjectLibrary,
    ) -> Option<Entity<ViiApp>> {
        let preview = PreviewRenderer::new()?;
        Some(cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| ViiApp::over(Some(library), Some(preview), focus))
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

/// Agent routing when nothing is open — the deadlock this fixes, and the guards around it.
#[cfg(test)]
mod agent_routing_tests {
    use super::tests::*;
    use super::*;
    use gpui::TestAppContext;

    fn call(name: &str, args: serde_json::Value) -> vii_agent::ToolCall {
        vii_agent::ToolCall {
            name: name.to_string(),
            arguments: args,
        }
    }

    /// The reported bug: vii open, nothing loaded, and an agent could not get started —
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
            let vii_agent::AgentResponse::Ok(value) = response else {
                panic!("project_create was refused with nothing open: {response:?}");
            };
            assert_eq!(
                value["opened"], true,
                "the new project must open in the window"
            );
            assert_eq!(value["width"], 1080);
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
                    serde_json::json!({"content": "hello", "start": 0, "duration": 2}),
                ),
                cx,
            );
            assert!(
                matches!(response, vii_agent::AgentResponse::Ok(_)),
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
            let vii_agent::AgentResponse::Ok(value) = response else {
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
                    serde_json::json!({"content": "hi", "start": 0, "duration": 1}),
                ),
                cx,
            );
            let vii_agent::AgentResponse::Err(message) = response else {
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
            let vii_agent::AgentResponse::Ok(listed) =
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
            let vii_agent::AgentResponse::Ok(value) = response else {
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
        let out = std::env::temp_dir().join(format!("vii-agent-snap-{}.png", std::process::id()));
        let _ = std::fs::remove_file(&out);

        app.update(cx, |app, cx| {
            app.route_agent_call(
                &call("project_create", serde_json::json!({"name": "Snap"})),
                cx,
            );
            app.route_agent_call(
                &call(
                    "add_text",
                    serde_json::json!({"content": "frame", "start": 0, "duration": 2}),
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
                vii_agent::AgentResponse::Ok(value) => {
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
                vii_agent::AgentResponse::Err(message) => {
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
                matches!(response, vii_agent::AgentResponse::Err(_)),
                "a negative time must be refused: {response:?}"
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
                matches!(response, vii_agent::AgentResponse::Err(_)),
                "a missing project must be an error: {response:?}"
            );
        });
    }
}
