//! The style kit: the typography and colour a project is committed to, chosen once.
//!
//! **Why this exists.** In the project that prompted it, 72 of 73 text elements were set
//! *smaller* than `add_text`'s own default `fontSize` of 64, and 73 of 73 took the default
//! `fontWeight` of 400 whole — the default beat the agent's explicit choice 98.6 % of the time,
//! and where the default was wrong it was taken every single time. 69 of the 73 were in Menlo.
//! Five colours were used across 188 elements, one of them copied out of a document that labels
//! it as failing contrast.
//!
//! No check can fix that, because a check is a threshold and a threshold is beaten by threshold
//! plus epsilon. The lever that remains is **the argument that no longer exists**: `add_text` and
//! `add_shape` do not take a family, a size, a weight or a colour. They take a
//! [`ElementRole`] — what the element is *for* — and a [`Tone`], and the kit answers the rest.
//!
//! A kit is:
//!
//! - **three type roles** — display, body, mono — each a family *and* a weight, because
//!   requesting a weight a family does not have does not fall back to the nearest weight, it
//!   drops the family (`Avenir` w700 resolves to Menlo Bold);
//! - **a type ramp** — one size, tracking and line height per [`ElementRole`], normalised so
//!   every kit's hero lands at the same *cap height* rather than the same `fontSize`, which is
//!   the difference between swapping a typeface and making a mistake;
//! - **a palette** of six named roles, whose contrast against the ground is measured here, not
//!   asserted;
//! - **named framings** — at least four, at least one of them bottom-weighted, because the
//!   failing project had nothing at all below y = 0.73.
//!
//! A project commits to exactly one kit, and it is stored in the project file so the web app,
//! the desktop editor and `check` all read the same one.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::element::{Element, ElementRole};
use crate::scene::Scene;

// ---------------------------------------------------------------------- tone

/// Which colour of the committed kit an element is drawn in.
///
/// This is the whole colour surface an author gets. `#rrggbb` is not reachable from a tool
/// argument, which is why "five colours, eleven of them greys, none of them a decision" is no
/// longer a state a project can be in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tone {
    /// The loudest value in the palette: headlines, hero figures, the payoff.
    #[default]
    Ink,
    /// Secondary type — kickers, axis labels, units, source notes.
    Dim,
    /// The point. Scarce: one element per beat, on the thing that *is* the argument.
    Accent,
    /// The opposition to the accent — a second series, the down bar, the contrast case.
    Accent2,
    /// Plates, cards and panels that must read as raised. Sits far enough above the ground to
    /// be visible at all, which the 34 %-of-canvas rectangle at 1.10:1 did not.
    Surface,
}

impl Tone {
    pub const ALL: [Tone; 5] = [
        Tone::Ink,
        Tone::Dim,
        Tone::Accent,
        Tone::Accent2,
        Tone::Surface,
    ];
    pub const NAMES: [&'static str; 5] = ["ink", "dim", "accent", "accent2", "surface"];

    pub fn as_str(self) -> &'static str {
        Self::NAMES[Self::ALL.iter().position(|t| *t == self).unwrap_or(0)]
    }

    pub fn from_wire(name: &str) -> Option<Self> {
        Self::NAMES
            .iter()
            .position(|n| *n == name)
            .map(|index| Self::ALL[index])
    }

    /// The tone a role takes when the caller does not say.
    ///
    /// Defaults are the most load-bearing thing on a tool surface — they won 98.6 % of the time
    /// in the project this exists to prevent — so each one here is the answer that is *right*
    /// for that role rather than the one that is easiest to describe.
    pub fn default_for(role: ElementRole) -> Tone {
        match role {
            ElementRole::Hook | ElementRole::Headline | ElementRole::Lockup => Tone::Ink,
            ElementRole::Data => Tone::Accent,
            ElementRole::Kicker | ElementRole::Label | ElementRole::Caption => Tone::Dim,
            ElementRole::Ground => Tone::Surface,
            ElementRole::Chrome => Tone::Dim,
        }
    }
}

// ------------------------------------------------------------------- typefaces

/// One resolved typeface: a family *and* the weight that family actually has.
///
/// The weight travels with the family because they are not independent. cosmic-text does not
/// snap to the nearest weight — a miss drops the family and substitutes another face entirely,
/// so `(family, weight)` is the unit that either resolves or does not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeFace {
    pub family: String,
    pub weight: u16,
}

impl TypeFace {
    pub fn new(family: &str, weight: u16) -> Self {
        Self {
            family: family.to_string(),
            weight,
        }
    }

    /// Cap height as a fraction of the em, for this face's family. See [`cap_per_em`].
    pub fn cap_per_em(&self) -> f32 {
        cap_per_em(&self.family)
    }
}

/// The three jobs a kit's typefaces do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeRoles {
    /// Hooks, headlines, lockups, the payoff figure. Carries the heavy weight.
    pub display: TypeFace,
    /// Labels, captions, everything a reader actually reads.
    pub body: TypeFace,
    /// Kickers, tickers, units, source lines — a *voice*, never a default. A monospace body
    /// face reads as a screenshot of a terminal that someone animated.
    pub mono: TypeFace,
}

impl TypeRoles {
    /// Which face does a given role's work.
    pub fn for_role(&self, role: ElementRole) -> &TypeFace {
        match role {
            ElementRole::Hook | ElementRole::Headline | ElementRole::Lockup | ElementRole::Data => {
                &self.display
            }
            ElementRole::Kicker => &self.mono,
            ElementRole::Label
            | ElementRole::Caption
            | ElementRole::Ground
            | ElementRole::Chrome => &self.body,
        }
    }

    /// The distinct family names in this kit, lowercased for comparison.
    pub fn families(&self) -> Vec<String> {
        let mut names: Vec<String> = [&self.display, &self.body, &self.mono]
            .iter()
            .map(|face| face.family.to_lowercase())
            .collect();
        names.sort();
        names.dedup();
        names
    }
}

/// Cap height as a fraction of the em, per family.
///
/// `fontSize` is not a size; cap height is. Charter at the headline step needs ×1.06 of what
/// Avenir Next needs to look the same, and Copperplate needs ×1.34 — ignoring that is why a
/// "same size" face swap looks like a mistake. The ramp divides by this so every kit's hero
/// lands on the same cap height whatever family it is set in.
///
/// The first block is measured (`prompt-res/round2/31-typography.md` §2.3). The second is
/// estimated from the family's genre and is only ever a *normalisation* constant — the ratio
/// between two steps in one kit is unaffected by it, because both steps divide by the same
/// number for the same family.
pub fn cap_per_em(family: &str) -> f32 {
    const MEASURED: [(&str, f32); 17] = [
        ("futura", 0.76),
        ("rockwell", 0.74),
        ("menlo", 0.73),
        ("verdana", 0.73),
        ("helvetica neue", 0.71),
        ("avenir next", 0.71),
        ("avenir", 0.71),
        ("didot", 0.71),
        ("pt serif", 0.70),
        ("optima", 0.69),
        ("georgia", 0.69),
        ("charter", 0.67),
        ("baskerville", 0.67),
        ("bodoni 72", 0.67),
        ("cochin", 0.65),
        ("courier new", 0.58),
        ("copperplate", 0.53),
    ];
    const ESTIMATED: [(&str, f32); 13] = [
        ("arial black", 0.72),
        ("din alternate", 0.71),
        ("phosphate", 0.72),
        ("galvji", 0.70),
        ("pt sans", 0.70),
        ("palatino", 0.69),
        ("gill sans", 0.68),
        ("andale mono", 0.68),
        ("american typewriter", 0.66),
        ("big caslon", 0.66),
        ("hoefler text", 0.66),
        ("times new roman", 0.66),
        ("monaco", 0.62),
    ];
    /// What an unlisted family is assumed to be. Roughly the median of the measured set.
    const DEFAULT: f32 = 0.70;

    let key = family.to_lowercase();
    MEASURED
        .iter()
        .chain(ESTIMATED.iter())
        .find(|(name, _)| *name == key)
        .map(|(_, cap)| *cap)
        .unwrap_or(DEFAULT)
}

