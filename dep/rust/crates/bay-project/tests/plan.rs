use bay_project::{BeatPlan, CanvasSize, Fps, PlanArtifact, PlanStatus, Project, ProjectSettings};

#[test]
fn plan_state_round_trips_with_the_project() {
    let mut project = Project::empty(
        "p",
        "Planned",
        CanvasSize {
            width: 1080,
            height: 1920,
        },
        Fps::default(),
        "#000000",
    );
    project.settings.plan = Some(PlanArtifact {
        id: "plan-1".into(),
        brief: "Show the claim".into(),
        format: "podcast-clip".into(),
        target_runtime_seconds: 20.0,
        beats: vec![BeatPlan {
            id: "hook".into(),
            role: "hook".into(),
            marker_seconds: 0.0,
            intent: "start on the strongest sentence".into(),
            asset_slots: vec![],
        }],
        status: PlanStatus::Committed,
        critic: Default::default(),
        variants: Default::default(),
    });

    let json = serde_json::to_string(&project).unwrap();
    let loaded: Project = serde_json::from_str(&json).unwrap();
    assert_eq!(loaded.settings.plan, project.settings.plan);
}

#[test]
fn old_settings_without_a_plan_still_load() {
    let settings: ProjectSettings = serde_json::from_value(serde_json::json!({
        "fps": {"numerator": 30, "denominator": 1},
        "canvas": {"width": 1920, "height": 1080},
        "background": {"type": "color", "color": "#000000"}
    }))
    .unwrap();
    assert!(settings.plan.is_none());
}
