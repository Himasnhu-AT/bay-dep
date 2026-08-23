use bay_mcp::{Studio, tools};
use serde_json::json;

fn studio(tag: &str) -> Studio {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    Studio::with_library_root(Some(
        std::env::temp_dir().join(format!("bay-trust-{tag}-{stamp}")),
    ))
}

#[test]
fn approved_plan_round_trips_and_commits_real_markers() {
    let mut studio = studio("plan");
    let created = tools::dispatch(
        &mut studio,
        "plan_create",
        &json!({
            "brief": "Show the product becoming faster",
            "format": "product-demo",
            "targetRuntimeSeconds": 12.0,
            "approve": true,
            "beats": [
                {"id": "hook", "role": "hook", "at": 0.0, "intent": "show the product moving"},
                {"id": "proof", "role": "proof", "at": 5.0, "intent": "show measured speed"}
            ]
        }),
    )
    .expect("a valid plan is accepted");
    assert_eq!(created["applied"], 3);

    let got = tools::dispatch(&mut studio, "plan_get", &json!({})).unwrap();
    assert_eq!(got["plan"]["status"], "committed");
    assert_eq!(got["plan"]["format"], "product-demo");
    assert!(
        got["formats"]
            .as_array()
            .unwrap()
            .iter()
            .any(|format| format["id"] == "podcast-clip")
    );
    let markers = &studio.project().active_scene().markers;
    assert_eq!(markers.len(), 2);
    assert_eq!(markers[1].id, "plan-proof");
}

#[test]
fn plan_tool_rejects_an_unmeasurable_runtime_promise() {
    let mut studio = studio("bad-plan");
    let error = tools::dispatch(
        &mut studio,
        "plan_create",
        &json!({
            "brief": "Show the product",
            "format": "product-demo",
            "targetRuntimeSeconds": 5.0,
            "beats": [
                {"id": "late", "role": "proof", "at": 7.0, "intent": "show proof"}
            ]
        }),
    )
    .expect_err("the bad plan must not be stored");
    assert!(
        error.0.contains("outside the target runtime"),
        "{}",
        error.0
    );
    assert!(studio.project().settings.plan.is_none());
}