// ------------------------------------------------------------------ type ramp

/// One rung of the ladder: how big, how tracked, how leaded.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeStep {
    /// `fontSize` as the element carries it — quoted against a 1080-tall canvas and scaled by
    /// the renderer for the real one, so this number *is* the size at the project's canvas size.
    pub size: f32,
    /// Tracking in em. Uppercase kickers open up; display type closes in.
    pub tracking: f32,
    /// Line box as a multiple of the size.
    pub line_height: f32,
}

/// A size for every [`ElementRole`], at the project's canvas size.
///
/// A modular ladder rather than a list of favourite numbers: each rung is far enough from the
/// one beside it to read as hierarchy in motion, and the whole ramp is derived from cap-height
/// targets divided by the family's own cap height — so two kits set in different faces carry
/// different `fontSize` numbers and land on the same picture.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeRamp {
    pub hook: TypeStep,
    pub headline: TypeStep,
    pub kicker: TypeStep,
    pub label: TypeStep,
    pub caption: TypeStep,
    pub lockup: TypeStep,
    pub data: TypeStep,
    pub ground: TypeStep,
    pub chrome: TypeStep,
}

impl TypeRamp {
    pub fn step(&self, role: ElementRole) -> TypeStep {
        match role {
            ElementRole::Hook => self.hook,
            ElementRole::Headline => self.headline,
            ElementRole::Kicker => self.kicker,
            ElementRole::Label => self.label,
            ElementRole::Caption => self.caption,
            ElementRole::Lockup => self.lockup,
            ElementRole::Data => self.data,
            ElementRole::Ground => self.ground,
            ElementRole::Chrome => self.chrome,
        }
    }
}

/// How loud a kit's ladder is. The same nine rungs, pitched three ways.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Voice {
    /// Restrained — Swiss, editorial, formal. The hero is still 4.4× the label.
    Quiet,
    /// The house ladder: hero cap 217 px on a 1920-tall frame, which is where a two-word phrase
    /// stops being text you decode at thumbnail size and becomes a shape you recognise.
    House,
    /// Poster scale — sport, riso, brutalist, broadcast.
    Loud,
}

impl Voice {
    /// Cap-height targets in pixels on a 1920-tall canvas, in [`ElementRole::ALL`] order.
    fn caps(self) -> [f32; 9] {
        match self {
            //          hook  head  kick  labl  capt  lock  data  grnd  chrm
            Voice::Quiet => [190.0, 121.0, 43.0, 43.0, 68.0, 82.0, 175.0, 34.0, 34.0],
            Voice::House => [217.0, 138.0, 45.0, 45.0, 71.0, 89.0, 200.0, 36.0, 36.0],
            Voice::Loud => [255.0, 160.0, 47.0, 47.0, 74.0, 96.0, 235.0, 38.0, 38.0],
        }
    }
}

/// Tracking in em per role, in [`ElementRole::ALL`] order. Typographic hygiene, not taste:
/// uppercase runs need air, display type at 150 px and up needs the opposite.
const TRACKING: [f32; 9] = [-0.02, -0.015, 0.16, 0.0, 0.0, 0.06, -0.01, 0.0, 0.10];

/// Line height per role. Body on a dark ground takes more leading than the 1.2 default; display
/// takes less than one.
const LINE_HEIGHT: [f32; 9] = [1.02, 1.08, 1.20, 1.32, 1.28, 1.16, 1.00, 1.30, 1.20];

/// The canvas height every `fontSize` in the model is quoted against. `bay-preview` renders a
/// glyph at `font_size × canvas_height / 1080`, so a ramp derived for a 1920-tall frame divides
/// its cap targets by this ratio to land back in `fontSize` units.
const REFERENCE_CANVAS_HEIGHT: f32 = 1080.0;
/// The frame the cap-height ladder was derived on — a 1080×1920 vertical reel.
const LADDER_CANVAS_HEIGHT: f32 = 1920.0;

fn build_ramp(voice: Voice, faces: &TypeRoles) -> TypeRamp {
    let caps = voice.caps();
    let step = |index: usize| {
        let role = ElementRole::ALL[index];
        let cap_em = faces.for_role(role).cap_per_em();
        let size = caps[index] / cap_em / (LADDER_CANVAS_HEIGHT / REFERENCE_CANVAS_HEIGHT);
        TypeStep {
            size: (size * 10.0).round() / 10.0,
            tracking: TRACKING[index],
            line_height: LINE_HEIGHT[index],
        }
    };
    TypeRamp {
        hook: step(0),
        headline: step(1),
        kicker: step(2),
        label: step(3),
        caption: step(4),
        lockup: step(5),
        data: step(6),
        ground: step(7),
        chrome: step(8),
    }
}

// -------------------------------------------------------------------- palette

/// Six colour roles. Not six colours — the difference is the point: a palette that names fewer
/// than five roles looks under-designed, and one that invents a colour per element looks
/// incoherent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    /// The ground. Every frame sits on it; it is the project's background.
    pub bg: String,
    /// Plates and panels, above the ground far enough to be seen.
    pub surface: String,
    /// The loudest value.
    pub ink: String,
    /// Secondary type.
    pub dim: String,
    /// The accent.
    pub accent: String,
    /// The second series / the opposition.
    pub accent2: String,
}

impl Palette {
    pub fn tone(&self, tone: Tone) -> &str {
        match tone {
            Tone::Ink => &self.ink,
            Tone::Dim => &self.dim,
            Tone::Accent => &self.accent,
            Tone::Accent2 => &self.accent2,
            Tone::Surface => &self.surface,
        }
    }

    /// Every colour in the palette, ground included, lowercased — what "is this an off-token
    /// value" is asked against.
    pub fn all(&self) -> Vec<String> {
        [
            &self.bg,
            &self.surface,
            &self.ink,
            &self.dim,
            &self.accent,
            &self.accent2,
        ]
        .iter()
        .map(|c| c.to_lowercase())
        .collect()
    }
}

// -------------------------------------------------------------------- framing

/// Type below this fraction of the canvas height counts as bottom-weighted. The project this
/// work exists to prevent had **nothing at all** below y = 0.73 and a pixel-identical band from
/// 0.771 to the bottom edge for all 1830 of its frames.
pub const BOTTOM_WEIGHTED_Y: f32 = 0.60;

/// A named place to put something, so "where does this go" has an answer that is not a float an
/// agent copied out of a document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Framing {
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
    /// Fraction of the canvas the element's layout box spans.
    pub scale: f32,
}

impl Framing {
    #[allow(clippy::too_many_arguments)]
    fn new(name: &str, x: f32, y: f32, anchor_x: f32, anchor_y: f32, scale: f32) -> Self {
        Self {
            name: name.to_string(),
            x,
            y,
            anchor_x,
            anchor_y,
            scale,
        }
    }

    /// Whether this framing puts its element in the bottom of the frame.
    pub fn is_bottom_weighted(&self) -> bool {
        self.y >= BOTTOM_WEIGHTED_Y
    }
}

/// The shape of a kit's framing set. Four different ways of dividing a frame, so two kits do not
/// merely differ in their numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FramingPlan {
    /// A strict left-aligned grid: everything hangs off one margin.
    Grid,
    /// Centred, with the weight in the middle of the frame.
    Centred,
    /// A hero over a left column, the way a magazine opener is set.
    Editorial,
    /// Bands: a strap at the top, a lower third, a ticker.
    Broadcast,
}

