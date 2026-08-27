//! The left panel's tabs: Text, Transitions, Effects, Audio — and what clicking a tile does.
//!
//! Every tile here resolves to [`Command`]s the engine already executes. That constraint is the
//! whole point of the module. The design this implements offers a "Wipe" transition, a
//! "Sharpen" effect and a "Denoise" audio tool, and bay has a shader for none of them; a tile
//! that adds an effect the compositor ignores is a control that does nothing, discovered only
//! after an export comes back looking unchanged. So the catalog is derived from what exists:
//! six effects because [`bay_effects`] compiles six shaders, transitions built from fades and
//! animation channels because there is no transition object, and audio tools built from fades
//! and the `volume` channel.
//!
//! The converse is just as much a defect and is quieter: `lut` was implemented, translated by
//! `bay-preview`, validated by `check` and reachable over MCP, and had no tile — a whole
//! grading capability that could not be reached by clicking. A shader with no tile is not a
//! dead control, it is a missing one, and only a person reading both lists side by side would
//! ever find it.
//!
//! It lives in `bay-core` rather than the UI crate for the workspace rule — an MCP client and a
//! test must be able to ask for "cross dissolve on the selection" without a window.

use std::collections::BTreeMap;

use bay_project::Easing;
use bay_time::MediaTime;

use crate::{AnimationChannel, Command, Effect, Element, ElementRef, Keyframe, Transform};

/// Which tab of the left panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Panel {
    /// Imported media. Not a block panel — it lists the project's own library.
    Media,
    Text,
    Transitions,
    Effects,
    Audio,
}

impl Panel {
    /// The tabs, in rail order.
    pub const ALL: [Panel; 5] = [
        Panel::Media,
        Panel::Text,
        Panel::Transitions,
        Panel::Effects,
        Panel::Audio,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Panel::Media => "Media",
            Panel::Text => "Text",
            Panel::Transitions => "Trans",
            Panel::Effects => "FX",
            Panel::Audio => "Audio",
        }
    }

    /// The rail glyph. Text rather than an icon font: bay ships no icon font, and a missing
    /// glyph draws as a hollow box.
    pub fn glyph(self) -> &'static str {
        match self {
            Panel::Media => "▦",
            Panel::Text => "Aa",
            Panel::Transitions => "⇥",
            Panel::Effects => "◐",
            Panel::Audio => "⌇",
        }
    }

    /// The heading over the tile grid.
    pub fn title(self) -> &'static str {
        match self {
            Panel::Media => "LIBRARY",
            Panel::Text => "TEXT STYLES",
            Panel::Transitions => "TRANSITIONS",
            Panel::Effects => "EFFECTS",
            Panel::Audio => "AUDIO",
        }
    }

    pub fn blocks(self) -> &'static [Block] {
        match self {
            Panel::Media => &[],
            Panel::Text => TEXT_BLOCKS,
            Panel::Transitions => TRANSITION_BLOCKS,
            Panel::Effects => EFFECT_BLOCKS,
            Panel::Audio => AUDIO_BLOCKS,
        }
    }
}

/// One tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    pub id: &'static str,
    pub label: &'static str,
    /// The second line: what it actually does, in the units it does it in.
    pub detail: &'static str,
    /// Whether it acts on the selected clip. Text tiles create one instead.
    pub needs_selection: bool,
}

const TEXT_BLOCKS: &[Block] = &[
    Block {
        id: "text.headline",
        label: "Headline",
        detail: "the line a beat is built around",
        needs_selection: false,
    },
    Block {
        id: "text.hook",
        label: "Hook",
        detail: "opens · earns the next two seconds",
        needs_selection: false,
    },
    Block {
        id: "text.kicker",
        label: "Kicker",
        detail: "small line framing a headline",
        needs_selection: false,
    },
    Block {
        id: "text.lower-third",
        label: "Lower third",
        detail: "name plate · lower left",
        needs_selection: false,
    },
    Block {
        id: "text.caption",
        label: "Caption",
        detail: "spoken words · bottom safe",
        needs_selection: false,
    },
    Block {
        id: "text.lockup",
        label: "End card",
        detail: "what the video resolves onto",
        needs_selection: false,
    },
];

const TRANSITION_BLOCKS: &[Block] = &[
    Block {
        id: "trans.dissolve",
        label: "Cross dissolve",
        detail: "0.50 s fade up at the head",
        needs_selection: true,
    },
    Block {
        id: "trans.dip",
        label: "Dip to black",
        detail: "0.40 s down, 0.40 s up",
        needs_selection: true,
    },
    Block {
        id: "trans.slide",
        label: "Slide in",
        detail: "0.40 s · from the left",
        needs_selection: true,
    },
    Block {
        id: "trans.zoom",
        label: "Zoom in",
        detail: "0.60 s · 0.85 → 1.00",
        needs_selection: true,
    },
    Block {
        id: "trans.none",
        label: "Cut",
        detail: "clear fades and entry motion",
        needs_selection: true,
    },
];

