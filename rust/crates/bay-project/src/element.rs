//! Timeline elements. One `Element` enum over the five concrete kinds, each sharing the
//! common `id / name / start / duration` fields plus its own payload.

use std::collections::BTreeMap;

use bay_time::MediaTime;
use serde::{Deserialize, Serialize};

/// Who put an element on the timeline.
///
/// **Not a tool argument.** Nothing on the MCP surface accepts it: `narrate`, `subtitles_add`
/// and `subtitles_to_video` stamp [`ElementSource::Tool`] on what they generate, and everything
/// else is [`ElementSource::Author`] because an author asked for it. An id of the shape
/// `caption-<n>` is refused from a caller for the same reason — provenance an author can set is
/// provenance an author can launder.
///
/// It exists because every distribution measured over "the elements" was measuring bay's own
/// caption output as though an author had chosen it. In the project that prompted this, 38 of
/// 73 text elements are `narrate`'s captions; they carry one font size, one y, and one 3-frame
/// opacity fade each, and they moved four separate motion measurements far enough to invert
/// their ranking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ElementSource {
    /// A human or agent asked for this element.
    #[default]
    Author,
    /// bay generated it — a caption from `narrate` or a subtitle file.
    Tool,
}

impl ElementSource {
    /// The wire name, as it appears in the project file.
    pub fn as_str(self) -> &'static str {
        match self {
            ElementSource::Author => "author",
            ElementSource::Tool => "tool",
        }
    }
}

/// What a visual element is *for* — the job it does in the frame, not how it looks.
///
/// Required on `add_text` and `add_shape`, because "what is this for" is the question whose
/// absence let 46 shapes be added with no answer to it. Roles are also what makes a rule like
/// "exactly one hook" or "background furniture is at most 15 % of the elements" expressible at
/// all: without them every element is interchangeable and the only available rules are counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ElementRole {
    /// The first thing on screen, whose only job is to earn the next two seconds.
    Hook,
    /// The line a beat is built around.
    Headline,
    /// The small line above or below a headline that frames it.
    Kicker,
    /// Names a thing: an axis, a value, a source note. The default, because it is the least
    /// load-bearing claim a role can make — it neither grants the background exemption nor
    /// claims a singular job the project may already have filled.
    #[default]
    Label,
    /// Spoken words on screen. `narrate` and the subtitle tools set this; an author should not
    /// need to.
    Caption,
    /// An end card, a logo, a sign-off — the thing the video resolves onto.
    Lockup,
    /// A bar, a line, a plotted mark: an element whose position or size *is* the information.
    Data,
    /// Background: fills, plates, wallpaper. Capped, with [`ElementRole::Chrome`], at a share of
    /// the project — otherwise "it is only background" becomes the exemption everything claims.
    Ground,
    /// Frame furniture: rules, borders, progress bars, corner marks.
    Chrome,
}

impl ElementRole {
    /// Every role, in the order the schema lists them.
    pub const ALL: [ElementRole; 9] = [
        ElementRole::Hook,
        ElementRole::Headline,
        ElementRole::Kicker,
        ElementRole::Label,
        ElementRole::Caption,
        ElementRole::Lockup,
        ElementRole::Data,
        ElementRole::Ground,
        ElementRole::Chrome,
    ];

    /// The wire names, in the same order — what a tool schema advertises and an error lists.
    pub const NAMES: [&'static str; 9] = [
        "hook", "headline", "kicker", "label", "caption", "lockup", "data", "ground", "chrome",
    ];

    pub fn as_str(self) -> &'static str {
        Self::NAMES[Self::ALL.iter().position(|r| *r == self).unwrap_or(3)]
    }

    /// Parse a wire name. `None` is an unknown role, which callers report rather than guess.
    pub fn from_wire(name: &str) -> Option<Self> {
        Self::NAMES
            .iter()
            .position(|n| *n == name)
            .map(|index| Self::ALL[index])
    }

    /// Whether this is background furniture rather than content. The 15 % cap counts these.
    pub fn is_background(self) -> bool {
        matches!(self, ElementRole::Ground | ElementRole::Chrome)
    }
}

/// What a sound is doing in the mix.
///
/// The distinction a duck is defined against: without it, "is the bed under the voice" cannot
/// be asked of a project at all, and the mix that prompted this ran its duck backwards for 61
/// seconds without anything being able to notice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioRole {
    /// Narration or dialogue — the thing everything else makes room for. Set by `narrate`.
    Speech,
    /// Music under the picture. The default: a plain `add_audio` is a bed far more often than
    /// it is anything else, and treating an unlabelled clip as a bed is what makes a missing
    /// duck visible rather than excused.
    #[default]
    Bed,
    /// A sound effect — a whoosh, an impact, a click. Set by `sfx_add` and `sound_add`.
    Sfx,
}

impl AudioRole {
    pub const ALL: [AudioRole; 3] = [AudioRole::Speech, AudioRole::Bed, AudioRole::Sfx];
    pub const NAMES: [&'static str; 3] = ["speech", "bed", "sfx"];

    pub fn as_str(self) -> &'static str {
        Self::NAMES[Self::ALL.iter().position(|r| *r == self).unwrap_or(1)]
    }

    pub fn from_wire(name: &str) -> Option<Self> {
        Self::NAMES
            .iter()
            .position(|n| *n == name)
            .map(|index| Self::ALL[index])
    }
}

/// Whether `id` is one bay's own caption placement mints: `caption-` and a number.
///
/// One definition, consulted from three places — the caption writer, the id the MCP surface
/// refuses from a caller, and the provenance inferred when an old project is opened. Three
/// copies of this rule is how one of them comes to disagree about what a caption is.
pub fn is_caption_id(id: &str) -> bool {
    match id.strip_prefix("caption-") {
        Some(rest) => !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// A GPU effect applied to a visual element (e.g. `brightness`), with named scalar params.
/// `BTreeMap` keeps params in a deterministic order for stable serialization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    pub effect_type: String,
    pub enabled: bool,
    pub params: BTreeMap<String, f32>,
    /// A file the effect reads, for the ones that need more than scalars — today the `.cube`
    /// a `lut` grades through.
    ///
    /// A path rather than an imported media id: a LUT is not something that appears on the
    /// timeline, and putting it in the media library would list a grade next to the footage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>,
}

/// How a built-in grade is named in [`Effect::asset`], as opposed to a path on disk.
///
/// Built-in looks are generated on the machine — there is no `.cube` anywhere for them, and
/// deliberately so, since a project naming one keeps working on a machine that has never
/// downloaded anything. That makes `asset` two namespaces in one field, and anything reading
/// it has to know which it is holding: `check` did not, tested every asset with
/// `Path::exists`, and so reported every built-in look as a missing file. Since a render is
/// refused while an error stands, the documented way to grade a clip blocked the export.
pub const LOOK_PREFIX: &str = "look:";

/// Every built-in look, by id.
///
/// Here rather than in `bay-effects` because `bay-core` has to validate a look id and cannot
/// take a dependency on wgpu to do it. `bay-effects` owns what a look *is*; this owns what
/// they are *called*, and a test in `bay-effects` pins the two lists equal in both directions,
/// so a look added there and not here would be rejected by the very check that is meant to
/// catch a typo.
pub const BUILTIN_LOOKS: &[&str] = &[
    "neutral-contrast",
    "teal-orange",
    "bleach-bypass",
    "warm-film",
    "cool-night",
    "mono",
];

/// The look id an `asset` names, if it names one at all.
pub fn look_id(asset: &str) -> Option<&str> {
    asset.strip_prefix(LOOK_PREFIX)
}

/// Whether `id` is a look this build can generate.
pub fn is_builtin_look(id: &str) -> bool {
    BUILTIN_LOOKS.contains(&id)
}

/// A shape that limits where a clip shows.
///
/// The feathering pipeline behind this (a jump-flood signed distance field) has been written
/// and tested in `bay-masks` since before there was a way to ask for one — every layer passed
/// `mask: None`, because no element could carry a mask to pass. This is the field that turns
/// it on: vignettes, split screens, spotlighting one part of a frame, and reveals.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mask {
    #[serde(default)]
    pub shape: MaskShape,
    /// Centre of the mask, as a fraction of the canvas.
    pub x: f32,
    pub y: f32,
    /// Size of the mask, as a fraction of the canvas.
    pub width: f32,
    pub height: f32,
    /// Softness of the edge, in pixels of the rendered frame. Zero is a hard edge.
    #[serde(default)]
    pub feather: f32,
    /// Show everything *outside* the shape instead of inside it.
    #[serde(default)]
    pub inverted: bool,
}