impl FramingPlan {
    /// `margin` is the side gutter; `hero` and `low` are the vertical positions the plan hangs
    /// its main and lower blocks on. Every plan returns at least four framings and at least one
    /// below [`BOTTOM_WEIGHTED_Y`].
    fn framings(self, margin: f32, hero: f32, low: f32) -> Vec<Framing> {
        let column = 1.0 - 2.0 * margin;
        match self {
            FramingPlan::Grid => vec![
                Framing::new("top-left", margin, margin * 1.4, 0.0, 0.0, column),
                Framing::new("left-column", margin, hero, 0.0, 0.5, column),
                Framing::new("grid-right", 1.0 - margin, hero, 1.0, 0.5, column * 0.46),
                Framing::new("lower-third", margin, low, 0.0, 0.0, column),
                Framing::new("baseline", margin, 1.0 - margin * 1.4, 0.0, 1.0, column),
            ],
            FramingPlan::Centred => vec![
                Framing::new("hero", 0.5, hero, 0.5, 0.5, column),
                Framing::new("upper-centre", 0.5, margin * 2.2, 0.5, 0.0, column),
                Framing::new("lower-third", 0.5, low, 0.5, 0.0, column),
                Framing::new("baseline", 0.5, 1.0 - margin * 1.4, 0.5, 1.0, column),
                Framing::new("corner-mark", 1.0 - margin, margin * 1.4, 1.0, 0.0, 0.24),
            ],
            FramingPlan::Editorial => vec![
                Framing::new("hero", 0.5, hero, 0.5, 0.5, column),
                Framing::new("top-left", margin, margin * 1.4, 0.0, 0.0, column * 0.72),
                Framing::new("left-column", margin, hero + 0.16, 0.0, 0.0, column * 0.66),
                Framing::new("lower-third", margin, low, 0.0, 0.0, column),
                Framing::new("footer", margin, 1.0 - margin, 0.0, 1.0, column),
            ],
            FramingPlan::Broadcast => vec![
                Framing::new("top-band", margin, margin, 0.0, 0.0, column),
                Framing::new("hero", 0.5, hero, 0.5, 0.5, column),
                Framing::new("lower-third", margin, low, 0.0, 0.0, column),
                Framing::new("ticker", margin, 1.0 - margin, 0.0, 1.0, column),
                Framing::new("corner-mark", 1.0 - margin, margin, 1.0, 0.0, 0.22),
            ],
        }
    }
}

// ------------------------------------------------------------------- the kit

/// Hero cap height over body cap height. Below this the ladder is not a hierarchy — it is one
/// size with rounding error, which is what 41 of 73 elements at `fontSize: 34` was.
pub const MIN_CAP_RATIO: f32 = 4.0;
/// A kit needs three families it can actually reach: a display face, a text face and a voice.
pub const MIN_FAMILIES: usize = 3;
/// Fewer declared places than this and "where does it go" has no answer worth having.
pub const MIN_FRAMINGS: usize = 4;
/// The display face must carry a weight the text face does not, by this much.
pub const MIN_WEIGHT_SPREAD: u16 = 300;

/// How far the accent must sit from the ink.
///
/// **The plan asked for ΔE00 ≥ 40 and that number is not reachable in ΔE00 against a near-white
/// ink.** Measured over the whole sRGB cube: an ink at L\* ≈ 93 and any accent bright enough to
/// clear 4.5:1 on a dark ground (L\* ≥ 51) are at most ≈ 43 ΔE00 apart, and only reds, violets
/// and blues get there at all — an amber accent tops out at 33. Enforcing 40 in ΔE00 would have
/// produced twelve kits with the same red accent, which is the monotony this whole exercise is
/// against. So the claim is made twice, in the two metrics where each number means something:
/// **ΔE00 ≥ 25** (an enormous perceptual distance — the just-noticeable difference is ~1, and
/// ~10 already reads as "a different colour") **and ΔE76 ≥ 40** in the metric where 40 is the
/// conventional "clearly a different colour" threshold. Together they say what the plan meant:
/// the accent is not another shade of the ink.
pub const MIN_ACCENT_DELTA_E00: f32 = 25.0;
/// See [`MIN_ACCENT_DELTA_E00`].
pub const MIN_ACCENT_DELTA_E76: f32 = 40.0;

/// The typography, colour and framing a project has committed to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleKit {
    /// Stable id — `swiss`, `terminal`, or `custom` for one an author declared.
    pub id: String,
    pub name: String,
    /// Which tradition this is and what subject it suits. Read by the agent choosing between
    /// three offers; a kit that cannot say what it is for is a table of hexes.
    pub note: String,
    pub faces: TypeRoles,
    pub ramp: TypeRamp,
    pub palette: Palette,
    pub framings: Vec<Framing>,
}

/// Everything an element needs to be drawn, resolved from a role and a tone.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedStyle {
    pub family: String,
    pub weight: u16,
    pub size: f32,
    pub tracking: f32,
    pub line_height: f32,
    pub color: String,
}

impl StyleKit {
    /// The face, size and colour for a role/tone pair.
    pub fn resolve(&self, role: ElementRole, tone: Tone) -> ResolvedStyle {
        let face = self.faces.for_role(role);
        let step = self.ramp.step(role);
        ResolvedStyle {
            family: face.family.clone(),
            weight: face.weight,
            size: step.size,
            tracking: step.tracking,
            line_height: step.line_height,
            color: self.palette.tone(tone).to_string(),
        }
    }

    /// The colour for a tone.
    pub fn color(&self, tone: Tone) -> &str {
        self.palette.tone(tone)
    }

    /// A framing by name.
    pub fn framing(&self, name: &str) -> Option<&Framing> {
        self.framings
            .iter()
            .find(|framing| framing.name.eq_ignore_ascii_case(name))
    }

    pub fn framing_names(&self) -> Vec<&str> {
        self.framings
            .iter()
            .map(|framing| framing.name.as_str())
            .collect()
    }

    /// Hero cap height ÷ body cap height — the one number that says whether this kit has a
    /// hierarchy at all. Measured in cap height rather than `fontSize`, so a Copperplate kit and
    /// an Avenir Next kit are compared on what a viewer sees.
    pub fn cap_ratio(&self) -> f32 {
        let hero = self.ramp.hook.size * self.faces.display.cap_per_em();
        let body = self.ramp.label.size * self.faces.body.cap_per_em();
        if body <= 0.0 { 0.0 } else { hero / body }
    }

    /// Restyle an element to this kit, keeping everything about it except its typography and
    /// colour. Used where bay places an element the author did not spell out — a template.
    pub fn apply_to(&self, element: &mut Element, tone: Option<Tone>) {
        let Some(role) = element.role() else { return };
        let tone = tone.unwrap_or_else(|| Tone::default_for(role));
        let style = self.resolve(role, tone);
        match element {
            Element::Text(text) => {
                text.font_family = Some(style.family);
                text.font_weight = style.weight;
                text.font_size = style.size;
                text.letter_spacing = style.tracking;
                text.line_height = style.line_height;
                text.color = style.color;
            }
            Element::Shape(shape) => shape.color = style.color,
            _ => {}
        }
    }

