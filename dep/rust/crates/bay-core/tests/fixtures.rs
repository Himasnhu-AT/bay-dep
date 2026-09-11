//! `check`, computed against five projects that are checked in — and asserted exactly.
//!
//! **This is the ruler.** Round 1 shipped five perceptual checks that were never once computed
//! against the video they were written to catch, and all five passed it. Round 2 then shipped
//! fourteen gating codes with the same hole in a different place: `corpus.rs` reads a directory
//! on one person's machine and prints `skipped` when the variable is unset, so continuous
//! integration measured nothing at all. Five gating codes shipped without the three numbers
//! plan §1.4 commitment 4 requires of them.
//!
//! So the fixtures live in the repository and this test always runs:
//!
//! | fixture | what it is |
//! |---|---|
//! | `r1-locked.json` | **R1** — the Palmier reply-screenshot demo. Three elements, all present from t = 0, none animated, one locked frame for 39.3 s. A video we admire. |
//! | `r2-accumulate.json` | **R2** — the doodle explainer. Nineteen illustration and logo assets arriving on narration cues onto one blush ground and never leaving, 57.2 s. The video we admire most. |
//! | `wicks-v2.json` | the 62 s candlestick video this round exists because of. |
//! | `candlestick-wick-volatility.json` | its first predecessor, also condemned. |
//! | `candlestick-wicks.json` | its second predecessor, also condemned. |
//!
//! The first two are hand-built from the measurements in `prompt-res/12-video-teardowns.md` and
//! `prompt-res/round2/32-composition.md`; the last three are byte-for-byte copies of real
//! projects out of `~/Library/Application Support/bay/projects`.
//!
//! **Every assertion here is the *measured* behaviour, not the wanted one.** When these fixtures
//! were first built, `broken-continuity` fired **eleven times on R2** and twice on wicks-v2, and
//! this file recorded that rather than tuning it away — which is how the repair got a number to
//! argue with. Five codes have since been repaired against these five projects: the
//! accumulation clause on `broken-continuity`, the removal of the opacity gate and the ΔE00
//! aggregation on `dead-plate` and `empty-container`, the opening-second denominator on
//! `no-hook`, and the deletion of the whole-project forms of `monotone-easing` and
//! `monotone-duration`. Nothing in either fixture was moved to make a check look better; the
//! fixtures are the videos, and the checks are what gets fixed.
//! `docs/native/check-codes.md` carries the same table with a column per fixture.

use std::collections::BTreeMap;
use std::path::PathBuf;

use bay_core::check::{Report, Severity, Status, check, gating_codes};
use bay_project::Project;

/// Load a checked-in fixture through the same path the editor and the MCP server load a project
/// with — including `infer_provenance`, which is what an old file's `source` and `role` come
/// from.
fn fixture(name: &str) -> Project {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    bay_project::library::read_project(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Every code that fired, with its count — the exact thing each test below pins.
fn rollup(report: &Report) -> Vec<(&'static str, usize)> {
    report
        .rollup
        .iter()
        .map(|(code, count)| (*code, *count))
        .collect()
}

/// Every code that could not be evaluated. A check that did not run is not a check that passed,
/// so this is asserted alongside the rollup rather than left implicit.
fn skipped(report: &Report) -> Vec<&'static str> {
    report.skipped.iter().map(|skip| skip.code).collect()
}

/// How many times `code` fired.
fn count(report: &Report, code: &str) -> usize {
    report.rollup.get(code).copied().unwrap_or(0)
}

/// Every `Error`-severity code that fired, with its count. The four numbers commitment 4 asks
/// for are all read off this.
fn gating(report: &Report) -> BTreeMap<&'static str, usize> {
    gating_codes()
        .into_iter()
        .filter_map(|code| {
            let fired = count(report, code);
            (fired > 0).then_some((code, fired))
        })
        .collect()
}

// ------------------------------------------------------------------------------ the references

