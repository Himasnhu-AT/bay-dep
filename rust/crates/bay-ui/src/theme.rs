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
    #[test]
    fn the_surface_ladder_is_actually_a_ladder() {
        let ladder = [LANE, BG, PANEL, PANEL_ALT];
        for pair in ladder.windows(2) {
            assert_ne!(pair[0], pair[1], "two surfaces share a colour");
        }
        assert_ne!(BORDER, BORDER_SOFT);
        assert_ne!(TEXT, MUTED);
        assert_ne!(MUTED, FAINT);
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
            brightness(FAINT) > brightness(BG),
            "text must beat the ground"
        );
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
