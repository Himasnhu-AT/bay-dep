//! The streaming mixer, driven entirely by hand.
//!
//! **No device is opened anywhere in this file.** Blocks are pulled with
//! `BlockMixer::render_block` and the ring is drained with `StreamRenderer::render`, which is
//! the property that makes a fader, a pan, a solo and a meter assertable rather than auditionable
//! — and which keeps these tests from depending on whether the machine running them has a sound
//! card, a free port, or anything else it shares with the rest of the world.

use std::sync::Arc;

use bay_audio::stream::{BLOCK_FRAMES, BlockMixer, StreamClip, StreamEngine};
use bay_audio::{AudioPcm, composed_pan_gains, pan_gains};

const RATE: u32 = 48_000;

/// A stereo block of constant `amplitude` on both channels — DC, so every assertion below is
/// about gain and nothing else.
fn steady(amplitude: f32, seconds: f64) -> Arc<AudioPcm> {
    let frames = (seconds * f64::from(RATE)) as usize;
    Arc::new(AudioPcm {
        sample_rate: RATE,
        channels: 2,
        samples: (0..frames).flat_map(|_| [amplitude, amplitude]).collect(),
    })
}

/// The same signal, but with the two channels distinguishable, for the tests that have to prove
/// a per-channel gain landed on the right channel.
fn asymmetric(left: f32, right: f32, seconds: f64) -> Arc<AudioPcm> {
    let frames = (seconds * f64::from(RATE)) as usize;
    Arc::new(AudioPcm {
        sample_rate: RATE,
        channels: 2,
        samples: (0..frames).flat_map(|_| [left, right]).collect(),
    })
}

/// A 1 kHz sine at `left`/`right` amplitude.
///
/// The meter tests need a *tone*, not the steady DC the gain tests use: K-weighting's second
/// stage is a 38 Hz high pass, so it removes DC completely and an RMS meter fed DC correctly
/// reads silence.
fn sine(left: f32, right: f32, seconds: f64) -> Arc<AudioPcm> {
    let frames = (seconds * f64::from(RATE)) as usize;
    Arc::new(AudioPcm {
        sample_rate: RATE,
        channels: 2,
        samples: (0..frames)
            .flat_map(|index| {
                let t = index as f64 / f64::from(RATE);
                let value = (std::f64::consts::TAU * 1000.0 * t).sin() as f32;
                [left * value, right * value]
            })
            .collect(),
    })
}

fn clip(pcm: Arc<AudioPcm>) -> StreamClip {
    StreamClip {
        pcm,
        start_secs: 0.0,
        source_start_secs: 0.0,
        play_secs: 1.0,
        volume: 1.0,
        gain_points: Vec::new(),
        pan: 0.0,
        track_gain: 1.0,
        track_pan: 0.0,
    }
}

// ---------------------------------------------------------------------------------------
// Pulling blocks

/// The base case the whole milestone rests on: a mixer that produces the timeline in pieces,
/// with no device, no thread, and no callback. Everything else here is a variation on it.
#[test]
fn blocks_can_be_pulled_by_hand_with_no_device() {
    let mut mixer = BlockMixer::new(RATE, 512);
    mixer.set_clips(vec![StreamClip {
        volume: 0.5,
        play_secs: 1.0,
        ..clip(steady(1.0, 1.0))
    }]);

    let block = mixer.render_block().to_vec();
    assert_eq!(block.len(), 512 * 2, "one block, interleaved stereo");
    assert!(
        block.iter().all(|sample| (sample - 0.5).abs() < 1e-6),
        "a clip at half gain arrives at half gain: {:?}",
        &block[..4]
    );
    assert!((mixer.position_seconds() - 512.0 / f64::from(RATE)).abs() < 1e-9);

    // …and the next block is the next 512 frames, not the same 512 again.
    mixer.render_block();
    assert!((mixer.position_seconds() - 1024.0 / f64::from(RATE)).abs() < 1e-9);
}

