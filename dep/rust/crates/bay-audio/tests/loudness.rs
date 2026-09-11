//! The in-process measurement against ffmpeg's, on the same bytes.
//!
//! **Why this test is the point of the module.** `bay_audio::loudness::measure` exists so a
//! synthesised sound arrives on the timeline with a level, on a machine that may have no ffmpeg
//! at all. But the mix compares that level against beds and voices whose levels came from
//! `ebur128`/`volumedetect`. A second implementation that disagreed by a couple of LU would not
//! fail anything — it would quietly mis-place every sound effect in the envelope, which is the
//! failure this whole area already had once.
//!
//! So: render each effect, encode the WAV bay would actually write, measure it both ways, and
//! hold them together. Without ffmpeg this skips (and fails under `BAY_REQUIRE_FFMPEG`), which
//! is exactly the machine the in-process path was written for.

use bay_audio::loudness::{self, Loudness};
use bay_audio::sfx::{self, Sfx, SfxParams};

/// Run ffmpeg's own measurement over a file, returning `(integrated LUFS, mean dBFS, peak dBFS)`.
///
/// The same filter chain `bay_preview::probe::probe_loudness` runs. Parsed here rather than
/// reached for across the crate graph: bay-audio sits below bay-preview, and a test is not a
/// reason to invert that.
fn ffmpeg_measures(path: &std::path::Path) -> Option<(f32, f32, f32)> {
    let output = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
        .ok()?
        .args(["-nostdin", "-hide_banner", "-i"])
        .arg(path)
        .args(["-af", "ebur128=peak=true,volumedetect", "-f", "null", "-"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stderr).to_string();

    let mut section = "";
    let mut integrated = None;
    let mut mean = None;
    let mut peak = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Integrated loudness") {
            section = "integrated";
        } else if trimmed.starts_with("Loudness range") {
            section = "range";
        }
        if section == "integrated" && trimmed.starts_with("I:") {
            integrated = number_after(trimmed, "I:");
        }
        if trimmed.contains("mean_volume:") {
            mean = number_after(trimmed, "mean_volume:");
        }
        if trimmed.contains("max_volume:") {
            peak = number_after(trimmed, "max_volume:");
        }
    }
    Some((integrated?, mean?, peak?))
}

fn number_after(line: &str, key: &str) -> Option<f32> {
    let rest = line.split(key).nth(1)?.trim_start();
    let token: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-' || *c == '+' || *c == '.')
        .collect();
    token.parse().ok().filter(|value: &f32| value.is_finite())
}

fn render_to_disk(effect: &Sfx, seconds: f64) -> (Loudness, std::path::PathBuf) {
    let pcm = effect.render(SfxParams {
        seconds,
        ..SfxParams::default()
    });
    let measured = loudness::measure(&pcm);
    let path = std::env::temp_dir().join(format!(
        "bay-loudness-{}-{}.wav",
        effect.id,
        std::process::id()
    ));
    std::fs::write(&path, sfx::encode_wav(&pcm)).expect("write the wav");
    (measured, path)
}

/// Every effect, at a length long enough for R128 to integrate, measured both ways.
///
/// A tenth of a LU on the loudness and on the peak. The two paths see the same signal to within
/// 16-bit quantisation, so anything looser would be hiding a real difference in the filters.
#[test]
fn the_in_process_measurement_agrees_with_ffmpeg() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    for effect in sfx::EFFECTS {
        let (ours, path) = render_to_disk(effect, 3.0);
        let Some((lufs, mean, peak)) = ffmpeg_measures(&path) else {
            panic!("ffmpeg could not measure {}", path.display());
        };
        let _ = std::fs::remove_file(&path);

        eprintln!(
            "{:16} bay {:7.2} LUFS / ffmpeg {lufs:7.2}   mean {:7.2} / {mean:7.2}   peak {:6.2} / {peak:6.2}",
            effect.id, ours.lufs, ours.rms_db, ours.peak_db
        );
        assert!(
            (ours.lufs - lufs).abs() <= 0.1,
            "{}: bay measures {:.2} LUFS, ffmpeg {lufs:.2}",
            effect.id,
            ours.lufs
        );
        assert!(
            (ours.rms_db - mean).abs() <= 0.1,
            "{}: bay measures a mean of {:.2} dBFS, ffmpeg {mean:.2}",
            effect.id,
            ours.rms_db
        );
        // ffmpeg prints the sample peak to a tenth, and `volumedetect` histograms it, so this
        // is the coarsest of the three.
        assert!(
            (ours.peak_db - peak).abs() <= 0.2,
            "{}: bay measures a peak of {:.2} dBFS, ffmpeg {peak:.2}",
            effect.id,
            ours.peak_db
        );
    }
}