impl Default for Mask {
    fn default() -> Self {
        Self {
            shape: MaskShape::Ellipse,
            x: 0.5,
            y: 0.5,
            width: 0.6,
            height: 0.6,
            feather: 0.0,
            inverted: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MaskShape {
    #[default]
    Ellipse,
    Rect,
}

/// A single animation keyframe: a scalar `value` at a `time` relative to the element's start.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: MediaTime,
    pub value: f32,
    /// The curve travelled on the way *out* of this key, overriding the channel's own.
    ///
    /// One easing for a whole channel cannot describe the shape most motion actually has:
    /// "arrive fast, hold, leave slow" is three segments with three different curves, and a
    /// channel-wide easing forces an author to fake it with dense keys — which samples back
    /// out as a straight line, so the fake does not even work.
    ///
    /// `None` means "use the channel's easing", which is what every project written before
    /// this field existed says, and why it deserializes and renders identically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub easing: Option<Easing>,
    /// A hand-drawn curve for the segment leaving this key, overriding [`Self::easing`].
    ///
    /// The named easings are a vocabulary of good defaults, and a curve editor exists because
    /// a vocabulary is not the whole language. Handles win over the key's easing, which wins
    /// over the channel's — the more specific statement of intent wins, at every level.
    ///
    /// `None` on every key in every project written before handles existed, which is why they
    /// still sample through their named easing and render identically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handles: Option<BezierHandles>,
    /// Identity that survives being moved.
    ///
    /// A drag changes a key's time, so time cannot be its identity — the selection would jump
    /// to a different key halfway through, or to none. `KeyframeRef::keyframe_id` in
    /// `bay-core` has always wanted this and had nothing to point at.
    ///
    /// Zero means "never assigned", which is what every key written before this field says.
    /// [`Self::identity`] falls back to the key's time there, so a legacy project is
    /// addressable without a migration pass — it just cannot survive a move until something
    /// rewrites it, and every mutator here assigns one on the way through.
    #[serde(default, skip_serializing_if = "is_zero_id")]
    pub id: u32,
}

fn is_zero_id(id: &u32) -> bool {
    *id == 0
}

/// Cubic-bezier control points for the segment *leaving* a key, in normalized segment space —
/// the same four numbers CSS `cubic-bezier(x1, y1, x2, y2)` takes.
///
/// Normalized rather than in seconds and values, so a curve keeps its shape when the segment
/// is stretched: dragging the second key later should slow the motion down, not re-shape it.
/// The x pair is clamped into 0..=1 on evaluation because a control point outside it makes the
/// curve non-monotonic in time, which is a curve that runs backwards. The y pair is
/// deliberately unclamped — overshoot past the destination and undershoot below the origin are
/// both things an author draws on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BezierHandles {
    pub out_x: f32,
    pub out_y: f32,
    pub in_x: f32,
    pub in_y: f32,
}

impl Default for BezierHandles {
    /// The straight line — the curve a key has before anyone drags a handle.
    fn default() -> Self {
        Self {
            out_x: 1.0 / 3.0,
            out_y: 1.0 / 3.0,
            in_x: 2.0 / 3.0,
            in_y: 2.0 / 3.0,
        }
    }
}

impl BezierHandles {
    /// Remap normalized progress `x` through the curve, matching [`Easing::apply`]'s contract
    /// so a segment can take either without the sampler caring which.
    ///
    /// The curve is parametric — x and y are both functions of an unknown t — so evaluating it
    /// at a given x means solving for t first. Newton-Raphson converges in a few steps for the
    /// shapes a person draws; the bisection fallback is for the ones they draw at the extremes,
    /// where the derivative goes flat and Newton walks off the segment.
    pub fn apply(self, x: f32) -> f32 {
        let x = x.clamp(0.0, 1.0);
        // Exactly the endpoints, without spending iterations to rediscover them.
        if x <= 0.0 {
            return 0.0;
        }
        if x >= 1.0 {
            return 1.0;
        }
        let x1 = self.out_x.clamp(0.0, 1.0);
        let x2 = self.in_x.clamp(0.0, 1.0);
        let t = Self::solve_t(x, x1, x2);
        Self::bezier(t, self.out_y, self.in_y)
    }

    /// One coordinate of the curve at parameter `t`, with P0 = 0 and P3 = 1.
    fn bezier(t: f32, p1: f32, p2: f32) -> f32 {
        let u = 1.0 - t;
        3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t
    }

    /// d/dt of [`Self::bezier`].
    fn slope(t: f32, p1: f32, p2: f32) -> f32 {
        let u = 1.0 - t;
        3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
    }

    fn solve_t(x: f32, x1: f32, x2: f32) -> f32 {
        const EPSILON: f32 = 1e-6;
        let mut t = x;
        for _ in 0..8 {
            let error = Self::bezier(t, x1, x2) - x;
            if error.abs() < EPSILON {
                return t;
            }
            let slope = Self::slope(t, x1, x2);
            // A flat derivative means Newton's next step is a division by nearly zero, which
            // lands anywhere. Hand the rest to bisection rather than to chance.
            if slope.abs() < EPSILON {
                break;
            }
            t -= error / slope;
        }
        let (mut low, mut high) = (0.0_f32, 1.0_f32);
        let mut t = x;
        for _ in 0..32 {
            let value = Self::bezier(t, x1, x2);
            if (value - x).abs() < EPSILON {
                break;
            }
            if value > x {
                high = t;
            } else {
                low = t;
            }
            t = (low + high) / 2.0;
        }
        t
    }
}

impl Keyframe {
    /// A key that travels on its channel's easing.
    pub fn new(time: MediaTime, value: f32) -> Self {
        Self {
            time,
            value,
            easing: None,
            handles: None,
            id: 0,
        }
    }

    /// A key that overrides its channel's easing for the segment leaving it.
    pub fn eased(time: MediaTime, value: f32, easing: Easing) -> Self {
        Self {
            time,
            value,
            easing: Some(easing),
            handles: None,
            id: 0,
        }
    }

    /// A key whose leaving segment is a hand-drawn curve.
    pub fn curved(time: MediaTime, value: f32, handles: BezierHandles) -> Self {
        Self {
            time,
            value,
            easing: None,
            handles: Some(handles),
            id: 0,
        }
    }

    /// How to address this key. Its assigned id, or — for a key from before ids existed — its
    /// time, which is unique within a channel by construction.
    pub fn identity(&self) -> String {
        match self.id {
            0 => format!("t{}", self.time.as_ticks()),
            id => format!("k{id}"),
        }
    }

    /// The progress remap for the segment leaving this key, given the channel's own easing.
    ///
    /// The one place the precedence lives: hand-drawn handles beat this key's named easing,
    /// which beats the channel's. Three call sites read it — the sampler, the polyline
    /// densifier, and the audio gain expression — and when each decided for itself, the
    /// exported audio took a straight line through a curve the preview drew.
    pub fn progress(&self, channel: Easing, fraction: f32) -> f32 {
        match self.handles {
            Some(handles) => handles.apply(fraction),
            None => self.easing.unwrap_or(channel).apply(fraction),
        }
    }

