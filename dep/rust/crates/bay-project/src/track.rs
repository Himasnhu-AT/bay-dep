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
    /// Linear gain applied to everything on this lane, on top of each clip's own level.
    ///
    /// A second gain stage rather than a rewrite of the clips': moving a lane's fader must not
    /// destroy the relative balance the author built inside it, and it must be undoable by
    /// moving the fader back.
    #[serde(default = "unity_gain", skip_serializing_if = "is_unity_gain")]
    pub gain: f32,
    /// Where this lane sits across the stereo field. Same law and same units as
    /// [`crate::AudioElement::pan`], composed with it multiplicatively.
    #[serde(default, skip_serializing_if = "is_centred")]
    pub pan: f32,
    /// Solo. **A property of the lane, not of the mix**: what it means is decided by
    /// [`Tracks::any_audio_solo`], because "solo" is only meaningful relative to whether any
    /// other lane is soloed. A lone `solo: true` silences every other audio lane; no solo
    /// anywhere silences nothing.
    ///
    /// `skip_serializing_if` because it is a session-shaped thing that nonetheless has to
    /// survive a save — and because writing `"solo":false` into every track of every project
    /// would be a wire change that says nothing.
    #[serde(default, skip_serializing_if = "is_not_soloed")]
    pub solo: bool,
    pub elements: Vec<Element>,
}

fn unity_gain() -> f32 {
    1.0
}

fn is_unity_gain(gain: &f32) -> bool {
    *gain == 1.0
}

fn is_centred(pan: &f32) -> bool {
    *pan == 0.0
}

fn is_not_soloed(solo: &bool) -> bool {
    !*solo
}

impl Track {
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: TrackKind) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            kind,
            hidden: false,
            muted: false,
            gain: 1.0,
            pan: 0.0,
            solo: false,
            elements: Vec::new(),
        }
    }

    /// The gain this lane contributes to the mix, given whether *anything* is soloed.
    ///
    /// `0.0` — silence — for a hidden lane, a muted lane, and a lane that is not soloed while
    /// another one is. Every mixer has to make the same three decisions in the same order, so
    /// they are made once, here, rather than three times in three crates.
    pub fn mix_gain(&self, any_solo: bool) -> f32 {
        if self.hidden || self.muted || (any_solo && !self.solo) {
            return 0.0;
        }
        if self.gain.is_finite() {
            self.gain.max(0.0)
        } else {
            1.0
        }
    }

    /// Whether this lane is heard at all in a mix where `any_solo` says something is soloed.
    pub fn is_audible(&self, any_solo: bool) -> bool {
        self.mix_gain(any_solo) > 0.0
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

    /// Whether any audio lane is soloed — the one fact that turns `solo` from a flag on a lane
    /// into a decision about every other lane.
    ///
    /// Read off the audio lanes only. Soloing is a mix idea; a soloed overlay would otherwise
    /// silence the narration, which is not what anybody means by it.
    pub fn any_audio_solo(&self) -> bool {
        self.audio.iter().any(|track| track.solo && !track.hidden)
    }
}
