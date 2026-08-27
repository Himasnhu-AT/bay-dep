//! The waveform cache must never extract on the thread that asks for a waveform.
//!
//! `EditorView::render` calls `request_scene` once a frame. Before this cache existed the same
//! call site ran `bay_audio::waveform_peaks` inline — an ffmpeg process decoding the whole file
//! — which froze the frame for as long as the file took. These tests pin the request path as
//! queue-and-poll: they use an injected extractor, so they run with no ffmpeg on the machine and
//! nothing here can skip.

use bay_preview::waveform::WaveformCache;
use bay_project::{AudioElement, Element, MediaAsset, MediaTime, Project, Scene, Track, TrackKind};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

/// A scene with one audio clip on an audio lane, and the media list that resolves it.
fn one_audio_clip(media_id: &str) -> (Scene, Vec<MediaAsset>) {
    let mut project = Project::starter();
    let scene = project.active_scene_mut();
    let mut track = Track::new("t-audio", "Audio", TrackKind::Audio);
    track.elements = vec![Element::Audio(AudioElement {
        id: "clip".into(),
        name: "clip".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: media_id.into(),
        trim_start: MediaTime::ZERO,
        muted: false,
        volume: 1.0,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        animations: Default::default(),
        source: Default::default(),
        role: Default::default(),
    })];
    scene.tracks.audio = vec![track];
    let media = vec![MediaAsset::new(
        media_id,
        "clip.wav",
        "/nonexistent/clip.wav",
    )];
    (project.active_scene().clone(), media)
}

/// Poll `request_scene` until the entry leaves the pending state, or give up.
fn settle(cache: &mut WaveformCache, scene: &Scene, media: &[MediaAsset], buckets: usize) {
    let deadline = Instant::now() + Duration::from_secs(5);
    cache.request_scene(scene, media, buckets);
    while cache.has_pending() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
        cache.request_scene(scene, media, buckets);
    }
}

/// The one that matters: a request returns while extraction is still running, and the extraction
/// happens on a different thread than the caller's.
///
/// The extractor parks until this test releases it. If `request_scene` ran extraction inline the
/// call would take the extractor's full park before returning, and the elapsed assertion fails —
/// which is exactly the frozen frame the old `ensure_waveforms` produced, just with a stopwatch
/// on it. The park is bounded so a regression fails rather than hanging the suite.
#[test]
fn a_request_returns_before_extraction_finishes_and_runs_off_the_calling_thread() {
    /// How long the extractor parks. Long enough that running it inline is unmistakable in the
    /// elapsed time, short enough that a regressed build still finishes the test.
    const PARK: Duration = Duration::from_secs(2);

    let (scene, media) = one_audio_clip("m-blocking");
    let (release, parked) = std::sync::mpsc::channel::<()>();
    let parked = Arc::new(std::sync::Mutex::new(parked));
    let worker_thread = Arc::new(std::sync::Mutex::new(None));

    let seen = Arc::clone(&worker_thread);
    let mut cache = WaveformCache::with_extractor(Arc::new(move |_path: &str, buckets: usize| {
        *seen.lock().unwrap() = Some(std::thread::current().id());
        // Hold the worker here until the assertions below release it.
        let _ = parked.lock().unwrap().recv_timeout(PARK);
        Some(vec![0.5; buckets])
    }));

    let caller = std::thread::current().id();
    let started = Instant::now();
    cache.request_scene(&scene, &media, 48);
    let elapsed = started.elapsed();

    assert!(
        elapsed < PARK / 4,
        "request_scene must return without waiting for extraction, took {elapsed:?}"
    );
    assert!(
        cache.has_pending(),
        "the clip's waveform is still being extracted, so the cache must report it pending"
    );
    assert!(
        cache.peaks("m-blocking", 48).is_none(),
        "a pending waveform must read as absent — render draws the clip bare, it does not wait"
    );

    // Release the worker and collect the result on a later poll, the way a later frame would.
    let _ = release.send(());
    settle(&mut cache, &scene, &media, 48);

    assert_eq!(
        cache.peaks("m-blocking", 48).map(<[f32]>::len),
        Some(48),
        "once the worker finishes, a later request collects its peaks"
    );
    assert!(!cache.has_pending());
    assert_ne!(
        *worker_thread.lock().unwrap(),
        Some(caller),
        "extraction ran on the caller's thread — that is the frozen-frame bug this replaces"
    );
}