/// Exactly the shaders [`bay_effects`] compiles. See the module note.
const EFFECT_BLOCKS: &[Block] = &[
    Block {
        id: "fx.brightness",
        label: "Bright",
        detail: "exposure lift",
        needs_selection: true,
    },
    Block {
        id: "fx.contrast",
        label: "Contrast",
        detail: "tone curve",
        needs_selection: true,
    },
    Block {
        id: "fx.saturation",
        label: "Sat",
        detail: "saturation",
        needs_selection: true,
    },
    Block {
        id: "fx.blur",
        label: "Blur",
        detail: "gaussian",
        needs_selection: true,
    },
    Block {
        id: "fx.shadow",
        label: "Shadow",
        detail: "drop shadow",
        needs_selection: true,
    },
    Block {
        id: "fx.lut",
        label: "Look",
        detail: "neutral contrast grade",
        needs_selection: true,
    },
    Block {
        id: "fx.balance",
        label: "Balance",
        detail: "cool shadows · warm highlights",
        needs_selection: true,
    },
];

/// The grade the Look tile attaches.
///
/// A built-in rather than a file picker, because a `lut` effect with no `asset` behind it is
/// dropped by the render path entirely — the tile would add a row to the inspector and change
/// no pixel, which is the exact failure this module exists to prevent. Built-ins are generated
/// on the machine, so the tile works on a install that has never downloaded anything, and the
/// grade can be swapped for a `.cube` afterwards without removing the effect.
///
/// Neutral Contrast because it is the only look in the set that is a *finish* rather than a
/// statement: a tile in a palette is reached for before anyone has decided what the film looks
/// like, and Teal & Orange arriving on one click is a decision made on the user's behalf.
const TILE_LOOK: &str = "neutral-contrast";

const AUDIO_BLOCKS: &[Block] = &[
    Block {
        id: "audio.fade-in",
        label: "Fade in 1 s",
        detail: "ramp from silence",
        needs_selection: true,
    },
    Block {
        id: "audio.fade-out",
        label: "Fade out 1 s",
        detail: "ramp to silence",
        needs_selection: true,
    },
    Block {
        id: "audio.top-and-tail",
        label: "Top and tail",
        detail: "0.5 s in, 1 s out",
        needs_selection: true,
    },
    Block {
        id: "audio.duck",
        label: "Duck to −9 dB",
        detail: "level keys across the clip",
        needs_selection: true,
    },
    Block {
        id: "audio.full",
        label: "Back to full",
        detail: "clear level keys and fades",
        needs_selection: true,
    },
];

pub fn block(id: &str) -> Option<&'static Block> {
    Panel::ALL
        .iter()
        .flat_map(|panel| panel.blocks())
        .find(|block| block.id == id)
}

/// Why a tile could not be applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockError {
    UnknownBlock(String),
    /// The tile acts on a clip and none is selected.
    NeedsSelection(&'static str),
    /// The tile does not apply to the kind of clip that is selected.
    WrongKind(String),
    /// There is nowhere to put a new clip.
    NoTrack(String),
}

impl std::fmt::Display for BlockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlockError::UnknownBlock(id) => write!(f, "no panel block called {id}"),
            BlockError::NeedsSelection(label) => {
                write!(f, "Select a clip first — {label} applies to one")
            }
            BlockError::WrongKind(why) | BlockError::NoTrack(why) => f.write_str(why),
        }
    }
}

impl std::error::Error for BlockError {}

/// Default clip lengths, in ticks. 120 000 ticks to the second.
const TICKS_PER_SECOND: i64 = 120_000;
const TEXT_DURATION: i64 = 3 * TICKS_PER_SECOND;

fn seconds(value: f64) -> MediaTime {
    MediaTime::from_ticks((value * TICKS_PER_SECOND as f64).round() as i64)
}

