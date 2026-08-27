//! Domain-model invariants: the starter project is well-formed, accessors resolve, and the
//! whole model survives a JSON round-trip (it is the persisted project format).

use bay_project::{Element, ElementKind, ElementRef, MediaTime, Project, TrackKind};

#[test]
fn starter_project_is_well_formed() {
    let project = Project::starter();

    // Exactly one scene, and it is the active + main scene.
    assert_eq!(project.scenes.len(), 1);
    let scene = project.active_scene();
    assert_eq!(scene.id, project.current_scene_id);
    assert!(scene.is_main);

    // The three-lane layout is present with the expected starter content.
    assert_eq!(scene.tracks.main.kind, TrackKind::Video);
    assert_eq!(scene.tracks.overlay.len(), 1);
    assert_eq!(scene.tracks.audio.len(), 1);
    assert_eq!(scene.tracks.main.elements.len(), 2);
}

#[test]
fn element_accessors_expose_common_fields() {
    let project = Project::starter();
    let title = &project.active_scene().tracks.main.elements[0];

    assert_eq!(title.id(), "el-title");
    assert_eq!(title.name(), "Title");
    assert_eq!(title.kind(), ElementKind::Text);
    assert_eq!(title.start(), MediaTime::ZERO);
    assert_eq!(title.end(), title.start() + title.duration());
    assert!(matches!(title, Element::Text(_)));
}

#[test]
fn tracks_iterate_top_to_bottom_and_resolve_by_ref() {
    let project = Project::starter();
    let scene = project.active_scene();

    let order: Vec<&str> = scene.tracks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(order, ["track-overlay", "track-main", "track-audio"]);

    let caption = scene
        .element(&ElementRef::new("track-overlay", "el-caption"))
        .expect("caption resolves");
    assert_eq!(caption.name(), "Caption");

    assert!(
        scene
            .element(&ElementRef::new("track-main", "missing"))
            .is_none()
    );
}

#[test]
fn project_survives_json_round_trip() {
    let project = Project::starter();
    let json = serde_json::to_string(&project).expect("serialize");
    let restored: Project = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(project, restored);

    // MediaTime serializes as raw ticks (a number), keeping the format compact + wasm-compatible.
    assert!(json.contains("\"type\":\"text\""));
}

/// The project file is the web↔native interop contract, so the fields the source-range work
/// added are pinned by name and by spelling here. A rename that the web app does not know
/// about loses a clip's in-point silently — the project still loads, and every trim resets.
#[test]
fn the_source_range_fields_keep_their_wire_names() {
    use bay_project::{AudioElement, MediaAsset, VideoElement};

    let clip = Element::Video(VideoElement {
        id: "v".into(),
        name: "v".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "m".into(),
        trim_start: MediaTime::from_ticks(240_000),
        trim_end: MediaTime::from_ticks(360_000),
        speed: 1.0,
        freeze: None,
        transform: Default::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        source: Default::default(),
        role: Default::default(),
    });
    let json = serde_json::to_string(&clip).expect("serialize");
    assert!(json.contains("\"trimStart\":240000"), "{json}");
    assert!(json.contains("\"trimEnd\":360000"), "{json}");

    let bed = Element::Audio(AudioElement {
        id: "a".into(),
        name: "a".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "m".into(),
        muted: false,
        volume: 1.0,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        animations: Default::default(),
        trim_start: MediaTime::from_ticks(600_000),
        source: Default::default(),
        role: Default::default(),
    });
    let json = serde_json::to_string(&bed).expect("serialize");
    assert!(json.contains("\"trimStart\":600000"), "{json}");

    let mut asset = MediaAsset::new("m", "take.mp4", "/tmp/take.mp4");
    asset.duration_seconds = Some(12.5);
    asset.width = Some(1920);
    asset.height = Some(1080);
    let json = serde_json::to_string(&asset).expect("serialize");
    assert!(json.contains("\"durationSeconds\":12.5"), "{json}");
    let restored: MediaAsset = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, asset);
}

/// What a file measures, pinned by name and spelling like everything else on the wire. The mix
/// checks read these; a rename would quietly turn every measured project back into an
/// unmeasured one, which reads as "the mix could not be evaluated" rather than as an error.
#[test]
fn the_loudness_fields_keep_their_wire_names() {
    use bay_project::{AssetLoudness, MediaAsset};

    let mut asset = MediaAsset::new("m", "bed.wav", "/tmp/bed.wav");
    asset.loudness = Some(AssetLoudness {
        peak_db: -23.8,
        rms_db: -35.0,
        lufs: -35.3,
        accent_seconds: vec![0.5, 1.0],
    });
    let json = serde_json::to_string(&asset).expect("serialize");
    for key in [
        "\"loudness\"",
        "\"peakDb\":-23.8",
        "\"rmsDb\":-35.0",
        "\"lufs\":-35.3",
        "\"accentSeconds\":[0.5,1.0]",
    ] {
        assert!(json.contains(key), "{key} missing from {json}");
    }
    let restored: MediaAsset = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, asset);

    // An asset nobody has measured says nothing at all, rather than saying zero — a bed at
    // "0 LUFS" would read as 21 dB louder than a bed at -21.
    let quiet = MediaAsset::new("m", "bed.wav", "/tmp/bed.wav");
    let json = serde_json::to_string(&quiet).expect("serialize");
    assert!(!json.contains("loudness"), "{json}");
}

