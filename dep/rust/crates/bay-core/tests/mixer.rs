//! The mixer surface: the commands a mixer strip binds to, and the clip list the streaming
//! mixer plays.
//!
//! Every test here runs headless — no window, no audio device, no ffmpeg. That is the point:
//! the milestone's rule is that a control must do what it says, and the only way to know a
//! fader does is to move it from a test and read what the mixer would sound.

use std::sync::Arc;

use bay_audio::AudioPcm;
use bay_core::{Command, Editor, ElementRef};
use bay_project::{AudioElement, Element, MediaTime, Track, TrackKind};

fn secs(n: f64) -> MediaTime {
    MediaTime::from_seconds_f64(n).expect("representable")
}

fn audio(id: &str, media: &str, start: f64, duration: f64) -> Element {
    Element::Audio(AudioElement {
        id: id.into(),
        name: id.into(),
        start: secs(start),
        duration: secs(duration),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: media.into(),
        muted: false,
        volume: 1.0,
        pan: 0.0,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        animations: Default::default(),
        trim_start: MediaTime::ZERO,
        source: Default::default(),
        role: Default::default(),
    })
}

/// An editor with two audio lanes — music and voice — each carrying one clip.
fn two_lane_editor() -> Editor {
    let mut editor = Editor::starter();
    {
        let project = editor.project_mut();
        let scene = project.active_scene_mut();
        let mut music = Track::new("track-music", "Music", TrackKind::Audio);
        music.elements = vec![audio("music", "media-music", 0.0, 10.0)];
        let mut voice = Track::new("track-voice", "Voice", TrackKind::Audio);
        voice.elements = vec![audio("voice", "media-voice", 0.0, 10.0)];
        scene.tracks.audio = vec![music, voice];
    }
    editor
}

fn pcm(amplitude: f32) -> Arc<AudioPcm> {
    Arc::new(AudioPcm {
        sample_rate: 48_000,
        channels: 2,
        samples: vec![amplitude; 48_000 * 2 * 12],
    })
}

// ---------------------------------------------------------------------------------------
// The commands a strip binds to

/// The clip-level pair the milestone exists to make bindable. Before these, a mixer strip had
/// nothing to send: `SetFades` and `SetTrackMuted` were the only audio commands in the engine,
/// and neither is a fader.
#[test]
fn set_volume_and_set_muted_move_a_clip_and_undo() {
    let mut editor = two_lane_editor();
    let clip = ElementRef::new("track-music", "music");

    assert!(editor.execute(Command::SetVolume {
        reference: clip.clone(),
        volume: 0.25,
    }));
    assert_eq!(
        editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .volume,
        0.25
    );

    assert!(editor.execute(Command::SetMuted {
        reference: clip.clone(),
        muted: true,
    }));
    assert!(
        editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .muted
    );

    editor.undo(); // the mute
    assert!(
        !editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .muted
    );
    editor.undo(); // the level
    assert_eq!(
        editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .volume,
        1.0,
        "undo restores the level the strip was at, not a default"
    );
}

#[test]
fn set_pan_moves_a_clip_across_the_field_and_undoes() {
    let mut editor = two_lane_editor();
    let clip = ElementRef::new("track-voice", "voice");

    assert!(editor.execute(Command::SetPan {
        reference: clip.clone(),
        pan: -0.5,
    }));
    assert_eq!(
        editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .pan,
        -0.5
    );
    editor.undo();
    assert_eq!(
        editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .pan,
        0.0
    );
}

#[test]
fn the_track_level_commands_move_a_lane_and_undo() {
    let mut editor = two_lane_editor();

    assert!(editor.execute(Command::SetTrackVolume {
        track_id: "track-music".into(),
        gain: 0.5,
    }));
    assert!(editor.execute(Command::SetTrackPan {
        track_id: "track-music".into(),
        pan: 0.75,
    }));
    assert!(editor.execute(Command::SetTrackSolo {
        track_id: "track-voice".into(),
        solo: true,
    }));

    let lane = |editor: &Editor, id: &str| {
        editor
            .active_scene()
            .tracks
            .track(id)
            .cloned()
            .expect("the lane")
    };
    assert_eq!(lane(&editor, "track-music").gain, 0.5);
    assert_eq!(lane(&editor, "track-music").pan, 0.75);
    assert!(lane(&editor, "track-voice").solo);

    editor.undo();
    assert!(!lane(&editor, "track-voice").solo);
    editor.undo();
    assert_eq!(lane(&editor, "track-music").pan, 0.0);
    editor.undo();
    assert_eq!(lane(&editor, "track-music").gain, 1.0);
}