/// Turn a tile click into the commands that carry it out.
///
/// `fresh_id` mints ids for anything created; the caller owns the counter so two clicks in the
/// same session cannot produce the same element id. Returning commands rather than mutating
/// keeps the whole catalog testable without an editor mutation to unpick afterwards, and means
/// each tile lands as one undoable step.
pub fn plan(
    editor: &crate::Editor,
    block_id: &str,
    fresh_id: &mut dyn FnMut(&str) -> String,
) -> Result<Vec<Command>, BlockError> {
    let Some(block) = block(block_id) else {
        return Err(BlockError::UnknownBlock(block_id.to_string()));
    };

    let selection = editor.selection().first().cloned();
    if block.needs_selection && selection.is_none() {
        return Err(BlockError::NeedsSelection(block.label));
    }

    if let Some(role) = text_role(block_id) {
        return plan_text(editor, block, role, fresh_id);
    }

    let reference = selection.expect("checked above");
    let element = editor
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| track.elements.iter())
        .find(|element| element.id() == reference.element_id)
        .ok_or_else(|| BlockError::WrongKind("that clip is no longer on the timeline".into()))?
        .clone();

    match block_id {
        "trans.dissolve" => Ok(vec![Command::SetFades {
            reference,
            fade_in: seconds(0.5),
            fade_out: element.fade_out(),
        }]),
        "trans.dip" => Ok(vec![Command::SetFades {
            reference,
            fade_in: seconds(0.4),
            fade_out: seconds(0.4),
        }]),
        "trans.slide" => Ok(vec![motion(
            reference,
            &element,
            "x",
            -0.35,
            0.0,
            0.4,
            Easing::EaseOut,
        )]),
        "trans.zoom" => Ok(vec![motion(
            reference,
            &element,
            "scale",
            0.85,
            1.0,
            0.6,
            Easing::EaseOut,
        )]),
        "trans.none" => Ok(vec![
            Command::SetFades {
                reference: reference.clone(),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
            },
            // An empty channel is how a channel is cleared — `SetAnimationChannel` replaces,
            // and a channel with no keys samples as "not animated".
            Command::ApplyMotionPreset {
                reference,
                effects: Vec::new(),
                animations: BTreeMap::from([
                    ("x".to_string(), AnimationChannel::default()),
                    ("scale".to_string(), AnimationChannel::default()),
                ]),
            },
        ]),

        "fx.brightness" => Ok(vec![add_effect(reference, "brightness", 1.2, fresh_id)]),
        "fx.contrast" => Ok(vec![add_effect(reference, "contrast", 1.15, fresh_id)]),
        "fx.saturation" => Ok(vec![add_effect(reference, "saturation", 1.3, fresh_id)]),
        "fx.blur" => Ok(vec![add_effect(reference, "blur", 4.0, fresh_id)]),
        // Defaults a designer would recognise as "a card sits on the page": below the layer,
        // soft, and faint. A tile that adds a shadow nobody can see is the same dead control
        // as a tile naming a shader that does not exist.
        "fx.shadow" => Ok(vec![add_effect_with(
            reference,
            "drop-shadow",
            default_effect_params("drop-shadow"),
            None,
            fresh_id,
        )]),
        "fx.lut" => Ok(vec![add_effect_with(
            reference,
            "lut",
            default_effect_params("lut"),
            Some(format!("{}{TILE_LOOK}", bay_project::LOOK_PREFIX)),
            fresh_id,
        )]),
        "fx.balance" => Ok(vec![add_effect_with(
            reference,
            "lift-gamma-gain",
            default_effect_params("lift-gamma-gain"),
            None,
            fresh_id,
        )]),

        "audio.fade-in" => Ok(vec![Command::SetFades {
            reference,
            fade_in: seconds(1.0),
            fade_out: element.fade_out(),
        }]),
        "audio.fade-out" => Ok(vec![Command::SetFades {
            reference,
            fade_in: element.fade_in(),
            fade_out: seconds(1.0),
        }]),
        "audio.top-and-tail" => Ok(vec![Command::SetFades {
            reference,
            fade_in: seconds(0.5),
            fade_out: seconds(1.0),
        }]),
        // −9 dB is a level of about 0.355. Written as keys rather than a flat gain so the clip
        // can be un-ducked over a word without splitting it, which is the whole reason the
        // `volume` channel exists.
        "audio.duck" => {
            if !matches!(element, Element::Audio(_)) {
                return Err(BlockError::WrongKind(format!(
                    "Ducking applies to an audio clip — “{}” is {}",
                    element.name(),
                    element.kind().label().to_lowercase()
                )));
            }
            let end = element.duration();
            Ok(vec![Command::ApplyMotionPreset {
                reference,
                effects: Vec::new(),
                animations: BTreeMap::from([(
                    "volume".to_string(),
                    AnimationChannel {
                        keys: vec![
                            Keyframe::new(MediaTime::ZERO, 0.355),
                            Keyframe::new(end, 0.355),
                        ],
                        easing: Easing::Linear,
                    },
                )]),
            }])
        }
        "audio.full" => Ok(vec![
            Command::SetFades {
                reference: reference.clone(),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
            },
            Command::ApplyMotionPreset {
                reference,
                effects: Vec::new(),
                animations: BTreeMap::from([("volume".to_string(), AnimationChannel::default())]),
            },
        ]),

        other => Err(BlockError::UnknownBlock(other.to_string())),
    }
}

