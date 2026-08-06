//! Timeline elements. One `Element` enum over the five concrete kinds, each sharing the
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

/// The interpolation curve applied between two keyframes. Linear alone reads mechanical —
/// motion graphics need acceleration, so the channel carries its own easing rather than
/// forcing authors to fake curves with dense keyframes.
///
/// Names mirror the GSAP/CSS vocabulary an author already has in their head; the exponents
/// are the standard `power2`/`power3` shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Easing {
    #[default]
    Linear,
    /// `power2.in` — slow start.
    EaseIn,
    /// `power2.out` — the workhorse for entrances.
    EaseOut,
    /// `power2.inOut` — for anything transforming in place.
    EaseInOut,
    /// `power3.out` — sharper settle than `EaseOut`.
    PowerOut,
    /// `expo.out` — near-instant arrival, long tail. Snappy reveals.
    ExpoOut,
    /// Overshoots past 1 and settles back. Use sparingly.
    BackOut,
    /// No interpolation at all: hold `a` until `b`'s time, then jump. For cuts and blinks.
    Hold,
}

impl Easing {
    /// Remap a normalized `0..=1` progress through this curve. Only `BackOut` leaves the
    /// unit range (deliberately — that overshoot is the effect).
    pub fn apply(self, t: f32) -> f32 {
        let t = t.clamp(0.0, 1.0);
        match self {
            Easing::Linear => t,
            Easing::EaseIn => t * t,
            Easing::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
            Easing::EaseInOut => {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
                }
            }
            Easing::PowerOut => 1.0 - (1.0 - t).powi(3),
            Easing::ExpoOut => {
                if t >= 1.0 {
                    1.0
                } else {
                    1.0 - (-10.0 * t).exp2()
                }
            }
            Easing::BackOut => {
                const C1: f32 = 1.70158;
                const C3: f32 = C1 + 1.0;
                1.0 + C3 * (t - 1.0).powi(3) + C1 * (t - 1.0).powi(2)
            }
            Easing::Hold => 0.0,
        }
    }
}

/// Keyframes for one animated property, kept sorted by time. Values between keys are
/// interpolated through the channel's [`Easing`]; outside the key range the value is clamped
/// to the first/last key.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationChannel {
    pub keys: Vec<Keyframe>,
    #[serde(default)]
    pub easing: Easing,
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
                let eased = self.easing.apply(fraction);
                return Some(a.value + (b.value - a.value) * eased);
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

/// How a layer composites against everything beneath it. Mirrors the compositor's WGSL blend
/// set (and the web app's wire format) but stays GPU-free so the data model has no render
/// dependency; `vii-preview` maps these onto `compositor::BlendMode`.
/// Wire format is **kebab-case** to match `compositor::BlendMode` and the web app's
/// `BlendMode` union (`apps/web/src/rendering/index.ts`) — e.g. `"color-burn"`,
/// `"plus-lighter"`. Using camelCase here would silently break project interchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    #[default]
    Normal,
    Darken,
    Multiply,
    ColorBurn,
    Lighten,
    Screen,
    PlusLighter,
    ColorDodge,
    Overlay,
    SoftLight,
    HardLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl BlendMode {
    /// Every mode, in the order the inspector cycles through them.
    pub const ALL: [BlendMode; 17] = [
        BlendMode::Normal,
        BlendMode::Darken,
        BlendMode::Multiply,
        BlendMode::ColorBurn,
        BlendMode::Lighten,
        BlendMode::Screen,
        BlendMode::PlusLighter,
        BlendMode::ColorDodge,
        BlendMode::Overlay,
        BlendMode::SoftLight,
        BlendMode::HardLight,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Hue,
        BlendMode::Saturation,
        BlendMode::Color,
        BlendMode::Luminosity,
    ];

    /// Human-readable name for the inspector.
    pub fn label(self) -> &'static str {
        match self {
            BlendMode::Normal => "Normal",
            BlendMode::Darken => "Darken",
            BlendMode::Multiply => "Multiply",
            BlendMode::ColorBurn => "Color Burn",
            BlendMode::Lighten => "Lighten",
            BlendMode::Screen => "Screen",
            BlendMode::PlusLighter => "Plus Lighter",
            BlendMode::ColorDodge => "Color Dodge",
            BlendMode::Overlay => "Overlay",
            BlendMode::SoftLight => "Soft Light",
            BlendMode::HardLight => "Hard Light",
            BlendMode::Difference => "Difference",
            BlendMode::Exclusion => "Exclusion",
            BlendMode::Hue => "Hue",
            BlendMode::Saturation => "Saturation",
            BlendMode::Color => "Color",
            BlendMode::Luminosity => "Luminosity",
        }
    }

    /// The next mode in `ALL`, wrapping — drives the inspector's cycle button.
    pub fn next(self) -> BlendMode {
        let index = BlendMode::ALL.iter().position(|m| *m == self).unwrap_or(0);
        BlendMode::ALL[(index + 1) % BlendMode::ALL.len()]
    }
}

