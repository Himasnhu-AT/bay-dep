//! The dark theme, as hex colors for `gpui::rgb`.
//!
//! One place, because two views that each pick their own `#1d1d26` drift the moment one of them
//! is adjusted. Every value here appears in the design; nothing is invented at a call site.

/// The window's ground.
pub const BG: u32 = 0x0f0f14;
/// Chrome that sits on the ground: toolbars, side panels, cards.
pub const PANEL: u32 = 0x16161d;
/// A control on a panel — buttons, chips, steppers.
pub const PANEL_ALT: u32 = 0x1d1d26;
/// A well: timeline lanes, input fields, progress troughs. Darker than the ground on purpose.
pub const LANE: u32 = 0x121218;
/// The rail down the left of the editor, and the preview's surround.
pub const RAIL: u32 = 0x121218;
pub const BORDER: u32 = 0x2a2a36;
/// A quieter border, for cards that should not read as separate objects.
pub const BORDER_SOFT: u32 = 0x1f1f28;
pub const TEXT: u32 = 0xe7e7ee;
pub const MUTED: u32 = 0x8a8a9a;
/// Third-level text: section labels, hints, counts.
pub const FAINT: u32 = 0x6f6f80;
pub const ACCENT: u32 = 0x5b8cff;
/// Text and dots on an accent-tinted surface.
pub const ACCENT_SOFT: u32 = 0x8fb0ff;
/// The fill behind a selected tab or an "on" toggle.
pub const SELECTED: u32 = 0x2d3a66;
pub const SELECTED_BORDER: u32 = 0x8fb0ff;
/// Timeline markers. Warm, so a marker is never mistaken for the playhead.
pub const MARKER: u32 = 0xf2b03c;
/// Something is working and it is fine.
pub const OK: u32 = 0x2f8f63;
/// Something needs a decision, or costs money.
pub const WARN: u32 = 0xf2b03c;
/// A destructive button that has been armed, and its label.
pub const DANGER: u32 = 0x7a2f3a;
pub const DANGER_TEXT: u32 = 0xffdde3;
/// An indicator that is off — a stopped server, a disabled provider.
pub const DIM_DOT: u32 = 0x3a3a48;
/// Text on an accent-filled button. The accent is light enough that white would smear.
pub const ON_ACCENT: u32 = 0x0f0f14;

// --- Interaction states ---
//
// Until now a control had exactly one appearance. "Disabled" was grey text on an identical
// fill with the click handler left off, which is indistinguishable from an enabled control
// whose label happens to be quiet — the user finds out by clicking and getting nothing.
// These four tokens are what let a control say, in its fill, which of the four states it is in.

/// A control under the pointer.
pub const HOVER: u32 = 0x24242f;
/// A control with the button held down on it.
pub const PRESSED: u32 = 0x2d2d3b;
/// A control that cannot be used. Below the ground on purpose: a recess reads as "nothing
/// happens here" before its label is read, which grey-on-identical-fill never did.
pub const DISABLED: u32 = 0x141419;
/// Text on a disabled control. Quieter than [`FAINT`], because faint is a *secondary* voice
/// and this one is switched off.
pub const DISABLED_TEXT: u32 = 0x55556a;
/// The keyboard focus ring. The accent, deliberately: focus and selection are the same idea,
/// and naming it separately is what lets one move without the other.
pub const FOCUS_RING: u32 = ACCENT;

/// Brighter than [`TEXT`], for the one element on screen that must win against everything else.
///
/// Exactly one thing uses it: the active page in the page bar. Nothing else on a page is allowed
/// to be louder than the label naming which mode you are in, because without that label the
/// six-page model collapses — nothing else on screen says which page you are looking at.
pub const EMPHASIS: u32 = 0xffffff;

