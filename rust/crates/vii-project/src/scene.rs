//! A scene: a named timeline (its `Tracks`) that the editor edits one at a time.

use serde::{Deserialize, Serialize};

use crate::element::Element;
use crate::refs::ElementRef;
use crate::track::{Track, TrackKind, Tracks};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub tracks: Tracks,
}

impl Scene {
    /// A new empty scene: a single (empty) main video track, no overlay/audio lanes.
    pub fn empty(id: impl Into<String>, name: impl Into<String>) -> Self {
        let id = id.into();
        let main = Track::new(format!("{id}-main"), "Main", TrackKind::Video);
        Self {
            id,
            name: name.into(),
            is_main: false,
            tracks: Tracks {
                overlay: Vec::new(),
                main,
                audio: Vec::new(),
            },
        }
    }

    /// Resolve an [`ElementRef`] to its element within this scene.
    pub fn element(&self, reference: &ElementRef) -> Option<&Element> {
        self.tracks
            .track(&reference.track_id)?
            .element(&reference.element_id)
    }

    pub fn element_mut(&mut self, reference: &ElementRef) -> Option<&mut Element> {
        self.tracks
            .track_mut(&reference.track_id)?
            .element_mut(&reference.element_id)
    }
}
