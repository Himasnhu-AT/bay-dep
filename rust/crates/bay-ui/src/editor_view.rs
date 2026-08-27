//! The root GPUI editor view: toolbar, media panel, preview, inspector, and timeline. Owns the
//! `bay_core::Editor` directly, so an interaction mutates it and calls `cx.notify()` to
//! re-render. All editing goes through `Command`s (undoable); clicks use direct selection.

use std::path::PathBuf;
use std::sync::Arc;

use gpui::prelude::*;
use gpui::{
    div, img, px, rgb, App, Context, Div, EventEmitter, FocusHandle, ImageSource, KeyBinding,
    KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, RenderImage,
    SharedString, Window,
};

use bay_core::blocks::{self, Panel};
use bay_core::project::library;
use bay_core::{
    AudioElement, Command, Editor, Element, ElementRef, ImageElement, MediaAsset, MediaKind,
    MediaTime, Project, Transform, VideoElement,
};
use bay_preview::waveform::WaveformCache;
use bay_preview::{CollectedFrame, PreviewRenderer};

use crate::controls::{self, ValueDrag, WidgetGesture, WidgetHost};
use crate::drag::{Drag, WidgetState};
use crate::page::{BarLayout, Page};
use crate::view_model::MediaFolder;
use crate::widgets::{self, text as shared_text};

/// What the editor tells the shell around it. Only one thing so far: the user wants to go back
/// to the project list, which is the shell's business, not the editor's.
pub enum EditorViewEvent {
    CloseRequested,
}

impl EventEmitter<EditorViewEvent> for EditorView {}

/// Resolution the compositor preview is rendered + read back at (16:9).
const PREVIEW_RENDER_W: u32 = 640;
const PREVIEW_RENDER_H: u32 = 360;

/// Which part of a clip a drag is manipulating.
#[derive(Clone, Copy, PartialEq)]
enum DragMode {
    Move,
    TrimStart,
    TrimEnd,
}

/// In-progress drag of a timeline element. What the gesture *means*; where the pointer is comes
/// from the [`Drag`] that carries it.
pub struct BlockDrag {
    reference: ElementRef,
    mode: DragMode,
    origin_start_ticks: i64,
    origin_duration_ticks: i64,
}

/// Everything the editor can be in the middle of dragging.
///
/// One enum in one slot, rather than the three parallel `Option`/`bool` fields this replaced
/// (`dragging`, `scrubbing`, `resizing_panel`) and the `if/else if` chain that had to order them.
/// The pages coming next add keyframe XY, box-select, level ride and colour wheel; each is a
/// variant and one match arm, and none of them can be live at the same time as another.
pub enum EditorDrag {
    /// Moving or trimming a clip on the timeline.
    Block(BlockDrag),
    /// Dragging the playhead. Started by a press on the ruler or on empty lane space.
    Scrub,
    /// Dragging the left panel's divider. Carries the width at the moment of the press.
    PanelWidth { start_width: f32 },
    /// A slider or a drag-number. The widget layer owns what it means; the editor only holds it.
    Value(ValueDrag<EditorView>),
}

impl WidgetGesture<EditorView> for EditorDrag {
    fn from_value_drag(drag: ValueDrag<EditorView>) -> Self {
        EditorDrag::Value(drag)
    }

    fn as_value_drag(&self) -> Option<&ValueDrag<EditorView>> {
        match self {
            EditorDrag::Value(drag) => Some(drag),
            _ => None,
        }
    }

    fn as_value_drag_mut(&mut self) -> Option<&mut ValueDrag<EditorView>> {
        match self {
            EditorDrag::Value(drag) => Some(drag),
            _ => None,
        }
    }
}

impl WidgetHost for EditorView {
    type Gesture = EditorDrag;

    fn widgets(&self) -> &WidgetState<EditorDrag> {
        &self.widgets
    }

    fn widgets_mut(&mut self) -> &mut WidgetState<EditorDrag> {
        &mut self.widgets
    }
}

/// Minimum on-screen width of a clip block, and its trim handle width.
const MIN_BLOCK_WIDTH: f32 = 10.0;
const TRIM_HANDLE_WIDTH: f32 = 7.0;

/// A saved bundle of a clip's effects + animations (in-memory motion-graphics preset).
#[derive(Clone)]
struct MotionPreset {
    name: String,
    effects: Vec<bay_core::Effect>,
    animations: std::collections::BTreeMap<String, bay_core::AnimationChannel>,
}

// Keyboard actions. Bound to keystrokes in `key_bindings()` and handled on the root element.
gpui::actions!(
    bay,
    [
        Undo,
        Redo,
        DeleteSelected,
        SplitClip,
        TogglePlay,
        SeekForward,
        SeekBackward,
        StepForward,
        StepBackward,
        GoToStart,
        GoToEnd,
        RippleDelete,
        AddMarker,
        SelectAll,
        CopyClip,
        PasteClip,
        SelectTool,
        RazorTool,
        ToggleSnap,
        ShowMedia,
        ShowCut,
        ShowMotion,
        ShowColor,
        ShowAudio,
        ShowDeliver,
    ]
);

/// The default keymap for the editor window.
pub fn key_bindings() -> Vec<KeyBinding> {
    // Bound only in the "Editor" key context; while editing text the root switches to "TextEdit",
    // so these don't fire and every keystroke goes to the text buffer instead.
    let editor = Some("Editor");
    vec![
        KeyBinding::new("cmd-z", Undo, editor),
        KeyBinding::new("cmd-shift-z", Redo, editor),
        KeyBinding::new("backspace", DeleteSelected, editor),
        KeyBinding::new("delete", DeleteSelected, editor),
        KeyBinding::new("s", SplitClip, editor),
        KeyBinding::new("space", TogglePlay, editor),
        // A frame at a time is the default, because that is the unit an edit is made in.
        // Shift is the coarse step; a second was the only step there used to be.
        KeyBinding::new("right", StepForward, editor),
        KeyBinding::new("left", StepBackward, editor),
        KeyBinding::new("shift-right", SeekForward, editor),
        KeyBinding::new("shift-left", SeekBackward, editor),
        KeyBinding::new("home", GoToStart, editor),
        KeyBinding::new("end", GoToEnd, editor),
        KeyBinding::new("shift-backspace", RippleDelete, editor),
        KeyBinding::new("m", AddMarker, editor),
        KeyBinding::new("cmd-a", SelectAll, editor),
        KeyBinding::new("cmd-c", CopyClip, editor),
        KeyBinding::new("cmd-v", PasteClip, editor),
        // The tool keys every editor uses. Unmodified letters, which is safe here because the
        // "Editor" context is swapped for "TextEdit" the moment a field opens.
        KeyBinding::new("v", SelectTool, editor),
        KeyBinding::new("c", RazorTool, editor),
        KeyBinding::new("n", ToggleSnap, editor),
        // Shift+2..7, which is what Resolve uses, and shifted because the unmodified digits are
        // the obvious home for a future "select track N". Bound in the "Editor" context like
        // everything else here, so they do not fire while a text field is open.
        KeyBinding::new("shift-2", ShowMedia, editor),
        KeyBinding::new("shift-3", ShowCut, editor),
        KeyBinding::new("shift-4", ShowMotion, editor),
        KeyBinding::new("shift-5", ShowColor, editor),
        KeyBinding::new("shift-6", ShowAudio, editor),
        KeyBinding::new("shift-7", ShowDeliver, editor),
    ]
}

use crate::geometry::TimelineGeometry;
use crate::theme;
use crate::view_model::{EditorViewModel, TrackRow};

/// Pixels per timeline second.
const DEFAULT_PIXELS_PER_SECOND: f32 = 48.0;
const MIN_ZOOM: f32 = 8.0;
const MAX_ZOOM: f32 = 400.0;
const TRACK_LABEL_WIDTH: f32 = 132.0;
const LANE_HEIGHT: f32 = 40.0;
const TICKS_PER_SECOND: i64 = 120_000;

/// Padding around the timeline panel, and the gap between a track's label and its lane.
///
/// Real numbers rather than `.p_2()`/`.gap_2()` because scrubbing turns a window-space mouse x
/// into a time, and that needs the lane's left edge as a value the code can read. These
/// constants drive the layout, so the two can't drift apart.
const TIMELINE_PADDING: f32 = 8.0;
const TRACK_GAP: f32 = 8.0;
/// Height of the ruler strip above the lanes — the scrub target.
const RULER_HEIGHT: f32 = 22.0;

/// Peaks drawn per audio clip. One bar every couple of pixels at a typical clip width — fine
/// enough to read the shape, coarse enough that the extraction is cheap. It is also half the
/// cache key: asking for a different count is a different waveform, not a reuse of this one.
const WAVEFORM_BUCKETS: usize = 48;

/// Window-space x of the left edge of every lane (and of the ruler). The timeline spans the
/// window, so its own left edge is zero.
fn lane_origin_x() -> f32 {
    TIMELINE_PADDING + TRACK_LABEL_WIDTH + TRACK_GAP
}

/// The single project file that predates the project library. Still read once at startup so a
/// project made before the library existed is adopted rather than lost.
pub fn legacy_project_path() -> std::path::PathBuf {
    bay_paths::home()
        .unwrap_or_else(std::env::temp_dir)
        .join("bay-project.json")
}

/// Where "Export Frame" writes the composited still.
fn export_frame_path() -> std::path::PathBuf {
    bay_paths::output_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("bay-frame.png")
}

/// Where "Export Video" writes the encoded timeline — somewhere the user will actually find
/// it, not the current working directory (which on a double-clicked app is anyone's guess).
fn export_video_path() -> std::path::PathBuf {
    bay_paths::output_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("bay-export.mp4")
}
/// What bay could install but has not, as toolbar offers.
///
/// A component already satisfied by something the user installed themselves — a Homebrew
/// ffmpeg, a venv from the old setup script — produces no offer. Nagging someone to download
/// 57 MB they already have is how a helpful button becomes an annoying one.
fn runtime_offers() -> Vec<RuntimeOffer> {
    bay_provision::report()
        .components
        .iter()
        .filter(|plan| !plan.satisfied && !plan.unsupported)
        .map(|plan| RuntimeOffer {
            element_id: match plan.component.as_str() {
                "video" => "install-video",
                "speech" => "install-speech",
                "sfx" => "install-sfx",
                "vision" => "install-vision",
                _ => "install-runtime",
            },
            id: plan.component.clone(),
            // `disk_bytes`, not `download_bytes`. For narration those differ by ~28x: the two
            // pinned archives are 43 MB, but uv then resolves ~1 GB of wheels and the model
            // pulls ~330 MB more — none of which is a pinned artifact, so none of it is counted
            // in the download figure. A button reading "Install narration (43 MB)" in front of
            // a 1.2 GB operation is not a rounding error, it is the wrong number. The download
            // total still drives the progress bar, where it is the honest one.
            label: format!(
                "Install {} ({})",
                plan.title.to_lowercase(),
                bay_provision::human_bytes(plan.disk_bytes.max(plan.download_bytes))
            ),
        })
        .collect()
}

/// One line describing a running install.
fn describe_progress(state: &bay_provision::jobs::JobState) -> String {
    if let Some(error) = &state.error {
        // The whole error, not a summary: a digest mismatch names both digests, and a truncated
        // version of that is useless to everyone who reads it.
        return format!("Install failed — {error}");
    }
    if state.finished {
        return format!("{} installed.", state.component);
    }
    match state.fraction() {
        Some(fraction) => format!(
            "{} — {}% of {}",
            state.message,
            (fraction * 100.0).round() as u32,
            bay_provision::human_bytes(state.total_bytes)
        ),
        None => state.message.clone(),
    }
}

/// What a press on a clip does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tool {
    /// Select, move and trim. The default.
    Select,
    /// Cut a clip at the point clicked. A tool rather than a modifier because "cut here" is a
    /// mode an editor stays in for a run of cuts, and holding a key for each one is worse.
    Razor,
}

/// The left panel's default, minimum and maximum widths.
///
/// The floor is where a two-column media grid stops being legible; the ceiling is where the
/// panel starts eating the preview, which is the thing the user is actually looking at.
const DEFAULT_PANEL_WIDTH: f32 = 264.0;
const MIN_PANEL_WIDTH: f32 = 180.0;
const MAX_PANEL_WIDTH: f32 = 420.0;

/// Seconds as `h:mm:ss:ff` at 30 fps.
///
/// The transport shows frames, not decimals: an editor picks a cut by frame number, and
/// "2.43 s" cannot be typed back into anything.
fn timecode(seconds: f64) -> String {
    const FPS: i64 = 30;
    let frames = (seconds.max(0.0) * FPS as f64).round() as i64;
    let ff = frames % FPS;
    let s = (frames / FPS) % 60;
    let m = (frames / (FPS * 60)) % 60;
    let h = frames / (FPS * 3600);
    format!("{h}:{m:02}:{s:02}:{ff:02}")
}

/// Inspector nudge step (0.5s) and minimum element duration (0.1s), in ticks.
const NUDGE_TICKS: i64 = TICKS_PER_SECOND / 2;
const MIN_DURATION_TICKS: i64 = TICKS_PER_SECOND / 10;

pub struct EditorView {
    editor: Editor,
    add_counter: u64,
    playing: bool,
    last_frame: Option<std::time::Instant>,
    focus_handle: FocusHandle,
    needs_focus: bool,
    /// The one gesture in flight, and the one popover open. See [`crate::drag`].
    widgets: WidgetState<EditorDrag>,
    /// The zoom and scroll of the timeline on the page currently showing.
    ///
    /// One *value*, not two fields — see [`crate::geometry::TimelineState`]. The pages that are
    /// not showing keep theirs in [`Self::page_timelines`].
    timeline: crate::geometry::TimelineState,
    /// GPU compositor preview (None if no adapter); the rendered image + a change signature.
    preview: Option<PreviewRenderer>,
    preview_image: Option<Arc<RenderImage>>,
    /// Preview frames that have left the screen and whose sprite-atlas tiles still have to be
    /// released. The rule, and why it is not optional, is on [`crate::draw::RetiredImages`] —
    /// stated once there because the scope panels are about to inherit it.
    retired_images: crate::draw::RetiredImages,
    preview_sig: Option<u64>,
    presets: Vec<MotionPreset>,
    /// Waveform peaks for the audio lanes. The cache itself lives in `bay-preview`; this is a
    /// handle. Extraction runs on workers, so a clip draws bare until its peaks arrive.
    waveforms: WaveformCache,
    /// Audio output (kept alive) + the current playing sink + decoded-PCM cache.
    audio_output: Option<(rodio::OutputStream, rodio::OutputStreamHandle)>,
    audio_sink: Option<rodio::Sink>,
    audio_cache: std::collections::HashMap<String, std::sync::Arc<bay_audio::AudioPcm>>,
    /// When editing a text clip: (element ref, current edit buffer).
    editing_text: Option<(ElementRef, String)>,
    /// Last user-facing status/error. Until now every failure (a discarded export, a failed
    /// save, an unavailable ffprobe) was swallowed with `let _ =`, so the app looked broken
    /// with no explanation.
    status: Option<String>,
    /// What an AI agent last did, and when — drives the "Claude is editing" chip. The chip
    /// clears itself on the animation-frame loop that already runs for playback and decodes.
    agent_activity: Option<(String, std::time::Instant)>,
    /// The library file this project is being edited in. Saves go here, so the launcher's list
    /// reflects the work; `None` only if the library could not be opened at all.
    project_path: Option<PathBuf>,
    /// Runtimes bay could install but has not — one entry per offer shown in the toolbar.
    ///
    /// Cached rather than recomputed per frame: working it out stats a dozen paths and resolves
    /// ffmpeg, which is fine once and wasteful sixty times a second. Refreshed when an install
    /// finishes, which is the only thing that can change the answer while the window is open.
    runtime_offers: Vec<RuntimeOffer>,
    /// The install currently running, if any. At most one: the button hides itself while a job
    /// is in flight, so a user cannot start the same 1.2 GB download twice.
    provision_job: Option<bay_provision::jobs::JobId>,
    /// Which left-panel tab is open: the library, or one of the block palettes.
    panel: Panel,
    /// The left panel's width. Draggable, because a media grid and a list of transitions want
    /// very different amounts of room and neither is right for both.
    media_width: f32,
    /// Whether a drag snaps to clip edges, markers and the playhead. On by default, because
    /// butt-joining two clips by eye at 48 px/s is a fight; off for the moments when the
    /// intended cut is two frames from something the snap keeps stealing it towards.
    snapping: bool,
    /// The pointer tool. Razor turns a click on a clip into a split at that time.
    tool: Tool,
    /// Library groups the user has collapsed. Stored as the closed set so a newly appearing
    /// group is open — a folder that arrives collapsed hides the file that just landed in it.
    collapsed_folders: std::collections::BTreeSet<String>,
    /// The widget and drawing spike panel. `Some` only when `BAY_UI_LAB=1` is set, so with the
    /// variable unset none of it is constructed and none of it is drawn.
    lab: Option<crate::lab::Lab>,
    /// Which of the six pages is showing.
    ///
    /// A page is a *method* on this struct, not its own GPUI view — see [`crate::page`]. That is
    /// why the playhead, the preview and its atlas bookkeeping, the audio output, the waveform
    /// cache and the undo history all survive a page switch without a line of code to carry them.
    page: Page,
    /// Each page's own zoom and scroll, remembered while you are elsewhere.
    ///
    /// Keyed by page, because a whole-programme overview and a frame-accurate detail view are
    /// different questions about the same film and answering both with one zoom means neither is
    /// right. The page currently showing reads [`Self::timeline`] instead; this is where the
    /// others wait.
    page_timelines: std::collections::BTreeMap<Page, crate::geometry::TimelineState>,
}

impl crate::lab::LabHost for EditorView {
    fn lab_mut(&mut self) -> &mut crate::lab::Lab {
        self.lab.get_or_insert_with(Default::default)
    }
}

/// Something bay can install, as the toolbar needs it.
#[derive(Debug, Clone)]
struct RuntimeOffer {
    id: String,
    /// A stable, distinct gpui element id. `button` takes `&'static str`, and the component ids
    /// are known at compile time, so this maps the two rather than leaking a String.
    element_id: &'static str,
    /// "Install narration (1.2 GB)" — the size belongs in the label, not behind a dialog. It is
    /// the only fact that changes the decision.
    label: String,
}

impl gpui::Focusable for EditorView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl EditorView {
    pub fn new(
        editor: Editor,
        focus_handle: FocusHandle,
        preview: Option<PreviewRenderer>,
        project_path: Option<PathBuf>,
    ) -> Self {
        Self {
            project_path,
            editor,
            add_counter: 0,
            playing: false,
            last_frame: None,
            focus_handle,
            needs_focus: true,
            widgets: WidgetState::new(),
            timeline: crate::geometry::TimelineState::default(),
            preview,
            preview_image: None,
            retired_images: crate::draw::RetiredImages::new(),
            preview_sig: None,
            presets: Vec::new(),
            waveforms: WaveformCache::new(),
            audio_output: rodio::OutputStream::try_default().ok(),
            audio_sink: None,
            audio_cache: std::collections::HashMap::new(),
            editing_text: None,
            status: None,
            agent_activity: None,
            runtime_offers: runtime_offers(),
            provision_job: None,
            snapping: true,
            tool: Tool::Select,
            panel: Panel::Media,
            media_width: DEFAULT_PANEL_WIDTH,
            collapsed_folders: std::collections::BTreeSet::new(),
            lab: crate::lab::enabled().then(crate::lab::Lab::default),
            page: Page::default(),
            page_timelines: std::collections::BTreeMap::new(),
        }
    }