/// Consecutive blocks are the timeline cut into pieces, not the timeline restarted. A clip that
/// stops a third of the way through a block has to stop *inside* it.
#[test]
fn a_clip_ends_inside_the_block_it_ends_in() {
    let mut mixer = BlockMixer::new(RATE, 512);
    // 600 frames of sound in a 512-frame block grid: the second block is sound for 88 frames
    // and silence for the rest.
    mixer.set_clips(vec![StreamClip {
        play_secs: 600.0 / f64::from(RATE),
        ..clip(steady(1.0, 1.0))
    }]);

    let first = mixer.render_block().to_vec();
    assert!(first.iter().all(|sample| (sample - 1.0).abs() < 1e-6));

    let second = mixer.render_block().to_vec();
    assert!(
        (second[87 * 2] - 1.0).abs() < 1e-6,
        "frame 599 still sounds"
    );
    assert_eq!(second[88 * 2], 0.0, "frame 600 does not");
    assert!(second[88 * 2..].iter().all(|sample| *sample == 0.0));
    assert!(mixer.is_finished());
}

/// Seeking moves the window, and a clip that starts later than the seek still starts where it
/// was put. Playback beginning halfway through a bed is the ordinary case, not the exception.
#[test]
fn seeking_moves_the_window_without_moving_the_clips() {
    let mut mixer = BlockMixer::new(RATE, 512);
    mixer.set_clips(vec![StreamClip {
        start_secs: 0.5,
        play_secs: 0.5,
        ..clip(steady(1.0, 2.0))
    }]);

    let silent = mixer.render_block().to_vec();
    assert!(
        silent.iter().all(|sample| *sample == 0.0),
        "before it starts"
    );

    mixer.seek_seconds(0.5);
    let sounding = mixer.render_block().to_vec();
    assert!(sounding.iter().all(|sample| (sample - 1.0).abs() < 1e-6));
}

/// The gain polyline is read against the clip's own head, so a stream that starts in the middle
/// of a fade hears the middle of the fade. This is the same `GainEnvelope` path the offline
/// mixer uses; if the block engine had grown its own, this is where they would part.
#[test]
fn a_moving_level_is_read_from_the_clips_own_head_not_the_streams() {
    let mut mixer = BlockMixer::new(RATE, 512);
    mixer.set_clips(vec![StreamClip {
        play_secs: 4.0,
        // Silent at the head, unity at 4 s: a straight ramp whose value at 2 s is 0.5.
        gain_points: vec![(0.0, 0.0), (4.0, 1.0)],
        ..clip(steady(1.0, 4.0))
    }]);

    mixer.seek_seconds(2.0);
    let block = mixer.render_block().to_vec();
    assert!(
        (block[0] - 0.5).abs() < 1e-3,
        "halfway up a four-second ramp is half gain, got {}",
        block[0]
    );
    // …and it is still climbing across the block rather than being held at a step.
    assert!(block[block.len() - 2] > block[0]);
}

/// Two clips over each other sum, and the sum is clamped rather than wrapping — the render path
/// is not allowed to produce something worse than loud when given too much.
#[test]
fn overlapping_clips_sum_and_clamp() {
    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![
        StreamClip {
            volume: 0.3,
            ..clip(steady(1.0, 1.0))
        },
        StreamClip {
            volume: 0.4,
            ..clip(steady(1.0, 1.0))
        },
    ]);
    let block = mixer.render_block().to_vec();
    assert!((block[0] - 0.7).abs() < 1e-6, "{}", block[0]);

    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![
        StreamClip {
            volume: 1.0,
            ..clip(steady(1.0, 1.0))
        },
        StreamClip {
            volume: 1.0,
            ..clip(steady(1.0, 1.0))
        },
    ]);
    let block = mixer.render_block().to_vec();
    assert!(block.iter().all(|sample| *sample <= 1.0));
}

/// Non-finite input reaches the mixer from a decode that went wrong and from a pan nobody
/// validated. It must not be able to destroy a block or the meter.
#[test]
fn the_block_mixer_survives_nonsense() {
    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![StreamClip {
        pan: f32::NAN,
        track_gain: f32::INFINITY,
        ..clip(steady(0.5, 1.0))
    }]);
    let block = mixer.render_block().to_vec();
    assert!(
        block.iter().all(|sample| sample.is_finite()),
        "a NaN pan and an infinite fader must not reach the device"
    );
    let levels = mixer.meter().read();
    assert!(levels.peak.iter().all(|p| p.is_finite()));
    assert!(levels.rms.iter().all(|r| r.is_finite()));
}

// ---------------------------------------------------------------------------------------
// Pan

