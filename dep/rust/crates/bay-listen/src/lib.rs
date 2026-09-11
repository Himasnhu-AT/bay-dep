//! Local speech-to-text and transcript-first edit planning for bay.
//!
//! Recognition is performed by whisper.cpp through `whisper-rs`. The transcript itself lives in
//! `bay-project`; this crate owns producing it and turning words into source ranges.

mod diarize;
mod engine;

pub use bay_project::{Transcript, TranscriptUtterance, TranscriptWord};
pub use diarize::{DiarizationSummary, diarize_file, diarize_pcm};
pub use engine::{ListenConfig, ListenError, Listener};

/// A half-open interval in the original media.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceRange {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub text: String,
}

/// Taste controls for automatic dialogue tightening.
#[derive(Debug, Clone, PartialEq)]
pub struct CleanupConfig {
    /// Case-insensitive words removed as standalone tokens.
    pub filler_words: Vec<String>,
    /// Gaps below this duration retain their natural timing.
    pub dead_air_threshold_seconds: f64,
    /// Timing retained at an ordinary removed pause.
    pub retained_pause_seconds: f64,
    /// A pause at least this long is considered intentional when `keep_meaningful_pauses` is set.
    pub meaningful_pause_threshold_seconds: f64,
    /// Timing retained for an intentional beat. This is deliberately bounded: a five-second gap
    /// may be meaningful, but preserving all five seconds defeats dead-air removal.
    pub meaningful_pause_seconds: f64,
    pub keep_meaningful_pauses: bool,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            filler_words: ["um", "uh", "erm", "er", "ah", "like", "you know"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            dead_air_threshold_seconds: 0.72,
            retained_pause_seconds: 0.18,
            meaningful_pause_threshold_seconds: 1.35,
            meaningful_pause_seconds: 0.65,
            keep_meaningful_pauses: true,
        }
    }
}

impl CleanupConfig {
    fn retained_pause(&self, source_gap: f64) -> f64 {
        if source_gap < self.dead_air_threshold_seconds {
            source_gap
        } else if self.keep_meaningful_pauses
            && source_gap >= self.meaningful_pause_threshold_seconds
        {
            self.meaningful_pause_seconds.min(source_gap)
        } else {
            self.retained_pause_seconds.min(source_gap)
        }
    }
}

/// Find every word sequence containing `query`, returning source-accurate intervals.
pub fn search(transcript: &Transcript, query: &str) -> Vec<SourceRange> {
    let needle: Vec<String> = query
        .split_whitespace()
        .map(normalize)
        .filter(|word| !word.is_empty())
        .collect();
    if needle.is_empty() {
        return Vec::new();
    }

    let words: Vec<String> = transcript
        .words
        .iter()
        .map(|word| normalize(&word.text))
        .collect();
    words
        .windows(needle.len())
        .enumerate()
        .filter(|(_, window)| *window == needle.as_slice())
        .map(|(start, _)| range_for_words(transcript, start, start + needle.len()))
        .collect()
}

/// Resolve a half-open word-index range into a source interval.
pub fn range_for_words(transcript: &Transcript, start: usize, end: usize) -> SourceRange {
    let selected = transcript.words.get(start..end).unwrap_or_default();
    SourceRange {
        start_seconds: selected
            .first()
            .map(|word| word.start_seconds)
            .unwrap_or_default(),
        end_seconds: selected
            .last()
            .map(|word| word.end_seconds)
            .unwrap_or_default(),
        text: selected
            .iter()
            .map(|word| word.text.trim())
            .collect::<Vec<_>>()
            .join(" "),
    }
}