    /// Everything wrong with this kit, or `Ok(())`.
    ///
    /// `resolves` answers "does this family, at this weight, exist on this machine" — injected
    /// rather than imported so the data model stays free of the font stack, and so the rule can
    /// be tested against a font set that is not the one on the developer's laptop.
    ///
    /// Declaring a kit is deliberately **more work than accepting an offer**: that asymmetry is
    /// the only thing that keeps "write your own" from being the escape hatch every rule here
    /// exists to close.
    pub fn validate(&self, mut resolves: impl FnMut(&str, u16) -> bool) -> Result<(), Vec<String>> {
        let mut problems = Vec::new();

        if self.id.trim().is_empty() {
            problems.push("the kit needs an id".to_string());
        }
        if self.note.trim().len() < 24 {
            problems.push(
                "note: say which tradition this kit is and what subject it suits, in a sentence \
                 — a kit that cannot say what it is for is a table of hexes"
                    .to_string(),
            );
        }

        // (1) three families, each resolving at the weight the kit asks for.
        let families = self.faces.families();
        if families.len() < MIN_FAMILIES {
            problems.push(format!(
                "a kit needs {MIN_FAMILIES} distinct families (display, body, mono); this one \
                 names {}",
                families.len()
            ));
        }
        for (slot, face) in [
            ("display", &self.faces.display),
            ("body", &self.faces.body),
            ("mono", &self.faces.mono),
        ] {
            if !resolves(&face.family, face.weight) {
                problems.push(format!(
                    "{slot}: {:?} at weight {} does not resolve on this machine — a weight a \
                     family does not have does not fall back to the nearest weight, it drops the \
                     family and renders something else entirely",
                    face.family, face.weight
                ));
            }
        }
        let spread = self
            .faces
            .display
            .weight
            .saturating_sub(self.faces.body.weight);
        if spread < MIN_WEIGHT_SPREAD {
            problems.push(format!(
                "the display face must carry a weight the text face does not: {} vs {} is a \
                 spread of {spread}, and {MIN_WEIGHT_SPREAD} is the floor",
                self.faces.display.weight, self.faces.body.weight
            ));
        }

        // (2) a hierarchy, measured in cap height.
        let ratio = self.cap_ratio();
        if ratio < MIN_CAP_RATIO {
            problems.push(format!(
                "hero/body cap ratio is {ratio:.2}; {MIN_CAP_RATIO:.1} is the floor — below it \
                 the ladder is one size with rounding error"
            ));
        }

        // (3) a palette whose roles are actually different colours.
        for (name, value) in [
            ("bg", &self.palette.bg),
            ("surface", &self.palette.surface),
            ("ink", &self.palette.ink),
            ("dim", &self.palette.dim),
            ("accent", &self.palette.accent),
            ("accent2", &self.palette.accent2),
        ] {
            if parse_hex(value).is_none() {
                problems.push(format!(
                    "palette.{name}: {value:?} is not an #rrggbb colour"
                ));
            }
        }
        if parse_hex(&self.palette.accent).is_some() && parse_hex(&self.palette.ink).is_some() {
            let d00 = delta_e_2000(&self.palette.accent, &self.palette.ink).unwrap_or(0.0);
            let d76 = delta_e_76(&self.palette.accent, &self.palette.ink).unwrap_or(0.0);
            if d00 < MIN_ACCENT_DELTA_E00 || d76 < MIN_ACCENT_DELTA_E76 {
                problems.push(format!(
                    "accent {:?} is too close to ink {:?}: ΔE00 {d00:.1} (floor \
                     {MIN_ACCENT_DELTA_E00:.0}) and ΔE76 {d76:.1} (floor \
                     {MIN_ACCENT_DELTA_E76:.0}) — an accent that is another shade of the ink is \
                     not an accent",
                    self.palette.accent, self.palette.ink
                ));
            }
        }

        // (4) at least four framings, at least one of them bottom-weighted.
        if self.framings.len() < MIN_FRAMINGS {
            problems.push(format!(
                "a kit declares at least {MIN_FRAMINGS} named framings; this one has {}",
                self.framings.len()
            ));
        }
        if !self
            .framings
            .iter()
            .any(|framing| framing.is_bottom_weighted())
        {
            problems.push(format!(
                "no framing is bottom-weighted (y ≥ {BOTTOM_WEIGHTED_Y}) — the project this rule \
                 comes from had nothing at all below y = 0.73"
            ));
        }
        let mut names: Vec<String> = self
            .framings
            .iter()
            .map(|framing| framing.name.to_lowercase())
            .collect();
        names.sort();
        let count = names.len();
        names.dedup();
        if names.len() != count {
            problems.push("two framings share a name".to_string());
        }
        if self
            .framings
            .iter()
            .any(|framing| framing.name.trim().is_empty())
        {
            problems.push("a framing has no name".to_string());
        }

        if problems.is_empty() {
            Ok(())
        } else {
            Err(problems)
        }
    }

    /// Authored elements whose typography or colour is not the kit's.
    ///
    /// **The backstop for the import path.** `add_text` and `add_shape` no longer accept a
    /// family, a size, a weight or a colour, but the wasm/web front end deserialises `Project`
    /// straight off the wire — that format is the pinned kebab-case interop contract and cannot
    /// be narrowed the way a tool schema can. So the same claim is made again here, over the
    /// finished document, as the finding `off-token-value`.
    ///
    /// Only authored elements are examined. bay's own captions are bay's, and measuring them as
    /// though an author had chosen them is the mistake provenance exists to stop.
    pub fn off_token_values(&self, scene: &Scene) -> Vec<OffToken> {
        let palette = self.palette.all();
        let mut found = Vec::new();
        for element in scene.authored_elements() {
            let Some(role) = element.role() else { continue };
            let expected = self.resolve(role, Tone::default_for(role));
            match element {
                Element::Text(text) => {
                    let family = text.font_family.clone().unwrap_or_default();
                    if !family.eq_ignore_ascii_case(&expected.family) {
                        found.push(OffToken::new(
                            text.id.as_str(),
                            "fontFamily",
                            if family.is_empty() {
                                "<the shaper's default>".to_string()
                            } else {
                                family
                            },
                            expected.family.clone(),
                        ));
                    }
                    if text.font_weight != expected.weight {
                        found.push(OffToken::new(
                            text.id.as_str(),
                            "fontWeight",
                            text.font_weight.to_string(),
                            expected.weight.to_string(),
                        ));
                    }
                    if !near(text.font_size, expected.size) {
                        found.push(OffToken::new(
                            text.id.as_str(),
                            "fontSize",
                            format!("{:.1}", text.font_size),
                            format!("{:.1}", expected.size),
                        ));
                    }
                    if !palette.contains(&text.color.to_lowercase()) {
                        found.push(OffToken::new(
                            text.id.as_str(),
                            "color",
                            text.color.clone(),
                            self.palette_summary(),
                        ));
                    }
                }
                Element::Shape(shape) if !palette.contains(&shape.color.to_lowercase()) => {
                    found.push(OffToken::new(
                        shape.id.as_str(),
                        "color",
                        shape.color.clone(),
                        self.palette_summary(),
                    ));
                }
                _ => {}
            }
        }
        found
    }

    fn palette_summary(&self) -> String {
        format!(
            "one of the kit's tones: ink {}, dim {}, accent {}, accent2 {}, surface {}",
            self.palette.ink,
            self.palette.dim,
            self.palette.accent,
            self.palette.accent2,
            self.palette.surface
        )
    }
}

/// Whether a size is the ramp's, allowing for the rounding a round-trip through JSON does.
fn near(a: f32, b: f32) -> bool {
    (a - b).abs() <= (b.abs() * 0.02).max(0.5)
}

/// One element carrying a value the kit does not name.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OffToken {
    pub element_id: String,
    /// The wire field the value sits in — `fontFamily`, `fontSize`, `fontWeight`, `color`.
    pub field: &'static str,
    pub found: String,
    pub expected: String,
}

impl OffToken {
    fn new(element_id: &str, field: &'static str, found: String, expected: String) -> Self {
        Self {
            element_id: element_id.to_string(),
            field,
            found,
            expected,
        }
    }

    /// The finding code this is reported under.
    pub const CODE: &'static str = "off-token-value";

    pub fn message(&self) -> String {
        format!(
            "{}: {} is {}, which the committed style kit does not name — expected {}",
            self.element_id, self.field, self.found, self.expected
        )
    }
}

// ------------------------------------------------------------------- colour

/// `#rrggbb` (or `#rgb`) to bytes. Anything else is `None` — a colour bay cannot parse is a
/// colour it must not guess at.
pub fn parse_hex(value: &str) -> Option<[u8; 3]> {
    let hex = value.strip_prefix('#')?;
    let byte = |s: &str| u8::from_str_radix(s, 16).ok();
    match hex.len() {
        3 => {
            let mut out = [0u8; 3];
            for (index, c) in hex.chars().enumerate() {
                let v = byte(&c.to_string())?;
                out[index] = v * 17;
            }
            Some(out)
        }
        6 => {
            let mut out = [0u8; 3];
            for index in 0..3 {
                out[index] = byte(&hex[index * 2..index * 2 + 2])?;
            }
            Some(out)
        }
        _ => None,
    }
}

