//! The dark theme, as hex colors for `gpui::rgb`.
//!
//! One place, because two views that each pick their own `#1d1d26` drift the moment one of them
//! is adjusted. Every value here appears in the design; nothing is invented at a call site.

// ------------------------------------------------------------------------------------------
// Roles, paints, and the palette that resolves them
// ------------------------------------------------------------------------------------------

/// A named place in the design, rather than a colour.
///
/// **The token's type is what makes the theme runtime-configurable.** The tokens below used to be
/// `pub const BG: u32 = 0x0f0f14` and the call sites read `rgb(theme::BG)` — which reads like a
/// role and is a hex, so there is no point in the program where a different theme could be
/// consulted. Changing the *type* rather than the spelling means all 413 call sites compile
/// unchanged: `Role` is `Copy + Eq`, so `if`/`match` arms over two tokens unify exactly as `u32`
/// did, and `Hsla` is a drop-in for `Rgba` in `.bg()`, `.text_color()`, `.border_color()` and
/// `paint_path`.
///
/// A new role without a colour is a **compile** error, not a test failure, because
/// [`Palette::resolve`] is an exhaustive match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Bg,
    Panel,
    PanelAlt,
    Lane,
    Rail,
    Border,
    BorderSoft,
    Text,
    Muted,
    Faint,
    Accent,
    AccentSoft,
    Selected,
    SelectedBorder,
    Marker,
    Ok,
    Warn,
    Danger,
    DangerText,
    DimDot,
    OnAccent,
    Hover,
    Pressed,
    Disabled,
    DisabledText,
    FocusRing,
    Emphasis,
    Record,
    /// The four element kinds. Promoted from `element_color`'s hardcoded hexes, which were
    /// invisible to the ladder test and could not follow a theme.
    ElementVideo,
    ElementImage,
    ElementText,
    ElementAudio,
}

/// Something that can be painted: a role, a role lifted towards white, or a literal colour.
///
/// `Shade` is what `lighten` produced as a `u32` before. Keeping it as a *description* rather
/// than a computed hex is what lets a derived colour follow a theme change — a hover state
/// computed at const time is a hover state pinned to the palette it was computed from.
///
/// `Rgb` is the escape hatch for a colour that genuinely comes from the document rather than the
/// design: a clip's background, a user-picked text colour. Those are data, not theme.
///
/// Holds an `f32`, so `PartialEq` only — never ask for `Eq`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Paint {
    Role(Role),
    /// A role, moved this fraction of the way towards white.
    Shade(Role, f32),
    /// A literal colour from the document.
    Rgb(u32),
}

impl From<Role> for Paint {
    fn from(role: Role) -> Self {
        Paint::Role(role)
    }
}

impl From<u32> for Paint {
    fn from(hex: u32) -> Self {
        Paint::Rgb(hex)
    }
}

/// Every role's colour, for one theme.
///
/// A plain struct of hexes rather than a map: `resolve` is then an exhaustive match, so adding a
/// role without giving it a colour does not compile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    pub bg: u32,
    pub panel: u32,
    pub panel_alt: u32,
    pub lane: u32,
    pub rail: u32,
    pub border: u32,
    pub border_soft: u32,
    pub text: u32,
    pub muted: u32,
    pub faint: u32,
    pub accent: u32,
    pub accent_soft: u32,
    pub selected: u32,
    pub selected_border: u32,
    pub marker: u32,
    pub ok: u32,
    pub warn: u32,
    pub danger: u32,
    pub danger_text: u32,
    pub dim_dot: u32,
    pub on_accent: u32,
    pub hover: u32,
    pub pressed: u32,
    pub disabled: u32,
    pub disabled_text: u32,
    pub focus_ring: u32,
    pub emphasis: u32,
    pub record: u32,
    pub element_video: u32,
    pub element_image: u32,
    pub element_text: u32,
    pub element_audio: u32,
}

