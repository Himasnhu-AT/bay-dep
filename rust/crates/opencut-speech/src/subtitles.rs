//! Subtitle cues: building them from spoken word timings, and reading/writing SRT and WebVTT.
//!
//! A cue is just "this text, from this second to this second". Everything that makes captions
//! *readable* — how many words go on a line, how long a line must stay up to be read — lives
//! in [`CueStyle`], because those are the decisions that separate captions someone can follow
//! from captions that flash past.

use crate::WordSpan;

/// One caption: text on screen over a time range, in seconds from the start of the timeline.
#[derive(Debug, Clone, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

impl Cue {
    pub fn duration(&self) -> f64 {
        (self.end - self.start).max(0.0)
    }
}

/// How to group words into readable captions.
#[derive(Debug, Clone, Copy)]
pub struct CueStyle {
    /// Words per caption. Social captions run short — 3 to 5 reads well at thumb size.
    pub max_words: usize,
    /// Never leave a caption up for less than this, however fast the words were spoken.
    pub min_seconds: f64,
    /// Break a caption here even if it has not hit `max_words`.
    pub max_seconds: f64,
    /// A silence at least this long forces a break, so a caption never spans a pause.
    pub gap_seconds: f64,
}

impl Default for CueStyle {
    fn default() -> Self {
        Self {
            max_words: 4,
            min_seconds: 0.7,
            max_seconds: 3.0,
            gap_seconds: 0.45,
        }
    }
}

/// Group timed words into captions.
///
/// Cues are extended to `min_seconds` only into the space actually available before the next
/// cue starts — stretching blindly would overlap the following caption, putting two captions
/// on screen at once.
pub fn cues_from_words(words: &[WordSpan], style: &CueStyle) -> Vec<Cue> {
    let mut cues: Vec<Cue> = Vec::new();
    let mut group: Vec<&WordSpan> = Vec::new();

    let flush = |group: &mut Vec<&WordSpan>, cues: &mut Vec<Cue>| {
        if group.is_empty() {
            return;
        }
        let text = group
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        cues.push(Cue {
            start: group[0].start,
            end: group[group.len() - 1].end,
            text,
        });
        group.clear();
    };

    for word in words {
        if let Some(previous) = group.last() {
            let silence = word.start - previous.end;
            let span = word.end - group[0].start;
            if group.len() >= style.max_words
                || silence >= style.gap_seconds
                || span > style.max_seconds
            {
                flush(&mut group, &mut cues);
            }
        }
        group.push(word);
    }
    flush(&mut group, &mut cues);

    // Extend short cues, but only into genuinely free time.
    for index in 0..cues.len() {
        let limit = cues
            .get(index + 1)
            .map(|next| next.start)
            .unwrap_or(f64::INFINITY);
        let wanted = cues[index].start + style.min_seconds;
        if cues[index].end < wanted {
            cues[index].end = wanted.min(limit);
        }
    }

    // Close small holes between consecutive captions. A caption ends on its last word, so two
    // captions of the same sentence leave the natural inter-word silence between them — on
    // screen that is a blink. A gap of at least `gap_seconds` is a real pause and is left
    // alone, because there the caption SHOULD clear.
    for index in 0..cues.len().saturating_sub(1) {
        let next_start = cues[index + 1].start;
        let hole = next_start - cues[index].end;
        if hole > 0.0 && hole < style.gap_seconds {
            cues[index].end = next_start;
        }
    }
    cues
}

/// Shift every cue later by `offset` seconds — for placing narration partway into a timeline.
pub fn shift(cues: &[Cue], offset: f64) -> Vec<Cue> {
    cues.iter()
        .map(|cue| Cue {
            start: cue.start + offset,
            end: cue.end + offset,
            text: cue.text.clone(),
        })
        .collect()
}

/// Format seconds as an SRT timestamp (`HH:MM:SS,mmm`).
fn srt_time(seconds: f64) -> String {
    let total = seconds.max(0.0);
    let hours = (total / 3600.0).floor() as u64;
    let minutes = ((total % 3600.0) / 60.0).floor() as u64;
    let secs = (total % 60.0).floor() as u64;
    let millis = ((total - total.floor()) * 1000.0).round() as u64;
    format!("{hours:02}:{minutes:02}:{secs:02},{millis:03}")
}

/// Render cues as an SRT file.
pub fn to_srt(cues: &[Cue]) -> String {
    let mut out = String::new();
    for (index, cue) in cues.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            index + 1,
            srt_time(cue.start),
            srt_time(cue.end),
            cue.text
        ));
    }
    out
}

