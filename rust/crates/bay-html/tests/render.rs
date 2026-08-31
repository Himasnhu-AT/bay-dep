//! End-to-end renders through the real WebKit path.
//!
//! The unit tests in `lib.rs` cover the spec, the geometry and the seek script without a web
//! engine. None of them can tell whether WebKit is actually reachable, which is the thing most
//! likely to break — so these drive the shipped binary and look at the pixels that come back.
//!
//! They **skip** when there is no `bay` binary to spawn, as a `cargo test` on a fresh checkout
//! has not built one yet. `BAY_REQUIRE_HTML=1` turns that skip into a failure, which is how a
//! capability check is verified rather than assumed.

use bay_html::{Shot, Source};

/// Find the `bay` binary this checkout has built, if any.
///
/// The test binary lives at `target/<profile>/deps/`, so the sibling two levels up is the
/// binary built from the same profile — which is the one whose `--html-shot` matches the
/// library under test.
fn shot_binary() -> Option<std::path::PathBuf> {
    let mut dir = std::env::current_exe().ok()?;
    // .../target/<profile>/deps/<test> → .../target/<profile>
    dir.pop();
    dir.pop();
    for profile in [
        dir.clone(),
        dir.with_file_name("debug"),
        dir.with_file_name("release"),
    ] {
        let candidate = profile.join("bay");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// The newest modification time under this crate's `src/`.
fn newest_source_change() -> Option<std::time::SystemTime> {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut newest = None;
    for entry in std::fs::read_dir(src).ok()? {
        let modified = entry.ok()?.metadata().ok()?.modified().ok()?;
        newest = Some(newest.map_or(modified, |n: std::time::SystemTime| n.max(modified)));
    }
    newest
}

/// Is the binary at least as new as the code under test?
///
/// `cargo test -p bay-html` does **not** rebuild the `bay` binary, and the renderer lives inside
/// that binary. Without this check, editing `webview.rs` and re-running tests the *previous*
/// build — which reads as a pass and is the most expensive kind of wrong answer this suite can
/// give. It already produced one false failure while these tests were being written; the same
/// staleness in the other direction is a false pass.
///
/// A stale binary **skips**, loudly, rather than failing: `test.sh` does not build binaries, so
/// a hard failure here would break the gate on a clean tree every time `cargo fmt` touched a
/// source file. `BAY_REQUIRE_HTML=1` turns the skip into a failure, which is the same shape as
/// `BAY_REQUIRE_GPU` and `BAY_REQUIRE_FFMPEG` — a capability check that may skip by default must
/// be able to stop skipping on demand.
fn binary_is_current(binary: &std::path::Path) -> bool {
    let (Some(built), Some(edited)) = (
        binary.metadata().ok().and_then(|m| m.modified().ok()),
        newest_source_change(),
    ) else {
        return true;
    };
    if built >= edited {
        return true;
    }
    assert!(
        !bay_html::required(),
        "{} is older than this crate's sources — it would test the previous build.\n\
         Rebuild first: cargo build --bin bay",
        binary.display()
    );
    eprintln!(
        "skipping: {} is older than this crate's sources and would test the previous build.\n\
         Rebuild with `cargo build --bin bay`, or set BAY_REQUIRE_HTML=1 to fail instead.",
        binary.display()
    );
    false
}

/// Set up the override, or say why the test cannot run.
fn ready() -> Option<()> {
    match shot_binary() {
        Some(path) => {
            if !binary_is_current(&path) {
                return None;
            }
            // Safety: these tests run in-process and set this before any render. Cargo runs
            // tests in threads, so every test in this file sets the same value to the same
            // path, which is why this is idempotent rather than scoped.
            unsafe { std::env::set_var(bay_html::SHOT_BIN_ENV, &path) };
            Some(())
        }
        None => {
            assert!(
                !bay_html::required(),
                "{} is set but no `bay` binary has been built to render with — run \
                 `cargo build --bin bay` first",
                bay_html::REQUIRE_ENV
            );
            eprintln!(
                "skipping: no `bay` binary built yet (set BAY_REQUIRE_HTML=1 to fail instead)"
            );
            None
        }
    }
}

const CARD: &str = r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{background:transparent;margin:0;}
.c{position:absolute;left:0;top:0;width:200px;height:100px;background:#C8FF3D;}
</style></head><body><div class="c"></div></body></html>"#;

const BLANK: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<style>html,body{background:transparent;margin:0;}</style></head><body></body></html>"#;

/// The size on DISK, not the size that was asked for.
///
/// This is the test the suite was missing. `Rendered` used to echo the requested dimensions
/// back, so it could not be wrong; meanwhile WebKit was snapshotting at the display's 2x
/// backing scale and writing a 2160x3840 file for a 1080x1920 request. Every existing
/// assertion passed — `ink` is a fraction and blind to scale — and the error only surfaced
/// when a card was composited over footage and landed as the top-left quarter of itself.
#[test]
fn the_png_on_disk_is_the_size_that_was_asked_for() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();

    for (w, h, scale) in [(400u32, 400u32, 1.0f32), (1080, 1920, 1.0), (300, 200, 2.0)] {
        let out = dir.path().join(format!("{w}x{h}@{scale}.png"));
        let mut shot = Shot::new(Source::Html(CARD.to_string()), w, h);
        shot.scale = scale;
        let rendered = shot.render_to(&out).expect("should render");

        let want = shot.output_size();
        let decoded = image::image_dimensions(&out).expect("the PNG should be readable");
        assert_eq!(
            decoded, want,
            "asked for {want:?} and the file on disk is {decoded:?}"
        );
        assert_eq!(
            (rendered.width, rendered.height),
            want,
            "the report must match the file, not the request"
        );
    }
}

#[test]
fn a_card_renders_with_a_real_alpha_channel() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("card.png");

    let shot = Shot::new(Source::Html(CARD.to_string()), 400, 400);
    let rendered = shot.render_to(&out).expect("the card should render");

    assert_eq!((rendered.width, rendered.height), (400, 400));
    assert!(out.is_file(), "no PNG was written");
    // A 200×100 block on a 400×400 canvas is an eighth of the frame. If the page background
    // were opaque this would be 1.0 — which is the regression this number is here to catch.
    let expected = (200.0 * 100.0) / (400.0 * 400.0);
    assert!(
        (rendered.ink - expected).abs() < 0.02,
        "expected about {expected} ink, got {}",
        rendered.ink
    );
}

/// The check that a composition drew nothing. Without it a broken card ships as a valid,
/// correctly-sized, entirely invisible PNG.
#[test]
fn an_empty_composition_reports_no_ink() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("blank.png");

    let rendered = Shot::new(Source::Html(BLANK.to_string()), 200, 200)
        .render_to(&out)
        .expect("an empty page still renders");
    assert!(rendered.is_blank(), "ink was {}", rendered.ink);
}

