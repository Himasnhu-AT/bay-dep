//! The export mixer's half of the bargain.
//!
//! bay's rule for a new audio capability is that it has to be expressible **both** as Rust DSP
//! in `bay-audio` and as a filter string in the export filtergraph, or it will be audible in
//! only one of the two — heard in the room and missing from the file, or the reverse, and
//! nobody finds out until the export is posted. `bay-audio/tests/stream.rs` holds the DSP side
//! of pan, track gain and solo; this holds the filtergraph side, and both read the same law out
//! of `bay_audio::composed_pan_gains`.
//!
//! Everything here is a pure string or a pure clip list. **No ffmpeg is spawned**, so nothing
//! in this file can be skipped for a missing binary and quietly report as a pass.

use bay_project::{AudioElement, Element, MediaAsset, MediaTime, Project, Track, TrackKind};

fn secs(n: f64) -> MediaTime {
    MediaTime::from_seconds_f64(n).expect("representable")
}

fn audio(id: &str, media: &str, pan: f32) -> Element {
    Element::Audio(AudioElement {
        id: id.into(),
        name: id.into(),
        start: MediaTime::ZERO,
        duration: secs(4.0),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: media.into(),
        muted: false,
        volume: 1.0,
        pan,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        animations: Default::default(),
        trim_start: MediaTime::ZERO,
        source: Default::default(),
        role: Default::default(),
    })
}

/// A project with a music lane and a voice lane, one clip each.
fn two_lane_project() -> (Project, Vec<MediaAsset>) {
    let mut project = Project::starter();
    {
        let scene = project.active_scene_mut();
        let mut music = Track::new("track-music", "Music", TrackKind::Audio);
        music.elements = vec![audio("music", "m-music", 0.0)];
        let mut voice = Track::new("track-voice", "Voice", TrackKind::Audio);
        voice.elements = vec![audio("voice", "m-voice", 0.0)];
        scene.tracks.audio = vec![music, voice];
    }
    let media = vec![
        MediaAsset::new("m-music", "music.mp3", "/tmp/music.mp3"),
        MediaAsset::new("m-voice", "voice.wav", "/tmp/voice.wav"),
    ];
    (project, media)
}

fn clip_named<'a>(
    clips: &'a [bay_preview::AudibleClip],
    path: &str,
) -> &'a bay_preview::AudibleClip {
    clips
        .iter()
        .find(|clip| clip.path == path)
        .unwrap_or_else(|| panic!("no clip for {path} in {clips:#?}"))
}

// ---------------------------------------------------------------------------------------
// Pan reaches the file

/// **A panned clip emits `pan=` into the filtergraph.** The one assertion that stops pan from
/// being a control that moves in the room and does nothing to the export.
#[test]
fn a_panned_clip_emits_a_pan_filter() {
    let (mut project, media) = two_lane_project();
    if let Some(Element::Audio(music)) = project.active_scene_mut().tracks.audio[0]
        .elements
        .first_mut()
    {
        music.pan = 0.5;
    }

    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    let music = clip_named(&clips, "/tmp/music.mp3");
    assert_eq!(music.pan, 0.5, "the model's pan reached the export mixer");

    let filter = bay_preview::pan_filter_for_test(music);
    assert!(
        filter.contains("pan=stereo|c0=0.500000*c0|c1=1.000000*c1"),
        "{filter}"
    );
    // A mono source has no `c1` to reference, so the clip is forced to stereo first — which is
    // exactly what the block mixer does with a mono source before applying the same gains.
    assert!(
        filter.starts_with("aformat=channel_layouts=stereo,"),
        "{filter}"
    );
    assert!(
        filter.ends_with(','),
        "it is spliced into a filter chain: {filter}"
    );
}

/// A centred clip emits **nothing**, so a project that has never touched pan produces the
/// filtergraph it always did — and cannot be re-levelled by a law whose centre is not unity.
#[test]
fn a_centred_clip_emits_no_pan_filter() {
    let (project, media) = two_lane_project();
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    for clip in &clips {
        assert_eq!(bay_preview::pan_filter_for_test(clip), "");
    }
}