/// A project written before loudness existed still loads, as assets nobody has measured.
#[test]
fn a_project_without_loudness_still_loads() {
    use bay_project::MediaAsset;

    let asset: MediaAsset = serde_json::from_str(
        r#"{"id":"m","name":"bed.wav","path":"/tmp/bed.wav","durationSeconds":61.0}"#,
    )
    .expect("an asset from before loudness was measured");
    assert!(asset.loudness.is_none());
    assert_eq!(asset.duration_seconds, Some(61.0));

    // …and an unmeasured measurement is not a silent one, which is what stops a check reading
    // an unprobed bed as a bed that is not there.
    let floor: bay_project::AssetLoudness =
        serde_json::from_str(r#"{"peakDb":-1.0,"rmsDb":-70.0,"lufs":-70.0}"#).expect("parsed");
    assert!(!floor.is_audible());
    assert!(floor.accent_seconds.is_empty());
}

#[test]
fn word_timed_transcript_persists_on_the_media_asset() {
    use bay_project::{MediaAsset, Transcript, TranscriptUtterance, TranscriptWord};

    let mut asset = MediaAsset::new("m", "take.webm", "/tmp/take.webm");
    asset.transcript = Some(Transcript {
        language: "en".into(),
        model: "ggml-small.en-q5_1.bin".into(),
        duration_seconds: 2.0,
        words: vec![TranscriptWord {
            text: "hope".into(),
            start_seconds: 1.1,
            end_seconds: 1.5,
            confidence: 0.94,
            speaker: Some("speaker-1".into()),
        }],
        utterances: vec![TranscriptUtterance {
            text: "hope".into(),
            start_seconds: 1.1,
            end_seconds: 1.5,
            speaker: Some("speaker-1".into()),
            word_start: 0,
            word_end: 1,
        }],
    });
    let json = serde_json::to_string(&asset).expect("serialize");
    assert!(json.contains("\"startSeconds\":1.1"), "{json}");
    assert!(json.contains("\"confidence\":0.94"), "{json}");
    let restored: MediaAsset = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, asset);
}

/// A project written before any of this existed must still open, as clips that play from
/// their own head — which is what they were. Defaulting is the difference between "old
/// projects load" and "old projects load wrong".
#[test]
fn a_project_without_the_new_fields_still_loads() {
    use bay_project::{AudioElement, MediaAsset};

    let bed: AudioElement = serde_json::from_str(
        r#"{"id":"a","name":"a","start":0,"duration":120000,"mediaId":"m","muted":false,"volume":1.0}"#,
    )
    .expect("an audio clip with no trimStart");
    assert_eq!(bed.trim_start, MediaTime::ZERO);

    let asset: MediaAsset =
        serde_json::from_str(r#"{"id":"m","name":"take.mp4","path":"/tmp/take.mp4"}"#)
            .expect("an unprobed asset");
    assert_eq!(asset.duration_seconds, None);
    assert!(
        asset.source_duration().is_none(),
        "unknown length must never read as zero length"
    );
}

// ---------------------------------------------------------------------------------------
// Fades, and the level curve both mixers read.

fn secs(n: f64) -> MediaTime {
    MediaTime::from_seconds_f64(n).expect("representable")
}

fn audio_clip(duration: f64, volume: f32) -> Element {
    Element::Audio(bay_project::AudioElement {
        id: "bed".into(),
        name: "bed".into(),
        start: MediaTime::ZERO,
        duration: secs(duration),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "m".into(),
        muted: false,
        volume,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        trim_start: MediaTime::ZERO,
        animations: Default::default(),
        source: Default::default(),
        role: Default::default(),
    })
}

#[test]
fn a_fade_ramps_linearly_and_reaches_full() {
    let mut clip = audio_clip(10.0, 1.0);
    clip.set_fades(secs(2.0), secs(4.0));

    assert_eq!(
        clip.fade_gain(MediaTime::ZERO),
        0.0,
        "silent at the very edge"
    );
    assert!((clip.fade_gain(secs(1.0)) - 0.5).abs() < 1e-5, "halfway up");
    assert_eq!(clip.fade_gain(secs(2.0)), 1.0, "full once the fade ends");
    assert_eq!(clip.fade_gain(secs(5.0)), 1.0, "and stays there");
    // The tail fade is 4s long, so it begins at 6s.
    assert_eq!(
        clip.fade_gain(secs(6.0)),
        1.0,
        "still full where the tail fade begins"
    );
    assert!(
        (clip.fade_gain(secs(8.0)) - 0.5).abs() < 1e-5,
        "halfway down"
    );
    assert!(
        (clip.fade_gain(secs(9.0)) - 0.25).abs() < 1e-5,
        "a quarter left"
    );
    assert_eq!(clip.fade_gain(secs(10.0)), 0.0, "silent at the end");
}

/// A clip with no fades is untouched — the default has to be a hard cut, or every project
/// written before fades existed would start ramping.
#[test]
fn no_fade_means_no_change() {
    let clip = audio_clip(5.0, 1.0);
    for t in [0.0, 0.5, 2.5, 5.0] {
        assert_eq!(clip.fade_gain(secs(t)), 1.0, "at {t}s");
    }
}

/// Fades that overlap in a short clip multiply rather than fight. The clip never reaches
/// full, which is exactly what was asked for.
#[test]
fn overlapping_fades_multiply() {
    let mut clip = audio_clip(1.0, 1.0);
    clip.set_fades(secs(1.0), secs(1.0));
    let middle = clip.fade_gain(secs(0.5));
    assert!((middle - 0.25).abs() < 1e-5, "got {middle}");
}

#[test]
fn a_flat_clip_reports_one_gain_point() {
    let clip = audio_clip(5.0, 0.8);
    assert_eq!(clip.gain_points(), vec![(0.0, 0.8)]);
}

/// The polyline both mixers read: fade edges become points, and the level between them is
/// what the model says it is.
#[test]
fn fades_become_points_the_mixers_can_interpolate() {
    let mut clip = audio_clip(10.0, 0.5);
    clip.set_fades(secs(2.0), secs(2.0));
    let points = clip.gain_points();
    assert_eq!(points.first(), Some(&(0.0, 0.0)));
    assert_eq!(points.last(), Some(&(10.0, 0.0)));
    assert!(
        points
            .iter()
            .any(|(t, g)| *t == 2.0 && (*g - 0.5).abs() < 1e-6),
        "the head fade tops out at the clip's own volume: {points:?}"
    );
}

/// Ducking: keyframed volume replaces the clip's flat level, and the fades still apply on
/// top of it.
#[test]
fn keyframed_volume_ducks_the_bed() {
    let mut clip = audio_clip(10.0, 1.0);
    let mut channel = bay_project::AnimationChannel::default();
    channel.upsert(secs(2.0), 1.0);
    channel.upsert(secs(3.0), 0.2); // under the narration
    channel.upsert(secs(7.0), 0.2);
    channel.upsert(secs(8.0), 1.0);
    clip.animations_mut()
        .expect("audio can be animated")
        .insert("volume".into(), channel);

    assert_eq!(clip.sampled_gain(secs(0.5)), Some(1.0));
    assert_eq!(
        clip.sampled_gain(secs(5.0)),
        Some(0.2),
        "ducked in the middle"
    );
    assert_eq!(clip.sampled_gain(secs(9.0)), Some(1.0), "back up after");

    let points = clip.gain_points();
    assert!(points.len() >= 4, "the duck has corners: {points:?}");
}

/// Only audio has a level; asking a title for one is a category error, not a zero.
#[test]
fn nothing_visual_has_a_level() {
    let project = Project::starter();
    let title = project
        .active_scene()
        .tracks
        .main
        .element("el-title")
        .unwrap();
    assert!(title.sampled_gain(MediaTime::ZERO).is_none());
    assert!(title.gain_points().is_empty());
}

#[test]
fn a_muted_clip_is_silent_whatever_its_keyframes_say() {
    let mut clip = audio_clip(5.0, 1.0);
    let Element::Audio(audio) = &mut clip else {
        panic!("audio")
    };
    audio.muted = true;
    assert_eq!(clip.sampled_gain(secs(2.0)), Some(0.0));
}

#[test]
fn fades_keep_their_wire_names() {
    let mut clip = audio_clip(5.0, 1.0);
    clip.set_fades(secs(1.0), secs(2.0));
    let json = serde_json::to_string(&clip).expect("serialize");
    assert!(json.contains("\"fadeIn\":120000"), "{json}");
    assert!(json.contains("\"fadeOut\":240000"), "{json}");

    let restored: Element = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, clip);
}

