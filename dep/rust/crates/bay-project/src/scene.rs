//! A scene: a named timeline (its `Tracks`) that the editor edits one at a time.

use std::collections::BTreeMap;

use bay_time::MediaTime;
use serde::{Deserialize, Serialize};

use crate::element::{AnimationChannel, Element, ElementSource, Transform};
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
    /// Parent transforms keyed by group id. Missing means the scene predates groups.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub groups: BTreeMap<String, ElementGroup>,
}

/// A transform parent for several visual elements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementGroup {
    pub id: String,
    #[serde(default)]
    pub children: Vec<String>,
    #[serde(default)]
    pub transform: Transform,
    /// Group channels use absolute scene time, unlike element-local channels.
    #[serde(default)]
    pub animations: BTreeMap<String, AnimationChannel>,
}

impl ElementGroup {
    /// What can be keyframed on a *group*, which is a shorter list than [`Element::ANIMATABLE`].
    ///
    /// A group owns no pixels. Everything it does, it does by [`compose_group_transform`]
    /// folding its transform into each child's, and that function carries exactly these seven
    /// channels — position, uniform and per-axis scale, rotation, opacity. It does not carry
    /// crop or tilt, and it could not: cropping a group means rasterising the group to its own
    /// surface and cutting that, which the compositor has no pass for, and per-child crop
    /// insets are a different picture entirely (four elements each losing their own left edge,
    /// not one rectangle losing its left edge).
    ///
    /// So the six are refused by name. They were accepted until now — `plan` validated a group
    /// `animate` against all thirteen of `Element::ANIMATABLE` — and an agent that keyed
    /// `cropLeft` on a group got a written channel, a successful tool result, and a frame that
    /// never moved. Refusing loudly is the only honest answer while the pass does not exist.
    ///
    /// [`Element::ANIMATABLE`]: crate::Element::ANIMATABLE
    pub const ANIMATABLE: [&'static str; 7] =
        ["opacity", "scale", "x", "y", "rotation", "scaleX", "scaleY"];

    pub fn sampled_transform(&self, scene_time: MediaTime) -> Transform {
        let mut transform = self.transform;
        let sample = |name: &str| self.animations.get(name).and_then(|c| c.sample(scene_time));
        if let Some(value) = sample("opacity") {
            transform.opacity = value;
        }
        if let Some(value) = sample("scale") {
            transform.scale = value;
        }
        if let Some(value) = sample("x") {
            transform.x = value;
        }
        if let Some(value) = sample("y") {
            transform.y = value;
        }
        if let Some(value) = sample("rotation") {
            transform.rotation = value;
        }
        if let Some(value) = sample("scaleX") {
            transform.scale_x = value;
        }
        if let Some(value) = sample("scaleY") {
            transform.scale_y = value;
        }
        transform
    }
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
            groups: BTreeMap::new(),
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

    /// Compose an element's local animation with its parent group, if any.
    pub fn sampled_transform(
        &self,
        element: &Element,
        local_time: MediaTime,
        scene_time: MediaTime,
    ) -> Option<Transform> {
        let child = element.sampled_transform(local_time)?;
        let Some(group) = self
            .groups
            .values()
            .find(|group| group.children.iter().any(|id| id == element.id()))
        else {
            return Some(child);
        };
        Some(compose_group_transform(
            child,
            group.sampled_transform(scene_time),
        ))
    }
}

/// Apply a group transform around its anchor to a child transform.
pub fn compose_group_transform(mut child: Transform, group: Transform) -> Transform {
    let dx = (child.x - group.anchor_x) * group.scale * group.scale_x;
    let dy = (child.y - group.anchor_y) * group.scale * group.scale_y;
    let radians = group.rotation.to_radians();
    let (sin, cos) = radians.sin_cos();
    child.x = group.x + dx * cos - dy * sin;
    child.y = group.y + dx * sin + dy * cos;
    child.scale *= group.scale;
    child.scale_x *= group.scale_x;
    child.scale_y *= group.scale_y;
    child.rotation += group.rotation;
    child.opacity *= group.opacity;
    child
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_transform_accumulates_around_the_group_anchor() {
        let child = Transform {
            x: 0.75,
            y: 0.5,
            scale: 0.5,
            rotation: 10.0,
            opacity: 0.8,
            ..Transform::default()
        };
        let group = Transform {
            x: 0.4,
            y: 0.6,
            scale: 2.0,
            rotation: 90.0,
            opacity: 0.5,
            ..Transform::default()
        };

        let composed = compose_group_transform(child, group);

        assert!((composed.x - 0.4).abs() < 0.0001);
        assert!((composed.y - 1.1).abs() < 0.0001);
        assert!((composed.scale - 1.0).abs() < 0.0001);
        assert!((composed.rotation - 100.0).abs() < 0.0001);
        assert!((composed.opacity - 0.4).abs() < 0.0001);
    }

    /// A group with one channel written on `property`, running 0 → 1 over the first second.
    fn group_animated_on(property: &str) -> ElementGroup {
        let mut channel = AnimationChannel::default();
        channel.upsert(MediaTime::ZERO, 0.0);
        channel.upsert(MediaTime::from_seconds_f64(1.0).unwrap(), 1.0);
        ElementGroup {
            id: "grp-1".to_string(),
            children: vec!["el-1".to_string()],
            // Non-default everywhere, so "the channel did nothing" cannot be confused with
            // "the channel wrote the value the field already held".
            transform: Transform {
                opacity: 0.5,
                scale: 0.5,
                x: 0.25,
                y: 0.25,
                rotation: 30.0,
                scale_x: 0.5,
                scale_y: 0.5,
                crop_left: 0.1,
                crop_top: 0.1,
                crop_right: 0.1,
                crop_bottom: 0.1,
                tilt_x: 5.0,
                tilt_y: 5.0,
                ..Transform::default()
            },
            animations: BTreeMap::from([(property.to_string(), channel)]),
        }
    }

    /// Direction one: every channel the validator lets through must reach the transform.
    #[test]
    fn every_group_animatable_channel_changes_the_sampled_transform() {
        for property in ElementGroup::ANIMATABLE {
            let group = group_animated_on(property);
            assert_ne!(
                group.sampled_transform(MediaTime::from_seconds_f64(1.0).unwrap()),
                group.transform,
                "{property:?} is offered on a group but sampling it moves nothing"
            );
        }
    }

    /// Direction two: the six `Element::ANIMATABLE` channels a group does *not* take are inert
    /// here — which is why `plan` refuses them by name rather than writing a channel that
    /// samples into nowhere. If a later build teaches `compose_group_transform` to carry crop
    /// or tilt, this test fails and `ElementGroup::ANIMATABLE` is what has to grow.
    #[test]
    fn the_channels_a_group_refuses_would_have_sampled_into_nowhere() {
        let refused: Vec<&str> = crate::Element::ANIMATABLE
            .into_iter()
            .filter(|name| !ElementGroup::ANIMATABLE.contains(name))
            .collect();
        assert_eq!(
            refused,
            [
                "cropLeft",
                "cropTop",
                "cropRight",
                "cropBottom",
                "tiltX",
                "tiltY"
            ]
        );
        for property in refused {
            let group = group_animated_on(property);
            assert_eq!(
                group.sampled_transform(MediaTime::from_seconds_f64(1.0).unwrap()),
                group.transform,
                "{property:?} now does something on a group — offer it instead of refusing it"
            );
        }
    }

    /// And even if it were sampled, the group's crop and tilt never reach a child: composition
    /// carries seven fields and drops the rest. This is the fact `ElementGroup::ANIMATABLE`
    /// is derived from.
    #[test]
    fn group_crop_and_tilt_do_not_compose_onto_a_child() {
        let child = Transform::default();
        let group = Transform {
            crop_left: 0.3,
            crop_top: 0.3,
            crop_right: 0.3,
            crop_bottom: 0.3,
            tilt_x: 20.0,
            tilt_y: 20.0,
            ..Transform::default()
        };

        let composed = compose_group_transform(child, group);

        assert_eq!(composed.crop_left, child.crop_left);
        assert_eq!(composed.crop_top, child.crop_top);
        assert_eq!(composed.crop_right, child.crop_right);
        assert_eq!(composed.crop_bottom, child.crop_bottom);
        assert_eq!(composed.tilt_x, child.tilt_x);
        assert_eq!(composed.tilt_y, child.tilt_y);
    }
}