impl Palette {
    /// bay's own dark theme — the exact hexes the app shipped with, so the flip to roles moves
    /// no pixel and `./test.sh` is the proof.
    pub const BUILTIN_DARK: Palette = Palette {
        bg: 0x0f0f14,
        panel: 0x16161d,
        panel_alt: 0x1d1d26,
        lane: 0x121218,
        rail: 0x121218,
        border: 0x2a2a36,
        border_soft: 0x1f1f28,
        text: 0xe7e7ee,
        muted: 0x8a8a9a,
        faint: 0x6f6f80,
        accent: 0x5b8cff,
        accent_soft: 0x8fb0ff,
        selected: 0x2d3a66,
        selected_border: 0x8fb0ff,
        marker: 0xf2b03c,
        ok: 0x2f8f63,
        warn: 0xf2b03c,
        danger: 0x7a2f3a,
        danger_text: 0xffdde3,
        dim_dot: 0x3a3a48,
        on_accent: 0x0f0f14,
        hover: 0x24242f,
        pressed: 0x2d2d3b,
        disabled: 0x141419,
        disabled_text: 0x55556a,
        focus_ring: 0x5b8cff,
        emphasis: 0xffffff,
        record: 0xe0454f,
        element_video: 0x33628f,
        element_image: 0x7a4f95,
        element_text: 0x8f6a33,
        element_audio: 0x2f8f63,
    };

    /// The colour of one role. Exhaustive on purpose — see [`Role`].
    pub const fn resolve(&self, role: Role) -> u32 {
        match role {
            Role::Bg => self.bg,
            Role::Panel => self.panel,
            Role::PanelAlt => self.panel_alt,
            Role::Lane => self.lane,
            Role::Rail => self.rail,
            Role::Border => self.border,
            Role::BorderSoft => self.border_soft,
            Role::Text => self.text,
            Role::Muted => self.muted,
            Role::Faint => self.faint,
            Role::Accent => self.accent,
            Role::AccentSoft => self.accent_soft,
            Role::Selected => self.selected,
            Role::SelectedBorder => self.selected_border,
            Role::Marker => self.marker,
            Role::Ok => self.ok,
            Role::Warn => self.warn,
            Role::Danger => self.danger,
            Role::DangerText => self.danger_text,
            Role::DimDot => self.dim_dot,
            Role::OnAccent => self.on_accent,
            Role::Hover => self.hover,
            Role::Pressed => self.pressed,
            Role::Disabled => self.disabled,
            Role::DisabledText => self.disabled_text,
            Role::FocusRing => self.focus_ring,
            Role::Emphasis => self.emphasis,
            Role::Record => self.record,
            Role::ElementVideo => self.element_video,
            Role::ElementImage => self.element_image,
            Role::ElementText => self.element_text,
            Role::ElementAudio => self.element_audio,
        }
    }
}

// The palette in force. Swapped by `set_palette` when the theme changes.
//
// A thread-local rather than a GPUI global, because `rgb` is called from `draw`'s canvas closures
// and from `widgets` free functions, neither of which has an `&App` to read a global from — and
// threading one through 413 call sites is the change this design exists to avoid. The UI is
// single-threaded, so there is exactly one of these.
thread_local! {
    static PALETTE: std::cell::Cell<Palette> = const { std::cell::Cell::new(Palette::BUILTIN_DARK) };
}

/// Install a palette. Every later `rgb` resolves against it.
pub fn set_palette(palette: Palette) {
    PALETTE.with(|current| current.set(palette));
}

/// The palette in force.
pub fn palette() -> Palette {
    PALETTE.with(|current| current.get())
}

/// Resolve a [`Paint`] against the live palette.
///
/// **Shadows `gpui::rgb` on purpose.** The eight files that imported `rgb` from gpui now import
/// this instead, one line each, and every call site below them is unchanged — that is the whole
/// mechanism. Returns `Hsla` because that is what gpui's style setters take.
pub fn rgb(paint: impl Into<Paint>) -> gpui::Hsla {
    let paint = paint.into();
    let palette = palette();
    let hex = match paint {
        Paint::Role(role) => palette.resolve(role),
        Paint::Shade(role, amount) => lighten_hex(palette.resolve(role), amount),
        Paint::Rgb(hex) => hex,
    };
    gpui::rgb(hex).into()
}

