//! The move registry: bay's motion vocabulary, as data rather than as prose.
//!
//! **Why this exists.** In the project that prompted it, 90 % of animated channels were
//! `opacity`, 76 moves lasted 0.098 s — three frames, which is over before the eye can arrive —
//! `hold` was used 130 times (121 of them on segments where nothing changed), and `spring-out`,
//! called "the house entrance" in five separate documents, was used 4 times in 188 elements.
//!
//! Every one of those numbers is what a *document* produced. A document with free parameters is
//! read as a set of defaults and copied; the durations, curves and amplitudes it names are typed
//! back in by hand, wrongly. So they stop being prose and become entries here: a move carries its
//! own channels, key values, curves and duration, and an author names the move.
//!
//! Three invariants, asserted by the tests next to this module rather than asked for in a
//! document:
//!
//! 1. **Opacity may ride; it may never lead.** Every move's [`Move::lead`] is a geometric
//!    channel — position, scale or rotation. Opacity is a scalar at a fixed retinal location:
//!    it drives the transient channel and not the motion pathway, so it says "something changed
//!    here" and never "something moved from A to B".
//! 2. **The lead clears its own amplitude floor** ([`amplitude_floor`]). A distribution over
//!    channels is worthless without this — "add a 4 px nudge to everything" satisfies any
//!    channel-share rule and is invisible.
//! 3. **The lead delivers at least [`MIN_CORE_FRAMES`] core frames** at the reference frame
//!    rate. *Core* frames, not nominal ones: an `expo-out` spends 68 % of its duration in a tail
//!    the eye cannot resolve, so a 10-frame `expo-out` is a cut with a decorative afterglow no
//!    matter what number was typed into the tool. [`core_span`] is the constant that converts
//!    one to the other, and it is derived by sampling [`Easing::apply`] — see the test. **It is
//!    not an agent-facing number.** Nothing on the tool surface takes a core-frame count; the
//!    registry is where the arithmetic already happened.
//!
//! Raw keyframes remain reachable — an escape hatch that is refused is an escape hatch that gets
//! worked around — but they are *named*: [`off_vocabulary`] reports every channel no registry
//! move accounts for, per channel, with the element id, so the cost of evasion scales with the
//! evasion.

use std::collections::BTreeMap;

use bay_time::{MediaTime, TICKS_PER_SECOND};
use serde::Serialize;

use crate::element::{AnimationChannel, Easing, Element, Keyframe};
use crate::scene::Scene;

/// The frame rate the registry's frame counts are quoted at.
///
/// A move's duration is a fact about human vision — 200 ms is 200 ms — so frames are converted
/// to *seconds* here and the move lasts the same wall-clock time in a 24, 30 or 60 fps project.
/// What changes with the project's frame rate is how many frames the eye is given, which is what
/// [`Move::core_frames`] reports.
pub const REFERENCE_FPS: f32 = 30.0;

/// The floor every registry move's lead channel clears at [`REFERENCE_FPS`].
///
/// A move under four core frames is received as a before-state and an after-state with nothing
/// in between — the definition of a cut, wearing the costume of an animation.
pub const MIN_CORE_FRAMES: f32 = 4.0;

// --------------------------------------------------------------------------- core span

/// The fraction of a curve's duration in which the visible motion actually happens: the span
/// between 10 % and 90 % of the travel. The rest is a tail below the eye's resolution.
///
/// Derived by sampling [`Easing::apply`] — the test `the_core_span_table_is_what_the_curves_do`
/// re-derives every row and fails if the table and the code disagree. Written out as a constant
/// rather than computed on the fly so it can be read: the ratio between `linear` (0.80) and
/// `back-out` (0.27) is the reason two moves with the same `duration` are different animals.
pub const CORE_SPANS: [(Easing, f32); 14] = [
    (Easing::Linear, 0.800),
    (Easing::EaseOut, 0.632),
    (Easing::EaseIn, 0.632),
    (Easing::SineInOut, 0.590),
    (Easing::EaseInOut, 0.553),
    (Easing::PowerOut, 0.501),
    (Easing::PowerIn, 0.501),
    (Easing::SpringOut, 0.416),
    (Easing::Power4Out, 0.412),
    (Easing::Power4In, 0.412),
    (Easing::ExpoOut, 0.317),
    (Easing::ExpoIn, 0.317),
    (Easing::BackOut, 0.274),
    // Not a curve. A cut has no span, which is exactly why it is legal at zero frames and a
    // three-frame ramp is not.
    (Easing::Hold, 0.0),
];

/// How much of a segment on `easing` the viewer can actually see, as a fraction of its duration.
pub fn core_span(easing: Easing) -> f32 {
    CORE_SPANS
        .iter()
        .find(|(candidate, _)| *candidate == easing)
        .map(|(_, span)| *span)
        .unwrap_or(0.0)
}

/// Sample `easing` to find where it has covered 10 % and 90 % of its travel, and return the
/// span between them. This is how [`CORE_SPANS`] was produced; the test calls it.
pub fn sampled_core_span(easing: Easing) -> f32 {
    if easing == Easing::Hold {
        return 0.0;
    }
    const STEPS: usize = 20_000;
    let mut low = None;
    let mut high = None;
    for step in 0..=STEPS {
        let t = step as f32 / STEPS as f32;
        let v = easing.apply(t);
        if low.is_none() && v >= 0.1 {
            low = Some(t);
        }
        if high.is_none() && v >= 0.9 {
            high = Some(t);
            break;
        }
    }
    match (low, high) {
        (Some(low), Some(high)) => high - low,
        _ => 0.0,
    }
}

// --------------------------------------------------------------------------- direction

/// Which way a move travels.
///
/// Uniformly the direction of **travel of the lead channel**, not "where it came from" — an
/// entrance that starts 60 px below its mark and rises is `Up`, and so is the incumbent stack
/// that shifts up to make room. Two conventions in one word is how "sweep in from the right" and
/// "sweep to the right" come to mean the same call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
    /// Toward the viewer — a scale that grows.
    In,
    /// Away from the viewer — a scale that shrinks.
    Out,
    /// Clockwise.
    Cw,
    /// Counter-clockwise.
    Ccw,
}

impl Direction {
    pub const NAMES: [&'static str; 8] = ["up", "down", "left", "right", "in", "out", "cw", "ccw"];
    pub const ALL: [Direction; 8] = [
        Direction::Up,
        Direction::Down,
        Direction::Left,
        Direction::Right,
        Direction::In,
        Direction::Out,
        Direction::Cw,
        Direction::Ccw,
    ];

    pub fn as_str(self) -> &'static str {
        Self::NAMES[Self::ALL.iter().position(|d| *d == self).unwrap_or(0)]
    }

    pub fn from_wire(name: &str) -> Option<Self> {
        Self::NAMES
            .iter()
            .position(|n| *n == name)
            .map(|index| Self::ALL[index])
    }
}

// --------------------------------------------------------------------------- the shape of a move