    /// Whether the segment leaving this key is a straight line, and so needs no subdivision
    /// to be described faithfully by its two endpoints.
    pub fn segment_is_straight(&self, channel: Easing) -> bool {
        self.handles.is_none() && self.easing.unwrap_or(channel) == Easing::Linear
    }
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
    /// `power3.in` — the mirror of `PowerOut`. The exit half of a velocity-matched cut.
    PowerIn,
    /// `expo.out` — near-instant arrival, long tail. Snappy reveals.
    ExpoOut,
    /// `expo.in` — creeps, then leaves all at once.
    ExpoIn,
    /// `power4.out` — the entry half of the mirrored pair a seam is cut on.
    ///
    /// `power4.in`/`power4.out` at the same distance and duration are the two halves of one
    /// `power4.inOut`, so an element entering on the `out` half picks up at exactly the speed
    /// the outgoing one left at. That equality is the whole mechanism of a cut that reads as
    /// one continuous move rather than as two animations either side of a slideshow cut.
    Power4Out,
    /// `power4.in` — the exit half of that pair.
    Power4In,
    /// A critically damped spring (ζ = 1): fast approach, long settle, and — unlike
    /// [`Easing::BackOut`] — **no overshoot at all**.
    ///
    /// This is the curve the house style actually wants for an entrance. Overshoot reads as
    /// emphasis to whoever authored it and as cheap to everyone watching, which is why it is
    /// the most-cited turn-off in agent-made motion; a damped settle buys the same sense of
    /// physicality without spending cleanliness on it.
    SpringOut,
    /// `sine.inOut` — gentle at both ends. For slow, atmospheric moves that should not
    /// announce themselves.
    SineInOut,
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
            Easing::PowerIn => t * t * t,
            Easing::ExpoOut => {
                if t >= 1.0 {
                    1.0
                } else {
                    1.0 - (-10.0 * t).exp2()
                }
            }
            Easing::ExpoIn => {
                if t <= 0.0 {
                    0.0
                } else {
                    (10.0 * t - 10.0).exp2()
                }
            }
            Easing::Power4Out => 1.0 - (1.0 - t).powi(4),
            Easing::Power4In => t.powi(4),
            Easing::SpringOut => {
                // 1 - (1 + wt)e^(-wt) is the step response of a critically damped system.
                // It approaches 1 without ever passing it, but only reaches it at infinity —
                // so it is divided by its own value at t=1, which lands the key exactly on
                // its value at the end of the segment. Without that an element would settle
                // 0.3% short of where the author put it, on every spring in the project.
                const W: f32 = 8.0;
                let response = |x: f32| 1.0 - (1.0 + W * x) * (-W * x).exp();
                response(t) / response(1.0)
            }
            Easing::SineInOut => 0.5 * (1.0 - (std::f32::consts::PI * t).cos()),
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
    /// Kept sorted by time, ascending, with one key per time.
    ///
    /// [`Self::sample`] walks `keys.windows(2)` and every consumer assumes the order, but the
    /// field is public and serde neither sorts nor checks — so a hand-edited project file, or
    /// a command that rebuilt a channel out of order, produced a channel that samples wrong
    /// rather than one that fails to load. The invariant is now enforced where unordered keys
    /// actually enter: [`Self::keys_in_time_order`] on the way in from serde, and
    /// [`Self::sort_keys`] for anything that mutates the vector directly.
    #[serde(deserialize_with = "AnimationChannel::keys_in_time_order")]
    pub keys: Vec<Keyframe>,
    #[serde(default)]
    pub easing: Easing,
}

impl AnimationChannel {
    /// Steps an eased segment is cut into when it has to be described as a polyline.
    ///
    /// Straight segments need none. A curve needs enough that the ramp reads as a curve
    /// rather than as a staircase — and sixteen is what the audio gain expression has used
    /// since it was the only densifier in the codebase.
    const EASED_STEPS: i64 = 16;

    /// Sort keys ascending by time and drop any duplicate time.
    ///
    /// Stable, so the first key at a given time wins — which is what the sampler already did
    /// with a duplicate, since a zero-length segment interpolates to its own start.
    pub fn sort_keys(&mut self) {
        self.keys.sort_by_key(|key| key.time.as_ticks());
        self.keys.dedup_by_key(|key| key.time.as_ticks());
    }

    /// serde entry point for [`Self::keys`]. See the field's note.
    fn keys_in_time_order<'de, D>(deserializer: D) -> Result<Vec<Keyframe>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let mut keys = Vec::<Keyframe>::deserialize(deserializer)?;
        keys.sort_by_key(|key| key.time.as_ticks());
        keys.dedup_by_key(|key| key.time.as_ticks());
        Ok(keys)
    }

    /// An id no key in this channel is using.
    ///
    /// Ids are per channel, not global: a channel is the scope a `KeyframeRef` already
    /// narrows to before it needs one, and a project-wide counter would have to be threaded
    /// through every constructor to keep.
    pub fn mint_key_id(&self) -> u32 {
        self.keys.iter().map(|key| key.id).max().unwrap_or(0) + 1
    }

    /// Give every key an id, leaving the ones that already have one alone.
    ///
    /// For a channel loaded from a project written before ids existed, at the moment
    /// something needs to address its keys across an edit.
    pub fn assign_missing_ids(&mut self) {
        let mut next = self.mint_key_id();
        for key in &mut self.keys {
            if key.id == 0 {
                key.id = next;
                next += 1;
            }
        }
    }

