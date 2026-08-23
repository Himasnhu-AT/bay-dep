use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|error| panic!("{name}: {error}"))
}

fn main() {
    let root = std::env::temp_dir().join("bay-phase2-trust-demo");
    std::fs::create_dir_all(&root).unwrap();
    let mut studio = Studio::with_library_root(Some(root.clone()));
    call(
        &mut studio,
        "project_create",
        json!({
            "name": "Trust loop demo",
            "width": 640,
            "height": 360,
            "fps": 12,
            "kit": "swiss",
            "background": "#111111"
        }),
    );
    call(
        &mut studio,
        "plan_create",
        json!({
            "brief": "Prove that a considered edit beats a generic first pass",
            "format": "product-demo",
            "targetRuntimeSeconds": 2.4,
            "approve": true,
            "beats": [
                {"id": "proof", "role": "proof", "at": 0.0, "intent": "show the claim as one decisive frame"}
            ]
        }),
    );
    call(
        &mut studio,
        "add_text",
        json!({
            "id": "hero",
            "start": 0.0,
            "duration": 2.4,
            "content": "BUILT TO WIN",
            "role": "hook",
            "tone": "ink",
            "x": 0.5,
            "y": 0.68,
            "scale": 1.45,
            "align": "center",
            "plate": {
                "color": "#F2F1ED",
                "paddingX": 120,
                "paddingY": 70,
                "radius": 20
            }
        }),
    );
    call(
        &mut studio,
        "animate",
        json!({
            "elementId": "hero",
            "property": "y",
            "keys": [
                {"t": 0.0, "value": 0.64, "easing": "sine-in-out"},
                {"t": 2.4, "value": 0.72}
            ],
            "easing": "sine-in-out"
        }),
    );

    let model = call(&mut studio, "check", json!({}));
    let frames = call(&mut studio, "check_frames", json!({}));
    println!(
        "initial gates: model={} frames={}",
        model["status"], frames["status"]
    );

    let source_id = studio.project().metadata.id.clone();
    let variant = call(
        &mut studio,
        "variant_create",
        json!({"label": "raised-hero"}),
    );
    let variant_id = variant["projectId"].as_str().unwrap().to_string();

    let source_path = root.join("incumbent.mp4");
    let source_render = call(
        &mut studio,
        "render",
        json!({"path": source_path.to_string_lossy()}),
    );
    println!("rendered incumbent: {}", source_render["result"]["bytes"]);
    call(
        &mut studio,
        "variant_register_render",
        json!({"projectId": source_id, "path": source_path.to_string_lossy()}),
    );

    call(&mut studio, "project_load", json!({"id": variant_id}));
    call(
        &mut studio,
        "animate",
        json!({
            "elementId": "hero",
            "property": "x",
            "keys": [
                {"t": 0.0, "value": 0.42, "easing": "sine-in-out"},
                {"t": 2.4, "value": 0.50}
            ],
            "easing": "sine-in-out"
        }),
    );
    let revision_path = root.join("revision.mp4");
    let revision_render = call(
        &mut studio,
        "render",
        json!({"path": revision_path.to_string_lossy()}),
    );
    println!("rendered revision: {}", revision_render["result"]["bytes"]);
    let revision_id = studio.project().metadata.id.clone();
    call(
        &mut studio,
        "variant_register_render",
        json!({"projectId": revision_id, "path": revision_path.to_string_lossy()}),
    );
    let tournament = call(
        &mut studio,
        "tournament_compare",
        json!({
            "leftProjectId": source_id,
            "rightProjectId": revision_id,
            "winnerProjectId": revision_id,
            "reason": "the raised anchor reads faster and gives the lower frame intentional breathing room"
        }),
    );
    println!("tournament: {tournament}");

    let critic = call(
        &mut studio,
        "critic_prepare",
        json!({"path": root.join("critic.png").to_string_lossy()}),
    );
    let panels = critic["contactSheet"]["times"].as_array().unwrap().len();
    let verdict = call(
        &mut studio,
        "critic_submit",
        json!({
            "weakestPanel": 1,
            "mostAlikePair": [1, panels],
            "thumbnailPanel": panels,
            "binaries": [true, true, true, false, true, true, true, true, true],
            "rationale": "the two samples are still too alike, so the next pass must alter composition rather than polish"
        }),
    );
    println!("critic verdict: {verdict}");
}