/// What one keyframe of a registry move is worth, given the element it lands on.
///
/// Values are relative to the element rather than absolute so a move means the same thing
/// wherever the element sits: `LIFT` on a title at y = 0.31 and on a caption at y = 0.88 is the
/// same rise, not two different destinations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum KeyValue {
    /// Where the element rests — its own transform value for this channel.
    Target,
    /// The resting value plus this much, in the channel's own units (canvas fractions for `x`
    /// and `y`, degrees for `rotation`), scaled by `distance` and signed by `direction`.
    Offset(f32),
    /// A value that does not depend on the element at all. Opacity and a draw (`scaleX` 0 → 1)
    /// are the only channels where this is right.
    Absolute(f32),
    /// The resting value times this. A scale entrance on an element already at scale 0.8 must
    /// arrive at 0.8, not at 1.0.
    Factor(f32),
}

impl KeyValue {
    /// This key's value for an element resting at `rest`, with the move scaled by `distance`
    /// (signed — a negative distance is the mirrored direction).
    pub fn resolve(self, rest: f32, distance: f32) -> f32 {
        match self {
            KeyValue::Target => rest,
            KeyValue::Offset(offset) => rest + offset * distance,
            KeyValue::Absolute(value) => value,
            KeyValue::Factor(factor) => rest * (1.0 + (factor - 1.0) * distance),
        }
    }
}

/// One keyframe of a move: when, what, and the curve leaving it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MoveKey {
    /// Frames from the start of the move, at [`REFERENCE_FPS`].
    pub frame: f32,
    pub value: KeyValue,
    /// The curve for the segment *leaving* this key. `None` — which is what the last key of a
    /// move carries — travels on the channel's own easing.
    pub easing: Option<Easing>,
}

/// One animated property of a move.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MoveChannel {
    pub property: &'static str,
    /// The channel default, for any key that does not override it.
    pub easing: Easing,
    /// Whether [`Direction`] flips this channel's offsets. `ARC-IN` comes from the side *and*
    /// from below; mirroring it left-to-right must not also turn it upside down.
    pub directional: bool,
    pub keys: &'static [MoveKey],
}

impl MoveChannel {
    /// Peak-to-peak travel, in the channel's own units, at `distance` = 1.
    pub fn amplitude(&self) -> f32 {
        // Measured against a resting value of 1.0 so `Factor` channels report their real delta
        // (a scale from 0.78 travels 0.22) rather than zero.
        let values: Vec<f32> = self
            .keys
            .iter()
            .map(|k| k.value.resolve(1.0, 1.0))
            .collect();
        let max = values.iter().copied().fold(f32::MIN, f32::max);
        let min = values.iter().copied().fold(f32::MAX, f32::min);
        max - min
    }

    /// Core frames this channel delivers at `fps`, summed over its value-changing segments.
    ///
    /// Summed rather than taken from the longest segment because an out-and-back accent is
    /// *one* event to the viewer: `TAP` is 3 frames out and 6 back, and neither half on its own
    /// is a move.
    pub fn core_frames(&self, fps: f32) -> f32 {
        let mut total = 0.0;
        for pair in self.keys.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if a.value.resolve(1.0, 1.0) == b.value.resolve(1.0, 1.0) {
                continue;
            }
            let frames = (b.frame - a.frame) / REFERENCE_FPS * fps;
            total += frames * core_span(a.easing.unwrap_or(self.easing));
        }
        total
    }

    /// Seconds from the first key to the last.
    pub fn span_seconds(&self) -> f64 {
        match (self.keys.first(), self.keys.last()) {
            (Some(first), Some(last)) => f64::from((last.frame - first.frame) / REFERENCE_FPS),
            _ => 0.0,
        }
    }
}

/// What a move is *for*. Governs which amplitude floor applies, and nothing else — the kinds are
/// not a taxonomy for its own sake, they are the four different answers to "how far does this
/// have to travel before a viewer registers it".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MoveKind {
    /// An element arriving. The biggest amplitudes: the viewer's gaze is elsewhere.
    Entrance,
    /// Out-and-back, net displacement zero. Small by definition, and the only place a sub-seven
    /// frame segment is legal.
    Accent,
    /// A second element whose move is *caused by* a first — the rule that draws after the word
    /// it belongs to has settled.
    Secondary,
    /// One move across a group, staggered.
    Group,
    /// Something already on screen changing because something else happened. The `no-response`
    /// family: this is what a crossfade is used instead of.
    Response,
    /// Continuous life under a held frame. Tiny amplitudes, one direction, no oscillation.
    Ambient,
    /// An element leaving.
    Exit,
    /// One half of a cut that reads as one continuous move.
    Seam,
}

impl MoveKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MoveKind::Entrance => "entrance",
            MoveKind::Accent => "accent",
            MoveKind::Secondary => "secondary",
            MoveKind::Group => "group",
            MoveKind::Response => "response",
            MoveKind::Ambient => "ambient",
            MoveKind::Exit => "exit",
            MoveKind::Seam => "seam",
        }
    }
}

/// How a [`MoveKind::Group`] move spreads across its members.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroupTiming {
    /// Frames between successive cues, at [`REFERENCE_FPS`].
    pub stagger: f32,
    /// Multiplier on each successive gap. Below 1 the cascade accelerates across the line,
    /// which is the difference between a wave and a conveyor belt.
    pub decay: f32,
    /// Alternate the direction between neighbours — odd items one way, even the other.
    pub alternate: bool,
}

/// One named move.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Move {
    pub id: &'static str,
    pub kind: MoveKind,
    /// The geometric channel that carries the move. Never `opacity`.
    pub lead: &'static str,
    /// What it says, and when it is the wrong choice. This is the entire interface an agent
    /// gets, so the second half matters more than the first.
    pub summary: &'static str,
    /// Legal directions, the first being the one the tabled values encode.
    pub directions: &'static [Direction],
    pub channels: &'static [MoveChannel],
    pub group: Option<GroupTiming>,
}