/// **R1 — editorially clean, but its checked-in media paths are intentionally absent.**
///
/// One note, `one-scene`, which is exactly right about it: R1 has no narration and no markers,
/// so it declares no beats and the derivation falls back to eight-second windows. That is also
/// why `broken-continuity` does not evaluate here — see
/// [`r1_and_r2_are_silent_on_broken_continuity_for_the_same_reason`], which is an abstention
/// rather than a pass, and which measures what the rule says about R1 once it does run.
#[test]
fn r1_locked_reports_only_its_absent_media_gate() {
    let report = check(&fixture("r1-locked.json"));

    assert_eq!(
        gating(&report),
        BTreeMap::from([("missing-media", 3)]),
        "{:?}",
        report.findings
    );
    assert_eq!(
        rollup(&report),
        vec![("missing-media", 3), ("one-scene", 1), ("sparse-events", 1),]
    );
    assert_eq!(
        skipped(&report),
        vec!["broken-continuity", "speech-masked", "bed-too-quiet"]
    );
    assert_eq!(
        (report.errors, report.warnings, report.notes, report.total),
        (3, 1, 1, 5)
    );
    assert_eq!(report.status, Status::Findings);

    // The shape the teardown measured, restated as facts about the model: three visual elements,
    // all present from the first frame, not one of them animated.
    let scene = fixture("r1-locked.json");
    let scene = scene.active_scene();
    let visual: Vec<_> = scene
        .authored_elements()
        .filter(|element| element.transform().is_some())
        .collect();
    assert_eq!(visual.len(), 3);
    assert!(visual.iter().all(|element| element.start().as_ticks() == 0));
    assert!(
        visual
            .iter()
            .all(|element| element.animated_property_count() == 0)
    );
    assert_eq!(
        report.stats.hook_ink, report.stats.median_frame_ink,
        "a locked frame carries exactly its own median at the hook instant"
    );
}

/// **R2 — editorially clean, but its checked-in media paths are intentionally absent.**
///
/// It was not. `broken-continuity` fired eleven times on the reference we most admire, against
/// twice on the video the reference is the counter-example to, and that 5.5× inversion is the
/// blocker plan §0.1 exists to expose. The rule asked every seam for a shared element that
/// *moved*; R2's entire idiom is that assets arrive on the narrated word and then hold still
/// while the argument accumulates around them, so eleven of its thirteen seams carried nothing
/// that had moved and the two that passed were the two diegetic act breaks. The premise was
/// wrong: an element that is present in both beats and never left is stronger evidence of one
/// continuous composition than one that wiggled. The rule now asks its question only of seams
/// where the composition was **replaced** — a quarter of what was on screen, by rendered area,
/// is gone — and R2 replaces nothing at any of its thirteen seams.
///
/// `no-hook` also fired, and does not now. R2 opens on a proverb pull-quote carrying 2.83 % of
/// the canvas against a median frame of 15.32 %, which is 18 % of its own weight where the rule
/// wanted 60 % of the median — a video that *fills* over its runtime cannot have an opening as
/// dense as its median, so the denominator was the defect. The hook is measured against what the
/// frame reaches in its own first second instead, and R2's opening is already exactly that.
///
/// What is left is `no-bed`, which is true about it: the teardown records R2 as narration-
/// forward with no bed.
#[test]
fn r2_accumulate_reports_only_its_absent_media_gate() {
    let report = check(&fixture("r2-accumulate.json"));

    assert_eq!(
        gating(&report),
        BTreeMap::from([("missing-media", 33)]),
        "{:?}",
        report.findings
    );
    assert_eq!(
        rollup(&report),
        vec![("missing-media", 33), ("no-bed", 1), ("sparse-events", 1),]
    );
    assert_eq!(skipped(&report), vec!["speech-masked", "bed-too-quiet"]);
    assert_eq!(
        (report.errors, report.warnings, report.notes, report.total),
        (33, 2, 0, 35)
    );
    assert_eq!(report.status, Status::Findings);
    assert!(
        (report.stats.hook_ink - 0.0283).abs() < 5e-5
            && (report.stats.median_frame_ink - 0.1532).abs() < 5e-5,
        "the numbers `no-hook` used to fire on: hook {} median {}",
        report.stats.hook_ink,
        report.stats.median_frame_ink
    );

    // The shape the teardown measured: assets arrive on cues and nothing ever leaves before the
    // end of the timeline, on one ground that is there for all of it.
    let project = fixture("r2-accumulate.json");
    let scene = project.active_scene();
    let end = report.stats.duration_seconds;
    let arrivals = scene
        .authored_elements()
        .filter(|element| element.start().as_ticks() > 0)
        .count();
    assert!((14..=40).contains(&arrivals), "{arrivals} arrivals");
    assert!(
        scene
            .authored_elements()
            .all(|element| (element.end().to_seconds_f64() - end).abs() < 1e-6),
        "every authored element runs to the end of the timeline — nothing ever leaves"
    );
    assert_eq!(report.stats.ground.as_deref(), Some("ground"));
    assert_eq!(report.stats.beats.derivation, "cues");
    assert_eq!(report.stats.beats.starts.len(), 14);
}