/// A project written before fades existed must open as hard cuts, which is what it was.
#[test]
fn a_clip_without_fades_still_loads() {
    let clip: bay_project::AudioElement = serde_json::from_str(
        r#"{"id":"a","name":"a","start":0,"duration":120000,"mediaId":"m","muted":false,"volume":1.0}"#,
    )
    .expect("an audio clip with no fades");
    assert_eq!(clip.fade_in, MediaTime::ZERO);
    assert_eq!(clip.fade_out, MediaTime::ZERO);
}

// ---------------------------------------------------------------------------------------
// Per-key easing, and the curves a velocity-matched cut is built from.

/// The point of the field: one channel that arrives fast, holds, and leaves slowly. A
/// channel-wide easing cannot say this, and faking it with dense keys samples back out as the
/// straight line the author was trying to avoid.
#[test]
fn a_key_overrides_its_channel_easing_for_the_segment_that_leaves_it() {
    use bay_project::{AnimationChannel, Easing, Keyframe};

    let channel = AnimationChannel {
        keys: vec![
            Keyframe::eased(secs(0.0), 0.0, Easing::ExpoOut),
            Keyframe::eased(secs(1.0), 1.0, Easing::Hold),
            Keyframe::new(secs(2.0), 0.0),
        ],
        easing: Easing::Linear,
    };

    // Segment one runs on expo-out despite the channel being linear: at the halfway point an
    // expo arrival is most of the way there, a linear one is exactly half.
    let midpoint = channel.sample(secs(0.5)).expect("keys exist");
    assert!(
        midpoint > 0.9,
        "expo-out should have nearly arrived by its midpoint, got {midpoint}"
    );

    // Segment two holds, then jumps — so the value is still 1.0 just before its end.
    assert_eq!(channel.sample(secs(1.5)), Some(1.0));
    assert_eq!(channel.sample(secs(2.0)), Some(0.0));
}

/// Without an override a key travels on its channel's curve, which is every project written
/// before the field existed.
#[test]
fn a_key_without_an_easing_uses_the_channels() {
    use bay_project::{AnimationChannel, Easing, Keyframe};

    let channel = AnimationChannel {
        keys: vec![Keyframe::new(secs(0.0), 0.0), Keyframe::new(secs(1.0), 1.0)],
        easing: Easing::Linear,
    };
    assert_eq!(channel.sample(secs(0.5)), Some(0.5));
}

/// Every curve must start at 0 and land exactly on 1, or an element settles short of where it
/// was put — `spring-out` is the one at risk, since its underlying response only reaches 1 at
/// infinity and has to be normalized.
#[test]
fn every_easing_starts_at_zero_and_lands_on_one() {
    use bay_project::Easing;

    for easing in [
        Easing::Linear,
        Easing::EaseIn,
        Easing::EaseOut,
        Easing::EaseInOut,
        Easing::PowerOut,
        Easing::PowerIn,
        Easing::ExpoOut,
        Easing::ExpoIn,
        Easing::Power4Out,
        Easing::Power4In,
        Easing::SpringOut,
        Easing::SineInOut,
        Easing::BackOut,
    ] {
        assert!(
            easing.apply(0.0).abs() < 1e-4,
            "{easing:?} must start at 0, got {}",
            easing.apply(0.0)
        );
        assert!(
            (easing.apply(1.0) - 1.0).abs() < 1e-4,
            "{easing:?} must land on 1, got {}",
            easing.apply(1.0)
        );
    }
}

