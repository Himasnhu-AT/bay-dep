//! The root GPUI editor view: toolbar, media panel, preview, inspector, and timeline. Owns the
//! `opencut_core::Editor` directly, so an interaction mutates it and calls `cx.notify()` to
//! re-render. All editing goes through `Command`s (undoable); clicks use direct selection.

use std::sync::Arc;

use gpui::prelude::*;
use gpui::{
    div, img, px, rgb, App, Context, Div, FocusHandle, ImageSource, KeyBinding, KeyDownEvent,
    MouseButton, MouseDownEvent, MouseMoveEvent, RenderImage, SharedString, Window,
};

use opencut_core::{
    AudioElement, Command, Editor, Element, ElementRef, ImageElement, MediaAsset, MediaTime,
    TextElement, Transform, VideoElement,
};
use opencut_preview::PreviewRenderer;

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

/// In-progress drag of a timeline element.
struct DragState {
    reference: ElementRef,
    mode: DragMode,
    origin_start_ticks: i64,
    origin_duration_ticks: i64,
    pointer_start_x: f32,
    delta_px: f32,
}

/// Minimum on-screen width of a clip block, and its trim handle width.
const MIN_BLOCK_WIDTH: f32 = 10.0;
const TRIM_HANDLE_WIDTH: f32 = 7.0;

/// A saved bundle of a clip's effects + animations (in-memory motion-graphics preset).
#[derive(Clone)]
struct MotionPreset {
    name: String,
    effects: Vec<opencut_core::Effect>,
    animations: std::collections::BTreeMap<String, opencut_core::AnimationChannel>,
}

// Keyboard actions. Bound to keystrokes in `key_bindings()` and handled on the root element.
gpui::actions!(
    vii,
    [
        Undo,
        Redo,
        DeleteSelected,
        SplitClip,
        TogglePlay,
        SeekForward,
        SeekBackward,
        CopyClip,
        PasteClip,
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
        KeyBinding::new("right", SeekForward, editor),
        KeyBinding::new("left", SeekBackward, editor),
        KeyBinding::new("cmd-c", CopyClip, editor),
        KeyBinding::new("cmd-v", PasteClip, editor),
    ]
}

use crate::theme;
use crate::view_model::{EditorViewModel, TrackRow};

/// Pixels per timeline second.
const DEFAULT_PIXELS_PER_SECOND: f32 = 48.0;
const MIN_ZOOM: f32 = 8.0;
const MAX_ZOOM: f32 = 400.0;
const TRACK_LABEL_WIDTH: f32 = 132.0;
const LANE_HEIGHT: f32 = 40.0;
const TICKS_PER_SECOND: i64 = 120_000;

/// Where "Save"/"Load" read and write the project JSON.
fn project_path() -> std::path::PathBuf {
    home_dir().join("vii-project.json")
}

/// Where "Export Frame" writes the composited still.
fn export_frame_path() -> std::path::PathBuf {
    home_dir().join("vii-frame.png")
}

/// Where "Export Video" writes the encoded timeline.
fn export_video_path() -> std::path::PathBuf {
    home_dir().join("vii-export.mp4")
}