/// The law itself, at the three positions everything else is interpolated between.
#[test]
fn pan_produces_the_expected_per_channel_gains() {
    assert_eq!(pan_gains(0.0), [1.0, 1.0], "centre is a no-op");
    assert_eq!(pan_gains(-1.0), [1.0, 0.0], "hard left silences the right");
    assert_eq!(pan_gains(1.0), [0.0, 1.0], "hard right silences the left");
    assert_eq!(pan_gains(0.5), [0.5, 1.0]);
    assert_eq!(pan_gains(-0.25), [1.0, 0.75]);
    // Out of range is clamped, not wrapped, and nonsense is centre.
    assert_eq!(pan_gains(4.0), [0.0, 1.0]);
    assert_eq!(pan_gains(f32::NAN), [1.0, 1.0]);
    // No position anywhere adds gain — the reason this is a balance and not constant power.
    for step in -100..=100 {
        let gains = pan_gains(step as f32 / 100.0);
        assert!(gains[0] <= 1.0 && gains[1] <= 1.0);
        assert!(gains[0] >= 0.0 && gains[1] >= 0.0);
    }
}

/// And the same numbers coming out of the mixer, on a signal whose two channels are told apart.
#[test]
fn a_panned_clip_is_mixed_at_the_expected_per_channel_gains() {
    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![StreamClip {
        pan: 0.5,
        ..clip(asymmetric(1.0, 1.0, 1.0))
    }]);
    let block = mixer.render_block().to_vec();
    assert!(
        (block[0] - 0.5).abs() < 1e-6,
        "left attenuated: {}",
        block[0]
    );
    assert!(
        (block[1] - 1.0).abs() < 1e-6,
        "right untouched: {}",
        block[1]
    );

    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![StreamClip {
        pan: -1.0,
        ..clip(asymmetric(0.8, 0.8, 1.0))
    }]);
    let block = mixer.render_block().to_vec();
    assert!((block[0] - 0.8).abs() < 1e-6);
    assert_eq!(block[1], 0.0, "hard left means nothing on the right");
}

/// A clip at centre must be **bit-identical** to the same clip before pan existed. Any law with
/// a centre other than unity would have silently re-levelled every project already saved.
#[test]
fn centre_pan_changes_nothing_at_all() {
    let mut with_pan = BlockMixer::new(RATE, 128);
    with_pan.set_clips(vec![StreamClip {
        pan: 0.0,
        track_pan: 0.0,
        volume: 0.37,
        ..clip(asymmetric(0.6, -0.2, 1.0))
    }]);
    let panned = with_pan.render_block().to_vec();

    let mut plain = BlockMixer::new(RATE, 128);
    plain.set_clips(vec![StreamClip {
        volume: 0.37,
        ..clip(asymmetric(0.6, -0.2, 1.0))
    }]);
    assert_eq!(panned, plain.render_block());
}

/// **The composition order, pinned.** Clip pan first, then the lane's pan, then the lane's
/// fader — multiplied per channel, because each is a gain stage. The export filtergraph
/// composes them the same way (`bay-preview`'s `pan_filter` test asserts the same numbers).
#[test]
fn clip_pan_and_track_pan_compose_by_multiplying() {
    assert_eq!(composed_pan_gains(0.5, 0.0), [0.5, 1.0], "lane centred");
    assert_eq!(composed_pan_gains(0.0, 0.5), [0.5, 1.0], "clip centred");
    assert_eq!(
        composed_pan_gains(0.5, 0.5),
        [0.25, 1.0],
        "both, multiplied"
    );
    assert_eq!(
        composed_pan_gains(-1.0, 1.0),
        [0.0, 0.0],
        "a hard-left clip on a hard-right lane is silent — two balance controls in series"
    );

    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![StreamClip {
        pan: 0.5,
        track_pan: 0.5,
        track_gain: 0.5,
        ..clip(asymmetric(1.0, 1.0, 1.0))
    }]);
    let block = mixer.render_block().to_vec();
    assert!(
        (block[0] - 0.125).abs() < 1e-6,
        "0.5 * 0.5 * 0.5: {}",
        block[0]
    );
    assert!((block[1] - 0.5).abs() < 1e-6, "1 * 1 * 0.5: {}", block[1]);
}

// ---------------------------------------------------------------------------------------
// Track gain and solo, as the mixer sees them