/// The house entrance curve must not overshoot. That is the whole reason it exists next to
/// `back-out` rather than replacing it.
#[test]
fn spring_out_settles_without_overshooting() {
    use bay_project::Easing;

    for step in 0..=100 {
        let t = step as f32 / 100.0;
        let v = Easing::SpringOut.apply(t);
        assert!(
            (0.0..=1.0).contains(&v),
            "spring-out left the unit range at t={t}: {v}"
        );
    }
    assert!(
        Easing::BackOut.apply(0.7) > 1.0,
        "back-out is the one that overshoots, and should keep doing so"
    );
}

/// `power4.in` and `power4.out` are the two halves of one `power4.inOut`, which is what makes
/// a cut between them land at matched velocity. Mirrored curves must be mirror images.
#[test]
fn the_mirrored_pair_is_actually_mirrored() {
    use bay_project::Easing;

    for step in 0..=20 {
        let t = step as f32 / 20.0;
        let out = Easing::Power4Out.apply(t);
        let mirrored = 1.0 - Easing::Power4In.apply(1.0 - t);
        assert!(
            (out - mirrored).abs() < 1e-5,
            "power4 pair diverged at t={t}: {out} vs {mirrored}"
        );
    }
}

#[test]
fn per_key_easing_keeps_its_wire_name_and_stays_out_of_the_way_when_unset() {
    use bay_project::{AnimationChannel, Easing, Keyframe};

    let channel = AnimationChannel {
        keys: vec![
            Keyframe::eased(secs(0.0), 0.0, Easing::SpringOut),
            Keyframe::new(secs(1.0), 1.0),
        ],
        easing: Easing::Linear,
    };
    let json = serde_json::to_string(&channel).expect("serialize");
    assert!(json.contains("\"easing\":\"spring-out\""), "{json}");
    // The plain key must not grow a null: every project ever written has keys without one.
    assert!(!json.contains("null"), "{json}");

    let restored: AnimationChannel = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, channel);
}

/// A channel written before keys could carry a curve must load unchanged.
#[test]
fn keys_without_an_easing_still_load() {
    use bay_project::{AnimationChannel, Easing};

    let channel: AnimationChannel = serde_json::from_str(
        r#"{"keys":[{"time":0,"value":0.0},{"time":120000,"value":1.0}],"easing":"power-out"}"#,
    )
    .expect("a channel with plain keys");
    assert_eq!(channel.easing, Easing::PowerOut);
    assert!(channel.keys.iter().all(|k| k.easing.is_none()));
}

/// An eased segment reaches the export as a curve. The channel here is linear, so only the
/// key's own curve can be what forces the subdivision — the bug this guards is a duck that
/// sounds right in the room and is a straight line in the file.
#[test]
fn a_key_eased_duck_subdivides_for_the_mixers() {
    use bay_project::{AnimationChannel, Easing, Keyframe};

    let mut clip = audio_clip(10.0, 1.0);
    let channel = AnimationChannel {
        keys: vec![
            Keyframe::eased(secs(2.0), 1.0, Easing::ExpoOut),
            Keyframe::new(secs(4.0), 0.2),
        ],
        easing: Easing::Linear,
    };
    clip.animations_mut()
        .expect("audio animates")
        .insert("volume".into(), channel);

    let points = clip.gain_points();
    let inside: Vec<_> = points
        .iter()
        .filter(|(t, _)| *t > 2.0 && *t < 4.0)
        .collect();
    assert!(
        inside.len() > 8,
        "an eased segment must be subdivided, got {} points: {points:?}",
        inside.len()
    );
}

// ---------------------------------------------------------------------------------------
// Provenance and role: who put an element on the timeline, and what it is for.
//
// The point of these fields is that bay's own caption output stops being counted as the
// author's work. Every measurement downstream partitions on `source`, so the wire names and
// the inference applied when an old project is opened are both part of the contract.

/// The project file is the web↔native interop contract, so the two new fields are pinned by
/// name and by spelling — including the kebab-case value names.
#[test]
fn provenance_and_role_keep_their_wire_names() {
    use bay_project::{
        AudioRole, ElementRole, ElementSource, ShapeElement, ShapeKind, TextElement,
    };

    let mut title = Element::Text(TextElement {
        id: "hero".into(),
        name: "hero".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        content: "Wicks".into(),
        font_size: 220.0,
        color: "#ffffff".into(),
        transform: Default::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        font_family: None,
        font_weight: 700,
        align: Default::default(),
        letter_spacing: 0.0,
        line_height: 1.2,
        decorations: None,
        karaoke: None,
        type_on: None,
        source: ElementSource::Author,
        role: ElementRole::Hook,
    });
    let json = serde_json::to_string(&title).expect("serialize");
    assert!(json.contains("\"source\":\"author\""), "{json}");
    assert!(json.contains("\"role\":\"hook\""), "{json}");
    let restored: Element = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, title);

    // Every role name is kebab-case and round-trips, so none of them can drift.
    for role in ElementRole::ALL {
        title.set_role(role);
        let json = serde_json::to_string(&title).expect("serialize");
        assert!(
            json.contains(&format!("\"role\":\"{}\"", role.as_str())),
            "{role:?} serialized as something else: {json}"
        );
        let restored: Element = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(restored.role(), Some(role));
    }

    let plate = Element::Shape(ShapeElement {
        id: "plate".into(),
        name: "plate".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        shape: ShapeKind::Rect { radius: 0.0 },
        color: "#15151C".into(),
        gradient: None,
        stroke: None,
        transform: Default::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        source: ElementSource::Author,
        role: ElementRole::Ground,
    });
    let json = serde_json::to_string(&plate).expect("serialize");
    assert!(json.contains("\"role\":\"ground\""), "{json}");
    assert_eq!(
        serde_json::from_str::<Element>(&json).expect("deserialize"),
        plate
    );

    let mut bed = audio_clip(4.0, 0.3);
    bed.set_source(ElementSource::Tool);
    for role in AudioRole::ALL {
        bed.set_audio_role(role);
        let json = serde_json::to_string(&bed).expect("serialize");
        assert!(json.contains("\"source\":\"tool\""), "{json}");
        assert!(
            json.contains(&format!("\"role\":\"{}\"", role.as_str())),
            "{role:?} serialized as something else: {json}"
        );
        let restored: Element = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(restored, bed);
    }
}

