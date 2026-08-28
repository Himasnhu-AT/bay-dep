//! The timeline: geometry and zoom, pointer gestures, the edit operations they run, and the
//! ruler, tracks and blocks they are performed on.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

/// Width of the drop shadow when the clip's length is unknown.
///
/// Only reached for media that was never probed — a file whose duration could not be read. The
/// shadow still says where the clip starts, which is the part a pointer cannot tell you.
const GHOST_FALLBACK_WIDTH: f32 = 64.0;

/// A media asset being dragged from a library tile onto the timeline.
///
/// gpui's own drag machinery rather than bay's `WidgetState`: this gesture starts in one element
/// and ends in a different one, which is exactly what `on_drag`/`on_drop` is for and what a
/// single root-dispatched drag slot cannot express.
#[derive(Clone)]
pub struct MediaDrag {
    pub media_id: String,
    pub name: String,
    pub path: String,
    /// How long the clip is, so the drop shadow can be its real length.
    ///
    /// Carried rather than probed. The last version drew a fixed 64px because probing on every
    /// pointer move would spawn ffprobe at pointer rate — but nothing needs probing: the pool
    /// measured this at import and has held it ever since.
    pub duration_seconds: Option<f64>,
}

/// What follows the pointer while a tile is being dragged.
///
/// Carries the thumbnail as well as the name: a drag that shows only a filename gives no
/// feedback about *what* is being dragged, which matters most in a pool of similarly-named takes.
pub struct MediaDragChip {
    label: SharedString,
    poster: Option<Arc<RenderImage>>,
}

impl MediaDragChip {
    pub fn new(label: SharedString, poster: Option<Arc<RenderImage>>) -> Self {
        Self { label, poster }
    }
}

impl Render for MediaDragChip {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .p(px(4.0))
            .rounded(px(4.0))
            .bg(rgb(theme::SELECTED))
            .border_1()
            .border_color(rgb(theme::SELECTED_BORDER))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .children(self.poster.clone().map(|image| {
                div()
                    .w(px(48.0))
                    .h(px(32.0))
                    .rounded(px(2.0))
                    .overflow_hidden()
                    .child(img(ImageSource::Render(image)).size_full())
            }))
            .child(self.label.clone())
    }
}

/// Turn a scroll delta into a zoom multiplier.
///
/// Exponential rather than linear, because zoom is multiplicative: at 8 px/s a linear step is a
/// huge jump and at 400 px/s the same step is imperceptible. The 1/300 divisor makes an ordinary
/// trackpad flick roughly a factor of two, and the clamp stops a flung gesture crossing the whole
/// range in one event.
///
/// Positive delta zooms **in**: scrolling up or swiping away from you enlarges, which is the
/// direction every map and every NLE uses.
fn zoom_factor(delta: f32) -> f32 {
    if !delta.is_finite() {
        return 1.0;
    }
    (delta / 300.0).clamp(-1.0, 1.0).exp()
}

impl EditorView {
    /// Ask for a waveform for every audio clip on the timeline, and collect any that finished.
    ///
    /// Called from `render`, so it must not decode: extraction spawns ffmpeg and reads the whole
    /// file, which on a long clip froze the frame for seconds. The cache starts a worker and
    /// returns; `render` draws whatever has arrived. Same contract as the video decode path.
    pub(super) fn request_waveforms(&mut self) {
        // Disjoint field borrows: &mut self.waveforms and &self.editor.
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        self.waveforms.request_scene(scene, media, WAVEFORM_BUCKETS);
    }