/// **R2 is silent because nothing ever leaves it — not because nothing in it moves.**
///
/// The positive control on the repair, and it has to exist: "silent on the reference" is worth
/// nothing if the rule went silent everywhere. So take R2 and remove the one property it is
/// silent for. Every authored asset except the ground and the stick figure is cut to two
/// seconds, so each beat's cast is *replaced* by the next one instead of joined by it. Nothing
/// else changes — same elements, same ids, same animation, same cues.
///
/// Now the rule bites: eight of the thirteen seams are condemned. And **neither of the two act
/// breaks is among them** — the stick figure walks to the chalkboard on the cue at 9.2 s and
/// back across it on the cue at 30.8 s, which are the two moments R2 moves something across a
/// state change, exactly as the teardown says. The three other survivors are seams where the
/// two-second cut still left most of the previous beat on screen.
///
/// So the eleven findings the unrepaired rule reported are still reachable — it now takes
/// destroying the composition to reach them, which is the whole repair.
#[test]
fn r2_is_silent_because_nothing_leaves_it_not_because_nothing_moves() {
    let mut project = fixture("r2-accumulate.json");
    {
        let scene = project.active_scene_mut();
        for track in std::iter::once(&mut scene.tracks.main).chain(scene.tracks.overlay.iter_mut())
        {
            track.elements.retain(|element| element.id() != "ground");
            for element in &mut track.elements {
                if element.id() == "figure-narrator" || !element.is_authored() {
                    continue;
                }
                element.set_duration(
                    bay_project::MediaTime::from_seconds_f64(2.0).expect("a representable time"),
                );
            }
        }
    }

    let report = check(&project);
    assert_eq!(
        report.stats.beats.starts.len(),
        14,
        "{:?}",
        report.stats.beats
    );
    let seams: Vec<f64> = report
        .findings
        .iter()
        .filter(|found| found.code == "broken-continuity")
        .filter_map(|found| found.at_seconds)
        .collect();
    assert_eq!(count(&report, "broken-continuity"), 8);
    for carried in [9.2, 30.8] {
        assert!(
            !seams.iter().any(|at| (at - carried).abs() < 1e-6),
            "the seam at {carried}s is staged by the stick figure walking and must not fire: \
             {seams:?}"
        );
    }
}

/// **R1 and R2 are the same idiom, and they are now silent for the same reason.**
///
/// They were not. R1's clean `broken-continuity` column was two exemptions rather than a pass.
/// The first is the beat derivation: R1 has no narration and no markers, so it falls back to
/// eight-second windows and the rule declines to run — that one is deliberate and still stands,
/// because a seam a clock invented is not a seam. Give it the three markers `one-scene` asks for
/// and the derivation becomes `cues`, and the rule used to still find nothing because of the
/// second exemption: `carried` returned true for any `Element::Video`, on the grounds that its
/// frames advance where the project model cannot see them. R1's centre is a screen recording.
///
/// The second half of this test is why that mattered. Swapping the same clip for a still —
/// changing nothing else about the composition, not one number — condemned the identical locked
/// frame at every seam. The rule was not measuring whether a composition holds together; it was
/// measuring whether the thing holding it together happened to be a video element.
///
/// The `Element::Video` exemption is gone, and both halves are silent, because R1 never removes
/// anything from its frame — which is the same sentence as the one that makes R2 silent.
#[test]
fn r1_and_r2_are_silent_on_broken_continuity_for_the_same_reason() {
    let mut project = fixture("r1-locked.json");
    assert_eq!(check(&project).stats.beats.derivation, "fixed");
    assert!(skipped(&check(&project)).contains(&"broken-continuity"));

    let scene = project.active_scene_mut();
    for (index, at) in [10.0, 20.0, 30.0].into_iter().enumerate() {
        scene.markers.push(bay_project::Marker {
            id: format!("m{index}"),
            time: bay_project::MediaTime::from_seconds_f64(at).expect("a representable time"),
            label: String::new(),
        });
    }

    let report = check(&project);
    assert_eq!(report.stats.beats.derivation, "cues");
    assert!(!skipped(&report).contains(&"broken-continuity"));
    assert_eq!(
        count(&report, "broken-continuity"),
        0,
        "nothing leaves R1's frame, so no seam of it replaces anything: {:?}",
        report.findings
    );

    // Now the same composition with a still where the clip was. Same id, same box, same 39.3s.
    let demo = &mut project.active_scene_mut().tracks.main.elements[0];
    let (id, name, start, duration) = (
        demo.id().to_string(),
        demo.name().to_string(),
        demo.start(),
        demo.duration(),
    );
    let (media_id, transform) = (
        demo.media_id()
            .expect("the demo clip has media")
            .to_string(),
        demo.transform().expect("the demo clip has a transform"),
    );
    *demo = bay_project::Element::Image(bay_project::ImageElement {
        id,
        name,
        start,
        duration,
        fade_in: bay_project::MediaTime::ZERO,
        fade_out: bay_project::MediaTime::ZERO,
        media_id,
        transform,
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        source: bay_project::ElementSource::Author,
        role: bay_project::ElementRole::Label,
    });

    let report = check(&project);
    assert_eq!(
        count(&report, "broken-continuity"),
        0,
        "a locked frame is a locked frame whatever kind of element holds it: {:?}",
        report.findings
    );
}