/// A lane's fader is a second gain stage on top of the clip's, not a rewrite of it.
#[test]
fn a_track_fader_multiplies_the_clips_own_level() {
    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![StreamClip {
        volume: 0.5,
        track_gain: 0.5,
        ..clip(steady(1.0, 1.0))
    }]);
    let block = mixer.render_block().to_vec();
    assert!((block[0] - 0.25).abs() < 1e-6, "{}", block[0]);
}

/// Silencing a lane is a `track_gain` of zero, and it has to be exactly zero — a lane you
/// muted that is 60 dB down is still on the mix bus.
#[test]
fn a_silenced_lane_contributes_exactly_nothing() {
    let mut mixer = BlockMixer::new(RATE, 64);
    mixer.set_clips(vec![
        StreamClip {
            track_gain: 0.0,
            ..clip(steady(1.0, 1.0))
        },
        StreamClip {
            volume: 0.25,
            ..clip(steady(1.0, 1.0))
        },
    ]);
    let block = mixer.render_block().to_vec();
    assert!(
        block.iter().all(|sample| (sample - 0.25).abs() < 1e-6),
        "only the audible lane is heard: {}",
        block[0]
    );
}

// ---------------------------------------------------------------------------------------
// Metering

/// A meter that does not move on audio is decoration. Peak and RMS both have to track the
/// level, and silence has to read as silence rather than as the last loud thing.
#[test]
fn the_meter_reads_the_block_it_just_mixed() {
    let mut mixer = BlockMixer::new(RATE, 4800);
    let meter = mixer.meter();
    assert_eq!(meter.read().peak, [0.0, 0.0], "nothing mixed yet");

    mixer.set_clips(vec![StreamClip {
        play_secs: 10.0,
        ..clip(sine(0.5, 0.25, 10.0))
    }]);
    mixer.render_block();
    let levels = meter.read();
    assert!((levels.peak[0] - 0.5).abs() < 1e-3, "{levels:?}");
    assert!((levels.peak[1] - 0.25).abs() < 1e-3, "{levels:?}");
    assert!(
        levels.peak_db()[0] > levels.peak_db()[1],
        "the louder channel reads louder"
    );

    // Twice the amplitude is 6 dB more, on both meters.
    let quiet = meter.read();
    mixer.set_clips(vec![StreamClip {
        play_secs: 10.0,
        ..clip(sine(1.0, 0.5, 10.0))
    }]);
    mixer.render_block();
    let loud = meter.read();
    assert!(
        (loud.peak_db()[0] - quiet.peak_db()[0] - 6.02).abs() < 0.1,
        "{quiet:?} then {loud:?}"
    );
    assert!(
        (loud.rms_db()[0] - quiet.rms_db()[0] - 6.02).abs() < 0.2,
        "{quiet:?} then {loud:?}"
    );
}

/// The RMS side is K-weighted, which is what makes it comparable with every other level bay
/// reasons about. The test for that is BS.1770's own calibration: at 1 kHz the weighting's gain
/// and the standard's offset cancel, so a 1 kHz tone's momentary LUFS is its plain RMS in dBFS.
#[test]
fn the_rms_meter_is_k_weighted_on_the_same_scale_as_the_loudness_measurement() {
    let seconds = 1.0;
    let pcm = sine(0.5, 0.5, seconds);

    let mut mixer = BlockMixer::new(RATE, 24_000);
    mixer.set_clips(vec![StreamClip {
        play_secs: seconds,
        ..clip(Arc::clone(&pcm))
    }]);
    // Two blocks: the first lets the filters settle, the second is measured.
    mixer.render_block();
    mixer.render_block();
    let levels = mixer.meter().read();

    let offline = bay_audio::loudness::measure(&pcm);
    assert!(
        (levels.lufs() - offline.lufs).abs() < 0.3,
        "the streaming meter and the offline measurement must agree about a 1 kHz tone: \
         {} vs {}",
        levels.lufs(),
        offline.lufs
    );
    // A sine at 0.5 has an RMS of 0.354, which is −9.03 dBFS. The per-channel `rms_db` is the
    // **weighted** level, and at 1 kHz K-weighting's shelf is +0.691 dB — exactly the constant
    // BS.1770's offset then removes on the way to LUFS. So the meter reads −8.34, and the LUFS
    // above lands back on the offline measurement. Asserting −9.03 here would be asserting that
    // the offset had been applied twice.
    assert!(
        (levels.rms_db()[0] - 0.691 - (-9.03)).abs() < 0.3,
        "{:?}",
        levels.rms_db()
    );
}

