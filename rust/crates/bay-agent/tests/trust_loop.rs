use std::collections::BTreeMap;

use bay_agent::trust::{
    BeatPlan, CriticSubmission, PanelEvidence, PlanDraft, PlanStatus, VariantCandidate,
    apply_critic_submission, commit_plan, create_plan, format_registry, pairwise_decide,
    refresh_obligations, require_trust_ready,
};

#[test]
fn plan_creation_rejects_a_beat_outside_the_promised_runtime() {
    let draft = PlanDraft {
        brief: "Explain why the launch is faster".into(),
        format: "product-demo".into(),
        target_runtime_seconds: 12.0,
        beats: vec![BeatPlan {
            id: "proof".into(),
            role: "proof".into(),
            marker_seconds: 13.0,
            intent: "Show the measured speedup".into(),
            asset_slots: vec![],
        }],
    };

    let error = create_plan(draft).expect_err("an impossible plan must be rejected");
    assert!(error.contains("outside the target runtime"), "{error}");
    assert!(
        format_registry()
            .iter()
            .any(|entry| entry.id == "product-demo")
    );
}

fn committed_plan() -> bay_agent::trust::PlanArtifact {
    commit_plan(
        create_plan(PlanDraft {
            brief: "Explain why the launch is faster".into(),
            format: "product-demo".into(),
            target_runtime_seconds: 12.0,
            beats: vec![
                BeatPlan {
                    id: "hook".into(),
                    role: "hook".into(),
                    marker_seconds: 0.0,
                    intent: "Show the product moving".into(),
                    asset_slots: vec![],
                },
                BeatPlan {
                    id: "proof".into(),
                    role: "proof".into(),
                    marker_seconds: 5.0,
                    intent: "Show the measured speedup".into(),
                    asset_slots: vec![],
                },
            ],
        })
        .unwrap(),
    )
}

#[test]
fn invalid_render_cannot_win_a_pairwise_tournament() {
    let mut plan = committed_plan();
    plan.variants.incumbent_project_id = Some("incumbent".into());
    plan.variants.candidates = vec![
        VariantCandidate {
            project_id: "incumbent".into(),
            parent_project_id: "source".into(),
            label: "current".into(),
            project_hash: "a".into(),
            render_path: Some("/tmp/a.mp4".into()),
            valid_render: true,
        },
        VariantCandidate {
            project_id: "revision".into(),
            parent_project_id: "incumbent".into(),
            label: "revision".into(),
            project_hash: "b".into(),
            render_path: Some("/tmp/b.mp4".into()),
            valid_render: false,
        },
    ];

    let error = pairwise_decide(
        &mut plan,
        "incumbent",
        "revision",
        "revision",
        "the opening reads faster",
    )
    .expect_err("an invalid render must receive zero reward");
    assert!(error.contains("clean engine-verified renders"), "{error}");
    assert_eq!(
        plan.variants.incumbent_project_id.as_deref(),
        Some("incumbent")
    );
}

#[test]
fn a_negative_critic_verdict_blocks_until_the_same_sample_changes_structurally() {
    let mut plan = committed_plan();
    let panels = vec![
        PanelEvidence {
            panel: 1,
            beat_id: "hook".into(),
            sample_time_seconds: 0.4,
            content_hash: "before".into(),
            icgs: vec![10, 20, 30],
        },
        PanelEvidence {
            panel: 2,
            beat_id: "proof".into(),
            sample_time_seconds: 5.5,
            content_hash: "before".into(),
            icgs: vec![40, 50, 60],
        },
    ];
    apply_critic_submission(
        &mut plan,
        &panels,
        &CriticSubmission {
            weakest_panel: 1,
            most_alike_pair: (1, 2),
            thumbnail_panel: 2,
            binaries: [false; 9],
            rationale: "the hierarchy is flat and both beats reuse one composition".into(),
        },
    )
    .unwrap();

    let blocked = require_trust_ready(Some(&plan)).expect_err("critic obligations must bite");
    assert!(blocked.contains("critic obligation"), "{blocked}");

    let unchanged = BTreeMap::from([
        (
            "hook@0.400000".into(),
            ("after-hook".into(), vec![10, 20, 30]),
        ),
        (
            "proof@5.500000".into(),
            ("after-proof".into(), vec![40, 50, 60]),
        ),
    ]);
    assert_eq!(refresh_obligations(&mut plan, &unchanged), 0);
    assert!(require_trust_ready(Some(&plan)).is_err());

    let changed = BTreeMap::from([
        (
            "hook@0.400000".into(),
            ("after-hook".into(), vec![11, 21, 31]),
        ),
        (
            "proof@5.500000".into(),
            ("after-proof".into(), vec![41, 51, 61]),
        ),
    ]);
    assert_eq!(refresh_obligations(&mut plan, &changed), 3);
    assert!(require_trust_ready(Some(&plan)).is_ok());
    assert_eq!(plan.status, PlanStatus::Committed);
}
