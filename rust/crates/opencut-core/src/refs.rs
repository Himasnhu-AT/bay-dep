//! Editor-session references. `ElementRef` is the domain type from `opencut-project`;
//! keyframe / mask-point references are editor concepts kept here.

use serde::{Deserialize, Serialize};

pub use opencut_project::ElementRef;

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
