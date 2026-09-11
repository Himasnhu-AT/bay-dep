//! Real-footage acceptance proof for Phase 4 seeing.
//!
//! Run from `rust/` with the provisioned vision model and the podcast-cut fixture present.

use std::error::Error;
use std::path::PathBuf;

use bay_mcp::{studio::Studio, tools};
use serde_json::{Value, json};

fn call(studio: &mut Studio, name: &str, args: Value) -> Result<Value, Box<dyn Error>> {
    tools::dispatch(studio, name, &args).map_err(|error| error.into())
}

fn write_json(path: &PathBuf, value: &Value) -> Result<(), Box<dyn Error>> {
    serde_json::to_writer_pretty(std::fs::File::create(path)?, value)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()?;
    let source = root.join("assets/podcast-cut/pod/goodall.webm");
    if !source.is_file() {
        return Err(format!("real fixture is missing: {}", source.display()).into());
    }
    if !bay_vision::status().available {
        return Err("vision model is unavailable; install the managed vision component".into());
    }
    let output = root.join("research/phase4-seeing");
    std::fs::create_dir_all(&output)?;

    let mut studio = Studio::new();
    call(
        &mut studio,
        "project_create",
        json!({
            "name": "phase4-seeing-goodall",
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "kit": "stadium",
            "background": "#000000"
        }),
    )?;
    call(
        &mut studio,
        "media_import",
        json!({ "path": source, "id": "goodall" }),
    )?;

    let indexed = studio.media_index("goodall")?;
    let query = "an elderly woman with long gray hair speaking in an interview";
    let search = studio.media_search(query, Some("goodall"), 8)?;
    write_json(&output.join("semantic-search.json"), &search)?;

    // Shots 32–34 contain host → guest → host and therefore prove the framing survives cuts.
    let source_start = 247.280;
    let source_end = 270.937;
    let duration = source_end - source_start;
    call(
        &mut studio,
        "add_video",
        json!({
            "mediaId": "goodall",
            "id": "tracked-interview",
            "start": 0.0,
            "duration": duration,
            "trimStart": source_start,
            "layer": 0,
            "role": "ground"
        }),
    )?;
    let reframe = studio.auto_reframe("tracked-interview", 1080, 1920, 0.5, 0.9)?;
    write_json(&output.join("reframe-path.json"), &reframe)?;
    studio.project_save(Some(
        output
            .join("goodall-vertical.project.json")
            .to_string_lossy()
            .as_ref(),
    ))?;

    let sheet = studio.contact_sheet(
        output
            .join("goodall-vertical-contact-sheet.png")
            .to_string_lossy()
            .as_ref(),
        &[0.5, 3.8, 4.3, 13.9, 14.7, 22.8],
        3,
    )?;
    let render = studio.render_video(
        output
            .join("goodall-vertical.mp4")
            .to_string_lossy()
            .as_ref(),
        None,
        bay_preview::ExportSettings::default(),
        Some("phase4 real-footage acceptance".into()),
    )?;
    let summary = json!({
        "source": source,
        "semanticQuery": query,
        "index": indexed,
        "search": search,
        "reframe": reframe,
        "contactSheet": sheet,
        "render": render,
    });
    write_json(&output.join("acceptance.json"), &summary)?;
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
