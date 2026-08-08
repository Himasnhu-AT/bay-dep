//! Tracks and the three-lane track layout (overlay / main / audio), mirroring the web
//! `SceneTracks` shape.

use serde::{Deserialize, Serialize};

use crate::element::Element;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    Video,
    Audio,
    Overlay,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub name: String,
    pub kind: TrackKind,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub muted: bool,
    pub elements: Vec<Element>,
}

impl Track {
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: TrackKind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind,
            hidden: false,
            muted: false,
            elements: Vec::new(),
        }
    }

    pub fn element(&self, id: &str) -> Option<&Element> {
        self.elements.iter().find(|e| e.id() == id)
    }

    pub fn element_mut(&mut self, id: &str) -> Option<&mut Element> {
        self.elements.iter_mut().find(|e| e.id() == id)
    }
}

/// The scene's tracks: a single `main` lane, with `overlay` lanes composited above it and
/// `audio` lanes below. Iteration order is top-to-bottom (overlay, main, audio).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tracks {
    pub overlay: Vec<Track>,
    pub main: Track,
    pub audio: Vec<Track>,
}

impl Tracks {
    /// All tracks, top-to-bottom (overlay lanes, then main, then audio lanes).
    pub fn iter(&self) -> impl Iterator<Item = &Track> {
        self.overlay
            .iter()
            .chain(std::iter::once(&self.main))
            .chain(self.audio.iter())
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut Track> {
        self.overlay
            .iter_mut()
            .chain(std::iter::once(&mut self.main))
            .chain(self.audio.iter_mut())
    }

    pub fn track(&self, id: &str) -> Option<&Track> {
        self.iter().find(|t| t.id == id)
    }

    pub fn track_mut(&mut self, id: &str) -> Option<&mut Track> {
        self.iter_mut().find(|t| t.id == id)
    }
}