fn to_linear(channel: u8) -> f32 {
    let c = f32::from(channel) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// WCAG relative luminance of a colour that is already parsed.
///
/// The byte form exists because compositing happens in light, not in hex: an element at 40 %
/// opacity over a plate is `0.4·L(ink) + 0.6·L(plate)`, and a check that had to round-trip
/// through `#rrggbb` to ask what that composites to would be inventing a second colour model.
pub fn luminance(rgb: [u8; 3]) -> f32 {
    let [r, g, b] = rgb;
    0.2126 * to_linear(r) + 0.7152 * to_linear(g) + 0.0722 * to_linear(b)
}

/// WCAG relative luminance.
pub fn relative_luminance(color: &str) -> Option<f32> {
    Some(luminance(parse_hex(color)?))
}

/// WCAG contrast ratio between two luminances, 1.0..=21.0. The one formula; everything else
/// here is a way of getting the two numbers to hand it.
pub fn contrast_between(a: f32, b: f32) -> f32 {
    let (hi, lo) = if a >= b { (a, b) } else { (b, a) };
    (hi + 0.05) / (lo + 0.05)
}

/// WCAG contrast ratio between two colours, 1.0..=21.0.
pub fn contrast_ratio(a: &str, b: &str) -> Option<f32> {
    Some(contrast_between(
        relative_luminance(a)?,
        relative_luminance(b)?,
    ))
}

/// CIE L\*a\*b\* under D65.
fn lab(color: &str) -> Option<[f32; 3]> {
    let [r, g, b] = parse_hex(color)?;
    let (r, g, b) = (to_linear(r), to_linear(g), to_linear(b));
    let x = (0.412_456_4 * r + 0.357_576_1 * g + 0.180_437_5 * b) / 0.950_47;
    let y = 0.212_672_9 * r + 0.715_152_2 * g + 0.072_175_0 * b;
    let z = (0.019_333_9 * r + 0.119_192 * g + 0.950_304_1 * b) / 1.088_83;
    let f = |t: f32| {
        const D: f32 = 6.0 / 29.0;
        if t > D * D * D {
            t.cbrt()
        } else {
            t / (3.0 * D * D) + 4.0 / 29.0
        }
    };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    Some([116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)])
}

/// Chroma C\*ab — how far from grey a colour is.
pub fn chroma(color: &str) -> Option<f32> {
    let [_, a, b] = lab(color)?;
    Some(a.hypot(b))
}

/// CIE76 colour difference: plain Euclidean distance in L\*a\*b\*. Coarse, but it is the metric
/// in which "40 apart" is the conventional reading of *clearly a different colour*.
pub fn delta_e_76(a: &str, b: &str) -> Option<f32> {
    let (p, q) = (lab(a)?, lab(b)?);
    Some(
        ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2))
            .max(0.0)
            .sqrt(),
    )
}