/// A project written before these fields existed must load, and must load as the author's own
/// work — which is what an unmarked project is until something says otherwise.
#[test]
fn elements_without_provenance_load_as_the_authors_own() {
    use bay_project::{AudioRole, ElementRole, ElementSource, TextElement};

    let title: TextElement = serde_json::from_str(
        r##"{"id":"t","name":"t","start":0,"duration":120000,"content":"x","fontSize":64,"color":"#fff"}"##,
    )
    .expect("a text element with no source or role");
    assert_eq!(title.source, ElementSource::Author);
    assert_eq!(title.role, ElementRole::Label);

    let bed: bay_project::AudioElement = serde_json::from_str(
        r#"{"id":"a","name":"a","start":0,"duration":120000,"mediaId":"m","muted":false,"volume":1.0}"#,
    )
    .expect("an audio clip with no source or role");
    assert_eq!(bed.source, ElementSource::Author);
    assert_eq!(bed.role, AudioRole::Bed);
}

#[test]
fn generated_media_provenance_round_trips_and_old_assets_default_to_authored() {
    use bay_project::{GeneratedMediaProvenance, MediaAsset};

    let old: MediaAsset =
        serde_json::from_str(r#"{"id":"m","name":"photo","path":"/tmp/photo.png"}"#)
            .expect("projects written before generation provenance must still load");
    assert!(old.generated.is_none());

    let mut generated = old;
    generated.generated = Some(GeneratedMediaProvenance {
        provider: "fal".into(),
        model: "fal-ai/flux/dev".into(),
        prompt: "a red bicycle in snow".into(),
        seed: 42,
        generated_at_unix_ms: 1_786_813_200_000,
        request_hash: "request".into(),
        artifact_sha256: "artifact".into(),
    });
    let json = serde_json::to_string(&generated).expect("serialize generated media");
    assert!(json.contains("\"generated\":{"), "{json}");
    assert!(json.contains("\"artifactSha256\":\"artifact\""), "{json}");
    assert_eq!(
        serde_json::from_str::<MediaAsset>(&json).expect("deserialize generated media"),
        generated
    );
}

/// `caption-<n>` is bay's own, and nothing else is.
#[test]
fn the_reserved_caption_id_is_exactly_caption_and_digits() {
    use bay_project::is_caption_id;

    assert!(is_caption_id("caption-1"));
    assert!(is_caption_id("caption-38"));
    assert!(!is_caption_id("caption-"));
    assert!(!is_caption_id("caption-a"));
    assert!(!is_caption_id("caption-1a"));
    assert!(!is_caption_id("my-caption-1"));
    assert!(!is_caption_id("cap_a"));
}

/// The whole point, on a project that predates the field: opening it must classify bay's own
/// captions and narration as `Tool` without a single `source` key on disk.
#[test]
fn opening_an_old_project_recovers_what_bay_wrote() {
    use bay_project::{AudioRole, ElementRole, ElementSource};

    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/legacy-captions.json");
    let project = bay_project::library::read_project(&path).expect("the fixture loads");
    let scene = project.active_scene();

    let split = scene.by_source();
    assert_eq!(
        split.tool.len(),
        3,
        "two captions and one narration clip are bay's: {:?}",
        split.tool.iter().map(|e| e.id()).collect::<Vec<_>>()
    );
    assert_eq!(
        split.authored.len(),
        4,
        "a headline, a plate, a bed and a sound effect are the author's: {:?}",
        split.authored.iter().map(|e| e.id()).collect::<Vec<_>>()
    );

    for id in ["caption-1", "caption-2"] {
        let caption = scene.elements().find(|e| e.id() == id).expect(id);
        assert_eq!(caption.source(), ElementSource::Tool, "{id}");
        assert_eq!(caption.role(), Some(ElementRole::Caption), "{id}");
    }

    let narration = scene.elements().find(|e| e.id() == "audio-1").unwrap();
    assert_eq!(narration.source(), ElementSource::Tool);
    assert_eq!(narration.audio_role(), Some(AudioRole::Speech));

    // The bed and the effect are the author's, and they are told apart from each other.
    let bed = scene.elements().find(|e| e.id() == "bed1").unwrap();
    assert_eq!(bed.source(), ElementSource::Author);
    assert_eq!(bed.audio_role(), Some(AudioRole::Bed));
    let sfx = scene.elements().find(|e| e.id() == "audio-9").unwrap();
    assert_eq!(sfx.source(), ElementSource::Author);
    assert_eq!(sfx.audio_role(), Some(AudioRole::Sfx));

    // The author's own work keeps the neutral default rather than being guessed at.
    let head = scene.elements().find(|e| e.id() == "head1").unwrap();
    assert_eq!(head.role(), Some(ElementRole::Label));
}

/// Inference only ever upgrades: running it twice changes nothing, and a role already stamped
/// is not overwritten. Otherwise opening a project would quietly rewrite it.
#[test]
fn inferring_provenance_is_idempotent_and_never_downgrades() {
    use bay_project::{ElementRole, ElementSource};

    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/legacy-captions.json");
    let mut project = bay_project::library::read_project(&path).expect("the fixture loads");
    let once = project.clone();
    project.infer_provenance();
    assert_eq!(project, once, "a second pass must be a no-op");

    // A hook the author declared stays a hook even though inference runs over it again.
    let scene = project.active_scene_mut();
    let head = scene
        .tracks
        .main
        .element_mut("head1")
        .expect("the headline");
    head.set_role(ElementRole::Hook);
    project.infer_provenance();
    let head = project
        .active_scene()
        .elements()
        .find(|e| e.id() == "head1")
        .unwrap();
    assert_eq!(head.role(), Some(ElementRole::Hook));
    assert_eq!(head.source(), ElementSource::Author);
}

/// The real thing. `project-1786466680050.json` is the 61-second video this whole effort is
/// about: 73 text elements, 38 of them `narrate`'s captions, and not one `source` key on disk.
///
/// Skipped rather than failed when the file is not on the machine — it lives in the user's own
/// project library, not in the repository, and a test that fails for reasons outside the repo
/// teaches people to re-run until green. The fixture above is what makes the same assertion
/// unconditionally.
#[test]
fn the_failed_project_classifies_its_captions_as_bays_own() {
    use bay_project::{AudioRole, ElementKind, ElementSource};

    let Some(root) = bay_project::ProjectLibrary::default_root().ok() else {
        eprintln!("skipping: no project library on this machine");
        return;
    };
    let path = root.join("project-1786466680050.json");
    if !path.exists() {
        eprintln!("skipping: {} is not on this machine", path.display());
        return;
    }
    let project = bay_project::library::read_project(&path).expect("the real project loads");
    let scene = project.active_scene();

    let text: Vec<_> = scene
        .elements()
        .filter(|e| e.kind() == ElementKind::Text)
        .collect();
    let tool_text = text.iter().filter(|e| !e.is_authored()).count();
    eprintln!(
        "wicks-v2: {} text elements, {} of them bay's captions; {} authored / {} tool overall",
        text.len(),
        tool_text,
        scene.authored_elements().count(),
        scene.tool_elements().count()
    );
    assert_eq!(text.len(), 73, "the project this was measured against");
    assert_eq!(
        tool_text, 38,
        "38 of the 73 titles are narrate's, not the author's"
    );
    assert!(
        scene
            .tool_elements()
            .all(|e| e.source() == ElementSource::Tool)
    );
    assert_eq!(
        scene.tool_elements().count(),
        44,
        "38 captions and 6 narration clips"
    );

    // The narration is bay's too, recovered from the WAVs it wrote.
    let speech = scene
        .elements()
        .filter(|e| e.audio_role() == Some(AudioRole::Speech))
        .count();
    let rest = scene
        .elements()
        .filter(|e| e.audio_role() == Some(AudioRole::Bed))
        .count();
    eprintln!("wicks-v2 audio: {speech} spoken, {rest} not-speech");
    assert_eq!(speech, 6, "six narrate calls, six speech clips");
    // The remaining 63 are 13 bed clips and 50 sound effects the author imported by hand and
    // placed with add_audio. Nothing in the file distinguishes them — which is precisely why
    // `add_audio` now takes a role. Inference cannot recover what was never written down, and
    // guessing "whoosh.wav is an effect" from a filename would be a rule about English.
    assert_eq!(rest, 63, "everything not spoken reads as a bed until said");
}

// ---------------------------------------------------------------------------------------
// The style kit, and the wire format it is pinned to.

/// The kit is part of the project file, so its field names are part of the interop contract
/// the web app reads. A rename that the other side does not know about silently drops a
/// project's typography and colour back to whatever the shaper picks by default.
#[test]
fn the_style_kit_keeps_its_wire_names() {
    let mut project = Project::starter();
    let kit = bay_project::builtin_kit("swiss")
        .expect("swiss is a built-in")
        .clone();
    project.settings.kit = Some(kit.clone());

    let json = serde_json::to_string(&project).expect("serialize");
    for field in [
        "\"kit\"",
        "\"faces\"",
        "\"display\"",
        "\"body\"",
        "\"mono\"",
        "\"family\"",
        "\"weight\"",
        "\"ramp\"",
        "\"hook\"",
        "\"headline\"",
        "\"kicker\"",
        "\"label\"",
        "\"caption\"",
        "\"lockup\"",
        "\"data\"",
        "\"ground\"",
        "\"chrome\"",
        "\"size\"",
        "\"tracking\"",
        "\"lineHeight\"",
        "\"palette\"",
        "\"bg\"",
        "\"surface\"",
        "\"ink\"",
        "\"dim\"",
        "\"accent\"",
        "\"accent2\"",
        "\"framings\"",
        "\"anchorX\"",
        "\"anchorY\"",
    ] {
        assert!(json.contains(field), "{field} is missing from {json}");
    }

    let restored: Project = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(restored, project);
    assert_eq!(restored.settings.kit.as_ref(), Some(&kit));
}

/// Tone is the whole colour surface an author gets, and it is kebab-case on the wire like every
/// other enum in this model.
#[test]
fn tone_and_its_wire_names_round_trip() {
    use bay_project::Tone;
    for (tone, wire) in [
        (Tone::Ink, "\"ink\""),
        (Tone::Dim, "\"dim\""),
        (Tone::Accent, "\"accent\""),
        (Tone::Accent2, "\"accent2\""),
        (Tone::Surface, "\"surface\""),
    ] {
        let json = serde_json::to_string(&tone).expect("serialize");
        assert_eq!(json, wire);
        let restored: Tone = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(restored, tone);
    }
}

/// A project written before kits existed carries no `kit` key at all, and must load — and
/// render — exactly as it did. Only the *wire schema* of the tools narrowed; the format did
/// not.
#[test]
fn a_project_without_a_kit_still_loads_with_its_own_typography() {
    let raw = r##"{
        "metadata": { "id": "old", "name": "Old" },
        "settings": {
            "fps": { "numerator": 30, "denominator": 1 },
            "canvas": { "width": 1080, "height": 1920 },
            "background": { "type": "color", "color": "#0E0E12" }
        },
        "scenes": [{
            "id": "scene-main", "name": "Main", "isMain": true,
            "tracks": { "overlay": [], "main": { "id": "track-main", "name": "Main",
                "kind": "video", "hidden": false, "muted": false, "elements": [
                    { "type": "text", "id": "t", "name": "t", "start": 0, "duration": 120000,
                      "content": "Hook", "fontSize": 34, "color": "#4A4A58",
                      "fontFamily": "Menlo", "fontWeight": 400 }
                ] }, "audio": [] }
        }],
        "currentSceneId": "scene-main"
    }"##;
    let project: Project = serde_json::from_str(raw).expect("an old project still loads");
    assert!(project.settings.kit.is_none(), "it never had one");
    let Element::Text(text) = project.active_scene().elements().next().unwrap() else {
        panic!("a title")
    };
    assert_eq!(text.font_size, 34.0, "its own size survives untouched");
    assert_eq!(text.color, "#4A4A58");
    assert_eq!(text.font_family.as_deref(), Some("Menlo"));
    assert_eq!(text.font_weight, 400);
}