/// A control that reports success for a value it did not take is a control that lies. Levels
/// and pans are clamped to what the render path can actually do, and a value already in place
/// is not an edit at all — otherwise dragging a fader and putting it back leaves a step in the
/// undo stack.
#[test]
fn the_mixer_commands_refuse_what_they_cannot_do() {
    let mut editor = two_lane_editor();
    let clip = ElementRef::new("track-music", "music");
    let level = |editor: &Editor| {
        editor
            .active_scene()
            .element(&ElementRef::new("track-music", "music"))
            .unwrap()
            .audio()
            .unwrap()
            .volume
    };

    assert!(
        !editor.execute(Command::SetVolume {
            reference: clip.clone(),
            volume: 1.0,
        }),
        "already there"
    );

    editor.execute(Command::SetVolume {
        reference: clip.clone(),
        volume: 1e30,
    });
    assert_eq!(level(&editor), 4.0, "clamped to what the mixer can render");

    editor.execute(Command::SetVolume {
        reference: clip.clone(),
        volume: f32::NAN,
    });
    assert_eq!(level(&editor), 1.0, "a NaN fader is unity, not silence");

    editor.execute(Command::SetPan {
        reference: clip.clone(),
        pan: -9.0,
    });
    assert_eq!(
        editor
            .active_scene()
            .element(&clip)
            .unwrap()
            .audio()
            .unwrap()
            .pan,
        -1.0
    );

    // Nothing visual has a level, so neither command touches one.
    let title = ElementRef::new("track-main", "el-title");
    assert!(!editor.execute(Command::SetVolume {
        reference: title.clone(),
        volume: 0.5,
    }));
    assert!(!editor.execute(Command::SetMuted {
        reference: title,
        muted: true,
    }));
}

// ---------------------------------------------------------------------------------------
// What the streaming mixer is handed

/// **Solo mutes the non-soloed, all the way through to the mixer.** Not "the lane is flagged" —
/// the clip list the block mixer plays no longer contains the other lane's audio.
#[test]
fn solo_removes_the_other_lanes_from_the_stream() {
    let mut editor = two_lane_editor();
    let mut resolve = |_id: &str| Some(pcm(0.5));

    let all = bay_core::stream_clips(editor.active_scene(), 0.0, &mut resolve);
    assert_eq!(all.len(), 2, "both lanes sound when nothing is soloed");

    editor.execute(Command::SetTrackSolo {
        track_id: "track-voice".into(),
        solo: true,
    });
    let soloed = bay_core::stream_clips(editor.active_scene(), 0.0, &mut resolve);
    assert_eq!(soloed.len(), 1, "only the soloed lane reaches the mixer");
    assert_eq!(
        bay_core::stream_media_ids(editor.active_scene(), 0.0),
        vec!["media-voice".to_string()],
        "…and the worker is not asked to decode the lane nobody will hear"
    );

    editor.undo();
    assert_eq!(
        bay_core::stream_clips(editor.active_scene(), 0.0, &mut resolve).len(),
        2,
        "un-soloing brings the rest back"
    );
}