/// `scale` must enlarge the raster without re-laying-out the type — the reason an overlay
/// authored at 540×960 can be delivered at 1080×1920 without being upscaled after the fact.
#[test]
fn scale_enlarges_the_raster_and_keeps_the_layout() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("scaled.png");

    let mut shot = Shot::new(Source::Html(CARD.to_string()), 400, 400);
    shot.scale = 2.0;
    let rendered = shot.render_to(&out).expect("the scaled card should render");

    assert_eq!((rendered.width, rendered.height), (800, 800));
    // Same fraction of the frame as at 1×: the block still covers an eighth. A layout that had
    // been re-flowed at the larger size would cover a different share.
    let expected = (200.0 * 100.0) / (400.0 * 400.0);
    assert!(
        (rendered.ink - expected).abs() < 0.02,
        "expected about {expected} ink, got {}",
        rendered.ink
    );
}

/// A composition directory's own assets must resolve, which is what `loadFileURL` read access
/// is granted for — a card whose stylesheet failed to load renders, and renders wrong.
#[test]
fn a_file_composition_can_reach_its_own_stylesheet() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("card.css"),
        ".c{width:200px;height:100px;background:#C8FF3D;}",
    )
    .unwrap();
    let html = dir.path().join("index.html");
    std::fs::write(
        &html,
        r#"<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="card.css">
<style>html,body{background:transparent;margin:0;}</style></head>
<body><div class="c"></div></body></html>"#,
    )
    .unwrap();

    let out = dir.path().join("out.png");
    let rendered = Shot::new(Source::File(html), 400, 400)
        .render_to(&out)
        .expect("the composition should render");
    let expected = (200.0 * 100.0) / (400.0 * 400.0);
    assert!(
        (rendered.ink - expected).abs() < 0.02,
        "the external stylesheet did not apply — ink {}",
        rendered.ink
    );
}

/// Seeking a declared timeline must change the picture. This is what makes one HTML file yield
/// every frame of an animation instead of only its first.
#[test]
fn seeking_a_timeline_changes_the_frame() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();

    // A hand-rolled stand-in for a GSAP timeline: pause() and time() are the whole contract.
    let html = r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{background:transparent;margin:0;}
#b{position:absolute;left:0;top:0;height:100px;background:#C8FF3D;width:0px;}
</style></head><body><div id="b"></div><script>
window.__timelines = { grow: {
  pause: function () {},
  time: function (t) { document.getElementById('b').style.width = (t * 100) + 'px'; }
} };
</script></body></html>"#;

    let render_at = |t: f64, name: &str| {
        let mut shot = Shot::new(Source::Html(html.to_string()), 400, 400);
        shot.at_seconds = t;
        shot.timeline_id = Some("grow".to_string());
        shot.render_to(&dir.path().join(name))
            .unwrap_or_else(|e| panic!("render at {t}s failed: {e}"))
    };

    let early = render_at(1.0, "early.png");
    let late = render_at(3.0, "late.png");
    assert!(
        late.ink > early.ink * 2.0,
        "seeking did not change the frame: {} then {}",
        early.ink,
        late.ink
    );
}

/// Naming a timeline that does not exist is a caller error and must say so. Silently returning
/// frame zero would ship a whole animation's worth of identical stills.
#[test]
fn naming_a_missing_timeline_is_an_error() {
    let Some(()) = ready() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut shot = Shot::new(Source::Html(CARD.to_string()), 100, 100);
    shot.timeline_id = Some("nope".to_string());
    let error = shot
        .render_to(&dir.path().join("x.png"))
        .expect_err("a missing timeline should not pass silently");
    assert!(error.to_string().contains("nope"), "{error}");
}
