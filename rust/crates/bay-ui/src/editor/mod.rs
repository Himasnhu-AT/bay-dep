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
use gpui_component::button::Button;
use gpui_component::resizable::{h_resizable, resizable_panel};
use gpui_component::Disableable as _;
use gpui_component::WindowExt as _;

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

/// The editor is one view, carved into regions. They are **child** modules rather than siblings
/// because Rust privacy lets a child see `EditorView`'s private fields and a sibling cannot —
/// the alternative is `pub(crate)` on fifty fields. Each page body added later lands here on the
/// same terms.
mod audio;
mod color;
mod deliver;
mod inspector;
mod media;
mod motion;
mod panels;
mod timeline;
mod toolbar;
mod transport;
mod viewer;

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

/// Where a dragged clip would land, and how much room it would take.
pub struct DragGhost {
    pub track: String,
    pub x: f32,
    pub duration_seconds: Option<f64>,
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

// `DEFAULT_PIXELS_PER_SECOND` lives on `TimelineState` in `geometry.rs`, which owns the zoom
// now that each page carries its own. A second copy here is how the view and the value type
// come to disagree about what a fresh timeline looks like.
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
/// The inspector's resting width. It was a hard `w(px(260.0))` on the panel itself until the
/// split took ownership of panel sizes.
const INSPECTOR_WIDTH: f32 = 260.0;

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
    ///
    /// Owned by [`Self::panel_resize`] now, and mirrored here at the top of every `render`.
    /// It is not only a layout number: `panel_columns` derives the media grid's column count
    /// from it, so the panel has to know its own width during render, not merely be given one.
    media_width: f32,
    /// One thumbnail per media asset, decoded on workers and uploaded once.
    ///
    /// `posters` owns the decode; `poster_images` is the gpui side, built lazily the first time
    /// a decoded frame is drawn. Kept apart because `bay-preview` must not know what a
    /// `RenderImage` is — and because the conversion costs a channel swap that should happen
    /// once per asset, not once per frame.
    posters: bay_preview::poster::PosterCache,
    /// Where a dragged clip would land: the track under the pointer and its x on the lane.
    ///
    /// A drop with no preview is a guess — the pointer is over a lane but the clip's *start* is
    /// what lands, and those are not the same pixel once a clip has any width. Cleared on drop
    /// and whenever a drag leaves.
    drag_ghost: Option<DragGhost>,
    /// Frames along a timeline clip, decoded once per media and uploaded one image per cell.
    strips: bay_preview::poster::FilmstripCache,
    strip_images: std::collections::BTreeMap<String, Vec<Arc<RenderImage>>>,
    poster_images: std::collections::BTreeMap<String, Arc<RenderImage>>,
    /// Where the resizable split between left panel, viewer and inspector keeps its sizes.
    ///
    /// Lazily built because `EditorView::new` has no `Context` to make an entity with, and
    /// giving it one would touch every construction site in the crate's tests for no gain.
    panel_resize: Option<gpui::Entity<gpui_component::resizable::ResizableState>>,
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
    /// The Deliver page's render settings and range.
    ///
    /// The *value* is `bay_agent::deliver::DeliverSettings`, which is headless on purpose:
    /// `pages.md` rule 5 says per-page state is a value type, and rule 4 says a behaviour a
    /// headless test cannot reach is in the wrong crate. What this holds is a form; what it
    /// produces is arguments for the same `render` tool an agent calls.
    deliver: bay_agent::deliver::DeliverSettings,
    /// Each page's own zoom and scroll, remembered while you are elsewhere.
    ///
    /// Keyed by page, because a whole-programme overview and a frame-accurate detail view are
    /// different questions about the same film and answering both with one zoom means neither is
    /// right. The page currently showing reads [`Self::timeline`] instead; this is where the
    /// others wait.
    page_timelines: std::collections::BTreeMap<Page, crate::geometry::TimelineState>,
    /// The Media page's own state: what is selected in the pool, how the pool is drawn and
    /// filtered, and which of its two panels are open.
    ///
    /// A value type living beside its page, per `pages.md` rule 5 — the same shape
    /// [`Self::page_timelines`] uses, and for the same reason: state that looks like view state
    /// and is not is how one field ends up serving two surfaces that disagree about it.
    media_page: media::MediaPageState,
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
            posters: bay_preview::poster::PosterCache::new(),
            drag_ghost: None,
            strips: bay_preview::poster::FilmstripCache::new(),
            strip_images: std::collections::BTreeMap::new(),
            poster_images: std::collections::BTreeMap::new(),
            panel_resize: None,
            collapsed_folders: std::collections::BTreeSet::new(),
            lab: crate::lab::enabled().then(crate::lab::Lab::default),
            page: Page::default(),
            deliver: bay_agent::deliver::DeliverSettings::default(),
            page_timelines: std::collections::BTreeMap::new(),
            media_page: media::MediaPageState::default(),
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

