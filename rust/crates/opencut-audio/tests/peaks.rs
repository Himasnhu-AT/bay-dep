//! Extracting peaks from a generated sine tone yields the requested count with real amplitude.

#[test]
fn extracts_peaks_from_a_sine_tone() {
    // Generate a 1s sine WAV via ffmpeg; skip if ffmpeg is unavailable.
    let path = std::env::temp_dir().join(format!("vii-test-tone-{}.wav", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=1", path.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !generated {
        eprintln!("skipping: ffmpeg unavailable");
        return;
    }

    let peaks = opencut_audio::waveform_peaks(path.to_str().unwrap(), 64)
        .expect("peaks from a valid tone");
    assert_eq!(peaks.len(), 64);
    assert!(peaks.iter().any(|&p| p > 0.1), "a sine tone should have real amplitude");
    assert!(peaks.iter().all(|&p| (0.0..=1.0).contains(&p)));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn decodes_pcm_from_a_sine_tone() {
    let path = std::env::temp_dir().join(format!("vii-test-pcm-{}.wav", std::process::id()));
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=1", path.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !generated {
        eprintln!("skipping: ffmpeg unavailable");
        return;
    }
    let pcm = opencut_audio::decode_pcm(path.to_str().unwrap(), 44_100).expect("pcm");
    assert_eq!(pcm.sample_rate, 44_100);
    assert_eq!(pcm.channels, 2);
    // ~1s stereo at 44.1k ≈ 88k samples; allow slack.
    assert!(pcm.samples.len() > 44_100, "got {}", pcm.samples.len());
    let _ = std::fs::remove_file(&path);
}
