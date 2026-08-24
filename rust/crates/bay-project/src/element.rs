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
}

impl Keyframe {
    /// A key that travels on its channel's easing.
    pub fn new(time: MediaTime, value: f32) -> Self {
        Self {
            time,
            value,
            easing: None,
        }
    }

    /// A key that overrides its channel's easing for the segment leaving it.
    pub fn eased(time: MediaTime, value: f32, easing: Easing) -> Self {
        Self {
            time,
            value,
            easing: Some(easing),
        }
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
                // The key's own curve wins over the channel's, so one channel can arrive
                // fast, hold, and leave slowly — which is what most real motion does.
                let eased = a.easing.unwrap_or(self.easing).apply(fraction);
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
    pub fn upsert_key(&mut self, key: Keyframe) {
        match self.keys.iter().position(|k| k.time == key.time) {
            Some(index) => self.keys[index] = key,
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

    pub fn gain_points(&self) -> Vec<(f64, f32)> {
        if !matches!(self, Element::Audio(_)) {
            return Vec::new();
        }
        let duration = self.duration();
        let duration_secs = duration.to_seconds_f64();
        if duration_secs <= 0.0 {
            return Vec::new();
        }

        /// Steps an eased segment is cut into. Linear segments need none; an ease needs
        /// enough that the ramp reads as a curve rather than a staircase.
        const EASED_STEPS: i64 = 16;

        let mut ticks: Vec<i64> = vec![0, duration.as_ticks()];
        ticks.push(self.fade_in().as_ticks());
        ticks.push(duration.as_ticks() - self.fade_out().as_ticks());

        if let Some(channel) = self.animations().and_then(|a| a.get("volume")) {
            for key in &channel.keys {
                ticks.push(key.time.as_ticks());
            }
            // Per segment, not per channel: a key carrying its own curve has to be subdivided
            // even when the channel it sits on is linear, or that segment reaches the file as
            // the straight line the author specifically asked it not to be.
            for pair in channel.keys.windows(2) {
                if pair[0].easing.unwrap_or(channel.easing) == Easing::Linear {
                    continue;
                }
                let (a, b) = (pair[0].time.as_ticks(), pair[1].time.as_ticks());
                for step in 1..EASED_STEPS {
                    ticks.push(a + (b - a) * step / EASED_STEPS);
                }
            }
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
        }
        Some(transform)
    }

    /// The animatable transform properties, in the order the inspector lists them. Also the
    /// set the MCP surface validates against, so an unknown channel name is a hard error
    /// rather than an animation that silently never plays.
    pub const ANIMATABLE: [&'static str; 11] = [
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