    fn shared(text: impl Into<String>) -> SharedString {
        SharedString::from(text.into())
    }

    /// An enabled button.
    ///
    /// It used to take an `enabled: bool` third parameter — and `BayApp::button`, same name,
    /// takes `primary: bool` in that position. Four call sites passed `false` meaning "not
    /// primary" and shipped buttons that did nothing: "‹ Projects", "Save", the library's
    /// "Import Media…", and the runtime installer that `run.sh` tells people to press. Three of
    /// them were invisible until buttons started drawing their disabled state honestly.
    ///
    /// The parameter is gone rather than fixed. A control that must refuse uses
    /// [`Self::button_enabled`] and says so out loud; everything else cannot get it wrong.
    fn button(
        &self,
        id: &'static str,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, &mut Context<EditorView>) + 'static,
    ) -> Button {
        self.button_enabled(id, label, true, cx, handler)
    }

    /// A button that may be drawn disabled — for a control the engine genuinely cannot back.
    fn button_enabled(
        &self,
        id: &'static str,
        label: &str,
        enabled: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, &mut Context<EditorView>) + 'static,
    ) -> Button {
        // A disabled button is still a button: drawn, refusing, and saying so by its fill. That
        // was already bay's rule; `Disableable` is the library's spelling of it.
        Button::new(id)
            .label(label.to_string())
            .disabled(!enabled)
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this, cx);
                cx.notify();
            }))
    }

    /// How long the "Claude is editing" chip stays up after the last agent edit.
    ///
    /// Long enough to notice a burst of quick edits as one continuous activity, short enough
    /// that it is gone before the user wonders whether it is stuck.
    const AGENT_CHIP: std::time::Duration = std::time::Duration::from_millis(2500);
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
            .child(
                self.bar_icon("bar-library", "⌂", "Project library", cx, |this, cx| {
                    cx.emit(EditorViewEvent::CloseRequested);
                    let _ = this;
                }),
            )
            .child(
                self.bar_icon("bar-settings", "⚙", "Settings", cx, |this, _cx| {
                    this.status = Some(
                        "Settings live on the project list for now — ‹ Projects, then Settings."
                            .to_string(),
                    );
                }),
            );

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
    fn page_tab(
        &self,
        page: Page,
        layout: BarLayout,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
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
    ) -> Button {
        // The tooltip used to be taken and thrown away (`let _ = tooltip;`) because the crate had
        // no tooltip to show it in. It has one now, and an icon-only control is exactly the case
        // that cannot do without: the glyph is the whole label.
        Button::new(id)
            .label(glyph)
            .tooltip(tooltip)
            .compact()
            // Kept explicit rather than letting the button size itself. `BarLayout::for_width`
            // budgets 92px for the bar's right-hand cluster and the ladder is asserted down to a
            // 320px window; a button that quietly chose its own width would break that with no
            // test to catch it, because the ladder's tests assert on `BarLayout`'s arithmetic,
            // not on what actually rendered.
            .w(px(BAR_ICON))
            .h(px(24.0))
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
                    // The rail is not in the split. It is a fixed strip of tabs, not a panel —
                    // there is nothing in it a user would want more or less room for.
                    .child(self.panel_rail(cx))
                    .child(
                        // The three panels the user can actually size. The handles between them
                        // replace the hand-rolled 5px divider that used to drive
                        // `EditorDrag::PanelWidth` through the root mouse handlers.
                        h_resizable("editor-panels")
                            .with_state(
                                self.panel_resize
                                    .as_ref()
                                    .expect("render sets this before building the tree"),
                            )
                            .child(
                                resizable_panel()
                                    .size(px(self.media_width))
                                    .size_range(px(MIN_PANEL_WIDTH)..px(MAX_PANEL_WIDTH))
                                    .child(self.left_panel(vm, cx)),
                            )
                            .child(
                                // Preview and transport are one column: the transport belongs
                                // under the picture it drives, not buried in the timeline header
                                // where it used to sit half a screen away from the frame it is
                                // scrubbing.
                                resizable_panel().child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .size_full()
                                        .min_w(px(0.0))
                                        .child(self.preview(vm))
                                        .child(self.transport(vm, lane_width, cx)),
                                ),
                            )
                            .child(
                                resizable_panel()
                                    .size(px(INSPECTOR_WIDTH))
                                    .size_range(px(200.0)..px(420.0))
                                    .child(self.inspector(vm, cx)),
                            ),
                    ),
            )
            .child(self.scene_bar(vm, cx))
            .child(self.timeline(vm, lane_width, cx))
    }

    /// A page that is designed but not built: what it will own, and what the engine still owes
    /// it. `pages.md` rules out a blank panel — the map of remaining work is worth having on
    /// screen, which is the same reason a control the engine cannot back is drawn and disabled
    /// rather than hidden.
    /// Whether a status message is reporting a failure rather than progress.
    ///
    /// Crude on purpose, and honest about it: `status` is one `Option<String>` shared by thirty
    /// call sites that carry no severity, so the words are all there is to go on. The cost of
    /// being wrong is a red toast where a grey one belonged, not a lost message.
    fn status_is_a_failure(message: &str) -> bool {
        const FAILURES: [&str; 6] = [
            "Could not",
            "Cannot",
            "fail",
            "error",
            "not over that clip",
            "too close to the edge",
        ];
        FAILURES.iter().any(|needle| message.contains(needle))
    }

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
            .children(
                page.engine_gap()
                    .map(|gap| widgets::banner(gap, theme::Severity::Warn.dot()).max_w(px(560.0))),
            )
    }
}