// ------------------------------------------------------------------- the three condemned videos

/// wicks-v2: the errors this round is about.
///
/// All four gating codes here fire on this project and on neither reference, which is the
/// separation plan §1.4 commitment 4 asks of a code before it may block an encode. Three of the
/// four already did. `broken-continuity` did not — twice here against eleven times on R2 — and
/// it now fires four times here, more than on either predecessor and not at all on either
/// reference; see [`broken_continuity_fires_on_the_video_it_condemns_and_on_neither_reference`].
///
/// `empty-container` went from one finding to two when the opacity gate came off it: `sq` covers
/// 8.9 % of the canvas and holds one mark for six and a half seconds, and it used to be exempt
/// for being drawn at under half opacity — which is not a reason a card is not empty.
#[test]
fn wicks_v2_fires_the_five_errors_this_round_is_about() {
    let report = check(&fixture("wicks-v2.json"));

    assert_eq!(
        gating(&report),
        BTreeMap::from([
            ("broken-continuity", 4),
            ("dead-plate", 1),
            ("empty-container", 2),
            ("missing-media", 69),
            ("value-overshoot", 1),
        ]),
        "{:?}",
        report.findings
    );
    assert_eq!(
        rollup(&report),
        vec![
            ("broken-continuity", 4),
            ("dead-plate", 1),
            ("empty-container", 2),
            ("flat-mix", 6),
            ("missing-media", 69),
            ("no-hook", 1),
            ("no-response", 1),
            ("off-grid", 1),
            ("off-vocabulary-motion", 125),
            ("small-text", 2),
            ("sparse-events", 1),
            ("value-overshoot", 1),
        ]
    );
    // The mix codes cannot evaluate: no asset in this project has ever been probed, so the two
    // levels a mix is specified in do not exist in the file. The `1†` in the codes table for
    // `speech-masked` came from measuring the WAVs on disk, not from the project.
    assert_eq!(skipped(&report), vec!["speech-masked", "bed-too-quiet"]);
    assert_eq!(
        (report.errors, report.warnings, report.notes, report.total),
        (77, 137, 0, 214)
    );
}

/// The first predecessor. Its only errors are `broken-continuity`, three of them — one fewer
/// than wicks-v2 fires, and none on either reference.
#[test]
fn candlestick_wick_volatility_is_the_first_predecessor() {
    let report = check(&fixture("candlestick-wick-volatility.json"));

    assert_eq!(
        gating(&report),
        BTreeMap::from([("broken-continuity", 3), ("missing-media", 8)]),
        "{:?}",
        report.findings
    );
    assert_eq!(
        rollup(&report),
        vec![
            ("broken-continuity", 3),
            ("missing-media", 8),
            ("no-bed", 1),
            ("no-hook", 1),
            ("off-grid", 1),
            ("off-vocabulary-motion", 139),
            ("unreadable-dwell", 1),
        ]
    );
    assert_eq!(
        skipped(&report),
        vec!["past-source-end", "speech-masked", "bed-too-quiet"]
    );
    assert_eq!(
        (report.errors, report.warnings, report.notes, report.total),
        (11, 143, 0, 154)
    );
}