/// The backstop for the import path.
///
/// `add_text` and `add_shape` cannot be given a family, a size, a weight or a colour any more —
/// but the wasm/web front end deserialises `Project` straight off the wire, and that format is
/// the pinned interop contract, so it cannot be narrowed the same way. `off_token_values` is
/// where the same claim gets made again, over the finished document.
#[test]
fn off_token_values_catch_what_the_wire_can_still_smuggle_in() {
    use bay_project::{ElementRole, OffToken, Tone};

    let kit = bay_project::builtin_kit("swiss").unwrap().clone();
    let mut project = Project::starter();
    project.settings.kit = Some(kit.clone());

    // A title exactly as the kit would draw it: nothing to report.
    let scene = project.active_scene_mut();
    scene.tracks.overlay.clear();
    scene.tracks.audio.clear();
    let elements = &mut scene.tracks.main.elements;
    elements.truncate(1);
    let Element::Text(text) = &mut elements[0] else {
        panic!("a title")
    };
    text.role = ElementRole::Headline;
    let style = kit.resolve(ElementRole::Headline, Tone::Ink);
    text.font_family = Some(style.family.clone());
    text.font_weight = style.weight;
    text.font_size = style.size;
    text.color = style.color.clone();
    assert!(
        kit.off_token_values(project.active_scene()).is_empty(),
        "{:#?}",
        kit.off_token_values(project.active_scene())
    );

    // Now the four values the old surface let through, one at a time.
    let Element::Text(text) = &mut project.active_scene_mut().tracks.main.elements[0] else {
        panic!("a title")
    };
    text.font_family = Some("Menlo".into());
    text.font_size = 34.0;
    text.font_weight = 400;
    text.color = "#4A4A58".into();

    let found = kit.off_token_values(project.active_scene());
    let fields: Vec<&str> = found.iter().map(|token| token.field).collect();
    assert!(fields.contains(&"fontFamily"), "{found:#?}");
    assert!(fields.contains(&"fontSize"), "{found:#?}");
    assert!(fields.contains(&"fontWeight"), "{found:#?}");
    assert!(fields.contains(&"color"), "{found:#?}");
    assert_eq!(OffToken::CODE, "off-token-value");
    assert!(
        found[0].message().contains("style kit"),
        "{}",
        found[0].message()
    );
}