/// The same silencing rule, but audible: the soloed lane's samples come out of the block mixer
/// and the other lane's do not.
#[test]
fn a_soloed_lane_is_the_only_thing_the_block_mixer_sounds() {
    use bay_audio::stream::BlockMixer;

    let mut editor = two_lane_editor();
    editor.execute(Command::SetVolume {
        reference: ElementRef::new("track-music", "music"),
        volume: 0.5,
    });
    editor.execute(Command::SetVolume {
        reference: ElementRef::new("track-voice", "voice"),
        volume: 0.25,
    });
    // Distinguishable sources, so the block says which lane it came from.
    let mut resolve = |id: &str| {
        Some(if id == "media-music" {
            pcm(1.0)
        } else {
            pcm(0.4)
        })
    };

    let mut mixer = BlockMixer::new(48_000, 64);
    mixer.set_clips(bay_core::stream_clips(
        editor.active_scene(),
        0.0,
        &mut resolve,
    ));
    let both = mixer.render_block()[0];
    assert!((both - (0.5 + 0.1)).abs() < 1e-6, "0.5 + 0.1, got {both}");

    editor.execute(Command::SetTrackSolo {
        track_id: "track-voice".into(),
        solo: true,
    });
    let mut mixer = BlockMixer::new(48_000, 64);
    mixer.set_clips(bay_core::stream_clips(
        editor.active_scene(),
        0.0,
        &mut resolve,
    ));
    let only_voice = mixer.render_block()[0];
    assert!(
        (only_voice - 0.1).abs() < 1e-6,
        "the music is gone from the actual samples, got {only_voice}"
    );
}

/// A lane's fader reaches the samples, and a lane muted reaches them by not being there.
#[test]
fn a_lane_fader_and_a_lane_mute_reach_the_stream() {
    use bay_audio::stream::BlockMixer;

    let mut editor = two_lane_editor();
    let mut resolve = |_id: &str| Some(pcm(1.0));

    editor.execute(Command::SetTrackVolume {
        track_id: "track-music".into(),
        gain: 0.25,
    });
    editor.execute(Command::SetTrackMuted {
        track_id: "track-voice".into(),
        muted: true,
    });

    let clips = bay_core::stream_clips(editor.active_scene(), 0.0, &mut resolve);
    assert_eq!(clips.len(), 1, "the muted lane is not in the mix");
    assert_eq!(clips[0].track_gain, 0.25);

    let mut mixer = BlockMixer::new(48_000, 64);
    mixer.set_clips(clips);
    assert!((mixer.render_block()[0] - 0.25).abs() < 1e-6);
}

/// A stream that starts at the playhead has its own zero, and a clip already sounding is placed
/// at that zero with its in-point advanced — so pressing play in the middle of a bed hears the
/// middle of the bed rather than its head.
#[test]
fn a_stream_started_mid_clip_picks_the_clip_up_where_it_was() {
    let editor = two_lane_editor();
    let mut resolve = |_id: &str| Some(pcm(1.0));

    let clips = bay_core::stream_clips(editor.active_scene(), 4.0, &mut resolve);
    assert_eq!(clips.len(), 2);
    for clip in &clips {
        assert_eq!(clip.start_secs, 0.0, "it is sounding already");
        assert!(
            (clip.source_start_secs - 4.0).abs() < 1e-9,
            "four seconds in"
        );
        assert!((clip.play_secs - 6.0).abs() < 1e-9, "six seconds left");
    }

    // …and a clip that has already finished is not in the stream at all.
    assert!(bay_core::stream_clips(editor.active_scene(), 11.0, &mut resolve).is_empty());
}

/// Clip pan and lane pan both reach the mixer, and they compose there in the pinned order.
#[test]
fn clip_pan_and_lane_pan_both_reach_the_stream() {
    use bay_audio::stream::BlockMixer;

    let mut editor = two_lane_editor();
    editor.execute(Command::SetTrackMuted {
        track_id: "track-voice".into(),
        muted: true,
    });
    editor.execute(Command::SetPan {
        reference: ElementRef::new("track-music", "music"),
        pan: 0.5,
    });
    editor.execute(Command::SetTrackPan {
        track_id: "track-music".into(),
        pan: 0.5,
    });

    let mut resolve = |_id: &str| Some(pcm(1.0));
    let clips = bay_core::stream_clips(editor.active_scene(), 0.0, &mut resolve);
    assert_eq!(clips.len(), 1);
    assert_eq!(
        clips[0].channel_gains(),
        [0.25, 1.0],
        "0.5 * 0.5 on the left"
    );

    let mut mixer = BlockMixer::new(48_000, 64);
    mixer.set_clips(clips);
    let block = mixer.render_block();
    assert!((block[0] - 0.25).abs() < 1e-6);
    assert!((block[1] - 1.0).abs() < 1e-6);
}