/// The second predecessor. Twelve errors — eight of them a structural `missing-media` — so on
/// raw error count the gating layer still ranks this one worse than wicks-v2, on a defect that
/// has nothing to do with why anybody disliked either video. That is `missing-media`'s doing and
/// not `broken-continuity`'s: the two are level there, four each.
#[test]
fn candlestick_wicks_is_the_second_predecessor() {
    let report = check(&fixture("candlestick-wicks.json"));

    assert_eq!(
        gating(&report),
        BTreeMap::from([("broken-continuity", 4), ("missing-media", 16)]),
        "{:?}",
        report.findings
    );
    assert_eq!(
        rollup(&report),
        vec![
            ("broken-continuity", 4),
            ("flat-mix", 10),
            ("missing-media", 16),
            ("no-hook", 1),
            ("no-response", 1),
            ("off-grid", 1),
            ("off-vocabulary-motion", 93),
            ("overlap", 3),
            ("small-text", 9),
        ]
    );
    assert_eq!(
        skipped(&report),
        vec!["past-source-end", "speech-masked", "bed-too-quiet"]
    );
    assert_eq!(
        (report.errors, report.warnings, report.notes, report.total),
        (20, 118, 0, 138)
    );
}

// -------------------------------------------------------------- what the five fixtures conclude

/// **Plan §1.4 commitment 4, evaluated for the four craft gates.**
///
/// A craft gate ships only if it fires on wicks-v2, is silent on R1, is silent on R2, and does
/// not rank wicks-v2 above its own predecessors. `missing-media` is the separate availability
/// invariant and correctly fires because none of these fixtures includes its media files. This
/// is the craft claim as arithmetic for the one code that used to invert it. The measured state
/// before the repair is worth keeping in view,
/// because it is what these fixtures were built to expose: `broken-continuity` fired **11** times
/// on the reference we most admire and **2** on the video the reference is the counter-example
/// to — a 5.5× inversion of the thing the code is for.
///
/// It now fires 4 on wicks-v2, 0 on both references, and 3 and 4 on the two predecessors, so
/// wicks-v2 is not ranked better than either of them on this code.
#[test]
fn broken_continuity_fires_on_the_video_it_condemns_and_on_neither_reference() {
    let on = |name: &str| count(&check(&fixture(name)), "broken-continuity");

    let (r2, wicks) = (on("r2-accumulate.json"), on("wicks-v2.json"));
    assert_eq!((r2, wicks), (0, 4));
    assert_eq!(on("r1-locked.json"), 0);
    let (first, second) = (
        on("candlestick-wick-volatility.json"),
        on("candlestick-wicks.json"),
    );
    assert_eq!((first, second), (3, 4));
    assert!(
        wicks >= first && wicks >= second,
        "the fourth number: {wicks} on wicks-v2 against {first} and {second} on its predecessors"
    );
}

/// The four codes that meet commitment 4 on all four numbers.
#[test]
fn four_gating_codes_fire_on_wicks_v2_and_on_neither_reference() {
    let reports: Vec<Report> = [
        "r1-locked.json",
        "r2-accumulate.json",
        "candlestick-wick-volatility.json",
        "candlestick-wicks.json",
    ]
    .into_iter()
    .map(|name| check(&fixture(name)))
    .collect();
    let wicks = check(&fixture("wicks-v2.json"));

    for code in [
        "dead-plate",
        "empty-container",
        "value-overshoot",
        "broken-continuity",
    ] {
        assert!(count(&wicks, code) > 0, "{code} must fire on wicks-v2");
        for (name, report) in ["R1", "R2", "p-1", "p-2"].into_iter().zip(&reports) {
            // `broken-continuity` is allowed on the two condemned predecessors — what it may not
            // do is fire on a reference, or fire on wicks-v2 less than on one of them.
            if code == "broken-continuity" && matches!(name, "p-1" | "p-2") {
                assert!(
                    count(report, code) <= count(&wicks, code),
                    "{code} on {name}"
                );
                continue;
            }
            assert_eq!(count(report, code), 0, "{code} fired on {name}");
        }
    }
}