    /// The index of the key `id` addresses, by [`Keyframe::identity`].
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.keys.iter().position(|key| key.identity() == id)
    }

    /// The key `id` addresses.
    pub fn key(&self, id: &str) -> Option<&Keyframe> {
        self.index_of(id).map(|index| &self.keys[index])
    }

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
                // The key's own curve wins over the channel's, so one channel can arrive
                // fast, hold, and leave slowly — which is what most real motion does.
                let eased = a.progress(self.easing, fraction);
                return Some(a.value + (b.value - a.value) * eased);
            }
        }
        Some(last.value)
    }

    /// Insert or replace the keyframe at `time`, keeping keys sorted. The key travels on the
    /// channel's easing.
    pub fn upsert(&mut self, time: MediaTime, value: f32) {
        self.upsert_key(Keyframe::new(time, value));
    }

    /// Insert or replace the keyframe at `time`, giving the segment that leaves it its own
    /// curve.
    pub fn upsert_eased(&mut self, time: MediaTime, value: f32, easing: Easing) {
        self.upsert_key(Keyframe::eased(time, value, easing));
    }

    /// Insert or replace `key`, keeping keys sorted by time.
    ///
    /// Replacing carries the incoming key's easing across as well as its value: a caller
    /// re-writing a key with a new curve means the new curve, and one re-writing it through
    /// [`Self::upsert`] means "no override", which is the value it is asking for.
    pub fn upsert_key(&mut self, mut key: Keyframe) {
        if key.id == 0 {
            key.id = self.mint_key_id();
        }
        match self.keys.iter().position(|k| k.time == key.time) {
            // The key that was there keeps its id: something may already be pointing at it,
            // and "the key at 0.5s took a new value" is not "a different key arrived".
            Some(index) => {
                key.id = self.keys[index].id;
                self.keys[index] = key;
            }
            None => {
                let position = self
                    .keys
                    .iter()
                    .position(|k| k.time.as_ticks() > key.time.as_ticks())
                    .unwrap_or(self.keys.len());
                self.keys.insert(position, key);
            }
        }
    }

    /// Move the key `id` addresses to `time`, keeping its value, curve and identity.
    ///
    /// Returns whether anything moved. A move onto another key's time *replaces* that key, the
    /// same as dragging one key onto another in any curve editor — two keys at one time is not
    /// a state the sampler has an answer for.
    ///
    /// This exists because moving a key was remove-plus-add: two commands, so two undo entries
    /// for one drag, and the key lost its identity in between.
    pub fn move_key(&mut self, id: &str, time: MediaTime) -> bool {
        let Some(index) = self.index_of(id) else {
            return false;
        };
        if self.keys[index].time == time {
            return false;
        }
        let mut moved = self.keys.remove(index);
        moved.time = time;
        // Not `upsert_key`: that would adopt the id of whatever key it lands on, and this key
        // is the one being dragged — it keeps its own name and the one underneath is the one
        // that goes.
        self.keys.retain(|key| key.time != time);
        let position = self
            .keys
            .iter()
            .position(|key| key.time.as_ticks() > time.as_ticks())
            .unwrap_or(self.keys.len());
        self.keys.insert(position, moved);
        true
    }

    /// The channel as a polyline over `range`: `(time, value)` in ascending order.
    ///
    /// The one densifier. A curve editor drawing a channel, a scope plotting one, and the
    /// export's audio gain expression all need the same thing — a curve turned into segments
    /// short enough that drawing them straight is honest — and the audio path was the only one
    /// that had it, buried in `gain_points`.
    ///
    /// Every key inside the range is a point, both range ends are points, and each non-straight
    /// segment is subdivided. A straight segment is not, because two endpoints describe it
    /// exactly and interpolating between them adds nothing but points.
    ///
    /// Empty for a channel with no keys: there is no curve to draw, which is different from a
    /// flat one at zero.
    pub fn polyline(&self, range: std::ops::RangeInclusive<MediaTime>) -> Vec<(MediaTime, f32)> {
        if self.keys.is_empty() {
            return Vec::new();
        }
        let (from, to) = (range.start().as_ticks(), range.end().as_ticks());
        if to < from {
            return Vec::new();
        }

        let mut ticks = vec![from, to];
        for key in &self.keys {
            ticks.push(key.time.as_ticks());
        }
        // Per segment, not per channel: a key carrying its own curve has to be subdivided even
        // when the channel it sits on is linear, or that segment is reported as the straight
        // line the author specifically asked it not to be.
        for pair in self.keys.windows(2) {
            if pair[0].segment_is_straight(self.easing) {
                continue;
            }
            let (a, b) = (pair[0].time.as_ticks(), pair[1].time.as_ticks());
            for step in 1..Self::EASED_STEPS {
                ticks.push(a + (b - a) * step / Self::EASED_STEPS);
            }
        }

        ticks.retain(|tick| *tick >= from && *tick <= to);
        ticks.sort_unstable();
        ticks.dedup();
        ticks
            .into_iter()
            .filter_map(|tick| {
                let time = MediaTime::from_ticks(tick);
                Some((time, self.sample(time)?))
            })
            .collect()
    }
}

/// How a layer composites against everything beneath it. Mirrors the compositor's WGSL blend
/// set (and the web app's wire format) but stays GPU-free so the data model has no render
/// dependency; `bay-preview` maps these onto `bay_compositor::BlendMode`.
/// Wire format is **kebab-case** to match `bay_compositor::BlendMode` and the web app's
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

/// Whether a pan sits dead centre, which is what every clip written before pan existed was.
///
/// Used by `skip_serializing_if` so a centred clip writes exactly the JSON it always wrote —
/// the project file is the web↔native contract, and adding `"pan":0.0` to every audio clip in
/// every project would be a wire change for a value that means "unchanged".
fn is_centred(pan: &f32) -> bool {
    *pan == 0.0
}

/// Multiply every point of a level polyline by a lane's fader.
///
/// The one place a track gain meets the `(seconds, gain)` description both mixers read. Both
/// the preview's block mixer and the export's `volume` expression end up applying this product;
/// scaling here rather than at each of them is what stops the two from rounding it differently.
///
/// A non-finite scale is unity — a `NaN` fader must not be able to delete a lane from a render.
pub fn scale_gain_points(points: &[(f64, f32)], scale: f32) -> Vec<(f64, f32)> {
    let scale = if scale.is_finite() {
        scale.max(0.0)
    } else {
        1.0
    };
    if scale == 1.0 {
        return points.to_vec();
    }
    points
        .iter()
        .map(|(time, gain)| (*time, gain * scale))
        .collect()
}

/// A text outline drawn outside the glyph coverage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStroke {
    /// Outline width in rendered pixels.
    pub width: f32,
    pub color: String,
}

/// A blurred, offset copy of a text element's glyph coverage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextShadow {
    pub offset_x: f32,
    pub offset_y: f32,
    pub blur: f32,
    pub color: String,
}

/// A rounded rectangle behind a text element.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPlate {
    pub color: String,
    pub padding_x: f32,
    pub padding_y: f32,
    pub radius: f32,
}

/// Optional legibility treatments applied while text is rasterized.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDecorations {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<TextStroke>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<TextShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plate: Option<TextPlate>,
}

/// One word's interval relative to its text element's start.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeWord {
    pub text: String,
    pub start: MediaTime,
    pub end: MediaTime,
}

/// Word-level caption highlighting without splitting one cue into many timeline elements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeSpec {
    #[serde(default)]
    pub words: Vec<KaraokeWord>,
    pub highlight_color: String,
}

impl KaraokeSpec {
    /// The word whose half-open interval contains `local_time`.
    pub fn active_word(&self, local_time: MediaTime) -> Option<usize> {
        self.words
            .iter()
            .position(|word| local_time >= word.start && local_time < word.end)
    }
}

/// Reveal a line one character at a time, the way a terminal does.
///
/// **Why this is a property of the text and not a mask animation.** A wipe over a finished
/// raster reveals *half a glyph* at the wipe edge, which reads as a rectangle sliding over
/// words; typing reveals whole characters, and the difference is the whole effect. It also has
/// to re-shape as it goes, because a line that will wrap does not know where it wraps until it
/// gets there — revealing a pre-wrapped raster puts the break in the wrong place for every
/// frame before the last.
///
/// The cost is real and worth stating: each distinct prefix is a separate raster, so a 60
/// character line at 24 cps is 60 cache entries over two and a half seconds. That is fine for
/// the one or two lines in a shot that are *about* being typed, and it is the reason this is
/// not something to put on body copy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeOn {
    /// Characters per second. Around 24 reads as a fast confident typist; much past 40 and the
    /// eye stops resolving individual characters and it becomes a wipe with extra steps.
    pub chars_per_second: f32,
    /// Draw a block caret at the leading edge while the line is still arriving.
    #[serde(default)]
    pub caret: bool,
}

/// The caret glyph. A full block rather than an underscore or a bar: at the sizes type appears
/// at in a film it is the only one of the three that is still visible.
pub const CARET: char = '▌';

impl TypeOn {
    /// How long `content` takes to arrive in full.
    pub fn duration_seconds(&self, content: &str) -> f64 {
        let rate = self.chars_per_second.max(0.1) as f64;
        content.chars().count() as f64 / rate
    }

    /// What is on screen at `local` seconds into the element.
    ///
    /// Counted in `char`s rather than bytes, so a line containing an em dash or an accent does
    /// not reveal half a code point and render a replacement box.
    pub fn revealed(&self, content: &str, local_seconds: f64) -> String {
        let rate = self.chars_per_second.max(0.1) as f64;
        let total = content.chars().count();
        let shown = (local_seconds.max(0.0) * rate).floor() as usize;
        if shown >= total {
            return content.to_string();
        }
        let mut out: String = content.chars().take(shown).collect();
        if self.caret {
            out.push(CARET);
        }
        out
    }
}

