//! A sound effect must not switch the mix gate off for the whole project.
//!
//! **What this exists to stop happening again.** `sfx_add` synthesised a WAV, wrote it, and
//! registered it with no loudness at all. One unmeasured asset makes the entire mix envelope
//! unmeasurable — that is deliberate, since a level nobody has measured cannot be compared with
//! one that has — so a single click moved `speech-masked` (the only mix code that can gate) and
//! `bed-too-quiet` into `skipped` and emptied every `stats.mix` field. Measured on
//! project-1786466680050: with every asset measured it fires `speech-masked` at 4.9 LU; with the
//! loudness stripped from its one `m_click` asset the finding disappears and the mix is not
//! evaluated at all. `sfx_add` is a tool the skill teaches, so the gate was off by default for
//! any project that used a sound effect.
//!
//! Most of this file deliberately needs **no ffmpeg**: the sounds are synthesised in process and
//! measured in process, which is the whole point — the measurement cannot depend on a tool the
//! machine may not have, or the gate is off there instead.

use bay_mcp::{Studio, tools};
use serde_json::{Value, json};

fn scratch(tag: &str) -> std::path::PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("bay-sfx-mix-{tag}-{stamp}"));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn call(studio: &mut Studio, name: &str, args: Value) -> Value {
    tools::dispatch(studio, name, &args).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn studio_in(root: &std::path::Path) -> Studio {
    let mut studio = Studio::with_library_root(Some(root.to_path_buf()));
    call(
        &mut studio,
        "project_create",
        json!({ "name": "sfx", "brief": "a data explainer, technical and plain" }),
    );
    studio
}

/// The `loudness` recorded on an asset in the open project, as the project file would hold it.
fn asset_loudness(studio: &Studio, media_id: &Value) -> bay_project::AssetLoudness {
    let id = media_id.as_str().expect("a media id");
    studio
        .project()
        .media
        .iter()
        .find(|asset| asset.id == id)
        .unwrap_or_else(|| panic!("no asset {id} in the project"))
        .loudness
        .clone()
        .unwrap_or_else(|| panic!("{id} was registered without a loudness"))
}

/// Synthesise a sound and place it under a role of the caller's choosing.
///
/// `sfx_add` always places what it makes as an effect, which is right — but a mix needs a bed
/// and lines to have two states to compare, so the placed element is dropped and the *measured
/// media* re-placed in the role under test. What is being exercised is the asset's measurement,
/// not the role `sfx_add` picks.
fn sound_as(studio: &mut Studio, sfx: &str, role: &str, start: f64, seconds: f64, level: f64) {
    let made = call(
        studio,
        "sfx_add",
        json!({ "sfx": sfx, "start": start, "duration": seconds, "level": level }),
    );
    let element = made["elementId"]
        .as_str()
        .expect("sfx_add returns its element");
    call(studio, "element_delete", json!({ "elementId": element }));
    call(
        studio,
        "add_audio",
        json!({
            "mediaId": made["mediaId"],
            "start": start,
            "duration": seconds,
            "volume": 1.0,
            "role": role,
        }),
    );
}

fn skipped_reason<'a>(report: &'a Value, code: &str) -> Option<&'a str> {
    report["skipped"]
        .as_array()?
        .iter()
        .find(|skip| skip["code"] == code)
        .and_then(|skip| skip["reason"].as_str())
}