fn text_role(block_id: &str) -> Option<bay_project::ElementRole> {
    use bay_project::ElementRole::*;
    Some(match block_id {
        "text.headline" => Headline,
        "text.hook" => Hook,
        "text.kicker" => Kicker,
        "text.lower-third" => Label,
        "text.caption" => Caption,
        "text.lockup" => Lockup,
        _ => return None,
    })
}

/// Where a new text clip goes, and what it says.
///
/// On the overlay lane when there is one, so a title does not displace the picture; the main
/// lane otherwise. It starts at the playhead — the same rule as dropping media — because the
/// playhead is where the user is looking.
fn plan_text(
    editor: &crate::Editor,
    block: &Block,
    role: bay_project::ElementRole,
    fresh_id: &mut dyn FnMut(&str) -> String,
) -> Result<Vec<Command>, BlockError> {
    let scene = editor.active_scene();
    let track_id = scene
        .tracks
        .overlay
        .first()
        .map(|track| track.id.clone())
        .unwrap_or_else(|| scene.tracks.main.id.clone());
    if track_id.is_empty() {
        return Err(BlockError::NoTrack(
            "this scene has no track to put text on".into(),
        ));
    }

    let (font_size, transform) = text_geometry(block.id);
    let element = Element::Text(bay_project::TextElement {
        id: fresh_id("text"),
        name: block.label.to_string(),
        start: editor.playhead(),
        duration: MediaTime::from_ticks(TEXT_DURATION),
        fade_in: seconds(0.25),
        fade_out: seconds(0.25),
        content: block.label.to_string(),
        font_size,
        color: "#ffffff".into(),
        transform,
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        font_family: None,
        font_weight: if matches!(
            role,
            bay_project::ElementRole::Headline | bay_project::ElementRole::Hook
        ) {
            700
        } else {
            400
        },
        align: Default::default(),
        letter_spacing: 0.0,
        line_height: 1.2,
        decorations: None,
        karaoke: None,
        type_on: None,
        source: Default::default(),
        role,
    });

    Ok(vec![Command::AddElement {
        track_id,
        element,
        select: true,
    }])
}

/// Size and placement per text tile, in the project's normalised transform space.
fn text_geometry(block_id: &str) -> (f32, Transform) {
    let centred = |y: f32| Transform {
        y,
        ..Transform::default()
    };
    match block_id {
        "text.hook" => (96.0, centred(0.0)),
        "text.headline" => (72.0, centred(0.0)),
        "text.kicker" => (32.0, centred(-0.22)),
        "text.lower-third" => (
            34.0,
            Transform {
                x: -0.22,
                y: 0.30,
                ..Transform::default()
            },
        ),
        "text.caption" => (36.0, centred(0.36)),
        "text.lockup" => (56.0, centred(0.0)),
        _ => (48.0, Transform::default()),
    }
}

/// The parameters an effect is born with, by type.
///
/// Here rather than at each call site because there are three: the block palette, the
/// inspector's add-buttons, and anything an agent builds. When the seed for blur lived in the
/// UI and the seed for the palette lived here, the same tile produced two different shadows
/// depending on which surface added it.
pub fn default_effect_params(effect_type: &str) -> BTreeMap<String, f32> {
    match effect_type {
        // A card sitting on a page: below the layer, soft, faint.
        //
        // `amount` is the shadow's opacity, not a seventh parameter beside it. Every effect's
        // `amount` is the one dial a person reaches for first — sigma for blur, gain for the
        // colour adjustments — and it is what the inspector's stepper nudges, so a shadow
        // whose strength lived under some other name could not be turned up from the UI.
        "drop-shadow" => BTreeMap::from([
            ("amount".to_string(), 0.18),
            ("offsetX".to_string(), 0.0),
            ("offsetY".to_string(), 8.0),
            ("blur".to_string(), 16.0),
            ("spread".to_string(), 0.0),
            ("colorR".to_string(), 0.0),
            ("colorG".to_string(), 0.0),
            ("colorB".to_string(), 0.0),
        ]),
        // Sigma in pixels.
        "blur" => BTreeMap::from([("amount".to_string(), 4.0)]),
        // Three wheels, thirteen numbers, and deliberately **not** the neutral setting.
        //
        // Neutral would be the tidy default and it would make the tile a dead control: it
        // would add a row to the inspector and change no pixel, which is the failure this
        // module exists to prevent. So the tile seeds the balance its own label promises — a
        // cool toe and a warm top, the split every colourist puts in first — small enough to
        // tune from rather than undo. `amount` is how much of it to apply, as on `lut`.
        //
        // Neutral per wheel is lift 0, gamma 1, gain 1; the preview's mapper falls back to
        // those, so a wheel omitted here is at rest rather than at zero.
        "lift-gamma-gain" => BTreeMap::from([
            ("amount".to_string(), 1.0),
            ("liftR".to_string(), -0.005),
            ("liftG".to_string(), 0.0),
            ("liftB".to_string(), 0.02),
            ("liftMaster".to_string(), 0.0),
            ("gammaR".to_string(), 1.0),
            ("gammaG".to_string(), 1.0),
            ("gammaB".to_string(), 1.0),
            ("gammaMaster".to_string(), 1.0),
            ("gainR".to_string(), 1.04),
            ("gainG".to_string(), 1.0),
            ("gainB".to_string(), 0.96),
            ("gainMaster".to_string(), 1.0),
        ]),
        // How much of the grade to apply, so 1.0 is the *full* look, not "no change" —
        // the opposite of what the same number means on the colour adjustments below.
        // A grade that arrives at 0 is a control that did nothing, and telling that from a
        // subtle look by eye is exactly what nobody can do.
        "lut" => BTreeMap::from([("amount".to_string(), 1.0)]),
        // The colour adjustments seed at 1.0, which is no change, so adding one is visible in
        // the inspector without altering the frame until it is tuned.
        _ => BTreeMap::from([("amount".to_string(), 1.0)]),
    }
}

