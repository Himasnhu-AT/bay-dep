//! The editing surface the MCP tools drive.
//!
//! [`Studio`] owns an [`Editor`] (the project + undo stack) and, lazily, a
//! [`PreviewRenderer`] (the GPU compositor). Every tool is a method here that takes already
//! parsed arguments and returns a `serde_json::Value`; the protocol layer in `server.rs` knows
//! nothing about video and this module knows nothing about JSON-RPC.
//!
//! **Layers.** The scene's z-order is `main` (bottom) then `overlay[0..]` (upward). Tools take
//! a single `layer` integer instead of a track id: `0` is main, `n` is `overlay[n-1]`, and
//! missing overlay lanes are created on demand. That makes stacking order an explicit,
//! orderable number rather than something an author has to infer from track names.

use std::collections::BTreeMap;

use opencut_core::{Command, Editor};
use opencut_preview::PreviewRenderer;
use opencut_project::{
    AnimationChannel, AudioElement, Background, BlendMode, CanvasSize, Easing, Element, Fps,
    ImageElement, MediaAsset, MediaTime, Project, ProjectMetadata, ProjectSettings, Scene,
    ShapeElement, ShapeKind, TextAlign, TextElement, Track, TrackKind, Tracks, Transform,
    VideoElement,
};

/// Anything a tool can refuse to do. Surfaces to the caller as an MCP tool error, which the
/// agent sees and can correct — so the messages name the offending value.
#[derive(Debug)]
pub struct ToolError(pub String);

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ToolError {}

pub type ToolResult = Result<serde_json::Value, ToolError>;

pub fn err(message: impl Into<String>) -> ToolError {
    ToolError(message.into())
}

fn secs(seconds: f64) -> Result<MediaTime, ToolError> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(err(format!(
            "time must be a finite, non-negative number of seconds (got {seconds})"
        )));
    }
    MediaTime::from_seconds_f64(seconds).ok_or_else(|| {
        err(format!(
            "{seconds}s is outside the representable time range"
        ))
    })
}

/// The placement + look shared by every visual element, parsed once from tool arguments.
pub struct VisualArgs {
    pub transform: Transform,
    pub blend_mode: BlendMode,
}

pub struct Studio {
    editor: Editor,
    renderer: Option<PreviewRenderer>,
    /// Set when the GPU was tried and refused, so a headless box reports the real reason
    /// instead of retrying the adapter request on every single frame.
    renderer_unavailable: Option<String>,
    text_probe: opencut_text::TextRaster,
    next_id: u64,
}

impl Default for Studio {
    fn default() -> Self {
        Self::new()
    }
}

impl Studio {
    pub fn new() -> Self {
        Self {
            editor: Editor::new(empty_project("Untitled", 1080, 1920, 30, "#000000")),
            renderer: None,
            renderer_unavailable: None,
            text_probe: opencut_text::TextRaster::new(),
            next_id: 1,
        }
    }

    pub fn project(&self) -> &Project {
        self.editor.project()
    }

