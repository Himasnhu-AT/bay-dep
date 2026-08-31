//! The caption placement setting must be enforced by the planner, not merely drawn.
//!
//! The settings screen owns none of this. `bay --mcp` writes captions with no window open, so a
//! band position honoured by the editor and ignored by the server would be the same class of
//! bug as a tile naming an effect nothing renders — a control that looks like it works.
//!
//! These drive `caption_style_with` directly, which is `caption_style_from` with the setting
//! passed in rather than read from the user's real settings file.

use bay_agent::plan::caption_style_with;
use bay_settings::captions::{CaptionAlign, CaptionSettings, SafeArea};
use serde_json::json;

fn style(args: serde_json::Value, captions: &CaptionSettings) -> bay_agent::plan::CaptionStyle {
    caption_style_with(&args, None, "subtitles_add", captions).expect("a legal caption style")
}

/// With nothing configured, behaviour is exactly what it was before the setting existed.
#[test]
fn an_unconfigured_machine_is_unchanged() {
    let default = style(json!({}), &CaptionSettings::default());
    assert_eq!(default.y, bay_agent::plan::CaptionStyle::default().y);
}

#[test]
fn the_setting_moves_captions_when_the_call_says_nothing() {
    let captions = CaptionSettings {
        band_top: Some(0.62),
        ..Default::default()
    };
    assert_eq!(style(json!({}), &captions).y, 0.62);
}

/// A per-call `captionY` is a deliberate override and outranks the machine's preference.
#[test]
fn an_explicit_caption_y_outranks_the_setting() {
    let captions = CaptionSettings {
        band_top: Some(0.62),
        ..Default::default()
    };
    assert_eq!(style(json!({ "captionY": 0.40 }), &captions).y, 0.40);
}

/// ...but not the platform. The safe area describes what Instagram draws over, which no
/// caller preference changes.
#[test]
fn the_safe_area_clamps_even_an_explicit_caption_y() {
    let captions = CaptionSettings {
        safe_area: SafeArea::InstagramReels,
        ..Default::default()
    };
    let placed = style(json!({ "captionY": 0.90 }), &captions);
    assert_eq!(placed.y, 1.0 - 0.18);
}

/// The report's exact case: captions at y 806 of 960 sit under Instagram's bottom UI.
#[test]
fn the_reported_caption_band_is_pulled_clear_of_instagrams_ui() {
    let captions = CaptionSettings {
        band_top: Some(806.0 / 960.0),
        safe_area: SafeArea::InstagramReels,
        ..Default::default()
    };
    let placed = style(json!({}), &captions);
    assert!(
        placed.y < 806.0 / 960.0,
        "captions were left under the platform's chrome at {}",
        placed.y
    );
}

#[test]
fn the_align_setting_reaches_the_style() {
    let captions = CaptionSettings {
        align: Some(CaptionAlign::Center),
        ..Default::default()
    };
    assert_eq!(
        style(json!({}), &captions).align,
        bay_project::TextAlign::Center
    );
    // And an explicit argument still wins.
    assert_eq!(
        style(json!({ "captionAlign": "right" }), &captions).align,
        bay_project::TextAlign::Right
    );
}

/// Everything else about a caption still comes from the kit and the preset. The setting moves
/// the band; it must not quietly become a second style system.
#[test]
fn the_setting_changes_position_and_nothing_else() {
    let plain = style(json!({}), &CaptionSettings::default());
    let moved = style(
        json!({}),
        &CaptionSettings {
            band_top: Some(0.55),
            ..Default::default()
        },
    );
    assert_ne!(plain.y, moved.y);
    assert_eq!(plain.font_size, moved.font_size);
    assert_eq!(plain.color, moved.color);
    assert_eq!(plain.font_weight, moved.font_weight);
    assert_eq!(plain.scale, moved.scale);
    assert_eq!(plain.layer, moved.layer);
}