/// The mode marker: the active page's underline, and the record state when one exists.
///
/// Red rather than [`ACCENT`], and that is deliberate. The blue accent already means *selection*
/// — a chosen clip, a focused control, an "on" toggle — and those come and go constantly. Which
/// page you are on is not a selection; it is where you are. A second colour is what keeps the
/// two from reading as the same kind of statement.
pub const RECORD: u32 = 0xe0454f;

/// What a control's fill should be, given how the pointer is treating it.
///
/// One function rather than a `match` at every call site, because the moment two buttons pick
/// their own hover colour the strip they sit in stops reading as one strip.
///
/// [`HOVER`] and [`PRESSED`] are the *neutral* answers, and they apply to a control whose resting
/// fill is neutral — nearly every button in the app. A coloured control brightens within its own
/// hue instead: the accent button turning grey under the pointer reads as the primary action
/// switching off, and an armed destructive button going grey reads as it disarming.
pub fn control_fill(base: u32, state: Interaction) -> u32 {
    match state {
        Interaction::Disabled => DISABLED,
        Interaction::Idle => base,
        Interaction::Hover if neutral(base) => HOVER,
        Interaction::Pressed if neutral(base) => PRESSED,
        Interaction::Hover => lighten(base, 0.16),
        Interaction::Pressed => lighten(base, 0.32),
    }
}

/// Whether a fill belongs to the grey chrome family, and so takes the named neutral states.
fn neutral(color: u32) -> bool {
    matches!(color, PANEL_ALT | PANEL | LANE | BG | SELECTED)
}

/// Move `color` this fraction of the way towards white.
///
/// For the two coloured button kinds, whose hover and pressed states have to stay in their own
/// hue. Not a token: it is derived from one, and naming every derivation is how a palette grows
/// a constant per button.
pub fn lighten(color: u32, amount: f32) -> u32 {
    let amount = if amount.is_finite() {
        amount.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let channel = |shift: u32| {
        let value = ((color >> shift) & 0xff) as f32;
        let lifted = value + (255.0 - value) * amount;
        ((lifted.round() as u32).min(0xff)) << shift
    };
    channel(16) | channel(8) | channel(0)
}

/// Text colour for a control in `state`.
pub fn control_text(base: u32, state: Interaction) -> u32 {
    match state {
        Interaction::Disabled => DISABLED_TEXT,
        _ => base,
    }
}

/// How the pointer is currently treating a control.
///
/// `Hover` and `Pressed` are supplied by GPUI's own `.hover()` / `.active()` refinements, so a
/// caller normally only chooses between `Idle` and `Disabled`; the other two exist so a control
/// that paints itself (a canvas widget, which gets no refinements) can say the same thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    Idle,
    Hover,
    Pressed,
    Disabled,
}

/// What a state *means*, in the vocabulary `settings_model.rs` already speaks.
///
/// That file is the existing authority: green for "working and fine", amber for "switched on
/// but cannot serve a request — the state a green dot would hide", red for failed or armed,
/// [`DIM_DOT`] for deliberately off, [`FAINT`] for not applicable on this machine. This enum
/// only gives those five a name so a second, contradictory scale is never invented next to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Working, free, nothing to decide.
    Ok,
    /// Needs a decision, or costs money, or is on but cannot serve.
    Warn,
    /// Failed, or armed and destructive.
    Danger,
    /// Deliberately switched off. Not a problem.
    Off,
    /// Not applicable here — unsupported, absent, out of scope.
    Absent,
}

impl Severity {
    /// The status dot, and any small mark that carries the same meaning.
    pub fn dot(self) -> u32 {
        match self {
            Severity::Ok => OK,
            Severity::Warn => WARN,
            Severity::Danger => DANGER,
            Severity::Off => DIM_DOT,
            Severity::Absent => FAINT,
        }
    }

    /// Text stating the condition. Danger reads on the ground, not on a red fill, so it uses
    /// the light [`DANGER_TEXT`] rather than the fill colour.
    pub fn text(self) -> u32 {
        match self {
            Severity::Ok => OK,
            Severity::Warn => WARN,
            Severity::Danger => DANGER_TEXT,
            Severity::Off => DIM_DOT,
            Severity::Absent => FAINT,
        }
    }
}

