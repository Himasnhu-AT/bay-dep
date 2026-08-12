//! **Caption discipline**: `narrate`'s defaults, and the eleven arguments that are gone.
//!
//! Measured on the project this comes from: 76 three-frame caption fades, 8 cues too short to
//! read, 18 over 17 characters a second, 2 that spanned a full stop, one 10.30 s 29-word run-on
//! landing on the turn — and 38 caption elements sharing x = 0.08, because `captionY` was the
//! only placement argument there was. Every one of those came out of a default or a missing
//! parameter, not out of a check the agent ignored.

use bay_mcp::{Studio, tools};
use bay_project::Element;
use serde_json::{Value, json};

fn scratch_studio(tag: &str) -> (Studio, std::path::PathBuf) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("bay-captions-{tag}-{stamp}"));
    std::fs::create_dir_all(&root).unwrap();
    (Studio::with_library_root(Some(root.clone())), root)
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

/// A two-cue subtitle file — the cheapest way to put captions on a timeline with no Kokoro.
fn srt(root: &std::path::Path) -> String {
    let path = root.join("fixture.srt");
    std::fs::write(
        &path,
        "1\n00:00:00,000 --> 00:00:02,000\nAverages add.\n\n\
         2\n00:00:02,500 --> 00:00:05,000\nMoney compounds.\n\n",
    )
    .unwrap();
    path.to_string_lossy().to_string()
}

fn captions(studio: &Studio) -> Vec<bay_project::TextElement> {
    studio
        .project()
        .active_scene()
        .elements()
        .filter_map(|element| match element {
            Element::Text(text) if text.id.starts_with("caption-") => Some(text.clone()),
            _ => None,
        })
        .collect()
}

/// All eleven of them, on all three tools that took them. Refused rather than ignored: an
/// argument that is silently dropped teaches the caller it worked.
#[test]
fn the_eleven_caption_arguments_are_refused_not_ignored() {
    let (mut studio, root) = scratch_studio("deleted");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    let path = srt(&root);

    for (key, value) in [
        ("captionFontSize", json!(34)),
        ("captionColor", json!("#4A4A58")),
        ("captionFontFamily", json!("Menlo")),
        ("captionFontWeight", json!(400)),
        ("captionLayer", json!(3)),
        ("captionFade", json!(0.1)),
        ("maxWords", json!(9)),
        ("minCaptionSeconds", json!(0.2)),
        ("maxCaptionSeconds", json!(11.0)),
        ("gapSeconds", json!(0.05)),
        ("captionAnchor", json!(0.5)),
    ] {
        let error = call_err(
            &mut studio,
            "subtitles_add",
            json!({ "path": path, key: value }),
        );
        assert!(error.contains(key), "{error}");
        assert!(
            error.contains("captionStyle"),
            "the message names the way in: {error}"
        );
    }

    // …and on narrate, which is the one that produced them all.
    let error = call_err(
        &mut studio,
        "narrate",
        json!({ "text": "hello there", "captionFade": 0.1 }),
    );
    assert!(error.contains("captionFade"), "{error}");
    assert!(
        error.contains("0.28"),
        "the message says what the fade is now: {error}"
    );
}

/// The caption's look is the kit's answer to a preset — no argument reaches it.
#[test]
fn a_caption_takes_its_type_from_the_committed_kit() {
    let (mut studio, root) = scratch_studio("kit-type");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(&mut studio, "subtitles_add", json!({ "path": srt(&root) }));

    let kit = bay_project::builtin_kit("swiss").unwrap();
    let step = kit.resolve(bay_project::ElementRole::Caption, bay_project::Tone::Ink);
    let placed = captions(&studio);
    assert_eq!(placed.len(), 2);
    for caption in &placed {
        assert_eq!(caption.font_family.as_deref(), Some(step.family.as_str()));
        assert_eq!(caption.font_weight, step.weight);
        assert_eq!(caption.font_size, step.size);
        assert_eq!(caption.color, step.color);
    }
}

