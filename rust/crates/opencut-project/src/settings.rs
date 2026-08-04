//! Project-level settings: frame rate, canvas size, and background.

use serde::{Deserialize, Serialize};

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
}