/// An effect whose contract is several named scalars, or a grade it cannot render without.
///
/// `add_effect` writes a single `amount` and no asset, which is the whole contract for the
/// colour adjustments and for blur's sigma. A drop shadow has five more parameters, and a
/// `lut` is nothing at all without an `asset` — the render path drops a grade with no table
/// behind it — so building either through `add_effect` would produce an effect the compositor
/// skips.
fn add_effect_with(
    reference: ElementRef,
    effect_type: &str,
    params: impl IntoIterator<Item = (String, f32)>,
    asset: Option<String>,
    fresh_id: &mut dyn FnMut(&str) -> String,
) -> Command {
    Command::AddEffect {
        reference,
        effect: Effect {
            id: fresh_id("fx"),
            effect_type: effect_type.to_string(),
            enabled: true,
            params: params.into_iter().collect(),
            asset,
        },
    }
}

fn add_effect(
    reference: ElementRef,
    effect_type: &str,
    amount: f32,
    fresh_id: &mut dyn FnMut(&str) -> String,
) -> Command {
    Command::AddEffect {
        reference,
        effect: Effect {
            id: fresh_id("fx"),
            effect_type: effect_type.to_string(),
            enabled: true,
            params: BTreeMap::from([("amount".to_string(), amount)]),
            asset: None,
        },
    }
}

