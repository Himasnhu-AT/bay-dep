//! Timeline elements. One `Element` enum over the four concrete kinds, each sharing the
//! common `id / name / start / duration` fields plus its own payload.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::MediaTime;

/// A GPU effect applied to a visual element (e.g. `brightness`), with named scalar params.
/// `BTreeMap` keeps params in a deterministic order for stable serialization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    pub effect_type: String,
    pub enabled: bool,
    pub params: BTreeMap<String, f32>,
}

/// A single animation keyframe: a scalar `value` at a `time` relative to the element's start.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: MediaTime,
    pub value: f32,
}

/// Keyframes for one animated property, kept sorted by time. Linear interpolation between keys;
/// clamped to the first/last value outside the range.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationChannel {
    pub keys: Vec<Keyframe>,
}

impl AnimationChannel {
    /// Sample the animated value at `time` (relative to element start), or `None` if no keys.
    pub fn sample(&self, time: MediaTime) -> Option<f32> {
        let t = time.as_ticks();
        let first = self.keys.first()?;
        if t <= first.time.as_ticks() {
            return Some(first.value);
        }
        let last = self.keys.last()?;
        if t >= last.time.as_ticks() {
            return Some(last.value);
        }
        for window in self.keys.windows(2) {
            let (a, b) = (window[0], window[1]);
            let (ta, tb) = (a.time.as_ticks(), b.time.as_ticks());
            if t >= ta && t <= tb {
                let fraction = if tb == ta {
                    0.0
                } else {
                    (t - ta) as f32 / (tb - ta) as f32
                };
                return Some(a.value + (b.value - a.value) * fraction);
            }
        }
        Some(last.value)
    }

    /// Insert or replace the keyframe at `time`, keeping keys sorted.
    pub fn upsert(&mut self, time: MediaTime, value: f32) {
        match self.keys.iter().position(|k| k.time == time) {
            Some(index) => self.keys[index].value = value,
            None => {
                let position = self
                    .keys
                    .iter()
                    .position(|k| k.time.as_ticks() > time.as_ticks())
                    .unwrap_or(self.keys.len());
                self.keys.insert(position, Keyframe { time, value });
            }
        }
    }
}

/// A visual element's on-canvas placement. Position is the element center as a fraction of the
/// canvas (0..1); `scale` is the fraction of the canvas the element spans (1 = full-frame).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    pub rotation: f32,
    pub opacity: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.5,
            y: 0.5,
            scale: 1.0,
            rotation: 0.0,
            opacity: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub media_id: String,
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub media_id: String,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub content: String,
    pub font_size: f32,
    pub color: String,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub media_id: String,
    pub muted: bool,
    pub volume: f32,
}

/// A timeline element. Serialized with an internal `type` tag matching the web format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Element {
    Video(VideoElement),
    Image(ImageElement),
    Text(TextElement),
    Audio(AudioElement),
}

/// The discriminant of an [`Element`], for display and dispatch without matching payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementKind {
    Video,
    Image,
    Text,
    Audio,
}

impl ElementKind {
    pub fn label(self) -> &'static str {
        match self {
            ElementKind::Video => "Video",
            ElementKind::Image => "Image",
            ElementKind::Text => "Text",
            ElementKind::Audio => "Audio",
        }
    }
}

/// Run `$body` against the inner element struct of whichever variant `$self` is, binding it
/// to `$e`. Every variant shares the fields accessed in the common accessors below.
macro_rules! with_inner {
    ($self:expr, $e:ident => $body:expr) => {
        match $self {
            Element::Video($e) => $body,
            Element::Image($e) => $body,
            Element::Text($e) => $body,
            Element::Audio($e) => $body,
        }
    };
}

impl Element {
    pub fn id(&self) -> &str {
        with_inner!(self, e => &e.id)
    }

    pub fn name(&self) -> &str {
        with_inner!(self, e => &e.name)
    }

    pub fn start(&self) -> MediaTime {
        with_inner!(self, e => e.start)
    }