/// Sixty frames a second of `request_scene` must not be sixty extractions a second.
#[test]
fn a_ready_waveform_is_never_re_extracted() {
    let (scene, media) = one_audio_clip("m-once");
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let mut cache = WaveformCache::with_extractor(Arc::new(move |_p: &str, buckets: usize| {
        counted.fetch_add(1, Ordering::SeqCst);
        Some(vec![0.25; buckets])
    }));

    settle(&mut cache, &scene, &media, 48);
    assert!(cache.peaks("m-once", 48).is_some());
    for _ in 0..60 {
        cache.request_scene(&scene, &media, 48);
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "extracted once, then cached"
    );
}

/// A file that cannot produce peaks (no ffmpeg, unreadable media) must be remembered as failed.
/// Retrying it every frame would spawn a process per frame for as long as the clip is on screen.
#[test]
fn a_failed_extraction_is_not_retried() {
    let (scene, media) = one_audio_clip("m-bad");
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let mut cache = WaveformCache::with_extractor(Arc::new(move |_p: &str, _b: usize| {
        counted.fetch_add(1, Ordering::SeqCst);
        None
    }));

    settle(&mut cache, &scene, &media, 48);
    for _ in 0..60 {
        cache.request_scene(&scene, &media, 48);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(
        cache.peaks("m-bad", 48).is_none(),
        "a failed extraction reads as absent, not as an empty waveform"
    );
    assert!(!cache.has_pending());
}

/// Media whose id is not in the project's media list resolves to no path. That is a permanent
/// failure, not a wait, and it must not spawn a worker at all.
#[test]
fn unresolvable_media_never_starts_a_worker() {
    let (scene, _) = one_audio_clip("m-missing");
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let mut cache = WaveformCache::with_extractor(Arc::new(move |_p: &str, b: usize| {
        counted.fetch_add(1, Ordering::SeqCst);
        Some(vec![1.0; b])
    }));

    cache.request_scene(&scene, &[], 48);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(!cache.has_pending());
    assert!(cache.peaks("m-missing", 48).is_none());
}

/// The bucket count is half the key: 48 peaks are not a usable answer for a lane asking for 480.
#[test]
fn entries_are_keyed_by_bucket_count() {
    let (scene, media) = one_audio_clip("m-buckets");
    let mut cache =
        WaveformCache::with_extractor(Arc::new(|_p: &str, b: usize| Some(vec![0.5; b])));

    settle(&mut cache, &scene, &media, 48);
    assert_eq!(cache.peaks("m-buckets", 48).map(<[f32]>::len), Some(48));
    assert!(
        cache.peaks("m-buckets", 480).is_none(),
        "a coarser waveform must not answer for a finer request"
    );

    settle(&mut cache, &scene, &media, 480);
    assert_eq!(cache.peaks("m-buckets", 480).map(<[f32]>::len), Some(480));
    assert_eq!(cache.len(), 2);
}

/// Zero buckets is a degenerate request (a lane with no height). It must be a no-op, not a
/// worker spawned to divide by zero.
#[test]
fn zero_buckets_is_a_no_op() {
    let (scene, media) = one_audio_clip("m-zero");
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let mut cache = WaveformCache::with_extractor(Arc::new(move |_p: &str, b: usize| {
        counted.fetch_add(1, Ordering::SeqCst);
        Some(vec![0.5; b])
    }));

    cache.request_scene(&scene, &media, 0);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(cache.is_empty());
}

/// Switching project drops every entry — media ids are per project, so a stale hit would draw
/// the previous project's sound under this project's clip.
#[test]
fn clear_drops_every_entry() {
    let (scene, media) = one_audio_clip("m-clear");
    let mut cache =
        WaveformCache::with_extractor(Arc::new(|_p: &str, b: usize| Some(vec![0.5; b])));

    settle(&mut cache, &scene, &media, 48);
    assert_eq!(cache.len(), 1);
    cache.clear();
    assert!(cache.is_empty());
    assert!(cache.peaks("m-clear", 48).is_none());
}

/// The blocking form exists for headless callers, which have no later frame to collect on. It
/// reports which media could not produce peaks rather than silently returning nothing.
#[test]
fn await_scene_blocks_and_names_what_failed() {
    let (scene, media) = one_audio_clip("m-await");
    let mut cache = WaveformCache::with_extractor(Arc::new(|_p: &str, b: usize| {
        std::thread::sleep(Duration::from_millis(30));
        Some(vec![0.75; b])
    }));
    assert!(cache.await_scene(&scene, &media, 48).is_empty());
    assert_eq!(cache.peaks("m-await", 48).map(<[f32]>::len), Some(48));

    let mut failing = WaveformCache::with_extractor(Arc::new(|_p: &str, _b: usize| None));
    assert_eq!(
        failing.await_scene(&scene, &media, 48),
        vec!["m-await".to_string()]
    );
}