impl Move {
    pub fn channel(&self, property: &str) -> Option<&'static MoveChannel> {
        self.channels.iter().find(|c| c.property == property)
    }

    pub fn lead_channel(&self) -> &'static MoveChannel {
        self.channel(self.lead)
            .expect("every move's lead is one of its own channels")
    }

    /// Core frames the lead channel delivers at `fps`.
    pub fn core_frames(&self, fps: f32) -> f32 {
        self.lead_channel().core_frames(fps)
    }

    /// How long the move runs, in seconds — the widest of its channels.
    pub fn duration_seconds(&self) -> f64 {
        self.channels
            .iter()
            .map(MoveChannel::span_seconds)
            .fold(0.0, f64::max)
    }

    /// The sign a direction gives this move, or an error naming what it does accept.
    pub fn sign_for(&self, direction: Option<Direction>) -> Result<f32, String> {
        let Some(direction) = direction else {
            return Ok(1.0);
        };
        match self.directions.iter().position(|d| *d == direction) {
            Some(0) => Ok(1.0),
            Some(_) => Ok(-1.0),
            None => Err(format!(
                "{:?} does not travel {:?} — it takes {}",
                self.id,
                direction.as_str(),
                self.directions
                    .iter()
                    .map(|d| d.as_str())
                    .collect::<Vec<_>>()
                    .join(" or ")
            )),
        }
    }

    /// The mirror of `direction` for this move, for a group that alternates sides. `None` for a
    /// move that only travels one way — a scale entrance run backwards is a different move, not
    /// the same one flipped.
    pub fn opposite(&self, direction: Option<Direction>) -> Option<Direction> {
        if self.directions.len() < 2 {
            return direction;
        }
        let current = direction.unwrap_or(self.directions[0]);
        let index = self.directions.iter().position(|d| *d == current)?;
        Some(self.directions[usize::from(index == 0)])
    }

    pub fn describe(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "kind": self.kind.as_str(),
            "lead": self.lead,
            "summary": self.summary,
            "durationSeconds": (self.duration_seconds() * 1000.0).round() / 1000.0,
            "channels": self.channels.iter().map(|c| c.property).collect::<Vec<_>>(),
            "directions": self.directions.iter().map(|d| d.as_str()).collect::<Vec<_>>(),
        })
    }
}

/// Look a move up by its wire id.
pub fn find(id: &str) -> Option<&'static Move> {
    MOVES.iter().find(|m| m.id == id)
}

/// Every move's id, for an error message that says what there is.
pub fn ids() -> Vec<&'static str> {
    MOVES.iter().map(|m| m.id).collect()
}

/// The amplitude a move's lead has to clear to be worth its keyframes, in the channel's own
/// units (canvas fractions, degrees, or a scale delta).
///
/// Four different numbers per channel because the viewer's gaze is in a different place in each
/// case: an entrance has to be found from across a 1080×1920 frame, an accent lands on an element
/// the eye is already on, an exit is 55–70 % of its entrance by construction, and an ambient
/// drift is deliberately at the edge of perceptibility.
pub fn amplitude_floor(kind: MoveKind, property: &str) -> f32 {
    match kind {
        // 40 px of 1920 vertical, 64 px of 1080 horizontal, a tenth of a scale, two degrees.
        MoveKind::Entrance | MoveKind::Group | MoveKind::Seam => match property {
            "y" => 0.0208,
            "x" => 0.0593,
            "scale" => 0.10,
            "rotation" => 2.0,
            "scaleX" | "scaleY" => 1.0,
            _ => 0.0,
        },
        MoveKind::Exit => match property {
            "y" => 0.0125,
            "x" => 0.0296,
            "scale" => 0.05,
            "rotation" => 2.0,
            "scaleX" | "scaleY" => 0.5,
            _ => 0.0,
        },
        MoveKind::Accent | MoveKind::Secondary => match property {
            "x" | "y" => 0.0074,
            "scale" => 0.030,
            "rotation" => 2.0,
            "scaleX" | "scaleY" => 0.05,
            _ => 0.0,
        },
        MoveKind::Response | MoveKind::Ambient => match property {
            "x" | "y" => 0.0025,
            "scale" => 0.025,
            "rotation" => 1.0,
            "scaleX" | "scaleY" => 0.5,
            _ => 0.0,
        },
    }
}

/// The channels a move may lead with. `opacity` is not one of them, at any amplitude, in any
/// kind of move — which is the single most consequential line in this file.
pub const LEAD_CHANNELS: [&str; 6] = ["x", "y", "scale", "scaleX", "scaleY", "rotation"];

// --------------------------------------------------------------------------- the registry

const fn key(frame: f32, value: KeyValue, easing: Easing) -> MoveKey {
    MoveKey {
        frame,
        value,
        easing: Some(easing),
    }
}

/// The last key of a channel: nothing leaves it, so it carries no curve.
const fn last(frame: f32, value: KeyValue) -> MoveKey {
    MoveKey {
        frame,
        value,
        easing: None,
    }
}

/// The keys of an opacity that rides under an entrance: full 0 → 1, on `linear`, finished well
/// before the geometry is. A partial fade buys frames of type below the contrast threshold and
/// nothing else.
const fn ride(frames: f32) -> [MoveKey; 2] {
    [
        key(0.0, KeyValue::Absolute(0.0), Easing::Linear),
        last(frames, KeyValue::Absolute(1.0)),
    ]
}

static RIDE_7: [MoveKey; 2] = ride(7.0);
static RIDE_8: [MoveKey; 2] = ride(8.0);
static RIDE_9: [MoveKey; 2] = ride(9.0);
static RIDE_10: [MoveKey; 2] = ride(10.0);

/// The opacity channel that rides under an entrance. Opacity is never the lead — it says
/// "something is present here", never "something moved from A to B" — so it is always the
/// shortest channel in the move, done before the geometry has finished arriving.
const fn rides_in(keys: &'static [MoveKey]) -> MoveChannel {
    MoveChannel {
        property: "opacity",
        easing: Easing::Linear,
        directional: false,
        keys,
    }
}