    pub fn duration(&self) -> MediaTime {
        with_inner!(self, e => e.duration)
    }

    /// End time = start + duration.
    pub fn end(&self) -> MediaTime {
        self.start() + self.duration()
    }

    pub fn kind(&self) -> ElementKind {
        match self {
            Element::Video(_) => ElementKind::Video,
            Element::Image(_) => ElementKind::Image,
            Element::Text(_) => ElementKind::Text,
            Element::Audio(_) => ElementKind::Audio,
        }
    }

    pub fn set_id(&mut self, id: String) {
        with_inner!(self, e => e.id = id);
    }

    pub fn set_name(&mut self, name: String) {
        with_inner!(self, e => e.name = name);
    }

    pub fn set_start(&mut self, start: MediaTime) {
        with_inner!(self, e => e.start = start);
    }

    pub fn set_duration(&mut self, duration: MediaTime) {
        with_inner!(self, e => e.duration = duration);
    }

    /// The on-canvas transform for visual elements (`None` for audio).
    pub fn transform(&self) -> Option<Transform> {
        match self {
            Element::Video(e) => Some(e.transform),
            Element::Image(e) => Some(e.transform),
            Element::Text(e) => Some(e.transform),
            Element::Audio(_) => None,
        }
    }

    pub fn set_transform(&mut self, transform: Transform) {
        match self {
            Element::Video(e) => e.transform = transform,
            Element::Image(e) => e.transform = transform,
            Element::Text(e) => e.transform = transform,
            Element::Audio(_) => {}
        }
    }

    /// Effects applied to a visual element (empty for audio).
    pub fn effects(&self) -> &[Effect] {
        match self {
            Element::Video(e) => &e.effects,
            Element::Image(e) => &e.effects,
            Element::Text(e) => &e.effects,
            Element::Audio(_) => &[],
        }
    }

    /// Mutable effect list for visual elements (`None` for audio).
    pub fn effects_mut(&mut self) -> Option<&mut Vec<Effect>> {
        match self {
            Element::Video(e) => Some(&mut e.effects),
            Element::Image(e) => Some(&mut e.effects),
            Element::Text(e) => Some(&mut e.effects),
            Element::Audio(_) => None,
        }
    }

    /// Animation channels keyed by property path ("opacity"/"scale"/"x"/"y"/"rotation").
    pub fn animations(&self) -> Option<&BTreeMap<String, AnimationChannel>> {
        match self {
            Element::Video(e) => Some(&e.animations),
            Element::Image(e) => Some(&e.animations),
            Element::Text(e) => Some(&e.animations),
            Element::Audio(_) => None,
        }
    }

    pub fn animations_mut(&mut self) -> Option<&mut BTreeMap<String, AnimationChannel>> {
        match self {
            Element::Video(e) => Some(&mut e.animations),
            Element::Image(e) => Some(&mut e.animations),
            Element::Text(e) => Some(&mut e.animations),
            Element::Audio(_) => None,
        }
    }

    /// The transform with animated properties evaluated at `local_time` (relative to element
    /// start). Non-animated properties keep their base values. `None` for audio.
    pub fn sampled_transform(&self, local_time: MediaTime) -> Option<Transform> {
        let mut transform = self.transform()?;
        if let Some(animations) = self.animations() {
            if let Some(v) = animations.get("opacity").and_then(|c| c.sample(local_time)) {
                transform.opacity = v;
            }
            if let Some(v) = animations.get("scale").and_then(|c| c.sample(local_time)) {
                transform.scale = v;
            }
            if let Some(v) = animations.get("x").and_then(|c| c.sample(local_time)) {
                transform.x = v;
            }
            if let Some(v) = animations.get("y").and_then(|c| c.sample(local_time)) {
                transform.y = v;
            }
            if let Some(v) = animations.get("rotation").and_then(|c| c.sample(local_time)) {
                transform.rotation = v;
            }
        }
        Some(transform)
    }

    /// Number of animated properties on this element.
    pub fn animated_property_count(&self) -> usize {
        self.animations().map_or(0, |a| a.len())
    }
}
