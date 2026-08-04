//! `mix_stereo` sums overlapping clips, places them by offset, and clamps — no device needed.

use opencut_audio::{AudioPcm, MixClip};

/// A constant-amplitude stereo tone of `secs` at `rate` (both channels = `level`).
fn tone(rate: u32, secs: f64, level: f32) -> AudioPcm {
    let frames = (secs * rate as f64) as usize;
    AudioPcm {
        sample_rate: rate,
        channels: 2,
        samples: vec![level; frames * 2],
    }
}

#[test]
fn mixes_to_the_requested_length() {
    let a = tone(1000, 1.0, 0.5);
    let clips = [MixClip {
        pcm: &a,
        src_start_secs: 0.0,
        dst_start_secs: 0.0,
        play_secs: 1.0,
        volume: 1.0,
    }];
    let mixed = opencut_audio::mix_stereo(&clips, 1000, 2.0);
    assert_eq!(mixed.len(), 1000 * 2 * 2, "2s stereo at 1kHz");
    // First second carries the clip; the tail past play_secs stays silent.
    assert!((mixed[0] - 0.5).abs() < 1e-6);
    assert_eq!(mixed[1000 * 2 + 10], 0.0);
}

#[test]
fn overlapping_clips_sum_and_offset_places_audio() {
    let a = tone(1000, 1.0, 0.3);
    let b = tone(1000, 1.0, 0.3);
    let clips = [
        MixClip {
            pcm: &a,
            src_start_secs: 0.0,
            dst_start_secs: 0.0,
            play_secs: 1.0,
            volume: 1.0,
        },
        // b starts half a second in — the first 0.5s is a alone, then a+b overlap.
        MixClip {
            pcm: &b,
            src_start_secs: 0.0,
            dst_start_secs: 0.5,
            play_secs: 1.0,
            volume: 1.0,
        },
    ];
    let mixed = opencut_audio::mix_stereo(&clips, 1000, 2.0);
    assert!((mixed[0] - 0.3).abs() < 1e-6, "only a plays at t=0");
    // At t≈0.6s both play → summed 0.6.
    let idx = (600 * 2) as usize;
    assert!((mixed[idx] - 0.6).abs() < 1e-6, "a+b sum in the overlap");
}

#[test]
fn sums_are_soft_clamped() {
    let loud = tone(1000, 1.0, 0.9);
    let clips = [
        MixClip {
            pcm: &loud,
            src_start_secs: 0.0,
            dst_start_secs: 0.0,
            play_secs: 1.0,
            volume: 1.0,
        },
        MixClip {
            pcm: &loud,
            src_start_secs: 0.0,
            dst_start_secs: 0.0,
            play_secs: 1.0,
            volume: 1.0,
        },
    ];
    let mixed = opencut_audio::mix_stereo(&clips, 1000, 1.0);
    assert!(
        mixed.iter().all(|s| (-1.0..=1.0).contains(s)),
        "clamped to [-1, 1]"
    );
    assert!((mixed[0] - 1.0).abs() < 1e-6, "0.9 + 0.9 clamps to 1.0");
}