/// **The composition order, pinned against the preview.** Clip pan first, then the lane's,
/// multiplied per channel — and the coefficients the filtergraph writes are the *same numbers*
/// `bay_audio::composed_pan_gains` hands the block mixer, because both call it.
#[test]
fn clip_pan_and_track_pan_compose_the_same_way_in_the_export_as_in_the_preview() {
    let (mut project, media) = two_lane_project();
    {
        let scene = project.active_scene_mut();
        scene.tracks.audio[0].pan = 0.5;
        if let Some(Element::Audio(music)) = scene.tracks.audio[0].elements.first_mut() {
            music.pan = 0.5;
        }
    }

    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    let music = clip_named(&clips, "/tmp/music.mp3");
    assert_eq!((music.pan, music.track_pan), (0.5, 0.5));

    let expected = bay_audio::composed_pan_gains(0.5, 0.5);
    assert_eq!(expected, [0.25, 1.0]);
    let filter = bay_preview::pan_filter_for_test(music);
    assert!(
        filter.contains(&format!(
            "pan=stereo|c0={:.6}*c0|c1={:.6}*c1",
            expected[0], expected[1]
        )),
        "{filter}"
    );

    // The block mixer, given the same two numbers, mixes at the same gains.
    let stream = bay_audio::stream::StreamClip {
        pcm: std::sync::Arc::new(bay_audio::AudioPcm {
            sample_rate: 48_000,
            channels: 2,
            samples: vec![1.0; 4096],
        }),
        start_secs: 0.0,
        source_start_secs: 0.0,
        play_secs: 1.0,
        volume: 1.0,
        gain_points: Vec::new(),
        pan: music.pan,
        track_gain: 1.0,
        track_pan: music.track_pan,
    };
    assert_eq!(stream.channel_gains(), expected);
}

// ---------------------------------------------------------------------------------------
// Track gain and solo reach the file

/// A lane's fader is a second gain stage in the export, exactly as it is in the preview: the
/// `volume` filter carries the product.
#[test]
fn a_lane_fader_reaches_the_volume_filter() {
    let (mut project, media) = two_lane_project();
    {
        let scene = project.active_scene_mut();
        scene.tracks.audio[0].gain = 0.5;
        if let Some(Element::Audio(music)) = scene.tracks.audio[0].elements.first_mut() {
            music.volume = 0.5;
        }
    }

    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    let music = clip_named(&clips, "/tmp/music.mp3");
    assert_eq!(music.track_gain, 0.5);
    assert_eq!(
        bay_preview::volume_filter_for_test(music),
        "volume=0.2500",
        "0.5 on the clip and 0.5 on the lane is 0.25 in the file"
    );

    // A moving level is scaled by the same constant, point for point.
    let ducked = bay_preview::AudibleClip {
        gain_points: vec![(0.0, 1.0), (1.0, 0.2), (3.0, 0.2), (4.0, 1.0)],
        ..music.clone()
    };
    let filter = bay_preview::volume_filter_for_test(&ducked);
    assert!(filter.starts_with("volume='"), "{filter}");
    assert!(
        filter.contains("0.5000") && filter.contains("0.1000"),
        "every point is halved by the lane's fader: {filter}"
    );
}

/// **Solo reaches the export.** A lane the room silences must be silent in the file too, and it
/// is decided by the same `Track::mix_gain` the preview's clip builder calls — not by a second
/// copy of the rule that can drift.
#[test]
fn solo_removes_the_other_lanes_from_the_export() {
    let (mut project, media) = two_lane_project();
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    assert_eq!(clips.len(), 2, "both lanes export when nothing is soloed");

    project.active_scene_mut().tracks.audio[1].solo = true;
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    assert_eq!(clips.len(), 1);
    assert_eq!(clips[0].path, "/tmp/voice.wav");
}

/// A muted lane is still silent, and a lane whose fader is at the bottom never becomes an
/// ffmpeg input — an input contributing nothing is a decode the export pays for and throws
/// away.
#[test]
fn a_muted_or_closed_lane_is_not_an_export_input() {
    let (mut project, media) = two_lane_project();
    project.active_scene_mut().tracks.audio[0].muted = true;
    assert_eq!(
        bay_preview::audible_clips_for_test(project.active_scene(), &media).len(),
        1
    );

    let (mut project, media) = two_lane_project();
    project.active_scene_mut().tracks.audio[0].gain = 0.0;
    assert_eq!(
        bay_preview::audible_clips_for_test(project.active_scene(), &media).len(),
        1
    );
}

/// A lane written before the mixer existed exports at unity — the backward-compat guarantee,
/// checked where it would actually be heard rather than only on the wire.
#[test]
fn a_project_written_before_the_mixer_exports_unchanged() {
    let (project, media) = two_lane_project();
    let clips = bay_preview::audible_clips_for_test(project.active_scene(), &media);
    for clip in &clips {
        assert_eq!(clip.track_gain, 1.0);
        assert_eq!(clip.track_pan, 0.0);
        assert_eq!(clip.pan, 0.0);
        assert_eq!(bay_preview::pan_filter_for_test(clip), "");
        assert_eq!(bay_preview::volume_filter_for_test(clip), "volume=1.0000");
    }
}