/// Hold one source frame while timeline time continues to advance.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreezeFrame {
    /// Position relative to the element's start where the held frame begins.
    pub at: MediaTime,
    pub duration: MediaTime,
}

/// Per-clip controls retained with synthesized speech so providers can map them natively.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechProsody {
    #[serde(default = "one")]
    pub rate: f32,
    #[serde(default)]
    pub pitch_semitones: f32,
    #[serde(default = "one")]
    pub energy: f32,
}

impl Default for SpeechProsody {
    fn default() -> Self {
        Self {
            rate: 1.0,
            pitch_semitones: 0.0,
            energy: 1.0,
        }
    }
}

/// Dialogue-oriented equalizer controls.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueEq {
    #[serde(default = "default_high_pass")]
    pub high_pass_hz: f32,
    #[serde(default)]
    pub presence_db: f32,
}

fn default_high_pass() -> f32 {
    80.0
}

impl Default for DialogueEq {
    fn default() -> Self {
        Self {
            high_pass_hz: default_high_pass(),
            presence_db: 0.0,
        }
    }
}

/// Dynamics control for dialogue clips.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueCompressor {
    pub threshold_db: f32,
    pub ratio: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
    #[serde(default)]
    pub makeup_db: f32,
}

impl Default for DialogueCompressor {
    fn default() -> Self {
        Self {
            threshold_db: -18.0,
            ratio: 3.0,
            attack_ms: 10.0,
            release_ms: 120.0,
            makeup_db: 0.0,
        }
    }
}

/// True-peak ceiling for dialogue.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueLimiter {
    pub ceiling_db: f32,
}

impl Default for DialogueLimiter {
    fn default() -> Self {
        Self { ceiling_db: -1.0 }
    }
}

/// Ordered dialogue post chain: EQ, compressor, then limiter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueAudioChain {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eq: Option<DialogueEq>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compressor: Option<DialogueCompressor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limiter: Option<DialogueLimiter>,
}

impl Default for DialogueAudioChain {
    fn default() -> Self {
        Self {
            eq: Some(DialogueEq::default()),
            compressor: Some(DialogueCompressor::default()),
            limiter: Some(DialogueLimiter::default()),
        }
    }
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
    /// How much of the source to cut away on each side, as a fraction of its own size.
    ///
    /// This is the difference between fitting a shot into a frame and *reframing* it: turning
    /// a 16:9 take into a 9:16 reel means choosing which part of the picture survives, and
    /// `scale_x`/`scale_y` cannot do it — they squash. All zero is the whole source, which is
    /// what every project written before this had.
    #[serde(default)]
    pub crop_left: f32,
    #[serde(default)]
    pub crop_top: f32,
    #[serde(default)]
    pub crop_right: f32,
    #[serde(default)]
    pub crop_bottom: f32,
    /// Tilt about the element's own horizontal axis, in degrees: the card leans out of the
    /// screen rather than spinning in it.
    ///
    /// `rotation` already existed and is not this. Rotation keeps every edge the same length —
    /// it is a 2D spin. A tilt foreshortens: the edge that leans away gets shorter and the one
    /// leaning towards the eye gets longer, which is the only way a flat composition acquires a
    /// front and a back. Held here rather than as an effect because it is geometry, so it
    /// composes with position and scale instead of being applied to the finished picture.
    ///
    /// Zero is flat, which is what every project written before tilt existed deserializes to.
    #[serde(default)]
    pub tilt_x: f32,
    /// Tilt about the element's own vertical axis, in degrees. See [`Transform::tilt_x`].
    #[serde(default)]
    pub tilt_y: f32,
}