/// CIEDE2000 colour difference. The perceptually uniform one: ~1 is the just-noticeable
/// difference, ~10 already reads as a different colour.
pub fn delta_e_2000(a: &str, b: &str) -> Option<f32> {
    let (p, q) = (lab(a)?, lab(b)?);
    let (l1, a1, b1) = (p[0], p[1], p[2]);
    let (l2, a2, b2) = (q[0], q[1], q[2]);

    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let c_bar = (c1 + c2) / 2.0;
    let c_bar7 = c_bar.powi(7);
    let g = 0.5 * (1.0 - (c_bar7 / (c_bar7 + 25f32.powi(7))).sqrt());
    let (a1p, a2p) = ((1.0 + g) * a1, (1.0 + g) * a2);
    let c1p = a1p.hypot(b1);
    let c2p = a2p.hypot(b2);

    let hue = |a: f32, b: f32| {
        if a == 0.0 && b == 0.0 {
            0.0
        } else {
            b.atan2(a).to_degrees().rem_euclid(360.0)
        }
    };
    let h1p = hue(a1p, b1);
    let h2p = hue(a2p, b2);

    let dlp = l2 - l1;
    let dcp = c2p - c1p;
    let dhp = if c1p * c2p == 0.0 {
        0.0
    } else {
        let d = h2p - h1p;
        if d > 180.0 {
            d - 360.0
        } else if d < -180.0 {
            d + 360.0
        } else {
            d
        }
    };
    let dbig_hp = 2.0 * (c1p * c2p).sqrt() * (dhp.to_radians() / 2.0).sin();

    let lbp = (l1 + l2) / 2.0;
    let cbp = (c1p + c2p) / 2.0;
    let hbp = if c1p * c2p == 0.0 {
        h1p + h2p
    } else {
        let sum = h1p + h2p;
        if (h1p - h2p).abs() > 180.0 {
            if sum < 360.0 {
                (sum + 360.0) / 2.0
            } else {
                (sum - 360.0) / 2.0
            }
        } else {
            sum / 2.0
        }
    };

    let t = 1.0 - 0.17 * (hbp - 30.0).to_radians().cos()
        + 0.24 * (2.0 * hbp).to_radians().cos()
        + 0.32 * (3.0 * hbp + 6.0).to_radians().cos()
        - 0.20 * (4.0 * hbp - 63.0).to_radians().cos();
    let dtheta = 30.0 * (-(((hbp - 275.0) / 25.0).powi(2))).exp();
    let cbp7 = cbp.powi(7);
    let rc = 2.0 * (cbp7 / (cbp7 + 25f32.powi(7))).sqrt();
    let sl = 1.0 + (0.015 * (lbp - 50.0).powi(2)) / (20.0 + (lbp - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * cbp;
    let sh = 1.0 + 0.015 * cbp * t;
    let rt = -(2.0 * dtheta).to_radians().sin() * rc;

    let (kl, kc, kh) = (1.0f32, 1.0f32, 1.0f32);
    let term_l = dlp / (kl * sl);
    let term_c = dcp / (kc * sc);
    let term_h = dbig_hp / (kh * sh);
    Some(
        (term_l * term_l + term_c * term_c + term_h * term_h + rt * term_c * term_h)
            .max(0.0)
            .sqrt(),
    )
}

// ------------------------------------------------------------- the built-ins

#[allow(clippy::too_many_arguments)]
fn kit(
    id: &str,
    name: &str,
    note: &str,
    display: (&str, u16),
    body: (&str, u16),
    mono: (&str, u16),
    voice: Voice,
    palette: [&str; 6],
    plan: FramingPlan,
    margin: f32,
    hero: f32,
    low: f32,
) -> StyleKit {
    let faces = TypeRoles {
        display: TypeFace::new(display.0, display.1),
        body: TypeFace::new(body.0, body.1),
        mono: TypeFace::new(mono.0, mono.1),
    };
    let ramp = build_ramp(voice, &faces);
    StyleKit {
        id: id.to_string(),
        name: name.to_string(),
        note: note.to_string(),
        faces,
        ramp,
        palette: Palette {
            bg: palette[0].to_string(),
            surface: palette[1].to_string(),
            ink: palette[2].to_string(),
            dim: palette[3].to_string(),
            accent: palette[4].to_string(),
            accent2: palette[5].to_string(),
        },
        framings: plan.framings(margin, hero, low),
    }
}

/// The kits bay ships with.
///
/// Twelve, on purpose. Three is a rotation an agent memorises; twelve with five excluded by
/// history is a space it has to look at. Every palette's contrast ladder and every kit's cap
/// ratio are asserted in this module's tests, and every `(family, weight)` is asserted against
/// the real font database in `bay-mcp/tests/style_kits.rs` — a kit naming a family that is not
/// installed renders in a substitute face that looks almost right, which is the worst kind of
/// bug because it survives every automated check.
pub fn builtin_kits() -> &'static [StyleKit] {
    static KITS: OnceLock<Vec<StyleKit>> = OnceLock::new();
    KITS.get_or_init(|| {
        vec![
            kit(
                "editorial-data",
                "Editorial data",
                "A printed argument set against a digital instrument: a sturdy transitional \
                 serif over a geometric sans. For explainers, data essays and anything whose \
                 point is a number in a sentence.",
                ("Charter", 900),
                ("Avenir Next", 400),
                ("DIN Alternate", 700),
                Voice::House,
                [
                    "#0A0E18", "#37435E", "#F1EFE9", "#858B9B", "#E4A11B", "#5B8DEF",
                ],
                FramingPlan::Editorial,
                0.09,
                0.40,
                0.68,
            ),
            kit(
                "technical-brief",
                "Technical brief",
                "Measured and engineered against spoken and human: an engineering grotesque \
                 over a plain text sans. For process, tooling, benchmarks and how-it-works.",
                ("DIN Alternate", 700),
                ("PT Sans", 400),
                ("PT Mono", 400),
                Voice::House,
                [
                    "#0B0F0D", "#34473F", "#E9EFE9", "#7C8B83", "#22B573", "#E06C2A",
                ],
                FramingPlan::Grid,
                0.10,
                0.42,
                0.70,
            ),
            kit(
                "field-notes",
                "Field notes",
                "Archival against reportorial: a slab typewriter over a humanist English sans. \
                 For first-person accounts, histories and anything that wants to read as \
                 primary source.",
                ("American Typewriter", 700),
                ("Gill Sans", 400),
                ("Courier New", 400),
                Voice::Quiet,
                [
                    "#15110D", "#514234", "#F0E6D8", "#9A8B76", "#C9711F", "#6E9B84",
                ],
                FramingPlan::Editorial,
                0.11,
                0.44,
                0.72,
            ),
            kit(
                "midcentury",
                "Mid-century",
                "Machine-drawn against hand-carved: a pure geometric display face over a sans \
                 with serif modulation. For product, design, craft and anything luxurious.",
                ("Futura", 700),
                ("Optima", 400),
                ("PT Mono", 400),
                Voice::House,
                [
                    "#12100E", "#4E4234", "#F4EDE0", "#93877A", "#C8A227", "#A8492C",
                ],
                FramingPlan::Centred,
                0.12,
                0.43,
                0.71,
            ),
            kit(
                "stadium",
                "Stadium",
                "Shouted against stated: a Clarendon slab at poster scale over a neo-grotesque. \
                 For sport, retail, launches and anything with a scoreline.",
                ("Rockwell", 700),
                ("Helvetica Neue", 400),
                ("Menlo", 700),
                Voice::Loud,
                [
                    "#101014", "#43415A", "#FFFFFF", "#8A8A9B", "#EE4436", "#F0B429",
                ],
                FramingPlan::Editorial,
                0.08,
                0.38,
                0.66,
            ),
            kit(
                "terminal",
                "Terminal",
                "Amber phosphor: the one place a monospace face is a decision rather than a \
                 tell. For software, security, logs and anything whose subject actually is a \
                 machine.",
                ("PT Mono", 700),
                ("Helvetica Neue", 400),
                ("Menlo", 400),
                Voice::House,
                [
                    "#0C0A06", "#4B4028", "#FFC233", "#8D8677", "#4ADE80", "#FF6B5A",
                ],
                FramingPlan::Grid,
                0.08,
                0.41,
                0.69,
            ),
            kit(
                "cinematic",
                "Cinematic",
                "Filmic, wide and patient: a didone display over a calm geometric sans, on a \
                 cold teal ground. For documentary openers, portraits and slow reveals.",
                ("Didot", 700),
                ("Avenir Next", 400),
                ("Andale Mono", 400),
                Voice::Quiet,
                [
                    "#0B1214", "#2F484D", "#F2E9DE", "#849599", "#E07A3F", "#4FB3AD",
                ],
                FramingPlan::Centred,
                0.13,
                0.45,
                0.73,
            ),
            kit(
                "broadcast",
                "Broadcast",
                "Authoritative, urgent, institutional: a black grotesque in bands on a news \
                 navy. For bulletins, results, rankings and anything with a running order.",
                ("Arial Black", 900),
                ("Helvetica Neue", 400),
                ("Andale Mono", 400),
                Voice::Loud,
                [
                    "#0A1A2F", "#284A78", "#FFFFFF", "#92A6BB", "#F0B429", "#E24B3C",
                ],
                FramingPlan::Broadcast,
                0.07,
                0.39,
                0.67,
            ),
            kit(
                "formal-notice",
                "Formal notice",
                "Engraved against set: a copperplate cap over a high-contrast book serif, on \
                 cream. For statements, invitations, obituaries and anything that must be \
                 believed.",
                ("Copperplate", 700),
                ("Baskerville", 400),
                ("Courier New", 400),
                Voice::Quiet,
                [
                    "#F5F1E8", "#C3B9A6", "#171310", "#6C6559", "#8A2B1C", "#2C4A6E",
                ],
                FramingPlan::Centred,
                0.14,
                0.42,
                0.74,
            ),
            kit(
                "swiss",
                "Swiss",
                "Objective and systematic, with no persuasion in it: one neo-grotesque held \
                 tight on a strict grid over paper. For institutional, financial and \
                 editorial data.",
                ("Helvetica Neue", 700),
                ("PT Serif", 400),
                ("Menlo", 400),
                Voice::Quiet,
                [
                    "#F2F1ED", "#ABAFB4", "#111111", "#6E6E68", "#C42A18", "#1A4FD6",
                ],
                FramingPlan::Grid,
                0.09,
                0.40,
                0.70,
            ),
            kit(
                "riso",
                "Risograph",
                "Handmade and cheap on purpose: two flat spot inks on stock, the way a zine is \
                 printed. For culture, music, community and anything anti-corporate.",
                ("Futura", 700),
                ("PT Sans", 400),
                ("Monaco", 400),
                Voice::Loud,
                [
                    "#F1ECE0", "#BFB4A0", "#1B1B1B", "#5E5A52", "#C2361F", "#0F5BC5",
                ],
                FramingPlan::Grid,
                0.10,
                0.43,
                0.72,
            ),
            kit(
                "brutalist",
                "Brutalist",
                "Blunt, anti-designed and a bit funny: a huge grotesque over a default book \
                 serif with a link-blue accent. For opinion, criticism and manifestos.",
                ("Helvetica Neue", 700),
                ("Times New Roman", 400),
                ("Courier New", 400),
                Voice::Loud,
                [
                    "#E9E7E2", "#ABA6A6", "#000000", "#5A5A5A", "#0000EE", "#D62200",
                ],
                FramingPlan::Grid,
                0.06,
                0.37,
                0.65,
            ),
        ]
    })
    .as_slice()
}

/// A built-in kit by id.
pub fn builtin_kit(id: &str) -> Option<&'static StyleKit> {
    builtin_kits()
        .iter()
        .find(|kit| kit.id.eq_ignore_ascii_case(id))
}

/// Every built-in kit id, for an error message that says what there is.
pub fn builtin_kit_ids() -> Vec<&'static str> {
    builtin_kits().iter().map(|kit| kit.id.as_str()).collect()
}

// ------------------------------------------------------------------- picking

/// How many kits an offer puts in front of the caller. Three is a choice; twelve is a catalogue
/// nobody reads, and one is a default.
pub const OFFER_SIZE: usize = 3;
/// How many recently-committed kits an offer steps over. Five of twelve — enough that the same
/// brief a week later cannot land on the same kit, few enough that the pool never empties.
pub const HISTORY_EXCLUDED: usize = 5;