/// Render cues as a WebVTT file.
pub fn to_vtt(cues: &[Cue]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for cue in cues {
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            srt_time(cue.start).replace(',', "."),
            srt_time(cue.end).replace(',', "."),
            cue.text
        ));
    }
    out
}

/// Parse one `HH:MM:SS,mmm` / `MM:SS.mmm` timestamp into seconds.
fn parse_time(raw: &str) -> Option<f64> {
    let raw = raw.trim().replace(',', ".");
    let mut seconds = 0.0;
    // Accept both `HH:MM:SS.mmm` and `MM:SS.mmm`; VTT allows the hours to be omitted.
    for part in raw.split(':') {
        seconds = seconds * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(seconds)
}

/// Parse an SRT or WebVTT document into cues.
///
/// The two formats differ only in the millisecond separator, an optional `WEBVTT` header and
/// SRT's leading sequence numbers, so one parser reads both: any line containing `-->` opens a
/// cue and every line until the blank line is its text.
pub fn parse(source: &str) -> Result<Vec<Cue>, String> {
    let mut cues = Vec::new();
    let mut lines = source.lines().peekable();
    while let Some(line) = lines.next() {
        let Some((from, to)) = line.split_once("-->") else {
            continue;
        };
        let start =
            parse_time(from).ok_or_else(|| format!("could not read a start time from {from:?}"))?;
        // A VTT cue may carry positioning settings after the end time; they are not timing.
        let to = to.split_whitespace().next().unwrap_or("");
        let end =
            parse_time(to).ok_or_else(|| format!("could not read an end time from {to:?}"))?;

        let mut text = Vec::new();
        while let Some(next) = lines.peek() {
            if next.trim().is_empty() {
                break;
            }
            text.push(lines.next().unwrap_or("").trim().to_string());
        }
        if end < start {
            return Err(format!(
                "a cue ends before it starts ({start:.3}s -> {end:.3}s)"
            ));
        }
        cues.push(Cue {
            start,
            end,
            text: text.join("\n"),
        });
    }
    if cues.is_empty() {
        return Err("no cues found — is this really an SRT or VTT file?".into());
    }
    Ok(cues)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, start: f64, end: f64) -> WordSpan {
        WordSpan {
            text: text.into(),
            start,
            end,
        }
    }

    #[test]
    fn words_group_into_captions_of_at_most_max_words() {
        let words: Vec<WordSpan> = (0..9)
            .map(|i| word(&format!("w{i}"), i as f64 * 0.3, i as f64 * 0.3 + 0.25))
            .collect();
        let cues = cues_from_words(
            &words,
            &CueStyle {
                max_words: 3,
                ..CueStyle::default()
            },
        );
        assert_eq!(cues.len(), 3);
        assert_eq!(cues[0].text, "w0 w1 w2");
        assert_eq!(cues[2].text, "w6 w7 w8");
    }

    #[test]
    fn a_pause_forces_a_caption_break() {
        let words = vec![
            word("hello", 0.0, 0.4),
            word("there", 0.4, 0.8),
            // A full second of silence: the next words belong to a new caption even though
            // the first one is nowhere near its word limit.
            word("and", 1.8, 2.1),
            word("welcome", 2.1, 2.6),
        ];
        let cues = cues_from_words(&words, &CueStyle::default());
        assert_eq!(
            cues.len(),
            2,
            "a silence should split the captions: {cues:?}"
        );
        assert_eq!(cues[0].text, "hello there");
        assert_eq!(cues[1].text, "and welcome");
    }

    #[test]
    fn a_long_run_of_words_breaks_on_duration_too() {
        let words: Vec<WordSpan> = (0..6)
            .map(|i| word(&format!("w{i}"), i as f64 * 1.2, i as f64 * 1.2 + 1.1))
            .collect();
        let cues = cues_from_words(
            &words,
            &CueStyle {
                max_words: 100,
                max_seconds: 2.5,
                gap_seconds: 5.0,
                ..CueStyle::default()
            },
        );
        assert!(cues.len() > 1, "a 7s run must not be one caption");
        assert!(
            cues.iter().all(|cue| cue.duration() <= 3.0),
            "no caption should run far past max_seconds: {cues:?}"
        );
    }

    #[test]
    fn short_cues_are_extended_but_never_over_the_next_one() {
        let words = vec![
            word("a", 0.0, 0.1),
            // Only 0.3s later — extending the first cue to its 0.7s minimum would swallow it.
            word("b", 0.3, 0.4),
        ];
        let cues = cues_from_words(
            &words,
            &CueStyle {
                max_words: 1,
                min_seconds: 0.7,
                ..CueStyle::default()
            },
        );
        assert_eq!(cues.len(), 2);
        assert!(
            cues[0].end <= cues[1].start + 1e-9,
            "captions must not overlap: {cues:?}"
        );
    }

    #[test]
    fn consecutive_captions_do_not_blink_between_words() {
        // Two captions of one sentence, separated only by the natural silence between words.
        let words = vec![
            word("a", 0.00, 0.40),
            word("b", 0.45, 0.85),
            word("c", 0.97, 1.40),
            word("d", 1.45, 1.90),
        ];
        let cues = cues_from_words(
            &words,
            &CueStyle {
                max_words: 2,
                min_seconds: 0.0,
                gap_seconds: 0.45,
                ..CueStyle::default()
            },
        );
        assert_eq!(cues.len(), 2);
        assert!(
            (cues[0].end - cues[1].start).abs() < 1e-9,
            "a 0.12s hole between captions of one sentence reads as a blink: {cues:?}"
        );
    }

    #[test]
    fn a_real_pause_still_clears_the_caption() {
        let words = vec![
            word("a", 0.0, 0.4),
            word("b", 0.4, 0.8),
            // A full second of silence: the screen should genuinely go empty here.
            word("c", 1.8, 2.2),
            word("d", 2.2, 2.6),
        ];
        let cues = cues_from_words(
            &words,
            &CueStyle {
                max_words: 2,
                min_seconds: 0.0,
                gap_seconds: 0.45,
                ..CueStyle::default()
            },
        );
        assert_eq!(cues.len(), 2);
        assert!(
            cues[1].start - cues[0].end > 0.5,
            "a one-second pause must not be papered over: {cues:?}"
        );
    }

    #[test]
    fn no_words_makes_no_cues() {
        assert!(cues_from_words(&[], &CueStyle::default()).is_empty());
    }

    #[test]
    fn srt_round_trips() {
        let cues = vec![
            Cue {
                start: 0.0,
                end: 1.5,
                text: "first line".into(),
            },
            Cue {
                start: 2.25,
                end: 4.0,
                text: "second line".into(),
            },
        ];
        let srt = to_srt(&cues);
        assert!(srt.contains("00:00:00,000 --> 00:00:01,500"), "{srt}");
        let parsed = parse(&srt).expect("our own SRT should parse");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[1].text, "second line");
        assert!((parsed[1].start - 2.25).abs() < 1e-3);
    }

    #[test]
    fn vtt_round_trips_and_tolerates_cue_settings() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500 line:90%\nhello\n\n\
                   00:00:03.000 --> 00:00:04.000\nworld\n";
        let cues = parse(vtt).expect("VTT should parse");
        assert_eq!(cues.len(), 2);
        assert!((cues[0].end - 2.5).abs() < 1e-3, "{cues:?}");
        assert_eq!(cues[1].text, "world");
    }

    #[test]
    fn a_two_field_timestamp_is_read_as_minutes_and_seconds() {
        let vtt = "WEBVTT\n\n01:30.000 --> 01:32.000\nlate\n";
        let cues = parse(vtt).expect("VTT without hours should parse");
        assert!((cues[0].start - 90.0).abs() < 1e-3, "{cues:?}");
    }

    #[test]
    fn multi_line_cue_text_is_preserved() {
        let srt = "1\n00:00:00,000 --> 00:00:02,000\ntop line\nbottom line\n\n";
        let cues = parse(srt).unwrap();
        assert_eq!(cues[0].text, "top line\nbottom line");
    }

    #[test]
    fn a_file_with_no_cues_is_an_error_not_an_empty_reel() {
        assert!(parse("just some prose\nwith no timings").is_err());
    }

    #[test]
    fn a_backwards_cue_is_rejected() {
        let srt = "1\n00:00:05,000 --> 00:00:02,000\nnope\n\n";
        assert!(parse(srt).is_err(), "an end before its start is not a cue");
    }

    #[test]
    fn shifting_moves_every_cue_by_the_same_offset() {
        let cues = vec![Cue {
            start: 1.0,
            end: 2.0,
            text: "x".into(),
        }];
        let moved = shift(&cues, 4.5);
        assert!((moved[0].start - 5.5).abs() < 1e-9);
        assert!((moved[0].end - 6.5).abs() < 1e-9);
    }
}
