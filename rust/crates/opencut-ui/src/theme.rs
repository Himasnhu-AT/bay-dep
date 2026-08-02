//! A tiny dark theme: hex colors as `u32` for `gpui::rgb`.

pub const BG: u32 = 0x0f0f14;
pub const PANEL: u32 = 0x16161d;
pub const PANEL_ALT: u32 = 0x1d1d26;
pub const LANE: u32 = 0x121218;
pub const BORDER: u32 = 0x2a2a36;
pub const TEXT: u32 = 0xe7e7ee;
pub const MUTED: u32 = 0x8a8a9a;
pub const ACCENT: u32 = 0x5b8cff;
pub const SELECTED: u32 = 0x2d3a66;
pub const SELECTED_BORDER: u32 = 0x8fb0ff;

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