/// `loud` is a different job, not a bigger number: headline type, two words a line.
#[test]
fn the_caption_preset_changes_what_the_captions_are_doing() {
    let (mut studio, root) = scratch_studio("preset");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(
        &mut studio,
        "subtitles_add",
        json!({ "path": srt(&root), "captionStyle": "loud" }),
    );
    let kit = bay_project::builtin_kit("swiss").unwrap();
    let loud = captions(&studio);
    assert_eq!(loud[0].font_size, kit.ramp.headline.size, "{loud:?}");

    let (mut studio, root) = scratch_studio("preset-quiet");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(
        &mut studio,
        "subtitles_add",
        json!({ "path": srt(&root), "captionStyle": "quiet" }),
    );
    let quiet = captions(&studio);
    assert_eq!(quiet[0].font_size, kit.ramp.label.size, "{quiet:?}");
    assert_eq!(quiet[0].color, kit.palette.dim, "a quiet caption is dim");
    assert!(
        quiet[0].font_size < loud[0].font_size,
        "the three presets are a hierarchy, not three names for one size"
    );

    let error = call_err(
        &mut studio,
        "subtitles_add",
        json!({ "path": root.join("fixture.srt").to_string_lossy(), "captionStyle": "enormous" }),
    );
    assert!(error.contains("enormous"), "{error}");
    assert!(error.contains("plain"), "it lists what there is: {error}");
}

/// The x that 38 elements shared. It comes from the kit now, and it is settable.
#[test]
fn captions_are_placed_by_the_kit_and_by_the_caller_not_by_a_constant() {
    let (mut studio, root) = scratch_studio("place-grid");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(&mut studio, "subtitles_add", json!({ "path": srt(&root) }));
    let grid = captions(&studio)[0].transform;

    // A centred kit puts its lower third somewhere else entirely — which is the whole point of
    // taking the placement off a constant and putting it on the committed look.
    let (mut studio, root) = scratch_studio("place-centred");
    call(
        &mut studio,
        "project_create",
        json!({ "kit": "midcentury" }),
    );
    call(&mut studio, "subtitles_add", json!({ "path": srt(&root) }));
    let centred = captions(&studio)[0].transform;
    assert!(
        (grid.x - centred.x).abs() > 1e-6 || (grid.y - centred.y).abs() > 1e-6,
        "two kits placed their captions identically: {grid:?} vs {centred:?}"
    );
    assert!(
        (centred.anchor_x - 0.5).abs() < 1e-6,
        "a centred kit's captions hang off their middle: {centred:?}"
    );

    // …and anything the caller says still wins.
    let (mut studio, root) = scratch_studio("place-explicit");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(
        &mut studio,
        "subtitles_add",
        json!({ "path": srt(&root), "captionX": 0.5, "captionY": 0.24, "captionAlign": "center" }),
    );
    let explicit = captions(&studio)[0].clone();
    assert!((explicit.transform.x - 0.5).abs() < 1e-6, "{explicit:?}");
    assert!((explicit.transform.y - 0.24).abs() < 1e-6, "{explicit:?}");
    assert!(
        (explicit.transform.anchor_x - 0.5).abs() < 1e-6,
        "{explicit:?}"
    );
    assert_eq!(explicit.align, bay_project::TextAlign::Center);
}

/// 76 three-frame pops came out of one constant. At 30 fps 0.28 s is eight and a half frames.
#[test]
fn every_caption_fades_for_long_enough_to_read_as_a_fade() {
    let (mut studio, root) = scratch_studio("fade");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(&mut studio, "subtitles_add", json!({ "path": srt(&root) }));

    for caption in captions(&studio) {
        let opacity = caption
            .animations
            .get("opacity")
            .expect("a caption fades rather than cutting");
        let rise = opacity.keys[1].time.to_seconds_f64() - opacity.keys[0].time.to_seconds_f64();
        let duration = caption.duration.to_seconds_f64();
        // Clamped to a third of a very short cue, so the claim is "the constant, or as much of
        // it as fits" rather than a flat number.
        let expected = bay_mcp::narration::CAPTION_FADE_SECONDS.min(duration / 3.0);
        assert!(
            (rise - expected).abs() < 1e-6,
            "a {rise:.3}s fade is {:.1} frames at 30fps: {caption:?}",
            rise * 30.0
        );
        assert!(
            rise * 30.0 >= 4.0,
            "a fade under four frames is a pop, which is what 76 of these were"
        );
    }
}