    /// Switch pages, parking the timeline this page was using and picking up the next one's.
    ///
    /// The playhead is deliberately *not* touched. `pages.md`: the global playhead surviving a
    /// page switch is the single behaviour that makes six pages feel like one application rather
    /// than six tools.
    fn show_page(&mut self, page: Page) {
        if self.page == page {
            return;
        }
        self.page_timelines.insert(self.page, self.timeline);
        self.timeline = self
            .page_timelines
            .get(&page)
            .copied()
            .unwrap_or(self.timeline);
        self.page = page;
        // A gesture that began on the page being left has nothing to finish onto.
        self.widgets.cancel();
    }

    /// Start installing `component`, and follow it in the status line.
    ///
    /// The download runs on its own thread inside the provisioner; this only polls it. Polling
    /// rather than a channel because the job outlives any one view — if the user closes the
    /// project mid-download the bytes keep arriving, and reopening picks the progress back up.
    fn install_runtime(&mut self, component: &str, cx: &mut Context<Self>) {
        let id = match bay_provision::jobs::start(component) {
            Ok(id) => id,
            Err(error) => {
                self.status = Some(format!("Cannot install: {error}"));
                cx.notify();
                return;
            }
        };
        self.provision_job = Some(id);
        self.status = Some("Starting…".to_string());
        cx.notify();

        cx.spawn(async move |this, cx| {
            loop {
                // Slow enough not to spin the main thread, quick enough that a progress bar
                // reads as live rather than stepped.
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(400))
                    .await;
                let Some(state) = bay_provision::jobs::state(id) else {
                    break;
                };
                let finished = state.finished;
                let update = this.update(cx, |view, cx| {
                    view.status = Some(describe_progress(&state));
                    if finished {
                        view.provision_job = None;
                        // The offer disappears only once the files are actually there — the
                        // list is recomputed from disk, not from "the job said it worked".
                        view.runtime_offers = runtime_offers();
                    }
                    cx.notify();
                });
                if finished || update.is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    /// Switch the editor to another project from the library. Per-project caches (waveforms,
    /// decoded audio, the selection, the transport) are dropped — keeping them would show the
    /// previous project's audio under the new one's clips whenever media ids collide.
    pub fn open_project(&mut self, project: Project, path: Option<PathBuf>) {
        self.stop_audio();
        self.editor.load_project(project);
        self.project_path = path;
        self.playing = false;
        self.last_frame = None;
        self.widgets.cancel();
        self.editing_text = None;
        self.waveforms.clear();
        self.audio_cache.clear();
        self.retire_preview_image();
        // A composite of the *previous* project may still be on the GPU. Collected, it would be
        // installed as this project's first frame.
        if let Some(preview) = self.preview.as_mut() {
            preview.discard_composite();
        }
        self.preview_sig = None;
        self.status = None;
        self.needs_focus = true;
    }

    pub fn project_name(&self) -> &str {
        &self.editor.project().metadata.name
    }

    /// Write the project back to its library slot. Returns the error text on failure so callers
    /// can decide whether to show it or (when closing) refuse to leave.
    pub(crate) fn save_project(&mut self) -> Result<PathBuf, String> {
        let path = self
            .project_path
            .clone()
            .unwrap_or_else(legacy_project_path);
        library::write_project(&path, self.editor.project())
            .map(|()| path)
            .map_err(|error| error.to_string())
    }

    /// Apply one agent tool call to this editor, on the main thread.
    ///
    /// This is the single-writer point: an agent never touches the project, it hands over
    /// `Command`s that are applied here exactly as a human's would be. So the edit shows up in
    /// the timeline immediately, and `⌘Z` undoes it.
    pub fn apply_agent_call(
        &mut self,
        call: &bay_agent::ToolCall,
        cx: &mut Context<Self>,
    ) -> bay_agent::AgentResponse {
        use bay_agent::{AgentResponse, Planned};

        // Tools that need the GPU or the file system rather than the project model. They stay
        // here rather than in the planner because the planner is pure — it returns commands,
        // and these produce a file.
        match call.name.as_str() {
            "snapshot" => return self.agent_snapshot(&call.arguments),
            "project_save" => return self.agent_save(),
            _ => {}
        }

        let planned = match bay_agent::plan(&call.name, &call.arguments, self.editor.project()) {
            Ok(planned) => planned,
            Err(message) => return AgentResponse::Err(message),
        };

        match planned {
            // A read changes nothing, so it must not light the indicator or repaint.
            Planned::Read(value) => AgentResponse::Ok(value),
            Planned::Tx {
                label,
                commands,
                scene_id,
                new_ids,
            } => {
                // The plan was made against a snapshot of one scene. `ProjectPatch` applies to
                // whichever scene is active now, and `ElementRef` carries no scene — so if the
                // user switched scenes while the agent was thinking, applying would silently
                // edit the wrong timeline.
                if scene_id != self.editor.active_scene_id() {
                    return AgentResponse::Err(format!(
                        "the editor moved to a different scene while this was being planned \
                         (planned against {scene_id:?}); read the timeline again and retry"
                    ));
                }

                let mut applied = 0usize;
                for command in commands {
                    if self.editor.execute(command) {
                        applied += 1;
                    }
                }
                if applied == 0 {
                    return AgentResponse::Err(
                        "the editor accepted the plan but nothing changed".into(),
                    );
                }

                self.agent_activity = Some((label.clone(), std::time::Instant::now()));
                cx.notify();
                AgentResponse::Ok(serde_json::json!({
                    "applied": applied,
                    "tool": label,
                    "ids": new_ids,
                    "durationSeconds": self.editor.duration().to_seconds_f64(),
                }))
            }
        }
    }

    /// Handle a keystroke while editing a text clip's content. Commits on Enter, cancels on Escape.
    fn handle_text_key(&mut self, keystroke: &gpui::Keystroke) {
        match keystroke.key.as_str() {
            "enter" => {
                if let Some((reference, content)) = self.editing_text.take() {
                    self.editor
                        .execute(Command::SetTextContent { reference, content });
                }
            }
            "escape" => self.editing_text = None,
            "backspace" => {
                if let Some((_, buffer)) = self.editing_text.as_mut() {
                    buffer.pop();
                }
            }
            "space" => {
                if let Some((_, buffer)) = self.editing_text.as_mut() {
                    buffer.push(' ');
                }
            }
            _ => {
                if let (Some((_, buffer)), Some(ch)) =
                    (self.editing_text.as_mut(), keystroke.key_char.as_ref())
                {
                    buffer.push_str(ch);
                }
            }
        }
    }

    /// Start playing the first active, non-muted audio clip from the playhead.
    fn start_audio(&mut self) {
        const SAMPLE_RATE: u32 = 44_100;
        let Some(handle) = self.audio_output.as_ref().map(|(_, h)| h.clone()) else {
            return;
        };
        let playhead_sec = self.editor.playhead().to_seconds_f64();
        let total_sec = (self.editor.duration().to_seconds_f64() - playhead_sec).max(0.0);
        if total_sec <= 0.0 {
            return;
        }

        // Every non-muted audio clip still sounding at/after the playhead contributes to the mix.
        struct Active {
            media_id: String,
            start_sec: f64,
            end_sec: f64,
            /// In-point into the source file, in seconds.
            trim_start_sec: f64,
            volume: f32,
            /// The clip's level over its own length — fades and any volume keyframes,
            /// sampled from the model so preview and export agree.
            gain_points: Vec<(f64, f32)>,
        }
        let active: Vec<Active> = {
            let scene = self.editor.active_scene();
            let mut clips = Vec::new();
            for track in &scene.tracks.audio {
                if track.muted {
                    continue;
                }
                for element in &track.elements {
                    if let bay_core::Element::Audio(audio) = element {
                        let end_sec = element.end().to_seconds_f64();
                        if audio.muted || end_sec <= playhead_sec {
                            continue;
                        }
                        clips.push(Active {
                            media_id: audio.media_id.clone(),
                            start_sec: element.start().to_seconds_f64(),
                            end_sec,
                            trim_start_sec: audio.trim_start.to_seconds_f64().max(0.0),
                            volume: audio.volume,
                            gain_points: element.gain_points(),
                        });
                    }
                }
            }
            clips
        };
        if active.is_empty() {
            return;
        }

        // Decode each referenced media once (cached across seeks/plays).
        for clip in &active {
            if self.audio_cache.contains_key(&clip.media_id) {
                continue;
            }
            if let Some(path) = self
                .editor
                .project()
                .media_path(&clip.media_id)
                .map(|s| s.to_string())
            {
                if let Some(pcm) = bay_audio::decode_pcm(&path, SAMPLE_RATE) {
                    self.audio_cache
                        .insert(clip.media_id.clone(), std::sync::Arc::new(pcm));
                }
            }
        }

        // Mix all decoded clips into one buffer starting at the playhead (borrow ends with block).
        let mixed = {
            let specs: Vec<bay_audio::MixClip> = active
                .iter()
                .filter_map(|clip| {
                    let pcm = self.audio_cache.get(&clip.media_id)?;
                    Some(bay_audio::MixClip {
                        pcm: pcm.as_ref(),
                        // Where in the file to start reading: the clip's own in-point, plus
                        // however far the playhead already is into the clip.
                        src_start_secs: clip.trim_start_sec
                            + (playhead_sec - clip.start_sec).max(0.0),
                        dst_start_secs: (clip.start_sec - playhead_sec).max(0.0),
                        play_secs: clip.end_sec - clip.start_sec.max(playhead_sec),
                        volume: clip.volume.clamp(0.0, 2.0),
                        // Read against the clip's own timeline, so pressing play halfway
                        // through a fade hears the middle of the fade, not the start of it.
                        envelope: (clip.gain_points.len() > 1).then(|| bay_audio::GainEnvelope {
                            clip_offset_secs: (playhead_sec - clip.start_sec).max(0.0),
                            points: clip.gain_points.clone(),
                        }),
                    })
                })
                .collect();
            if specs.is_empty() {
                return;
            }
            bay_audio::mix_stereo(&specs, SAMPLE_RATE, total_sec)
        };

        let source = rodio::buffer::SamplesBuffer::new(2, SAMPLE_RATE, mixed);
        if let Ok(sink) = rodio::Sink::try_new(&handle) {
            sink.append(source);
            sink.play();
            self.audio_sink = Some(sink);
        }
    }

    fn stop_audio(&mut self) {
        if let Some(sink) = self.audio_sink.take() {
            sink.stop();
        }
    }

    /// Ask for a waveform for every audio clip on the timeline, and collect any that finished.
    ///
    /// Called from `render`, so it must not decode: extraction spawns ffmpeg and reads the whole
    /// file, which on a long clip froze the frame for seconds. The cache starts a worker and
    /// returns; `render` draws whatever has arrived. Same contract as the video decode path.
    fn request_waveforms(&mut self) {
        // Disjoint field borrows: &mut self.waveforms and &self.editor.
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        self.waveforms.request_scene(scene, media, WAVEFORM_BUCKETS);
    }

    /// Save the selected clip's effects + animations as an in-memory motion preset.
    fn save_preset(&mut self) {
        let captured = self.editor.selected_element().map(|element| {
            (
                element.effects().to_vec(),
                element.animations().cloned().unwrap_or_default(),
            )
        });
        if let Some((effects, animations)) = captured {
            if effects.is_empty() && animations.is_empty() {
                return;
            }
            let name = format!("Preset {}", self.presets.len() + 1);
            self.presets.push(MotionPreset {
                name,
                effects,
                animations,
            });
        }
    }

    /// Save the selected clips as a template in the library, so they can be placed again in
    /// this project or any other.
    ///
    /// The motion presets above live in this window and die with it — useful until the app is
    /// closed, which is not really a preset at all. A template is written to disk.
    fn save_template(&mut self) {
        let selected: Vec<bay_core::Element> = self
            .editor
            .selection()
            .iter()
            .filter_map(|reference| self.editor.active_scene().element(reference).cloned())
            .collect();
        if selected.is_empty() {
            self.status = Some("Select the clips to save as a template first.".into());
            return;
        }
        let Some(library) = bay_core::project::TemplateLibrary::open_default() else {
            self.status = Some("No data directory, so there is nowhere to save a template.".into());
            return;
        };

        // Times are stored relative to the template's own start, so placing it later does not
        // require rewriting every time inside it.
        let origin = selected
            .iter()
            .map(|element| element.start())
            .min()
            .unwrap_or(MediaTime::ZERO);
        let elements: Vec<bay_core::Element> = selected
            .iter()
            .map(|element| {
                let mut relative = element.clone();
                relative.set_start(MediaTime::from_ticks(
                    element.start().as_ticks() - origin.as_ticks(),
                ));
                relative
            })
            .collect();
        // Every title in the bundle is a slot worth filling when it is placed again.
        let text_slots = elements
            .iter()
            .filter(|element| matches!(element, bay_core::Element::Text(_)))
            .map(|element| element.id().to_string())
            .collect();

        self.add_counter += 1;
        let id = format!("saved-{}", self.add_counter);
        let template = bay_core::project::Template {
            name: format!("Template {}", self.add_counter),
            description: format!("{} element(s) saved from this project", elements.len()),
            id: id.clone(),
            elements,
            text_slots,
        };
        self.status = Some(match library.save(&template) {
            Ok(path) => format!("Saved template {id} to {}", path.display()),
            Err(error) => format!("Could not save the template: {error}"),
        });
    }

    /// Apply a saved preset to the selected clip (minting fresh effect ids), one undo step.
    fn apply_preset(&mut self, index: usize) {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return;
        };
        let Some(preset) = self.presets.get(index).cloned() else {
            return;
        };
        let mut effects = Vec::with_capacity(preset.effects.len());
        for effect in preset.effects {
            self.add_counter += 1;
            effects.push(bay_core::Effect {
                id: format!("fx-{}", self.add_counter),
                ..effect
            });
        }
        self.editor.execute(Command::ApplyMotionPreset {
            reference,
            effects,
            animations: preset.animations,
        });
    }

    /// A cheap signature of everything that affects the composited preview.
    fn preview_signature(&self) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        let playhead = self.editor.playhead();
        playhead.as_ticks().hash(&mut hasher);
        self.editor.active_scene_id().hash(&mut hasher);
        if let bay_core::Background::Color { color } = &self.editor.project().settings.background {
            color.hash(&mut hasher);
        }
        let scene = self.editor.active_scene();
        for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
            if track.hidden {
                continue;
            }
            for element in &track.elements {
                if let Some(t) = element.transform() {
                    if element.start() <= playhead && playhead < element.end() {
                        element.id().hash(&mut hasher);
                        [
                            t.x.to_bits(),
                            t.y.to_bits(),
                            t.scale.to_bits(),
                            t.rotation.to_bits(),
                            t.opacity.to_bits(),
                        ]
                        .hash(&mut hasher);
                        element.blend_mode().hash(&mut hasher);
                        // Text content/style must be in the signature or the preview goes stale
                        // while the user types — which silently defeats inline text editing.
                        if let bay_core::Element::Text(text) = element {
                            text.content.hash(&mut hasher);
                            text.color.hash(&mut hasher);
                            text.font_size.to_bits().hash(&mut hasher);
                        }
                        for effect in element.effects() {
                            effect.id.hash(&mut hasher);
                            effect.effect_type.hash(&mut hasher);
                            effect.enabled.hash(&mut hasher);
                            for (key, value) in &effect.params {
                                key.hash(&mut hasher);
                                value.to_bits().hash(&mut hasher);
                            }
                        }
                        if let Some(animations) = element.animations() {
                            for (property, channel) in animations {
                                property.hash(&mut hasher);
                                for key in &channel.keys {
                                    key.time.as_ticks().hash(&mut hasher);
                                    key.value.to_bits().hash(&mut hasher);
                                }
                            }
                        }
                    }
                }
            }
        }
        hasher.finish()
    }

    /// Move the on-screen preview frame to the retirement queue. Not a drop: the atlas tile it
    /// owns outlives the `Arc` and is only released by [`Self::release_retired_images`].
    fn retire_preview_image(&mut self) {
        if let Some(image) = self.preview_image.take() {
            self.retired_images.retire(image);
        }
    }

    /// Release the sprite-atlas tiles of every frame that has left the screen.
    ///
    /// Called at the top of `render`, before the element tree is rebuilt, so the only image this
    /// can free is one that was last painted in a frame already submitted — never the one this
    /// frame is about to draw.
    fn release_retired_images(&mut self, window: &mut Window) {
        self.retired_images.release(window);
    }

    /// Collect a finished composite and submit a new one if anything affecting it changed.
    ///
    /// Two halves, in that order, because the compositor is pipelined: the frame shown now was
    /// submitted on an earlier tick. Collecting first also frees the single staging buffer that
    /// the submit below needs.
    fn update_preview(&mut self) {
        if self.preview.is_none() {
            return;
        }

        // --- collect ---
        let collected = self.preview.as_mut().unwrap().collect_composite();
        match collected {
            CollectedFrame::Ready(frame) => {
                if let Some(buffer) =
                    image::RgbaImage::from_raw(frame.width, frame.height, frame.bgra)
                {
                    let render_image = RenderImage::new(vec![image::Frame::new(buffer)]);
                    // The frame being replaced has to give its atlas tile back. Assigning over
                    // it would drop the `Arc` and leak the tile — see `draw::RetiredImages`.
                    self.retired_images
                        .replace(&mut self.preview_image, Some(Arc::new(render_image)));
                }
            }
            // A frame the GPU could not produce (device loss on a laptop that slept) leaves the
            // last good one on screen. Showing nothing, or a black rectangle, would look like
            // the project is empty rather than like the GPU hiccuped.
            //
            // Clearing the signature is what makes that a hiccup rather than a permanent freeze:
            // leaving it set means this scene counts as already drawn and every later tick
            // returns early — forever, even after the GPU recovers.
            CollectedFrame::Failed => self.preview_sig = None,
            // Still compositing. `render` keeps asking for frames while a readback is pending,
            // so this is a tick to wait, not a reason to give up on the frame.
            CollectedFrame::Pending => return,
            CollectedFrame::Idle => {}
        }

        // --- submit ---
        let signature = self.preview_signature();
        // A decode finishing on a worker thread does NOT change the signature (the project is
        // unchanged), so while any decode is in flight we must re-composite unconditionally —
        // otherwise the placeholder would never be replaced by the real frame.
        let awaiting_decode = self
            .preview
            .as_ref()
            .is_some_and(|p| p.has_pending_decodes());
        if self.preview_sig == Some(signature) && !awaiting_decode {
            return;
        }

        let playhead = self.editor.playhead();
        let background = self.editor.project().settings.background.clone();
        // Disjoint field borrows: &mut self.preview and &self.editor.
        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let submitted = renderer.submit_composite(
            scene,
            playhead,
            PREVIEW_RENDER_W,
            PREVIEW_RENDER_H,
            &background,
            media,
        );
        // Only claim this scene is drawn once its composite is actually on the GPU. Recording
        // the signature for a submit that never happened would mean no later tick re-tries it.
        self.preview_sig = submitted.then_some(signature);
    }