/// The short sounds — a click is 60 ms — are the case the two paths could most easily disagree
/// on, because R128 has no complete gating block to work from. Both must report the floor, and
/// the mean must still be a real level: `AssetLoudness::level_lufs` falls back to the mean
/// precisely here, and a click that reported silence would be placed as if it were inaudible.
#[test]
fn a_click_reports_the_floor_the_same_way_ffmpeg_does() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    for id in ["click", "tick", "pop"] {
        let effect = Sfx::by_id(id).expect("a known effect");
        let (ours, path) = render_to_disk(effect, effect.default_seconds);
        let Some((lufs, mean, _)) = ffmpeg_measures(&path) else {
            panic!("ffmpeg could not measure {}", path.display());
        };
        let _ = std::fs::remove_file(&path);

        assert!(
            !ours.is_audible(),
            "{id} is shorter than a gating block: {ours:?}"
        );
        assert_eq!(
            ours.lufs,
            loudness::R128_FLOOR_LUFS,
            "{id}: bay {:.1}, ffmpeg {lufs:.1}",
            ours.lufs
        );
        assert!(lufs <= loudness::R128_FLOOR_LUFS, "{id}: ffmpeg {lufs:.1}");
        assert!(
            (ours.rms_db - mean).abs() <= 0.1,
            "{id}: bay's mean {:.2} dBFS, ffmpeg's {mean:.2}",
            ours.rms_db
        );
        assert!(
            ours.rms_db > -40.0,
            "{id} is audible even though R128 cannot integrate it: {ours:?}"
        );
    }
}

/// The reader, across the widths a WAV can be written at, against ffmpeg on the same file.
///
/// bay writes 16-bit mono, so that path is covered by the tests above. This one exists for the
/// files bay *reads*: Kokoro's narration, the bundled sound library, and anything a person
/// imported. A width read wrongly does not fail — it produces a plausible level that is wrong by
/// a constant, which is the one outcome worse than not measuring at all.
#[test]
fn the_wav_reader_measures_what_ffmpeg_measures() {
    if !bay_test_support::require_ffmpeg() {
        return;
    }
    // (codec, channels) — 8-bit is left out: quantising a −20 dBFS tone to 256 steps moves the
    // level by more than the tolerance here, and nothing bay reads is 8-bit.
    for (codec, channels) in [
        ("pcm_s16le", 1),
        ("pcm_s24le", 1),
        ("pcm_s32le", 1),
        ("pcm_f32le", 1),
        ("pcm_s16le", 2),
        ("pcm_f32le", 2),
    ] {
        let path = std::env::temp_dir().join(format!(
            "bay-wav-{codec}-{channels}-{}.wav",
            std::process::id()
        ));
        let made = bay_paths::tools::command(bay_paths::tools::Tool::Ffmpeg)
            .map(|mut command| {
                command
                    .args([
                        "-nostdin",
                        "-hide_banner",
                        "-v",
                        "error",
                        "-y",
                        "-f",
                        "lavfi",
                        "-i",
                        "sine=frequency=440:duration=3:sample_rate=48000",
                        "-af",
                        "volume=0.3",
                        "-ac",
                        &channels.to_string(),
                        "-c:a",
                        codec,
                    ])
                    .arg(&path)
                    .status()
                    .map(|status| status.success())
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if !bay_test_support::require_ffmpeg_step(made, "synthesise a wav fixture") {
            return;
        }

        let pcm = bay_audio::wav::read(&path).expect("bay reads the wav it was handed");
        assert_eq!(pcm.sample_rate, 48_000, "{codec} {channels}ch");
        assert_eq!(pcm.channels, channels as u16, "{codec} {channels}ch");
        let ours = loudness::measure(&pcm);
        let Some((lufs, mean, peak)) = ffmpeg_measures(&path) else {
            panic!("ffmpeg could not measure {}", path.display());
        };
        let _ = std::fs::remove_file(&path);

        assert!(
            (ours.lufs - lufs).abs() <= 0.1,
            "{codec} {channels}ch: bay {:.2} LUFS, ffmpeg {lufs:.2}",
            ours.lufs
        );
        assert!(
            (ours.rms_db - mean).abs() <= 0.1,
            "{codec} {channels}ch: bay's mean {:.2} dBFS, ffmpeg's {mean:.2}",
            ours.rms_db
        );
        assert!(
            (ours.peak_db - peak).abs() <= 0.2,
            "{codec} {channels}ch: bay's peak {:.2} dBFS, ffmpeg's {peak:.2}",
            ours.peak_db
        );
    }
}

#[test]
fn capability_report() {
    eprintln!("{}", bay_test_support::capability_report());
}
