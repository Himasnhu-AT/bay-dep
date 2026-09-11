//! Where captions sit, and what they must stay clear of.
//!
//! Captions are the largest block of type in most of these videos and the one the author does
//! not place by hand — `narrate` and `subtitles_add` emit them. That makes their position a
//! setting rather than an argument: it is the same answer for every caption in every project on
//! this machine, and a per-call override is the wrong shape for it.
//!
//! It lives here, headless, for the reason the whole crate exists: `bay --mcp` writes captions
//! with no window open, so a band position that lived in the view would be honoured by the
//! editor and ignored by the server — the same failure as a caption meaning one thing in the
//! window and another over the wire.
//!
//! ## The safe area is a ceiling, not a suggestion
//!
//! A vertical video is not shown edge to edge. Instagram, TikTok and YouTube all draw their own
//! chrome over the bottom of the frame — the caption, the account row, the action rail — and a
//! subtitle placed under it is one the viewer never reads. [`SafeArea`] reserves that band, and
//! [`CaptionSettings::resolve_band_top`] clamps to it: a position that would put captions
//! behind the platform's UI is pulled up rather than accepted.

use serde::{Deserialize, Serialize};

/// Whose chrome to keep captions clear of.
///
/// The fractions are approximate on purpose, and are documented as such wherever they are shown.
/// Each platform's overlay moves between app versions and with the length of the account name,
/// so these are a sensible floor rather than a measurement — [`CaptionSettings::band_top`] is
/// the exact control for anyone who has measured their own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SafeArea {
    /// Reserve nothing. Right for a video that will not be shown inside a social app.
    #[default]
    None,
    InstagramReels,
    TikTok,
    YouTubeShorts,
}

impl SafeArea {
    pub const ALL: [SafeArea; 4] = [
        SafeArea::None,
        SafeArea::InstagramReels,
        SafeArea::TikTok,
        SafeArea::YouTubeShorts,
    ];

    pub fn label(self) -> &'static str {
        match self {
            SafeArea::None => "Full frame",
            SafeArea::InstagramReels => "Instagram Reels",
            SafeArea::TikTok => "TikTok",
            SafeArea::YouTubeShorts => "YouTube Shorts",
        }
    }

    /// The fraction of the frame's height the platform draws over, measured from the bottom.
    ///
    /// A caption may not *start* inside this band. It is deliberately the start that is
    /// constrained rather than the whole block: a caption that begins above the chrome and runs
    /// two lines into it is still mostly readable, and reserving the block's full height would
    /// push every caption to the middle of the frame.
    pub fn bottom_fraction(self) -> f32 {
        match self {
            SafeArea::None => 0.0,
            // The action rail and the account/caption row. The tallest of the three.
            SafeArea::TikTok => 0.20,
            SafeArea::InstagramReels => 0.18,
            SafeArea::YouTubeShorts => 0.16,
        }
    }

    /// What to tell someone about a number that is an estimate.
    pub fn note(self) -> &'static str {
        match self {
            SafeArea::None => "Captions may sit anywhere in the frame.",
            _ => {
                "Approximate: platform overlays move between app versions. \
                  Set the band position explicitly if you have measured your own."
            }
        }
    }
}

/// Where captions go, for every project on this machine.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptionSettings {
    /// Top of the caption box as a fraction of canvas height, or `None` to follow the style
    /// kit's own lower third.
    ///
    /// `None` is the default and is not the same as any particular number: kits place their
    /// lower third differently, and pinning a value here would flatten that difference across
    /// every kit at once.
    pub band_top: Option<f32>,
    /// Horizontal alignment, or `None` to follow the kit.
    pub align: Option<CaptionAlign>,
    pub safe_area: SafeArea,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionAlign {
    Left,
    Center,
    Right,
}

impl CaptionAlign {
    pub const ALL: [CaptionAlign; 3] = [
        CaptionAlign::Left,
        CaptionAlign::Center,
        CaptionAlign::Right,
    ];

    pub fn label(self) -> &'static str {
        match self {
            CaptionAlign::Left => "Left",
            CaptionAlign::Center => "Centre",
            CaptionAlign::Right => "Right",
        }
    }

    /// The name the MCP tools and the planner use.
    pub fn wire_name(self) -> &'static str {
        match self {
            CaptionAlign::Left => "left",
            CaptionAlign::Center => "center",
            CaptionAlign::Right => "right",
        }
    }
}

/// The lowest a caption may start, whatever anyone asks for.
///
/// Not zero: a caption whose top is at 0.99 has nothing but its own descenders on screen. This
/// is the point past which a "position" stops describing anything visible.
const LOWEST_USABLE_TOP: f32 = 0.95;

impl CaptionSettings {
    /// The band top to actually use, given what the kit would otherwise have chosen.
    ///
    /// Precedence: an explicit [`CaptionSettings::band_top`] wins over the kit, and the safe
    /// area clamps whichever of the two was used. The clamp applies to the kit's answer too —
    /// a kit whose lower third sits under Instagram's UI is exactly the case this setting is
    /// for, and one that only corrected explicit values would leave the default broken.
    pub fn resolve_band_top(&self, from_kit: f32) -> f32 {
        self.clamp_top(self.band_top.filter(|v| v.is_finite()).unwrap_or(from_kit))
    }