    /// The edge a drag is actually moving, after snapping — and the delta in pixels that
    /// produces it, so the block under the pointer and the edit that commits cannot disagree.
    ///
    /// Snapping is applied here rather than at the drop so the user *sees* the clip jump onto
    /// its neighbour's edge while dragging. A snap you only discover after letting go is
    /// indistinguishable from the editor moving your clip on its own.
    fn snapped_delta_px(&self, drag: &BlockDrag, delta_px: f32) -> f32 {
        if !self.snapping {
            return delta_px;
        }
        let geometry = self.geometry();
        let raw_ticks = geometry.delta_px_to_ticks(delta_px).as_ticks();
        // Which edge the pointer is carrying: the head for a move or a start-trim, the tail
        // for an end-trim.
        let moving_edge = match drag.mode {
            DragMode::Move | DragMode::TrimStart => drag.origin_start_ticks + raw_ticks,
            DragMode::TrimEnd => drag.origin_start_ticks + drag.origin_duration_ticks + raw_ticks,
        };
        let targets = self
            .editor
            .active_scene()
            .snap_targets(Some(&drag.reference));
        // The playhead is a target too: cutting to where you are looking is the common case.
        let mut targets = targets;
        targets.push(self.editor.playhead());
        let (snapped, did_snap) = crate::geometry::snap_time(
            MediaTime::from_ticks(moving_edge),
            &targets,
            self.timeline.pixels_per_second(),
        );
        if !did_snap {
            return delta_px;
        }
        let corrected_ticks = snapped.as_ticks() - moving_edge;
        delta_px + geometry.delta_ticks_to_px(MediaTime::from_ticks(corrected_ticks))
    }

    /// The snapped delta of whichever block gesture is live, if one is. The single reader of the
    /// drag slot for timeline geometry, so the block being drawn and the edit that commits are
    /// computed the same way.
    fn block_drag(&self) -> Option<(&BlockDrag, f32)> {
        let drag = self.widgets.active()?;
        match &drag.kind {
            EditorDrag::Block(block) => Some((block, self.snapped_delta_px(block, drag.dx()))),
            _ => None,
        }
    }

    /// Finish a block drag: commit a single undoable edit (move or edge-trim) from origin to
    /// drop point.
    fn finish_drag(&mut self, drag: BlockDrag, delta_px: f32) {
        let delta_px = self.snapped_delta_px(&drag, delta_px);
        let delta_ticks =
            (delta_px / self.timeline.pixels_per_second() * TICKS_PER_SECOND as f32) as i64;
        if delta_ticks == 0 {
            return;
        }
        match drag.mode {
            DragMode::Move => {
                let new_start = (drag.origin_start_ticks + delta_ticks).max(0);
                // Everything else in the selection moves by the same amount, so dragging one
                // clip of a group carries the group rather than tearing it apart.
                let others: Vec<ElementRef> = self
                    .editor
                    .selection()
                    .iter()
                    .filter(|reference| **reference != drag.reference)
                    .cloned()
                    .collect();
                for reference in others {
                    let current = self
                        .editor
                        .active_scene()
                        .element(&reference)
                        .map(|element| element.start().as_ticks());
                    if let Some(start) = current {
                        self.editor.execute(Command::MoveElement {
                            reference,
                            start: MediaTime::from_ticks((start + delta_ticks).max(0)),
                        });
                    }
                }
                self.editor.execute(Command::MoveElement {
                    reference: drag.reference,
                    start: MediaTime::from_ticks(new_start),
                });
            }
            DragMode::TrimStart => {
                let new_start = (drag.origin_start_ticks + delta_ticks).max(0);
                let consumed = new_start - drag.origin_start_ticks;
                let new_duration = (drag.origin_duration_ticks - consumed).max(MIN_DURATION_TICKS);
                self.editor.execute(Command::TrimElement {
                    reference: drag.reference,
                    start: MediaTime::from_ticks(new_start),
                    duration: MediaTime::from_ticks(new_duration),
                });
            }
            DragMode::TrimEnd => {
                let new_duration =
                    (drag.origin_duration_ticks + delta_ticks).max(MIN_DURATION_TICKS);
                self.editor.execute(Command::TrimElement {
                    reference: drag.reference,
                    start: MediaTime::from_ticks(drag.origin_start_ticks),
                    duration: MediaTime::from_ticks(new_duration),
                });
            }
        }
    }

    /// Begin a playhead scrub, and seek to where the press landed.
    ///
    /// The ruler and the empty lane both do this; the *continuation* is the root's move handler,
    /// not either of them, because the pointer leaves the ruler's few pixels almost immediately
    /// and a scrub that stops when it does is unusable.
    fn begin_scrub(&mut self, event: &MouseDownEvent) {
        self.widgets.begin(Drag::new(
            EditorDrag::Scrub,
            event.position,
            event.modifiers,
        ));
        self.scrub_to(f32::from(event.position.x));
    }

    /// The one place a moving pointer is interpreted.
    ///
    /// `fine` is the live Alt state rather than the one from the press: it changes a widget's
    /// rate from here on and must not be frozen at the moment the button went down.
    fn pointer_moved(
        &mut self,
        position: gpui::Point<gpui::Pixels>,
        fine: bool,
        cx: &mut Context<Self>,
    ) {
        if controls::drive_value_drag(self, position, fine, cx) {
            return;
        }
        let Some(drag) = self.widgets.pointer_moved(position) else {
            return;
        };
        // Read what the gesture needs before touching `self` — the gesture lives in it.
        let panel_width = match &drag.kind {
            EditorDrag::PanelWidth { start_width } => Some(start_width + drag.dx()),
            _ => None,
        };
        let scrub_x = matches!(drag.kind, EditorDrag::Scrub).then(|| f32::from(position.x));

        if let Some(wanted) = panel_width {
            self.media_width = wanted.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
        }
        if let Some(x) = scrub_x {
            self.scrub_to(x);
        }
        // A block drag needs nothing committed until release; the redraw is what moves it.
        cx.notify();
    }

    /// The one place a released pointer is interpreted. Committing happens here, so a gesture
    /// that was never released has changed nothing undoable.
    fn pointer_released(
        &mut self,
        position: gpui::Point<gpui::Pixels>,
        fine: bool,
        cx: &mut Context<Self>,
    ) {
        if controls::end_value_drag(self, position, fine, cx) {
            return;
        }
        let Some(drag) = self.widgets.end(position) else {
            return;
        };
        let delta_px = drag.dx();
        if let EditorDrag::Block(block) = drag.kind {
            self.finish_drag(block, delta_px);
        }
        cx.notify();
    }