/// FNV-1a over the seed string. Small, stable across builds and platforms, and — unlike
/// `DefaultHasher` — documented not to change between Rust releases, which matters because the
/// offer has to be reproducible from the same brief on the same day.
fn seed_of(seed: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in seed.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

/// Three kits to choose between, seeded by the brief and the date and stepping over whatever was
/// used recently.
///
/// The date is in the seed on purpose: the same brief run twice a week apart must draw a
/// different set, or "the house palette" reappears by another name. `exclude` is the recent
/// history; when it would leave too few kits to offer from, it is ignored rather than allowed to
/// empty the pool.
pub fn offer<'a>(brief: &str, date: &str, exclude: &[String]) -> Vec<&'a StyleKit> {
    let kits = builtin_kits();
    let excluded: Vec<String> = exclude.iter().map(|id| id.to_lowercase()).collect();
    let mut pool: Vec<&StyleKit> = kits
        .iter()
        .filter(|kit| !excluded.contains(&kit.id.to_lowercase()))
        .collect();
    if pool.len() < OFFER_SIZE {
        pool = kits.iter().collect();
    }

    // A deterministic walk over the pool rather than a shuffle: stepping by a stride coprime
    // with the pool size visits every entry exactly once, so the offer is three *distinct* kits
    // without needing a shuffle whose behaviour depends on the standard library.
    let mut state = seed_of(&format!("{brief}|{date}"));
    let len = pool.len();
    let mut stride = (state % (len as u64 - 1)) + 1;
    while gcd(stride, len as u64) != 1 {
        stride += 1;
        if stride >= len as u64 {
            stride = 1;
        }
    }
    state = state
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1);
    let start = (state % len as u64) as usize;

    (0..OFFER_SIZE.min(len))
        .map(|index| pool[(start + index * stride as usize) % len])
        .collect()
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// Today's date as `YYYY-MM-DD` (UTC), for the offer seed.
pub fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    format!("{year:04}-{month:02}-{day:02}")
}

/// Days since the Unix epoch to a civil date. Howard Hinnant's `civil_from_days`, which is exact
/// for the proleptic Gregorian calendar and needs no dependency.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ------------------------------------------------------------------- history

/// The file name the picker's history lives in, inside bay's own data directory.
pub const HISTORY_FILE: &str = "style-history.json";

/// What has been committed lately, so the next offer can step over it.
///
/// **Engine-owned.** There is no tool argument that reaches this file and no way to ask for a
/// kit the history excludes without naming it outright — a history a caller can clear is a
/// history that gets cleared.
#[derive(Debug, Clone)]
pub struct StyleHistory {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    #[serde(default)]
    picked: Vec<HistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    kit: String,
    #[serde(default)]
    at: String,
}

