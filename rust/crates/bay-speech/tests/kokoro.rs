//! Integration tests against the real Kokoro sidecar.
//!
//! These need a Python interpreter with `kokoro` installed. Where that is absent they SKIP
//! rather than fail — the same capability gate the GPU and ffmpeg tests use, so a CI box
//! without a 2 GB torch stack still reports green honestly.

use std::time::Duration;

use bay_speech::{CueStyle, SpeechConfig, SpeechEngine};

/// Only one sidecar may be up at a time: the port is fixed by design, so that a stale child
/// from an earlier run is detectable rather than invisible. Tests therefore take this lock and
/// use a port of their own, which models the product (one editor, one engine) instead of
/// racing several engines onto the same port.
static SIDECAR: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The port a test actually gets.
///
/// It asks for a fixed one, because a stable number is what makes a stale child visible in
/// `lsof`. But a TCP port is a *machine-wide* resource, and this lock is only per-process: a
/// second copy of the suite — or a sidecar left over from an earlier run — holding that number
/// used to fail the run with `PortBusy`, which is a failure for a reason outside this
/// repository, and those teach people to re-run until green. So an occupied port is said out
/// loud and stepped around, never failed on.
fn port_for(preferred: u16) -> u16 {
    let occupied = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], preferred)),
        Duration::from_millis(250),
    )
    .is_ok();
    if !occupied {
        return preferred;
    }
    let leased = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .expect("the OS should lease a loopback port");
    eprintln!(
        "port {preferred} is already held; this test will use {leased}. If no second copy of \
         this suite is running, a sidecar from an earlier run is still up on {preferred}."
    );
    leased
}

fn engine_on(port: u16) -> Option<(SpeechEngine, std::sync::MutexGuard<'static, ()>)> {
    let guard = SIDECAR.lock().unwrap_or_else(|error| error.into_inner());
    let config = SpeechConfig {
        port: port_for(port),
        ..SpeechConfig::default()
    };
    let engine = SpeechEngine::new(config);
    if !engine.is_installed() {
        eprintln!(
            "skipping: no Kokoro at {} — see docs/native/speech.md",
            engine.config().python
        );
        return None;
    }
    Some((engine, guard))
}

fn tmp(name: &str) -> String {
    let dir = std::env::temp_dir().join("bay-speech-tests");
    let _ = std::fs::create_dir_all(&dir);
    dir.join(name).to_string_lossy().to_string()
}

#[test]
fn speaks_a_line_and_reports_word_timings() {
    let Some((mut engine, _sidecar)) = engine_on(7431) else {
        return;
    };
    let out = tmp("line.wav");
    let _ = std::fs::remove_file(&out);

    let utterance = engine
        .speak(
            "Averages add, but money compounds.",
            "af_heart",
            1.0,
            "a",
            &out,
        )
        .expect("Kokoro should synthesize a short line");

    assert!(
        std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) > 1000,
        "the WAV should actually contain audio"
    );
    assert!(
        utterance.duration_seconds > 0.5 && utterance.duration_seconds < 15.0,
        "implausible duration {}s",
        utterance.duration_seconds
    );
    assert_eq!(utterance.sample_rate, 24_000);

    // The point of using Kokoro rather than any TTS: real per-word timings.
    assert!(
        utterance.words.len() >= 4,
        "expected a timing per word, got {:?}",
        utterance.words
    );
    assert!(
        utterance.words.iter().all(|w| w.end > w.start),
        "every word must occupy real time: {:?}",
        utterance.words
    );
    assert!(
        utterance
            .words
            .windows(2)
            .all(|pair| pair[1].start >= pair[0].start - 1e-6),
        "word timings must be in order: {:?}",
        utterance.words
    );
    let last = utterance.words.last().expect("at least one word");
    assert!(
        last.end <= utterance.duration_seconds + 0.25,
        "a word ends after the audio does ({} > {})",
        last.end,
        utterance.duration_seconds
    );
    // Punctuation carries timings in Kokoro but is not a word; emitting it corrupts captions.
    assert!(
        utterance
            .words
            .iter()
            .all(|w| w.text.chars().any(|c| c.is_alphanumeric())),
        "punctuation leaked into the word list: {:?}",
        utterance.words
    );
}