    /// Build the mouse-down listener that begins a drag in `mode` for `reference`.
    #[allow(clippy::type_complexity)]
    fn begin_drag(
        &self,
        reference: ElementRef,
        mode: DragMode,
        origin_start_ticks: i64,
        origin_duration_ticks: i64,
        cx: &mut Context<Self>,
    ) -> Box<dyn Fn(&MouseDownEvent, &mut Window, &mut App) + 'static> {
        Box::new(
            cx.listener(move |this, event: &MouseDownEvent, _window, cx| {
                // The lane underneath scrubs the playhead on a press. Grabbing a clip is not
                // also a request to move the playhead, so the event stops here.
                cx.stop_propagation();
                // With the razor out, a press is a cut at the point clicked — not the start of
                // a drag. Handled here rather than in a separate handler so the razor cannot
                // also begin a move the user did not ask for.
                if this.tool == Tool::Razor {
                    this.editor.select(vec![reference.clone()]);
                    this.split_at_x(&reference, f32::from(event.position.x));
                    cx.notify();
                    return;
                }
                // Shift adds to the selection instead of replacing it, so several clips can
                // be moved or deleted as one.
                if event.modifiers.shift {
                    let mut selection = this.editor.selection().to_vec();
                    match selection.iter().position(|other| *other == reference) {
                        Some(index) => {
                            selection.remove(index);
                        }
                        None => selection.push(reference.clone()),
                    }
                    this.editor.select(selection);
                } else if !this.editor.is_selected(&reference) {
                    // Grabbing a clip that is already part of a group keeps the group, so a
                    // drag moves all of it.
                    this.editor.select(vec![reference.clone()]);
                }
                this.widgets.begin(Drag::new(
                    EditorDrag::Block(BlockDrag {
                        reference: reference.clone(),
                        mode,
                        origin_start_ticks,
                        origin_duration_ticks,
                    }),
                    event.position,
                    event.modifiers,
                ));
                cx.notify();
            }),
        )
    }

    fn delete_selected(&mut self) {
        for reference in self.editor.selection().to_vec() {
            self.editor.execute(Command::RemoveElement { reference });
        }
    }

    /// Delete and close the hole: every later clip on the same lane moves back by the removed
    /// clip's length. This is the delete you want nine times out of ten — the plain one leaves
    /// a gap that reads as a stall in the finished video.
    fn ripple_delete_selected(&mut self) {
        for reference in self.editor.selection().to_vec() {
            self.editor.execute(Command::RippleDelete { reference });
        }
    }

    /// Drop a marker at the playhead.
    fn add_marker(&mut self) {
        self.add_counter += 1;
        self.editor.execute(Command::AddMarker {
            id: format!("marker-{}", self.add_counter),
            time: self.editor.playhead(),
            label: String::new(),
        });
    }

    /// Step the playhead by whole frames, so a key press lands on a frame boundary rather than
    /// somewhere between two.
    fn step_frames(&mut self, frames: i64) {
        let geometry = self.geometry();
        let current = geometry.frame_of(self.editor.playhead());
        self.editor.seek(geometry.time_of_frame(current + frames));
    }

    /// Pick a media file, import it into the project library, and add a clip at the playhead.
    fn import_media(&mut self) {
        let Some(path) = rfd::FileDialog::new()
            .add_filter(
                "Media",
                &[
                    "png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "mov", "mkv", "webm", "avi",
                    "m4v", "mp3", "wav", "m4a", "aac", "flac", "ogg",
                ],
            )
            .pick_file()
        else {
            return;
        };
        let path = path.to_string_lossy().into_owned();
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Media".to_string());

        self.add_counter += 1;
        let media_id = format!("media-{}", self.add_counter);
        let mut asset = MediaAsset::new(media_id.clone(), name.clone(), path.clone());
        // Probed once at import and kept: a trim can then stop at the end of the file, and
        // `check` has something to measure a clip against.
        if let Ok(meta) = bay_preview::probe::probe_media(&path) {
            asset.duration_seconds = Some(meta.duration.to_seconds_f64());
            asset.width = Some(meta.width);
            asset.height = Some(meta.height);
        }
        self.editor.add_media(asset);
        self.place_media(&media_id, &name, &path);
        self.preview_sig = None; // new media asset → force a re-render
    }

    /// How long a clip of this file should be. Timed media is probed so a 3-minute track does
    /// not land as a 4-second one; stills are NEVER probed, because ffprobe reports a nominal
    /// ~0.04s for a JPEG (a one-frame "video") and a photo would import as a 40ms clip.
    ///
    /// A probe failure falls back to 4s rather than aborting the import — but it says so. A
    /// silent fallback is the bug probing was added to fix.
    fn media_duration(&mut self, path: &str, kind: MediaKind) -> MediaTime {
        const DEFAULT_STILL: i64 = TICKS_PER_SECOND * 4;
        if !kind.is_timed() {
            return MediaTime::from_ticks(DEFAULT_STILL);
        }
        use bay_preview::probe::ProbeError;
        match bay_preview::probe::probe_media(path) {
            Ok(meta) if meta.duration.as_ticks() > 0 => meta.duration,
            Err(ProbeError::Unavailable(_)) => {
                self.status = Some(
                    "ffprobe not found — clip length is a 4s guess. Install ffmpeg for real \
                     durations."
                        .to_string(),
                );
                MediaTime::from_ticks(DEFAULT_STILL)
            }
            Err(error) => {
                self.status = Some(format!("Could not read media duration ({error}); using 4s"));
                MediaTime::from_ticks(DEFAULT_STILL)
            }
            Ok(_) => MediaTime::from_ticks(DEFAULT_STILL),
        }
    }

    /// Put a clip of an already-imported asset on the timeline at the playhead, on the lane its
    /// kind belongs to. Shared by the import flow and by clicking an asset in the media panel,
    /// so the two cannot place the same file differently.
    fn place_media(&mut self, media_id: &str, name: &str, path: &str) {
        let kind = MediaKind::of_path(path);
        let duration = self.media_duration(path, kind);
        let start = self.editor.playhead();
        self.add_counter += 1;
        let uid = self.add_counter;
        let (track_id, element) = match kind {
            MediaKind::Audio => (
                "track-audio",
                Element::Audio(AudioElement {
                    id: format!("aud-{uid}"),
                    name: name.to_string(),
                    start,
                    duration,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id: media_id.to_string(),
                    muted: false,
                    volume: 1.0,
                    pan: 0.0,
                    speed: 1.0,
                    prosody: None,
                    dialogue_chain: None,
                    animations: Default::default(),
                    trim_start: MediaTime::ZERO,
                    source: Default::default(),
                    role: Default::default(),
                }),
            ),
            MediaKind::Video => (
                "track-main",
                Element::Video(VideoElement {
                    id: format!("vid-{uid}"),
                    name: name.to_string(),
                    start,
                    duration,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id: media_id.to_string(),
                    trim_start: MediaTime::ZERO,
                    trim_end: duration,
                    speed: 1.0,
                    freeze: None,
                    transform: Transform::default(),
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: Default::default(),
                    role: Default::default(),
                }),
            ),
            MediaKind::Image => (
                "track-main",
                Element::Image(ImageElement {
                    id: format!("img-{uid}"),
                    name: name.to_string(),
                    start,
                    duration,
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id: media_id.to_string(),
                    transform: Transform::default(),
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: Default::default(),
                    role: Default::default(),
                }),
            ),
        };
        self.editor.execute(Command::AddElement {
            track_id: track_id.into(),
            element,
            select: true,
        });
    }

    /// Render the composited frame at the playhead at full canvas resolution and save it as a PNG.
    fn export_frame(&mut self) {
        if self.preview.is_none() {
            return;
        }
        let canvas = self.editor.project().settings.canvas;
        let playhead = self.editor.playhead();
        let background = self.editor.project().settings.background.clone();
        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let frame = renderer.render(
            scene,
            playhead,
            canvas.width,
            canvas.height,
            &background,
            media,
        );

        let Some(frame) = frame else {
            self.status = Some("Frame export failed: the GPU could not render a frame".to_string());
            return;
        };
        let mut rgba = frame.bgra;
        for texel in rgba.chunks_exact_mut(4) {
            texel.swap(0, 2); // BGRA → RGBA for PNG
        }
        if let Some(buffer) = image::RgbaImage::from_raw(frame.width, frame.height, rgba) {
            let path = export_frame_path();
            self.status = Some(match buffer.save(&path) {
                Ok(()) => format!("Exported frame to {}", path.display()),
                Err(error) => format!("Frame export failed: {error}"),
            });
        }
    }

    /// Encode the whole timeline to an MP4 (via the ffmpeg sidecar), capped at 1280px wide.
    fn export_video(&mut self) {
        if self.preview.is_none() {
            return;
        }
        let canvas = self.editor.project().settings.canvas;
        let fps = self.editor.project().settings.fps.as_f64().max(1.0);
        let duration = self.editor.duration().to_seconds_f64().max(0.1);
        let background = self.editor.project().settings.background.clone();

        // Even dimensions (yuv420p), capped for reasonable export time.
        let scale = (1280.0 / canvas.width as f32).min(1.0);
        let width = (((canvas.width as f32 * scale) as u32) / 2) * 2;
        let height = (((canvas.height as f32 * scale) as u32) / 2) * 2;

        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let out = export_video_path();
        let result = renderer.export_video(
            scene,
            duration,
            fps,
            width.max(2),
            height.max(2),
            &background,
            media,
            &out.to_string_lossy(),
            &bay_preview::ExportSettings::default(),
        );
        self.status = Some(match result {
            Ok(()) => format!("Exported video to {}", out.display()),
            // The old text asked "is ffmpeg installed?" for every failure, including the ones
            // where ffmpeg ran fine and said exactly what was wrong.
            Err(reason) => format!("Video export failed: {reason}"),
        });
    }

    /// Everything a background job needs, copied out here on the main thread.
    pub fn slow_context(&self) -> bay_agent::slow::SlowContext {
        bay_agent::slow::SlowContext {
            project: self.editor.project().clone(),
            timeline_duration: self.editor.duration().to_seconds_f64(),
            // Seeded past anything the editor has handed out, so a worker and the editor cannot
            // mint the same id while the job runs.
            next_id: (self.add_counter + 1) as usize,
        }
    }

    /// Apply a finished background job: register its media, then run its commands as one undo
    /// entry — so an agent's narration is undone with the same Cmd+Z as a human's edit.
    pub fn apply_slow_result(
        &mut self,
        result: bay_agent::slow::SlowResult,
        cx: &mut Context<Self>,
    ) {
        let applied = match bay_agent::slow::plan_follow_up(result.follow_up, self.editor.project())
        {
            Ok(applied) => applied,
            Err(_) => return,
        };
        if let Some(project) = applied.replacement {
            // The tool's job WAS to build a document, so it replaces rather than patches —
            // matching what it does headlessly. The path stays as it was: this is still the
            // same library entry the window had open.
            let path = self.project_path.clone();
            self.open_project(*project, path);
            self.agent_activity = Some(("subtitles_to_video".into(), std::time::Instant::now()));
            cx.notify();
            return;
        }
        for asset in applied.media {
            self.editor.add_media(asset);
        }
        if let Some(bay_agent::Planned::Tx {
            label, commands, ..
        }) = applied.planned
        {
            for command in commands {
                self.editor.execute(command);
            }
            self.agent_activity = Some((label, std::time::Instant::now()));
        }
        self.add_counter += 1;
        cx.notify();
    }

    /// `snapshot` — render one frame to a PNG so an agent can look at what it built.
    ///
    /// On the main thread deliberately: this is a single frame, the same work the preview does
    /// every time the playhead moves, and it is the call the whole workflow rests on — an agent
    /// that cannot see a frame is guessing. A full `render` is minutes and does NOT belong
    /// here; that is the worker-thread work in todo.pending.md.
    fn agent_snapshot(&mut self, args: &serde_json::Value) -> bay_agent::AgentResponse {
        use bay_agent::AgentResponse;

        let Some(path) = args.get("path").and_then(|v| v.as_str()) else {
            return AgentResponse::Err("snapshot needs a path to write the PNG to".into());
        };
        let Some(at) = args.get("at").and_then(|v| v.as_f64()) else {
            return AgentResponse::Err("snapshot needs `at`, the time in seconds".into());
        };
        if !at.is_finite() || at < 0.0 {
            return AgentResponse::Err(format!("`at` must be a time in seconds, got {at}"));
        }
        if self.preview.is_none() {
            return AgentResponse::Err(
                "no GPU preview on this machine, so a frame cannot be rendered".into(),
            );
        }

        // 0.5 to match the headless server and the tool schema's advertised default. The same
        // tool must not render at a different size depending on which half of bay answered it:
        // snapshot exists so an agent can judge whether type is legible, and that judgement is
        // made against the pixels it gets back.
        let scale = args
            .get("scale")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5)
            .clamp(0.05, 1.0);
        let canvas = self.editor.project().settings.canvas;
        let width = ((canvas.width as f64 * scale) as u32).max(1);
        let height = ((canvas.height as f64 * scale) as u32).max(1);
        let background = self.editor.project().settings.background.clone();
        let Some(time) = MediaTime::from_seconds_f64(at) else {
            return AgentResponse::Err(format!("{at}s is outside the representable time range"));
        };

        let renderer = self.preview.as_mut().expect("checked above");
        let frame = renderer.render(
            self.editor.active_scene(),
            time,
            width,
            height,
            &background,
            self.editor.media(),
        );

        let Some(frame) = frame else {
            return AgentResponse::Err(
                "the GPU could not produce a frame — the device may have been lost".into(),
            );
        };
        let mut rgba = frame.bgra;
        for texel in rgba.chunks_exact_mut(4) {
            texel.swap(0, 2); // BGRA → RGBA for PNG
        }
        let Some(buffer) = image::RgbaImage::from_raw(frame.width, frame.height, rgba) else {
            return AgentResponse::Err("the rendered frame had an unexpected size".into());
        };
        if let Some(parent) = std::path::Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        match buffer.save(path) {
            Ok(()) => {
                self.status = Some(format!("Claude snapshotted {at:.2}s"));
                AgentResponse::Ok(serde_json::json!({
                    "path": path,
                    "atSeconds": at,
                    "width": frame.width,
                    "height": frame.height,
                }))
            }
            Err(error) => AgentResponse::Err(format!("could not write {path}: {error}")),
        }
    }

    /// `project_save` — flush to the library file this project came from.
    fn agent_save(&mut self) -> bay_agent::AgentResponse {
        use bay_agent::AgentResponse;
        match self.save_project() {
            Ok(path) => AgentResponse::Ok(serde_json::json!({ "path": path })),
            Err(message) => AgentResponse::Err(message),
        }
    }

    /// Split the selected element at the playhead into two clips.
    fn split_selected(&mut self) {
        if let Some(reference) = self.editor.selection().first().cloned() {
            self.add_counter += 1;
            let new_id = format!("split-{}", self.add_counter);
            let at = self.editor.playhead();
            self.editor.execute(Command::SplitElement {
                reference,
                at,
                new_id,
            });
        }
    }

    /// Cut `reference` at the timeline position under `window_x`.
    ///
    /// Refuses a cut within a frame of either end: a zero-length clip is not a cut, it is a
    /// clip nobody can select and a hole in the timeline nobody can see.
    fn split_at_x(&mut self, reference: &ElementRef, window_x: f32) {
        // Quantised to a frame, like a scrub: a cut between two frames is not a cut anyone
        // can act on, and the exported file would round it anyway.
        let at = self.geometry().px_to_frame_time(window_x - lane_origin_x());
        let Some(element) = self
            .editor
            .active_scene()
            .tracks
            .iter()
            .flat_map(|track| track.elements.iter())
            .find(|element| element.id() == reference.element_id)
        else {
            return;
        };
        let margin = MIN_DURATION_TICKS;
        if at.as_ticks() <= element.start().as_ticks() + margin
            || at.as_ticks() >= element.end().as_ticks() - margin
        {
            self.status = Some("That cut is too close to the edge of the clip.".into());
            return;
        }
        self.add_counter += 1;
        let new_id = format!("split-{}", self.add_counter);
        self.editor.execute(Command::SplitElement {
            reference: reference.clone(),
            at,
            new_id,
        });
    }

    /// Add a keyframe for `property` at the playhead using the element's current sampled value.
    fn add_keyframe(&mut self, property: &'static str) {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return;
        };
        let playhead = self.editor.playhead();
        let computed = {
            let scene = self.editor.active_scene();
            let Some(element) = scene.element(&reference) else {
                return;
            };
            let local =
                MediaTime::from_ticks((playhead.as_ticks() - element.start().as_ticks()).max(0));
            element.sampled_transform(local).map(|t| {
                let value = match property {
                    "scale" => t.scale,
                    "x" => t.x,
                    "y" => t.y,
                    "rotation" => t.rotation,
                    _ => t.opacity,
                };
                (local, value)
            })
        };
        if let Some((time, value)) = computed {
            self.editor.execute(Command::AddKeyframe {
                reference,
                property: property.to_string(),
                time,
                value,
            });
        }
    }

    fn seek_by(&mut self, delta_ticks: i64) {
        let ticks = self.editor.playhead().as_ticks();
        self.editor.seek(MediaTime::from_ticks(ticks + delta_ticks));
    }

    // ---- timeline geometry --------------------------------------------------------------

    /// The px ↔ time mapping the whole timeline shares — lanes, ruler, playhead and scrub. One
    /// source, so a clip block and the playhead can't disagree about where a second is.
    fn geometry(&self) -> TimelineGeometry {
        self.timeline.geometry(self.editor.project().settings.fps)
    }

    /// Width of one lane: the timeline spans the window, and the lanes take what the track
    /// labels leave.
    fn lane_width(window: &Window) -> f32 {
        (f32::from(window.viewport_size().width) - lane_origin_x() - TIMELINE_PADDING).max(1.0)
    }

    /// Scrollable width, with half a viewport of room past the last clip so the end of the film
    /// is not glued to the right edge.
    fn content_width(&self, lane_width: f32) -> f32 {
        self.geometry()
            .content_width_px(self.editor.duration(), lane_width * 0.5)
    }

    /// Move the playhead to a window-space x, snapped to a frame.
    ///
    /// Scrubbing stops playback: a transport still running under the pointer fights the drag,
    /// and the frame the user let go on is not the one they end up looking at.
    fn scrub_to(&mut self, window_x: f32) {
        if self.playing {
            self.toggle_play();
        }
        let time = self.geometry().px_to_frame_time(window_x - lane_origin_x());
        self.editor.seek(time);
    }

    /// Scroll the lanes horizontally by a wheel/trackpad delta, clamped to the content.
    fn scroll_by(&mut self, delta_x: f32, lane_width: f32) {
        let content = self.content_width(lane_width);
        let wanted = self.timeline.scroll_x() - delta_x;
        self.timeline = self
            .timeline
            .with_scroll_x(crate::geometry::clamp_scroll(wanted, content, lane_width));
    }

    /// Zoom about a fixed point, keeping the time under `anchor_x` on the same pixel. Zooming
    /// around the left edge instead would throw the playhead off screen at every step.
    fn zoom_by(&mut self, factor: f32, anchor_x: f32, lane_width: f32) {
        let zoomed = self
            .geometry()
            .zoom_at(anchor_x, factor, MIN_ZOOM, MAX_ZOOM);
        self.timeline = crate::geometry::TimelineState::from_geometry(zoomed);
        let content = self.content_width(lane_width);
        self.timeline = self.timeline.with_scroll_x(crate::geometry::clamp_scroll(
            self.timeline.scroll_x(),
            content,
            lane_width,
        ));
    }

    /// Keep the playhead in view while the transport runs. Without this, playback walks off the
    /// right edge of the viewport and the user has to chase it by hand — the moment scrolling
    /// exists, following is not optional.
    ///
    /// Pages rather than centres: it lands the playhead a fifth of the way in and then leaves
    /// the view alone until it goes off the edge again, so the lanes are not sliding under the
    /// pointer on every frame.
    fn follow_playhead(&mut self, lane_width: f32) {
        let x = self.geometry().ticks_to_px(self.editor.playhead());
        if (0.0..=lane_width).contains(&x) {
            return;
        }
        let absolute = self
            .geometry()
            .with_scroll_x(0.0)
            .ticks_to_px(self.editor.playhead());
        let content = self.content_width(lane_width);
        self.timeline = self.timeline.with_scroll_x(crate::geometry::clamp_scroll(
            absolute - lane_width * 0.2,
            content,
            lane_width,
        ));
    }

    /// Where the playhead sits inside the lane, clamped so a zoom anchored on it stays on
    /// screen even when it is scrolled out of view.
    fn playhead_anchor_x(&self, lane_width: f32) -> f32 {
        self.geometry()
            .ticks_to_px(self.editor.playhead())
            .clamp(0.0, lane_width)
    }

    /// Start/stop transport playback. Restarts from 0 if pressed at the end.
    fn toggle_play(&mut self) {
        if self.playing {
            self.playing = false;
            self.last_frame = None;
            self.stop_audio();
        } else {
            if self.editor.playhead() >= self.editor.duration() {
                self.editor.seek(MediaTime::ZERO);
            }
            self.playing = true;
            self.last_frame = None;
            self.start_audio();
        }
    }

    /// Advance the playhead by the real time elapsed since the last animated frame; stop at the end.
    fn advance_playback(&mut self) {
        let now = std::time::Instant::now();
        let dt = self
            .last_frame
            .map(|prev| now.duration_since(prev).as_secs_f64())
            .unwrap_or(0.0);
        self.last_frame = Some(now);

        let duration = self.editor.duration();
        let next_ticks = self.editor.playhead().as_ticks() + (dt * TICKS_PER_SECOND as f64) as i64;
        let next = MediaTime::from_ticks(next_ticks);
        if next >= duration {
            self.editor.seek(duration);
            self.playing = false;
            self.last_frame = None;
            self.stop_audio();
        } else {
            self.editor.seek(next);
        }
    }

    fn shared(text: impl Into<String>) -> SharedString {
        SharedString::from(text.into())
    }

    fn button(
        &self,
        id: &'static str,
        label: &str,
        enabled: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, &mut Context<EditorView>) + 'static,
    ) -> gpui::Stateful<Div> {
        let base = widgets::button_face(widgets::ButtonKind::Normal, enabled)
            .id(id)
            .px_3()
            .py_1()
            .rounded_md()
            .text_sm()
            .child(Self::shared(label.to_string()));
        if enabled {
            widgets::pressable(widgets::ButtonKind::Normal, base)
                .cursor_pointer()
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    handler(this, cx);
                    cx.notify();
                }))
        } else {
            base
        }
    }

    /// How long the "Claude is editing" chip stays up after the last agent edit.
    ///
    /// Long enough to notice a burst of quick edits as one continuous activity, short enough
    /// that it is gone before the user wonders whether it is stuck.
    const AGENT_CHIP: std::time::Duration = std::time::Duration::from_millis(2500);

    /// Whether an agent has touched the project recently enough to still be worth showing.
    fn agent_chip(&self) -> Option<String> {
        self.agent_activity
            .as_ref()
            .filter(|(_, at)| at.elapsed() < Self::AGENT_CHIP)
            .map(|(label, _)| format!("● Claude · {label}"))
    }

    fn toolbar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let scene_line = format!(
            "{} · {:.2}s · {}",
            self.editor.active_scene().name,
            vm.duration_seconds,
            vm.tracks
                .iter()
                .map(|track| track.elements.len())
                .sum::<usize>()
        );

        widgets::row()
            .h(px(52.0))
            .flex_none()
            .justify_between()
            .gap(px(16.0))
            .px(px(12.0))
            .bg(rgb(theme::PANEL))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(
                widgets::row()
                    .min_w(px(0.0))
                    // Leaving saves first: an editor that drops work on the way out teaches
                    // people never to use the back button.
                    .child(
                        self.button("projects", "‹ Projects", false, cx, |this, cx| match this
                            .save_project()
                        {
                            Ok(_) => cx.emit(EditorViewEvent::CloseRequested),
                            Err(error) => {
                                this.status = Some(format!("Not closing — save failed: {error}"))
                            }
                        }),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w(px(0.0))
                            .child(
                                div()
                                    .text_color(rgb(theme::TEXT))
                                    .overflow_hidden()
                                    .child(Self::shared(vm.project_name.clone())),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(theme::MUTED))
                                    .overflow_hidden()
                                    .child(Self::shared(format!("{scene_line} clips"))),
                            ),
                    )
                    .children(self.agent_chip().map(|label| {
                        div()
                            .px_2()
                            .py(px(2.0))
                            .rounded(px(6.0))
                            .bg(rgb(theme::SELECTED))
                            .border_1()
                            .border_color(rgb(theme::SELECTED_BORDER))
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(label)
                    }))
                    // Status line: the one place failures become visible to the user.
                    .children(self.status.clone().map(|message| {
                        let bad = message.contains("fail")
                            || message.contains("error")
                            || message.contains("Not closing");
                        div()
                            .id("status")
                            .max_w(px(360.0))
                            .px(px(8.0))
                            .py(px(3.0))
                            .rounded(px(6.0))
                            .bg(rgb(theme::PANEL_ALT))
                            .border_l_2()
                            .border_color(rgb(if bad { theme::DANGER } else { theme::ACCENT }))
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .overflow_hidden()
                            .child(Self::shared(message))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.status = None; // click to dismiss
                                cx.notify();
                            }))
                    })),
            )
            .child(
                widgets::row()
                    .flex_none()
                    .gap(px(10.0))
                    .child(
                        widgets::row()
                            .gap(px(1.0))
                            .child(self.tool_button("undo", "Undo", vm.can_undo, cx, |this| {
                                this.editor.undo();
                            }))
                            .child(self.tool_button("redo", "Redo", vm.can_redo, cx, |this| {
                                this.editor.redo();
                            }))
                            .child(self.tool_button(
                                "copy",
                                "Copy",
                                vm.selected.is_some(),
                                cx,
                                |this| {
                                    this.editor.copy();
                                },
                            ))
                            .child(self.tool_button(
                                "paste",
                                "Paste",
                                vm.clipboard_len > 0,
                                cx,
                                |this| {
                                    this.editor.execute(Command::Paste);
                                },
                            )),
                    )
                    .child(self.button("save", "Save", false, cx, |this, _cx| {
                        this.status = Some(match this.save_project() {
                            Ok(path) => format!("Saved to {}", path.display()),
                            Err(error) => format!("Save failed: {error}"),
                        });
                    }))
                    .child(
                        widgets::row()
                            .gap(px(1.0))
                            .child(self.tool_button(
                                "export-frame",
                                "Export Frame",
                                self.preview.is_some(),
                                cx,
                                |this| this.export_frame(),
                            ))
                            .child(
                                div()
                                    .id("export-video")
                                    .h(px(22.0))
                                    .px(px(10.0))
                                    .flex()
                                    .items_center()
                                    .bg(rgb(theme::ACCENT))
                                    .text_xs()
                                    .text_color(rgb(theme::ON_ACCENT))
                                    .child("Export Video")
                                    .on_click(cx.listener(|this, _event, _window, cx| {
                                        this.export_video();
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
    }

    /// The strip between the panels and the timeline: scenes on the left, what the machine is
    /// missing and what the project is on the right.
    fn scene_bar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let mut tabs: Vec<gpui::Stateful<Div>> = Vec::new();
        for (index, scene) in vm.scenes.iter().enumerate() {
            let id = scene.id.clone();
            let active = scene.active;
            let count = self
                .editor
                .scenes()
                .iter()
                .find(|candidate| candidate.id == scene.id)
                .map(|scene| scene.tracks.iter().map(|t| t.elements.len()).sum::<usize>())
                .unwrap_or(0);
            tabs.push(
                div()
                    .id(("scene", index))
                    .flex()
                    .flex_row()
                    .items_baseline()
                    .gap(px(6.0))
                    .px(px(10.0))
                    .py(px(3.0))
                    .rounded(px(6.0))
                    .bg(rgb(if active {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if active { theme::TEXT } else { theme::MUTED }))
                            .child(Self::shared(scene.name.clone())),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if active {
                                theme::ACCENT_SOFT
                            } else {
                                theme::FAINT
                            }))
                            .child(Self::shared(if count == 0 {
                                "empty".to_string()
                            } else {
                                format!("{count} clips")
                            })),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.editor.switch_scene(id.clone());
                        cx.notify();
                    })),
            );
        }

        let meta = format!(
            "{} × {} · {} tracks",
            vm.canvas.0,
            vm.canvas.1,
            vm.tracks.len()
        );

        widgets::row()
            .h(px(40.0))
            .flex_none()
            .justify_between()
            .gap(px(12.0))
            .px(px(12.0))
            .bg(rgb(theme::PANEL_ALT))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .gap(px(6.0))
                    .min_w(px(0.0))
                    .overflow_hidden()
                    .child(widgets::section("SCENES"))
                    .children(tabs)
                    .child(self.transport_button("add-scene", "＋ Scene", cx, |this| {
                        this.add_counter += 1;
                        let id = format!("scene-{}", this.add_counter);
                        let name = format!("Scene {}", this.editor.scenes().len() + 1);
                        this.editor.execute(Command::AddScene {
                            id: id.clone(),
                            name,
                        });
                        this.editor.switch_scene(id);
                    })),
            )
            .child(
                widgets::row()
                    .flex_none()
                    .gap(px(12.0))
                    // Offers to install what is missing. Present only when something is, and
                    // hidden while an install runs — the status line carries the progress, and
                    // a second press would be a second 1.2 GB download.
                    .children(
                        self.runtime_offers
                            .iter()
                            .filter(|_| self.provision_job.is_none())
                            .map(|offer| {
                                let component = offer.id.clone();
                                // A distinct element id per offer. On a clean machine both
                                // video and speech are offered at once, and two sibling
                                // stateful elements sharing one id share interactive state.
                                self.button(
                                    offer.element_id,
                                    &offer.label,
                                    false,
                                    cx,
                                    move |this, cx| this.install_runtime(&component, cx),
                                )
                            }),
                    )
                    .child(widgets::note(format!("clipboard: {}", vm.clipboard_len)))
                    .child(widgets::note(meta)),
            )
    }

    /// The 56px rail of panel tabs down the left edge.
    fn panel_rail(&self, cx: &mut Context<Self>) -> Div {
        let mut rail = div()
            .w(px(56.0))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .px(px(6.0))
            .py(px(10.0))
            .bg(rgb(theme::RAIL))
            .border_r_1()
            .border_color(rgb(theme::BORDER_SOFT));

        for (index, panel) in Panel::ALL.into_iter().enumerate() {
            let on = self.panel == panel;
            rail = rail.child(
                div()
                    .id(("panel-tab", index))
                    .h(px(46.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(2.0))
                    .rounded(px(6.0))
                    .bg(rgb(if on { theme::SELECTED } else { theme::RAIL }))
                    .child(
                        div()
                            .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                            .child(panel.glyph()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if on { theme::ACCENT_SOFT } else { theme::FAINT }))
                            .child(panel.label()),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.panel = panel;
                        cx.notify();
                    })),
            );
        }
        rail
    }

    /// The panel itself, plus the divider that resizes it.
    fn left_panel(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let body = match self.panel {
            Panel::Media => self.library_panel(vm, cx),
            other => self.blocks_panel(other, vm, cx),
        };
        div()
            .flex()
            .flex_row()
            .flex_none()
            .h_full()
            .child(
                div()
                    .w(px(self.media_width))
                    .flex_none()
                    .h_full()
                    .flex()
                    .flex_col()
                    .py(px(12.0))
                    .gap(px(10.0))
                    .bg(rgb(theme::PANEL))
                    .child(body),
            )
            .child(
                // The divider. A press starts a drag that the root element's mouse-move handler
                // continues, the same way clip drags and scrubbing work — a handler on this
                // 5px strip alone would stop the moment the pointer outran it.
                div()
                    .id("panel-divider")
                    .w(px(5.0))
                    .flex_none()
                    .h_full()
                    .bg(rgb(theme::BORDER))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                            this.widgets.begin(Drag::new(
                                EditorDrag::PanelWidth {
                                    start_width: this.media_width,
                                },
                                event.position,
                                event.modifiers,
                            ));
                            cx.notify();
                        }),
                    ),
            )
    }

    /// The project's own media, grouped by kind.
    fn library_panel(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let columns = self.panel_columns();
        let cell = self.panel_cell_height(columns);
        let media: Vec<crate::view_model::MediaItem> = vm
            .media
            .iter()
            .map(|item| crate::view_model::MediaItem {
                id: item.id.clone(),
                name: item.name.clone(),
                path: item.path.clone(),
                kind: item.kind,
            })
            .collect();
        let count = media.len();
        let folders = MediaFolder::group(media);

        let mut list = div()
            .id("media-list")
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(10.0))
            .px(px(12.0))
            .overflow_y_scroll();

        if folders.is_empty() {
            list = list.child(widgets::note(
                "No media yet. Import a video, image or audio file and it appears here.",
            ));
        }

        let mut index = 0usize;
        for folder in &folders {
            let open = !self.collapsed_folders.contains(folder.name);
            let name = folder.name.to_string();
            let mut group = div().flex().flex_col().child(
                div()
                    .id(SharedString::from(format!("folder-{}", folder.name)))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(6.0))
                    .py(px(3.0))
                    .child(
                        div()
                            .w(px(10.0))
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(if open { "▼" } else { "▶" }),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(folder.name),
                    )
                    .child(widgets::note(folder.items.len().to_string()))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        if !this.collapsed_folders.remove(&name) {
                            this.collapsed_folders.insert(name.clone());
                        }
                        cx.notify();
                    })),
            );

            if open {
                let mut grid = div().flex().flex_col().gap(px(8.0)).mt(px(4.0));
                let mut row = div().flex().flex_row().gap(px(8.0));
                let mut in_row = 0usize;
                for asset in &folder.items {
                    row = row.child(self.media_tile(asset, cell, index, cx));
                    index += 1;
                    in_row += 1;
                    if in_row == columns {
                        grid = grid.child(row);
                        row = div().flex().flex_row().gap(px(8.0));
                        in_row = 0;
                    }
                }
                if in_row > 0 {
                    for _ in in_row..columns {
                        row = row.child(div().flex_1().min_w(px(0.0)));
                    }
                    grid = grid.child(row);
                }
                group = group.child(grid);
            }
            list = list.child(group);
        }

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(10.0))
            .child(
                widgets::row()
                    .px(px(12.0))
                    .justify_between()
                    .child(widgets::section("LIBRARY"))
                    .child(widgets::note(format!("{count} items"))),
            )
            .child(div().px(px(12.0)).child(self.button(
                "import-media",
                "Import Media…",
                false,
                cx,
                |this, _cx| this.import_media(),
            )))
            .child(list)
            .child(
                div()
                    .px(px(12.0))
                    .child(widgets::note("Click a tile to add it at the playhead")),
            )
    }

    /// One media thumbnail.
    ///
    /// A coloured plate with the clip-kind colour, not a decoded frame: bay has no thumbnail
    /// cache, and decoding a poster per tile on the render path is exactly what the decode rule
    /// forbids. The kind, name and a dot are what the panel can honestly show.
    fn media_tile(
        &self,
        asset: &crate::view_model::MediaItem,
        cell: f32,
        index: usize,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        let (id, name, path) = (asset.id.clone(), asset.name.clone(), asset.path.clone());
        let color = theme::element_color(asset.kind.label());
        div()
            .id(("media-tile", index))
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(cell))
                    .rounded(px(5.0))
                    .bg(rgb(theme::LANE))
                    .border_1()
                    .border_color(rgb(theme::BORDER_SOFT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(div().w(px(28.0)).h(px(4.0)).rounded(px(2.0)).bg(rgb(color))),
            )
            .child(
                div()
                    .mt(px(4.0))
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .overflow_hidden()
                    .child(shared_text(name.clone())),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child(asset.kind.label()),
            )
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.place_media(&id, &name, &path);
                cx.notify();
            }))
    }

    /// Text / Transitions / Effects / Audio: a grid of tiles that each apply one edit.
    fn blocks_panel(&self, panel: Panel, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let columns = self.panel_columns();
        let cell = self.panel_cell_height(columns);
        let tiles = panel.blocks();
        let has_selection = vm.selected.is_some();
        let hint = match (panel, has_selection) {
            (Panel::Text, _) => "Adds a clip at the playhead.",
            (_, true) => "Applies to the selected clip.",
            (_, false) => "Select a clip first — these change one.",
        };

        let mut grid = div().flex().flex_col().gap(px(8.0));
        let mut row = div().flex().flex_row().gap(px(8.0));
        let mut in_row = 0usize;
        for (index, tile) in tiles.iter().enumerate() {
            let enabled = !tile.needs_selection || has_selection;
            let id = tile.id;
            row = row.child(
                div()
                    .id(("block", index))
                    .flex_1()
                    .min_w(px(0.0))
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .h(px(cell))
                            .rounded(px(5.0))
                            .bg(rgb(theme::PANEL_ALT))
                            .border_1()
                            .border_color(rgb(theme::BORDER_SOFT))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(rgb(if enabled {
                                theme::ACCENT_SOFT
                            } else {
                                theme::FAINT
                            }))
                            .child(panel.glyph()),
                    )
                    .child(
                        div()
                            .mt(px(4.0))
                            .text_xs()
                            .text_color(rgb(if enabled { theme::TEXT } else { theme::FAINT }))
                            .overflow_hidden()
                            .child(tile.label),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .overflow_hidden()
                            .child(tile.detail),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.apply_block(id);
                        cx.notify();
                    })),
            );
            in_row += 1;
            if in_row == columns {
                grid = grid.child(row);
                row = div().flex().flex_row().gap(px(8.0));
                in_row = 0;
            }
        }
        if in_row > 0 {
            for _ in in_row..columns {
                row = row.child(div().flex_1().min_w(px(0.0)));
            }
            grid = grid.child(row);
        }

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(8.0))
            .child(
                widgets::row()
                    .px(px(12.0))
                    .justify_between()
                    .child(widgets::section(panel.title()))
                    .child(widgets::note(format!("{} presets", tiles.len()))),
            )
            .child(div().px(px(12.0)).child(widgets::note(hint)))
            .child(
                div()
                    .id("blocks-scroll")
                    .flex_1()
                    .min_h(px(0.0))
                    .px(px(12.0))
                    .pb(px(8.0))
                    .overflow_y_scroll()
                    .child(grid),
            )
    }

    /// Two columns until the panel is wide enough for three.
    fn panel_columns(&self) -> usize {
        if self.media_width >= 330.0 {
            3
        } else {
            2
        }
    }

    /// A 16:9-ish tile at whatever width the columns work out to.
    fn panel_cell_height(&self, columns: usize) -> f32 {
        let gutters = 24.0 + (columns as f32 - 1.0) * 8.0;
        (((self.media_width - gutters) / columns as f32) * 0.56).max(34.0)
    }

    /// Run one panel tile against the editor.
    ///
    /// The catalog and the commands live in `bay_core::blocks`, so an MCP client can do exactly
    /// this without a window — and so the "does this effect exist in the compositor?" test runs
    /// headlessly.
    fn apply_block(&mut self, block_id: &'static str) {
        let mut counter = self.add_counter;
        let planned = {
            let mut fresh = |prefix: &str| {
                counter += 1;
                format!("{prefix}-{counter}")
            };
            blocks::plan(&self.editor, block_id, &mut fresh)
        };
        self.add_counter = counter;
        match planned {
            Ok(commands) => {
                for command in commands {
                    self.editor.execute(command);
                }
                self.status = None;
            }
            Err(error) => self.status = Some(error.to_string()),
        }
    }

    fn preview(&self, vm: &EditorViewModel) -> Div {
        let (width, height) = vm.canvas;
        let fill = vm
            .background_color
            .as_deref()
            .map(theme::hex_to_rgb)
            .unwrap_or(0x202028);

        const PREVIEW_W: f32 = 512.0;
        const PREVIEW_H: f32 = 288.0; // 16:9

        // Each active layer as a positioned/sized rect (center x/y, scale of canvas, opacity).
        let mut layers: Vec<Div> = Vec::new();
        for layer in &vm.preview_layers {
            let w = (layer.scale * PREVIEW_W).max(8.0);
            let h = (layer.scale * PREVIEW_H).max(8.0);
            let left = layer.x * PREVIEW_W - w / 2.0;
            let top = layer.y * PREVIEW_H - h / 2.0;
            layers.push(
                div()
                    .absolute()
                    .left(px(left))
                    .top(px(top))
                    .w(px(w))
                    .h(px(h))
                    .rounded_md()
                    .bg(rgb(theme::element_color(&layer.kind_label)))
                    .opacity(layer.opacity)
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(layer.label.clone())),
            );
        }

        div()
            .flex()
            .flex_1()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .bg(rgb(theme::BG))
            .child(if let Some(image) = &self.preview_image {
                // Real composited output from the wgpu compositor (CPU-readback path).
                div()
                    .relative()
                    .w(px(PREVIEW_W))
                    .h(px(PREVIEW_H))
                    .rounded_md()
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .overflow_hidden()
                    .child(
                        img(ImageSource::Render(image.clone()))
                            .w(px(PREVIEW_W))
                            .h(px(PREVIEW_H)),
                    )
            } else {
                // Fallback layout view (no GPU adapter): elements as positioned rects.
                div()
                    .relative()
                    .w(px(PREVIEW_W))
                    .h(px(PREVIEW_H))
                    .rounded_md()
                    .bg(rgb(fill))
                    .border_1()
                    .border_color(rgb(theme::BORDER))
                    .overflow_hidden()
                    .children(layers)
            })
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(format!(
                        "{width} × {height}  ·  {} layer(s)  ·  {}",
                        vm.preview_layers.len(),
                        if self.preview_image.is_some() {
                            "compositor"
                        } else {
                            "layout"
                        }
                    ))),
            )
    }

    fn info_row(&self, label: &str, value: &str) -> Div {
        div()
            .flex()
            .flex_row()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(value.to_string())),
            )
    }

    fn mini_button(
        &self,
        id: SharedString,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        widgets::pressable(
            widgets::ButtonKind::Normal,
            widgets::button_face(widgets::ButtonKind::Normal, true)
                .id(id)
                .w(px(22.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded_md()
                .text_sm()
                .child(Self::shared(label.to_string())),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            handler(this);
            cx.notify();
        }))
    }

    /// A button that adds a keyframe for `property` at the playhead.
    fn kf_button(&self, property: &'static str, cx: &mut Context<Self>) -> gpui::Stateful<Div> {
        div()
            .id(SharedString::from(format!("kf-{property}")))
            .px_2()
            .py_1()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(property.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.add_keyframe(property);
                cx.notify();
            }))
    }

    /// A small square toggle (used for track hide/mute); highlighted when `active`.
    fn track_toggle(
        &self,
        id: SharedString,
        label: &str,
        active: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        div()
            .id(id)
            .w(px(20.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_md()
            .bg(rgb(if active {
                theme::SELECTED
            } else {
                theme::PANEL_ALT
            }))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(label.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this);
                cx.notify();
            }))
    }

    /// A label + value with `−`/`+` steppers that call `handler(this, delta_ticks)`.
    fn nudge_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, i64) + Clone + 'static,
    ) -> Div {
        let minus = {
            let handler = handler.clone();
            self.mini_button(
                SharedString::from(format!("{id_prefix}-minus")),
                "−",
                cx,
                move |this| handler(this, -NUDGE_TICKS),
            )
        };
        let plus = self.mini_button(
            SharedString::from(format!("{id_prefix}-plus")),
            "+",
            cx,
            move |this| handler(this, NUDGE_TICKS),
        );
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(minus)
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(value)),
                    )
                    .child(plus),
            )
    }

    /// Like `nudge_row` but the steppers call `handler(this, sign)` with `sign = ∓1.0` (the
    /// closure applies the field-specific step). Used for float transform fields.
    fn stepper_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, f32) + Clone + 'static,
    ) -> Div {
        let minus = {
            let handler = handler.clone();
            self.mini_button(
                SharedString::from(format!("{id_prefix}-minus")),
                "−",
                cx,
                move |this| handler(this, -1.0),
            )
        };
        let plus = self.mini_button(
            SharedString::from(format!("{id_prefix}-plus")),
            "+",
            cx,
            move |this| handler(this, 1.0),
        );
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(minus)
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(value)),
                    )
                    .child(plus),
            )
    }

    /// A transform stepper that reads the element's current transform, applies `edit`, and
    /// dispatches a SetTransform command.
    fn transform_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        reference: ElementRef,
        cx: &mut Context<Self>,
        edit: impl Fn(&mut Transform, f32) + Clone + 'static,
    ) -> Div {
        self.stepper_row(label, value, id_prefix, cx, move |this, sign| {
            let current = this
                .editor
                .active_scene()
                .element(&reference)
                .and_then(|e| e.transform());
            if let Some(mut transform) = current {
                edit(&mut transform, sign);
                this.editor.execute(Command::SetTransform {
                    reference: reference.clone(),
                    transform,
                });
            }
        })
    }

    fn inspector(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let panel = div()
            .flex()
            .flex_col()
            .w(px(260.0))
            .h_full()
            .p_3()
            .gap_3()
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("INSPECTOR"),
            );

        let Some(selected) = &vm.selected else {
            return panel.child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::MUTED))
                    .child("Select a clip to inspect it."),
            );
        };

        let start_ref = selected.reference.clone();
        let duration_ref = selected.reference.clone();

        let mut body = div()
            .flex()
            .flex_col()
            .gap_2()
            .child(self.info_row("Name", &selected.name))
            .child(self.info_row("Kind", &selected.kind_label))
            .child(self.nudge_row(
                "Start",
                format!("{:.2}s", selected.start_seconds),
                "start",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&start_ref)
                        .map(|element| element.start().as_ticks());
                    if let Some(ticks) = current {
                        this.editor.execute(Command::MoveElement {
                            reference: start_ref.clone(),
                            start: MediaTime::from_ticks((ticks + delta).max(0)),
                        });
                    }
                },
            ))
            .child(self.nudge_row(
                "Duration",
                format!("{:.2}s", selected.duration_seconds),
                "duration",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&duration_ref)
                        .map(|element| element.duration().as_ticks());
                    if let Some(ticks) = current {
                        this.editor.execute(Command::SetElementDuration {
                            reference: duration_ref.clone(),
                            duration: MediaTime::from_ticks(
                                (ticks + delta).max(MIN_DURATION_TICKS),
                            ),
                        });
                    }
                },
            ));

        // Fades. One pair of rows for every kind: on picture this ramps opacity, on audio it
        // ramps level, so a shot and its sound are faded the same way.
        for (label, id, is_in) in [
            ("Fade in", "fade-in", true),
            ("Fade out", "fade-out", false),
        ] {
            let seconds = if is_in {
                selected.fade_in_seconds
            } else {
                selected.fade_out_seconds
            };
            let fade_ref = selected.reference.clone();
            body = body.child(self.nudge_row(
                label,
                format!("{seconds:.2}s"),
                id,
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&fade_ref)
                        .map(|element| (element.fade_in(), element.fade_out()));
                    if let Some((fade_in, fade_out)) = current {
                        let bumped = |time: MediaTime| {
                            MediaTime::from_ticks((time.as_ticks() + delta).max(0))
                        };
                        this.editor.execute(Command::SetFades {
                            reference: fade_ref.clone(),
                            fade_in: if is_in { bumped(fade_in) } else { fade_in },
                            fade_out: if is_in { fade_out } else { bumped(fade_out) },
                        });
                    }
                },
            ));
        }

        // Which part of the file this clip plays. Only clips with a timeline inside them have
        // one, and until it was shown here a slip was invisible: two clips of the same shot
        // looked identical in the inspector no matter what they were actually playing.
        if let Some(source_start) = selected.source_start_seconds {
            let label = match selected.source_length_seconds {
                Some(length) => format!("{source_start:.2}s of {length:.2}s"),
                None => format!("{source_start:.2}s"),
            };
            let source_ref = selected.reference.clone();
            body = body.child(self.nudge_row(
                "Source in",
                label,
                "source-in",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&source_ref)
                        .and_then(|element| element.source_start())
                        .map(|time| time.as_ticks());
                    if let Some(ticks) = current {
                        // A slip, not a trim: the clip stays where it is and plays a different
                        // part of the shot. The command clamps it to the file.
                        this.editor.execute(Command::SetSourceStart {
                            reference: source_ref.clone(),
                            trim_start: MediaTime::from_ticks((ticks + delta).max(0)),
                        });
                    }
                },
            ));
        }

        if let Some(content) = &selected.text_content {
            let editing = self
                .editing_text
                .as_ref()
                .filter(|(reference, _)| reference == &selected.reference);
            match editing {
                Some((_, buffer)) => {
                    body = body
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(theme::MUTED))
                                .child("Editing (Enter = save, Esc = cancel)"),
                        )
                        .child(
                            div()
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(theme::SELECTED))
                                .text_sm()
                                .text_color(rgb(theme::TEXT))
                                .child(Self::shared(format!("{buffer}\u{258f}"))),
                        );
                }
                None => {
                    body = body
                        .child(self.info_row("Text", content))
                        .child(self.button("edit-text", "Edit Text", true, cx, {
                            let reference = selected.reference.clone();
                            let content = content.clone();
                            move |this, _cx| {
                                this.editing_text = Some((reference.clone(), content.clone()));
                            }
                        }));
                }
            }
        }

        // Transform controls for visual elements (drive the layout preview).
        if let Some(transform) = selected.transform {
            let reference = selected.reference.clone();
            body = body
                .child(self.transform_row(
                    "Opacity",
                    format!("{:.0}%", transform.opacity * 100.0),
                    "opacity",
                    reference.clone(),
                    cx,
                    |t, sign| t.opacity = (t.opacity + sign * 0.1).clamp(0.0, 1.0),
                ))
                .child(self.transform_row(
                    "Scale",
                    format!("{:.2}", transform.scale),
                    "scale",
                    reference.clone(),
                    cx,
                    |t, sign| t.scale = (t.scale + sign * 0.1).clamp(0.05, 4.0),
                ))
                .child(self.transform_row(
                    "X",
                    format!("{:.2}", transform.x),
                    "posx",
                    reference.clone(),
                    cx,
                    |t, sign| t.x = (t.x + sign * 0.05).clamp(0.0, 1.0),
                ))
                .child(self.transform_row(
                    "Y",
                    format!("{:.2}", transform.y),
                    "posy",
                    reference,
                    cx,
                    |t, sign| t.y = (t.y + sign * 0.05).clamp(0.0, 1.0),
                ));

            // Keyframe the current value of a property at the playhead.
            body = body.child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(format!(
                                "◇ keyframe ({} animated):",
                                selected.animated_count
                            ))),
                    )
                    .child(self.kf_button("opacity", cx))
                    .child(self.kf_button("scale", cx))
                    .child(self.kf_button("x", cx))
                    .child(self.kf_button("y", cx)),
            );

            // Effects list + add.
            body = body.child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("EFFECTS"),
            );
            for effect in &selected.effects {
                let effect_id = effect.id.clone();
                let mut controls = div().flex().flex_row().items_center().gap_1();
                if let Some(amount) = effect.amount {
                    controls = controls
                        .child(self.mini_button(
                            SharedString::from(format!("{effect_id}-amt-minus")),
                            "−",
                            cx,
                            {
                                let reference = selected.reference.clone();
                                let effect_id = effect_id.clone();
                                move |this| {
                                    this.editor.execute(Command::SetEffectParam {
                                        reference: reference.clone(),
                                        effect_id: effect_id.clone(),
                                        key: "amount".into(),
                                        value: (amount - 0.1).max(0.0),
                                    });
                                }
                            },
                        ))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(theme::TEXT))
                                .child(Self::shared(format!("{amount:.1}"))),
                        )
                        .child(self.mini_button(
                            SharedString::from(format!("{effect_id}-amt-plus")),
                            "+",
                            cx,
                            {
                                let reference = selected.reference.clone();
                                let effect_id = effect_id.clone();
                                move |this| {
                                    this.editor.execute(Command::SetEffectParam {
                                        reference: reference.clone(),
                                        effect_id: effect_id.clone(),
                                        key: "amount".into(),
                                        value: (amount + 0.1).min(4.0),
                                    });
                                }
                            },
                        ));
                }
                controls = controls
                    .child(self.track_toggle(
                        SharedString::from(format!("{effect_id}-toggle")),
                        if effect.enabled { "on" } else { "off" },
                        effect.enabled,
                        cx,
                        {
                            let reference = selected.reference.clone();
                            let effect_id = effect_id.clone();
                            move |this| {
                                this.editor.execute(Command::ToggleEffect {
                                    reference: reference.clone(),
                                    effect_id: effect_id.clone(),
                                });
                            }
                        },
                    ))
                    .child(self.mini_button(
                        SharedString::from(format!("{effect_id}-rm")),
                        "✕",
                        cx,
                        {
                            let reference = selected.reference.clone();
                            let effect_id = effect_id.clone();
                            move |this| {
                                this.editor.execute(Command::RemoveEffect {
                                    reference: reference.clone(),
                                    effect_id: effect_id.clone(),
                                });
                            }
                        },
                    ));
                body = body.child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .justify_between()
                        .gap_2()
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(if effect.enabled {
                                    theme::TEXT
                                } else {
                                    theme::MUTED
                                }))
                                .child(Self::shared(effect.effect_type.clone())),
                        )
                        .child(controls),
                );
            }
            // One add-button per supported effect type. What each is born with comes from
            // `bay_core::blocks::default_effect_params`, not from here — the seed is engine
            // logic a headless client needs too, and when this view owned its own copy the
            // same effect arrived with different parameters depending on whether a person
            // clicked a button or an agent called a tool.
            let add_effects: [(&'static str, &'static str, &'static str); 5] = [
                ("add-fx-brightness", "brightness", "+ Bright"),
                ("add-fx-contrast", "contrast", "+ Contrast"),
                ("add-fx-saturation", "saturation", "+ Sat"),
                ("add-fx-blur", "blur", "+ Blur"),
                ("add-fx-shadow", "drop-shadow", "+ Shadow"),
            ];
            let mut add_row = div().flex().flex_row().flex_wrap().gap_1();
            for (id, effect_type, label) in add_effects {
                let reference = selected.reference.clone();
                add_row = add_row.child(self.button(id, label, true, cx, move |this, _cx| {
                    this.add_counter += 1;
                    let effect = bay_core::Effect {
                        id: format!("fx-{}", this.add_counter),
                        effect_type: effect_type.into(),
                        enabled: true,
                        params: bay_core::blocks::default_effect_params(effect_type),
                        asset: None,
                    };
                    this.editor.execute(Command::AddEffect {
                        reference: reference.clone(),
                        effect,
                    });
                }));
            }
            body = body.child(add_row);

            // Blend mode: how this layer composites over everything beneath it. One button
            // cycling all 17 modes — the compositor's full WGSL blend set.
            if let Some(mode) = selected.blend_mode {
                let reference = selected.reference.clone();
                body = body
                    .child(div().text_xs().text_color(rgb(theme::MUTED)).child("BLEND"))
                    .child(
                        self.button("blend-mode", mode.label(), true, cx, move |this, _cx| {
                            this.editor.execute(Command::SetBlendMode {
                                reference: reference.clone(),
                                blend_mode: mode.next(),
                            });
                        }),
                    );
            }

            // Motion presets (in-memory): save the clip's effects+animations, apply elsewhere.
            body = body
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(theme::MUTED))
                        .child("PRESETS"),
                )
                .child(
                    self.button("save-preset", "Save Preset", true, cx, |this, _cx| {
                        this.save_preset()
                    }),
                )
                .child(
                    // The one above lives in this window; this one is written to the library
                    // and survives it.
                    self.button(
                        "save-template",
                        "Save as Template",
                        true,
                        cx,
                        |this, _cx| this.save_template(),
                    ),
                );
            for (index, preset) in self.presets.iter().enumerate() {
                let label = format!("Apply {}", preset.name);
                body = body.child(
                    div()
                        .id(SharedString::from(format!("apply-preset-{index}")))
                        .px_3()
                        .py_1()
                        .rounded_md()
                        .bg(rgb(theme::PANEL_ALT))
                        .text_sm()
                        .text_color(rgb(theme::TEXT))
                        .child(Self::shared(label))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.apply_preset(index);
                            cx.notify();
                        })),
                );
            }
        }

        panel.child(body)
    }

    fn transport_button(
        &self,
        id: &'static str,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        widgets::pressable(
            widgets::ButtonKind::Normal,
            widgets::button_face(widgets::ButtonKind::Normal, true)
                .id(id)
                .px_2()
                .py_1()
                .rounded_md()
                .text_xs()
                .child(Self::shared(label.to_string())),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            handler(this);
            cx.notify();
        }))
    }

    /// The bar under the preview: transport, timecode, and the zoom the timeline reads.
    ///
    /// It used to live in the timeline's header. Moving it here is not tidying — the transport
    /// drives the picture, and having "play" half a screen from the frame it plays is the kind
    /// of layout that makes an editor feel like a form.
    fn transport(&self, vm: &EditorViewModel, lane_width: f32, cx: &mut Context<Self>) -> Div {
        let now = timecode(vm.playhead_seconds);
        let total = timecode(vm.duration_seconds);

        widgets::row()
            .h(px(54.0))
            .flex_none()
            .justify_center()
            .gap(px(14.0))
            .px(px(16.0))
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("seek-start", "|◀", cx, |this| {
                        this.editor.seek(MediaTime::ZERO)
                    }))
                    .child(self.transport_button("seek-back", "◀◀", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks - TICKS_PER_SECOND));
                    })),
            )
            .child(
                div()
                    .id("play")
                    .w(px(44.0))
                    .h(px(32.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::ACCENT))
                    .text_color(rgb(theme::ON_ACCENT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(if self.playing { "❚❚" } else { "▶" })
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_play();
                        cx.notify();
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("seek-fwd", "▶▶", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks + TICKS_PER_SECOND));
                    }))
                    .child(self.transport_button("seek-end", "▶|", cx, |this| {
                        this.editor.seek(this.editor.duration())
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(6.0))
                    .ml(px(6.0))
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_color(rgb(theme::TEXT))
                            .child(shared_text(now)),
                    )
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(shared_text(format!("/ {total}"))),
                    ),
            )
            .child(div().flex_1())
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("zoom-out", "−", cx, move |this| {
                        let anchor = this.playhead_anchor_x(lane_width);
                        this.zoom_by(1.0 / 1.5, anchor, lane_width);
                    }))
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(shared_text(format!(
                                "{} px/s",
                                self.timeline.pixels_per_second().round() as i64
                            ))),
                    )
                    .child(self.transport_button("zoom-in", "+", cx, move |this| {
                        let anchor = this.playhead_anchor_x(lane_width);
                        this.zoom_by(1.5, anchor, lane_width);
                    }))
                    .child(self.transport_button("fit", "Fit", cx, move |this| {
                        this.fit_to_window(lane_width);
                    })),
            )
    }

    /// Duplicate the selection, one clip length later.
    fn duplicate_selected(&mut self) {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return;
        };
        self.add_counter += 1;
        let new_id = format!("dup-{}", self.add_counter);
        self.editor
            .execute(Command::DuplicateElement { reference, new_id });
    }

    /// Add an empty overlay lane.
    fn add_overlay_track(&mut self) {
        self.add_counter += 1;
        let count = self.editor.active_scene().tracks.overlay.len() + 1;
        self.editor.execute(Command::AddTrack {
            lane: bay_core::command::TrackLane::Overlay,
            id: format!("track-overlay-{}", self.add_counter),
            name: format!("Overlay {count}"),
        });
    }

    /// Set the zoom so the whole timeline fits the lane.
    fn fit_to_window(&mut self, lane_width: f32) {
        let duration = self.editor.duration().to_seconds_f64() as f32;
        if duration <= 0.0 {
            return;
        }
        self.timeline = crate::geometry::TimelineState::new(
            ((lane_width - 20.0) / duration).clamp(MIN_ZOOM, MAX_ZOOM),
            0.0,
        );
    }

    fn timeline(&self, vm: &EditorViewModel, lane_width: f32, cx: &mut Context<Self>) -> Div {
        let mut rows: Vec<Div> = Vec::new();
        let mut block_index: usize = 0;
        for track in &vm.tracks {
            rows.push(self.track_row(track, vm.playhead_seconds, &mut block_index, cx));
        }

        div()
            .flex()
            .flex_col()
            // Tall enough for the tool row, the ruler and five lanes. Past that the track list
            // scrolls — projects with a stack of overlays are normal, not exceptional.
            .h(px(300.0))
            .p(px(TIMELINE_PADDING))
            .gap_1()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            // Two-finger horizontal scroll pans the lanes. Vertical is left alone: the track
            // list below handles it, and hijacking both would stop the tracks scrolling at all.
            .on_scroll_wheel(cx.listener(
                move |this, event: &gpui::ScrollWheelEvent, window, cx| {
                    let delta = event.delta.pixel_delta(window.line_height());
                    if delta.x != gpui::Pixels::ZERO {
                        this.scroll_by(f32::from(delta.x), lane_width);
                        cx.notify();
                    }
                },
            ))
            .child(self.timeline_tools(vm, cx))
            .child(self.ruler(vm, lane_width, cx))
            .child(
                // The tracks scroll: a project with a stack of overlays is taller than the
                // panel, and before this the rows past the bottom edge simply could not be
                // reached.
                div()
                    .id("timeline-tracks")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h(px(0.0))
                    .overflow_y_scroll()
                    .children(rows),
            )
    }

    /// The row of edit tools above the ruler.
    fn timeline_tools(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let selected = vm.selected.is_some();
        let razor = self.tool == Tool::Razor;
        widgets::row()
            .gap(px(10.0))
            .child(widgets::section("TIMELINE"))
            .child(
                widgets::row()
                    .gap(px(1.0))
                    .child(
                        self.mode_button("tool-select", "➤ Select", !razor, cx, |this| {
                            this.tool = Tool::Select
                        }),
                    )
                    .child(self.mode_button("tool-razor", "✂ Cut", razor, cx, |this| {
                        this.tool = Tool::Razor
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(1.0))
                    .child(
                        self.tool_button("split", "Split", selected, cx, |this| {
                            this.split_selected()
                        }),
                    )
                    .child(
                        self.tool_button("duplicate", "Duplicate", selected, cx, |this| {
                            this.duplicate_selected()
                        }),
                    )
                    .child(self.tool_button("delete", "Delete", selected, cx, |this| {
                        this.delete_selected()
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(1.0))
                    .child(
                        self.tool_button("marker", "◆ Marker", true, cx, |this| {
                            this.add_marker()
                        }),
                    )
                    .child(self.tool_button("add-track", "＋ Track", true, cx, |this| {
                        this.add_overlay_track()
                    }))
                    .child(self.mode_button("snap", "Snap", self.snapping, cx, |this| {
                        this.snapping = !this.snapping
                    })),
            )
            .child(div().flex_1())
            .child(widgets::note(format!(
                "{} tracks · {} markers",
                vm.tracks.len(),
                vm.markers.len()
            )))
    }

    /// A toolbar button that is either on or off, rather than enabled or disabled.
    fn mode_button(
        &self,
        id: &'static str,
        label: &'static str,
        on: bool,
        cx: &mut Context<Self>,
        action: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        let kind = if on {
            widgets::ButtonKind::On
        } else {
            widgets::ButtonKind::Normal
        };
        widgets::pressable(
            kind,
            widgets::button_face(kind, true)
                .id(id)
                .h(px(22.0))
                .px(px(8.0))
                .flex()
                .items_center()
                .text_xs()
                // An "off" toggle is not a disabled one: it is available, just not currently
                // true, so it keeps a readable label and only loses the fill.
                .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                .child(label),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            action(this);
            cx.notify();
        }))
    }

    /// A small toolbar button that greys out when it has nothing to act on.
    fn tool_button(
        &self,
        id: &'static str,
        label: &'static str,
        enabled: bool,
        cx: &mut Context<Self>,
        action: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        let base = widgets::button_face(widgets::ButtonKind::Normal, enabled)
            .id(id)
            .h(px(22.0))
            .px(px(8.0))
            .flex()
            .items_center()
            .text_xs()
            .child(label);
        if !enabled {
            // It already did nothing — the handler used to be attached anyway, so the pointer
            // said "button" and the click said nothing. Now the fill says it first.
            return base;
        }
        widgets::pressable(widgets::ButtonKind::Normal, base)
            .cursor_pointer()
            .on_click(cx.listener(move |this, _event, _window, cx| {
                action(this);
                cx.notify();
            }))
    }

    /// The time ruler above the lanes: ticks, timecode labels, and the playhead's handle. This
    /// is the scrub target — pressing anywhere on it moves the playhead there, and the press
    /// keeps scrubbing until the button is released.
    fn ruler(&self, vm: &EditorViewModel, lane_width: f32, cx: &mut Context<Self>) -> Div {
        let geometry = self.geometry();
        let mut marks: Vec<Div> = Vec::new();
        for tick in geometry.ruler_ticks(lane_width) {
            let height = if tick.major {
                RULER_HEIGHT * 0.5
            } else {
                RULER_HEIGHT * 0.25
            };
            marks.push(
                div()
                    .absolute()
                    .left(px(tick.x))
                    .bottom(px(0.0))
                    .w(px(1.0))
                    .h(px(height))
                    .bg(rgb(theme::BORDER)),
            );
            if let Some(label) = tick.label {
                marks.push(
                    div()
                        .absolute()
                        .left(px(tick.x + 3.0))
                        .top(px(0.0))
                        .text_xs()
                        .text_color(rgb(theme::MUTED))
                        .child(Self::shared(label)),
                );
            }
        }

        // Markers, drawn under the playhead so the head stays readable on top of one.
        for marker in &vm.markers {
            let x = geometry.seconds_to_px(marker.seconds);
            if x < -8.0 || x > lane_width + 8.0 {
                continue;
            }
            marks.push(
                div()
                    .absolute()
                    .left(px(x - 3.0))
                    .top(px(RULER_HEIGHT - 8.0))
                    .w(px(7.0))
                    .h(px(7.0))
                    .rounded_sm()
                    .bg(rgb(theme::MARKER)),
            );
        }

        let playhead_x = geometry.seconds_to_px(vm.playhead_seconds);
        div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(TRACK_GAP))
            .h(px(RULER_HEIGHT))
            .child(div().w(px(TRACK_LABEL_WIDTH)))
            .child(
                div()
                    .relative()
                    .flex_1()
                    .h(px(RULER_HEIGHT))
                    .overflow_hidden()
                    .cursor_pointer()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                            this.begin_scrub(event);
                            cx.notify();
                        }),
                    )
                    .children(marks)
                    .child(
                        // A grabbable head on the playhead: a 2px line is not a mouse target.
                        div()
                            .absolute()
                            .left(px(playhead_x - 4.0))
                            .top(px(0.0))
                            .w(px(9.0))
                            .h(px(9.0))
                            .rounded_sm()
                            .bg(rgb(theme::ACCENT)),
                    ),
            )
    }

    fn track_row(
        &self,
        track: &TrackRow,
        playhead_seconds: f64,
        block_index: &mut usize,
        cx: &mut Context<Self>,
    ) -> Div {
        let geometry = self.geometry();
        // Where t=0 sits on screen. A drag may not push a clip before the start of the
        // timeline, and once the lane can scroll that boundary is no longer x=0.
        let zero_x = geometry.seconds_to_px(0.0);
        let mut blocks: Vec<gpui::Stateful<Div>> = Vec::new();
        for block in &track.elements {
            let id = *block_index;
            *block_index += 1;
            let reference = block.reference.clone();
            let origin_start_ticks = (block.start_seconds * TICKS_PER_SECOND as f64) as i64;
            let origin_duration_ticks = (block.duration_seconds * TICKS_PER_SECOND as f64) as i64;

            // Live geometry while this block is the one being dragged/trimmed. `seconds_to_px`
            // carries the scroll offset; the width is a difference, so it does not.
            let base_left = geometry.seconds_to_px(block.start_seconds);
            let base_width =
                (block.duration_seconds as f32 * self.timeline.pixels_per_second())
                    .max(MIN_BLOCK_WIDTH);
            let (mut left, mut width) = (base_left, base_width);
            if let Some((drag, delta)) = self.block_drag() {
                // The dragged clip shows the snapped position; the rest of the selection moves
                // with it, so a group drag looks like one gesture rather than one clip
                // detaching from its neighbours.
                if drag.reference == block.reference {
                    match drag.mode {
                        DragMode::Move => left = (base_left + delta).max(zero_x),
                        DragMode::TrimStart => {
                            left = (base_left + delta).max(zero_x);
                            width = (base_width - delta).max(MIN_BLOCK_WIDTH);
                        }
                        DragMode::TrimEnd => {
                            width = (base_width + delta).max(MIN_BLOCK_WIDTH);
                        }
                    }
                } else if drag.mode == DragMode::Move && block.selected {
                    left = (base_left + delta).max(zero_x);
                }
            }
            let inner_height = LANE_HEIGHT - 8.0;
            let fill = theme::element_color(&block.kind_label);

            // Three sibling regions: left trim handle, move body, right trim handle.
            let left_handle = div()
                .id(("trim-start", id))
                .w(px(TRIM_HANDLE_WIDTH))
                .h(px(inner_height))
                .bg(rgb(theme::SELECTED_BORDER))
                .on_mouse_down(
                    MouseButton::Left,
                    self.begin_drag(
                        reference.clone(),
                        DragMode::TrimStart,
                        origin_start_ticks,
                        origin_duration_ticks,
                        cx,
                    ),
                );
            let base_body = div()
                .id(("move", id))
                .flex_1()
                .h(px(inner_height))
                .px_2()
                .overflow_hidden()
                .on_mouse_down(
                    MouseButton::Left,
                    self.begin_drag(
                        reference.clone(),
                        DragMode::Move,
                        origin_start_ticks,
                        origin_duration_ticks,
                        cx,
                    ),
                );
            // Audio clips with an extracted waveform draw peak bars; everything else shows a label.
            let waveform = if block.kind_label == "Audio" {
                block
                    .media_id
                    .as_ref()
                    .and_then(|m| self.waveforms.peaks(m, WAVEFORM_BUCKETS))
                    .filter(|peaks| !peaks.is_empty())
            } else {
                None
            };
            let body = match waveform {
                Some(peaks) => base_body
                    .flex()
                    .flex_row()
                    .items_end()
                    .children(peaks.iter().map(|p| {
                        div()
                            .w(px(2.0))
                            .h(px((p * (inner_height - 6.0)).max(1.0)))
                            .bg(rgb(theme::ACCENT))
                    })),
                None => base_body
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(block.label.clone())),
            };
            let right_handle = div()
                .id(("trim-end", id))
                .w(px(TRIM_HANDLE_WIDTH))
                .h(px(inner_height))
                .bg(rgb(theme::SELECTED_BORDER))
                .on_mouse_down(
                    MouseButton::Left,
                    self.begin_drag(
                        reference.clone(),
                        DragMode::TrimEnd,
                        origin_start_ticks,
                        origin_duration_ticks,
                        cx,
                    ),
                );

            let mut element = div()
                .id(id)
                .absolute()
                .left(px(left))
                .top(px(4.0))
                .h(px(inner_height))
                .w(px(width))
                .rounded_md()
                .bg(rgb(fill))
                .overflow_hidden()
                .flex()
                .flex_row()
                .items_center()
                .child(left_handle)
                .child(body)
                .child(right_handle);
            if block.selected {
                element = element.border_1().border_color(rgb(theme::SELECTED_BORDER));
            }
            blocks.push(element);
        }

        div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(TRACK_GAP))
            .h(px(LANE_HEIGHT + 6.0))
            .child(
                div()
                    .w(px(TRACK_LABEL_WIDTH))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .flex_1()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .overflow_hidden()
                            .child(Self::shared(track.name.clone())),
                    )
                    .child(self.track_toggle(
                        SharedString::from(format!("{}-hide", track.id)),
                        "H",
                        track.hidden,
                        cx,
                        {
                            let track_id = track.id.clone();
                            let hidden = track.hidden;
                            move |this| {
                                this.editor.execute(Command::SetTrackHidden {
                                    track_id: track_id.clone(),
                                    hidden: !hidden,
                                });
                            }
                        },
                    ))
                    .child(self.track_toggle(
                        SharedString::from(format!("{}-mute", track.id)),
                        "M",
                        track.muted,
                        cx,
                        {
                            let track_id = track.id.clone();
                            let muted = track.muted;
                            move |this| {
                                this.editor.execute(Command::SetTrackMuted {
                                    track_id: track_id.clone(),
                                    muted: !muted,
                                });
                            }
                        },
                    )),
            )
            .child(
                div()
                    .relative()
                    .flex_1()
                    .h(px(LANE_HEIGHT))
                    .rounded_md()
                    .bg(rgb(theme::LANE))
                    .overflow_hidden()
                    // Pressing empty lane space scrubs, the same as the ruler. A press that
                    // lands on a clip never gets here: `begin_drag` stops propagation, so
                    // dragging a clip does not also drag the playhead.
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                            this.begin_scrub(event);
                            cx.notify();
                        }),
                    )
                    .children(blocks)
                    .child(
                        // Playhead line across this lane.
                        div()
                            .absolute()
                            .left(px(geometry.seconds_to_px(playhead_seconds)))
                            .top(px(0.0))
                            .w(px(2.0))
                            .h(px(LANE_HEIGHT))
                            .bg(rgb(theme::ACCENT)),
                    ),
            )
    }
}

