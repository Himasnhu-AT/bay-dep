//! Project-level settings: frame rate, canvas size, background, and the committed style kit.

use serde::{Deserialize, Serialize};

use crate::{kit::StyleKit, plan::PlanArtifact};

/// Frames per second as an exact rational (e.g. 30000/1001 for 29.97).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fps {
    pub numerator: u32,
    pub denominator: u32,
}

impl Fps {
    pub fn as_f64(self) -> f64 {
        f64::from(self.numerator) / f64::from(self.denominator.max(1))
    }
}

impl Default for Fps {
    fn default() -> Self {
        Self {
            numerator: 30,
            denominator: 1,
        }
    }
}

/// Output canvas dimensions in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSize {
    pub width: u32,
    pub height: u32,
}

impl Default for CanvasSize {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
        }
    }
}

/// Scene background fill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Background {
    Color { color: String },
    Blur { blur_intensity: f32 },
}

impl Default for Background {
    fn default() -> Self {
        Self::Color {
            color: "#000000".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub fps: Fps,
    pub canvas: CanvasSize,
    pub background: Background,
    /// The typography and colour this project is committed to. See [`StyleKit`].
    ///
    /// `Option`, and `#[serde(default)]`, because every project written before kits existed says
    /// nothing about one — and must still load and render exactly as it did. A project with no
    /// kit is a project from before; `add_text` commits one rather than refusing to draw.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kit: Option<StyleKit>,
    /// The approved editorial intent and any critic/tournament state attached to it.
    ///
    /// Optional for backward compatibility: projects saved before the trust loop have no plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<PlanArtifact>,
}