/// bay's own captions are bay's. Measuring them as though an author had chosen the size and the
/// colour is exactly the mistake provenance exists to stop, so they are not off-token however
/// far they are from the kit.
#[test]
fn the_captions_bay_wrote_are_not_off_token_values() {
    use bay_project::{ElementSource, TextElement};

    let kit = bay_project::builtin_kit("swiss").unwrap().clone();
    let mut project = Project::starter();
    project.settings.kit = Some(kit.clone());
    let caption = TextElement {
        id: "caption-1".into(),
        name: "cue".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_ticks(120_000),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        content: "spoken words".into(),
        font_size: 46.0,
        color: "#EDECE6".into(),
        transform: Default::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: Default::default(),
        mask: None,
        font_family: Some("Menlo".into()),
        font_weight: 600,
        align: Default::default(),
        letter_spacing: 0.0,
        line_height: 1.2,
        decorations: None,
        karaoke: None,
        type_on: None,
        source: ElementSource::Tool,
        role: bay_project::ElementRole::Caption,
    };
    let scene = project.active_scene_mut();
    scene.tracks.overlay.clear();
    scene.tracks.audio.clear();
    scene.tracks.main.elements = vec![Element::Text(caption)];
    assert!(
        kit.off_token_values(project.active_scene()).is_empty(),
        "a caption is bay's own output, not an authored choice"
    );
}

/// The real thing again, this time as the import backstop sees it.
///
/// `project-1786466680050.json` is the 61-second video this whole effort is about: 69 of its 73
/// titles in Menlo, a modal size of 34 on a 1080-wide canvas, five colours. It has no kit — it
/// predates them — so this measures it against one and prints what the finding would say.
///
/// Skipped rather than failed when the file is not on the machine: it lives in the user's own
/// library, not the repository.
#[test]
fn the_failed_project_is_full_of_off_token_values() {
    let Ok(root) = bay_project::ProjectLibrary::default_root() else {
        eprintln!("skipping: no project library on this machine");
        return;
    };
    let path = root.join("project-1786466680050.json");
    if !path.exists() {
        eprintln!("skipping: {} is not on this machine", path.display());
        return;
    }
    let project = bay_project::library::read_project(&path).expect("the real project loads");
    assert!(
        project.settings.kit.is_none(),
        "it was made before kits existed, and must still load"
    );

    let kit = bay_project::builtin_kit("editorial-data").unwrap();
    let found = kit.off_token_values(project.active_scene());
    let families = found
        .iter()
        .filter(|token| token.field == "fontFamily")
        .count();
    let colors = found.iter().filter(|token| token.field == "color").count();
    eprintln!(
        "wicks-v2 against the editorial-data kit: {} off-token values ({families} families, \
         {colors} colours). First: {}",
        found.len(),
        found.first().map(|t| t.message()).unwrap_or_default()
    );
    // 35 of the 73 titles are the author's; the other 38 are narrate's captions, and those are
    // bay's own output rather than a choice anyone made — which is why they are not counted.
    assert_eq!(
        families, 35,
        "every authored title names a family the kit does not"
    );
    assert!(colors > 50, "and five colours, none of them the kit's");
}