/// Width of one right-hand icon button, and the inset the flanking clusters sit at.
const BAR_ICON: f32 = 27.0;
const BAR_INSET: f32 = 16.0;
/// Thickness of the active page's underline.
const BAR_UNDERLINE: f32 = 3.0;

impl EditorView {
    /// The page bar: wordmark, six centred pages, and the two controls that leave the project.
    ///
    /// **Not `deferred`.** It is the last child of a flex column, so it paints last anyway, and a
    /// deferred subtree can never contain a `Select` — GPUI aborts on `defer_draw` during
    /// deferred drawing. Later pages will want selects in here.
    fn page_bar(&self, window_width: f32, cx: &mut Context<Self>) -> Div {
        let layout = BarLayout::for_width(window_width);

        let mut tabs = div().flex().flex_row().flex_none();
        for page in Page::ALL {
            tabs = tabs.child(self.page_tab(page, layout, cx));
        }

        // `1fr auto 1fr`, which is what the approved prototype's grid is. Equal grow on both
        // flanks puts the six tabs on the *window's* midline whatever the clusters weigh —
        // `pages.md` is explicit that they are centred on the window, not on the gap between
        // the clusters. Done with flex rather than an absolute overlay because an overlay
        // spanning the bar would sit over the two buttons on the right.
        let left = div()
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(8.0))
            .pl(px(BAR_INSET))
            .overflow_hidden()
            .children(layout.show_wordmark.then(|| {
                // A signature, not a menu. It anchors the left edge so the centred group reads
                // as centred, and it is the first thing given up when the window narrows.
                div()
                    .flex_none()
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child("bay")
            }));

