//! `mix_stereo` sums overlapping clips, places them by offset, and clamps — no device needed.

use bay_audio::{AudioPcm, MixClip, mix_stereo};

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
        envelope: None,
    }];
    let mixed = mix_stereo(&clips, 1000, 2.0);
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
            envelope: None,
        },
        // b starts half a second in — the first 0.5s is a alone, then a+b overlap.
        MixClip {
            pcm: &b,
            src_start_secs: 0.0,
            dst_start_secs: 0.5,
            play_secs: 1.0,
            volume: 1.0,
            envelope: None,
        },
    ];
    let mixed = mix_stereo(&clips, 1000, 2.0);
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
            envelope: None,
        },
        MixClip {
            pcm: &loud,
            src_start_secs: 0.0,
            dst_start_secs: 0.0,
            play_secs: 1.0,
            volume: 1.0,
            envelope: None,
        },
    ];
    let mixed = mix_stereo(&clips, 1000, 1.0);
    assert!(
        mixed.iter().all(|s| (-1.0..=1.0).contains(s)),
        "clamped to [-1, 1]"
    );
    assert!((mixed[0] - 1.0).abs() < 1e-6, "0.9 + 0.9 clamps to 1.0");
}

/// A fade has to be a ramp in the samples, not a step at the clip boundary — and it has to be
/// read against the clip's own timeline, so starting playback halfway through a fade hears the
/// middle of it.
#[test]
fn an_envelope_ramps_the_samples() {
    let pcm = AudioPcm {
        sample_rate: 100,
        channels: 1,
        samples: vec![1.0; 200], // 2 seconds of full-scale
    };
    let mixed = mix_stereo(
        &[MixClip {
            pcm: &pcm,
            src_start_secs: 0.0,
            dst_start_secs: 0.0,
            play_secs: 2.0,
            volume: 1.0,
            envelope: Some(bay_audio::GainEnvelope {
                clip_offset_secs: 0.0,
                points: vec![(0.0, 0.0), (2.0, 1.0)],
            }),
        }],
        100,
        2.0,
    );
    assert!(mixed[0].abs() < 1e-6, "silent at the head of the fade");
    let middle = mixed[100 * 2]; // 1s in, stereo interleaved
    assert!((middle - 0.5).abs() < 0.02, "halfway up, got {middle}");
    let end = mixed[mixed.len() - 2];
    assert!(end > 0.95, "full by the end, got {end}");
}

/// Playback starting mid-fade must pick the fade up where it is, not restart it.
#[test]
fn an_envelope_is_read_against_the_clip_not_the_mix() {
    let pcm = AudioPcm {
        sample_rate: 100,
        channels: 1,
        samples: vec![1.0; 200],
    };
    let mixed = mix_stereo(
        &[MixClip {
            pcm: &pcm,
            src_start_secs: 1.0,
            dst_start_secs: 0.0,
            play_secs: 1.0,
            volume: 1.0,
            envelope: Some(bay_audio::GainEnvelope {
                // The transport started 1s into a 2s fade.
                clip_offset_secs: 1.0,
                points: vec![(0.0, 0.0), (2.0, 1.0)],
            }),
        }],
        100,
        1.0,
    );
    assert!(
        (mixed[0] - 0.5).abs() < 0.02,
        "the first sample is halfway up the fade, got {}",
        mixed[0]
    );
}

/// No envelope is a flat gain — every caller that had one before must be unaffected.
#[test]
fn no_envelope_is_a_flat_gain() {
    let pcm = AudioPcm {
        sample_rate: 100,
        channels: 1,
        samples: vec![1.0; 100],
    };
    let mixed = mix_stereo(
        &[MixClip {
            pcm: &pcm,
            src_start_secs: 0.0,
            dst_start_secs: 0.0,
            play_secs: 1.0,
            volume: 0.25,
            envelope: None,
        }],
        100,
        1.0,
    );
    assert!(mixed.iter().all(|s| (s - 0.25).abs() < 1e-6));
}