impl StyleHistory {
    /// The history at an explicit path. Tests use this; nothing else should.
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// The user's own history, in bay's data directory. `None` where there is no home directory
    /// to put it in — a missing history is not an error, it just means nothing is excluded.
    pub fn open_default() -> Option<Self> {
        bay_paths::data_dir().map(|dir| Self::at(dir.join(HISTORY_FILE)))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read(&self) -> HistoryFile {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(HistoryFile { picked: Vec::new() })
    }

    /// The last `count` kit ids committed, most recent first.
    pub fn recent(&self, count: usize) -> Vec<String> {
        let file = self.read();
        file.picked
            .iter()
            .rev()
            .map(|entry| entry.kit.clone())
            .take(count)
            .collect()
    }

    /// Record that `id` was committed. Best-effort: a history that cannot be written must not
    /// stop a project being created.
    pub fn record(&self, id: &str, date: &str) {
        let mut file = self.read();
        file.picked.push(HistoryEntry {
            kit: id.to_string(),
            at: date.to_string(),
        });
        // Keep the tail bounded — this file is a memory of the last few choices, not a log.
        let len = file.picked.len();
        if len > 64 {
            file.picked.drain(0..len - 64);
        }
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&file) {
            let _ = std::fs::write(&self.path, text);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every built-in resolves against a font set that has everything, so this test is about the
    /// *rules* rather than the machine. The families are checked for real in
    /// `bay-mcp/tests/style_kits.rs`.
    #[test]
    fn every_builtin_kit_validates() {
        for kit in builtin_kits() {
            if let Err(problems) = kit.validate(|_, _| true) {
                panic!("{} is not a valid kit: {problems:#?}", kit.id);
            }
        }
    }

    #[test]
    fn there_are_at_least_twelve_kits_and_their_ids_are_unique() {
        let kits = builtin_kits();
        assert!(kits.len() >= 12, "got {}", kits.len());
        let mut ids: Vec<&str> = kits.iter().map(|kit| kit.id.as_str()).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "two kits share an id");
    }

    /// The one number that says a kit has a hierarchy at all.
    #[test]
    fn every_kit_has_a_hero_four_times_the_body() {
        for kit in builtin_kits() {
            let ratio = kit.cap_ratio();
            assert!(
                ratio >= MIN_CAP_RATIO,
                "{} hero/body cap ratio is {ratio:.2}",
                kit.id
            );
        }
    }

    /// The palette's roles have to sit on different rungs of the contrast ladder, and the ladder
    /// has to span far enough to be one. `#191922` on `#0E0E12` at 1.10:1 over 34 % of the
    /// canvas is what this exists to make unrepresentable.
    #[test]
    fn every_palette_is_a_measured_ladder() {
        for kit in builtin_kits() {
            let p = &kit.palette;
            let cr = |c: &str| contrast_ratio(c, &p.bg).expect("a parseable colour");
            assert!(cr(&p.ink) >= 12.0, "{} ink is {:.2}:1", kit.id, cr(&p.ink));
            assert!(
                (4.0..=7.5).contains(&cr(&p.dim)),
                "{} dim is {:.2}:1",
                kit.id,
                cr(&p.dim)
            );
            assert!(
                cr(&p.accent) >= 4.5,
                "{} accent is {:.2}:1",
                kit.id,
                cr(&p.accent)
            );
            assert!(
                cr(&p.accent2) >= 3.0,
                "{} accent2 is {:.2}:1",
                kit.id,
                cr(&p.accent2)
            );
            assert!(
                (1.6..=3.2).contains(&cr(&p.surface)),
                "{} surface is {:.2}:1 — below 1.6 it is a dead plate, above 3.2 it is content",
                kit.id,
                cr(&p.surface)
            );
        }
    }

    /// The accent must not be another shade of the ink, and the second series must not be
    /// another shade of the accent.
    #[test]
    fn accents_are_separated_from_the_ink_and_from_each_other() {
        for kit in builtin_kits() {
            let p = &kit.palette;
            let d00 = delta_e_2000(&p.accent, &p.ink).unwrap();
            let d76 = delta_e_76(&p.accent, &p.ink).unwrap();
            assert!(
                d00 >= MIN_ACCENT_DELTA_E00 && d76 >= MIN_ACCENT_DELTA_E76,
                "{}: accent {} vs ink {} is ΔE00 {d00:.1} / ΔE76 {d76:.1}",
                kit.id,
                p.accent,
                p.ink
            );
            let between = delta_e_2000(&p.accent2, &p.accent).unwrap();
            assert!(
                between >= 20.0,
                "{}: accent2 {} is only ΔE00 {between:.1} from the accent",
                kit.id,
                p.accent2
            );
            assert!(
                chroma(&p.accent).unwrap() >= 30.0,
                "{}: the accent is barely a colour",
                kit.id
            );
        }
    }

    /// Twelve kits that all put the hero in the same place are one kit.
    #[test]
    fn kits_do_not_share_a_framing_geometry() {
        let mut seen: Vec<(String, String)> = Vec::new();
        for kit in builtin_kits() {
            let shape = kit
                .framings
                .iter()
                .map(|f| format!("{}:{:.3},{:.3}", f.name, f.x, f.y))
                .collect::<Vec<_>>()
                .join("|");
            assert!(
                !seen.iter().any(|(_, other)| *other == shape),
                "{} has the same framings as {}",
                kit.id,
                seen.iter()
                    .find(|(_, other)| *other == shape)
                    .map(|(id, _)| id.as_str())
                    .unwrap_or("")
            );
            seen.push((kit.id.clone(), shape));
        }
    }

    #[test]
    fn every_kit_declares_a_bottom_weighted_framing() {
        for kit in builtin_kits() {
            assert!(
                kit.framings.iter().any(|f| f.is_bottom_weighted()),
                "{} puts nothing below y = {BOTTOM_WEIGHTED_Y}",
                kit.id
            );
            assert!(kit.framings.len() >= MIN_FRAMINGS, "{}", kit.id);
        }
    }

    /// The ramp is normalised on cap height, so two kits set in different faces carry different
    /// `fontSize` numbers for the same role. If they did not, the kit would be a rename.
    #[test]
    fn the_ramp_is_normalised_per_family_not_copied() {
        // Same voice, different display faces: 0.71 cap against 0.53 cap.
        let swiss = builtin_kit("swiss").unwrap();
        let copper = builtin_kit("formal-notice").unwrap();
        assert!(
            (swiss.ramp.hook.size - copper.ramp.hook.size).abs() > 40.0,
            "a 0.71-cap face and a 0.53-cap face cannot want the same fontSize: {} vs {}",
            swiss.ramp.hook.size,
            copper.ramp.hook.size
        );
        // …and the cap heights they land on are the same rung of the ladder.
        for kit in [swiss, copper] {
            let cap = kit.ramp.hook.size * kit.faces.display.cap_per_em() * 1920.0 / 1080.0;
            assert!(
                (cap - 190.0).abs() < 2.0,
                "{} hero cap landed at {cap:.1}",
                kit.id
            );
        }
        let charter = builtin_kit("editorial-data").unwrap();
        let cap = charter.ramp.hook.size * charter.faces.display.cap_per_em() * 1920.0 / 1080.0;
        assert!((cap - 217.0).abs() < 2.0, "hero cap landed at {cap:.1}");
    }

    #[test]
    fn a_kit_missing_a_family_is_refused() {
        let kit = builtin_kit("swiss").unwrap().clone();
        let problems = kit
            .validate(|family, _| family != "Menlo")
            .expect_err("a kit naming an absent family is a bug");
        assert!(
            problems.iter().any(|p| p.contains("Menlo")),
            "{problems:#?}"
        );
    }

    #[test]
    fn a_kit_whose_weight_does_not_resolve_is_refused() {
        let kit = builtin_kit("editorial-data").unwrap().clone();
        // Charter has a Black; pretend this machine's copy does not.
        let problems = kit
            .validate(|_, weight| weight != 900)
            .expect_err("a weight that drops the family is a bug");
        assert!(problems.iter().any(|p| p.contains("900")), "{problems:#?}");
    }

    #[test]
    fn a_flat_ladder_is_refused() {
        let mut kit = builtin_kit("swiss").unwrap().clone();
        kit.ramp.hook.size = kit.ramp.label.size;
        let problems = kit
            .validate(|_, _| true)
            .expect_err("a flat ladder is flat");
        assert!(
            problems.iter().any(|p| p.contains("cap ratio")),
            "{problems:#?}"
        );
    }

    #[test]
    fn a_grey_accent_is_refused() {
        let mut kit = builtin_kit("swiss").unwrap().clone();
        kit.palette.accent = "#2A2A2A".into();
        let problems = kit
            .validate(|_, _| true)
            .expect_err("a grey is not an accent");
        assert!(
            problems.iter().any(|p| p.contains("accent")),
            "{problems:#?}"
        );
    }

    #[test]
    fn a_kit_with_nothing_at_the_bottom_is_refused() {
        let mut kit = builtin_kit("swiss").unwrap().clone();
        kit.framings.retain(|f| !f.is_bottom_weighted());
        let problems = kit
            .validate(|_, _| true)
            .expect_err("nothing below 0.6 is the failure this comes from");
        assert!(
            problems.iter().any(|p| p.contains("bottom-weighted")),
            "{problems:#?}"
        );
    }

    /// Known-good ΔE00 values, so a refactor of the colour maths cannot quietly change what the
    /// gate means. Reference values computed independently against the CIEDE2000 definition.
    #[test]
    fn the_colour_difference_matches_known_values() {
        let cases = [
            ("#EDECE6", "#FFC940", 26.5),
            ("#EDECE6", "#FF5B5B", 36.9),
            ("#111111", "#D6301F", 42.6),
            ("#000000", "#0000EE", 38.3),
        ];
        for (a, b, expected) in cases {
            let got = delta_e_2000(a, b).unwrap();
            assert!(
                (got - expected).abs() < 0.3,
                "ΔE00({a},{b}) = {got:.2}, expected {expected}"
            );
        }
        assert!((delta_e_2000("#123456", "#123456").unwrap()).abs() < 1e-4);
        assert_eq!(delta_e_2000("not a colour", "#000000"), None);
    }

    #[test]
    fn contrast_matches_the_published_numbers() {
        let cr = contrast_ratio("#EDECE6", "#0E0E12").unwrap();
        assert!((cr - 16.27).abs() < 0.05, "{cr}");
        assert!((contrast_ratio("#FFFFFF", "#000000").unwrap() - 21.0).abs() < 0.01);
    }

    #[test]
    fn hex_parsing_refuses_what_it_cannot_read() {
        assert_eq!(parse_hex("#ff8800"), Some([0xFF, 0x88, 0x00]));
        assert_eq!(parse_hex("#f80"), Some([0xFF, 0x88, 0x00]));
        assert_eq!(parse_hex("ff8800"), None);
        assert_eq!(parse_hex("#ff88"), None);
        assert_eq!(parse_hex("#gg8800"), None);
    }

    /// The same brief on two days must not draw the same three kits, or "the house kit" comes
    /// back under another name.
    #[test]
    fn the_offer_moves_with_the_date_and_the_brief() {
        let monday = offer("a reel about candlestick charts", "2026-08-12", &[]);
        let again = offer("a reel about candlestick charts", "2026-08-12", &[]);
        let next_week = offer("a reel about candlestick charts", "2026-08-19", &[]);
        let other = offer("a reel about sourdough", "2026-08-12", &[]);

        let ids = |kits: &[&StyleKit]| {
            kits.iter()
                .map(|kit| kit.id.clone())
                .collect::<Vec<String>>()
        };
        assert_eq!(ids(&monday), ids(&again), "the same seed must be the same");
        assert_ne!(ids(&monday), ids(&next_week));
        assert_ne!(ids(&monday), ids(&other));
        assert_eq!(monday.len(), OFFER_SIZE);
    }

    #[test]
    fn an_offer_is_three_distinct_kits_and_skips_the_recent_ones() {
        let recent: Vec<String> = builtin_kits()
            .iter()
            .take(HISTORY_EXCLUDED)
            .map(|kit| kit.id.clone())
            .collect();
        for day in 1..=28 {
            let date = format!("2026-09-{day:02}");
            let offered = offer("anything at all", &date, &recent);
            assert_eq!(offered.len(), OFFER_SIZE);
            let mut ids: Vec<&str> = offered.iter().map(|kit| kit.id.as_str()).collect();
            ids.sort_unstable();
            let count = ids.len();
            ids.dedup();
            assert_eq!(ids.len(), count, "{date} offered the same kit twice");
            for kit in &offered {
                assert!(!recent.contains(&kit.id), "{date} offered a recent kit");
            }
        }
    }

    /// Excluding more kits than exist must not empty the pool — an agent that cannot be offered
    /// anything cannot make a video.
    #[test]
    fn a_full_history_still_offers_something() {
        let everything: Vec<String> = builtin_kit_ids().iter().map(|id| id.to_string()).collect();
        let offered = offer("brief", "2026-08-12", &everything);
        assert_eq!(offered.len(), OFFER_SIZE);
    }

    #[test]
    fn the_history_remembers_in_order_and_survives_a_missing_file() {
        let dir = std::env::temp_dir().join(format!(
            "bay-style-history-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let history = StyleHistory::at(dir.join(HISTORY_FILE));
        assert!(
            history.recent(5).is_empty(),
            "a missing file excludes nothing"
        );

        history.record("swiss", "2026-08-12");
        history.record("terminal", "2026-08-13");
        assert_eq!(history.recent(5), vec!["terminal", "swiss"]);
        assert_eq!(history.recent(1), vec!["terminal"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_date_helper_matches_the_calendar() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_000), (2022, 1, 8));
        assert_eq!(civil_from_days(20_677), (2026, 8, 12));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(today().len(), 10);
    }

    #[test]
    fn a_tone_is_named_the_same_way_coming_and_going() {
        for tone in Tone::ALL {
            assert_eq!(Tone::from_wire(tone.as_str()), Some(tone));
        }
        assert_eq!(Tone::from_wire("magenta"), None);
    }
}
