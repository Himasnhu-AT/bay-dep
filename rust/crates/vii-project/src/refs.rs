//! Stable references into the document. Wire-compatible with the web `ElementRef`.

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