/// **Nine gating codes are absent from all five pure-model fixture reports.**
///
/// Eight are structural and their silence is the correct answer — none of these five projects
/// has a zero-length element or a NaN transform. `text-collision` is compositor-backed and is
/// exercised by positive/negative controls in `bay-preview::frame_check`, so it cannot appear in
/// this pure `bay-core::check` fixture pass.
///
/// This list is about which layer owns the measurement, not an assertion that `text-collision`
/// is unmeasured.
#[test]
fn nine_gating_codes_are_absent_from_the_pure_fixture_reports() {
    let reports: Vec<Report> = [
        "r1-locked.json",
        "r2-accumulate.json",
        "wicks-v2.json",
        "candlestick-wick-volatility.json",
        "candlestick-wicks.json",
    ]
    .into_iter()
    .map(|name| check(&fixture(name)))
    .collect();

    let never: Vec<&str> = gating_codes()
        .into_iter()
        .filter(|code| reports.iter().all(|report| count(report, code) == 0))
        .collect();
    assert_eq!(
        never,
        vec![
            "zero-length",
            "before-zero",
            "past-source-end",
            "missing-effect-asset",
            "transform-not-finite",
            "off-canvas",
            "nothing-visual",
            "empty-text",
            "text-collision",
        ]
    );

    // ...and `speech-masked` is not merely quiet, it is unevaluated on all five.
    assert!(
        reports
            .iter()
            .all(|report| skipped(report).contains(&"speech-masked")),
        "speech-masked has never been evaluated against a real project"
    );
}

/// No fixture may name a file by absolute path.
///
/// Every media path in these five projects used to be absolute, and most of them pointed into a
/// scratch directory belonging to whichever session authored the fixture — `/var/folders/…/T/`
/// and `/private/tmp/claude-501/…/scratchpad/`. Two of those files still existed on the machine
/// the counts were recorded on, so `missing-media` was pinned at 67 and 6 rather than the 69 and
/// 8 the projects actually describe. When the temp sweep took them the three fixture tests began
/// failing, on a tree with nothing wrong with it — and they would have failed on every other
/// machine from the day they were written, because nobody else ever had those files.
///
/// Relative paths are resolved against the project's own directory by
/// `bay_project::library::read_project`, so a fixture that stays relative can only ever resolve
/// inside the repository, and a fixture whose media is deliberately absent is absent everywhere.
/// That is what the recorded counts now mean.
#[test]
fn no_fixture_reaches_outside_the_repository_for_its_media() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut offenders = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("read the fixtures directory") {
        let path = entry.expect("a fixture directory entry").path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let project = bay_project::library::read_project(&path).expect("read the fixture");
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        for asset in &project.media {
            // `read_project` has already joined relative paths onto the fixture directory, so
            // the check is "did it end up inside the repository", not "was it written relative".
            if !std::path::Path::new(&asset.path).starts_with(&dir) {
                offenders.push(format!("{name}: {} -> {}", asset.id, asset.path));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "fixture media must live under tests/fixtures so the counts mean the same thing on \
         every machine:\n  {}",
        offenders.join("\n  ")
    );
}

/// A format downgrades the checks it does not apply to, and drops none of them.
///
/// The multicam case forced this. A hard cut between locked-off camera angles shares no
/// element, so `broken-continuity` fires on every cut, and the only way to export was
/// `ignoreChecks` — which silences *every* code, including the ones nobody meant to relax, on
/// every render. Declaring what the project is relaxes exactly the codes that do not describe
/// it, and the finding still has to appear: a report that quietly loses a check is one nobody
/// can audit.
#[test]
fn a_format_downgrades_what_it_suspends_and_hides_nothing() {
    let project = fixture("wicks-v2.json");
    let general = check(&project);
    let gated = count(&general, "broken-continuity");
    assert!(
        gated > 0,
        "the fixture fires the code: {:?}",
        rollup(&general)
    );

    let mut multicam = project.clone();
    multicam.settings.format = Some("multicam-conversation".into());
    let report = check(&multicam);

    assert_eq!(
        count(&report, "broken-continuity"),
        gated,
        "still reported, only downgraded"
    );
    assert!(
        report
            .findings
            .iter()
            .any(|finding| finding.code == "broken-continuity"
                && finding.severity == Severity::Note
                && finding.message.contains("not gating")
                && finding.message.contains("locked-off")),
        "the note carries the format's reason: {:?}",
        report
            .findings
            .iter()
            .filter(|finding| finding.code == "broken-continuity")
            .map(|finding| (finding.severity, finding.message.clone()))
            .collect::<Vec<_>>()
    );
    assert!(
        report.errors < general.errors,
        "a suspended code stops blocking: {} vs {}",
        report.errors,
        general.errors
    );

    // A code the format did not name is untouched — this fixture is full of missing media.
    assert!(
        report
            .findings
            .iter()
            .any(|finding| finding.code == "missing-media" && finding.severity == Severity::Error),
        "missing-media is not suspended and must still gate"
    );

    // And the genre the checks were written for relaxes nothing.
    let mut film = project.clone();
    film.settings.format = Some("product-film".into());
    assert_eq!(check(&film).errors, general.errors);
}