    fn fresh_id(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}-{}", self.next_id);
        self.next_id += 1;
        id
    }

    /// The compositor, built on first use. Held open afterwards because adapter acquisition
    /// costs far more than a frame does.
    fn renderer(&mut self) -> Result<&mut PreviewRenderer, ToolError> {
        if self.renderer.is_none() {
            if let Some(reason) = &self.renderer_unavailable {
                return Err(err(reason.clone()));
            }
            match PreviewRenderer::new() {
                Some(renderer) => self.renderer = Some(renderer),
                None => {
                    let reason = "no GPU adapter available — vii cannot composite frames on \
                                  this machine (a headless Linux box usually needs a Vulkan \
                                  or GL driver installed)"
                        .to_string();
                    self.renderer_unavailable = Some(reason.clone());
                    return Err(err(reason));
                }
            }
        }
        Ok(self.renderer.as_mut().expect("just constructed"))
    }

    // ---------------------------------------------------------------- project

    pub fn project_create(
        &mut self,
        name: &str,
        width: u32,
        height: u32,
        fps: u32,
        background: &str,
    ) -> ToolResult {
        if width == 0 || height == 0 {
            return Err(err("canvas width and height must both be non-zero"));
        }
        if fps == 0 {
            return Err(err("fps must be at least 1"));
        }
        self.editor
            .load_project(empty_project(name, width, height, fps, background));
        self.next_id = 1;
        Ok(serde_json::json!({
            "name": name,
            "canvas": { "width": width, "height": height },
            "fps": fps,
            "background": background,
        }))
    }

    pub fn project_info(&self) -> ToolResult {
        let project = self.editor.project();
        let scene = project.active_scene();
        let visual: usize = scene
            .tracks
            .iter()
            .filter(|t| !matches!(t.kind, TrackKind::Audio))
            .map(|t| t.elements.len())
            .sum();
        let audio: usize = scene.tracks.audio.iter().map(|t| t.elements.len()).sum();
        Ok(serde_json::json!({
            "name": project.metadata.name,
            "canvas": {
                "width": project.settings.canvas.width,
                "height": project.settings.canvas.height,
            },
            "fps": project.settings.fps.as_f64(),
            "durationSeconds": self.editor.duration().to_seconds_f64(),
            "visualElements": visual,
            "audioElements": audio,
            "mediaAssets": project.media.len(),
            "layers": 1 + scene.tracks.overlay.len(),
        }))
    }

    pub fn project_save(&self, path: &str) -> ToolResult {
        let json = serde_json::to_string_pretty(self.editor.project())
            .map_err(|e| err(format!("could not serialize project: {e}")))?;
        std::fs::write(path, json).map_err(|e| err(format!("could not write {path}: {e}")))?;
        Ok(serde_json::json!({ "path": path }))
    }

    pub fn project_load(&mut self, path: &str) -> ToolResult {
        let text = std::fs::read_to_string(path)
            .map_err(|e| err(format!("could not read {path}: {e}")))?;
        let project: Project = serde_json::from_str(&text)
            .map_err(|e| err(format!("{path} is not a valid vii project: {e}")))?;
        self.editor.load_project(project);
        self.project_info()
    }

    // ------------------------------------------------------------------ media

    pub fn media_import(&mut self, path: &str, id: Option<String>) -> ToolResult {
        let absolute = std::fs::canonicalize(path)
            .map_err(|e| err(format!("could not resolve media path {path}: {e}")))?;
        let absolute = absolute.to_string_lossy().to_string();
        let name = std::path::Path::new(&absolute)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "media".to_string());
        let media_id = id.unwrap_or_else(|| self.fresh_id("media"));

        // Probe so callers get the real duration/size rather than guessing. A probe failure is
        // not fatal — an asset can still be placed with an explicit duration — but it IS
        // reported, because silently defaulting is how a 3-minute clip became a 4-second one.
        let probed = opencut_preview::probe::probe_media(&absolute);
        self.editor.add_media(MediaAsset {
            id: media_id.clone(),
            name: name.clone(),
            path: absolute.clone(),
        });

        let mut out = serde_json::json!({
            "mediaId": media_id,
            "name": name,
            "path": absolute,
        });
        match probed {
            Ok(meta) => {
                out["durationSeconds"] = serde_json::json!(meta.duration.to_seconds_f64());
                out["width"] = serde_json::json!(meta.width);
                out["height"] = serde_json::json!(meta.height);
                out["hasAudio"] = serde_json::json!(meta.has_audio);
                out["hasVideo"] = serde_json::json!(meta.has_video);
            }
            Err(e) => {
                out["probeError"] = serde_json::json!(e.to_string());
            }
        }
        Ok(out)
    }

    /// Which of `families` are actually installed. cosmic-text silently substitutes a fallback
    /// for an unknown family, so without this an author only discovers a missing typeface by
    /// staring at a rendered frame and wondering why it looks wrong.
    pub fn fonts_check(&mut self, families: &[String]) -> ToolResult {
        let mut available = Vec::new();
        let mut missing = Vec::new();
        for family in families {
            if self.text_probe.has_family(family) {
                available.push(family.clone());
            } else {
                missing.push(family.clone());
            }
        }
        Ok(serde_json::json!({ "available": available, "missing": missing }))
    }

    // --------------------------------------------------------------- elements

    /// The track id for `layer`, creating overlay lanes as needed so an author can address
    /// layer 4 without having created layers 1–3 by hand.
    fn track_for_layer(&mut self, layer: usize) -> String {
        if layer == 0 {
            return self.editor.active_scene().tracks.main.id.clone();
        }
        let scene_id = self.editor.active_scene_id().to_string();
        let project = self.editor.project_mut();
        let scene = project
            .scenes
            .iter_mut()
            .find(|s| s.id == scene_id)
            .expect("active scene exists");
        while scene.tracks.overlay.len() < layer {
            let index = scene.tracks.overlay.len() + 1;
            scene.tracks.overlay.push(Track::new(
                format!("track-overlay-{index}"),
                format!("Overlay {index}"),
                TrackKind::Overlay,
            ));
        }
        scene.tracks.overlay[layer - 1].id.clone()
    }

    fn audio_track(&mut self) -> String {
        let scene_id = self.editor.active_scene_id().to_string();
        let project = self.editor.project_mut();
        let scene = project
            .scenes
            .iter_mut()
            .find(|s| s.id == scene_id)
            .expect("active scene exists");
        if scene.tracks.audio.is_empty() {
            scene
                .tracks
                .audio
                .push(Track::new("track-audio", "Audio", TrackKind::Audio));
        }
        scene.tracks.audio[0].id.clone()
    }

    fn add(&mut self, layer: usize, element: Element) -> ToolResult {
        let id = element.id().to_string();
        let track_id = self.track_for_layer(layer);
        let start = element.start().to_seconds_f64();
        let end = element.end().to_seconds_f64();
        if !self.editor.execute(Command::AddElement {
            track_id: track_id.clone(),
            element,
            select: false,
        }) {
            return Err(err(format!("could not add element to track {track_id}")));
        }
        Ok(serde_json::json!({
            "elementId": id,
            "layer": layer,
            "trackId": track_id,
            "startSeconds": start,
            "endSeconds": end,
        }))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_text(
        &mut self,
        layer: usize,
        id: Option<String>,
        start: f64,
        duration: f64,
        content: String,
        font_size: f32,
        color: String,
        font_family: Option<String>,
        font_weight: u16,
        align: TextAlign,
        letter_spacing: f32,
        line_height: f32,
        visual: VisualArgs,
    ) -> ToolResult {
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        // A misspelled family renders in a fallback face that looks almost right, which is the
        // worst possible failure: it survives every automated check and only a human notices.
        if let Some(family) = &font_family
            && !self.text_probe.has_family(family)
        {
            return Err(err(format!(
                "font family {family:?} is not installed — call fonts_check first to see what \
                 is available on this machine"
            )));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("text"));
        let element = Element::Text(TextElement {
            id,
            name: content.chars().take(24).collect(),
            start: secs(start)?,
            duration: secs(duration)?,
            content,
            font_size,
            color,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
            font_family,
            font_weight,
            align,
            letter_spacing,
            line_height,
        });
        self.add(layer, element)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_shape(
        &mut self,
        layer: usize,
        id: Option<String>,
        start: f64,
        duration: f64,
        shape: ShapeKind,
        color: String,
        visual: VisualArgs,
    ) -> ToolResult {
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("shape"));
        let element = Element::Shape(ShapeElement {
            name: id.clone(),
            id,
            start: secs(start)?,
            duration: secs(duration)?,
            shape,
            color,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
        });
        self.add(layer, element)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_image(
        &mut self,
        layer: usize,
        id: Option<String>,
        media_id: String,
        start: f64,
        duration: f64,
        visual: VisualArgs,
    ) -> ToolResult {
        self.require_media(&media_id)?;
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("image"));
        let element = Element::Image(ImageElement {
            name: id.clone(),
            id,
            start: secs(start)?,
            duration: secs(duration)?,
            media_id,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
        });
        self.add(layer, element)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_video(
        &mut self,
        layer: usize,
        id: Option<String>,
        media_id: String,
        start: f64,
        duration: f64,
        trim_start: f64,
        visual: VisualArgs,
    ) -> ToolResult {
        self.require_media(&media_id)?;
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("video"));
        let element = Element::Video(VideoElement {
            name: id.clone(),
            id,
            start: secs(start)?,
            duration: secs(duration)?,
            media_id,
            trim_start: secs(trim_start)?,
            trim_end: MediaTime::ZERO,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
        });
        self.add(layer, element)
    }

    pub fn add_audio(
        &mut self,
        id: Option<String>,
        media_id: String,
        start: f64,
        duration: f64,
        volume: f32,
    ) -> ToolResult {
        self.require_media(&media_id)?;
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("audio"));
        let element = Element::Audio(AudioElement {
            name: id.clone(),
            id: id.clone(),
            start: secs(start)?,
            duration: secs(duration)?,
            media_id,
            muted: false,
            volume,
        });
        let track_id = self.audio_track();
        if !self.editor.execute(Command::AddElement {
            track_id: track_id.clone(),
            element,
            select: false,
        }) {
            return Err(err("could not add audio element"));
        }
        Ok(serde_json::json!({ "elementId": id, "trackId": track_id }))
    }

    fn require_media(&self, media_id: &str) -> Result<(), ToolError> {
        if self.editor.project().media_path(media_id).is_none() {
            return Err(err(format!(
                "no media asset {media_id:?} — import it with media_import first"
            )));
        }
        Ok(())
    }

    /// Attach a keyframe channel to an element. Replaces any existing channel for the same
    /// property, so re-animating is idempotent rather than additive.
    pub fn animate(
        &mut self,
        element_id: &str,
        property: &str,
        keys: Vec<(f64, f32)>,
        easing: Easing,
    ) -> ToolResult {
        if !Element::ANIMATABLE.contains(&property) {
            return Err(err(format!(
                "{property:?} is not animatable — pick one of {:?}",
                Element::ANIMATABLE
            )));
        }
        if keys.len() < 2 {
            return Err(err(
                "an animation needs at least two keyframes (a start and an end)",
            ));
        }
        let mut channel = AnimationChannel {
            keys: Vec::new(),
            easing,
        };
        for (t, value) in keys {
            if !value.is_finite() {
                return Err(err(format!("keyframe value at t={t} is not finite")));
            }
            channel.upsert(secs(t)?, value);
        }

        let element = self
            .find_element_mut(element_id)
            .ok_or_else(|| err(format!("no element {element_id:?} on the timeline")))?;
        let animations = element.animations_mut().ok_or_else(|| {
            err(format!(
                "{element_id:?} is an audio clip and has no transform"
            ))
        })?;
        let count = channel.keys.len();
        animations.insert(property.to_string(), channel);
        Ok(serde_json::json!({
            "elementId": element_id,
            "property": property,
            "keyframes": count,
        }))
    }

    fn find_element_mut(&mut self, element_id: &str) -> Option<&mut Element> {
        let scene_id = self.editor.active_scene_id().to_string();
        let project = self.editor.project_mut();
        let scene = project.scenes.iter_mut().find(|s| s.id == scene_id)?;
        scene
            .tracks
            .iter_mut()
            .flat_map(|track| track.elements.iter_mut())
            .find(|element| element.id() == element_id)
    }

    pub fn element_delete(&mut self, element_id: &str) -> ToolResult {
        let scene_id = self.editor.active_scene_id().to_string();
        let project = self.editor.project_mut();
        let scene = project
            .scenes
            .iter_mut()
            .find(|s| s.id == scene_id)
            .expect("active scene exists");
        for track in scene.tracks.iter_mut() {
            if let Some(index) = track.elements.iter().position(|e| e.id() == element_id) {
                track.elements.remove(index);
                return Ok(serde_json::json!({ "deleted": element_id }));
            }
        }
        Err(err(format!("no element {element_id:?} on the timeline")))
    }

    /// The whole timeline as data: what is on each layer, when, and where. This is how an
    /// agent re-reads its own work between edits without keeping a parallel model in its head.
    pub fn timeline(&self) -> ToolResult {
        let scene = self.editor.active_scene();
        let mut layers = Vec::new();
        for (index, track) in std::iter::once(&scene.tracks.main)
            .chain(scene.tracks.overlay.iter())
            .enumerate()
        {
            layers.push(serde_json::json!({
                "layer": index,
                "trackId": track.id,
                "elements": track.elements.iter().map(describe_element).collect::<Vec<_>>(),
            }));
        }
        let audio: Vec<_> = scene
            .tracks
            .audio
            .iter()
            .flat_map(|t| t.elements.iter())
            .map(describe_element)
            .collect();
        Ok(serde_json::json!({
            "durationSeconds": self.editor.duration().to_seconds_f64(),
            "layers": layers,
            "audio": audio,
        }))
    }

    // ----------------------------------------------------------------- output

    /// Render a single frame to a PNG. The point of this tool is that an agent can *look* at
    /// what it built — every quality failure that matters (blank frame, collided type, a hero
    /// number too small to read) is invisible to a structural check and obvious in a frame.
    pub fn snapshot(&mut self, at: f64, path: &str, scale: f32) -> ToolResult {
        let project = self.editor.project().clone();
        let canvas = project.settings.canvas;
        let width = ((canvas.width as f32 * scale) as u32).max(16);
        let height = ((canvas.height as f32 * scale) as u32).max(16);
        let playhead = secs(at)?;
        let renderer = self.renderer()?;
        let frame = renderer.render(
            project.active_scene(),
            playhead,
            width,
            height,
            &project.settings.background,
            &project.media,
        );

        // The compositor hands back BGRA; PNG wants RGBA.
        let mut rgba = frame.bgra;
        for texel in rgba.chunks_exact_mut(4) {
            texel.swap(0, 2);
        }
        let buffer = image::RgbaImage::from_raw(width, height, rgba)
            .ok_or_else(|| err("rendered frame did not match its declared size"))?;
        buffer
            .save(path)
            .map_err(|e| err(format!("could not write {path}: {e}")))?;

        Ok(serde_json::json!({
            "path": path,
            "atSeconds": at,
            "width": width,
            "height": height,
        }))
    }

    /// Encode the whole timeline to an MP4, picture and sound.
    pub fn render_video(&mut self, path: &str, duration: Option<f64>) -> ToolResult {
        let project = self.editor.project().clone();
        let timeline_duration = self.editor.duration().to_seconds_f64();
        let duration = duration.unwrap_or(timeline_duration);
        if duration <= 0.0 {
            return Err(err(
                "nothing to render — the timeline is empty, so its duration is zero",
            ));
        }
        let fps = project.settings.fps.as_f64();
        let canvas = project.settings.canvas;
        let renderer = self.renderer()?;
        let started = std::time::Instant::now();
        let ok = renderer.export_video(
            project.active_scene(),
            duration,
            fps,
            canvas.width,
            canvas.height,
            &project.settings.background,
            &project.media,
            path,
        );
        if !ok {
            return Err(err(format!(
                "ffmpeg failed to encode {path} — check that ffmpeg is on PATH and that every \
                 audio asset resolves"
            )));
        }
        let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        Ok(serde_json::json!({
            "path": path,
            "durationSeconds": duration,
            "fps": fps,
            "width": canvas.width,
            "height": canvas.height,
            "bytes": bytes,
            "encodeSeconds": started.elapsed().as_secs_f64(),
        }))
    }
}