        let right = div()
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_row()
            .items_center()
            .justify_end()
            .gap(px(6.0))
            .pr(px(BAR_INSET))
            .child(self.bar_icon("bar-library", "⌂", "Project library", cx, |this, cx| {
                cx.emit(EditorViewEvent::CloseRequested);
                let _ = this;
            }))
            .child(self.bar_icon("bar-settings", "⚙", "Settings", cx, |this, _cx| {
                this.status = Some(
                    "Settings live on the project list for now — ‹ Projects, then Settings."
                        .to_string(),
                );
            }));

        div()
            .h(px(crate::page::BAR_HEIGHT))
            .flex_none()
            .flex()
            .flex_row()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER_SOFT))
            .child(left)
            .child(tabs)
            .child(right)
    }

    /// One page button: glyph over label, and — when it is the active one — a red underline on
    /// the bar's bottom edge.
    ///
    /// The underline is an absolutely positioned strip rather than a bottom border, so it sits on
    /// the *bar's* edge rather than the button's content box, and so its thickness does not
    /// change the button's height and reflow the row.
    fn page_tab(&self, page: Page, layout: BarLayout, cx: &mut Context<Self>) -> gpui::Stateful<Div> {
        let on = self.page == page;
        let mut tab = div()
            .id(("page-tab", page.index()))
            .relative()
            .w(px(layout.tab_width))
            .h_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(4.0))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(theme::HOVER)))
            .child(
                div()
                    .text_color(rgb(if on { theme::EMPHASIS } else { theme::MUTED }))
                    .child(page.glyph()),
            );
        if layout.show_labels {
            tab = tab.child(
                div()
                    .text_xs()
                    .text_color(rgb(if on { theme::EMPHASIS } else { theme::MUTED }))
                    .child(page.label()),
            );
        }
        if on {
            // It cuts, never animates between positions — because the page beneath it cuts too.
            tab = tab.child(
                div()
                    .absolute()
                    .left(px(0.0))
                    .right(px(0.0))
                    .bottom(px(0.0))
                    .h(px(BAR_UNDERLINE))
                    .bg(rgb(theme::RECORD)),
            );
        }
        tab.on_click(cx.listener(move |this, _event, _window, cx| {
            this.show_page(page);
            cx.notify();
        }))
    }

    /// A small square button in the bar's right-hand cluster.
    fn bar_icon(
        &self,
        id: &'static str,
        glyph: &'static str,
        tooltip: &'static str,
        cx: &mut Context<Self>,
        action: impl Fn(&mut EditorView, &mut Context<EditorView>) + 'static,
    ) -> gpui::Stateful<Div> {
        let _ = tooltip;
        widgets::pressable(
            widgets::ButtonKind::Normal,
            widgets::button_face(widgets::ButtonKind::Normal, true)
                .id(id)
                .w(px(BAR_ICON))
                .h(px(24.0))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.0))
                .child(glyph),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            action(this, cx);
            cx.notify();
        }))
    }

    /// The editor as it has always been: toolbar, panels, preview, transport, scenes, timeline.
    ///
    /// Moved here **verbatim** from `render`. This is the Cut page — the one page that exists —
    /// and lifting it out unchanged is what makes the page switch a routing change rather than a
    /// rewrite of the thing that already works.
    fn edit_page(&self, vm: &EditorViewModel, lane_width: f32, cx: &mut Context<Self>) -> Div {
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .child(self.toolbar(vm, cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.panel_rail(cx))
                    .child(self.left_panel(vm, cx))
                    .child(
                        // Preview and transport are one column: the transport belongs under the
                        // picture it drives, not buried in the timeline header where it used to
                        // sit half a screen away from the frame it is scrubbing.
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(self.preview(vm))
                            .child(self.transport(vm, lane_width, cx)),
                    )
                    .child(self.inspector(vm, cx)),
            )
            .child(self.scene_bar(vm, cx))
            .child(self.timeline(vm, lane_width, cx))
    }

    /// A page that is designed but not built: what it will own, and what the engine still owes
    /// it. `pages.md` rules out a blank panel — the map of remaining work is worth having on
    /// screen, which is the same reason a control the engine cannot back is drawn and disabled
    /// rather than hidden.
    fn placeholder_page(&self, page: Page) -> Div {
        div()
            .flex_1()
            .min_h(px(0.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(10.0))
            .p(px(32.0))
            .bg(rgb(theme::BG))
            .child(
                div()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(format!("{}  {}", page.glyph(), page.label()))),
            )
            .child(
                div()
                    .max_w(px(560.0))
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .child(page.blurb()),
            )
            .children(page.engine_gap().map(|gap| {
                widgets::banner(gap, theme::Severity::Warn.dot())
                    .max_w(px(560.0))
            }))
    }
}