fn one() -> f32 {
    1.0
}

fn half() -> f32 {
    0.5
}

/// A visual element's on-canvas placement. Position is the element's *anchor* as a fraction of
/// the canvas (0..1); `scale` is the fraction of the canvas the element spans (1 = full-frame).
///
/// `scale_x`/`scale_y` are independent multipliers applied on top of `scale`. They exist
/// because a bar chart is impossible without them: growing a bar means scaling one axis while
/// the other holds. `anchor_x`/`anchor_y` say which point of the layer sits at `(x, y)` —
/// `(0.5, 0.5)` is the centre (the historical behaviour), `(0.0, 0.5)` is the left edge, so a
/// bar animated on `scaleX` grows rightward from a fixed origin instead of from its middle.
///
/// Both default to the old semantics, so every project written before they existed still
/// deserializes and renders identically.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    pub rotation: f32,
    pub opacity: f32,
    #[serde(default = "one")]
    pub scale_x: f32,
    #[serde(default = "one")]
    pub scale_y: f32,
    #[serde(default = "half")]
    pub anchor_x: f32,
    #[serde(default = "half")]
    pub anchor_y: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.5,
            y: 0.5,
            scale: 1.0,
            rotation: 0.0,
            opacity: 1.0,
            scale_x: 1.0,
            scale_y: 1.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
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
    #[serde(default)]
    pub blend_mode: BlendMode,
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
    #[serde(default)]
    pub blend_mode: BlendMode,
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
    #[serde(default)]
    pub blend_mode: BlendMode,
    /// Font family name resolved against the system font set (e.g. `"Helvetica Neue"`,
    /// `"Menlo"`). `None` uses whatever the shaper picks by default.
    #[serde(default)]
    pub font_family: Option<String>,
    /// CSS-style numeric weight (400 regular, 700 bold).
    #[serde(default = "default_weight")]
    pub font_weight: u16,
    #[serde(default)]
    pub align: TextAlign,
    /// Extra tracking in em (0.18 matches the house kicker style). Negative tightens.
    #[serde(default)]
    pub letter_spacing: f32,
    /// Line box height as a multiple of the font size.
    #[serde(default = "default_line_height")]
    pub line_height: f32,
}

fn default_weight() -> u16 {
    400
}

fn default_line_height() -> f32 {
    1.2
}

/// Horizontal alignment of text within its layer box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// The geometry a [`ShapeElement`] draws. Shapes are the missing primitive for data graphics:
/// bars, rules, dots, panels and underlines are all one of these two.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShapeKind {
    /// Axis-aligned rectangle. `radius` is the corner radius as a fraction of the shorter
    /// side (0 = square corners, 0.5 = fully rounded ends).
    Rect {
        #[serde(default)]
        radius: f32,
    },
    /// Ellipse inscribed in the layer box. A circle when the box is square.
    Ellipse,
}

impl Default for ShapeKind {
    fn default() -> Self {
        ShapeKind::Rect { radius: 0.0 }
    }
}

/// A solid-colour vector primitive. Carries the same transform/effect/animation surface as
/// every other visual element, so a bar can be eased, blended and effected like any layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    #[serde(default)]
    pub shape: ShapeKind,
    /// `#rrggbb` fill.
    pub color: String,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
    #[serde(default)]
    pub blend_mode: BlendMode,
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
    Shape(ShapeElement),
}

/// The discriminant of an [`Element`], for display and dispatch without matching payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementKind {
    Video,
    Image,
    Text,
    Audio,
    Shape,
}