    /// The edge a drag is actually moving, after snapping — and the delta in pixels that
    /// produces it, so the block under the pointer and the edit that commits cannot disagree.
    ///
    /// Snapping is applied here rather than at the drop so the user *sees* the clip jump onto
    /// its neighbour's edge while dragging. A snap you only discover after letting go is
    /// indistinguishable from the editor moving your clip on its own.
    pub(super) fn snapped_delta_px(&self, drag: &BlockDrag, delta_px: f32) -> f32 {
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
    pub(super) fn block_drag(&self) -> Option<(&BlockDrag, f32)> {
        let drag = self.widgets.active()?;
        match &drag.kind {
            EditorDrag::Block(block) => Some((block, self.snapped_delta_px(block, drag.dx()))),
            _ => None,
        }
    }

    /// Finish a block drag: commit a single undoable edit (move or edge-trim) from origin to
    /// drop point.
    pub(super) fn finish_drag(&mut self, drag: BlockDrag, delta_px: f32) {
        let delta_px = self.snapped_delta_px(&drag, delta_px);
        let delta_ticks =
            (delta_px / self.timeline.pixels_per_second() * TICKS_PER_SECOND as f32) as i64;
        // A drag straight down moves no time at all, and returning here on `delta_ticks == 0`
        // alone would make the one gesture that is *purely* a change of lane the one gesture
        // that does nothing. The guard is still worth keeping for the click that never moved:
        // committing an edit for it would put an entry in the history for a missed click.
        let changed_lane = self
            .hover_track
            .as_deref()
            .is_some_and(|track| track != drag.reference.track_id);
        if delta_ticks == 0 && !(changed_lane && drag.mode == DragMode::Move) {
            self.hover_track = None;
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
                // A release over a different lane is a move *between* tracks, which is a
                // different command: an `ElementRef` names its track, so there is no start time
                // that carries a clip down a row.
                //
                // Only the dragged clip changes lane. Carrying the rest of a multi-clip selection
                // across would have to decide what "one lane down" means for clips that started
                // on different lanes, and every answer to that is a guess about intent.
                match self.hover_track.take() {
                    Some(track_id) if track_id != drag.reference.track_id => {
                        self.editor.execute(Command::MoveElementToTrack {
                            reference: drag.reference,
                            track_id,
                            start: MediaTime::from_ticks(new_start),
                        });
                    }
                    _ => {
                        self.editor.execute(Command::MoveElement {
                            reference: drag.reference,
                            start: MediaTime::from_ticks(new_start),
                        });
                    }
                }
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
    pub(super) fn begin_scrub(&mut self, event: &MouseDownEvent) {
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
    pub(super) fn pointer_moved(
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
        let scrub_x = matches!(drag.kind, EditorDrag::Scrub).then(|| f32::from(position.x));

        if let Some(x) = scrub_x {
            self.scrub_to(x);
        }
        // A block drag needs nothing committed until release; the redraw is what moves it.
        cx.notify();
    }

    /// The one place a released pointer is interpreted. Committing happens here, so a gesture
    /// that was never released has changed nothing undoable.
    pub(super) fn pointer_released(
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
    pub(super) fn begin_drag(
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

    pub(super) fn delete_selected(&mut self) {
        for reference in self.editor.selection().to_vec() {
            self.editor.execute(Command::RemoveElement { reference });
        }
    }

    /// Delete and close the hole: every later clip on the same lane moves back by the removed
    /// clip's length. This is the delete you want nine times out of ten — the plain one leaves
    /// a gap that reads as a stall in the finished video.
    pub(super) fn ripple_delete_selected(&mut self) {
        for reference in self.editor.selection().to_vec() {
            self.editor.execute(Command::RippleDelete { reference });
        }
    }

    /// Drop a marker at the playhead.
    pub(super) fn add_marker(&mut self) {
        self.add_counter += 1;
        self.editor.execute(Command::AddMarker {
            id: format!("marker-{}", self.add_counter),
            time: self.editor.playhead(),
            label: String::new(),
        });
    }

    /// How long a clip of this file should be. Timed media is probed so a 3-minute track does
    /// not land as a 4-second one; stills are NEVER probed, because ffprobe reports a nominal
    /// ~0.04s for a JPEG (a one-frame "video") and a photo would import as a 40ms clip.
    ///
    /// A probe failure falls back to 4s rather than aborting the import — but it says so. A
    /// silent fallback is the bug probing was added to fix.
    pub(super) fn media_duration(&mut self, path: &str, kind: MediaKind) -> MediaTime {
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
    pub(super) fn place_media(&mut self, media_id: &str, name: &str, path: &str) {
        self.place_media_at(media_id, name, path, None, None);
    }

    /// Place media at a chosen time on a chosen track, falling back to the playhead and the
    /// track its kind belongs on.
    ///
    /// Drag-and-drop supplies both; clicking a tile supplies neither. Kept as one function so a
    /// dropped clip and a clicked one are the same element with the same defaults — two builders
    /// would drift, and the difference would show up as a clip that behaves differently
    /// depending on how it got there.
    pub(super) fn place_media_at(
        &mut self,
        media_id: &str,
        name: &str,
        path: &str,
        at: Option<MediaTime>,
        track: Option<&str>,
    ) {
        let kind = MediaKind::of_path(path);
        let duration = self.media_duration(path, kind);
        // Quantised to a frame and never before zero: a drop is a pointer position, and a clip
        // starting between two frames is one the timeline cannot address.
        let start = at
            .map(|time| {
                let ticks = time.as_ticks().max(0);
                self.geometry()
                    .quantize_to_frame(MediaTime::from_ticks(ticks))
            })
            .unwrap_or_else(|| self.editor.playhead());
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
            track_id: track.unwrap_or(track_id).to_string(),
            element,
            select: true,
        });
    }

    /// Downsample cached peaks to as many bars as the block is wide enough to show.
    ///
    /// **Chunk max, never mean.** A waveform is a picture of extremes; averaging a chunk pulls a
    /// loud transient down towards the silence around it, so a drum hit in a quiet passage
    /// vanishes at exactly the zoom level where someone is looking for it. Taking the max keeps
    /// the envelope, which is what the bars are for and what every editor draws.
    ///
    /// Returning fewer bars than `peaks` when the block is narrow matters as much as filling a
    /// wide one: 512 divs across 40 pixels is 512 elements nobody can see.
    fn waveform_bars(peaks: &[f32], width: f32) -> Vec<f32> {
        // Empty first: `clamp(1, 0)` panics, and `min > max` is exactly what an audio clip whose
        // extraction returned nothing would hand us. The draw path filters those out today, which
        // is why this never fired — a guard one caller deep is not a guard.
        if peaks.is_empty() {
            return Vec::new();
        }
        // About one bar per three pixels: dense enough to read as a waveform, sparse enough that
        // a screen-wide clip is a few hundred elements rather than a few thousand. A negative or
        // NaN width casts to 0 and is lifted to 1 by the clamp, so a degenerate block draws one
        // bar rather than panicking.
        let wanted = ((width / 3.0) as usize).clamp(1, peaks.len());
        if wanted >= peaks.len() {
            return peaks.to_vec();
        }
        (0..wanted)
            .map(|bar| {
                // Span computed from the bar index rather than by stepping, so rounding cannot
                // leave the last chunk short or run past the end.
                let start = bar * peaks.len() / wanted;
                let end = ((bar + 1) * peaks.len() / wanted).max(start + 1);
                peaks[start..end.min(peaks.len())]
                    .iter()
                    .copied()
                    .fold(0.0f32, f32::max)
            })
            .collect()
    }

    /// Split the selected element at the playhead into two clips.
    pub(super) fn split_selected(&mut self) {
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
    pub(super) fn split_at_x(&mut self, reference: &ElementRef, window_x: f32) {
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
        // Two different refusals, and they used to share one message. A playhead *outside* the
        // clip is not "too close to the edge" — it is not on the clip at all, and telling
        // someone to move away from an edge they are nowhere near is worse than saying nothing.
        let margin = MIN_DURATION_TICKS;
        let (start, end) = (element.start().as_ticks(), element.end().as_ticks());
        if at.as_ticks() < start || at.as_ticks() > end {
            self.status =
                Some("The playhead is not over that clip, so there is nothing to cut.".into());
            return;
        }
        if at.as_ticks() <= start + margin || at.as_ticks() >= end - margin {
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

    /// The px ↔ time mapping the whole timeline shares — lanes, ruler, playhead and scrub. One
    /// source, so a clip block and the playhead can't disagree about where a second is.
    pub(super) fn geometry(&self) -> TimelineGeometry {
        self.timeline.geometry(self.editor.project().settings.fps)
    }

    /// Width of one lane: the timeline spans the window, and the lanes take what the track
    /// labels leave.
    pub(super) fn lane_width(window: &Window) -> f32 {
        (f32::from(window.viewport_size().width) - lane_origin_x() - TIMELINE_PADDING).max(1.0)
    }

    /// Scrollable width, with half a viewport of room past the last clip so the end of the film
    /// is not glued to the right edge.
    pub(super) fn content_width(&self, lane_width: f32) -> f32 {
        self.geometry()
            .content_width_px(self.editor.duration(), lane_width * 0.5)
    }

    /// Move the playhead to a window-space x, snapped to a frame.
    ///
    /// Scrubbing stops playback: a transport still running under the pointer fights the drag,
    /// and the frame the user let go on is not the one they end up looking at.
    pub(super) fn scrub_to(&mut self, window_x: f32) {
        if self.playing {
            self.toggle_play();
        }
        let time = self.geometry().px_to_frame_time(window_x - lane_origin_x());
        self.editor.seek(time);
    }

    /// Scroll the lanes horizontally by a wheel/trackpad delta, clamped to the content.
    ///
    pub(super) fn scroll_by(&mut self, delta_x: f32, lane_width: f32) {
        let content = self.content_width(lane_width);
        let wanted = self.timeline.scroll_x() - delta_x;
        self.timeline = self
            .timeline
            .with_scroll_x(crate::geometry::clamp_scroll(wanted, content, lane_width));
    }

    /// Zoom about a fixed point, keeping the time under `anchor_x` on the same pixel. Zooming
    /// around the left edge instead would throw the playhead off screen at every step.
    pub(super) fn zoom_by(&mut self, factor: f32, anchor_x: f32, lane_width: f32) {
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

    /// Duplicate the selection, one clip length later.
    pub(super) fn duplicate_selected(&mut self) {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return;
        };
        self.add_counter += 1;
        let new_id = format!("dup-{}", self.add_counter);
        self.editor
            .execute(Command::DuplicateElement { reference, new_id });
    }

    /// Drop a clip onto a track that does not exist yet, creating it first.
    ///
    /// Dropping below the last lane is how every NLE spells "put this on its own layer", and it
    /// is one gesture rather than the two — add a track, then drag onto it — that the button
    /// beside the timeline requires. The new track is made and the clip lands on it in the same
    /// pass, so an undo of the drop is not left holding an empty lane.
    pub(super) fn drop_onto_new_track(&mut self, media: &MediaDrag, at: MediaTime) {
        self.add_counter += 1;
        // The lane follows the media, which is the whole point of dropping it here. Creating an
        // overlay whatever was dropped put a `.wav` on a lane called "Overlay 1", drawn above the
        // picture — and since `Tracks::iter` orders overlay, main, audio, it also sorted the
        // sound to the top of the timeline. Every NLE puts audio at the bottom; bay's project
        // model already does too, and only this one path disagreed with it.
        let audio = matches!(MediaKind::of_path(&media.path), MediaKind::Audio);
        let (lane, id, name) = if audio {
            let count = self.editor.active_scene().tracks.audio.len() + 1;
            (
                bay_core::command::TrackLane::Audio,
                format!("track-audio-{}", self.add_counter),
                format!("Audio {count}"),
            )
        } else {
            let count = self.editor.active_scene().tracks.overlay.len() + 1;
            (
                bay_core::command::TrackLane::Overlay,
                format!("track-overlay-{}", self.add_counter),
                format!("Overlay {count}"),
            )
        };
        self.editor.execute(Command::AddTrack {
            lane,
            id: id.clone(),
            name,
        });
        self.place_media_at(
            &media.media_id,
            &media.name,
            &media.path,
            Some(at),
            Some(&id),
        );
    }

    /// Add an empty overlay lane.
    pub(super) fn add_overlay_track(&mut self) {
        self.add_counter += 1;
        let count = self.editor.active_scene().tracks.overlay.len() + 1;
        self.editor.execute(Command::AddTrack {
            lane: bay_core::command::TrackLane::Overlay,
            id: format!("track-overlay-{}", self.add_counter),
            name: format!("Overlay {count}"),
        });
    }

    /// Set the zoom so the whole timeline fits the lane.
    pub(super) fn fit_to_window(&mut self, lane_width: f32) {
        let duration = self.editor.duration().to_seconds_f64() as f32;
        if duration <= 0.0 {
            return;
        }
        self.timeline = crate::geometry::TimelineState::new(
            ((lane_width - 20.0) / duration).clamp(MIN_ZOOM, MAX_ZOOM),
            0.0,
        );
    }

    pub(super) fn timeline(
        &self,
        vm: &EditorViewModel,
        lane_width: f32,
        cx: &mut Context<Self>,
    ) -> Div {
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
            // Sideways pans, vertical zooms, and Cmd/Ctrl zooms whichever axis the mouse has.
            //
            // A one-axis wheel cannot pan *and* zoom, so the modifier is what a mouse gets; a
            // trackpad has two axes and uses them, which is the gesture every NLE trains people
            // into. Horizontal is checked first: a two-finger swipe is rarely purely horizontal,
            // and treating its vertical component as a zoom would make every pan drift in scale.
            .on_scroll_wheel(cx.listener(
                move |this, event: &gpui::ScrollWheelEvent, window, cx| {
                    let delta = event.delta.pixel_delta(window.line_height());
                    let (dx, dy) = (f32::from(delta.x), f32::from(delta.y));
                    // `platform` is Cmd on macOS, Super/Win elsewhere.
                    let zoom_held = event.modifiers.platform || event.modifiers.control;

                    // Anchor on the playhead, so the frame being looked at stays put. Anchoring
                    // on the left edge throws it off screen within a few notches. Same anchor
                    // the +/- buttons use, so wheel and button zoom agree.
                    let anchor = this.playhead_anchor_x(lane_width);

                    if zoom_held {
                        // Whichever axis the device moved. A mouse only has one.
                        let amount = if dx.abs() > dy.abs() { dx } else { dy };
                        if amount != 0.0 {
                            this.zoom_by(zoom_factor(amount), anchor, lane_width);
                            cx.notify();
                        }
                    } else if dx != 0.0 {
                        this.scroll_by(dx, lane_width);
                        cx.notify();
                    } else if dy != 0.0 {
                        this.zoom_by(zoom_factor(dy), anchor, lane_width);
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
                    // The razor gets a crosshair. A tool that changes what a click *does* and
                    // not what the pointer looks like is a mode you can be in without knowing
                    // it — and the click it eats is a cut, which is undoable but startling.
                    .when(self.tool == Tool::Razor, |lanes| {
                        lanes.cursor(gpui::CursorStyle::Crosshair)
                    })
                    .children(rows)
                    // Below the last lane: drop here and the clip gets a lane of its own. Sized
                    // generously because it is a target you aim at while holding something, and
                    // a 4px strip is a target you miss.
                    .child(
                        div()
                            .id("timeline-new-track")
                            // Tall enough to hit while holding something. 28px was a target you
                            // aim at; a drop that misses silently looks like the feature is
                            // broken rather than like the pointer was two pixels high.
                            .h(px(LANE_HEIGHT))
                            .mt(px(4.0))
                            .rounded_md()
                            .border_1()
                            .border_dashed()
                            .border_color(rgb(theme::BORDER_SOFT))
                            // The same tint the lanes get. Without it this strip was the one
                            // drop target in the timeline that gave no sign it was under the
                            // pointer, which is indistinguishable from not accepting drops.
                            .drag_over::<MediaDrag>(|style, _, _, _| style.bg(rgb(theme::SELECTED)))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child("Drop here for a new track")
                            .on_drop::<MediaDrag>(cx.listener(
                                |this, media: &MediaDrag, window, cx| {
                                    let x = f32::from(window.mouse_position().x) - lane_origin_x();
                                    let at = this.geometry().px_to_frame_time(x);
                                    this.drop_onto_new_track(media, at);
                                    this.drag_ghost = None;
                                    cx.notify();
                                },
                            )),
                    ),
            )
    }

    /// The row of edit tools above the ruler.
    pub(super) fn timeline_tools(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
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
    pub(super) fn mode_button(
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
    pub(super) fn tool_button(
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
    pub(super) fn ruler(
        &self,
        vm: &EditorViewModel,
        lane_width: f32,
        cx: &mut Context<Self>,
    ) -> Div {
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

    pub(super) fn track_row(
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
            let base_width = (block.duration_seconds as f32 * self.timeline.pixels_per_second())
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
                    .map(|peaks| Self::waveform_bars(peaks, width))
            } else {
                None
            };
            // A video clip with a decoded strip draws its own frames; audio draws peaks;
            // anything else is a label on a coloured bar.
            let cells = if block.kind_label == "Video" {
                block
                    .media_id
                    .as_ref()
                    .and_then(|media| self.filmstrip_cells(media, width, inner_height))
                    .filter(|(cells, _)| !cells.is_empty())
            } else {
                None
            };
            let body = match (waveform, cells) {
                (Some(bars), _) => {
                    base_body
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(1.0))
                        // `flex_1`, not a fixed 2 px. Fixed-width bars covered `2 * buckets`
                        // pixels and left the rest of the block as flat fill — 96 px of peaks on
                        // a clip drawn thousands of pixels wide, which reads as the waveform
                        // having failed rather than as a clip that long. Same mistake the
                        // filmstrip made, and the same fix: size from the block, not a constant.
                        .children(bars.iter().map(|p| {
                            div()
                                .flex_1()
                                .h(px((p * (inner_height - 6.0)).max(1.0)))
                                .bg(rgb(theme::ACCENT))
                        }))
                }
                (None, Some((cells, cell_width))) => base_body
                    // No horizontal padding under a filmstrip: `px_2` would leave two bars of
                    // the old flat fill at the ends, which reads as the strip failing to load.
                    .px_0()
                    .flex()
                    .flex_row()
                    .items_center()
                    .children(cells.into_iter().map(|image| {
                        // Fixed width from the frame's own aspect, not an equal share of the
                        // block. `flex_1` gave every cell the same width whatever shape the frame
                        // was, which squashed a 9:16 clip into vertical stripes.
                        div()
                            .flex_none()
                            .w(px(cell_width))
                            .h(px(inner_height))
                            .overflow_hidden()
                            .child(img(ImageSource::Render(image)).size_full())
                    })),
                (None, None) => base_body
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
                    .id(SharedString::from(format!("lane-{}", track.id)))
                    // Tint the lane the drop would land on, so the target is unambiguous when
                    // two lanes are adjacent.
                    .drag_over::<MediaDrag>(|style, _, _, _| style.bg(rgb(theme::SELECTED)))
                    // Which lane the pointer is over during a *block* drag, so releasing on a
                    // different lane moves the clip there.
                    //
                    // Read from the lane's own handler rather than computed from the pointer's y.
                    // The lanes are a flex column with gaps inside a scrolling region, so
                    // inverting that layout by hand would be arithmetic that has to be kept in
                    // step with the styles — and would be wrong the first time a lane got a
                    // different height. The element that *is* the lane already knows its id.
                    .on_mouse_move(cx.listener({
                        let track_id = track.id.clone();
                        move |this, _event: &gpui::MouseMoveEvent, _window, cx| {
                            if this.block_drag().is_none() {
                                return;
                            }
                            if this.hover_track.as_deref() != Some(track_id.as_str()) {
                                this.hover_track = Some(track_id.clone());
                                cx.notify();
                            }
                        }
                    }))
                    // Track the pointer while it is over this lane, so the ghost below can be
                    // drawn where the clip will actually start.
                    .on_drag_move::<MediaDrag>(cx.listener({
                        let track_id = track.id.clone();
                        move |this, event: &gpui::DragMoveEvent<MediaDrag>, _window, cx| {
                            let x = f32::from(event.event.position.x) - lane_origin_x();
                            let stale = this.drag_ghost.as_ref().is_none_or(|ghost| {
                                ghost.track != track_id || (ghost.x - x).abs() > 0.5
                            });
                            if stale {
                                this.drag_ghost = Some(DragGhost {
                                    track: track_id.clone(),
                                    x,
                                    duration_seconds: event.drag(cx).duration_seconds,
                                });
                                cx.notify();
                            }
                        }
                    }))
                    // Dropping a library tile lands the clip at the pointer, on this track. The
                    // x comes from the window rather than the event because gpui's drop listener
                    // carries the payload and not the position.
                    .on_drop::<MediaDrag>(cx.listener({
                        let track_id = track.id.clone();
                        move |this, media: &MediaDrag, window, cx| {
                            let x = f32::from(window.mouse_position().x) - lane_origin_x();
                            let at = this.geometry().px_to_frame_time(x);
                            this.place_media_at(
                                &media.media_id,
                                &media.name,
                                &media.path,
                                Some(at),
                                Some(track_id.as_str()),
                            );
                            this.drag_ghost = None;
                            cx.notify();
                        }
                    }))
                    .relative()
                    .flex_1()
                    .h(px(LANE_HEIGHT))
                    .rounded_md()
                    .bg(rgb(theme::LANE))
                    .overflow_hidden()
                    // The shadow of where the clip lands. Drawn from the pointer's x, quantised
                    // the same way the drop is, so what is shown is where it goes rather than
                    // an approximation of it.
                    .children(self.drag_ghost.as_ref().and_then(|ghost| {
                        (ghost.track == track.id).then(|| {
                            let at = geometry.px_to_frame_time(ghost.x);
                            let left = geometry.ticks_to_px(at).max(zero_x);
                            // The clip's real length, so the shadow covers the seconds it will
                            // occupy rather than a token 64px. A drop is a decision about how
                            // much of the timeline gets used, and the shadow should show that.
                            let width = ghost
                                .duration_seconds
                                .map(|seconds| {
                                    (seconds as f32 * self.timeline.pixels_per_second())
                                        .max(MIN_BLOCK_WIDTH)
                                })
                                .unwrap_or(GHOST_FALLBACK_WIDTH);
                            div()
                                .absolute()
                                .left(px(left))
                                .top(px(4.0))
                                .h(px(LANE_HEIGHT - 8.0))
                                .w(px(width))
                                .rounded_md()
                                .bg(rgb(theme::SELECTED))
                                .border_1()
                                .border_color(rgb(theme::SELECTED_BORDER))
                        })
                    }))
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

/// The timeline's pointer arithmetic: where a press lands, and what scrolling and zooming do to
/// it. This is the layer where a mistake shows up as "the playhead is a second off" rather than
/// as a crash, so it is asserted rather than eyeballed.
#[cfg(test)]
mod waveform_bar_tests {
    use super::*;

    /// The bug this replaced: 48 bars at a fixed 2 px covered 96 px of a block drawn thousands
    /// of pixels wide, and the rest stayed flat fill. The bar count now follows the block.
    #[test]
    fn a_wide_block_gets_more_bars_than_a_narrow_one() {
        let peaks: Vec<f32> = (0..512).map(|i| (i % 7) as f32 / 7.0).collect();
        let narrow = EditorView::waveform_bars(&peaks, 60.0);
        let wide = EditorView::waveform_bars(&peaks, 1200.0);
        assert!(
            wide.len() > narrow.len(),
            "a 1200 px block got {} bars and a 60 px block got {}",
            wide.len(),
            narrow.len()
        );
        assert!(
            wide.len() <= peaks.len(),
            "downsampling invented {} bars from {} peaks",
            wide.len(),
            peaks.len()
        );
    }

    /// Chunk *max*, not mean. A transient must survive being downsampled — averaging it away at
    /// the zoom level where someone is looking for it is the whole failure mode.
    #[test]
    fn a_loud_transient_survives_downsampling() {
        // One spike in an otherwise near-silent clip.
        let mut peaks = vec![0.01f32; 512];
        peaks[300] = 1.0;
        let bars = EditorView::waveform_bars(&peaks, 90.0);
        assert!(
            bars.iter().copied().fold(0.0f32, f32::max) >= 1.0,
            "the transient was averaged away; loudest bar was {:?}",
            bars.iter().copied().fold(0.0f32, f32::max)
        );
    }

    /// Degenerate inputs reach this from a clip one pixel wide or a waveform that came back
    /// empty, and neither may panic or divide by zero.
    #[test]
    fn degenerate_widths_and_empty_peaks_are_survivable() {
        let peaks = vec![0.5f32; 8];
        for width in [0.0, 1.0, -50.0, f32::NAN, 1e9] {
            let bars = EditorView::waveform_bars(&peaks, width);
            assert!(
                bars.len() <= peaks.len(),
                "width {width} produced {} bars from {} peaks",
                bars.len(),
                peaks.len()
            );
        }
        assert!(EditorView::waveform_bars(&[], 500.0).is_empty());
    }
}

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

    /// Releasing a block over a different lane moves the clip there, as ONE undo step.
    ///
    /// The gesture every NLE has and bay did not: `Command::MoveElement` only sets a start time,
    /// and an `ElementRef` names its track, so no amount of horizontal movement changes a lane.
    #[gpui::test]
    fn releasing_a_block_over_another_lane_moves_it_there(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.add_overlay_track();
            let destination = this
                .editor
                .active_scene()
                .tracks
                .overlay
                .last()
                .expect("the overlay lane was just added")
                .id
                .clone();
            // A clip that exists to be moved, on the main lane.
            this.place_media_at("m1", "Clip", "/tmp/clip.mp4", Some(MediaTime::ZERO), None);
            let reference = this
                .editor
                .selection()
                .first()
                .cloned()
                .expect("placing a clip selects it");
            let origin = reference.track_id.clone();
            assert_ne!(origin, destination, "the test needs two distinct lanes");

            let before = this.editor.can_undo();
            this.hover_track = Some(destination.clone());
            this.finish_drag(
                BlockDrag {
                    reference: reference.clone(),
                    mode: DragMode::Move,
                    origin_start_ticks: 0,
                    origin_duration_ticks: TICKS_PER_SECOND,
                },
                120.0,
            );

            let landed = this
                .editor
                .active_scene()
                .tracks
                .track(&destination)
                .expect("the destination lane still exists")
                .elements
                .iter()
                .any(|element| element.id() == reference.element_id);
            assert!(landed, "the clip did not arrive on the destination lane");
            let left = this
                .editor
                .active_scene()
                .tracks
                .track(&origin)
                .expect("the origin lane still exists")
                .elements
                .iter()
                .any(|element| element.id() == reference.element_id);
            assert!(!left, "the clip is on both lanes at once");

            // One undo, not two. A remove and an add spelled separately would need two.
            let _ = before;
            this.editor.undo();
            let back = this
                .editor
                .active_scene()
                .tracks
                .track(&origin)
                .expect("the origin lane still exists")
                .elements
                .iter()
                .any(|element| element.id() == reference.element_id);
            assert!(back, "one undo did not put the clip back on its own lane");
        });
    }

    /// A drag straight down moves no time at all. The `delta_ticks == 0` early return made that
    /// exact gesture — the one that is *only* a change of lane — the one that did nothing.
    #[gpui::test]
    fn a_purely_vertical_drag_still_changes_lane(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.add_overlay_track();
            let destination = this
                .editor
                .active_scene()
                .tracks
                .overlay
                .last()
                .expect("the overlay lane was just added")
                .id
                .clone();
            this.place_media_at("m1", "Clip", "/tmp/clip.mp4", Some(MediaTime::ZERO), None);
            let reference = this
                .editor
                .selection()
                .first()
                .cloned()
                .expect("placing a clip selects it");

            this.hover_track = Some(destination.clone());
            // Zero horizontal movement: straight down.
            this.finish_drag(
                BlockDrag {
                    reference: reference.clone(),
                    mode: DragMode::Move,
                    origin_start_ticks: 0,
                    origin_duration_ticks: TICKS_PER_SECOND,
                },
                0.0,
            );

            assert!(
                this.editor
                    .active_scene()
                    .tracks
                    .track(&destination)
                    .expect("the destination lane still exists")
                    .elements
                    .iter()
                    .any(|element| element.id() == reference.element_id),
                "a vertical-only drag left the clip where it was"
            );
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
            assert_eq!(
                this.timeline.scroll_x(),
                0.0,
                "there is nothing before the start"
            );

            this.scroll_by(-5_000.0, LANE);
            let content = 7.0 * crate::geometry::DEFAULT_PIXELS_PER_SECOND + LANE * 0.5;
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
            assert!(this.timeline.pixels_per_second() > crate::geometry::DEFAULT_PIXELS_PER_SECOND);
            assert!(
                (this.playhead_anchor_x(LANE) - before).abs() < 1.0,
                "the playhead moved from {before} to {}",
                this.playhead_anchor_x(LANE)
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
    ///
    /// Written Block-then-Scrub since the panel-width gesture moved to the resizable split. The
    /// invariant under test is `pointer_moved`'s dispatch, not which two gestures collide.
    #[gpui::test]
    fn a_second_press_replaces_the_gesture_rather_than_joining_it(cx: &mut TestAppContext) {
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
            view.widgets.begin(Drag::new(
                EditorDrag::Scrub,
                gpui::point(px(300.0), px(400.0)),
                gpui::Modifiers::default(),
            ));

            view.pointer_moved(gpui::point(px(360.0), px(400.0)), false, cx);

            assert!(
                view.block_drag().is_none(),
                "the live gesture is the scrub, so nothing reads as a block drag"
            );
            assert_eq!(
                view.editor
                    .active_scene()
                    .element(&reference)
                    .expect("still there")
                    .start()
                    .as_ticks(),
                origin,
                "and the clip the first press grabbed did not move with it"
            );
        });
    }

    /// A dropped clip lands where it was dropped, not at the playhead.
    ///
    /// The whole point of the gesture. Clicking a tile places at the playhead and always did;
    /// if a drop did the same the drag would be an elaborate click.
    #[gpui::test]
    fn a_dropped_clip_lands_at_the_drop_point(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let media = MediaDrag {
                media_id: "m1".into(),
                name: "Dropped".into(),
                path: "/clip.mp4".into(),
                duration_seconds: Some(5.0),
            };
            view.editor.seek(MediaTime::ZERO);
            let at = MediaTime::from_ticks(5 * TICKS_PER_SECOND);
            view.place_media_at(&media.media_id, &media.name, &media.path, Some(at), None);

            let placed = view
                .editor
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|e| e.name() == "Dropped")
                .expect("the drop added a clip");
            assert!(
                placed.start().as_ticks() > 0,
                "a clip dropped five seconds in must not land at the playhead"
            );
        });
    }

    /// A drop before zero clamps rather than creating a clip at a negative time.
    #[gpui::test]
    fn a_drop_left_of_the_start_clamps_to_zero(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let at = MediaTime::from_ticks(-10 * TICKS_PER_SECOND);
            view.place_media_at("m2", "Early", "/clip.mp4", Some(at), None);
            let placed = view
                .editor
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|e| e.name() == "Early")
                .expect("the drop added a clip");
            assert_eq!(
                placed.start().as_ticks(),
                0,
                "a clip cannot start before the timeline does"
            );
        });
    }

    /// Dropping below the last lane makes the lane and places the clip on it, in one step.
    ///
    /// Two steps would leave an undo holding an empty track — and the gesture exists precisely
    /// to avoid "add a track, then drag onto it".
    #[gpui::test]
    fn dropping_below_the_lanes_creates_a_track_and_uses_it(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let before = view.editor.active_scene().tracks.overlay.len();
            let media = MediaDrag {
                media_id: "m3".into(),
                name: "OnItsOwnLane".into(),
                path: "/clip.mp4".into(),
                duration_seconds: Some(5.0),
            };
            view.drop_onto_new_track(&media, MediaTime::ZERO);

            let overlay = &view.editor.active_scene().tracks.overlay;
            assert_eq!(overlay.len(), before + 1, "a lane was added");
            assert!(
                overlay
                    .last()
                    .expect("just added")
                    .elements
                    .iter()
                    .any(|e| e.name() == "OnItsOwnLane"),
                "and the clip landed on the lane that was just made, not the one below it"
            );
        });
    }

    /// Zoom is multiplicative, so the wheel delta has to be exponential.
    ///
    /// A linear step is enormous at 8 px/s and imperceptible at 400 — the two ends of bay's zoom
    /// range differ by 50x. Exponential makes a flick feel the same at both.
    #[test]
    fn a_scroll_delta_zooms_by_a_ratio_not_an_amount() {
        assert_eq!(zoom_factor(0.0), 1.0, "no scroll is no zoom");
        assert!(zoom_factor(60.0) > 1.0, "scrolling up zooms in");
        assert!(zoom_factor(-60.0) < 1.0, "scrolling down zooms out");

        // Symmetric: a flick out then back in returns to where it started.
        let round_trip = zoom_factor(60.0) * zoom_factor(-60.0);
        assert!(
            (round_trip - 1.0).abs() < 1e-5,
            "equal and opposite flicks must cancel, got {round_trip}"
        );
    }

    /// A flung gesture must not cross the whole zoom range in one event.
    ///
    /// macOS delivers momentum scrolls with very large deltas; without the clamp a single
    /// trackpad flick took the timeline from frames to hours.
    #[test]
    fn a_flung_gesture_is_clamped() {
        let huge = zoom_factor(100_000.0);
        assert!(
            huge <= std::f32::consts::E + 1e-3,
            "one event may not zoom more than e, got {huge}"
        );
        assert!(zoom_factor(-100_000.0) >= 1.0 / std::f32::consts::E - 1e-3);
    }

    /// NaN reaches this from a device that reports one; the render path must not carry it into
    /// the timeline's scale, where it would poison every later conversion.
    #[test]
    fn a_nonfinite_delta_does_not_zoom() {
        assert_eq!(zoom_factor(f32::NAN), 1.0);
        assert_eq!(zoom_factor(f32::INFINITY), 1.0);
        assert_eq!(zoom_factor(f32::NEG_INFINITY), 1.0);
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