/// A peak inside one 10 ms block has to survive long enough for a UI redrawing at 60 Hz to see
/// it, and then fall. Without the hold the meter under-reads every transient; without the
/// release it never comes back down.
#[test]
fn a_transient_is_held_and_then_released() {
    let mut mixer = BlockMixer::new(RATE, 512);
    mixer.set_clips(vec![StreamClip {
        // One block of full scale, then nothing.
        play_secs: 512.0 / f64::from(RATE),
        ..clip(steady(1.0, 1.0))
    }]);
    mixer.render_block();
    let hit = mixer.meter().read().peak[0];
    assert!((hit - 1.0).abs() < 1e-4);

    mixer.render_block();
    let after = mixer.meter().read().peak[0];
    assert!(after < hit, "it releases: {after} vs {hit}");
    assert!(
        after > 0.9,
        "…but not so fast that a 60 Hz redraw misses it: {after}"
    );

    for _ in 0..200 {
        mixer.render_block();
    }
    assert!(
        mixer.meter().read().peak[0] < 0.01,
        "and silence eventually reads as silence"
    );
}

// ---------------------------------------------------------------------------------------
// The engine end to end

/// The whole path, still with no device: the worker pumps blocks into the ring, and the
/// callback pulls them out and gets exactly what was mixed.
#[test]
fn the_engine_delivers_what_the_mixer_rendered() {
    let (mut engine, mut renderer) = StreamEngine::with_defaults(RATE);
    engine.mixer_mut().set_clips(vec![StreamClip {
        volume: 0.5,
        play_secs: 5.0,
        ..clip(steady(1.0, 5.0))
    }]);

    assert!(engine.pump() > 0, "the worker fills the ring");
    let mut out = vec![0.0f32; BLOCK_FRAMES * 2];
    assert_eq!(renderer.render(&mut out), out.len());
    assert!(out.iter().all(|sample| (sample - 0.5).abs() < 1e-6));
    assert_eq!(renderer.underruns(), 0, "a pumped ring does not starve");

    // Drain and refill a few times, the way a device callback and a worker take turns.
    for _ in 0..8 {
        engine.pump();
        assert_eq!(renderer.render(&mut out), out.len());
        assert!(out.iter().all(|sample| (sample - 0.5).abs() < 1e-6));
    }
    assert_eq!(renderer.underruns(), 0);
}

/// A callback that runs while the worker is behind gets silence and says so, rather than
/// blocking — the one thing a real-time callback may never do.
#[test]
fn an_unfed_callback_returns_silence_and_counts_it() {
    let (_engine, mut renderer) = StreamEngine::with_defaults(RATE);
    let mut out = vec![1.0f32; BLOCK_FRAMES * 2];
    assert_eq!(renderer.render(&mut out), 0);
    assert!(out.iter().all(|sample| *sample == 0.0));
    assert_eq!(renderer.underruns(), 1);
}

/// The worker really can live on another thread: nothing in the ring needs a lock, and the
/// samples arrive in order across the boundary. Uses only threads it creates itself — no port,
/// no device, nothing shared with anything else on the machine.
#[test]
fn the_worker_can_run_on_its_own_thread() {
    let (mut engine, mut renderer) = StreamEngine::with_defaults(RATE);
    engine.mixer_mut().set_clips(vec![StreamClip {
        volume: 0.25,
        play_secs: 2.0,
        ..clip(steady(1.0, 2.0))
    }]);

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let worker = std::thread::spawn(move || {
        while !worker_stop.load(std::sync::atomic::Ordering::Relaxed) {
            if engine.pump() == 0 {
                std::thread::yield_now();
            }
        }
    });

    let mut out = vec![0.0f32; BLOCK_FRAMES * 2];
    let mut pulled = 0;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while pulled < 32 && std::time::Instant::now() < deadline {
        if renderer.render(&mut out) == out.len() {
            assert!(
                out.iter().all(|sample| (sample - 0.25).abs() < 1e-6),
                "what crossed the thread boundary is what was mixed"
            );
            pulled += 1;
        } else {
            std::thread::yield_now();
        }
    }
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    worker.join().expect("the worker exits when told to");
    assert_eq!(pulled, 32, "the worker kept the callback fed");
}