/// Plan source ranges that remove configured filler tokens and compress only excessive pauses.
///
/// The returned ranges are ready to place consecutively on the timeline. Short conversational
/// pauses remain inside a range. Long gaps split ranges and retain a configurable beat divided
/// equally across the outgoing and incoming clips.
pub fn cleanup_ranges(transcript: &Transcript, config: &CleanupConfig) -> Vec<SourceRange> {
    let filler_words: Vec<Vec<String>> = config
        .filler_words
        .iter()
        .map(|filler| filler.split_whitespace().map(normalize).collect())
        .filter(|filler: &Vec<String>| !filler.is_empty())
        .collect();
    let normalized: Vec<String> = transcript
        .words
        .iter()
        .map(|word| normalize(&word.text))
        .collect();
    let mut removed = vec![false; transcript.words.len()];
    for start in 0..normalized.len() {
        for filler in &filler_words {
            if normalized[start..].starts_with(filler) {
                removed[start..start + filler.len()].fill(true);
            }
        }
    }

    let kept: Vec<usize> = removed
        .iter()
        .enumerate()
        .filter_map(|(index, removed)| (!removed).then_some(index))
        .collect();
    let Some(&first) = kept.first() else {
        return Vec::new();
    };

    let mut ranges = Vec::new();
    let mut range_start = transcript.words[first].start_seconds;
    let mut text = vec![transcript.words[first].text.trim().to_string()];
    let mut previous = first;
    for &index in kept.iter().skip(1) {
        let source_gap = (transcript.words[index].start_seconds
            - transcript.words[previous].end_seconds)
            .max(0.0);
        let crossed_filler = removed[previous + 1..index].iter().any(|removed| *removed);
        if crossed_filler || source_gap >= config.dead_air_threshold_seconds {
            let retained = if crossed_filler {
                config.retained_pause_seconds.min(source_gap)
            } else {
                config.retained_pause(source_gap)
            };
            ranges.push(SourceRange {
                start_seconds: range_start,
                end_seconds: transcript.words[previous].end_seconds + retained / 2.0,
                text: text.join(" "),
            });
            range_start = (transcript.words[index].start_seconds - retained / 2.0).max(0.0);
            text.clear();
        }
        text.push(transcript.words[index].text.trim().to_string());
        previous = index;
    }
    ranges.push(SourceRange {
        start_seconds: range_start,
        end_seconds: transcript.words[previous].end_seconds,
        text: text.join(" "),
    });
    ranges
}

fn normalize(value: &str) -> String {
    value
        .trim()
        .trim_matches(|character: char| !character.is_alphanumeric() && character != '\'')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(words: &[(&str, f64, f64)]) -> Transcript {
        Transcript {
            language: "en".into(),
            model: "test".into(),
            duration_seconds: words.last().map(|word| word.2).unwrap_or_default(),
            words: words
                .iter()
                .map(|(text, start, end)| TranscriptWord {
                    text: (*text).into(),
                    start_seconds: *start,
                    end_seconds: *end,
                    confidence: 0.9,
                    speaker: None,
                })
                .collect(),
            utterances: Vec::new(),
        }
    }

    #[test]
    fn search_returns_precise_word_timing() {
        let transcript = transcript(&[
            ("The", 0.1, 0.3),
            ("green", 0.35, 0.7),
            ("interview.", 0.72, 1.2),
        ]);
        assert_eq!(
            search(&transcript, "green interview"),
            vec![SourceRange {
                start_seconds: 0.35,
                end_seconds: 1.2,
                text: "green interview.".into(),
            }]
        );
    }

    #[test]
    fn cleanup_removes_fillers_but_keeps_a_bounded_meaningful_beat() {
        let transcript = transcript(&[
            ("We", 0.0, 0.2),
            ("um", 0.3, 0.5),
            ("continue", 0.6, 1.0),
            ("after", 3.0, 3.3),
            ("thinking.", 3.35, 3.8),
        ]);
        let ranges = cleanup_ranges(&transcript, &CleanupConfig::default());
        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].text, "We");
        assert_eq!(ranges[1].text, "continue");
        assert_eq!(ranges[2].text, "after thinking.");
        let retained_beat = ranges[1].end_seconds - 1.0 + 3.0 - ranges[2].start_seconds;
        assert!((retained_beat - 0.65).abs() < 0.0001);
    }

    #[test]
    fn cleanup_does_not_touch_short_natural_pauses() {
        let transcript = transcript(&[("one", 0.0, 0.2), ("two", 0.55, 0.8)]);
        let ranges = cleanup_ranges(&transcript, &CleanupConfig::default());
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].start_seconds, 0.0);
        assert_eq!(ranges[0].end_seconds, 0.8);
    }
}