fn describe_element(element: &Element) -> serde_json::Value {
    let mut out = serde_json::json!({
        "id": element.id(),
        "kind": element.kind().label(),
        "startSeconds": element.start().to_seconds_f64(),
        "durationSeconds": element.duration().to_seconds_f64(),
    });
    if let Some(t) = element.transform() {
        out["transform"] = serde_json::json!({
            "x": t.x, "y": t.y, "scale": t.scale,
            "scaleX": t.scale_x, "scaleY": t.scale_y,
            "anchorX": t.anchor_x, "anchorY": t.anchor_y,
            "rotation": t.rotation, "opacity": t.opacity,
        });
    }
    if let Some(animations) = element.animations()
        && !animations.is_empty()
    {
        out["animated"] = serde_json::json!(animations.keys().collect::<Vec<_>>());
    }
    if let Element::Text(text) = element {
        out["content"] = serde_json::json!(text.content);
        out["fontSize"] = serde_json::json!(text.font_size);
        out["color"] = serde_json::json!(text.color);
    }
    if let Element::Shape(shape) = element {
        out["color"] = serde_json::json!(shape.color);
    }
    out
}

/// A project with one empty scene — the starting point every reel is built up from. The
/// `Project::starter()` demo scene would otherwise leave placeholder blocks in the render.
fn empty_project(name: &str, width: u32, height: u32, fps: u32, background: &str) -> Project {
    Project {
        metadata: ProjectMetadata {
            id: "project-mcp".into(),
            name: name.into(),
        },
        settings: ProjectSettings {
            fps: Fps {
                numerator: fps,
                denominator: 1,
            },
            canvas: CanvasSize { width, height },
            background: Background::Color {
                color: background.into(),
            },
        },
        scenes: vec![Scene {
            id: "scene-main".into(),
            name: "Main".into(),
            is_main: true,
            tracks: Tracks {
                overlay: Vec::new(),
                main: Track::new("track-main", "Main", TrackKind::Video),
                audio: Vec::new(),
            },
        }],
        current_scene_id: "scene-main".into(),
        media: Vec::new(),
    }
}