impl ElementKind {
    pub fn label(self) -> &'static str {
        match self {
            ElementKind::Video => "Video",
            ElementKind::Image => "Image",
            ElementKind::Text => "Text",
            ElementKind::Audio => "Audio",
            ElementKind::Shape => "Shape",
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
            Element::Shape($e) => $body,
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
            Element::Shape(_) => ElementKind::Shape,
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
            Element::Shape(e) => Some(e.transform),
            Element::Audio(_) => None,
        }
    }

    pub fn set_transform(&mut self, transform: Transform) {
        match self {
            Element::Video(e) => e.transform = transform,
            Element::Image(e) => e.transform = transform,
            Element::Text(e) => e.transform = transform,
            Element::Shape(e) => e.transform = transform,
            Element::Audio(_) => {}
        }
    }

    /// How this element composites over the layers beneath it. `None` for audio (not visual).
    pub fn blend_mode(&self) -> Option<BlendMode> {
        match self {
            Element::Video(e) => Some(e.blend_mode),
            Element::Image(e) => Some(e.blend_mode),
            Element::Text(e) => Some(e.blend_mode),
            Element::Shape(e) => Some(e.blend_mode),
            Element::Audio(_) => None,
        }
    }

    pub fn set_blend_mode(&mut self, blend_mode: BlendMode) {
        match self {
            Element::Video(e) => e.blend_mode = blend_mode,
            Element::Image(e) => e.blend_mode = blend_mode,
            Element::Text(e) => e.blend_mode = blend_mode,
            Element::Shape(e) => e.blend_mode = blend_mode,
            Element::Audio(_) => {}
        }
    }

    /// Effects applied to a visual element (empty for audio).
    pub fn effects(&self) -> &[Effect] {
        match self {
            Element::Video(e) => &e.effects,
            Element::Image(e) => &e.effects,
            Element::Text(e) => &e.effects,
            Element::Shape(e) => &e.effects,
            Element::Audio(_) => &[],
        }
    }

    /// Mutable effect list for visual elements (`None` for audio).
    pub fn effects_mut(&mut self) -> Option<&mut Vec<Effect>> {
        match self {
            Element::Video(e) => Some(&mut e.effects),
            Element::Image(e) => Some(&mut e.effects),
            Element::Text(e) => Some(&mut e.effects),
            Element::Shape(e) => Some(&mut e.effects),
            Element::Audio(_) => None,
        }
    }

    /// Animation channels keyed by property path ("opacity"/"scale"/"x"/"y"/"rotation").
    pub fn animations(&self) -> Option<&BTreeMap<String, AnimationChannel>> {
        match self {
            Element::Video(e) => Some(&e.animations),
            Element::Image(e) => Some(&e.animations),
            Element::Text(e) => Some(&e.animations),
            Element::Shape(e) => Some(&e.animations),
            Element::Audio(_) => None,
        }
    }

    pub fn animations_mut(&mut self) -> Option<&mut BTreeMap<String, AnimationChannel>> {
        match self {
            Element::Video(e) => Some(&mut e.animations),
            Element::Image(e) => Some(&mut e.animations),
            Element::Text(e) => Some(&mut e.animations),
            Element::Shape(e) => Some(&mut e.animations),
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
            if let Some(v) = animations
                .get("rotation")
                .and_then(|c| c.sample(local_time))
            {
                transform.rotation = v;
            }
            if let Some(v) = animations.get("scaleX").and_then(|c| c.sample(local_time)) {
                transform.scale_x = v;
            }
            if let Some(v) = animations.get("scaleY").and_then(|c| c.sample(local_time)) {
                transform.scale_y = v;
            }
        }
        Some(transform)
    }

    /// The animatable transform properties, in the order the inspector lists them. Also the
    /// set the MCP surface validates against, so an unknown channel name is a hard error
    /// rather than an animation that silently never plays.
    pub const ANIMATABLE: [&'static str; 7] =
        ["opacity", "scale", "x", "y", "rotation", "scaleX", "scaleY"];

    /// The shape payload, for `Shape` elements only.
    pub fn shape(&self) -> Option<&ShapeElement> {
        match self {
            Element::Shape(shape) => Some(shape),
            _ => None,
        }
    }

    /// Number of animated properties on this element.
    pub fn animated_property_count(&self) -> usize {
        self.animations().map_or(0, |a| a.len())
    }
}