impl Render for EditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Timed as a whole, with the preview hop timed separately inside it, because the two
        // point at different fixes. See `frametime.rs`; off unless BAY_UI_FRAMETIME is set.
        let started = crate::frametime::enabled().then(std::time::Instant::now);
        let tree = self.render_inner(window, cx);
        if let Some(started) = started {
            crate::frametime::record_render(started.elapsed());
        }
        tree
    }
}

impl EditorView {
    fn render_inner(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let lane_width = Self::lane_width(window);
        let window_width = f32::from(window.viewport_size().width);
        // Failures used to land in a 360px strip in the toolbar, in the same grey as everything
        // around it, and were routinely missed. They are notifications now — `Root` hosts the
        // list, which is one of the reasons it wraps the app at all. Taken rather than read, so
        // one failure produces one toast instead of a new one on every frame.
        if let Some(message) = self.status.take() {
            let notification = if Self::status_is_a_failure(&message) {
                gpui_component::notification::Notification::error(message)
            } else {
                gpui_component::notification::Notification::info(message)
            };
            window.push_notification(notification, cx);
        }
        // Mirror the split's width back onto `media_width` before anything reads it. The
        // resizable group owns the number now, but `panel_columns` still has to decide how many
        // media tiles fit across, and that decision happens further down this same frame.
        if self.panel_resize.is_none() {
            self.panel_resize = Some(cx.new(|_| Default::default()));
        }
        if let Some(width) = self
            .panel_resize
            .as_ref()
            .and_then(|state| state.read(cx).sizes().first().copied())
            .map(f32::from)
            .filter(|width| *width > 0.0)
        {
            self.media_width = width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
        }
        // Everything below asks for another frame through `cx.notify()`, never
        // `window.request_animation_frame()`.
        //
        // `request_animation_frame` reads `current_view()`, which unwraps the rendered-entity
        // stack — and that stack is empty under `VisualTestContext::draw`. Every one of these
        // branches was therefore a panic waiting for its condition to become true in a test, and
        // two of them have since become true: pool thumbnails made decodes pending, and pool
        // waveforms made extraction pending. Six paint tests died at the second one. `notify`
        // marks the view dirty and lets the compositor pace the redraw, which is what all of
        // these wanted in the first place.
        if self.playing {
            self.advance_playback();
            self.follow_playhead(lane_width);
            if self.playing {
                cx.notify();
            }
        }
        // The agent chip expires on a timer, so keep frames coming until it does — otherwise
        // it lingers until something unrelated repaints.
        if self.agent_chip().is_some() {
            cx.notify();
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
            cx.notify();
        }
        // Waveform extraction is the same obligation on the audio side: it finishes on a worker
        // and is collected by a later `request_waveforms`, so without a tick the peaks would
        // appear only when something unrelated repainted.
        if self.waveforms.has_pending() {
            cx.notify();
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
        self.request_posters();
        if self.posters.has_pending() || self.strips.has_pending() {
            // A decode landing on a worker changes nothing the signature can see, so without
            // this the picture would not appear until something unrelated repainted.
            //
            cx.notify();
        }
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
            // One arm per page, each in its own file, so a page body can be written without
            // touching this router. `placeholder_page` still backs the pages that are stubs —
            // a tab that opens an empty frame reads as broken, one that says what is coming
            // does not.
            .child(match self.page {
                Page::Media => self.media_page(cx),
                Page::Cut => self.edit_page(&vm, lane_width, cx),
                Page::Motion => self.motion_page(cx),
                Page::Color => self.color_page(cx),
                Page::Audio => self.audio_page(cx),
                Page::Deliver => self.deliver_page(cx),
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
        let (view, cx) = crate::paint_harness::window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            let mut editor = EditorView::new(Editor::starter(), focus, None, None);
            editor.lab = Some(crate::lab::Lab::default());
            editor
        });
        (view, cx)
    }

    use crate::paint_harness::paint;

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
        let (view, cx) = crate::paint_harness::window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            EditorView::new(Editor::starter(), focus, None, None)
        });
        view.update(cx, |view, _| assert!(view.lab.is_none()));
        paint(&view, cx, 1440.0, 900.0);
    }
}