/// **The rate is a rate.** `speed: 1.0` is not the 2.5 words a second the documentation claimed
/// — measured through this path it is 3.30, a 198 wpm gabble — so the multiplier is derived from
/// a stated rate and the result is measured rather than assumed.
///
/// Three lines rather than one: the rate of a single short line swings on where its commas fall,
/// and the claim is about a read, not about a sentence.
#[test]
fn a_stated_rate_lands_within_five_words_a_minute_of_it() {
    let Some((mut engine, _sidecar)) = engine_on(7437) else {
        return;
    };
    let script = [
        "A candlestick is four numbers drawn as one mark on the chart.",
        "The body is the open against the close, and the wick is the range.",
        "Read the wick and you are reading what the price tried and gave up.",
    ];
    let speed = bay_speech::speed_for_rate(bay_speech::TARGET_WORDS_PER_SECOND);
    let mut words = 0usize;
    let mut seconds = 0.0;
    for (index, line) in script.iter().enumerate() {
        let out = tmp(&format!("rate-{index}.wav"));
        let utterance = engine
            .speak(line, "af_heart", speed, "a", &out)
            .expect("synthesis should succeed");
        assert!(
            utterance.duration_seconds <= bay_speech::MAX_NARRATION_SECONDS,
            "a line of the benchmark script is over the {}s ceiling at {:.2}s",
            bay_speech::MAX_NARRATION_SECONDS,
            utterance.duration_seconds
        );
        words += utterance.words.len();
        seconds += utterance.duration_seconds;
    }
    let wpm = words as f64 / seconds * 60.0;
    eprintln!("measured {wpm:.1} wpm at speed {speed:.3}");
    assert!(
        (wpm - 150.0).abs() <= 5.0,
        "the default target is 150 wpm; this read came out at {wpm:.1}. If Kokoro's base rate \
         has moved, re-measure bay_speech::BASE_WORDS_PER_SECOND rather than widening this."
    );
}

/// The cue floors, on real speech at the rate `narrate` now targets. This is the §1.4 proof:
/// every cue at least 0.833 s, and at least 0.30 s a word.
#[test]
fn real_captions_clear_the_reading_floors() {
    let Some((mut engine, _sidecar)) = engine_on(7438) else {
        return;
    };
    let script = "The wick is the range. The body is the close.";
    let out = tmp("floors.wav");
    let utterance = engine
        .speak(
            script,
            "af_heart",
            bay_speech::speed_for_rate(bay_speech::TARGET_WORDS_PER_SECOND),
            "a",
            &out,
        )
        .expect("synthesis should succeed");

    let cues = utterance.cues_for(script, &CueStyle::default());
    assert!(!cues.is_empty());
    for cue in &cues {
        let count = cue.text.split_whitespace().count();
        assert!(
            cue.duration() + 1e-6 >= bay_speech::MIN_CUE_SECONDS,
            "{cue:?} is a {:.3}s flash",
            cue.duration()
        );
        assert!(
            cue.duration() + 1e-6 >= bay_speech::MIN_SECONDS_PER_WORD * count as f64,
            "{cue:?} gives {:.3}s for {count} words",
            cue.duration()
        );
    }
    // …and none of them spans the full stop.
    assert!(
        cues.iter()
            .all(|cue| !(cue.text.contains("range") && cue.text.contains("body"))),
        "a cue crossed the sentence break: {cues:?}"
    );
}

