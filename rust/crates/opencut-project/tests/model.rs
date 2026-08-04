//! Domain-model invariants: the starter project is well-formed, accessors resolve, and the
//! whole model survives a JSON round-trip (it is the persisted project format).

use opencut_project::{Element, ElementKind, ElementRef, MediaTime, Project, TrackKind};

#[test]
fn starter_project_is_well_formed() {
    let project = Project::starter();

    // Exactly one scene, and it is the active + main scene.
    assert_eq!(project.scenes.len(), 1);
    let scene = project.active_scene();
    assert_eq!(scene.id, project.current_scene_id);
    assert!(scene.is_main);

    // The three-lane layout is present with the expected starter content.
    assert_eq!(scene.tracks.main.kind, TrackKind::Video);
    assert_eq!(scene.tracks.overlay.len(), 1);
    assert_eq!(scene.tracks.audio.len(), 1);
    assert_eq!(scene.tracks.main.elements.len(), 2);
}

#[test]
fn element_accessors_expose_common_fields() {
    let project = Project::starter();
    let title = &project.active_scene().tracks.main.elements[0];

    assert_eq!(title.id(), "el-title");
    assert_eq!(title.name(), "Title");
    assert_eq!(title.kind(), ElementKind::Text);
    assert_eq!(title.start(), MediaTime::ZERO);
    assert_eq!(title.end(), title.start() + title.duration());
    assert!(matches!(title, Element::Text(_)));
}

#[test]
fn tracks_iterate_top_to_bottom_and_resolve_by_ref() {
    let project = Project::starter();
    let scene = project.active_scene();

    let order: Vec<&str> = scene.tracks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(order, ["track-overlay", "track-main", "track-audio"]);

    let caption = scene
        .element(&ElementRef::new("track-overlay", "el-caption"))
        .expect("caption resolves");
    assert_eq!(caption.name(), "Caption");

    assert!(scene.element(&ElementRef::new("track-main", "missing")).is_none());
}

#[test]
fn project_survives_json_round_trip() {
    let project = Project::starter();
    let json = serde_json::to_string(&project).expect("serialize");
    let restored: Project = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(project, restored);

    // MediaTime serializes as raw ticks (a number), keeping the format compact + wasm-compatible.
    assert!(json.contains("\"type\":\"text\""));
}
