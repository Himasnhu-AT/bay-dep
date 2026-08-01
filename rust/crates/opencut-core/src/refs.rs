//! Stable references into the document. Ported 1:1 from the web `ElementRef` /
//! `SelectedKeyframeRef` / `SelectedMaskPointSelection` shapes so serialized commands
//! and snapshots stay wire-compatible with the existing project format.

use serde::{Deserialize, Serialize};

/// A timeline element addressed by its track and element id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementRef {
    pub track_id: String,
    pub element_id: String,
}

impl ElementRef {
    pub fn new(track_id: impl Into<String>, element_id: impl Into<String>) -> Self {
        Self {
            track_id: track_id.into(),
            element_id: element_id.into(),
        }
    }
}

/// A single animation keyframe on a specific property of an element.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeRef {
    pub track_id: String,
    pub element_id: String,
    pub property_path: String,
    pub keyframe_id: String,
}

/// A selection of control points within one element's mask.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskPointSelection {
    pub track_id: String,
    pub element_id: String,
    pub mask_id: String,
    pub point_ids: Vec<String>,
}