/// The measurement itself: `sfx_add` records what it synthesised, without ffmpeg.
#[test]
fn sfx_add_measures_the_sound_it_makes() {
    let root = scratch("measures");
    let mut studio = studio_in(&root);

    let made = call(
        &mut studio,
        "sfx_add",
        json!({ "sfx": "chime", "start": 1.0, "duration": 1.5 }),
    );
    for field in ["lufs", "peakDb", "rmsDb"] {
        assert!(
            made["loudness"][field].is_number(),
            "{field} missing from {made}"
        );
    }

    let loudness = asset_loudness(&studio, &made["mediaId"]);
    assert!(loudness.lufs.is_finite() && loudness.rms_db.is_finite());
    assert!(
        loudness.is_audible(),
        "a 1.5 s chime is longer than a gating block: {loudness:?}"
    );
    // Rendered to a peak of the default level, 0.7 — which is -3.1 dBFS.
    assert!(
        (loudness.peak_db - (-3.1)).abs() < 0.3,
        "{loudness:?} is not the level it was asked for"
    );
    // …and the level does not come from the peak: two sounds at one peak measure differently,
    // which is the difference between a multiplier and a measurement.
    let other = call(
        &mut studio,
        "sfx_add",
        json!({ "sfx": "sub-drop", "start": 4.0, "duration": 1.5 }),
    );
    let sub = asset_loudness(&studio, &other["mediaId"]);
    assert!(
        (sub.peak_db - loudness.peak_db).abs() < 0.3,
        "same peak: {sub:?} vs {loudness:?}"
    );
    assert!(
        (sub.lufs - loudness.lufs).abs() > 1.0,
        "different sounds at one peak are not one level: {sub:?} vs {loudness:?}"
    );

    // A sound shorter than R128's 400 ms block has no integrated loudness, and saying so is not
    // the same as failing to measure it: the mean is what places it, and the mix reads that.
    let click = call(
        &mut studio,
        "sfx_add",
        json!({ "sfx": "click", "start": 6.0 }),
    );
    let click = asset_loudness(&studio, &click["mediaId"]);
    assert!(!click.is_audible(), "{click:?}");
    assert!(
        click.level_lufs() > -40.0,
        "a click that peaks at -3 dBFS is not silence: {click:?}"
    );
}

/// The finding, end to end: a timeline carrying a sound effect still reports its mix.
#[test]
fn a_sound_effect_does_not_switch_the_mix_gate_off() {
    let root = scratch("gate");
    let mut studio = studio_in(&root);

    sound_as(&mut studio, "swell", "bed", 0.0, 30.0, 0.5);
    for index in 0..3 {
        sound_as(
            &mut studio,
            "beep",
            "speech",
            2.0 + f64::from(index) * 10.0,
            5.0,
            0.9,
        );
    }
    call(
        &mut studio,
        "add_text",
        json!({ "start": 0.0, "duration": 30.0, "content": "Wicks", "role": "headline" }),
    );

    let before = call(&mut studio, "check", json!({}));
    let separation = before["stats"]["mix"]["separationLu"]
        .as_f64()
        .unwrap_or_else(|| {
            panic!(
                "no separation before the effect: {}",
                before["stats"]["mix"]
            )
        });

    // The click that used to end the measurement.
    call(
        &mut studio,
        "sfx_add",
        json!({ "sfx": "click", "start": 12.0 }),
    );
    let after = call(&mut studio, "check", json!({}));
    assert!(
        after["stats"]["mix"]["unmeasured"].is_null(),
        "a synthesised sound arrives measured: {}",
        after["stats"]["mix"]
    );
    let with_effect = after["stats"]["mix"]["separationLu"]
        .as_f64()
        .unwrap_or_else(|| {
            panic!(
                "the effect ended the measurement: {}",
                after["stats"]["mix"]
            )
        });
    for code in ["speech-masked", "bed-too-quiet"] {
        assert!(
            skipped_reason(&after, code).is_none(),
            "{code} was skipped after one sfx_add: {:?}",
            after["skipped"]
        );
    }
    // A 60 ms click inside a 30 s programme is a transient, not a level: the plateau it is
    // measured against cannot move by more than a tenth of a LU.
    assert!(
        (with_effect - separation).abs() <= 0.2,
        "one click moved the contour from {separation:.2} to {with_effect:.2} LU"
    );
}