impl Transform {
    /// The kept region of the source as `(offset_x, offset_y, width, height)` in 0..1 — what a
    /// sampler needs. Degenerate crops (insets meeting or crossing) collapse to the whole
    /// source rather than to nothing: a clip that vanished because two numbers summed past 1
    /// would look like a bug in the renderer.
    pub fn crop_rect(&self) -> (f32, f32, f32, f32) {
        let sane = |value: f32| {
            if value.is_finite() {
                value.clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        let (left, top) = (sane(self.crop_left), sane(self.crop_top));
        let (right, bottom) = (sane(self.crop_right), sane(self.crop_bottom));
        let width = 1.0 - left - right;
        let height = 1.0 - top - bottom;
        if width <= 0.0 || height <= 0.0 {
            return (0.0, 0.0, 1.0, 1.0);
        }
        (left, top, width, height)
    }

    /// Whether anything is actually cut away.
    pub fn is_cropped(&self) -> bool {
        self.crop_rect() != (0.0, 0.0, 1.0, 1.0)
    }
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
            crop_left: 0.0,
            crop_top: 0.0,
            crop_right: 0.0,
            crop_bottom: 0.0,
            tilt_x: 0.0,
            tilt_y: 0.0,
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
    /// Fade up from nothing over this long at the head, and down to nothing over this long at
    /// the tail. Zero means a hard cut, which is the default and what every project written
    /// before this existed had.
    ///
    /// One field serves two jobs on purpose: on a visual element the fade multiplies opacity,
    /// on an audio clip it multiplies gain. A cross-dissolve is then not a separate kind of
    /// object at all — it is the upper clip fading in while the lower one plays on underneath,
    /// which is also why it does not dip through the background the way two complementary
    /// fades would.
    #[serde(default)]
    pub fade_in: MediaTime,
    #[serde(default)]
    pub fade_out: MediaTime,
    pub media_id: String,
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
    /// Constant source-time multiplier. `2.0` plays twice as fast.
    #[serde(default = "one")]
    pub speed: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freeze: Option<FreezeFrame>,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
    #[serde(default)]
    pub blend_mode: BlendMode,
    /// A shape limiting where this clip shows. `None` is the whole frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    /// Who put this on the timeline. `#[serde(default)]` reads every project written before
    /// provenance existed as the author's own work, which is what it was.
    #[serde(default)]
    pub source: ElementSource,
    /// What this element is for. See [`ElementRole`].
    #[serde(default)]
    pub role: ElementRole,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    #[serde(default)]
    pub fade_in: MediaTime,
    #[serde(default)]
    pub fade_out: MediaTime,
    pub media_id: String,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
    #[serde(default)]
    pub blend_mode: BlendMode,
    /// A shape limiting where this clip shows. `None` is the whole frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    #[serde(default)]
    pub source: ElementSource,
    #[serde(default)]
    pub role: ElementRole,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    #[serde(default)]
    pub fade_in: MediaTime,
    #[serde(default)]
    pub fade_out: MediaTime,
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
    /// A shape limiting where this clip shows. `None` is the whole frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decorations: Option<TextDecorations>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub karaoke: Option<KaraokeSpec>,
    /// Reveal the line character by character from the element's start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_on: Option<TypeOn>,
    #[serde(default)]
    pub source: ElementSource,
    #[serde(default)]
    pub role: ElementRole,
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

/// A two-stop linear gradient fill.
///
/// Stored as resolved colours, the same way `color` is, because the element is what the
/// renderer reads and the kit is what the *tool* consults — an element carrying a tone name
/// would make every renderer a kit resolver.
///
/// Two stops and a linear ramp, deliberately. The genre that wants gradients wants a ground
/// that is not flat and an orb that is not a disc; it does not want a gradient editor, and a
/// stop list is the first step towards one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gradient {
    /// `#rrggbb` at the start of the ramp.
    pub from: String,
    /// `#rrggbb` at the end of it.
    pub to: String,
    /// Direction of the ramp, in degrees clockwise from left-to-right.
    #[serde(default)]
    pub angle: f32,
}

/// An outline instead of a fill, optionally broken into dashes.
///
/// Both fall out of the signed distance field the rasteriser already builds: an outline is the
/// band where the distance to the boundary is small, and that is true for a rounded rect and an
/// ellipse alike without either being special-cased.
///
/// `dash` breaks the shape along its LONGER axis, which is what a connector is. A dash pattern
/// that walked the perimeter would be the general answer and is not the one anybody needs here;
/// the thing this exists for is the dashed line between two nodes in a diagram.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    /// `#rrggbb`. Resolved by the tool from a tone, like every other colour on an element.
    pub color: String,
    /// Line width as a fraction of the shape's shorter side.
    pub width: f32,
    /// Dash length as a fraction of the shape's LONGER side. `None` draws a continuous line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<f32>,
    /// Gap length, same units as `dash`. Ignored when `dash` is `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap: Option<f32>,
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
    pub fade_in: MediaTime,
    #[serde(default)]
    pub fade_out: MediaTime,
    #[serde(default)]
    pub shape: ShapeKind,
    /// `#rrggbb` fill. Ignored when `gradient` is set.
    pub color: String,
    /// A gradient fill, which replaces `color` when present.
    ///
    /// Optional and `skip_serializing_if`, so every project written before gradients existed
    /// loads and renders exactly as it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<Gradient>,
    /// Draw the outline rather than the fill. `None` fills, which is what a shape did before
    /// this existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
    #[serde(default)]
    pub blend_mode: BlendMode,
    /// A shape limiting where this clip shows. `None` is the whole frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    #[serde(default)]
    pub source: ElementSource,
    #[serde(default)]
    pub role: ElementRole,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    #[serde(default)]
    pub fade_in: MediaTime,
    #[serde(default)]
    pub fade_out: MediaTime,
    pub media_id: String,
    pub muted: bool,
    pub volume: f32,
    /// Where this clip sits across the stereo field: `-1.0` hard left, `0.0` centre, `1.0`
    /// hard right.
    ///
    /// A **balance**, not a constant-power pan: the near channel is left alone and the far one
    /// is attenuated, so a centred clip is bit-for-bit what it was before pan existed. A
    /// constant-power law would put centre 3 dB down and hard-panned 3 dB up, which would have
    /// re-levelled every project ever saved. The law itself is `bay_audio::pan_gains`, which
    /// the preview block mixer and the export `pan=` filter both read — the model says where
    /// the clip sits, the DSP crate says what that means in gains, and there is one of it.
    #[serde(default, skip_serializing_if = "is_centred")]
    pub pan: f32,
    /// Constant source-time multiplier. `2.0` plays twice as fast.
    #[serde(default = "one")]
    pub speed: f32,
    /// Provider-neutral synthesis controls for clips created from text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prosody: Option<SpeechProsody>,
    /// Optional speech post chain, evaluated in EQ → compressor → limiter order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dialogue_chain: Option<DialogueAudioChain>,
    /// Keyframes on this clip's level, under the key `volume`. This is what makes ducking a
    /// music bed under narration a handful of keys rather than three clips and two gains.
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
    /// In-point into the source file: how much of the head to skip. Without it a music bed can
    /// only ever start at bar one, which makes "cut the picture to the drop" impossible.
    ///
    /// `#[serde(default)]` so projects written before this existed still load, as clips that
    /// play from their head — which is what they were.
    #[serde(default)]
    pub trim_start: MediaTime,
    #[serde(default)]
    pub source: ElementSource,
    /// What this sound is doing in the mix. See [`AudioRole`].
    #[serde(default)]
    pub role: AudioRole,
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

    /// Who put this element on the timeline.
    pub fn source(&self) -> ElementSource {
        with_inner!(self, e => e.source)
    }

    /// Whether an author asked for this element, as opposed to bay generating it.
    ///
    /// The predicate every distribution in `check` filters on: a measurement that counts bay's
    /// own captions as authored choices is measuring bay, not the author.
    pub fn is_authored(&self) -> bool {
        self.source() == ElementSource::Author
    }

    /// Stamp provenance. Only bay's own generators call this with [`ElementSource::Tool`] —
    /// there is deliberately no path to it from a tool argument.
    pub fn set_source(&mut self, source: ElementSource) {
        with_inner!(self, e => e.source = source);
    }

    /// What a visual element is for. `None` for audio, which has [`Self::audio_role`] instead —
    /// the two vocabularies do not overlap at all.
    pub fn role(&self) -> Option<ElementRole> {
        match self {
            Element::Video(e) => Some(e.role),
            Element::Image(e) => Some(e.role),
            Element::Text(e) => Some(e.role),
            Element::Shape(e) => Some(e.role),
            Element::Audio(_) => None,
        }
    }

    pub fn set_role(&mut self, role: ElementRole) {
        match self {
            Element::Video(e) => e.role = role,
            Element::Image(e) => e.role = role,
            Element::Text(e) => e.role = role,
            Element::Shape(e) => e.role = role,
            Element::Audio(_) => {}
        }
    }

    /// What a sound is doing in the mix. `None` for anything that is not audio.
    pub fn audio_role(&self) -> Option<AudioRole> {
        match self {
            Element::Audio(e) => Some(e.role),
            _ => None,
        }
    }

    pub fn set_audio_role(&mut self, role: AudioRole) {
        if let Element::Audio(e) = self {
            e.role = role;
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
        if let Element::Video(e) = self {
            e.trim_end = e.trim_start + video_source_duration(e);
        }
    }

    pub fn fade_in(&self) -> MediaTime {
        with_inner!(self, e => e.fade_in)
    }

    pub fn fade_out(&self) -> MediaTime {
        with_inner!(self, e => e.fade_out)
    }

    pub fn set_fades(&mut self, fade_in: MediaTime, fade_out: MediaTime) {
        let (fade_in, fade_out) = (fade_in.max(MediaTime::ZERO), fade_out.max(MediaTime::ZERO));
        with_inner!(self, e => {
            e.fade_in = fade_in;
            e.fade_out = fade_out;
        });
    }

    /// How much of this element is showing at `local` (time since its own start), from its
    /// fades alone: `0.0` at the very edge of a fade, `1.0` once it has finished.
    ///
    /// Linear, on purpose. A picture fade is read as a change in exposure and an audio fade as
    /// a change in level, and both are judged against a linear ramp — the eased curves that
    /// suit a move across the screen make a fade look like it stalls.
    ///
    /// Fades longer than the clip, or two that overlap in the middle of a short one, multiply
    /// rather than fight: the clip simply never reaches full. That is what was asked for.
    pub fn fade_gain(&self, local: MediaTime) -> f32 {
        let duration = self.duration().as_ticks();
        if duration <= 0 {
            return 1.0;
        }
        let position = local.as_ticks().clamp(0, duration);
        let mut gain = 1.0_f32;

        let fade_in = self.fade_in().as_ticks().clamp(0, duration);
        if fade_in > 0 && position < fade_in {
            gain *= position as f32 / fade_in as f32;
        }
        let fade_out = self.fade_out().as_ticks().clamp(0, duration);
        let remaining = duration - position;
        if fade_out > 0 && remaining < fade_out {
            gain *= remaining as f32 / fade_out as f32;
        }
        gain.clamp(0.0, 1.0)
    }

    /// An audio clip's level as a polyline over its own length: `(seconds, gain)`, in order.
    ///
    /// The one description of a clip's level that both mixers read. The preview interpolates
    /// between these points per sample; the export turns them into an ffmpeg `volume`
    /// expression. Deriving each independently is how a duck ends up in a different place in
    /// the file than it was in the room.
    ///
    /// Eased keyframe segments are subdivided rather than taken at their endpoints — an
    /// `expo-out` duck sampled only at its two keys is a straight line, which is not what the
    /// author asked for. A flat clip returns a single point.
    /// The same polyline, with the head and tail fades left out.
    ///
    /// For a mixer that applies fades itself. The export does: an ffmpeg `volume` expression is
    /// evaluated once per audio *frame* — about 21 ms — and held, so a fade folded into it is
    /// quantised to that grid and its first frame is multiplied by exactly zero. On a fade of a
    /// second nobody notices; on the tens of milliseconds a dialogue join wants, the fade *is*
    /// the first frame, and what reaches the file is a hole rather than a ramp. The export
    /// emits `afade` for these instead, which is sample-accurate.
    pub fn gain_points_without_fades(&self) -> Vec<(f64, f32)> {
        let mut bare = self.clone();
        bare.set_fades(MediaTime::ZERO, MediaTime::ZERO);
        bare.gain_points()
    }

    /// The same polyline with a lane's fader folded in.
    ///
    /// A lane gain is a second gain stage, and gain stages multiply — so folding it in is a
    /// constant on every point rather than a reshaping of the curve. Named here, once, because
    /// three things need it and doing it inline in each is how two of them come to disagree
    /// about whether a muted lane is a zero or an absence.
    pub fn gain_points_with_track_gain(&self, track_gain: f32) -> Vec<(f64, f32)> {
        scale_gain_points(&self.gain_points(), track_gain)
    }

    pub fn gain_points(&self) -> Vec<(f64, f32)> {
        if !matches!(self, Element::Audio(_)) {
            return Vec::new();
        }
        let duration = self.duration();
        let duration_secs = duration.to_seconds_f64();
        if duration_secs <= 0.0 {
            return Vec::new();
        }

        // The fade corners are this function's own business — they are geometry of the clip,
        // not of the channel — but everywhere the *curve* needs describing is
        // `AnimationChannel::polyline`. Two densifiers subdividing the same curve to different
        // densities is how the file and the room came to disagree about where a duck sat.
        let mut ticks: Vec<i64> = vec![0, duration.as_ticks()];
        ticks.push(self.fade_in().as_ticks());
        ticks.push(duration.as_ticks() - self.fade_out().as_ticks());

        if let Some(channel) = self.animations().and_then(|a| a.get("volume")) {
            ticks.extend(
                channel
                    .polyline(MediaTime::ZERO..=duration)
                    .into_iter()
                    .map(|(time, _)| time.as_ticks()),
            );
        }

        ticks.retain(|t| *t >= 0 && *t <= duration.as_ticks());
        ticks.sort_unstable();
        ticks.dedup();
        let points: Vec<(f64, f32)> = ticks
            .into_iter()
            .filter_map(|t| {
                let time = MediaTime::from_ticks(t);
                self.sampled_gain(time)
                    .map(|gain| (time.to_seconds_f64(), gain))
            })
            .collect();

        // A level that never moves says so in one point, which is what tells a caller it can
        // skip the envelope entirely.
        if points.iter().all(|(_, gain)| *gain == points[0].1) {
            return points.into_iter().take(1).collect();
        }
        points
    }

    /// The imported asset this element plays, for the kinds backed by a file.
    pub fn media_id(&self) -> Option<&str> {
        match self {
            Element::Video(e) => Some(&e.media_id),
            Element::Image(e) => Some(&e.media_id),
            Element::Audio(e) => Some(&e.media_id),
            Element::Text(_) | Element::Shape(_) => None,
        }
    }

    /// The in-point into the source: how far into the file this clip starts playing.
    ///
    /// `None` for kinds with no timeline inside them — text, shapes, and stills, which have a
    /// file but only one frame of it.
    pub fn source_start(&self) -> Option<MediaTime> {
        match self {
            Element::Video(e) => Some(e.trim_start),
            Element::Audio(e) => Some(e.trim_start),
            Element::Image(_) | Element::Text(_) | Element::Shape(_) => None,
        }
    }

    /// Move the in-point, keeping the out-point a duration away from it.
    ///
    /// `trim_end` is derived rather than independent: bay has no speed control, so a clip
    /// always plays its source at 1×, and an out-point that disagreed with `start + duration`
    /// would describe a clip that cannot exist. Keeping it in step here is what stops the two
    /// from drifting — the field is part of the wire format the web app reads.
    pub fn set_source_start(&mut self, trim_start: MediaTime) {
        match self {
            Element::Video(e) => {
                e.trim_start = trim_start;
                e.trim_end = trim_start + video_source_duration(e);
            }
            Element::Audio(e) => e.trim_start = trim_start,
            Element::Image(_) | Element::Text(_) | Element::Shape(_) => {}
        }
    }

    /// Whether this element reads a timeline out of its source, and so can be trimmed and
    /// slipped. A still is backed by a file but has no in-point to choose.
    pub fn has_source_timeline(&self) -> bool {
        matches!(self, Element::Video(_) | Element::Audio(_))
    }

    /// The mask limiting where this element shows, if it has one.
    pub fn mask(&self) -> Option<Mask> {
        match self {
            Element::Video(e) => e.mask,
            Element::Image(e) => e.mask,
            Element::Text(e) => e.mask,
            Element::Shape(e) => e.mask,
            Element::Audio(_) => None,
        }
    }

    pub fn set_mask(&mut self, mask: Option<Mask>) {
        match self {
            Element::Video(e) => e.mask = mask,
            Element::Image(e) => e.mask = mask,
            Element::Text(e) => e.mask = mask,
            Element::Shape(e) => e.mask = mask,
            Element::Audio(_) => {}
        }
    }

    /// Mask values with nested animation paths (`mask.x`, `mask.feather`, …) applied.
    pub fn sampled_mask(&self, local_time: MediaTime) -> Option<Mask> {
        let mut mask = self.mask()?;
        let animations = self.animations()?;
        let sample = |name: &str| animations.get(name).and_then(|c| c.sample(local_time));
        if let Some(value) = sample("mask.x") {
            mask.x = value;
        }
        if let Some(value) = sample("mask.y") {
            mask.y = value;
        }
        if let Some(value) = sample("mask.width") {
            mask.width = value;
        }
        if let Some(value) = sample("mask.height") {
            mask.height = value;
        }
        if let Some(value) = sample("mask.feather") {
            mask.feather = value;
        }
        Some(mask)
    }

    /// The shape with `shape.radius` sampled at element-local time (`None` for non-shapes).
    ///
    /// Corner radius is a fraction of the shorter side, so a channel on it reads the same way
    /// at any size — which is what makes "round the corners off as the card seats" expressible
    /// as two keys rather than as a second element that swaps in.
    pub fn sampled_shape_kind(&self, local_time: MediaTime) -> Option<ShapeKind> {
        let Element::Shape(shape) = self else {
            return None;
        };
        let mut kind = shape.shape;
        if let Some(value) = shape
            .animations
            .get("shape.radius")
            .and_then(|c| c.sample(local_time))
            && let ShapeKind::Rect { radius } = &mut kind
        {
            *radius = value;
        }
        Some(kind)
    }

    /// The stroke with `stroke.width` sampled at element-local time.
    ///
    /// `None` when the element has no stroke at all: a channel cannot bring one into
    /// existence, because the width is only half of a stroke and the colour is not a scalar.
    pub fn sampled_stroke(&self, local_time: MediaTime) -> Option<Stroke> {
        let Element::Shape(shape) = self else {
            return None;
        };
        let mut stroke = shape.stroke.clone()?;
        if let Some(value) = shape
            .animations
            .get("stroke.width")
            .and_then(|c| c.sample(local_time))
        {
            stroke.width = value;
        }
        Some(stroke)
    }

    /// The font size with a `fontSize` channel sampled at element-local time.
    pub fn sampled_font_size(&self, local_time: MediaTime) -> Option<f32> {
        let Element::Text(text) = self else {
            return None;
        };
        Some(
            text.animations
                .get("fontSize")
                .and_then(|c| c.sample(local_time))
                .unwrap_or(text.font_size),
        )
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

    /// Effects with `effect.<id>.<param>` animation channels sampled at element-local time.
    pub fn sampled_effects(&self, local_time: MediaTime) -> Vec<Effect> {
        let mut effects = self.effects().to_vec();
        let Some(animations) = self.animations() else {
            return effects;
        };
        for effect in &mut effects {
            let prefix = format!("effect.{}.", effect.id);
            for (path, channel) in animations {
                let Some(param) = path.strip_prefix(&prefix) else {
                    continue;
                };
                if let Some(value) = channel.sample(local_time) {
                    effect.params.insert(param.to_string(), value);
                }
            }
        }
        effects
    }

    /// Animation channels keyed by property path ("opacity"/"scale"/"x"/"y"/"rotation").
    pub fn animations(&self) -> Option<&BTreeMap<String, AnimationChannel>> {
        match self {
            Element::Video(e) => Some(&e.animations),
            Element::Image(e) => Some(&e.animations),
            Element::Text(e) => Some(&e.animations),
            Element::Shape(e) => Some(&e.animations),
            Element::Audio(e) => Some(&e.animations),
        }
    }

    pub fn animations_mut(&mut self) -> Option<&mut BTreeMap<String, AnimationChannel>> {
        match self {
            Element::Video(e) => Some(&mut e.animations),
            Element::Image(e) => Some(&mut e.animations),
            Element::Text(e) => Some(&mut e.animations),
            Element::Shape(e) => Some(&mut e.animations),
            Element::Audio(e) => Some(&mut e.animations),
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
            if let Some(v) = animations
                .get("cropLeft")
                .and_then(|c| c.sample(local_time))
            {
                transform.crop_left = v;
            }
            if let Some(v) = animations.get("cropTop").and_then(|c| c.sample(local_time)) {
                transform.crop_top = v;
            }
            if let Some(v) = animations
                .get("cropRight")
                .and_then(|c| c.sample(local_time))
            {
                transform.crop_right = v;
            }
            if let Some(v) = animations
                .get("cropBottom")
                .and_then(|c| c.sample(local_time))
            {
                transform.crop_bottom = v;
            }
            if let Some(v) = animations.get("tiltX").and_then(|c| c.sample(local_time)) {
                transform.tilt_x = v;
            }
            if let Some(v) = animations.get("tiltY").and_then(|c| c.sample(local_time)) {
                transform.tilt_y = v;
            }
        }
        Some(transform)
    }

    /// The animatable transform properties, in the order the inspector lists them. Also the
    /// set the MCP surface validates against, so an unknown channel name is a hard error
    /// rather than an animation that silently never plays.
    pub const ANIMATABLE: [&'static str; 13] = [
        "opacity",
        "scale",
        "x",
        "y",
        "rotation",
        "scaleX",
        "scaleY",
        "cropLeft",
        "cropTop",
        "cropRight",
        "cropBottom",
        "tiltX",
        "tiltY",
    ];

    /// The only property an audio clip has to animate. Kept apart from [`Self::ANIMATABLE`]
    /// because the two sets do not overlap at all: audio has no position to move, and nothing
    /// visual has a level.
    pub const ANIMATABLE_AUDIO: [&'static str; 1] = ["volume"];

    /// What can be keyframed on *this* element. Offering an agent `x` on a music bed and then
    /// silently doing nothing with the keys is worse than refusing it.
    pub fn animatable(&self) -> &'static [&'static str] {
        match self {
            Element::Audio(_) => &Self::ANIMATABLE_AUDIO,
            _ => &Self::ANIMATABLE,
        }
    }

    /// An audio clip's level at `local` — its keyframed volume if it has any, its own volume
    /// otherwise, multiplied by its fades. `None` for anything that is not audio.
    ///
    /// One function so the preview mixer and the export cannot disagree about how loud a
    /// moment is, which is the kind of difference nobody notices until the file is posted.
    pub fn sampled_gain(&self, local: MediaTime) -> Option<f32> {
        let Element::Audio(audio) = self else {
            return None;
        };
        if audio.muted {
            return Some(0.0);
        }
        let base = audio
            .animations
            .get("volume")
            .and_then(|channel| channel.sample(local))
            .unwrap_or(audio.volume);
        Some((base.max(0.0) * self.fade_gain(local)).max(0.0))
    }

    /// The shape payload, for `Shape` elements only.
    pub fn shape(&self) -> Option<&ShapeElement> {
        match self {
            Element::Shape(shape) => Some(shape),
            _ => None,
        }
    }

    /// The audio payload, for `Audio` elements only.
    pub fn audio(&self) -> Option<&AudioElement> {
        match self {
            Element::Audio(audio) => Some(audio),
            _ => None,
        }
    }

    /// The audio payload, mutably. `None` for everything that is not a sound — which is what
    /// makes a level, a pan or a mute a no-op on a title rather than a silent surprise.
    pub fn audio_mut(&mut self) -> Option<&mut AudioElement> {
        match self {
            Element::Audio(audio) => Some(audio),
            _ => None,
        }
    }

    /// Number of animated properties on this element.
    pub fn animated_property_count(&self) -> usize {
        self.animations().map_or(0, |a| a.len())
    }

    /// Source-media time corresponding to an element-local timeline time.
    pub fn source_time(&self, local_time: MediaTime) -> Option<MediaTime> {
        match self {
            Element::Video(video) => {
                let mut elapsed = local_time.max(MediaTime::ZERO);
                if let Some(freeze) = video.freeze {
                    let freeze_end = freeze.at + freeze.duration.max(MediaTime::ZERO);
                    elapsed = if elapsed < freeze.at {
                        elapsed
                    } else if elapsed < freeze_end {
                        freeze.at
                    } else {
                        elapsed - freeze.duration.max(MediaTime::ZERO)
                    };
                }
                Some(video.trim_start + scale_time(elapsed, sane_speed(video.speed)))
            }
            Element::Audio(audio) => Some(
                audio.trim_start
                    + scale_time(local_time.max(MediaTime::ZERO), sane_speed(audio.speed)),
            ),
            Element::Image(_) | Element::Text(_) | Element::Shape(_) => None,
        }
    }
}

fn sane_speed(speed: f32) -> f32 {
    if speed.is_finite() && speed > 0.0 {
        speed
    } else {
        1.0
    }
}

fn scale_time(time: MediaTime, multiplier: f32) -> MediaTime {
    MediaTime::from_ticks((time.as_ticks() as f64 * f64::from(multiplier)).round() as i64)
}

fn video_source_duration(video: &VideoElement) -> MediaTime {
    let held = video
        .freeze
        .map_or(MediaTime::ZERO, |freeze| {
            freeze.duration.max(MediaTime::ZERO)
        })
        .min(video.duration);
    scale_time(video.duration - held, sane_speed(video.speed))
}

#[cfg(test)]
mod craft_tests {
    use super::*;

    fn seconds(value: f64) -> MediaTime {
        MediaTime::from_seconds_f64(value).expect("test time")
    }

    #[test]
    fn karaoke_active_word_uses_half_open_intervals() {
        let spec = KaraokeSpec {
            words: vec![
                KaraokeWord {
                    text: "make".into(),
                    start: seconds(0.0),
                    end: seconds(0.5),
                },
                KaraokeWord {
                    text: "motion".into(),
                    start: seconds(0.5),
                    end: seconds(1.0),
                },
            ],
            highlight_color: "#ffcc00".into(),
        };

        assert_eq!(spec.active_word(seconds(0.0)), Some(0));
        assert_eq!(spec.active_word(seconds(0.499)), Some(0));
        assert_eq!(spec.active_word(seconds(0.5)), Some(1));
        assert_eq!(spec.active_word(seconds(1.0)), None);
    }
}
