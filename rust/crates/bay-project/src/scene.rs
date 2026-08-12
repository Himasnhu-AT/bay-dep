//! A scene: a named timeline (its `Tracks`) that the editor edits one at a time.

use bay_time::MediaTime;
use serde::{Deserialize, Serialize};

use crate::element::{Element, ElementSource};
use crate::refs::ElementRef;
use crate::track::{Track, TrackKind, Tracks};

/// A scene's elements split by who put them there.
///
/// The shape every distribution in `check` should be computed over. Measuring "the elements"
/// undivided means measuring bay's own caption output as though an author had chosen it, which
/// is how the same three projects rank in the opposite order on four separate motion measures
/// depending only on whether captions are counted.
#[derive(Debug, Clone, Default)]
pub struct BySource<'a> {
    /// What a human or agent asked for.
    pub authored: Vec<&'a Element>,
    /// What bay generated — captions from `narrate` and the subtitle tools.
    pub tool: Vec<&'a Element>,
}

impl BySource<'_> {
    /// Share of the scene bay generated, 0..=1. Zero when the scene is empty.
    pub fn tool_share(&self) -> f64 {
        let total = self.authored.len() + self.tool.len();
        if total == 0 {
            return 0.0;
        }
        self.tool.len() as f64 / total as f64
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub tracks: Tracks,
    /// Points on the timeline worth coming back to: a beat in the music, the moment a line
    /// lands, where the next cut goes. Kept sorted by time.
    ///
    /// `#[serde(default)]` so projects written before markers existed still load.
    #[serde(default)]
    pub markers: Vec<Marker>,
}

/// A named point on the timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    pub time: MediaTime,
    /// Free text. Empty is fine — the position is often the whole point.
    #[serde(default)]
    pub label: String,
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
            markers: Vec::new(),
        }
    }

    /// Every element in the scene, in track order (overlay lanes, main, audio lanes).
    pub fn elements(&self) -> impl Iterator<Item = &Element> {
        self.tracks.iter().flat_map(|track| track.elements.iter())
    }

    /// Only the elements an author asked for.
    ///
    /// The iterator a measurement wants: font sizes, positions, durations and animation
    /// channels are all statements about what an author chose, and bay's own captions are not
    /// one of those.
    pub fn authored_elements(&self) -> impl Iterator<Item = &Element> {
        self.elements().filter(|element| element.is_authored())
    }

    /// Only the elements bay generated.
    pub fn tool_elements(&self) -> impl Iterator<Item = &Element> {
        self.elements().filter(|element| !element.is_authored())
    }

    /// Both halves at once, for a caller that reports the split as well as measuring over it.
    pub fn by_source(&self) -> BySource<'_> {
        let mut split = BySource::default();
        for element in self.elements() {
            match element.source() {
                ElementSource::Author => split.authored.push(element),
                ElementSource::Tool => split.tool.push(element),
            }
        }
        split
    }

    /// Resolve an [`ElementRef`] to its element within this scene.
    pub fn element(&self, reference: &ElementRef) -> Option<&Element> {
        self.tracks
            .track(&reference.track_id)?
            .element(&reference.element_id)
    }

    /// Every edge a drag could usefully land on: the start of the timeline, every clip's head
    /// and tail, and every marker. Deduplicated and sorted.
    ///
    /// `skip` is the element being dragged — a clip must not snap to its own edges, or it
    /// would refuse to move at all.
    pub fn snap_targets(&self, skip: Option<&ElementRef>) -> Vec<MediaTime> {
        let mut targets = vec![MediaTime::ZERO];
        for track in self.tracks.iter() {
            for element in &track.elements {
                let is_skipped = skip.is_some_and(|reference| {
                    reference.track_id == track.id && reference.element_id == element.id()
                });
                if is_skipped {
                    continue;
                }
                targets.push(element.start());
                targets.push(element.end());
            }
        }
        targets.extend(self.markers.iter().map(|marker| marker.time));
        targets.sort_unstable();
        targets.dedup();
        targets
    }

    pub fn element_mut(&mut self, reference: &ElementRef) -> Option<&mut Element> {
        self.tracks
            .track_mut(&reference.track_id)?
            .element_mut(&reference.element_id)
    }
}
