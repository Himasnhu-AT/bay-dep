//! The `Project` aggregate root and its starter/demo constructor.

use serde::{Deserialize, Serialize};
use time::MediaTime;

use crate::element::{AudioElement, Element, ImageElement, TextElement};
use crate::scene::Scene;
use crate::settings::ProjectSettings;
use crate::track::{Track, TrackKind, Tracks};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub metadata: ProjectMetadata,
    pub settings: ProjectSettings,
    pub scenes: Vec<Scene>,
    pub current_scene_id: String,
}

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_seconds_f64(seconds).unwrap_or(MediaTime::ZERO)
}

impl Project {
    /// The scene currently being edited. A `Project` is expected to always hold at least one
    /// scene (the constructors guarantee it); falls back to the first scene if the
    /// `current_scene_id` does not resolve.
    pub fn active_scene(&self) -> &Scene {
        self.scenes
            .iter()
            .find(|scene| scene.id == self.current_scene_id)
            .or_else(|| self.scenes.first())
            .expect("a project always has at least one scene")
    }

    pub fn active_scene_mut(&mut self) -> &mut Scene {
        let target = self
            .scenes
            .iter()
            .position(|scene| scene.id == self.current_scene_id)
            .unwrap_or(0);
        self.scenes
            .get_mut(target)
            .expect("a project always has at least one scene")
    }

    /// A small, representative project so the editor opens with visible content: a main scene
    /// with a title + logo on the main track, a caption overlay, and a music clip on audio.
    pub fn starter() -> Self {
        let main = Track {
            id: "track-main".into(),
            name: "Main".into(),
            kind: TrackKind::Video,
            hidden: false,
            muted: false,
            elements: vec![
                Element::Text(TextElement {
                    id: "el-title".into(),
                    name: "Title".into(),
                    start: secs(0.0),
                    duration: secs(3.0),
                    content: "Hello, vii".into(),
                    font_size: 96.0,
                    color: "#ffffff".into(),
                }),
                Element::Image(ImageElement {
                    id: "el-logo".into(),
                    name: "Logo".into(),
                    start: secs(3.0),
                    duration: secs(4.0),
                    media_id: "media-logo".into(),
                }),
            ],
        };

        let overlay = vec![Track {
            id: "track-overlay".into(),
            name: "Overlay".into(),
            kind: TrackKind::Overlay,
            hidden: false,
            muted: false,
            elements: vec![Element::Text(TextElement {
                id: "el-caption".into(),
                name: "Caption".into(),
                start: secs(1.0),
                duration: secs(2.0),
                content: "native • fast".into(),
                font_size: 48.0,
                color: "#99aadd".into(),
            })],
        }];

        let audio = vec![Track {
            id: "track-audio".into(),
            name: "Audio".into(),
            kind: TrackKind::Audio,
            hidden: false,
            muted: false,
            elements: vec![Element::Audio(AudioElement {
                id: "el-music".into(),
                name: "Music".into(),
                start: secs(0.0),
                duration: secs(7.0),
                media_id: "media-music".into(),
                muted: false,
                volume: 1.0,
            })],
        }];

        let scene = Scene {
            id: "scene-main".into(),
            name: "Main scene".into(),
            is_main: true,
            tracks: Tracks {
                overlay,
                main,
                audio,
            },
        };

        Self {
            metadata: ProjectMetadata {
                id: "project-1".into(),
                name: "Untitled".into(),
            },
            settings: ProjectSettings::default(),
            scenes: vec![scene],
            current_scene_id: "scene-main".into(),
        }
    }
}
