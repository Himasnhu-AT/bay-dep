//! The mix, end to end over the wire: measure the files, duck the bed, read the contour back.
//!
//! **What this exists to stop happening again.** A 61-second video shipped with its music bed
//! cut into 13 clips carrying stepped constant gains and **zero volume keyframes anywhere in the
//! project**. The duck ran backwards: the music-only stretches came out 1.1 dB *louder* than the
//! narration. Every ingredient of the correct version already existed and none of it was used,
//! because chopping the file up silenced the only check that looked at the mix, and a keyframed
//! duck would not have.
//!
//! Three things had to change together, and this exercises all three:
//!
//! 1. **`media_import` measures the file.** `volume: 2.0` is a multiplier, not a level. The bed
//!    it was applied to integrates to −35.3 LUFS, so `2.0` was a rational response to a very
//!    quiet asset and still about 9 LU short — a fact no reasoning about the number could reach.
//! 2. **`duck` writes the keyframes.** Four per line, on one clip, derived from where the lines
//!    already are.
//! 3. **`check` reports the contour in LUFS**, so the answer to "did that help" is a number in
//!    the same unit as the question.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn scratch(tag: &str) -> std::path::PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("bay-mix-{tag}-{stamp}"));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn call_err(studio: &mut Studio, name: &str, args: Value) -> String {
    match tools::dispatch(studio, name, &args) {
        Ok(value) => panic!("{name} should have been refused, got {value}"),
        Err(error) => error.to_string(),
    }
}

/// Synthesise a WAV at a known level. `gain` is applied to a tone, so a caller can make one
/// file genuinely quieter than another and watch the measurement notice.
fn tone(root: &std::path::Path, name: &str, seconds: f64, frequency: u32, gain: f64) -> String {
    let path = root.join(format!("{name}.wav"));
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            &format!("sine=frequency={frequency}:duration={seconds}"),
            "-af",
            &format!("volume={gain}"),
            "-c:a",
            "pcm_s16le",
        ])
        .arg(&path)
        .status()
        .expect("ffmpeg runs");
    assert!(status.success(), "could not synthesise {name}");
    path.to_string_lossy().to_string()
}

/// A project with a bed and three spoken lines over it, both files measured at import.
fn narrated(studio: &mut Studio, root: &std::path::Path, bed_gain: f64) -> (String, Vec<String>) {
    call(
        studio,
        "project_create",
        json!({ "name": "mix", "brief": "a data explainer, technical and plain" }),
    );
    let bed_path = tone(root, "bed", 30.0, 220, bed_gain);
    let voice_path = tone(root, "voice", 6.0, 440, 1.0);
    let bed_media = call(studio, "media_import", json!({ "path": bed_path }));
    let voice_media = call(studio, "media_import", json!({ "path": voice_path }));

    let bed = call(
        studio,
        "add_audio",
        json!({
            "id": "bed",
            "mediaId": bed_media["mediaId"],
            "start": 0.0,
            "duration": 30.0,
            "volume": 1.0,
            "role": "bed",
        }),
    );
    assert_eq!(bed["elementId"], "bed");

    let mut lines = Vec::new();
    for index in 0..3 {
        let id = format!("line-{index}");
        call(
            studio,
            "add_audio",
            json!({
                "id": id,
                "mediaId": voice_media["mediaId"],
                "start": 2.0 + f64::from(index) * 10.0,
                "duration": 5.0,
                "volume": 1.0,
                "role": "speech",
            }),
        );
        lines.push(id);
    }
    // Something on the picture lane, or `nothing-visual` swamps the report.
    call(
        studio,
        "add_text",
        json!({ "start": 0.0, "duration": 30.0, "content": "Wicks", "role": "headline" }),
    );
    ("bed".to_string(), lines)
}

fn separation(report: &Value) -> f64 {
    report["stats"]["mix"]["separationLu"]
        .as_f64()
        .unwrap_or_else(|| panic!("no separation in {}", report["stats"]["mix"]))
}

fn fired(report: &Value, code: &str) -> bool {
    report["rollup"].get(code).is_some()
}

/// The import measures the file, and the measurement is the thing a level can be reasoned in.
#[test]
fn media_import_measures_what_the_file_is() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let root = scratch("import");
    let mut studio = Studio::with_library_root(Some(root.clone()));
    call(&mut studio, "project_create", json!({ "name": "levels" }));

    let loud = call(
        &mut studio,
        "media_import",
        json!({ "path": tone(&root, "loud", 4.0, 440, 1.0) }),
    );
    let quiet = call(
        &mut studio,
        "media_import",
        json!({ "path": tone(&root, "quiet", 4.0, 440, 0.1) }),
    );

    for measured in [&loud, &quiet] {
        for field in ["lufs", "peakDb", "rmsDb"] {
            assert!(
                measured["loudness"][field].is_number(),
                "{field} missing from {measured}"
            );
        }
    }
    let apart =
        loud["loudness"]["lufs"].as_f64().unwrap() - quiet["loudness"]["lufs"].as_f64().unwrap();
    assert!(
        (apart - 20.0).abs() < 1.0,
        "a file made 20 dB quieter measures 20 LU quieter, got {apart:.1}"
    );

    // `audio_probe` is the same measurement under its own name, for a file imported before the
    // measurement existed — and it is reachable as `media_import {mediaId}` for a session whose
    // tool list was cached before `audio_probe` was added to it.
    let again = call(
        &mut studio,
        "audio_probe",
        json!({ "mediaId": loud["mediaId"] }),
    );
    assert_eq!(again["lufs"], loud["loudness"]["lufs"]);
    let through_import = call(
        &mut studio,
        "media_import",
        json!({ "mediaId": loud["mediaId"] }),
    );
    assert_eq!(through_import["lufs"], again["lufs"]);
}