/// Every colour constant in this file, by name.
///
/// The ladder test iterates *this*, not a hand-picked handful, so adding a token that repeats
/// an existing one fails. `every_token_is_in_the_ladder` keeps the list complete by reading
/// this file's own source — a new `pub const … u32` that is not listed here is a test failure,
/// which is the only way the coverage claim above stays true as tokens are added.
pub const ALL_TOKENS: &[(&str, u32)] = &[
    ("BG", BG),
    ("PANEL", PANEL),
    ("PANEL_ALT", PANEL_ALT),
    ("LANE", LANE),
    ("RAIL", RAIL),
    ("BORDER", BORDER),
    ("BORDER_SOFT", BORDER_SOFT),
    ("TEXT", TEXT),
    ("MUTED", MUTED),
    ("FAINT", FAINT),
    ("ACCENT", ACCENT),
    ("ACCENT_SOFT", ACCENT_SOFT),
    ("SELECTED", SELECTED),
    ("SELECTED_BORDER", SELECTED_BORDER),
    ("MARKER", MARKER),
    ("OK", OK),
    ("WARN", WARN),
    ("DANGER", DANGER),
    ("DANGER_TEXT", DANGER_TEXT),
    ("DIM_DOT", DIM_DOT),
    ("ON_ACCENT", ON_ACCENT),
    ("HOVER", HOVER),
    ("PRESSED", PRESSED),
    ("DISABLED", DISABLED),
    ("DISABLED_TEXT", DISABLED_TEXT),
    ("FOCUS_RING", FOCUS_RING),
    ("EMPHASIS", EMPHASIS),
    ("RECORD", RECORD),
];

/// The pairs that are the same colour **on purpose**, and why.
///
/// Declared once, here, so an accidental duplicate still fails the ladder. Adding a pair is a
/// decision someone has to write down rather than a test someone has to weaken.
pub const DELIBERATE_ALIASES: &[(&str, &str)] = &[
    // The rail is the same well as a timeline lane: both are things the UI sits *in*.
    ("RAIL", "LANE"),
    // Focus is selection. See FOCUS_RING.
    ("FOCUS_RING", "ACCENT"),
    // A label on an accent-filled button is the window's own ground colour: the accent is light
    // enough that white smears on it, and punching the background through reads as engraved.
    ("ON_ACCENT", "BG"),
    // Both are "the accent, lightened until it reads on a tinted surface". One names the text on
    // such a surface, the other the outline around a selected object; they have never differed
    // and there is no design in which one moves without the other.
    ("ACCENT_SOFT", "SELECTED_BORDER"),
    // The palette has one amber and two things to say with it: a timeline marker, and a state
    // that needs a decision. Of the four pairs here this is the one most likely to want
    // splitting — a warning that darkens would silently darken every marker pip with it.
    ("MARKER", "WARN"),
];

/// Block fill per element kind label ("Video" / "Image" / "Text" / "Audio").
pub fn element_color(kind_label: &str) -> u32 {
    match kind_label {
        "Video" => 0x33628f,
        "Image" => 0x7a4f95,
        "Text" => 0x8f6a33,
        "Audio" => 0x2f8f63,
        _ => 0x444455,
    }
}