/// Move a literal colour towards white. The arithmetic [`lighten`] used to do on a token.
pub fn lighten_hex(color: u32, amount: f32) -> u32 {
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

/// The window's ground.
pub const BG: Role = Role::Bg;
/// Chrome that sits on the ground: toolbars, side panels, cards.
pub const PANEL: Role = Role::Panel;
/// A control on a panel — buttons, chips, steppers.
pub const PANEL_ALT: Role = Role::PanelAlt;
/// A well: timeline lanes, input fields, progress troughs. Darker than the ground on purpose.
pub const LANE: Role = Role::Lane;
/// The rail down the left of the editor, and the preview's surround.
pub const RAIL: Role = Role::Rail;
pub const BORDER: Role = Role::Border;
/// A quieter border, for cards that should not read as separate objects.
pub const BORDER_SOFT: Role = Role::BorderSoft;
pub const TEXT: Role = Role::Text;
pub const MUTED: Role = Role::Muted;
/// Third-level text: section labels, hints, counts.
pub const FAINT: Role = Role::Faint;
pub const ACCENT: Role = Role::Accent;
/// Text and dots on an accent-tinted surface.
pub const ACCENT_SOFT: Role = Role::AccentSoft;
/// The fill behind a selected tab or an "on" toggle.
pub const SELECTED: Role = Role::Selected;
pub const SELECTED_BORDER: Role = Role::SelectedBorder;
/// Timeline markers. Warm, so a marker is never mistaken for the playhead.
pub const MARKER: Role = Role::Marker;
/// Something is working and it is fine.
pub const OK: Role = Role::Ok;
/// Something needs a decision, or costs money.
pub const WARN: Role = Role::Warn;
/// A destructive button that has been armed, and its label.
pub const DANGER: Role = Role::Danger;
pub const DANGER_TEXT: Role = Role::DangerText;
/// An indicator that is off — a stopped server, a disabled provider.
pub const DIM_DOT: Role = Role::DimDot;
/// Text on an accent-filled button. The accent is light enough that white would smear.
pub const ON_ACCENT: Role = Role::OnAccent;

// --- Interaction states ---
//
// Until now a control had exactly one appearance. "Disabled" was grey text on an identical
// fill with the click handler left off, which is indistinguishable from an enabled control
// whose label happens to be quiet — the user finds out by clicking and getting nothing.
// These four tokens are what let a control say, in its fill, which of the four states it is in.

/// A control under the pointer.
pub const HOVER: Role = Role::Hover;
/// A control with the button held down on it.
pub const PRESSED: Role = Role::Pressed;
/// A control that cannot be used. Below the ground on purpose: a recess reads as "nothing
/// happens here" before its label is read, which grey-on-identical-fill never did.
pub const DISABLED: Role = Role::Disabled;
/// Text on a disabled control. Quieter than [`FAINT`], because faint is a *secondary* voice
/// and this one is switched off.
pub const DISABLED_TEXT: Role = Role::DisabledText;
/// The keyboard focus ring. The accent, deliberately: focus and selection are the same idea,
/// and naming it separately is what lets one move without the other.
pub const FOCUS_RING: Role = Role::FocusRing;

/// Brighter than [`TEXT`], for the one element on screen that must win against everything else.
///
/// Exactly one thing uses it: the active page in the page bar. Nothing else on a page is allowed
/// to be louder than the label naming which mode you are in, because without that label the
/// six-page model collapses — nothing else on screen says which page you are looking at.
pub const EMPHASIS: Role = Role::Emphasis;

/// The mode marker: the active page's underline, and the record state when one exists.
///
/// Red rather than [`ACCENT`], and that is deliberate. The blue accent already means *selection*
/// — a chosen clip, a focused control, an "on" toggle — and those come and go constantly. Which
/// page you are on is not a selection; it is where you are. A second colour is what keeps the
/// two from reading as the same kind of statement.
pub const RECORD: Role = Role::Record;

/// What a control's fill should be, given how the pointer is treating it.
///
/// One function rather than a `match` at every call site, because the moment two buttons pick
/// their own hover colour the strip they sit in stops reading as one strip.
///
/// [`HOVER`] and [`PRESSED`] are the *neutral* answers, and they apply to a control whose resting
/// fill is neutral — nearly every button in the app. A coloured control brightens within its own
/// hue instead: the accent button turning grey under the pointer reads as the primary action
/// switching off, and an armed destructive button going grey reads as it disarming.
pub fn control_fill(base: Role, state: Interaction) -> Paint {
    match state {
        Interaction::Disabled => Paint::Role(DISABLED),
        Interaction::Idle => Paint::Role(base),
        Interaction::Hover if neutral(base) => Paint::Role(HOVER),
        Interaction::Pressed if neutral(base) => Paint::Role(PRESSED),
        // A *description*, not a computed hex. `lighten(base, 0.16)` used to fold the palette in
        // at const time, which pins a hover state to the palette it was computed from; deferring
        // it to `rgb` is what lets a derived colour follow a theme change.
        Interaction::Hover => Paint::Shade(base, 0.16),
        Interaction::Pressed => Paint::Shade(base, 0.32),
    }
}

/// Whether a fill belongs to the grey chrome family, and so takes the named neutral states.
fn neutral(role: Role) -> bool {
    // Matched on *identity*, not on colour value. As a `u32` this compared hexes, so `RAIL` was
    // accidentally neutral because `RAIL == LANE` — true today, and silently wrong the first time
    // a theme gives them different colours.
    matches!(
        role,
        Role::PanelAlt | Role::Panel | Role::Lane | Role::Bg | Role::Selected
    )
}

/// Move `color` this fraction of the way towards white.
///
/// For the two coloured button kinds, whose hover and pressed states have to stay in their own
/// hue. Not a token: it is derived from one, and naming every derivation is how a palette grows
/// a constant per button.
pub fn lighten(role: Role, amount: f32) -> Paint {
    Paint::Shade(role, amount)
}

/// Text colour for a control in `state`.
pub fn control_text(base: Role, state: Interaction) -> Role {
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
    pub fn dot(self) -> Role {
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
    pub fn text(self) -> Role {
        match self {
            Severity::Ok => OK,
            Severity::Warn => WARN,
            Severity::Danger => DANGER_TEXT,
            Severity::Off => DIM_DOT,
            Severity::Absent => FAINT,
        }
    }
}

/// Every role in this file, by name.
///
/// The ladder test iterates *this*, not a hand-picked handful, so a token that repeats an
/// existing one fails. `every_token_is_in_the_ladder` keeps the list complete by reading this
/// file's own source — a `pub const … Role` that is not listed here is a test failure, which is
/// the only way the coverage claim above stays true as roles are added.
///
/// The element-kind roles are deliberately absent: they are not chrome, they are the four clip
/// colours, and holding two of them to a contrast ladder against the ground would be a rule about
/// the wrong thing.
pub const ALL_TOKENS: &[(&str, Role)] = &[
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
pub fn element_color(kind_label: &str) -> Role {
    match kind_label {
        "Video" => Role::ElementVideo,
        "Image" => Role::ElementImage,
        "Text" => Role::ElementText,
        "Audio" => Role::ElementAudio,
        // A kind the palette has no colour for. `DimDot` rather than a fifth role: an unknown
        // element is not a *kind*, it is the absence of one, and giving it a role would invite a
        // theme to style something that should never appear.
        _ => Role::DimDot,
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
        // Resolved against the palette in force, not against a constant. That is what makes
        // this a check on *a theme* rather than on the one theme that used to be hardcoded — a
        // user-supplied palette that collapses two roles now fails the same way.
        let palette = palette();
        for (index, (name, role)) in ALL_TOKENS.iter().enumerate() {
            let color = palette.resolve(*role);
            for (other_name, other) in &ALL_TOKENS[index + 1..] {
                let other = palette.resolve(*other);
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
        // `= Role::` is required, not just `: Role`. Without it the scan also matched
        // `pub const fn resolve(&self, role: Role)` and reported a function as an unlisted token.
        let declared: Vec<&str> = source
            .lines()
            .map(str::trim)
            .filter(|line| line.contains("= Role::"))
            .filter_map(|line| line.strip_prefix("pub const "))
            .filter_map(|rest| rest.split_once(": Role"))
            .map(|(name, _)| name)
            .collect();
        assert!(
            declared.len() >= 28,
            "the source scan found only {} roles — has the declaration syntax changed?",
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
        let palette = palette();
        let value = |name: &str| {
            palette.resolve(
                ALL_TOKENS
                    .iter()
                    .find(|(listed, _)| *listed == name)
                    .unwrap_or_else(|| panic!("{name} is aliased but is not a token"))
                    .1,
            )
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
            let palette = palette();
            // Resolved, because `control_fill` returns a *description* now — `Shade(base, 0.16)`
            // rather than a computed hex. Comparing descriptions would call two shades of the
            // same role distinct without checking they actually look different.
            let resolve = |paint: Paint| match paint {
                Paint::Role(role) => palette.resolve(role),
                Paint::Shade(role, amount) => lighten_hex(palette.resolve(role), amount),
                Paint::Rgb(hex) => hex,
            };
            let fills: Vec<u32> = [
                Interaction::Idle,
                Interaction::Hover,
                Interaction::Pressed,
                Interaction::Disabled,
            ]
            .iter()
            .map(|state| resolve(control_fill(base, *state)))
            .collect();
            let mut distinct = fills.clone();
            distinct.sort_unstable();
            distinct.dedup();
            assert_eq!(
                distinct.len(),
                4,
                "two pointer states on {base:?} look identical: {fills:#08x?}"
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
        let palette = palette();
        let resolve = |paint: Paint| match paint {
            Paint::Role(role) => palette.resolve(role),
            Paint::Shade(role, amount) => lighten_hex(palette.resolve(role), amount),
            Paint::Rgb(hex) => hex,
        };
        for base in [ACCENT, DANGER] {
            for state in [Interaction::Hover, Interaction::Pressed] {
                let fill = resolve(control_fill(base, state));
                assert_ne!(fill, palette.resolve(HOVER));
                assert_ne!(fill, palette.resolve(PRESSED));
                assert_eq!(
                    dominance(fill),
                    dominance(palette.resolve(base)),
                    "{base:?} changed hue in {state:?}"
                );
            }
        }
    }

    #[test]
    fn lightening_moves_towards_white_and_stops_there() {
        // `lighten_hex` is the arithmetic; `lighten` is now the *description* that defers it.
        assert_eq!(lighten_hex(0x000000, 0.0), 0x000000);
        assert_eq!(lighten_hex(0x000000, 1.0), 0xffffff);
        assert_eq!(lighten_hex(0xffffff, 0.5), 0xffffff);
        assert_eq!(lighten_hex(0x804020, 0.0), 0x804020);
        // Out-of-range and nonsense amounts clamp rather than wrapping a channel.
        assert_eq!(lighten_hex(0x804020, 9.0), 0xffffff);
        assert_eq!(lighten_hex(0x804020, -1.0), 0x804020);
        assert_eq!(lighten_hex(0x804020, f32::NAN), 0x804020);

        let palette = palette();
        assert_ne!(
            lighten_hex(palette.resolve(ACCENT), 0.2),
            palette.resolve(ACCENT)
        );
        // And the deferred form describes the same thing rather than resolving early.
        assert_eq!(lighten(ACCENT, 0.2), Paint::Shade(ACCENT, 0.2));
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

        let palette = palette();
        let dots: Vec<u32> = [
            Severity::Ok,
            Severity::Warn,
            Severity::Danger,
            Severity::Off,
            Severity::Absent,
        ]
        .iter()
        .map(|severity| palette.resolve(severity.dot()))
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

    /// A palette swap re-colours bay's own chrome, which is the whole point of `Role`.
    ///
    /// Before this change the tokens were `pub const BG: u32 = 0x0f0f14` and the call sites read
    /// `rgb(theme::BG)` — which *reads* like a role and *is* a hex, so there was no point in the
    /// program where a different theme could be consulted. This test is the difference.
    #[test]
    fn swapping_the_palette_changes_what_a_role_resolves_to() {
        let original = palette();
        let before = palette().resolve(BG);

        let mut light = Palette::BUILTIN_DARK;
        light.bg = 0xfdfdfd;
        light.text = 0x101014;
        set_palette(light);

        assert_eq!(palette().resolve(BG), 0xfdfdfd);
        assert_ne!(palette().resolve(BG), before, "the swap changed nothing");
        assert_eq!(palette().resolve(TEXT), 0x101014);

        // Leave the thread as it was found: these tests share a thread-local.
        set_palette(original);
        assert_eq!(palette().resolve(BG), before);
    }

    /// A derived colour follows the theme too.
    ///
    /// `control_fill` used to fold the palette in at const time — `lighten(base, 0.16)` returned
    /// a hex — which pins a hover state to the palette it was computed from. Returning a
    /// `Paint::Shade` description and resolving it in `rgb` is what makes a hover state a
    /// function of the live theme rather than of the one that was compiled in.
    #[test]
    fn a_derived_hover_colour_follows_the_palette() {
        let original = palette();

        let dark_hover = match control_fill(ACCENT, Interaction::Hover) {
            Paint::Shade(role, amount) => lighten_hex(palette().resolve(role), amount),
            other => panic!("expected a shade, got {other:?}"),
        };

        let mut swapped = Palette::BUILTIN_DARK;
        swapped.accent = 0x992200;
        set_palette(swapped);
        let light_hover = match control_fill(ACCENT, Interaction::Hover) {
            Paint::Shade(role, amount) => lighten_hex(palette().resolve(role), amount),
            other => panic!("expected a shade, got {other:?}"),
        };

        assert_ne!(
            dark_hover, light_hover,
            "the hover state did not follow the accent it is derived from"
        );
        set_palette(original);
    }

    /// `RAIL` and `LANE` are the same colour today, and `neutral` must not depend on that.
    ///
    /// As a `u32` this matched on colour *value*, so `neutral(RAIL)` was accidentally true
    /// because `RAIL == LANE`. Correct today and silently wrong the first time a theme gives them
    /// different colours — a control on the rail would start taking coloured hover states.
    #[test]
    fn neutrality_is_decided_by_identity_not_by_colour() {
        let original = palette();
        let mut split = Palette::BUILTIN_DARK;
        split.rail = 0x445566; // no longer equal to `lane`
        set_palette(split);

        assert!(neutral(Role::Lane));
        assert!(
            !neutral(Role::Rail),
            "RAIL is not in the neutral set and must not become neutral by matching LANE's hex"
        );
        set_palette(original);
    }

    /// The text ladder has to separate, or "muted" and "faint" are two names for one emphasis.
    ///
    /// **Contrast against the ground, not brightness.** The old version asserted that each step
    /// was *darker* than the one above, which is true of a dark theme and exactly backwards in a
    /// light one — so the moment the palette became runtime data this test would have started
    /// enforcing dark mode. Distance from the ground says the same thing about a dark theme and
    /// is still right when the ground is white, and it catches a failure the brightness form
    /// could not: a token that drifts *towards* the background is unreadable whichever direction
    /// it drifted from.
    #[test]
    fn text_separates_from_the_ground_down_the_ladder() {
        let palette = palette();
        let luminance = |role: Role| {
            let color = palette.resolve(role);
            let (r, g, b) = (color >> 16 & 0xff, color >> 8 & 0xff, color & 0xff);
            // Rec. 601 weights: green carries most of perceived brightness, blue least. A flat
            // sum calls #0000ff and #00ff00 equally bright, which no eye does.
            (0.299 * r as f32) + (0.587 * g as f32) + (0.114 * b as f32)
        };
        let ground = luminance(BG);
        let contrast = |role: Role| (luminance(role) - ground).abs();

        assert!(
            contrast(TEXT) > contrast(MUTED),
            "body text does not stand out more than muted text"
        );
        assert!(
            contrast(MUTED) > contrast(FAINT),
            "muted and faint are the same emphasis"
        );
        assert!(
            contrast(EMPHASIS) > contrast(TEXT),
            "the active page has to beat ordinary text, or it does not name the mode"
        );
        assert!(
            contrast(FAINT) > contrast(DISABLED_TEXT),
            "a switched-off label must be quieter than a merely quiet one"
        );
        assert!(
            contrast(DISABLED_TEXT) > 0.0,
            "disabled text is the ground colour, so it cannot be read at all"
        );
        // A control that cannot be used still has to be *findable*: its recess must read against
        // the panel it sits on, or the map of remaining engine work is invisible.
        assert_ne!(
            palette.resolve(DISABLED),
            palette.resolve(PANEL),
            "a disabled control is invisible against its own panel"
        );
        // The pointer ladder separates in the same direction the surfaces do, whichever that is.
        let surface = |role: Role| (luminance(role) - ground).abs();
        assert!(
            surface(PRESSED) > surface(HOVER),
            "pressed does not read as further from the ground than hover"
        );
        assert!(
            surface(HOVER) > surface(PANEL_ALT),
            "hover does not lift a control off its resting fill"
        );
    }

    #[test]
    fn element_colors_are_distinct_per_kind() {
        let kinds = ["Video", "Image", "Text", "Audio"];
        let palette = palette();
        let mut colors: Vec<u32> = kinds
            .iter()
            .map(|kind| palette.resolve(element_color(kind)))
            .collect();
        let total = colors.len();
        colors.sort_unstable();
        colors.dedup();
        assert_eq!(colors.len(), total, "two clip kinds draw the same colour");
        assert!(
            !colors.contains(&palette.resolve(element_color("Shape"))),
            "unknown kinds fall back"
        );
    }

    #[test]
    fn hex_parsing_handles_both_spellings_and_survives_nonsense() {
        assert_eq!(hex_to_rgb("#5b8cff"), palette().resolve(ACCENT));
        assert_eq!(hex_to_rgb("5b8cff"), palette().resolve(ACCENT));
        assert_eq!(hex_to_rgb("not a colour"), 0x808080);
        assert_eq!(hex_to_rgb(""), 0x808080);
    }
}