// --------------------------------------------------------------- sampled channels

use bay_project::{
    AnimationChannel, BlendMode, Easing, ElementSource, Keyframe, ShapeElement, ShapeKind, Stroke,
};

/// Two keys on a channel: `from` at zero, `to` one second in, travelled linearly so the value
/// halfway along is the midpoint and the assertion needs no easing table.
fn ramp(from: f32, to: f32) -> AnimationChannel {
    AnimationChannel {
        keys: vec![
            Keyframe::new(MediaTime::ZERO, from),
            Keyframe::new(secs(1.0), to),
        ],
        easing: Easing::Linear,
    }
}

fn card(radius: f32, stroke: Option<Stroke>) -> ShapeElement {
    ShapeElement {
        id: "sh".into(),
        name: "Card".into(),
        start: MediaTime::ZERO,
        duration: secs(2.0),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        shape: ShapeKind::Rect { radius },
        color: "#ffffff".into(),
        gradient: None,
        stroke,
        transform: Default::default(),
        effects: Vec::new(),
        animations: Default::default(),
        blend_mode: BlendMode::Normal,
        mask: None,
        source: ElementSource::Author,
        role: Default::default(),
    }
}

#[test]
fn shape_radius_and_stroke_width_are_animatable() {
    let mut shape = card(
        0.0,
        Some(Stroke {
            color: "#000000".into(),
            width: 0.0,
            dash: None,
            gap: None,
        }),
    );
    shape
        .animations
        .insert("shape.radius".into(), ramp(0.0, 0.4));
    shape
        .animations
        .insert("stroke.width".into(), ramp(0.0, 0.1));
    let element = Element::Shape(shape);

    let half = secs(0.5);
    let ShapeKind::Rect { radius } = element.sampled_shape_kind(half).expect("a shape") else {
        panic!("expected a rect");
    };
    assert!((radius - 0.2).abs() < 1e-4, "radius was {radius}");
    let width = element.sampled_stroke(half).expect("a stroke").width;
    assert!((width - 0.05).abs() < 1e-4, "stroke width was {width}");
}

/// A channel cannot conjure a stroke that is not there: width is only half of one, and the
/// colour it would need is not a scalar.
#[test]
fn a_stroke_channel_on_a_shape_without_a_stroke_stays_none() {
    let mut shape = card(0.0, None);
    shape
        .animations
        .insert("stroke.width".into(), ramp(0.0, 0.1));
    assert!(
        Element::Shape(shape)
            .sampled_stroke(MediaTime::ZERO)
            .is_none()
    );
}

#[test]
fn font_size_is_animatable_and_falls_back_to_the_static_value() {
    let project = Project::starter();
    let Element::Text(base) = project.active_scene().tracks.main.elements[0].clone() else {
        panic!("the starter title is text");
    };
    assert_eq!(
        Element::Text(base.clone()).sampled_font_size(MediaTime::ZERO),
        Some(base.font_size),
        "with no channel the static size stands"
    );

    let mut animated = base.clone();
    animated
        .animations
        .insert("fontSize".into(), ramp(20.0, 60.0));
    let sampled = Element::Text(animated)
        .sampled_font_size(secs(0.5))
        .expect("a text element");
    assert!((sampled - 40.0).abs() < 1e-4, "font size was {sampled}");
}

/// Ground truth for anything writing a project file by hand: what the wire format actually
/// looks like. `cargo test -p bay-project --test model dump_starter_json -- --nocapture`
#[test]
fn dump_starter_json() {
    if std::env::var("DUMP_PROJECT_JSON").is_err() {
        return;
    }
    let project = Project::starter();
    println!(
        "{}",
        serde_json::to_string_pretty(&project).expect("the project serializes")
    );
}

/// Load a project file written by something outside this repo and report what it says.
///
/// Gated on an env var so it is inert in CI: it exists to prove an exporter's output is a
/// project bay can actually open, which is a claim no amount of matching field names settles.
/// `BAY_LOAD_PROJECT=/path/to.json cargo test -p bay-project --test model load_external -- --nocapture`
#[test]
fn load_external_project() {
    let Ok(path) = std::env::var("BAY_LOAD_PROJECT") else {
        return;
    };
    let raw = std::fs::read_to_string(&path).expect("the file is readable");
    let project: Project = serde_json::from_str(&raw).expect("it deserializes as a Project");
    let scene = project.active_scene();
    let elements = &scene.tracks.main.elements;
    let shadows = elements
        .iter()
        .filter(|e| e.effects().iter().any(|fx| fx.effect_type == "drop-shadow"))
        .count();
    let last = elements
        .iter()
        .map(|e| e.start().as_ticks() + e.duration().as_ticks())
        .max()
        .unwrap_or(0);
    println!(
        "LOADED name={:?} canvas={}x{} elements={} shadows={} end_ticks={} end_seconds={:.2}",
        project.metadata.name,
        project.settings.canvas.width,
        project.settings.canvas.height,
        elements.len(),
        shadows,
        last,
        last as f64 / 120_000.0,
    );

    // Round-trip: what we read must be what we would write.
    let again = serde_json::to_string(&project).expect("serializes");
    let reparsed: Project = serde_json::from_str(&again).expect("re-reads");
    assert_eq!(
        project, reparsed,
        "the project does not survive a round trip"
    );
}