fn home_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
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
    dragging: Option<DragState>,
    pixels_per_second: f32,
    /// GPU compositor preview (None if no adapter); the rendered image + a change signature.
    preview: Option<PreviewRenderer>,
    preview_image: Option<Arc<RenderImage>>,
    preview_sig: Option<u64>,
    presets: Vec<MotionPreset>,
    /// media id → cached waveform peaks (empty vec = decoded but no audio / failed).
    waveforms: std::collections::HashMap<String, Vec<f32>>,
    /// Audio output (kept alive) + the current playing sink + decoded-PCM cache.
    audio_output: Option<(rodio::OutputStream, rodio::OutputStreamHandle)>,
    audio_sink: Option<rodio::Sink>,
    audio_cache: std::collections::HashMap<String, std::sync::Arc<opencut_audio::AudioPcm>>,
    /// When editing a text clip: (element ref, current edit buffer).
    editing_text: Option<(ElementRef, String)>,
    /// Last user-facing status/error. Until now every failure (a discarded export, a failed
    /// save, an unavailable ffprobe) was swallowed with `let _ =`, so the app looked broken
    /// with no explanation.
    status: Option<String>,
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
    ) -> Self {
        Self {
            editor,
            add_counter: 0,
            playing: false,
            last_frame: None,
            focus_handle,
            needs_focus: true,
            dragging: None,
            pixels_per_second: DEFAULT_PIXELS_PER_SECOND,
            preview,
            preview_image: None,
            preview_sig: None,
            presets: Vec::new(),
            waveforms: std::collections::HashMap::new(),
            audio_output: rodio::OutputStream::try_default().ok(),
            audio_sink: None,
            audio_cache: std::collections::HashMap::new(),
            editing_text: None,
            status: None,
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
            volume: f32,
        }
        let active: Vec<Active> = {
            let scene = self.editor.active_scene();
            let mut clips = Vec::new();
            for track in &scene.tracks.audio {
                if track.muted {
                    continue;
                }
                for element in &track.elements {
                    if let opencut_core::Element::Audio(audio) = element {
                        let end_sec = element.end().to_seconds_f64();
                        if audio.muted || end_sec <= playhead_sec {
                            continue;
                        }
                        clips.push(Active {
                            media_id: audio.media_id.clone(),
                            start_sec: element.start().to_seconds_f64(),
                            end_sec,
                            volume: audio.volume,
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
                if let Some(pcm) = opencut_audio::decode_pcm(&path, SAMPLE_RATE) {
                    self.audio_cache
                        .insert(clip.media_id.clone(), std::sync::Arc::new(pcm));
                }
            }
        }

        // Mix all decoded clips into one buffer starting at the playhead (borrow ends with block).
        let mixed = {
            let specs: Vec<opencut_audio::MixClip> = active
                .iter()
                .filter_map(|clip| {
                    let pcm = self.audio_cache.get(&clip.media_id)?;
                    Some(opencut_audio::MixClip {
                        pcm: pcm.as_ref(),
                        // Audio has no trim: source position tracks the playhead into the clip.
                        src_start_secs: (playhead_sec - clip.start_sec).max(0.0),
                        dst_start_secs: (clip.start_sec - playhead_sec).max(0.0),
                        play_secs: clip.end_sec - clip.start_sec.max(playhead_sec),
                        volume: clip.volume.clamp(0.0, 2.0),
                    })
                })
                .collect();
            if specs.is_empty() {
                return;
            }
            opencut_audio::mix_stereo(&specs, SAMPLE_RATE, total_sec)
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

    /// Extract waveform peaks (once) for audio clips whose media resolves to a file.
    fn ensure_waveforms(&mut self) {
        let mut todo: Vec<(String, String)> = Vec::new();
        {
            let project = self.editor.project();
            for track in &self.editor.active_scene().tracks.audio {
                for element in &track.elements {
                    if let opencut_core::Element::Audio(audio) = element {
                        if !self.waveforms.contains_key(&audio.media_id) {
                            if let Some(path) = project.media_path(&audio.media_id) {
                                todo.push((audio.media_id.clone(), path.to_string()));
                            }
                        }
                    }
                }
            }
        }
        for (media_id, path) in todo {
            let peaks = opencut_audio::waveform_peaks(&path, 48).unwrap_or_default();
            self.waveforms.insert(media_id, peaks);
        }
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
            effects.push(opencut_core::Effect {
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
        if let opencut_core::Background::Color { color } =
            &self.editor.project().settings.background
        {
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
                        if let opencut_core::Element::Text(text) = element {
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

    /// Re-composite the preview if anything affecting it changed since the last frame.
    fn update_preview(&mut self) {
        if self.preview.is_none() {
            return;
        }
        let signature = self.preview_signature();
        // A decode finishing on a worker thread does NOT change the signature (the project is
        // unchanged), so while any decode is in flight we must re-render unconditionally —
        // otherwise the placeholder would never be replaced by the real frame.
        let awaiting_decode = self
            .preview
            .as_ref()
            .is_some_and(|p| p.has_pending_decodes());
        if self.preview_sig == Some(signature) && !awaiting_decode {
            return;
        }
        self.preview_sig = Some(signature);

        let playhead = self.editor.playhead();
        let background = self.editor.project().settings.background.clone();
        // Disjoint field borrows: &mut self.preview and &self.editor.
        let renderer = self.preview.as_mut().unwrap();
        let scene = self.editor.active_scene();
        let media = self.editor.media();
        let frame = renderer.render(
            scene,
            playhead,
            PREVIEW_RENDER_W,
            PREVIEW_RENDER_H,
            &background,
            media,
        );

        if let Some(buffer) = image::RgbaImage::from_raw(frame.width, frame.height, frame.bgra) {
            let render_image = RenderImage::new(vec![image::Frame::new(buffer)]);
            self.preview_image = Some(Arc::new(render_image));
        }
    }

    /// Finish a drag: commit a single undoable edit (move or edge-trim) from origin to drop point.
    fn finish_drag(&mut self) {
        let Some(drag) = self.dragging.take() else {
            return;
        };
        let delta_ticks = (drag.delta_px / self.pixels_per_second * TICKS_PER_SECOND as f32) as i64;
        if delta_ticks == 0 {
            return;
        }
        match drag.mode {
            DragMode::Move => {
                let new_start = (drag.origin_start_ticks + delta_ticks).max(0);
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
                this.editor.select(vec![reference.clone()]);
                this.dragging = Some(DragState {
                    reference: reference.clone(),
                    mode,
                    origin_start_ticks,
                    origin_duration_ticks,
                    pointer_start_x: f32::from(event.position.x),
                    delta_px: 0.0,
                });
                cx.notify();
            }),
        )
    }

    fn delete_selected(&mut self) {
        if let Some(reference) = self.editor.selection().first().cloned() {
            self.editor.execute(Command::RemoveElement { reference });
        }
    }

    /// Pick an image or video file, import it as a media asset, and add a clip at the playhead.
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
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let is_video = matches!(
            extension.as_str(),
            "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v"
        );
        let is_audio = matches!(
            extension.as_str(),
            "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg"
        );

        self.add_counter += 1;
        let uid = self.add_counter;
        let media_id = format!("media-{uid}");
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Media".to_string());
        let start = self.editor.playhead();
        // Probe timed media for its real length, so a 3-minute clip no longer imports as a
        // 4-second one. Stills are NEVER probed for duration: ffprobe reports a nominal
        // ~0.04s for a JPEG (a one-frame "video"), which would import a photo as a 40ms clip.
        // A probe failure (no ffprobe, unreadable file) falls back rather than aborting.
        const DEFAULT_STILL: i64 = TICKS_PER_SECOND * 4;
        let duration = if is_audio || is_video {
            use opencut_preview::probe::ProbeError;
            match opencut_preview::probe::probe_media(&path.to_string_lossy()) {
                Ok(meta) if meta.duration.as_ticks() > 0 => meta.duration,
                // Do NOT pretend the fallback is the real length: without ffprobe every clip
                // silently imports as 4s, which is the bug probing was added to fix.
                Err(ProbeError::Unavailable) => {
                    self.status = Some(
                        "ffprobe not found — clip length is a 4s guess. Install ffmpeg for real \
                         durations."
                            .to_string(),
                    );
                    MediaTime::from_ticks(DEFAULT_STILL)
                }
                Err(error) => {
                    self.status =
                        Some(format!("Could not read media duration ({error}); using 4s"));
                    MediaTime::from_ticks(DEFAULT_STILL)
                }
                Ok(_) => MediaTime::from_ticks(DEFAULT_STILL),
            }
        } else {
            MediaTime::from_ticks(DEFAULT_STILL)
        };

        self.editor.add_media(MediaAsset {
            id: media_id.clone(),
            name: name.clone(),
            path: path.to_string_lossy().into_owned(),
        });

        let (track_id, element) = if is_audio {
            (
                "track-audio",
                Element::Audio(AudioElement {
                    id: format!("aud-{uid}"),
                    name,
                    start,
                    duration,
                    media_id,
                    muted: false,
                    volume: 1.0,
                }),
            )
        } else if is_video {
            (
                "track-main",
                Element::Video(VideoElement {
                    id: format!("vid-{uid}"),
                    name,
                    start,
                    duration,
                    media_id,
                    trim_start: MediaTime::ZERO,
                    trim_end: duration,
                    transform: Transform::default(),
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                }),
            )
        } else {
            (
                "track-main",
                Element::Image(ImageElement {
                    id: format!("img-{uid}"),
                    name,
                    start,
                    duration,
                    media_id,
                    transform: Transform::default(),
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                }),
            )
        };
        self.editor.execute(Command::AddElement {
            track_id: track_id.into(),
            element,
            select: true,
        });
        self.preview_sig = None; // new media asset → force a re-render
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
        let ok = renderer.export_video(
            scene,
            duration,
            fps,
            width.max(2),
            height.max(2),
            &background,
            media,
            &out.to_string_lossy(),
        );
        self.status = Some(if ok {
            format!("Exported video to {}", out.display())
        } else {
            "Video export failed (is ffmpeg installed?)".to_string()
        });
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
        let base = div()
            .id(id)
            .px_3()
            .py_1()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_sm()
            .text_color(rgb(if enabled { theme::TEXT } else { theme::MUTED }))
            .child(Self::shared(label.to_string()));
        if enabled {
            base.on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this, cx);
                cx.notify();
            }))
        } else {
            base
        }
    }

    fn toolbar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let title = format!("vii — {}", vm.project_name);
        let clipboard = format!("clipboard: {}", vm.clipboard_len);

        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .h(px(50.0))
            .px_3()
            .bg(rgb(theme::PANEL))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_2()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(title))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(clipboard)),
                    )
                    // Status line: the one place failures become visible to the user.
                    .children(self.status.clone().map(|message| {
                        div()
                            .id("status")
                            .px_2()
                            .py_1()
                            .rounded_sm()
                            .bg(rgb(theme::PANEL_ALT))
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(message))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.status = None; // click to dismiss
                                cx.notify();
                            }))
                    }))
                    .child(self.button("save", "Save", true, cx, |this, _cx| {
                        match serde_json::to_string_pretty(this.editor.project())
                            .map_err(|e| e.to_string())
                            .and_then(|json| {
                                std::fs::write(project_path(), json).map_err(|e| e.to_string())
                            }) {
                            Ok(()) => {
                                this.status = Some(format!("Saved to {}", project_path().display()))
                            }
                            Err(error) => this.status = Some(format!("Save failed: {error}")),
                        }
                    }))
                    .child(self.button("load", "Load", true, cx, |this, _cx| {
                        if let Ok(json) = std::fs::read_to_string(project_path()) {
                            if let Ok(project) =
                                serde_json::from_str::<opencut_core::Project>(&json)
                            {
                                this.editor.load_project(project);
                            }
                        }
                    }))
                    .child(self.button(
                        "export-frame",
                        "Export Frame",
                        self.preview.is_some(),
                        cx,
                        |this, _cx| this.export_frame(),
                    ))
                    .child(self.button(
                        "export-video",
                        "Export Video",
                        self.preview.is_some(),
                        cx,
                        |this, _cx| this.export_video(),
                    )),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_2()
                    .child(self.button("add-text", "+ Text", true, cx, |this, cx| {
                        this.add_counter += 1;
                        let id = format!("text-{}", this.add_counter);
                        let element = Element::Text(TextElement {
                            id,
                            name: "Text".into(),
                            start: MediaTime::ZERO,
                            duration: MediaTime::from_ticks(240_000),
                            content: "New text".into(),
                            font_size: 48.0,
                            color: "#ffffff".into(),
                            transform: Transform::default(),
                            effects: Vec::new(),
                            animations: Default::default(),
                            blend_mode: Default::default(),
                            font_family: None,
                            font_weight: 400,
                            align: Default::default(),
                            letter_spacing: 0.0,
                            line_height: 1.2,
                        });
                        this.editor.execute(Command::AddElement {
                            track_id: "track-main".into(),
                            element,
                            select: true,
                        });
                        let _ = cx;
                    }))
                    .child(self.button(
                        "delete",
                        "Delete",
                        vm.selected.is_some(),
                        cx,
                        |this, _cx| {
                            if let Some(reference) = this.editor.selection().first().cloned() {
                                this.editor.execute(Command::RemoveElement { reference });
                            }
                        },
                    ))
                    .child(
                        self.button("split", "Split", vm.selected.is_some(), cx, |this, _cx| {
                            this.split_selected();
                        }),
                    )
                    .child(self.button(
                        "duplicate",
                        "Duplicate",
                        vm.selected.is_some(),
                        cx,
                        |this, _cx| {
                            if let Some(reference) = this.editor.selection().first().cloned() {
                                this.add_counter += 1;
                                let new_id = format!("dup-{}", this.add_counter);
                                this.editor
                                    .execute(Command::DuplicateElement { reference, new_id });
                            }
                        },
                    ))
                    .child(
                        self.button("copy", "Copy", vm.selected.is_some(), cx, |this, _cx| {
                            this.editor.copy();
                        }),
                    )
                    .child(
                        self.button("paste", "Paste", vm.clipboard_len > 0, cx, |this, _cx| {
                            this.editor.execute(Command::Paste);
                        }),
                    )
                    .child(self.button("undo", "Undo", vm.can_undo, cx, |this, _cx| {
                        this.editor.undo();
                    }))
                    .child(self.button("redo", "Redo", vm.can_redo, cx, |this, _cx| {
                        this.editor.redo();
                    })),
            )
    }

    fn scene_bar(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let mut tabs: Vec<gpui::Stateful<Div>> = Vec::new();
        for (index, scene) in vm.scenes.iter().enumerate() {
            let id = scene.id.clone();
            let active = scene.active;
            tabs.push(
                div()
                    .id(("scene", index))
                    .px_3()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(if active {
                        theme::SELECTED
                    } else {
                        theme::PANEL_ALT
                    }))
                    .text_sm()
                    .text_color(rgb(if active { theme::TEXT } else { theme::MUTED }))
                    .child(Self::shared(scene.name.clone()))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.editor.switch_scene(id.clone());
                        cx.notify();
                    })),
            );
        }

        div()
            .flex()
            .flex_row()
            .items_center()
            .gap_2()
            .h(px(40.0))
            .px_3()
            .bg(rgb(theme::PANEL_ALT))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("SCENES"),
            )
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
            }))
    }

    fn media_panel(&self, cx: &mut Context<Self>) -> Div {
        // (element-id, display name, kind).
        let items: [(&'static str, &'static str, &'static str); 3] = [
            ("media-clip", "Clip.mp4", "video"),
            ("media-logo", "Logo.png", "image"),
            ("media-music", "Music.mp3", "audio"),
        ];

        let mut buttons: Vec<gpui::Stateful<Div>> = Vec::new();
        for (id, name, kind) in items {
            buttons.push(
                div()
                    .id(id)
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(rgb(theme::PANEL_ALT))
                    .text_sm()
                    .text_color(rgb(theme::TEXT))
                    .child(name)
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.add_counter += 1;
                        let uid = this.add_counter;
                        let start = this.editor.playhead();
                        let duration = MediaTime::from_ticks(TICKS_PER_SECOND * 5);
                        let (track_id, element) = match kind {
                            "video" => (
                                "track-main".to_string(),
                                Element::Video(VideoElement {
                                    id: format!("clip-{uid}"),
                                    name: name.into(),
                                    start,
                                    duration,
                                    media_id: id.into(),
                                    trim_start: MediaTime::ZERO,
                                    trim_end: duration,
                                    transform: Transform::default(),
                                    effects: Vec::new(),
                                    animations: Default::default(),
                                    blend_mode: Default::default(),
                                }),
                            ),
                            "image" => (
                                "track-main".to_string(),
                                Element::Image(ImageElement {
                                    id: format!("img-{uid}"),
                                    name: name.into(),
                                    start,
                                    duration,
                                    media_id: id.into(),
                                    transform: Transform::default(),
                                    effects: Vec::new(),
                                    animations: Default::default(),
                                    blend_mode: Default::default(),
                                }),
                            ),
                            _ => (
                                "track-audio".to_string(),
                                Element::Audio(AudioElement {
                                    id: format!("aud-{uid}"),
                                    name: name.into(),
                                    start,
                                    duration,
                                    media_id: id.into(),
                                    muted: false,
                                    volume: 1.0,
                                }),
                            ),
                        };
                        this.editor.execute(Command::AddElement {
                            track_id,
                            element,
                            select: true,
                        });
                        cx.notify();
                    })),
            );
        }

        div()
            .flex()
            .flex_col()
            .w(px(200.0))
            .h_full()
            .p_3()
            .gap_2()
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .child(div().text_xs().text_color(rgb(theme::MUTED)).child("MEDIA"))
            .child(
                self.button("import-media", "Import Media…", true, cx, |this, _cx| {
                    this.import_media()
                }),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("Click to add at playhead"),
            )
            .children(buttons)
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
        div()
            .id(id)
            .w(px(22.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_sm()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(label.to_string()))
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
            // One add-button per supported effect type. Blur seeds a 4px sigma; the colour
            // adjustments seed amount 1.0 (no change), then the ± stepper tunes them.
            let add_effects: [(&'static str, &'static str, &'static str); 4] = [
                ("add-fx-brightness", "brightness", "+ Bright"),
                ("add-fx-contrast", "contrast", "+ Contrast"),
                ("add-fx-saturation", "saturation", "+ Sat"),
                ("add-fx-blur", "blur", "+ Blur"),
            ];
            let mut add_row = div().flex().flex_row().flex_wrap().gap_1();
            for (id, effect_type, label) in add_effects {
                let reference = selected.reference.clone();
                add_row = add_row.child(self.button(id, label, true, cx, move |this, _cx| {
                    this.add_counter += 1;
                    let amount = if effect_type == "blur" { 4.0 } else { 1.0 };
                    let effect = opencut_core::Effect {
                        id: format!("fx-{}", this.add_counter),
                        effect_type: effect_type.into(),
                        enabled: true,
                        params: [("amount".to_string(), amount)].into_iter().collect(),
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
        div()
            .id(id)
            .px_2()
            .py_1()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(label.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this);
                cx.notify();
            }))
    }

    fn timeline(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let mut rows: Vec<Div> = Vec::new();
        let mut block_index: usize = 0;
        for track in &vm.tracks {
            rows.push(self.track_row(track, vm.playhead_seconds, &mut block_index, cx));
        }

        let readout = format!("{:.2}s / {:.2}s", vm.playhead_seconds, vm.duration_seconds);
        let transport = div()
            .flex()
            .flex_row()
            .items_center()
            .gap_2()
            .child(self.transport_button(
                "play",
                if self.playing {
                    "⏸ Pause"
                } else {
                    "▶ Play"
                },
                cx,
                |this| this.toggle_play(),
            ))
            .child(self.transport_button("seek-start", "|◀", cx, |this| {
                this.editor.seek(MediaTime::ZERO)
            }))
            .child(self.transport_button("seek-back", "◀ 1s", cx, |this| {
                let ticks = this.editor.playhead().as_ticks();
                this.editor
                    .seek(MediaTime::from_ticks(ticks - TICKS_PER_SECOND));
            }))
            .child(self.transport_button("seek-fwd", "1s ▶", cx, |this| {
                let ticks = this.editor.playhead().as_ticks();
                this.editor
                    .seek(MediaTime::from_ticks(ticks + TICKS_PER_SECOND));
            }))
            .child(self.transport_button("seek-end", "▶|", cx, |this| {
                this.editor.seek(this.editor.duration())
            }))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(readout)),
            )
            .child(self.transport_button("zoom-out", "− zoom", cx, |this| {
                this.pixels_per_second = (this.pixels_per_second / 1.5).max(MIN_ZOOM);
            }))
            .child(self.transport_button("zoom-in", "zoom +", cx, |this| {
                this.pixels_per_second = (this.pixels_per_second * 1.5).min(MAX_ZOOM);
            }));

        div()
            .flex()
            .flex_col()
            .h(px(250.0))
            .p_2()
            .gap_1()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(transport)
            .children(rows)
    }

    fn track_row(
        &self,
        track: &TrackRow,
        playhead_seconds: f64,
        block_index: &mut usize,
        cx: &mut Context<Self>,
    ) -> Div {
        let mut blocks: Vec<gpui::Stateful<Div>> = Vec::new();
        for block in &track.elements {
            let id = *block_index;
            *block_index += 1;
            let reference = block.reference.clone();
            let origin_start_ticks = (block.start_seconds * TICKS_PER_SECOND as f64) as i64;
            let origin_duration_ticks = (block.duration_seconds * TICKS_PER_SECOND as f64) as i64;

            // Live geometry while this block is the one being dragged/trimmed.
            let base_left = block.start_seconds as f32 * self.pixels_per_second;
            let base_width =
                (block.duration_seconds as f32 * self.pixels_per_second).max(MIN_BLOCK_WIDTH);
            let (mut left, mut width) = (base_left, base_width);
            if let Some(drag) = &self.dragging {
                if drag.reference == block.reference {
                    match drag.mode {
                        DragMode::Move => left = (base_left + drag.delta_px).max(0.0),
                        DragMode::TrimStart => {
                            left = (base_left + drag.delta_px).max(0.0);
                            width = (base_width - drag.delta_px).max(MIN_BLOCK_WIDTH);
                        }
                        DragMode::TrimEnd => {
                            width = (base_width + drag.delta_px).max(MIN_BLOCK_WIDTH);
                        }
                    }
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
                    .and_then(|m| self.waveforms.get(m))
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
            .gap_2()
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
                    .children(blocks)
                    .child(
                        // Playhead line across this lane.
                        div()
                            .absolute()
                            .left(px(playhead_seconds as f32 * self.pixels_per_second))
                            .top(px(0.0))
                            .w(px(2.0))
                            .h(px(LANE_HEIGHT))
                            .bg(rgb(theme::ACCENT)),
                    ),
            )
    }
}

impl Render for EditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.playing {
            self.advance_playback();
            if self.playing {
                window.request_animation_frame();
            }
        }
        // Video decodes run on worker threads. Keep asking for frames while any are in flight so
        // the finished clip actually appears, even when playback is paused.
        if self
            .preview
            .as_ref()
            .is_some_and(|p| p.has_pending_decodes())
        {
            window.request_animation_frame();
        }
        if self.needs_focus {
            self.needs_focus = false;
            window.focus(&self.focus_handle);
        }
        self.update_preview();
        self.ensure_waveforms();
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
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _window, cx| {
                if let Some(drag) = this.dragging.as_mut() {
                    drag.delta_px = f32::from(event.position.x) - drag.pointer_start_x;
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _event, _window, cx| {
                    if this.dragging.is_some() {
                        this.finish_drag();
                        cx.notify();
                    }
                }),
            )
            .child(self.toolbar(&vm, cx))
            .child(self.scene_bar(&vm, cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.media_panel(cx))
                    .child(self.preview(&vm))
                    .child(self.inspector(&vm, cx)),
            )
            .child(self.timeline(&vm, cx))
    }
}