/// The other half, and the one that must never quietly become a pass: an asset nobody could
/// measure puts both mix codes in `skipped`, and the reason names the asset.
///
/// Refusing to certify is the right behaviour — a level compared against an unknown is not a
/// measurement — but it is only defensible while it is *visible*. A silent skip is
/// indistinguishable from a clean mix, which is exactly how a project with 13 stepped bed clips
/// came back clean.
#[test]
fn an_unmeasured_sound_is_named_in_skipped_rather_than_passed() {
    let root = scratch("unmeasured");
    let mut studio = studio_in(&root);

    // A file bay cannot measure: it exists, so it imports and places, and neither ffmpeg nor
    // anything else can say what it sounds like. That is the state a probe failure leaves an
    // asset in, on any machine.
    let unreadable = root.join("not-really.wav");
    std::fs::write(&unreadable, b"this is not a wav file").unwrap();
    let imported = call(
        &mut studio,
        "media_import",
        json!({ "path": unreadable.to_string_lossy() }),
    );
    let media_id = imported["mediaId"]
        .as_str()
        .expect("a media id")
        .to_string();
    assert!(
        studio
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .expect("the imported asset")
            .loudness
            .is_none(),
        "the fixture is only a fixture while the file cannot be measured"
    );

    call(
        &mut studio,
        "add_audio",
        json!({
            "mediaId": media_id,
            "start": 0.0,
            "duration": 20.0,
            "volume": 1.0,
            "role": "bed",
        }),
    );
    sound_as(&mut studio, "beep", "speech", 2.0, 5.0, 0.9);
    call(
        &mut studio,
        "add_text",
        json!({ "start": 0.0, "duration": 20.0, "content": "Wicks", "role": "headline" }),
    );

    let report = call(&mut studio, "check", json!({}));
    for code in ["speech-masked", "bed-too-quiet"] {
        let reason = skipped_reason(&report, code)
            .unwrap_or_else(|| panic!("{code} neither fired nor skipped: {report}"));
        assert!(
            reason.contains(&media_id),
            "{code}'s reason does not name the asset that stopped it: {reason}"
        );
        assert!(
            report["rollup"].get(code).is_none(),
            "{code} cannot have found anything on a mix it could not measure"
        );
    }
    assert!(
        report["stats"]["mix"]["separationLu"].is_null(),
        "an unmeasurable mix has no separation to report: {}",
        report["stats"]["mix"]
    );
    assert_eq!(
        report["stats"]["mix"]["unmeasured"],
        json!([media_id]),
        "the report names the asset in its stats too: {}",
        report["stats"]["mix"]
    );
    // …and the whole report says so. A skip that leaves the status at `ok` is a pass with extra
    // steps.
    assert_ne!(report["status"], json!("ok"), "{report}");
}

/// The reviewer's own scenario, on real files: two imported tones measured by ffmpeg and a
/// synthesised click measured in process, in one project. The two measurements have to live on
/// the same scale, or the effect is placed in the envelope at a level no imported file shares.
#[test]
fn a_measured_import_and_a_synthesised_sound_share_one_scale() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    let root = scratch("scale");
    let mut studio = studio_in(&root);

    let tone = root.join("bed.wav");
    let made = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:duration=20:sample_rate=48000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
        ])
        .arg(&tone)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !bay_test_support::require_ffmpeg_step(made, "synthesise the bed tone") {
        return;
    }

    let bed = call(
        &mut studio,
        "media_import",
        json!({ "path": tone.to_string_lossy() }),
    );
    call(
        &mut studio,
        "add_audio",
        json!({ "mediaId": bed["mediaId"], "start": 0.0, "duration": 20.0, "volume": 1.0, "role": "bed" }),
    );
    sound_as(&mut studio, "beep", "speech", 2.0, 5.0, 0.9);
    call(
        &mut studio,
        "add_text",
        json!({ "start": 0.0, "duration": 20.0, "content": "Wicks", "role": "headline" }),
    );
    call(
        &mut studio,
        "sfx_add",
        json!({ "sfx": "impact", "start": 8.0, "duration": 1.0 }),
    );

    let report = call(&mut studio, "check", json!({}));
    assert!(
        report["stats"]["mix"]["separationLu"].is_number(),
        "an imported file and a synthesised one measure together: {}",
        report["stats"]["mix"]
    );

    // The same sound, measured by the two paths, on the same file: bay's own measurement of the
    // samples, and ffmpeg's of the WAV they were written to.
    let effect = call(
        &mut studio,
        "sfx_add",
        json!({ "sfx": "swell", "start": 14.0, "duration": 3.0 }),
    );
    let ours = asset_loudness(&studio, &effect["mediaId"]);
    let theirs = bay_preview::probe::probe_loudness(effect["path"].as_str().expect("the wav path"))
        .expect("ffmpeg measures the file bay wrote");
    assert!(
        (ours.lufs - theirs.lufs).abs() <= 0.2,
        "bay measured {:.2} LUFS, ffmpeg {:.2} on the same file",
        ours.lufs,
        theirs.lufs
    );
    assert!(
        (ours.rms_db - theirs.rms_db).abs() <= 0.2,
        "bay measured a mean of {:.2} dBFS, ffmpeg {:.2}",
        ours.rms_db,
        theirs.rms_db
    );
}