/// bay's motion vocabulary. Ported from the motion doctrine, where each entry's duration, curve
/// and amplitude were derived rather than chosen.
pub static MOVES: &[Move] = &[
    // ------------------------------------------------------------------ entrances
    Move {
        id: "lift",
        kind: MoveKind::Entrance,
        lead: "y",
        summary: "Type rises into place. The house entrance — a damped settle with no overshoot. \
                  Wrong for anything under ~24 px, where the settle is invisible, and for more \
                  than three elements in the same second, where everything acquires the same \
                  implied mass and the frame reads as jelly.",
        directions: &[Direction::Up],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::SpringOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0313), Easing::SpringOut),
                    last(24.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_9),
        ],
        group: None,
    },
    Move {
        id: "drop",
        kind: MoveKind::Entrance,
        lead: "y",
        summary: "Arrives from above. Heavier than lift — for things that land rather than \
                  things that appear.",
        directions: &[Direction::Down],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::PowerOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(-0.0375), Easing::PowerOut),
                    last(20.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_7),
        ],
        group: None,
    },
    Move {
        id: "sweep",
        kind: MoveKind::Entrance,
        lead: "x",
        summary: "Enters laterally, from off-frame or from the previous thing. Alternate the \
                  side between neighbours — a whole scene sweeping the same way is a conveyor \
                  belt.",
        directions: &[Direction::Left, Direction::Right],
        channels: &[
            MoveChannel {
                property: "x",
                easing: Easing::PowerOut,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Offset(0.1111), Easing::PowerOut),
                    last(20.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_8),
        ],
        group: None,
    },
    Move {
        id: "press",
        kind: MoveKind::Entrance,
        lead: "scale",
        summary: "Scales down TO rest from above it — arrives from in front of the viewer. \
                  Wrong for small type, which starts oversized and crops, and for anything near \
                  a frame edge.",
        directions: &[Direction::Out],
        channels: &[
            MoveChannel {
                property: "scale",
                easing: Easing::PowerOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(1.14), Easing::PowerOut),
                    last(20.0, KeyValue::Factor(1.0)),
                ],
            },
            rides_in(&RIDE_9),
        ],
        group: None,
    },
    Move {
        id: "swell",
        kind: MoveKind::Entrance,
        lead: "scale",
        summary: "Arrives from behind, with a slight rise so the path is not purely radial. For \
                  a card, a panel, a hero figure — anything with implied mass being caught.",
        directions: &[Direction::In],
        channels: &[
            MoveChannel {
                property: "scale",
                easing: Easing::SpringOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(0.78), Easing::SpringOut),
                    last(24.0, KeyValue::Factor(1.0)),
                ],
            },
            MoveChannel {
                property: "y",
                easing: Easing::PowerOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0125), Easing::PowerOut),
                    last(24.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_10),
        ],
        group: None,
    },
    Move {
        id: "arc-in",
        kind: MoveKind::Entrance,
        lead: "x",
        summary: "The only entrance that travels a curve: different easing clusters on the two \
                  axes bow the path by ~19 % of the chord, for zero extra keyframes. An element \
                  animating x and y on the SAME curve travels a perfectly straight line, which \
                  is what ruler-straight agent motion is.",
        directions: &[Direction::Left, Direction::Right],
        channels: &[
            MoveChannel {
                property: "x",
                easing: Easing::Linear,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Offset(0.1296), Easing::Linear),
                    last(20.0, KeyValue::Target),
                ],
            },
            MoveChannel {
                property: "y",
                easing: Easing::PowerOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0469), Easing::PowerOut),
                    last(20.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_8),
        ],
        group: None,
    },
    Move {
        id: "unveil",
        kind: MoveKind::Entrance,
        lead: "y",
        summary: "A wipe: the element travels under a static mask (set one with mask_set first). \
                  Opacity stays at 1 throughout — a fade over a wipe looks like neither.",
        directions: &[Direction::Up],
        channels: &[MoveChannel {
            property: "y",
            easing: Easing::ExpoOut,
            directional: false,
            keys: &[
                key(0.0, KeyValue::Offset(0.0547), Easing::ExpoOut),
                last(32.0, KeyValue::Target),
            ],
        }],
        group: None,
    },
    Move {
        id: "split",
        kind: MoveKind::Entrance,
        lead: "x",
        summary: "One half of a two-part arrival: call it on each half with opposite directions \
                  and offset the second by ~3 frames so they do not meet symmetrically.",
        directions: &[Direction::Right, Direction::Left],
        channels: &[MoveChannel {
            property: "x",
            easing: Easing::Power4Out,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Offset(-0.0889), Easing::Power4Out),
                last(24.0, KeyValue::Target),
            ],
        }],
        group: None,
    },
    Move {
        id: "coil",
        kind: MoveKind::Entrance,
        lead: "y",
        summary: "lift with anticipation: it moves AGAINST the travel for four frames first, \
                  which cues the eye before the move it is supposed to catch. One extra key.",
        directions: &[Direction::Up],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::SpringOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0313), Easing::EaseIn),
                    key(4.0, KeyValue::Offset(0.0396), Easing::SpringOut),
                    last(28.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_10),
        ],
        group: None,
    },
    Move {
        id: "wind-up",
        kind: MoveKind::Entrance,
        lead: "rotation",
        summary: "Rotational anticipation, for a badge, a stamp, a logo. At most one rotating \
                  entrance per scene — rotation is the loudest channel in the set.",
        directions: &[Direction::Cw, Direction::Ccw],
        channels: &[
            MoveChannel {
                property: "rotation",
                easing: Easing::PowerOut,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Offset(-7.0), Easing::EaseIn),
                    key(4.0, KeyValue::Offset(-11.0), Easing::PowerOut),
                    last(24.0, KeyValue::Target),
                ],
            },
            MoveChannel {
                property: "scale",
                easing: Easing::SpringOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(0.88), Easing::SpringOut),
                    last(26.0, KeyValue::Factor(1.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "land",
        kind: MoveKind::Entrance,
        lead: "y",
        summary: "Entrance with follow-through: it overshoots its mark by 5 % of the travel and \
                  settles back. Hand-keyed, so the overshoot is a choice rather than back-out's \
                  fixed and unmistakable 10 %.",
        directions: &[Direction::Up],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::PowerOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0417), Easing::PowerOut),
                    key(18.0, KeyValue::Offset(-0.0021), Easing::EaseInOut),
                    last(26.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_9),
        ],
        group: None,
    },
    // ------------------------------------------------------------------ accents
    Move {
        id: "tap",
        kind: MoveKind::Accent,
        lead: "scale",
        summary: "The landing accent — out and back, net displacement zero. Never primary, never \
                  more than one per beat.",
        directions: &[Direction::In],
        channels: &[MoveChannel {
            property: "scale",
            easing: Easing::EaseOut,
            directional: false,
            keys: &[
                key(0.0, KeyValue::Factor(1.0), Easing::EaseOut),
                key(3.0, KeyValue::Factor(1.035), Easing::EaseInOut),
                last(9.0, KeyValue::Factor(1.0)),
            ],
        }],
        group: None,
    },
    Move {
        id: "thump",
        kind: MoveKind::Accent,
        lead: "scaleY",
        summary: "Squash and stretch at a landing. Volume is preserved — a stretch in y is a \
                  squash in x — which is what makes it read as mass rather than as a wobble.",
        directions: &[Direction::In],
        channels: &[
            MoveChannel {
                property: "scaleY",
                easing: Easing::EaseOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(1.0), Easing::PowerOut),
                    key(3.0, KeyValue::Factor(1.08), Easing::EaseInOut),
                    key(7.0, KeyValue::Factor(0.96), Easing::EaseOut),
                    last(13.0, KeyValue::Factor(1.0)),
                ],
            },
            MoveChannel {
                property: "scaleX",
                easing: Easing::EaseOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(1.0), Easing::PowerOut),
                    key(3.0, KeyValue::Factor(0.95), Easing::EaseInOut),
                    key(7.0, KeyValue::Factor(1.03), Easing::EaseOut),
                    last(13.0, KeyValue::Factor(1.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "nudge",
        kind: MoveKind::Accent,
        lead: "x",
        summary: "A shake, for a negative or a contradicting beat. Out and back, net zero.",
        directions: &[Direction::Right, Direction::Left],
        channels: &[MoveChannel {
            property: "x",
            easing: Easing::EaseOut,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Target, Easing::PowerOut),
                key(3.0, KeyValue::Offset(0.0083), Easing::EaseInOut),
                key(6.0, KeyValue::Offset(-0.0046), Easing::EaseOut),
                last(8.0, KeyValue::Target),
            ],
        }],
        group: None,
    },
    Move {
        id: "tilt",
        kind: MoveKind::Accent,
        lead: "rotation",
        summary: "A hinge and back — two and a half degrees, which is as much rotation as \
                  anything containing text can take.",
        directions: &[Direction::Cw, Direction::Ccw],
        channels: &[MoveChannel {
            property: "rotation",
            easing: Easing::EaseOut,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Target, Easing::PowerOut),
                key(4.0, KeyValue::Offset(2.5), Easing::EaseInOut),
                last(10.0, KeyValue::Target),
            ],
        }],
        group: None,
    },
    // ------------------------------------------------------------------ secondary action
    Move {
        id: "underscore",
        kind: MoveKind::Secondary,
        lead: "scaleX",
        summary: "A rule that draws AFTER the word it belongs to has settled — place a thin \
                  shape with anchorX 0 and apply this at the word's settle time plus ~5 frames. \
                  Starting it earlier destroys the causality that makes it secondary action \
                  rather than a second animation.",
        directions: &[Direction::In],
        channels: &[MoveChannel {
            property: "scaleX",
            easing: Easing::ExpoOut,
            directional: false,
            keys: &[
                key(0.0, KeyValue::Absolute(0.0), Easing::Hold),
                key(5.0, KeyValue::Absolute(0.0), Easing::ExpoOut),
                last(19.0, KeyValue::Absolute(1.0)),
            ],
        }],
        group: None,
    },
    Move {
        id: "shadow-catch",
        kind: MoveKind::Secondary,
        lead: "y",
        summary: "An offset plate behind a card, running the card's move three frames late, 8 % \
                  further, on a softer curve — so it visibly lags. One extra element; the frame \
                  stops containing exactly one event.",
        directions: &[Direction::Up],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::EaseOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0450), Easing::EaseOut),
                    last(21.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_10),
        ],
        group: None,
    },
    // ------------------------------------------------------------------ groups
    Move {
        id: "cascade",
        kind: MoveKind::Group,
        lead: "y",
        summary: "The default group arrival: one move down a list in order of importance, with \
                  shrinking gaps so it accelerates. Give animate_many the ids in the order they \
                  should arrive.",
        directions: &[Direction::Up],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::PowerOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0281), Easing::PowerOut),
                    last(20.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_8),
        ],
        group: Some(GroupTiming {
            stagger: 3.0,
            decay: 0.86,
            alternate: false,
        }),
    },
    Move {
        id: "wave",
        kind: MoveKind::Group,
        lead: "y",
        summary: "For 8–14 items of equal weight — a word cascade. Even gaps are the point here, \
                  which is why the decay is 1.0.",
        directions: &[Direction::Up],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::EaseOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0234), Easing::EaseOut),
                    last(22.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_8),
        ],
        group: Some(GroupTiming {
            stagger: 2.0,
            decay: 1.0,
            alternate: false,
        }),
    },
    Move {
        id: "counter-cascade",
        kind: MoveKind::Group,
        lead: "x",
        summary: "A cascade whose members alternate sides, so a group arrival satisfies \
                  entrance-direction diversity by construction instead of reading as a conveyor.",
        directions: &[Direction::Left, Direction::Right],
        channels: &[
            MoveChannel {
                property: "x",
                easing: Easing::PowerOut,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Offset(0.0741), Easing::PowerOut),
                    last(20.0, KeyValue::Target),
                ],
            },
            rides_in(&RIDE_8),
        ],
        group: Some(GroupTiming {
            stagger: 3.0,
            decay: 0.86,
            alternate: true,
        }),
    },
    // ------------------------------------------------------------------ response and ambient
    Move {
        id: "make-room",
        kind: MoveKind::Response,
        lead: "y",
        summary: "The incumbent shifts to open a slot for an arrival — the highest-value move in \
                  the set, because it is what makes a composition respond to its own new element \
                  instead of crossfading to a fresh one. Apply it to what is ALREADY there, a \
                  couple of frames before the arrival.",
        directions: &[Direction::Up, Direction::Down],
        channels: &[MoveChannel {
            property: "y",
            easing: Easing::PowerOut,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Target, Easing::Hold),
                key(2.0, KeyValue::Target, Easing::PowerOut),
                last(16.0, KeyValue::Offset(-0.0198)),
            ],
        }],
        group: None,
    },
    Move {
        id: "dim-back",
        kind: MoveKind::Response,
        lead: "scale",
        summary: "The incumbent recedes as something new arrives — a depth cue, not a fade-out. \
                  Pair it with the arriving element's entrance, at the same time.",
        directions: &[Direction::Out],
        channels: &[
            MoveChannel {
                property: "scale",
                easing: Easing::EaseOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(1.0), Easing::EaseOut),
                    last(12.0, KeyValue::Factor(0.97)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::EaseOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(1.0), Easing::EaseOut),
                    last(12.0, KeyValue::Absolute(0.55)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "drift",
        kind: MoveKind::Ambient,
        lead: "x",
        summary: "Continuous life under a held frame: a slow one-way translation with no sign \
                  change. Three layers at ratios of roughly 1 : 2.7 : 5.7 read as parallax; the \
                  same rate on everything reads as the whole frame sliding.",
        directions: &[Direction::Left, Direction::Right],
        channels: &[MoveChannel {
            property: "x",
            easing: Easing::SineInOut,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Target, Easing::SineInOut),
                last(150.0, KeyValue::Offset(-0.0148)),
            ],
        }],
        group: None,
    },
    Move {
        id: "creep",
        kind: MoveKind::Ambient,
        lead: "y",
        summary: "Terminal drift: after an element has settled, it keeps going 0.4 % of the \
                  canvas in the arrival direction and never returns. Appends to the channel the \
                  entrance already wrote, so the entrance survives.",
        directions: &[Direction::Down, Direction::Up],
        channels: &[MoveChannel {
            property: "y",
            easing: Easing::SineInOut,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Target, Easing::SineInOut),
                last(90.0, KeyValue::Offset(0.0040)),
            ],
        }],
        group: None,
    },
    Move {
        id: "fill",
        kind: MoveKind::Ambient,
        lead: "scaleX",
        summary: "A bar, rule or progress mark drawing over three and a half seconds — the \
                  subject visibly still working. Needs anchorX 0 (or 1) or it grows from its \
                  own middle.",
        directions: &[Direction::In],
        channels: &[MoveChannel {
            property: "scaleX",
            easing: Easing::PowerOut,
            directional: false,
            keys: &[
                key(0.0, KeyValue::Absolute(0.0), Easing::PowerOut),
                last(105.0, KeyValue::Absolute(1.0)),
            ],
        }],
        group: None,
    },
    // ------------------------------------------------------------------ exits
    Move {
        id: "duck",
        kind: MoveKind::Exit,
        lead: "y",
        summary: "The default exit: down and out, at ~55 % of a lift. An exit is not a reversed \
                  entrance — it is shorter, and it leaves on an -in curve.",
        directions: &[Direction::Down],
        channels: &[
            MoveChannel {
                property: "y",
                easing: Easing::PowerIn,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Target, Easing::PowerIn),
                    last(11.0, KeyValue::Offset(0.0156)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::EaseIn,
                directional: false,
                keys: &[
                    key(2.0, KeyValue::Absolute(1.0), Easing::EaseIn),
                    last(11.0, KeyValue::Absolute(0.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "sweep-out",
        kind: MoveKind::Exit,
        lead: "x",
        summary: "Leaves toward the next thing. Its opacity is gone by 70 % of the travel, which \
                  is what keeps a fast lateral exit from strobing on a renderer with no motion \
                  blur.",
        directions: &[Direction::Right, Direction::Left],
        channels: &[
            MoveChannel {
                property: "x",
                easing: Easing::Power4In,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Target, Easing::Power4In),
                    last(10.0, KeyValue::Offset(0.176)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::ExpoIn,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(1.0), Easing::ExpoIn),
                    last(7.0, KeyValue::Absolute(0.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "recede",
        kind: MoveKind::Exit,
        lead: "scale",
        summary: "Falls away from the viewer. For a chapter change, paired with the next \
                  beat's swell.",
        directions: &[Direction::Out],
        channels: &[
            MoveChannel {
                property: "scale",
                easing: Easing::PowerIn,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(1.0), Easing::PowerIn),
                    last(12.0, KeyValue::Factor(0.90)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::EaseIn,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(1.0), Easing::EaseIn),
                    last(10.0, KeyValue::Absolute(0.0)),
                ],
            },
        ],
        group: None,
    },
    // ------------------------------------------------------------------ seams
    Move {
        id: "whip-out",
        kind: MoveKind::Seam,
        lead: "x",
        summary: "The outgoing half of a velocity-matched cut. Pair it with whip-in at the same \
                  distance, the same duration and the same direction: power4-in and power4-out \
                  are the two halves of one curve, so the incoming element picks up at exactly \
                  the speed the outgoing one left at.",
        directions: &[Direction::Left, Direction::Right],
        channels: &[
            MoveChannel {
                property: "x",
                easing: Easing::Power4In,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Target, Easing::Power4In),
                    last(10.0, KeyValue::Offset(-0.213)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::Linear,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(1.0), Easing::Linear),
                    last(3.0, KeyValue::Absolute(0.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "whip-in",
        kind: MoveKind::Seam,
        lead: "x",
        summary: "The incoming half of a velocity-matched cut. Starts at 0.35 opacity, which is \
                  what makes a 100 px/frame move legal on a renderer with no motion blur — you \
                  cannot see a strobe on something that is a third visible.",
        directions: &[Direction::Left, Direction::Right],
        channels: &[
            MoveChannel {
                property: "x",
                easing: Easing::Power4Out,
                directional: true,
                keys: &[
                    key(0.0, KeyValue::Offset(0.213), Easing::Power4Out),
                    last(10.0, KeyValue::Target),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::Linear,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(0.35), Easing::Linear),
                    last(4.0, KeyValue::Absolute(1.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "z-out",
        kind: MoveKind::Seam,
        lead: "scale",
        summary: "The outgoing half of a Z-swap: it comes toward the viewer and past them. Never \
                  visible at the same time as its z-in.",
        directions: &[Direction::In],
        channels: &[
            MoveChannel {
                property: "scale",
                easing: Easing::PowerIn,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(1.0), Easing::PowerIn),
                    last(9.0, KeyValue::Factor(1.18)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::PowerIn,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(1.0), Easing::PowerIn),
                    last(9.0, KeyValue::Absolute(0.10)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "z-in",
        kind: MoveKind::Seam,
        lead: "scale",
        summary: "The incoming half of a Z-swap: arrives from behind over a full second, which \
                  is the only duration at which expo-out is a curve rather than a jump.",
        directions: &[Direction::In],
        channels: &[
            MoveChannel {
                property: "scale",
                easing: Easing::ExpoOut,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Factor(0.76), Easing::ExpoOut),
                    last(30.0, KeyValue::Factor(1.0)),
                ],
            },
            MoveChannel {
                property: "opacity",
                easing: Easing::Linear,
                directional: false,
                keys: &[
                    key(0.0, KeyValue::Absolute(0.10), Easing::Linear),
                    last(12.0, KeyValue::Absolute(1.0)),
                ],
            },
        ],
        group: None,
    },
    Move {
        id: "shunt",
        kind: MoveKind::Seam,
        lead: "y",
        summary: "No entrance and no exit: the whole stack translates by exactly one slot, and a \
                  new element is already sitting in the vacated slot at full opacity. The \
                  cheapest way to advance a list without turning it into a slideshow.",
        directions: &[Direction::Up, Direction::Down],
        channels: &[MoveChannel {
            property: "y",
            easing: Easing::PowerOut,
            directional: true,
            keys: &[
                key(0.0, KeyValue::Target, Easing::PowerOut),
                last(22.0, KeyValue::Offset(-0.10)),
            ],
        }],
        group: None,
    },
];

// --------------------------------------------------------------------------- instantiation

/// What an `apply_move` call says beyond which move.
#[derive(Debug, Clone, Copy)]
pub struct MoveParams {
    /// Seconds after the element's start that the move begins.
    pub at: f64,
    /// Which way it travels. `None` takes the move's own first direction.
    pub direction: Option<Direction>,
    /// A multiplier on every offset the move declares. 1.0 is the tabled amplitude.
    pub distance: f32,
}

impl Default for MoveParams {
    fn default() -> Self {
        Self {
            at: 0.0,
            direction: None,
            distance: 1.0,
        }
    }
}

/// How far a `distance` multiplier may stray from the registry's own amplitude before the move
/// stops being that move. Wide enough to adapt to an element's size, narrow enough that
/// `distance: 0.01` cannot turn a vocabulary move into an invisible one.
pub const DISTANCE_RANGE: (f32, f32) = (0.25, 4.0);

/// Where a channel rests: the value it holds when nothing is animating it.
///
/// If an animation already ends at or before `at`, that end value is the rest — which is what
/// makes an exit, an accent or a make-room compose with the entrance that came first instead of
/// snapping the element back to its authored transform.
pub fn rest_value(
    element: &Element,
    property: &str,
    existing: &BTreeMap<String, AnimationChannel>,
    at: MediaTime,
) -> Option<f32> {
    if let Some(channel) = existing.get(property)
        && let Some(last) = channel.keys.last()
        && last.time.as_ticks() <= at.as_ticks()
    {
        return Some(last.value);
    }
    match property {
        "volume" => match element {
            Element::Audio(audio) => Some(audio.volume),
            _ => None,
        },
        _ => {
            let transform = element.transform()?;
            Some(match property {
                "opacity" => transform.opacity,
                "scale" => transform.scale,
                "x" => transform.x,
                "y" => transform.y,
                "rotation" => transform.rotation,
                "scaleX" => transform.scale_x,
                "scaleY" => transform.scale_y,
                _ => return None,
            })
        }
    }
}

/// Merge a freshly built channel into an animation set.
///
/// **Appends** when the existing channel finishes at or before the new one starts, and replaces
/// otherwise. This is the whole reason a response is affordable: today, making room for an
/// arriving element means rewriting every incumbent's entire absolute key list, so a crossfade
/// wins on cost at every seam. Appending means it costs two keys.
pub fn merge_channel(
    animations: &mut BTreeMap<String, AnimationChannel>,
    property: &str,
    fresh: AnimationChannel,
) {
    let Some(start) = fresh.keys.first().map(|k| k.time.as_ticks()) else {
        return;
    };
    let extends = animations
        .get(property)
        .and_then(|existing| existing.keys.last())
        .is_some_and(|last| last.time.as_ticks() <= start);
    if extends {
        let mut merged = animations
            .get(property)
            .cloned()
            .unwrap_or_else(|| fresh.clone());
        for key in &fresh.keys {
            merged.upsert_key(*key);
        }
        animations.insert(property.to_string(), merged);
    } else {
        animations.insert(property.to_string(), fresh);
    }
}

/// Instantiate `mv` on `element`, returning the element's complete new animation set.
///
/// Returns the whole set rather than the move's own channels so a caller cannot forget to merge
/// — an `animate` that dropped the element's other channels is how a project loses its entrance
/// the first time it is given an exit.
pub fn apply(
    element: &Element,
    mv: &Move,
    params: &MoveParams,
) -> Result<BTreeMap<String, AnimationChannel>, String> {
    if !params.at.is_finite() || params.at < 0.0 {
        return Err(format!(
            "at must be a finite, non-negative number of seconds (got {})",
            params.at
        ));
    }
    if !params.distance.is_finite()
        || params.distance < DISTANCE_RANGE.0
        || params.distance > DISTANCE_RANGE.1
    {
        return Err(format!(
            "distance is a multiplier on the move's own amplitude, between {} and {} (got {})",
            DISTANCE_RANGE.0, DISTANCE_RANGE.1, params.distance
        ));
    }
    let sign = mv.sign_for(params.direction)?;
    let mut animations = element
        .animations()
        .cloned()
        .ok_or_else(|| format!("{:?} has nothing to animate", element.id()))?;
    let allowed = element.animatable();
    for channel in mv.channels {
        if !allowed.contains(&channel.property) {
            return Err(format!(
                "{:?} animates {:?}, which a {} does not have — that move is for {}",
                mv.id,
                channel.property,
                element.kind().label().to_lowercase(),
                allowed.join(", ")
            ));
        }
        let start = time_at(params.at)?;
        let rest = rest_value(element, channel.property, &animations, start).ok_or_else(|| {
            format!(
                "{:?} has no {:?} to rest at",
                element.id(),
                channel.property
            )
        })?;
        let scaled = params.distance * if channel.directional { sign } else { 1.0 };
        let mut fresh = AnimationChannel {
            keys: Vec::new(),
            easing: channel.easing,
        };
        for key in channel.keys {
            let time = time_at(params.at + f64::from(key.frame / REFERENCE_FPS))?;
            fresh.upsert_key(Keyframe {
                time,
                value: key.value.resolve(rest, scaled),
                easing: key.easing,
            });
        }
        merge_channel(&mut animations, channel.property, fresh);
    }
    Ok(animations)
}

fn time_at(seconds: f64) -> Result<MediaTime, String> {
    MediaTime::from_seconds_f64(seconds)
        .ok_or_else(|| format!("{seconds}s is outside the representable time range"))
}

// --------------------------------------------------------------------------- reading it back

/// One animated channel of one element, and which registry moves account for it.
///
/// The population is *authored* elements only. bay's own captions are bay's; measuring their
/// motion as though an author chose it is what inverted four separate motion measurements in the
/// project that prompted provenance — 100 % of the famous three-frame pops were `narrate`'s.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAudit {
    pub element_id: String,
    pub property: String,
    /// Registry moves recognised in this channel, in time order.
    pub moves: Vec<&'static str>,
    /// Value-changing segments no registry move accounts for.
    pub off_vocabulary_segments: usize,
    /// Core frames delivered by the *shortest* value-changing segment, at the project's frame
    /// rate — the number the four-core-frame floor is about.
    pub shortest_core_frames: f32,
    /// Whether this is a geometric channel. A project whose animated channels are all `opacity`
    /// has no motion in it at all, only presence.
    pub geometric: bool,
}

/// Every animated channel on every authored element in the scene.
pub fn audit(scene: &Scene, fps: f32) -> Vec<ChannelAudit> {
    let mut out = Vec::new();
    for element in scene.authored_elements() {
        let Some(animations) = element.animations() else {
            continue;
        };
        for (property, channel) in animations {
            if channel.keys.len() < 2 {
                continue;
            }
            let (moves, off) = recognise(property, channel);
            out.push(ChannelAudit {
                element_id: element.id().to_string(),
                property: property.clone(),
                moves,
                off_vocabulary_segments: off,
                shortest_core_frames: shortest_core_frames(channel, fps),
                geometric: LEAD_CHANNELS.contains(&property.as_str()),
            });
        }
    }
    out
}

/// One channel whose keys no registry move accounts for.
///
/// Raw `animate` stays reachable on purpose — an escape hatch that is refused is one that gets
/// worked around, and there are real moves the registry does not have. What it does not stay is
/// *anonymous*: every channel is named, with its element, so the cost of going around the
/// vocabulary is proportional to how much of the project goes around it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OffVocabularyMotion {
    pub element_id: String,
    pub property: String,
    /// How many value-changing segments are unaccounted for.
    pub segments: usize,
    /// Core frames of the shortest segment — below four, the move is received as a cut.
    pub shortest_core_frames: f32,
}

impl OffVocabularyMotion {
    /// The finding code this is reported under.
    pub const CODE: &'static str = "off-vocabulary-motion";

    pub fn message(&self) -> String {
        let tail = if self.shortest_core_frames < MIN_CORE_FRAMES {
            format!(
                ", and its shortest is {:.1} core frames — under {MIN_CORE_FRAMES:.0}, which the \
                 eye receives as a cut rather than a move",
                self.shortest_core_frames
            )
        } else {
            String::new()
        };
        format!(
            "{}: {} is hand-keyed rather than a named move ({} segment(s)){tail}. apply_move — \
             or animate with \"move\" — carries its own duration and curve.",
            self.element_id, self.property, self.segments
        )
    }
}

/// Every hand-keyed channel in the scene, for the `off-vocabulary-motion` finding.
pub fn off_vocabulary(scene: &Scene, fps: f32) -> Vec<OffVocabularyMotion> {
    audit(scene, fps)
        .into_iter()
        .filter(|entry| entry.off_vocabulary_segments > 0)
        .map(|entry| OffVocabularyMotion {
            element_id: entry.element_id,
            property: entry.property,
            segments: entry.off_vocabulary_segments,
            shortest_core_frames: entry.shortest_core_frames,
        })
        .collect()
}

/// How many *elements* use each registry move. The two-sided histogram gate — at least four
/// distinct moves, each on at least a tenth of the animated elements, and no more than eight
/// signatures overall — is computed from this.
pub fn histogram(scene: &Scene) -> BTreeMap<&'static str, usize> {
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    for (_, moves) in per_element(scene) {
        for id in moves {
            *counts.entry(id).or_default() += 1;
        }
    }
    counts
}

/// How many elements share each motion signature — the sorted set of moves on an element.
///
/// A one-sided "use at least four moves" rule is satisfied by a rotation table; the ceiling is
/// what inverts the gradient, because a table makes every signature equally common and a
/// composition does not.
pub fn signatures(scene: &Scene) -> BTreeMap<String, usize> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for (_, mut moves) in per_element(scene) {
        if moves.is_empty() {
            continue;
        }
        moves.sort_unstable();
        moves.dedup();
        *counts.entry(moves.join("+")).or_default() += 1;
    }
    counts
}

/// The distinct registry moves on each authored, animated element.
///
/// Counted from the **geometric** channels only. A move's identity is carried by its lead, and
/// its opacity is a passenger several moves share byte-for-byte — letting the ride vote would
/// mean a `cascade` reporting as a `sweep` because the two fade in over the same eight frames.
fn per_element(scene: &Scene) -> Vec<(String, Vec<&'static str>)> {
    let mut out: Vec<(String, Vec<&'static str>)> = Vec::new();
    for entry in audit(scene, REFERENCE_FPS)
        .into_iter()
        .filter(|entry| entry.geometric)
    {
        match out.last_mut() {
            Some((id, moves)) if *id == entry.element_id => moves.extend(entry.moves),
            _ => out.push((entry.element_id, entry.moves)),
        }
    }
    for (_, moves) in &mut out {
        moves.sort_unstable();
        moves.dedup();
    }
    out
}

/// Core frames delivered by the shortest value-changing segment of `channel`.
fn shortest_core_frames(channel: &AnimationChannel, fps: f32) -> f32 {
    let mut shortest = f32::MAX;
    for pair in channel.keys.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if a.value == b.value {
            continue;
        }
        let seconds = (b.time.as_ticks() - a.time.as_ticks()) as f32 / TICKS_PER_SECOND as f32;
        shortest = shortest.min(seconds * fps * core_span(a.easing.unwrap_or(channel.easing)));
    }
    if shortest == f32::MAX { 0.0 } else { shortest }
}

/// Walk a channel and name the registry moves in it, returning what was recognised and how many
/// value-changing segments were not.
///
/// A channel can hold several moves in sequence — an entrance, then an accent, then an exit —
/// because [`merge_channel`] appends rather than replaces, so this consumes them in order.
fn recognise(property: &str, channel: &AnimationChannel) -> (Vec<&'static str>, usize) {
    let mut moves: Vec<&'static str> = Vec::new();
    let mut off = 0usize;
    let mut index = 0usize;
    while index + 1 < channel.keys.len() {
        if let Some((id, consumed)) = match_at(property, channel, index) {
            moves.push(id);
            index += consumed - 1;
            continue;
        }
        if channel.keys[index].value != channel.keys[index + 1].value {
            off += 1;
        }
        index += 1;
    }
    (moves, off)
}

/// Whether some registry move's channel starts exactly at `index`, and how many keys it uses.
fn match_at(
    property: &str,
    channel: &AnimationChannel,
    index: usize,
) -> Option<(&'static str, usize)> {
    let mut best: Option<(&'static str, usize, f32)> = None;
    for mv in MOVES {
        let Some(shape) = mv.channel(property) else {
            continue;
        };
        let count = shape.keys.len();
        if index + count > channel.keys.len() {
            continue;
        }
        let Some(distance) = matches_shape(channel, index, shape) else {
            continue;
        };
        // Longest match first — `lift` and `coil` share a first key, and reporting the two-key
        // one on a three-key channel would leave a phantom off-vocabulary segment. Then the move
        // whose *own* tabled amplitude explains the values: `cascade` and `arc-in` rise on the
        // same curve over the same 20 frames and differ only in how far, so the one that needs
        // no scaling is the one that was called.
        let stretch = (distance.abs() - 1.0).abs();
        let better = match best {
            None => true,
            Some((_, best_count, best_stretch)) => {
                count > best_count || (count == best_count && stretch < best_stretch)
            }
        };
        if better {
            best = Some((mv.id, count, stretch));
        }
    }
    best.map(|(id, count, _)| (id, count))
}

/// The distance multiplier for which the run of keys at `index` *is* `shape`, or `None` if no
/// resting value and distance can produce it.
fn matches_shape(channel: &AnimationChannel, index: usize, shape: &MoveChannel) -> Option<f32> {
    let observed = &channel.keys[index..index + shape.keys.len()];

    // Times, relative to the first key of the run.
    let base = observed[0].time.as_ticks();
    for (key, want) in observed.iter().zip(shape.keys) {
        let seconds = (key.time.as_ticks() - base) as f32 / TICKS_PER_SECOND as f32;
        let expected = (want.frame - shape.keys[0].frame) / REFERENCE_FPS;
        if (seconds - expected).abs() > 1e-3 {
            return None;
        }
        if key.easing != want.easing {
            return None;
        }
    }

    // The resting value: whichever key states it outright.
    let rest = shape
        .keys
        .iter()
        .zip(observed)
        .find_map(|(want, key)| match want.value {
            KeyValue::Target => Some(key.value),
            KeyValue::Factor(f) if (f - 1.0).abs() < 1e-6 => Some(key.value),
            _ => None,
        });

    // The distance multiplier, from the first key that depends on one.
    let distance = shape
        .keys
        .iter()
        .zip(observed)
        .find_map(|(want, key)| match (want.value, rest) {
            (KeyValue::Offset(offset), Some(rest)) if offset.abs() > 1e-9 => {
                Some((key.value - rest) / offset)
            }
            (KeyValue::Factor(factor), Some(rest))
                if (factor - 1.0).abs() > 1e-9 && rest.abs() > 1e-6 =>
            {
                Some((key.value / rest - 1.0) / (factor - 1.0))
            }
            _ => None,
        })
        .unwrap_or(1.0);

    if !distance.is_finite() {
        return None;
    }
    let magnitude = distance.abs();
    if magnitude < DISTANCE_RANGE.0 - 1e-4 || magnitude > DISTANCE_RANGE.1 + 1e-4 {
        return None;
    }
    // A mirrored move is only that move if the channel is one the direction flips.
    if distance < 0.0 && !shape.directional {
        return None;
    }

    let rest = rest.unwrap_or(0.0);
    shape
        .keys
        .iter()
        .zip(observed)
        .all(|(want, key)| close(want.value.resolve(rest, distance), key.value))
        .then_some(distance)
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() <= 1e-3 * a.abs().max(1.0)
}