/// The 10.30 s run-on, refused **before** the synthesis is paid for — so this needs no Kokoro.
#[test]
fn a_line_too_long_to_be_one_clip_is_refused_with_its_own_sentences() {
    let (mut studio, _root) = scratch_studio("too-long");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));

    // 29 words, the length of the one that landed on the turn.
    let run_on = "The wick is the part everyone misreads because it is the range the price \
                  actually travelled through and not the range it was willing to close inside \
                  of, which is the whole distinction.";
    let error = call_err(&mut studio, "narrate", json!({ "text": run_on }));
    assert!(error.contains("8.0s"), "it names the ceiling: {error}");
    assert!(error.contains("words"), "…and what was measured: {error}");

    // Two sentences, so the refusal hands back the split.
    let two = "The wick is the range the price travelled through in this period, which is not \
               the same thing as the range it closed inside of. The body is what it closed \
               inside of, and that distinction is the entire reason the chart is drawn this way.";
    let error = call_err(&mut studio, "narrate", json!({ "text": two }));
    assert!(
        error.contains("2 sentences"),
        "the refusal names the split points: {error}"
    );

    // …and a line that fits is not refused for length. It will fail for want of Kokoro on a
    // machine without it, which is a different message and not this rule's business.
    let short = "The wick is the range.";
    if let Err(error) = tools::dispatch(&mut studio, "narrate", &json!({ "text": short })) {
        let message = error.to_string();
        assert!(
            !message.contains("8.0s"),
            "a five-word line must not be refused for length: {message}"
        );
    }
}

/// The rate is a rate. `speed: 1.0` is 2.99 words a second — 179 wpm — and every plan in the
/// project this comes from was budgeted against a documented 2.5 that nothing delivered.
#[test]
fn the_read_is_planned_in_words_a_second_not_in_multipliers() {
    let speed = bay_speech::speed_for_rate(bay_speech::TARGET_WORDS_PER_SECOND);
    let delivered = bay_speech::BASE_WORDS_PER_SECOND * f64::from(speed);
    let wpm = delivered * 60.0;
    assert!(
        (wpm - 150.0).abs() <= 5.0,
        "the default target must land within 5 wpm of 150, got {wpm:.1}"
    );
    assert!(
        speed < 1.0,
        "hitting 150 wpm means slowing Kokoro down, not speeding it up: {speed}"
    );
    // A caller who states a different rate gets it.
    let faster = bay_speech::speed_for_rate(3.5);
    assert!(faster > speed);
    assert!(
        (bay_speech::BASE_WORDS_PER_SECOND * f64::from(faster) - 3.5).abs() < 0.05,
        "{faster}"
    );
}

/// Captions placed from a subtitle file keep the file's own cue windows — the reading floors
/// apply to cues bay *builds*, and rewriting an author's timings would desynchronise them from
/// the audio they were written against.
#[test]
fn an_imported_subtitle_files_timings_are_left_alone() {
    let (mut studio, root) = scratch_studio("imported");
    call(&mut studio, "project_create", json!({ "kit": "swiss" }));
    call(&mut studio, "subtitles_add", json!({ "path": srt(&root) }));
    let placed = captions(&studio);
    assert!((placed[0].start.to_seconds_f64() - 0.0).abs() < 1e-6);
    assert!((placed[0].duration.to_seconds_f64() - 2.0).abs() < 1e-6);
    assert!((placed[1].start.to_seconds_f64() - 2.5).abs() < 1e-6);
}