#[test]
fn captions_built_from_speech_stay_inside_the_audio() {
    let Some((mut engine, _sidecar)) = engine_on(7432) else {
        return;
    };
    let out = tmp("captions.wav");
    let utterance = engine
        .speak(
            "Volatility drag is the gap between the average return and the compounded return.",
            "af_heart",
            1.0,
            "a",
            &out,
        )
        .expect("synthesis should succeed");

    let cues = utterance.cues(&CueStyle::default());
    assert!(!cues.is_empty(), "captions should be produced");
    assert!(
        cues.iter().all(|cue| cue.end > cue.start),
        "every caption must have positive duration: {cues:?}"
    );
    assert!(
        cues.windows(2)
            .all(|pair| pair[1].start >= pair[0].end - 1e-6),
        "captions must not overlap: {cues:?}"
    );
    let last = cues.last().expect("at least one cue");
    assert!(
        last.end <= utterance.duration_seconds + 1.0,
        "captions run past the end of the narration ({} vs {}s)",
        last.end,
        utterance.duration_seconds
    );
    // Every spoken word should appear in some caption — a dropped word is a silent defect.
    let joined = cues
        .iter()
        .map(|c| c.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    for word in &utterance.words {
        assert!(
            joined.contains(word.text.as_str()),
            "{:?} was spoken but never captioned",
            word.text
        );
    }
}

#[test]
fn an_empty_line_is_refused_without_starting_the_model() {
    let mut engine = SpeechEngine::new(SpeechConfig::default());
    let error = engine
        .speak("   ", "af_heart", 1.0, "a", &tmp("never.wav"))
        .expect_err("empty text is not speakable");
    assert!(
        error.to_string().contains("no text"),
        "unhelpful message: {error}"
    );
}

#[test]
fn an_absurd_speed_is_refused() {
    let mut engine = SpeechEngine::new(SpeechConfig::default());
    let error = engine
        .speak("hello", "af_heart", 99.0, "a", &tmp("never.wav"))
        .expect_err("99x speed is not usable");
    assert!(error.to_string().contains("speed"), "{error}");
}

#[test]
fn the_engine_reuses_one_hot_process_across_calls() {
    let Some((mut engine, _sidecar)) = engine_on(7433) else {
        return;
    };
    let first = std::time::Instant::now();
    engine
        .speak("One.", "af_heart", 1.0, "a", &tmp("one.wav"))
        .expect("first utterance");
    let cold = first.elapsed();

    let second = std::time::Instant::now();
    engine
        .speak("Two.", "af_heart", 1.0, "a", &tmp("two.wav"))
        .expect("second utterance");
    let warm = second.elapsed();

    // The whole point of the sidecar holding the model: the second call must not pay the
    // model load again.
    assert!(
        warm < cold,
        "second call ({warm:?}) should beat the first ({cold:?}) — the model is not staying hot"
    );
}

#[test]
fn shutdown_is_idempotent_and_the_engine_restarts_afterwards() {
    let Some((mut engine, _sidecar)) = engine_on(7434) else {
        return;
    };
    engine.ensure().expect("first start");
    engine.shutdown();
    engine.shutdown(); // must not panic or hang
    engine
        .ensure()
        .expect("the engine should start again after a shutdown");
    assert!(
        !engine.shutdown_if_idle(Duration::from_secs(3600)),
        "a freshly used engine is not idle"
    );
    assert!(
        engine.shutdown_if_idle(Duration::ZERO),
        "a zero idle window should always evict"
    );
}

#[test]
fn voices_are_listed_per_language() {
    let Some((mut engine, _sidecar)) = engine_on(7435) else {
        return;
    };
    let voices = engine.voices().expect("the sidecar should list voices");
    let american = voices["voices"]["a"]
        .as_array()
        .expect("American English voices");
    assert!(
        american.iter().any(|v| v == "af_heart"),
        "af_heart should be listed: {american:?}"
    );
}

#[test]
fn peak_normalization_evens_out_the_delivery_level() {
    let Some((mut engine, _sidecar)) = engine_on(7436) else {
        return;
    };

    /// Peak sample magnitude of a 16-bit mono WAV, in dBFS.
    fn peak_dbfs(path: &str) -> f64 {
        let bytes = std::fs::read(path).expect("the WAV should exist");
        // 44-byte canonical header, then interleaved little-endian i16.
        let peak = bytes[44..]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]).unsigned_abs() as f64)
            .fold(0.0f64, f64::max);
        assert!(peak > 0.0, "{path} is silent");
        20.0 * (peak / 32767.0).log10()
    }

    // Two lines Kokoro renders at noticeably different levels when left alone.
    let lines = [
        (
            "A hundred becomes one fifty, then seventy five.",
            "norm-a.wav",
        ),
        ("Money compounds.", "norm-b.wav"),
    ];

    let mut normalized = Vec::new();
    for (line, name) in lines {
        let path = tmp(name);
        engine
            .speak_normalized(line, "af_heart", 1.0, "a", &path, Some(-2.0))
            .expect("normalized synthesis");
        normalized.push(peak_dbfs(&path));
    }
    for (index, peak) in normalized.iter().enumerate() {
        assert!(
            (*peak - -2.0).abs() < 0.3,
            "line {index} normalized to {peak:.2} dBFS, not the requested -2.0"
        );
    }

    // And unnormalized output is genuinely different — otherwise the test above proves nothing.
    let raw = tmp("norm-raw.wav");
    engine
        .speak_normalized(lines[1].0, "af_heart", 1.0, "a", &raw, None)
        .expect("raw synthesis");
    let raw_peak = peak_dbfs(&raw);
    assert!(
        raw_peak < -3.0,
        "Kokoro's raw output was already at {raw_peak:.2} dBFS, so normalization is untested"
    );
}

#[test]
fn a_peak_above_full_scale_is_refused() {
    let mut engine = SpeechEngine::new(SpeechConfig::default());
    let error = engine
        .speak_normalized("hello", "af_heart", 1.0, "a", &tmp("never.wav"), Some(6.0))
        .expect_err("a positive dBFS target would clip");
    assert!(error.to_string().contains("full scale"), "{error}");
}
