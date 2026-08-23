use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|error| panic!("{name}: {error}"))
}

#[test]
fn writes_phase3_text_contact_sheet() {
    let root = std::env::temp_dir().join("bay-phase3-visual");
    std::fs::create_dir_all(&root).unwrap();
    let srt = root.join("karaoke.srt");
    std::fs::write(
        &srt,
        "1\n00:00:00,000 --> 00:00:02,400\nCraft moves fast\n\n",
    )
    .unwrap();
    let output = root.join("contact.png");

    let mut studio = Studio::with_library_root(Some(root.clone()));
    call(
        &mut studio,
        "project_create",
        json!({
            "name": "Phase 3 visual",
            "width": 640,
            "height": 360,
            "fps": 30,
            "kit": "swiss",
            "background": "#F3EFE5"
        }),
    );
    call(
        &mut studio,
        "add_text",
        json!({
            "id": "decorated-title",
            "start": 0,
            "duration": 2.4,
            "content": "STROKE / SHADOW / PLATE",
            "role": "headline",
            "tone": "accent",
            "x": 0.5,
            "y": 0.32,
            "scale": 0.45,
            "align": "center",
            "stroke": { "width": 4, "color": "#09101F" },
            "shadow": { "offsetX": 8, "offsetY": 10, "blur": 8, "color": "#000000A8" },
            "plate": { "color": "#F7C948CC", "paddingX": 20, "paddingY": 12, "radius": 14 }
        }),
    );
    call(
        &mut studio,
        "subtitles_add",
        json!({ "path": srt.to_string_lossy(), "captionStyle": "loud" }),
    );
    call(
        &mut studio,
        "contact_sheet",
        json!({
            "path": output.to_string_lossy(),
            "times": [0.2, 1.0, 1.9],
            "columns": 3
        }),
    );

    assert!(output.exists(), "contact sheet was not written");
    assert!(std::fs::metadata(output).unwrap().len() > 10_000);
}