/// Parse a `#rrggbb` string into a `0xRRGGBB` value, falling back to mid-grey.
pub fn hex_to_rgb(hex: &str) -> u32 {
    u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0x808080)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A theme where two "different" roles are the same colour is a theme with a copy-paste
    /// mistake in it, and it shows up as a border that is invisible against its own card.
    ///
    /// This used to iterate four hand-listed surfaces, which meant a token added afterwards was
    /// never checked and the coverage was a claim rather than a fact. It now iterates
    /// [`ALL_TOKENS`]; a genuine alias has to be declared in `DELIBERATE_ALIASES` with a reason.
    #[test]
    fn the_surface_ladder_is_actually_a_ladder() {
        let allowed = |a: &str, b: &str| {
            DELIBERATE_ALIASES
                .iter()
                .any(|(x, y)| (*x == a && *y == b) || (*x == b && *y == a))
        };
        for (index, (name, color)) in ALL_TOKENS.iter().enumerate() {
            for (other_name, other) in &ALL_TOKENS[index + 1..] {
                assert!(
                    color != other || allowed(name, other_name),
                    "{name} and {other_name} are both {color:#08x}; \
                     if that is deliberate, say so in DELIBERATE_ALIASES"
                );
            }
        }
    }

    /// The list above is only worth iterating if it is complete. Read this file's own source and
    /// insist every colour constant in it is listed, so the previous test cannot quietly stop
    /// covering a token the moment someone adds one.
    #[test]
    fn every_token_is_in_the_ladder() {
        let source = include_str!("theme.rs");
        let declared: Vec<&str> = source
            .lines()
            .filter_map(|line| line.trim().strip_prefix("pub const "))
            .filter_map(|rest| rest.split_once(": u32"))
            .map(|(name, _)| name)
            .collect();
        assert!(
            declared.len() >= 28,
            "the source scan found only {} constants — has the declaration syntax changed?",
            declared.len()
        );
        for name in declared {
            assert!(
                ALL_TOKENS.iter().any(|(listed, _)| *listed == name),
                "{name} is a theme colour that ALL_TOKENS does not list, so nothing checks it"
            );
        }
    }

    /// Every alias has to name two real tokens that really are equal, or the escape hatch above
    /// starts hiding mistakes instead of documenting decisions.
    #[test]
    fn a_declared_alias_is_a_real_one() {
        let value = |name: &str| {
            ALL_TOKENS
                .iter()
                .find(|(listed, _)| *listed == name)
                .unwrap_or_else(|| panic!("{name} is aliased but is not a token"))
                .1
        };
        for (a, b) in DELIBERATE_ALIASES {
            assert_eq!(
                value(a),
                value(b),
                "{a} and {b} are declared equal, but differ"
            );
        }
    }

    /// A disabled control has to differ from an enabled one in its *fill*, not only its label.
    #[test]
    fn the_four_interaction_states_are_four_appearances() {
        // Every resting fill a button can have, neutral and coloured alike.
        for base in [PANEL_ALT, SELECTED, ACCENT, DANGER] {
            let fills: Vec<u32> = [
                Interaction::Idle,
                Interaction::Hover,
                Interaction::Pressed,
                Interaction::Disabled,
            ]
            .iter()
            .map(|state| control_fill(base, *state))
            .collect();
            let mut distinct = fills.clone();
            distinct.sort_unstable();
            distinct.dedup();
            assert_eq!(
                distinct.len(),
                4,
                "two pointer states on {base:#08x} look identical: {fills:#08x?}"
            );
        }
        assert_eq!(control_text(TEXT, Interaction::Disabled), DISABLED_TEXT);
        assert_eq!(control_text(TEXT, Interaction::Hover), TEXT);
    }

    /// A coloured button stays its own colour under the pointer. The accent button turning grey
    /// on hover reads as the primary action switching off, not as it being pointed at.
    #[test]
    fn a_coloured_button_hovers_within_its_own_hue() {
        // Which channel dominates is enough: the accent is blue-dominant, danger red.
        let dominance = |color: u32| {
            let (r, g, b) = (color >> 16 & 0xff, color >> 8 & 0xff, color & 0xff);
            (r > g && r > b, b > r && b > g)
        };
        for base in [ACCENT, DANGER] {
            for state in [Interaction::Hover, Interaction::Pressed] {
                let fill = control_fill(base, state);
                assert_ne!(fill, HOVER);
                assert_ne!(fill, PRESSED);
                assert_eq!(
                    dominance(fill),
                    dominance(base),
                    "{base:#08x} changed hue in {state:?}"
                );
            }
        }
    }

    #[test]
    fn lightening_moves_towards_white_and_stops_there() {
        assert_eq!(lighten(0x000000, 0.0), 0x000000);
        assert_eq!(lighten(0x000000, 1.0), 0xffffff);
        assert_eq!(lighten(0xffffff, 0.5), 0xffffff);
        assert_eq!(lighten(0x804020, 0.0), 0x804020);
        // Out-of-range and nonsense amounts clamp rather than wrapping a channel.
        assert_eq!(lighten(0x804020, 9.0), 0xffffff);
        assert_eq!(lighten(0x804020, -1.0), 0x804020);
        assert_eq!(lighten(0x804020, f32::NAN), 0x804020);
        assert_ne!(lighten(ACCENT, 0.2), ACCENT);
    }

    /// Five meanings, five appearances — and each one is the colour `settings_model.rs` already
    /// uses for it, so the settings screen and a widget never disagree about what amber means.
    #[test]
    fn severity_reuses_the_settings_vocabulary() {
        assert_eq!(Severity::Ok.dot(), OK);
        assert_eq!(Severity::Warn.dot(), WARN);
        assert_eq!(Severity::Danger.dot(), DANGER);
        assert_eq!(Severity::Off.dot(), DIM_DOT);
        assert_eq!(Severity::Absent.dot(), FAINT);
        assert_eq!(Severity::Danger.text(), DANGER_TEXT);

        let dots: Vec<u32> = [
            Severity::Ok,
            Severity::Warn,
            Severity::Danger,
            Severity::Off,
            Severity::Absent,
        ]
        .iter()
        .map(|severity| severity.dot())
        .collect();
        let mut distinct = dots.clone();
        distinct.sort_unstable();
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            5,
            "two severities look the same: {dots:#08x?}"
        );
    }

    /// The text ladder has to get darker, or "muted" and "faint" are just two names for the
    /// same emphasis.
    #[test]
    fn text_gets_quieter_down_the_ladder() {
        let brightness = |color: u32| {
            let (r, g, b) = (color >> 16 & 0xff, color >> 8 & 0xff, color & 0xff);
            r + g + b
        };
        assert!(brightness(TEXT) > brightness(MUTED));
        assert!(brightness(MUTED) > brightness(FAINT));
        assert!(
            brightness(EMPHASIS) > brightness(TEXT),
            "the active page has to beat ordinary text, or it does not name the mode"
        );
        assert!(
            brightness(FAINT) > brightness(DISABLED_TEXT),
            "a switched-off label must be quieter than a merely quiet one"
        );
        assert!(
            brightness(DISABLED_TEXT) > brightness(BG),
            "text must beat the ground"
        );
        // A control that cannot be used still has to be *findable*: its recess must read
        // against the panel it sits on, or the map of remaining engine work is invisible.
        assert_ne!(DISABLED, PANEL);
        assert!(brightness(PRESSED) > brightness(HOVER));
        assert!(brightness(HOVER) > brightness(PANEL_ALT));
    }

    #[test]
    fn element_colors_are_distinct_per_kind() {
        let kinds = ["Video", "Image", "Text", "Audio"];
        let mut colors: Vec<u32> = kinds.iter().map(|kind| element_color(kind)).collect();
        let total = colors.len();
        colors.sort_unstable();
        colors.dedup();
        assert_eq!(colors.len(), total, "two clip kinds draw the same colour");
        assert!(
            !colors.contains(&element_color("Shape")),
            "unknown kinds fall back"
        );
    }

    #[test]
    fn hex_parsing_handles_both_spellings_and_survives_nonsense() {
        assert_eq!(hex_to_rgb("#5b8cff"), ACCENT);
        assert_eq!(hex_to_rgb("5b8cff"), ACCENT);
        assert_eq!(hex_to_rgb("not a colour"), 0x808080);
        assert_eq!(hex_to_rgb(""), 0x808080);
    }
}