/// A two-key entry animation on one property, running for `span` seconds from the clip's head.
///
/// Clamped to the clip: a 0.6 s zoom on a 0.3 s clip would put its second key past the end,
/// where it never plays, and the clip would sit at 0.85 scale for its whole life.
fn motion(
    reference: ElementRef,
    element: &Element,
    property: &str,
    from: f32,
    to: f32,
    span: f64,
    easing: Easing,
) -> Command {
    let span = seconds(span).as_ticks().min(element.duration().as_ticks());
    Command::ApplyMotionPreset {
        reference,
        effects: Vec::new(),
        animations: BTreeMap::from([(
            property.to_string(),
            AnimationChannel {
                keys: vec![
                    Keyframe::new(MediaTime::ZERO, from),
                    Keyframe::new(MediaTime::from_ticks(span), to),
                ],
                easing,
            },
        )]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Editor;

    fn ids() -> impl FnMut(&str) -> String {
        let mut counter = 0;
        move |prefix: &str| {
            counter += 1;
            format!("{prefix}-{counter}")
        }
    }

    fn apply(editor: &mut Editor, block_id: &str) -> Result<(), BlockError> {
        let mut next = ids();
        let commands = plan(editor, block_id, &mut next)?;
        for command in commands {
            editor.execute(command);
        }
        Ok(())
    }

    fn select_title(editor: &mut Editor) -> ElementRef {
        let reference = ElementRef::new("track-main", "el-title");
        editor.select(vec![reference.clone()]);
        reference
    }

    /// The set `bay-preview` translates and `bay-agent` validates against. Pinned equal to
    /// `bay_agent::plan::SUPPORTED_EFFECTS` by `bay-mcp`'s `tool_vocabulary` tests, which can
    /// see both crates; this one cannot, since `bay-agent` depends on it and not the reverse.
    const IMPLEMENTED: [&str; 7] = [
        "brightness",
        "contrast",
        "saturation",
        "blur",
        "lut",
        "drop-shadow",
        "lift-gamma-gain",
    ];

    /// The reason this module exists. Every effect tile must name a shader the compositor
    /// actually compiles, or the tile is a control that silently does nothing.
    #[test]
    fn every_effect_tile_names_a_shader_the_engine_implements() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        let mut next = ids();

        for tile in Panel::Effects.blocks() {
            let commands = plan(&editor, tile.id, &mut next).expect(tile.id);
            let Some(Command::AddEffect { effect, .. }) = commands.first() else {
                panic!("{} should add an effect, got {commands:?}", tile.id);
            };
            assert!(
                IMPLEMENTED.contains(&effect.effect_type.as_str()),
                "{} adds “{}”, which no shader implements",
                tile.id,
                effect.effect_type
            );
            assert!(
                effect.params.contains_key("amount"),
                "{} must set an amount the inspector can nudge",
                tile.id
            );
            // A grade is the one effect that needs more than a shader name: the render path
            // drops a `lut` whose asset resolves to no table, so a tile that attached one
            // without a grade would pass every assertion above and still change nothing.
            if effect.effect_type == "lut" {
                let asset = effect.asset.as_deref().unwrap_or_else(|| {
                    panic!("{} adds a lut with no grade behind it", tile.id);
                });
                let id = bay_project::look_id(asset).unwrap_or_else(|| {
                    panic!("{tile:?} must name a built-in look, not a path that may not exist")
                });
                assert!(
                    bay_project::is_builtin_look(id),
                    "{} names look {id:?}, which this build cannot generate",
                    tile.id
                );
            }
        }
    }

    /// The converse, and the quieter defect: a shader with no tile is a capability that cannot
    /// be reached by clicking. `lut` was implemented, translated, validated and exposed over
    /// MCP with no tile in the palette for its whole life.
    #[test]
    fn every_shader_the_engine_implements_has_a_tile() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        let mut next = ids();

        let mut offered: Vec<String> = Vec::new();
        for tile in Panel::Effects.blocks() {
            if let Some(Command::AddEffect { effect, .. }) =
                plan(&editor, tile.id, &mut next).expect(tile.id).first()
            {
                offered.push(effect.effect_type.clone());
            }
        }
        let missing: Vec<&str> = IMPLEMENTED
            .into_iter()
            .filter(|shader| !offered.iter().any(|offered| offered == shader))
            .collect();
        assert!(
            missing.is_empty(),
            "the compositor renders {missing:?} and no tile adds them — unreachable by clicking"
        );
    }

    #[test]
    fn block_ids_are_unique_across_every_panel() {
        let mut ids: Vec<&str> = Panel::ALL
            .iter()
            .flat_map(|panel| panel.blocks())
            .map(|block| block.id)
            .collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total, "two tiles share an id");
        assert!(total > 0);
        assert!(Panel::Media.blocks().is_empty(), "media lists the library");
    }

    #[test]
    fn every_tile_resolves_through_the_lookup() {
        for panel in Panel::ALL {
            for tile in panel.blocks() {
                assert_eq!(block(tile.id).map(|b| b.label), Some(tile.label));
            }
        }
        assert!(block("fx.sharpen").is_none(), "an unimplemented effect");
    }

    /// A tile that needs a clip must say so rather than doing nothing.
    #[test]
    fn a_tile_that_needs_a_clip_refuses_with_a_readable_reason() {
        let editor = Editor::starter();
        let mut next = ids();
        let error = plan(&editor, "fx.blur", &mut next).expect_err("nothing is selected");
        assert!(matches!(error, BlockError::NeedsSelection(_)));
        assert!(error.to_string().contains("Select a clip"), "{error}");
    }

    /// Text tiles create a clip, so they must work with nothing selected.
    #[test]
    fn a_text_tile_works_with_nothing_selected_and_lands_at_the_playhead() {
        let mut editor = Editor::starter();
        editor.seek(MediaTime::from_ticks(2 * TICKS_PER_SECOND));
        let before = editor.active_scene().tracks.iter().count();
        apply(&mut editor, "text.headline").expect("no selection needed");

        // Found through the selection, not by name: the starter project already contains a
        // clip called "Caption", and matching on a label would silently inspect the wrong one.
        let added = editor
            .selected_element()
            .expect("a new text clip is selected on arrival");
        assert_eq!(added.name(), "Headline");
        assert_eq!(added.start(), MediaTime::from_ticks(2 * TICKS_PER_SECOND));
        assert_eq!(added.duration().to_seconds_f64(), 3.0);
        assert_eq!(
            editor.active_scene().tracks.iter().count(),
            before,
            "adding text must not invent a track"
        );
    }

    /// A title goes above the picture, not on top of it.
    #[test]
    fn text_lands_on_the_overlay_lane_when_there_is_one() {
        let mut editor = Editor::starter();
        let overlay = editor
            .active_scene()
            .tracks
            .overlay
            .first()
            .map(|track| track.id.clone());
        apply(&mut editor, "text.caption").unwrap();

        let placed = editor
            .selection()
            .first()
            .cloned()
            .expect("the new clip is selected");
        let scene = editor.active_scene();
        let host = scene
            .tracks
            .iter()
            .find(|track| track.id == placed.track_id)
            .expect("the caption is on some track");
        match overlay {
            Some(id) => assert_eq!(host.id, id, "a caption belongs on the overlay lane"),
            None => assert_eq!(host.id, scene.tracks.main.id),
        }
    }

    #[test]
    fn every_text_tile_produces_a_clip_with_its_own_role_and_size() {
        let mut sizes = Vec::new();
        for tile in Panel::Text.blocks() {
            let mut editor = Editor::starter();
            apply(&mut editor, tile.id).expect(tile.id);
            let element = editor
                .selected_element()
                .unwrap_or_else(|| panic!("{} added nothing", tile.id));
            assert_eq!(element.name(), tile.label);
            let Element::Text(text) = element else {
                panic!("{} should add a text clip", tile.id);
            };
            assert_eq!(text.role, text_role(tile.id).unwrap());
            assert!(text.font_size > 0.0);
            sizes.push(text.font_size);
        }
        assert!(
            sizes.iter().any(|size| *size != sizes[0]),
            "the text tiles are meant to differ — they all came out the same size"
        );
    }

    /// A cross dissolve is a fade up at the head. It must not clear the tail fade the user set.
    #[test]
    fn a_cross_dissolve_sets_the_head_fade_and_leaves_the_tail_alone() {
        let mut editor = Editor::starter();
        let reference = select_title(&mut editor);
        editor.execute(Command::SetFades {
            reference: reference.clone(),
            fade_in: MediaTime::ZERO,
            fade_out: seconds(0.75),
        });

        apply(&mut editor, "trans.dissolve").unwrap();
        let element = editor.selected_element().expect("still selected");
        assert_eq!(element.fade_in().to_seconds_f64(), 0.5);
        assert_eq!(
            element.fade_out().to_seconds_f64(),
            0.75,
            "the tail fade was not what the user clicked on"
        );
    }

    #[test]
    fn a_dip_to_black_fades_both_ends() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        apply(&mut editor, "trans.dip").unwrap();
        let element = editor.selected_element().unwrap();
        assert_eq!(element.fade_in().to_seconds_f64(), 0.4);
        assert_eq!(element.fade_out().to_seconds_f64(), 0.4);
    }

    #[test]
    fn slide_and_zoom_animate_the_properties_they_name() {
        for (id, property, from) in [
            ("trans.slide", "x", -0.35f32),
            ("trans.zoom", "scale", 0.85),
        ] {
            let mut editor = Editor::starter();
            select_title(&mut editor);
            apply(&mut editor, id).unwrap();
            let element = editor.selected_element().unwrap();
            let channel = element
                .animations()
                .and_then(|channels| channels.get(property))
                .unwrap_or_else(|| panic!("{id} should animate {property}"));
            assert_eq!(channel.keys.len(), 2);
            assert_eq!(channel.keys[0].value, from);
            assert!(channel.keys[1].time.as_ticks() > 0);
        }
    }

    /// A 0.6 s zoom on a 0.3 s clip would put its landing key past the end, where it never
    /// plays — the clip would simply sit small for its whole life.
    #[test]
    fn an_entry_animation_is_clamped_to_a_short_clip() {
        let mut editor = Editor::starter();
        let reference = select_title(&mut editor);
        editor.execute(Command::SetElementDuration {
            reference: reference.clone(),
            duration: seconds(0.3),
        });
        apply(&mut editor, "trans.zoom").unwrap();

        let element = editor.selected_element().unwrap();
        let channel = element
            .animations()
            .and_then(|channels| channels.get("scale"))
            .expect("a scale channel");
        assert!(
            channel.keys[1].time <= element.duration(),
            "the landing key is past the end of the clip"
        );
        assert_eq!(channel.keys[1].value, 1.0, "and it must still land at full");
    }

    #[test]
    fn cut_clears_the_fades_and_the_entry_motion() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        apply(&mut editor, "trans.zoom").unwrap();
        apply(&mut editor, "trans.dip").unwrap();

        apply(&mut editor, "trans.none").unwrap();
        let element = editor.selected_element().unwrap();
        assert_eq!(element.fade_in(), MediaTime::ZERO);
        assert_eq!(element.fade_out(), MediaTime::ZERO);
        assert!(
            element
                .animations()
                .and_then(|channels| channels.get("scale"))
                .is_none_or(|channel| channel.keys.is_empty()),
            "the zoom is still on the clip"
        );
    }

    /// Ducking writes level keys, and only makes sense on audio.
    #[test]
    fn ducking_writes_level_keys_on_an_audio_clip() {
        let mut editor = Editor::starter();
        let audio = editor
            .active_scene()
            .tracks
            .iter()
            .find_map(|track| {
                track
                    .elements
                    .iter()
                    .find(|element| matches!(element, Element::Audio(_)))
                    .map(|element| ElementRef::new(track.id.clone(), element.id().to_string()))
            })
            .expect("the starter project has a music bed");
        editor.select(vec![audio]);

        apply(&mut editor, "audio.duck").unwrap();
        let element = editor.selected_element().unwrap();
        let channel = element
            .animations()
            .and_then(|channels| channels.get("volume"))
            .expect("level keys");
        assert_eq!(channel.keys.len(), 2);
        assert!((channel.keys[0].value - 0.355).abs() < 1e-6);
        assert_eq!(
            channel.keys[1].time,
            element.duration(),
            "the duck must cover the whole clip"
        );
    }

    /// Ducking a title is a mistake worth naming, not a silent no-op.
    #[test]
    fn ducking_a_visual_clip_is_refused_by_name() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        let mut next = ids();
        let error = plan(&editor, "audio.duck", &mut next).expect_err("a title has no level");
        let message = error.to_string();
        assert!(message.contains("Title"), "name the clip: {message}");
        assert!(message.contains("audio"), "{message}");
    }

    #[test]
    fn back_to_full_clears_the_duck_and_the_fades() {
        let mut editor = Editor::starter();
        let audio = editor
            .active_scene()
            .tracks
            .iter()
            .find_map(|track| {
                track
                    .elements
                    .iter()
                    .find(|element| matches!(element, Element::Audio(_)))
                    .map(|element| ElementRef::new(track.id.clone(), element.id().to_string()))
            })
            .unwrap();
        editor.select(vec![audio]);
        apply(&mut editor, "audio.duck").unwrap();
        apply(&mut editor, "audio.top-and-tail").unwrap();

        apply(&mut editor, "audio.full").unwrap();
        let element = editor.selected_element().unwrap();
        assert_eq!(element.fade_in(), MediaTime::ZERO);
        assert_eq!(element.fade_out(), MediaTime::ZERO);
        assert!(
            element
                .animations()
                .and_then(|channels| channels.get("volume"))
                .is_none_or(|channel| channel.keys.is_empty())
        );
    }

    #[test]
    fn audio_fades_do_not_clobber_each_other() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        apply(&mut editor, "audio.fade-in").unwrap();
        apply(&mut editor, "audio.fade-out").unwrap();
        let element = editor.selected_element().unwrap();
        assert_eq!(element.fade_in().to_seconds_f64(), 1.0);
        assert_eq!(element.fade_out().to_seconds_f64(), 1.0);
    }

    /// Every tile has to land as ONE undoable step, or a click takes two Cmd+Z to take back.
    #[test]
    fn a_tile_undoes_in_one_step() {
        let mut editor = Editor::starter();
        select_title(&mut editor);
        let before = editor.selected_element().unwrap().fade_in();

        apply(&mut editor, "trans.dip").unwrap();
        assert_ne!(editor.selected_element().unwrap().fade_in(), before);

        // `trans.dip` is one command; `trans.none` is two, and is the case that would need two
        // undos if the panel ever grew a multi-command tile without a transaction.
        editor.undo();
        assert_eq!(editor.selected_element().unwrap().fade_in(), before);
    }

    #[test]
    fn an_unknown_block_is_an_error_rather_than_a_panic() {
        let editor = Editor::starter();
        let mut next = ids();
        assert!(matches!(
            plan(&editor, "fx.does-not-exist", &mut next),
            Err(BlockError::UnknownBlock(_))
        ));
    }

    #[test]
    fn every_panel_has_a_distinct_label_glyph_and_title() {
        let mut labels: Vec<&str> = Panel::ALL.iter().map(|p| p.label()).collect();
        let mut glyphs: Vec<&str> = Panel::ALL.iter().map(|p| p.glyph()).collect();
        let mut titles: Vec<&str> = Panel::ALL.iter().map(|p| p.title()).collect();
        for list in [&mut labels, &mut glyphs, &mut titles] {
            list.sort_unstable();
            list.dedup();
        }
        assert_eq!(labels.len(), 5);
        assert_eq!(glyphs.len(), 5);
        assert_eq!(titles.len(), 5);
    }
}