impl Render for EditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let lane_width = Self::lane_width(window);
        let window_width = f32::from(window.viewport_size().width);
        if self.playing {
            self.advance_playback();
            self.follow_playhead(lane_width);
            if self.playing {
                window.request_animation_frame();
            }
        }
        // The agent chip expires on a timer, so keep frames coming until it does — otherwise
        // it lingers until something unrelated repaints.
        if self.agent_chip().is_some() {
            window.request_animation_frame();
        }
        // Video decodes run on worker threads. Keep asking for frames while any are in flight so
        // the finished clip actually appears, even when playback is paused.
        //
        // A composite waiting on the GPU is the same obligation: it is collected by a later
        // `update_preview`, so without a tick to collect it the last edit before the window goes
        // idle would stay off screen.
        if self
            .preview
            .as_ref()
            .is_some_and(|p| p.has_pending_decodes() || p.has_pending_readback())
        {
            window.request_animation_frame();
        }
        // Waveform extraction is the same obligation on the audio side: it finishes on a worker
        // and is collected by a later `request_waveforms`, so without a tick the peaks would
        // appear only when something unrelated repainted.
        if self.waveforms.has_pending() {
            window.request_animation_frame();
        }
        if self.needs_focus {
            self.needs_focus = false;
            window.focus(&self.focus_handle);
        }
        self.update_preview();
        // After `update_preview`, so the frame it just replaced gives its tile back now rather
        // than lingering until whatever repaints next — which, once playback stops, may be
        // nothing at all.
        self.release_retired_images(window);
        self.request_waveforms();
        let vm = EditorViewModel::build(&self.editor);

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(theme::BG))
            .text_color(rgb(theme::TEXT))
            .track_focus(&self.focus_handle)
            .key_context(if self.editing_text.is_some() {
                "TextEdit"
            } else {
                "Editor"
            })
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _window, cx| {
                if this.editing_text.is_some() {
                    this.handle_text_key(&event.keystroke);
                    cx.notify();
                }
            }))
            .on_action(cx.listener(|this, _: &Undo, _window, cx| {
                this.editor.undo();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &Redo, _window, cx| {
                this.editor.redo();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &DeleteSelected, _window, cx| {
                this.delete_selected();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &SplitClip, _window, cx| {
                this.split_selected();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &TogglePlay, _window, cx| {
                this.toggle_play();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &SeekForward, _window, cx| {
                this.seek_by(TICKS_PER_SECOND);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &StepForward, _window, cx| {
                this.step_frames(1);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &StepBackward, _window, cx| {
                this.step_frames(-1);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &GoToStart, _window, cx| {
                this.editor.seek(MediaTime::ZERO);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &GoToEnd, _window, cx| {
                let end = this.editor.duration();
                this.editor.seek(end);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &RippleDelete, _window, cx| {
                this.ripple_delete_selected();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &AddMarker, _window, cx| {
                this.add_marker();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &SelectTool, _window, cx| {
                this.tool = Tool::Select;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &RazorTool, _window, cx| {
                this.tool = Tool::Razor;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleSnap, _window, cx| {
                this.snapping = !this.snapping;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ShowMedia, _window, cx| {
                this.show_page(Page::Media);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ShowCut, _window, cx| {
                this.show_page(Page::Cut);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ShowMotion, _window, cx| {
                this.show_page(Page::Motion);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ShowColor, _window, cx| {
                this.show_page(Page::Color);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ShowAudio, _window, cx| {
                this.show_page(Page::Audio);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ShowDeliver, _window, cx| {
                this.show_page(Page::Deliver);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &SelectAll, _window, cx| {
                let all: Vec<ElementRef> = this
                    .editor
                    .active_scene()
                    .tracks
                    .iter()
                    .flat_map(|track| {
                        let track_id = track.id.clone();
                        track
                            .elements
                            .iter()
                            .map(move |element| {
                                ElementRef::new(track_id.clone(), element.id().to_string())
                            })
                            .collect::<Vec<_>>()
                    })
                    .collect();
                this.editor.select(all);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &SeekBackward, _window, cx| {
                this.seek_by(-TICKS_PER_SECOND);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &CopyClip, _window, cx| {
                this.editor.copy();
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &PasteClip, _window, cx| {
                this.editor.execute(Command::Paste);
                cx.notify();
            }))
            // One press handler, one move handler, one release handler, for every gesture the
            // editor has. See `crate::drag` for why there is exactly one slot behind them.
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _event: &MouseDownEvent, _window, cx| {
                    // Anything that must survive a press stops the event before it reaches here,
                    // so by definition this press landed elsewhere — which dismisses an open
                    // list.
                    controls::dismiss_popover(this, cx);
                }),
            )
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _window, cx| {
                this.pointer_moved(event.position, event.modifiers.alt, cx);
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, event: &MouseUpEvent, _window, cx| {
                    this.pointer_released(event.position, event.modifiers.alt, cx);
                }),
            )
            // The page owns the body; the bar is the only thing below it. Both are children of
            // the same column, so the transport band lands at the same distance from the window
            // top on every page that has one — which `pages.md` calls the horizon line of the app.
            .child(match self.page {
                Page::Cut => self.edit_page(&vm, lane_width, cx),
                other => self.placeholder_page(other),
            })
            .child(self.page_bar(window_width, cx))
            // Absolutely positioned and last, so the spike panel sits over the editor rather
            // than beside it. Not `deferred`: a `Select` inside it defers its own popover, and
            // GPUI aborts on a `defer_draw` during deferred drawing — see `controls::Select`.
            .children(
                self.lab
                    .as_ref()
                    .map(|lab| crate::lab::panel(self, lab, cx)),
            )
    }
}

#[cfg(test)]
mod provisioning_tests {
    use super::*;

    /// The offer is what a user reads before spending a gigabyte, so it has to name the size.
    /// A bare "Install" button asks someone to agree to an unknown download.
    #[test]
    fn an_offer_names_what_it_costs() {
        for offer in runtime_offers() {
            assert!(
                offer.label.starts_with("Install "),
                "{:?} should read as an action",
                offer.label
            );
            assert!(
                offer.label.contains(" MB)") || offer.label.contains(" GB)"),
                "{:?} must state the download size",
                offer.label
            );
            assert!(!offer.id.is_empty());
        }
    }

    /// Nothing is offered for something already installed, however it got installed — a user
    /// with Homebrew's ffmpeg must not be nagged to download another copy.
    #[test]
    fn nothing_already_working_is_offered() {
        let offers = runtime_offers();
        for plan in bay_provision::report().components {
            if plan.satisfied {
                assert!(
                    !offers.iter().any(|offer| offer.id == plan.component),
                    "{} is installed but was still offered",
                    plan.component
                );
            }
        }
    }

    fn state(message: &str, done: u64, total: u64) -> bay_provision::jobs::JobState {
        bay_provision::jobs::JobState {
            id: 1,
            component: "video".into(),
            message: message.into(),
            done_bytes: done,
            total_bytes: total,
            finished: false,
            error: None,
        }
    }

    #[test]
    fn progress_reads_as_a_percentage_of_a_named_total() {
        let line = describe_progress(&state("downloading FFmpeg 9.0", 28_000_000, 56_000_000));
        assert!(line.contains("50%"), "{line}");
        assert!(line.contains("56 MB"), "{line}");
    }

    /// The venv step has no byte count bay can see. It must show its message rather than a bar
    /// frozen at a number that means nothing.
    #[test]
    fn a_step_without_a_byte_count_shows_its_message() {
        assert_eq!(
            describe_progress(&state("installing Kokoro — about 1 GB", 0, 0)),
            "installing Kokoro — about 1 GB"
        );
    }

    /// A failed install must surface the whole reason. A digest mismatch names both digests,
    /// and truncating that leaves the reader with nothing actionable.
    #[test]
    fn a_failure_shows_the_whole_error() {
        let mut failed = state("failed", 0, 100);
        failed.finished = true;
        failed.error = Some("expected abc, received def".into());
        let line = describe_progress(&failed);
        assert!(line.contains("expected abc, received def"), "{line}");
        assert!(line.contains("failed"), "{line}");
    }
}

/// The timeline's pointer arithmetic: where a press lands, and what scrolling and zooming do to
/// it. This is the layer where a mistake shows up as "the playhead is a second off" rather than
/// as a crash, so it is asserted rather than eyeballed.
#[cfg(test)]
mod timeline_tests {
    use super::*;
    use gpui::TestAppContext;

    fn view(cx: &mut TestAppContext) -> gpui::Entity<EditorView> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| EditorView::new(Editor::starter(), focus, None, None))
        })
    }

    /// The lane starts after the track labels, so a press must have that gutter taken off it
    /// before it means anything. 96px at the default 48 px/s is two seconds in.
    #[gpui::test]
    fn a_press_on_a_lane_moves_the_playhead_to_that_time(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.scrub_to(lane_origin_x() + 96.0);
            assert_eq!(this.editor.playhead().to_seconds_f64(), 2.0);
        });
    }

    /// Once the lanes can scroll, the same pixel is a different time. Reading the press without
    /// the offset is how a scrub lands a screenful away from the pointer.
    #[gpui::test]
    fn a_scrubbed_press_counts_the_scroll_offset(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.timeline = this.timeline.with_scroll_x(96.0);
            this.scrub_to(lane_origin_x() + 96.0);
            assert_eq!(this.editor.playhead().to_seconds_f64(), 4.0);
        });
    }

    /// Dragging left past the labels asks for a negative time. There is no film before zero.
    #[gpui::test]
    fn a_press_left_of_the_lane_cannot_seek_before_the_start(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.scrub_to(0.0);
            assert_eq!(this.editor.playhead(), MediaTime::ZERO);
        });
    }

    /// A transport still running under the pointer fights the drag: the frame the user let go
    /// on is not the frame they end up looking at.
    #[gpui::test]
    fn scrubbing_stops_playback(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.playing = true;
            this.scrub_to(lane_origin_x() + 48.0);
            assert!(!this.playing, "a scrub takes the transport off the user");
            assert_eq!(this.editor.playhead().to_seconds_f64(), 1.0);
        });
    }

    /// Scrolling stops where the content does, in both directions — the starter runs 7s, so at
    /// 48 px/s there is 336px of film plus half a viewport of tail.
    #[gpui::test]
    fn scrolling_stops_at_both_ends(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            const LANE: f32 = 200.0;
            this.scroll_by(500.0, LANE); // a big swipe right-to-left
            assert_eq!(this.timeline.scroll_x(), 0.0, "there is nothing before the start");

            this.scroll_by(-5_000.0, LANE);
            let content = 7.0 * DEFAULT_PIXELS_PER_SECOND + LANE * 0.5;
            assert!(
                (this.timeline.scroll_x() - (content - LANE)).abs() < 0.5,
                "scrolled to {} past a {content}px timeline",
                this.timeline.scroll_x()
            );
        });
    }

    /// Playback with a scrollable timeline has to bring the playhead with it. A transport that
    /// runs off the right edge leaves the user scrolling to find their own film.
    #[gpui::test]
    fn playback_brings_the_view_with_it(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            const LANE: f32 = 120.0; // ~2.5s of film on screen at the default zoom
            this.editor
                .seek(MediaTime::from_ticks(6 * TICKS_PER_SECOND));
            assert_eq!(this.timeline.scroll_x(), 0.0);

            this.follow_playhead(LANE);
            let x = this.geometry().ticks_to_px(this.editor.playhead());
            assert!(
                (0.0..=LANE).contains(&x),
                "the playhead sits at {x} in a {LANE}px lane"
            );

            // Already on screen: the view must not jump on every frame.
            let settled = this.timeline.scroll_x();
            this.follow_playhead(LANE);
            assert_eq!(this.timeline.scroll_x(), settled);
        });
    }

    /// Zoom anchored on the playhead. Zooming about the left edge instead throws the frame the
    /// user is looking at off screen at every step.
    #[gpui::test]
    fn zooming_keeps_the_playhead_under_the_same_pixel(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            const LANE: f32 = 800.0;
            this.editor
                .seek(MediaTime::from_ticks(3 * TICKS_PER_SECOND));
            let before = this.playhead_anchor_x(LANE);

            this.zoom_by(1.5, before, LANE);
            assert!(this.timeline.pixels_per_second() > DEFAULT_PIXELS_PER_SECOND);
            assert!(
                (this.playhead_anchor_x(LANE) - before).abs() < 1.0,
                "the playhead moved from {before} to {}",
                this.playhead_anchor_x(LANE)
            );
        });
    }
}

/// The left panel: its tabs, the tiles in them, and the divider that resizes it.
#[cfg(test)]
mod panel_tests {
    use super::*;
    use gpui::TestAppContext;

    fn view(cx: &mut TestAppContext) -> gpui::Entity<EditorView> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| EditorView::new(Editor::starter(), focus, None, None))
        })
    }

    /// The library is what opens, because it is the panel a project starts in.
    #[gpui::test]
    fn the_panel_opens_on_the_library(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            assert_eq!(view.panel, Panel::Media);
            assert_eq!(view.media_width, DEFAULT_PANEL_WIDTH);
            assert!(view.collapsed_folders.is_empty(), "groups start open");
        });
    }

    /// A tile on the Text panel adds a clip with nothing selected — that is the whole point of
    /// it — and the new clip is what ends up selected.
    #[gpui::test]
    fn a_text_tile_adds_a_clip_and_selects_it(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor.select(Vec::new());
            view.panel = Panel::Text;
            view.apply_block("text.headline");

            let selected = view.editor.selected_element().expect("the new clip");
            assert_eq!(selected.name(), "Headline");
            assert!(view.status.is_none(), "no complaint: {:?}", view.status);
        });
    }

    /// A tile that needs a clip must explain itself in the status line rather than doing
    /// nothing — a dead-looking button is the failure this replaces.
    #[gpui::test]
    fn a_tile_that_needs_a_clip_says_so_in_the_status_line(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor.select(Vec::new());
            view.panel = Panel::Effects;
            view.apply_block("fx.blur");

            let status = view.status.clone().expect("a complaint");
            assert!(status.contains("Select a clip"), "{status}");
        });
    }

    /// And with a clip selected it applies, undoably, and clears the complaint.
    #[gpui::test]
    fn an_effect_tile_applies_to_the_selection_and_undoes(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor
                .select(vec![ElementRef::new("track-main", "el-title")]);
            view.status = Some("stale".into());
            view.apply_block("fx.blur");

            assert!(view.status.is_none(), "a success must clear the complaint");
            let effects = view.editor.selected_element().unwrap().effects().len();
            assert_eq!(effects, 1);
            assert_eq!(
                view.editor.selected_element().unwrap().effects()[0].effect_type,
                "blur"
            );

            view.editor.undo();
            assert!(view.editor.selected_element().unwrap().effects().is_empty());
        });
    }

    /// Every tile has to mint its own ids. Two clicks that produce the same element id would
    /// make the second clip unaddressable.
    #[gpui::test]
    fn two_clicks_produce_two_distinct_clips(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.apply_block("text.caption");
            let first = view.editor.selection().first().cloned().unwrap();
            view.apply_block("text.caption");
            let second = view.editor.selection().first().cloned().unwrap();
            assert_ne!(first.element_id, second.element_id);
        });
    }

    /// The divider must clamp. Dragged far enough left the panel would reach zero width and
    /// become impossible to grab again.
    ///
    /// Driven through the real handlers rather than by reproducing their arithmetic: this test
    /// used to recompute the clamp itself, which meant it could not have caught a change to the
    /// root handler at all.
    #[gpui::test]
    fn the_panel_divider_clamps_at_both_ends(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, cx| {
            let press = gpui::point(px(100.0), px(300.0));
            view.widgets.begin(Drag::new(
                EditorDrag::PanelWidth {
                    start_width: DEFAULT_PANEL_WIDTH,
                },
                press,
                gpui::Modifiers::default(),
            ));

            view.pointer_moved(gpui::point(px(-5000.0), px(300.0)), false, cx);
            assert_eq!(view.media_width, MIN_PANEL_WIDTH);
            view.pointer_moved(gpui::point(px(5000.0), px(300.0)), false, cx);
            assert_eq!(view.media_width, MAX_PANEL_WIDTH);

            view.pointer_released(gpui::point(px(5000.0), px(300.0)), false, cx);
            assert!(!view.widgets.is_dragging(), "the release has to end it");
            // And a move after the release must not keep resizing the panel.
            view.pointer_moved(gpui::point(px(-5000.0), px(300.0)), false, cx);
            assert_eq!(view.media_width, MAX_PANEL_WIDTH);
        });
    }

    /// The grid gains a column once there is room for one, and never fewer than two.
    #[gpui::test]
    fn the_panel_grid_gains_a_column_when_it_is_wide_enough(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.media_width = MIN_PANEL_WIDTH;
            assert_eq!(view.panel_columns(), 2);
            assert!(view.panel_cell_height(2) > 0.0);

            view.media_width = MAX_PANEL_WIDTH;
            assert_eq!(view.panel_columns(), 3);
        });
    }

    /// Collapsing is stored as the closed set, so a group that appears later is open — a folder
    /// that arrives collapsed hides the file that just landed in it.
    #[gpui::test]
    fn collapsing_a_group_is_remembered_and_reversible(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.collapsed_folders.insert("Audio".into());
            assert!(view.collapsed_folders.contains("Audio"));
            assert!(
                !view.collapsed_folders.contains("Video"),
                "a group nobody touched stays open"
            );
            view.collapsed_folders.remove("Audio");
            assert!(view.collapsed_folders.is_empty());
        });
    }

    /// The transport reads in frames, because that is how a cut is chosen.
    #[test]
    fn the_transport_timecode_counts_frames() {
        assert_eq!(timecode(0.0), "0:00:00:00");
        assert_eq!(timecode(1.0), "0:00:01:00");
        assert_eq!(timecode(2.5), "0:00:02:15");
        assert_eq!(timecode(61.0), "0:01:01:00");
        assert_eq!(timecode(3661.0), "1:01:01:00");
        assert_eq!(
            timecode(-5.0),
            "0:00:00:00",
            "a negative time is not a crash"
        );
    }

    /// Fit must survive an empty timeline rather than dividing by zero.
    #[gpui::test]
    fn fitting_an_empty_timeline_changes_nothing(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor = Editor::new(bay_core::Project::empty(
                "p",
                "Empty",
                bay_core::CanvasSize::default(),
                bay_core::Fps::default(),
                "#000000",
            ));
            let before = view.timeline.pixels_per_second();
            view.fit_to_window(1200.0);
            assert_eq!(view.timeline.pixels_per_second(), before);
        });
    }

    #[gpui::test]
    fn fitting_a_real_timeline_brings_it_into_view(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.timeline = view.timeline.with_scroll_x(500.0);
            view.fit_to_window(1200.0);
            let duration = view.editor.duration().to_seconds_f64() as f32;
            assert!(view.timeline.pixels_per_second() * duration <= 1200.0);
            assert!(view.timeline.pixels_per_second() >= MIN_ZOOM);
            assert_eq!(view.timeline.scroll_x(), 0.0, "fitting starts at the beginning");
        });
    }

    /// Adding an overlay lane must add exactly one, named for its position.
    #[gpui::test]
    fn adding_a_track_adds_one_overlay_lane(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let before = view.editor.active_scene().tracks.overlay.len();
            view.add_overlay_track();
            assert_eq!(view.editor.active_scene().tracks.overlay.len(), before + 1);
        });
    }

    #[gpui::test]
    fn duplicating_needs_a_selection_and_then_copies_the_clip(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor.select(Vec::new());
            let before = view.editor.active_scene().tracks.main.elements.len();
            view.duplicate_selected();
            assert_eq!(
                view.editor.active_scene().tracks.main.elements.len(),
                before,
                "nothing selected, nothing duplicated"
            );

            view.editor
                .select(vec![ElementRef::new("track-main", "el-title")]);
            view.duplicate_selected();
            assert_eq!(
                view.editor.active_scene().tracks.main.elements.len(),
                before + 1
            );
        });
    }
}