/// The whole loop. A bed at one level under and between the lines is reported as masked speech;
/// one `duck` call answers it, and the answer is visible as a number in the same unit.
#[test]
fn a_duck_turns_a_masked_mix_into_a_contour() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let root = scratch("duck");
    let mut studio = Studio::with_library_root(Some(root.clone()));
    let (bed, lines) = narrated(&mut studio, &root, 1.0);

    let before = call(&mut studio, "check", json!({}));
    assert!(
        fired(&before, "speech-masked"),
        "a bed that never moves masks the lines: {}",
        before["rollup"]
    );
    let flat = separation(&before);

    // Three numbers, and not one keyframe time. Where the lines are is bay's own knowledge.
    let ducked = call(
        &mut studio,
        "duck",
        json!({
            "bedId": bed,
            "underIds": lines,
            "depthDb": 10.0,
            // …and the bed sits under the voice between the lines, which is the other half of
            // what makes a contour. A duck alone cannot separate two states that are level.
            "volume": 0.4,
        }),
    );
    let keys = ducked["duck"]["keys"]
        .as_array()
        .expect("the keys it wrote");
    assert_eq!(
        keys.len(),
        13,
        "four keys a line plus a leading hold: {keys:?}"
    );
    assert!(
        keys.iter().any(|key| key["easing"] == "sine-in-out"),
        "the recovery is corner-free at both ends: {keys:?}"
    );
    assert_eq!(ducked["duck"]["lines"].as_array().map(Vec::len), Some(3));

    let after = call(&mut studio, "check", json!({}));
    assert!(
        !fired(&after, "speech-masked"),
        "the duck answers it: {} at {} LU",
        after["rollup"],
        separation(&after)
    );
    assert!(
        separation(&after) > flat + 4.0,
        "the contour has to move: {flat:.1} LU before, {:.1} after",
        separation(&after)
    );
}

/// `audio_set` reaches the same implementation, because a live MCP session caches the tool list
/// at connect time and cannot call a name that did not exist when it connected.
#[test]
fn audio_set_ducks_through_the_name_a_live_session_already_has() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let root = scratch("audio-set");
    let mut studio = Studio::with_library_root(Some(root.clone()));
    let (bed, _) = narrated(&mut studio, &root, 1.0);

    // No `duckUnder` list at all: every speech clip on the timeline.
    let ducked = call(
        &mut studio,
        "audio_set",
        json!({ "elementId": bed, "volume": 0.4, "duckUnder": [] }),
    );
    assert_eq!(ducked["duck"]["lines"].as_array().map(Vec::len), Some(3));
    let after = call(&mut studio, "check", json!({}));
    assert!(!fired(&after, "speech-masked"), "{}", after["rollup"]);

    // …and without it, `audio_set` is still only the level-and-mute tool. Keyframing a clip
    // somebody wanted to turn down would be a worse surprise than any error message.
    let plain = call(
        &mut studio,
        "audio_set",
        json!({ "elementId": bed, "volume": 0.5 }),
    );
    assert!(plain.get("duck").is_none(), "{plain}");
}

/// The shapes that are not a duck are refused by name, with the reason. A 20 ms attack pumps and
/// a release faster than the attack is the pump the asymmetry exists to avoid — both are
/// audible mistakes, and a warning about an audible mistake is a warning nobody reads.
#[test]
fn a_duck_that_would_pump_is_refused_with_the_reason() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let root = scratch("pump");
    let mut studio = Studio::with_library_root(Some(root.clone()));
    let (bed, lines) = narrated(&mut studio, &root, 1.0);

    let error = call_err(
        &mut studio,
        "duck",
        json!({ "bedId": bed, "underIds": lines, "attackMs": 20.0 }),
    );
    assert!(error.contains("attackMs"), "{error}");

    let error = call_err(
        &mut studio,
        "duck",
        json!({ "bedId": bed, "underIds": lines, "attackMs": 300.0, "releaseMs": 250.0 }),
    );
    assert!(error.contains("releaseMs"), "{error}");

    let error = call_err(
        &mut studio,
        "duck",
        json!({ "bedId": bed, "underIds": ["line-0"], "depthDb": 0.5 }),
    );
    assert!(error.contains("depthDb"), "{error}");
}

/// Ducking the wrong thing under itself, or under a clip that never plays over it, is an error
/// rather than a silent success. An agent that asked for a duck and got `applied: 1` with no
/// keyframes would believe it had one.
#[test]
fn ducking_nothing_is_an_error_not_a_silent_success() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let root = scratch("nothing");
    let mut studio = Studio::with_library_root(Some(root.clone()));
    let (bed, _) = narrated(&mut studio, &root, 1.0);

    let error = call_err(
        &mut studio,
        "duck",
        json!({ "bedId": bed, "underIds": [bed] }),
    );
    assert!(error.contains("itself"), "{error}");

    let error = call_err(
        &mut studio,
        "duck",
        json!({ "bedId": bed, "underIds": ["no-such-clip"] }),
    );
    assert!(error.contains("no-such-clip"), "{error}");
}