/// Parse a keyframe list. Shared by `animate` so the error messages stay in one place.
pub fn parse_keys(raw: &serde_json::Value) -> Result<Vec<(f64, f32)>, ToolError> {
    let array = raw
        .as_array()
        .ok_or_else(|| err("keys must be an array of {t, value} objects"))?;
    let mut keys = Vec::with_capacity(array.len());
    for (index, entry) in array.iter().enumerate() {
        let t = entry
            .get("t")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| err(format!("keys[{index}] is missing a numeric \"t\"")))?;
        let value = entry
            .get("value")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| err(format!("keys[{index}] is missing a numeric \"value\"")))?;
        keys.push((t, value as f32));
    }
    Ok(keys)
}

/// Map a wire easing name onto the engine enum, listing the valid names when it does not match.
pub fn parse_easing(name: Option<&str>) -> Result<Easing, ToolError> {
    Ok(match name.unwrap_or("linear") {
        "linear" => Easing::Linear,
        "ease-in" => Easing::EaseIn,
        "ease-out" => Easing::EaseOut,
        "ease-in-out" => Easing::EaseInOut,
        "power-out" => Easing::PowerOut,
        "expo-out" => Easing::ExpoOut,
        "back-out" => Easing::BackOut,
        "hold" => Easing::Hold,
        other => {
            return Err(err(format!(
                "unknown easing {other:?} — use one of linear, ease-in, ease-out, ease-in-out, \
                 power-out, expo-out, back-out, hold"
            )));
        }
    })
}

pub fn parse_blend(name: Option<&str>) -> Result<BlendMode, ToolError> {
    let Some(name) = name else {
        return Ok(BlendMode::Normal);
    };
    serde_json::from_value(serde_json::Value::String(name.to_string())).map_err(|_| {
        err(format!(
            "unknown blend mode {name:?} — use one of {:?}",
            BlendMode::ALL
                .iter()
                .map(|m| serde_json::to_value(m).unwrap())
                .collect::<Vec<_>>()
        ))
    })
}

pub fn parse_align(name: Option<&str>) -> Result<TextAlign, ToolError> {
    Ok(match name.unwrap_or("left") {
        "left" => TextAlign::Left,
        "center" => TextAlign::Center,
        "right" => TextAlign::Right,
        other => {
            return Err(err(format!(
                "unknown align {other:?} — left, center or right"
            )));
        }
    })
}