/// The two timeline modes the design adds: snapping, and the razor.
#[cfg(test)]
mod tool_tests {
    use super::*;
    use gpui::TestAppContext;

    fn view(cx: &mut TestAppContext) -> gpui::Entity<EditorView> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| EditorView::new(Editor::starter(), focus, None, None))
        })
    }

    /// Snapping is on by default: butt-joining two clips by eye at 48 px/s is a fight.
    #[gpui::test]
    fn snapping_starts_on_and_can_be_switched_off(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            assert!(view.snapping);
            assert_eq!(view.tool, Tool::Select);
            view.snapping = false;
            assert!(!view.snapping);
        });
    }

    /// With snapping on, a drag that lands near a clip edge is pulled to it; with it off, the
    /// same drag lands exactly where the pointer did. A toggle that changes neither is decor.
    #[gpui::test]
    fn the_snap_toggle_actually_changes_where_a_drag_lands(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let reference = ElementRef::new("track-main", "el-title");
            let element = view
                .editor
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|element| element.id() == "el-title")
                .expect("the starter title")
                .clone();
            view.editor.select(vec![reference.clone()]);

            // Nudge the head to a couple of pixels short of the clip that follows it, which is
            // inside the snap tolerance.
            let next_start = view
                .editor
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|other| other.start() > element.start())
                .map(|other| other.start())
                .expect("the starter project has a second clip on the main lane");
            let target_px = view.geometry().delta_ticks_to_px(MediaTime::from_ticks(
                next_start.as_ticks() - element.start().as_ticks(),
            ));
            let drag = BlockDrag {
                reference,
                mode: DragMode::Move,
                origin_start_ticks: element.start().as_ticks(),
                origin_duration_ticks: element.duration().as_ticks(),
            };
            let dragged_px = target_px - 3.0;

            let snapped = view.snapped_delta_px(&drag, dragged_px);
            assert!(
                (snapped - target_px).abs() < 0.01,
                "snapping should pull the head onto the next clip: {snapped} vs {target_px}"
            );

            view.snapping = false;
            assert_eq!(
                view.snapped_delta_px(&drag, dragged_px),
                dragged_px,
                "with snapping off, the drag must land where the pointer did"
            );
        });
    }

    /// The whole clip-drag gesture, through the same three entry points the root element uses:
    /// press on the block, move the pointer, release. This is what the drag refactor had to keep
    /// working — the old test suite reached the commit path only through `snapped_delta_px`, so
    /// nothing checked that a press installed a gesture or that a release committed one.
    #[gpui::test]
    fn a_clip_drag_presses_moves_and_commits(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, cx| {
            view.snapping = false;
            let reference = ElementRef::new("track-main", "el-title");
            let element = view
                .editor
                .active_scene()
                .element(&reference)
                .expect("the starter title")
                .clone();
            let origin = element.start().as_ticks();

            view.editor.select(vec![reference.clone()]);
            view.widgets.begin(Drag::new(
                EditorDrag::Block(BlockDrag {
                    reference: reference.clone(),
                    mode: DragMode::Move,
                    origin_start_ticks: origin,
                    origin_duration_ticks: element.duration().as_ticks(),
                }),
                gpui::point(px(200.0), px(400.0)),
                gpui::Modifiers::default(),
            ));

            // Mid-drag the clip has moved on screen but nothing is committed yet.
            view.pointer_moved(gpui::point(px(296.0), px(400.0)), false, cx);
            assert_eq!(
                view.editor
                    .active_scene()
                    .element(&reference)
                    .unwrap()
                    .start()
                    .as_ticks(),
                origin,
                "a drag in flight must not have edited anything"
            );
            let (_, delta) = view.block_drag().expect("a live block gesture");
            assert!((delta - 96.0).abs() < 0.01, "delta was {delta}");

            view.pointer_released(gpui::point(px(296.0), px(400.0)), false, cx);
            assert!(!view.widgets.is_dragging());
            // 96px at the default 48 px/s is two seconds.
            assert_eq!(
                view.editor
                    .active_scene()
                    .element(&reference)
                    .unwrap()
                    .start()
                    .as_ticks(),
                origin + 2 * TICKS_PER_SECOND,
            );
            assert!(
                view.editor.can_undo(),
                "the drop has to be one undoable edit"
            );
        });
    }

    /// Only one gesture can be in flight. A press on a clip while the playhead is being scrubbed
    /// used to leave both fields set and let an `else if` decide which one the pointer meant.
    #[gpui::test]
    fn a_second_press_replaces_the_gesture_rather_than_joining_it(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, cx| {
            view.widgets.begin(Drag::new(
                EditorDrag::Scrub,
                gpui::point(px(200.0), px(400.0)),
                gpui::Modifiers::default(),
            ));
            view.widgets.begin(Drag::new(
                EditorDrag::PanelWidth {
                    start_width: DEFAULT_PANEL_WIDTH,
                },
                gpui::point(px(300.0), px(400.0)),
                gpui::Modifiers::default(),
            ));
            let before = view.editor.playhead();
            view.pointer_moved(gpui::point(px(360.0), px(400.0)), false, cx);
            assert_eq!(
                view.media_width,
                DEFAULT_PANEL_WIDTH + 60.0,
                "the live gesture is the panel"
            );
            assert_eq!(view.editor.playhead(), before, "and it is not also a scrub");
        });
    }

    /// The razor cuts where it is clicked, and produces two clips that still add up to one.
    #[gpui::test]
    fn the_razor_cuts_a_clip_in_two_at_the_point_clicked(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.tool = Tool::Razor;
            let reference = ElementRef::new("track-main", "el-title");
            let before = view.editor.active_scene().tracks.main.elements.len();
            let original = view
                .editor
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|element| element.id() == "el-title")
                .expect("the starter title")
                .clone();

            // One second in: 48 px/s at the default zoom, plus the label gutter.
            view.split_at_x(&reference, lane_origin_x() + 48.0);

            let elements = &view.editor.active_scene().tracks.main.elements;
            assert_eq!(elements.len(), before + 1, "the razor should add a clip");
            let halves: Vec<_> = elements
                .iter()
                .filter(|element| element.name() == original.name())
                .collect();
            assert_eq!(halves.len(), 2);
            let total: i64 = halves.iter().map(|half| half.duration().as_ticks()).sum();
            assert_eq!(
                total,
                original.duration().as_ticks(),
                "the two halves must add up to the clip that was cut"
            );
            assert!(view.status.is_none(), "no complaint: {:?}", view.status);
        });
    }

    /// A cut on the very edge would leave a clip of no length: unselectable, and a hole nobody
    /// can see. It must be refused with a reason rather than made.
    #[gpui::test]
    fn a_cut_at_the_edge_is_refused_with_a_reason(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.tool = Tool::Razor;
            let reference = ElementRef::new("track-main", "el-title");
            let before = view.editor.active_scene().tracks.main.elements.len();

            view.split_at_x(&reference, lane_origin_x() + 0.5);
            assert_eq!(
                view.editor.active_scene().tracks.main.elements.len(),
                before,
                "nothing should have been cut"
            );
            let status = view.status.clone().expect("a reason");
            assert!(status.contains("too close"), "{status}");
        });
    }

    /// A razor cut on a clip that has since gone must not panic.
    #[gpui::test]
    fn cutting_a_clip_that_is_gone_does_nothing(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let ghost = ElementRef::new("track-main", "el-not-here");
            view.split_at_x(&ghost, lane_origin_x() + 48.0);
            assert!(view.status.is_none());
        });
    }
}

/// Drawing the editor for real: layout, prepaint and paint, at two window sizes.
///
/// Every other test in this file drives state and asserts on it, which never touches the element
/// tree. These call GPUI's whole pipeline through `VisualTestContext::draw`, so a canvas that
/// paints outside its phase, a `deferred` popover whose layout is impossible, a path built from a
/// NaN, or an element id that collides all fail here — none of which a state test can see.
///
/// This is not a substitute for looking at the app. It is the part of "looking at it" that can be
/// checked on every run.
#[cfg(test)]
mod paint_tests {
    use super::*;
    use gpui::{size, TestAppContext, VisualTestContext};

    /// A window with an editor in it, the lab panel forced on so every widget and every drawing
    /// primitive is in the tree.
    fn windowed(cx: &mut TestAppContext) -> (gpui::Entity<EditorView>, &mut VisualTestContext) {
        let (view, cx) = cx.add_window_view(|_window, cx| {
            let focus = cx.focus_handle();
            let mut editor = EditorView::new(Editor::starter(), focus, None, None);
            editor.lab = Some(crate::lab::Lab::default());
            editor
        });
        (view, cx)
    }

    fn paint(view: &gpui::Entity<EditorView>, cx: &mut VisualTestContext, width: f32, height: f32) {
        cx.simulate_resize(size(px(width), px(height)));
        let view = view.clone();
        cx.draw(
            gpui::point(px(0.0), px(0.0)),
            size(px(width), px(height)),
            |_, _| view.into_any_element(),
        );
    }

    /// The window the app actually opens.
    #[gpui::test]
    fn the_editor_and_every_widget_paint_at_1440_by_900(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        paint(&view, cx, 1440.0, 900.0);
    }

    /// A window small enough that the toolbar already collides with itself. Nothing here may
    /// panic on it — a curve editor whose plot has been squeezed to a negative width is exactly
    /// the shape of bug this catches.
    #[gpui::test]
    fn the_editor_and_every_widget_paint_in_a_small_window(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        paint(&view, cx, 640.0, 420.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// The popover path: `deferred` + `anchored`, with the list actually open. This is the only
    /// place in the app that defers an element, and an anchored child with no room to sit in is
    /// a real case at 320px.
    #[gpui::test]
    fn an_open_select_paints_at_both_sizes(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, _| {
            view.widgets.toggle_popover("lab-easing".into());
        });
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// A slider being dragged draws its thumb from the live gesture rather than the model, and a
    /// gesture that has been dragged far off the control still has to paint inside it.
    #[gpui::test]
    fn a_widget_mid_drag_paints(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, cx| {
            let track = gpui::Bounds {
                origin: gpui::point(px(1100.0), px(300.0)),
                size: size(px(300.0), px(18.0)),
            };
            crate::controls::begin_track_drag(
                view,
                "lab-opacity".into(),
                crate::controls::ScrubMap::track(0.0, 1.0, 0.0, 1.0),
                track,
                gpui::point(px(1200.0), px(309.0)),
                gpui::Modifiers::default(),
                1.0,
                std::rc::Rc::new(|view: &mut EditorView, value, _| {
                    view.lab.as_mut().unwrap().opacity = value
                }),
            );
            crate::controls::drive_value_drag(view, gpui::point(px(-4000.0), px(2000.0)), true, cx);
        });
        paint(&view, cx, 1440.0, 900.0);
    }

    /// And with the lab off — the shipping configuration — nothing of it is constructed or drawn.
    #[gpui::test]
    fn the_editor_paints_without_the_lab(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_window, cx| {
            let focus = cx.focus_handle();
            EditorView::new(Editor::starter(), focus, None, None)
        });
        view.update(cx, |view, _| assert!(view.lab.is_none()));
        paint(&view, cx, 1440.0, 900.0);
    }
}