    /// Pull any position into the frame and out of the platform's chrome.
    ///
    /// Separate from [`CaptionSettings::resolve_band_top`] because the planner has a third
    /// source of position — an explicit `captionY` on the tool call — that outranks both this
    /// setting and the kit. The clamp still applies to it: the safe area describes what the
    /// platform covers, which no caller preference changes.
    pub fn clamp_top(&self, wanted: f32) -> f32 {
        if !wanted.is_finite() {
            return 0.0;
        }
        let ceiling = (1.0 - self.safe_area.bottom_fraction()).min(LOWEST_USABLE_TOP);
        wanted.clamp(0.0, ceiling)
    }

    /// Was the requested position moved to clear the platform's chrome?
    ///
    /// The settings pane says so out loud. A control that silently corrects the number typed
    /// into it reads as broken.
    pub fn is_clamped(&self, from_kit: f32) -> bool {
        let wanted = self.band_top.filter(|v| v.is_finite()).unwrap_or(from_kit);
        (self.resolve_band_top(from_kit) - wanted).abs() > f32::EPSILON
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_set_follows_the_kit() {
        let settings = CaptionSettings::default();
        assert_eq!(settings.resolve_band_top(0.70), 0.70);
        assert!(!settings.is_clamped(0.70));
    }

    #[test]
    fn an_explicit_band_top_overrides_the_kit() {
        let settings = CaptionSettings {
            band_top: Some(0.55),
            ..Default::default()
        };
        assert_eq!(settings.resolve_band_top(0.70), 0.55);
    }

    /// The case this setting exists for: the report's caption band at y 806 of 960 is 0.84,
    /// which is under Instagram's bottom UI. It must be pulled up, and must say it was.
    #[test]
    fn instagram_pulls_a_low_band_up_out_of_its_chrome() {
        let settings = CaptionSettings {
            band_top: Some(806.0 / 960.0),
            safe_area: SafeArea::InstagramReels,
            ..Default::default()
        };
        let resolved = settings.resolve_band_top(0.70);
        assert!(resolved < 806.0 / 960.0, "not pulled up: {resolved}");
        assert_eq!(resolved, 1.0 - 0.18);
        assert!(settings.is_clamped(0.70));
    }

    /// The report's alternative — band top 690 of 960 — already clears the chrome and must be
    /// left exactly where it was asked for.
    #[test]
    fn a_band_that_already_clears_the_chrome_is_untouched() {
        let settings = CaptionSettings {
            band_top: Some(690.0 / 960.0),
            safe_area: SafeArea::InstagramReels,
            ..Default::default()
        };
        assert_eq!(settings.resolve_band_top(0.70), 690.0 / 960.0);
        assert!(!settings.is_clamped(0.70));
    }

    /// A kit that places its own lower third under the platform's UI is corrected too. A clamp
    /// that only applied to explicit values would leave every default broken.
    #[test]
    fn the_kits_own_answer_is_clamped_as_well() {
        let settings = CaptionSettings {
            safe_area: SafeArea::TikTok,
            ..Default::default()
        };
        assert_eq!(settings.resolve_band_top(0.92), 0.80);
        assert!(settings.is_clamped(0.92));
    }

    /// Even with nothing reserved, a caption cannot start where none of it would be visible.
    #[test]
    fn there_is_a_floor_even_with_no_safe_area() {
        let settings = CaptionSettings {
            band_top: Some(0.999),
            ..Default::default()
        };
        assert_eq!(settings.resolve_band_top(0.70), LOWEST_USABLE_TOP);
    }

    #[test]
    fn a_nonsense_band_top_falls_back_to_the_kit() {
        let settings = CaptionSettings {
            band_top: Some(f32::NAN),
            ..Default::default()
        };
        assert_eq!(settings.resolve_band_top(0.70), 0.70);
    }

    #[test]
    fn a_negative_band_top_is_pulled_into_the_frame() {
        let settings = CaptionSettings {
            band_top: Some(-2.0),
            ..Default::default()
        };
        assert_eq!(settings.resolve_band_top(0.70), 0.0);
    }

    /// An explicit per-call position outranks the setting but not the platform.
    #[test]
    fn clamp_top_constrains_a_caller_supplied_position_too() {
        let settings = CaptionSettings {
            band_top: Some(0.50),
            safe_area: SafeArea::InstagramReels,
            ..Default::default()
        };
        assert_eq!(settings.clamp_top(0.60), 0.60);
        assert_eq!(settings.clamp_top(0.99), 1.0 - 0.18);
    }

    #[test]
    fn tiktok_reserves_the_most() {
        let mut sorted = SafeArea::ALL;
        sorted.sort_by(|a, b| b.bottom_fraction().total_cmp(&a.bottom_fraction()));
        assert_eq!(sorted[0], SafeArea::TikTok);
        assert_eq!(sorted[3], SafeArea::None);
    }

    #[test]
    fn settings_round_trip_through_json() {
        let settings = CaptionSettings {
            band_top: Some(0.62),
            align: Some(CaptionAlign::Center),
            safe_area: SafeArea::InstagramReels,
        };
        let encoded = serde_json::to_string(&settings).unwrap();
        assert!(encoded.contains("instagram-reels"), "{encoded}");
        assert!(encoded.contains("bandTop"), "{encoded}");
        let decoded: CaptionSettings = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, settings);
    }

    /// A settings file written before captions existed must still load.
    #[test]
    fn an_older_settings_file_loads() {
        let decoded: CaptionSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(decoded, CaptionSettings::default());
    }
}
