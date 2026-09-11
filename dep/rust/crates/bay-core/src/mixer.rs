//! The timeline, translated for the streaming mixer.
//!
//! [`bay_audio::stream`] is pure DSP: it knows about decoded samples, gains and a ring buffer,
//! and nothing about tracks, solo or a project file. This is the one place the two meet — it
//! reads a [`Scene`] and produces the [`StreamClip`]s that describe what the mixer should be
//! playing.
//!
//! **It lives in `bay-core`, not in the UI**, for the reason every mixer decision does: solo is
//! not a checkbox, it is a rule about every other lane, and a rule that a headless caller
//! cannot reach is a rule that gets reimplemented — differently — the first time anything else
//! needs to play a timeline. The export path makes exactly the same three decisions through
//! [`bay_project::Track::mix_gain`], which is why a soloed lane sounds the same in the room and
//! in the file.

use std::sync::Arc;

use bay_audio::AudioPcm;
use bay_audio::stream::StreamClip;
use bay_project::{Element, Scene};

/// Build the clip list for a stream that starts at `playhead_seconds`.
///
/// `pcm_for` resolves a `media_id` to decoded samples, and is a callback rather than a decode so
/// that this function stays pure: a test drives it with synthetic PCM and no ffmpeg, and a
/// caller that has a cache uses the cache. Returning `None` drops the clip — a clip whose file
/// has not finished decoding is silent for now rather than a hole in the timeline forever.
///
/// Clip positions are relative to the **stream's** zero, which is the playhead: a bed that
/// started thirty seconds ago is placed at `0.0` with its in-point advanced, so pressing play
/// halfway through a fade hears the middle of the fade.
pub fn stream_clips(
    scene: &Scene,
    playhead_seconds: f64,
    pcm_for: &mut dyn FnMut(&str) -> Option<Arc<AudioPcm>>,
) -> Vec<StreamClip> {
    let playhead = playhead_seconds.max(0.0);
    let any_solo = scene.tracks.any_audio_solo();
    let mut clips = Vec::new();

    for track in &scene.tracks.audio {
        let track_gain = track.mix_gain(any_solo);
        if track_gain <= 0.0 {
            continue;
        }
        for element in &track.elements {
            let Some(audio) = element.audio() else {
                continue;
            };
            let start = element.start().to_seconds_f64();
            let end = element.end().to_seconds_f64();
            if audio.muted || audio.volume <= 0.0 || end <= playhead || end <= start {
                continue;
            }
            let Some(pcm) = pcm_for(&audio.media_id) else {
                continue;
            };
            // How far into this clip the playhead already is. Zero for a clip that has not
            // started yet, which is placed later on the stream's timeline instead.
            let into_clip = (playhead - start).max(0.0);
            clips.push(StreamClip {
                pcm,
                start_secs: (start - playhead).max(0.0),
                source_start_secs: audio.trim_start.to_seconds_f64().max(0.0) + into_clip,
                play_secs: end - start.max(playhead),
                volume: audio.volume,
                // The same polyline the export turns into a `volume` expression, taken from the
                // same model function — fades included, because unlike the export this mixer
                // applies them itself rather than through `afade`.
                gain_points: element.gain_points(),
                pan: audio.pan,
                track_gain,
                track_pan: track.pan,
            });
        }
    }
    clips
}

/// Every `media_id` a stream starting at `playhead_seconds` will want samples for.
///
/// For a caller that decodes before it plays: asking this first is how the mix worker avoids
/// discovering it needs a file in the middle of a block.
pub fn stream_media_ids(scene: &Scene, playhead_seconds: f64) -> Vec<String> {
    let playhead = playhead_seconds.max(0.0);
    let any_solo = scene.tracks.any_audio_solo();
    let mut ids: Vec<String> = Vec::new();
    for track in &scene.tracks.audio {
        if track.mix_gain(any_solo) <= 0.0 {
            continue;
        }
        for element in &track.elements {
            let Element::Audio(audio) = element else {
                continue;
            };
            if audio.muted || audio.volume <= 0.0 || element.end().to_seconds_f64() <= playhead {
                continue;
            }
            if !ids.contains(&audio.media_id) {
                ids.push(audio.media_id.clone());
            }
        }
    }
    ids
}
