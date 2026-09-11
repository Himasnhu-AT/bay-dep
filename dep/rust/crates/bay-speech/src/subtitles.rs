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

/// The floor under a caption's time on screen, whatever it says.
///
/// The BBC's subtitle guideline, and the number 8 of the cues in the project this work comes
/// from were under. A caption below it is a flash: the eye has not finished saccading to it
/// before it is gone.
pub const MIN_CUE_SECONDS: f64 = 0.833;

/// …and the floor per word in it. 18 of that project's cues ran over 17 characters a second;
/// this is the same claim in the unit captions are actually built in.
pub const MIN_SECONDS_PER_WORD: f64 = 0.30;

/// How to group words into readable captions.
///
/// **Not a tool argument any more.** Every field here was settable over MCP, and the project
/// that prompted this set them wrong in the same direction every time — captions faster than
/// anyone reads, split mid-sentence. What a caption has to clear to be readable is a fact about
/// reading, not a parameter of the video.
#[derive(Debug, Clone, Copy)]
pub struct CueStyle {
    /// Words per caption. Social captions run short — 3 to 5 reads well at thumb size.
    pub max_words: usize,
    /// Never leave a caption up for less than this, however fast the words were spoken.
    pub min_seconds: f64,
    /// …nor for less than this per word in it.
    pub min_seconds_per_word: f64,
    /// Break a caption here even if it has not hit `max_words`.
    pub max_seconds: f64,
    /// A silence at least this long forces a break, so a caption never spans a pause.
    pub gap_seconds: f64,
}

impl Default for CueStyle {
    fn default() -> Self {
        Self {
            max_words: 4,
            min_seconds: MIN_CUE_SECONDS,
            min_seconds_per_word: MIN_SECONDS_PER_WORD,
            max_seconds: 3.0,
            gap_seconds: 0.45,
        }
    }
}

impl CueStyle {
    /// The shortest a cue of `words` words may be.
    pub fn floor(&self, words: usize) -> f64 {
        self.min_seconds
            .max(self.min_seconds_per_word * words as f64)
    }
}

/// One run of words that will become a caption, before its window is decided.
#[derive(Debug, Clone, Copy)]
struct Group {
    first: usize,
    last: usize,
    /// Whether the script ends a sentence on this group's last word. A caption may never span
    /// one of these, and two of them may never be merged across.
    closes: bool,
}

/// Group timed words into captions.
///
/// Use [`cues_from_spoken`] when the script is available: without it a sentence end can only be
/// seen when the speech engine leaves the punctuation attached to a word, which Kokoro's
/// sidecar does not.
pub fn cues_from_words(words: &[WordSpan], style: &CueStyle) -> Vec<Cue> {
    cues_from_spoken(words, "", style)
}

/// Group timed words into captions, reading sentence ends out of the script they came from.
///
/// Three rules beyond "four words a line", each of which the project this comes from broke:
///
/// - **A caption never crosses a full stop.** Two of that project's cues carried the end of one
///   sentence and the start of the next, which reads as a non-sequitur at thumb size.
/// - **A caption is on screen for at least [`MIN_CUE_SECONDS`], and at least
///   [`MIN_SECONDS_PER_WORD`] per word.** Only into time that is genuinely free — stretching
///   blindly would put two captions on screen at once.
/// - **A caption that still cannot clear that is merged into its neighbour**, when the two are
///   in the same sentence and there is no pause between them. An orphaned one-word flash is a
///   defect of the split, and the split is what gets fixed.
pub fn cues_from_spoken(words: &[WordSpan], source: &str, style: &CueStyle) -> Vec<Cue> {
    if words.is_empty() {
        return Vec::new();
    }
    let closes = sentence_ends(source, words);
    let mut groups = split_groups(words, &closes, style);
    merge_starved_groups(words, &mut groups, style);
    finish(words, &groups, style)
}

/// Break the word stream wherever a caption must not continue.
fn split_groups(words: &[WordSpan], closes: &[bool], style: &CueStyle) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    let mut first = 0usize;
    for index in 1..=words.len() {
        let previous = index - 1;
        let done = index == words.len() || {
            let silence = words[index].start - words[previous].end;
            let span = words[index].end - words[first].start;
            index - first >= style.max_words
                || silence >= style.gap_seconds
                || span > style.max_seconds
                || closes.get(previous).copied().unwrap_or(false)
        };
        if done {
            groups.push(Group {
                first,
                last: previous,
                closes: closes.get(previous).copied().unwrap_or(false),
            });
            first = index;
        }
    }
    groups
}

/// Fold an **orphan** caption — one shorter than a full line — into the one beside it.
///
/// Legal only inside one sentence, across no pause, and up to one word over `max_words`: the
/// cure for a flash is not a wall of text. Deliberately not applied to a full-length caption
/// that is merely short of time, because merging two of those preserves their seconds-per-word
/// exactly and fixes nothing — that case is speech spoken too fast, and it is fixed by the
/// read's rate, not by the caption split.
fn merge_starved_groups(words: &[WordSpan], groups: &mut Vec<Group>, style: &CueStyle) {
    let room = |groups: &[Group], index: usize| -> f64 {
        let start = words[groups[index].first].start;
        match groups.get(index + 1) {
            Some(next) => words[next.first].start - start,
            None => f64::INFINITY,
        }
    };
    // Whether `left` and the group after it are one sentence with no pause between them, and
    // short enough together to still be one caption.
    //
    // One of the two has to be an **orphan** — shorter than a full line. Merging two full lines
    // preserves their seconds per word exactly and fixes nothing; all it does is double the
    // words on screen. What it is for is the leftover tail of a sentence, which is both the case
    // that flashes and the case that hands its neighbour the silence it needs.
    let joinable = |groups: &[Group], left: usize| -> bool {
        let first = groups[left].last - groups[left].first + 1;
        let second = groups[left + 1].last - groups[left + 1].first + 1;
        !groups[left].closes
            && words[groups[left + 1].first].start - words[groups[left].last].end
                < style.gap_seconds
            && first + second <= style.max_words + 1
            && first.min(second) < style.max_words
    };

    let mut index = 0usize;
    // Every merge removes one group, so the walk terminates; the guard says so out loud.
    let mut guard = groups.len() * 2;
    while index < groups.len() && guard > 0 {
        guard -= 1;
        let count = groups[index].last - groups[index].first + 1;
        if room(groups, index) + 1e-9 >= style.floor(count) {
            index += 1;
            continue;
        }
        let left = if index > 0 && joinable(groups, index - 1) {
            index - 1
        } else if index + 1 < groups.len() && joinable(groups, index) {
            index
        } else {
            // Nothing legal to fold into: the caption keeps whatever room there is. Better a
            // short caption than one that spans a full stop or papers over a pause.
            index += 1;
            continue;
        };
        groups[left].last = groups[left + 1].last;
        groups[left].closes = groups[left + 1].closes;
        groups.remove(left + 1);
        index = left;
    }
}

/// Turn groups into cues: text, window, and the time each one is owed.
fn finish(words: &[WordSpan], groups: &[Group], style: &CueStyle) -> Vec<Cue> {
    let mut cues: Vec<Cue> = groups
        .iter()
        .map(|group| Cue {
            start: words[group.first].start,
            end: words[group.last].end,
            text: words[group.first..=group.last]
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
        })
        .collect();

    // Extend short cues, but only into genuinely free time.
    for index in 0..cues.len() {
        let limit = cues
            .get(index + 1)
            .map(|next| next.start)
            .unwrap_or(f64::INFINITY);
        let count = groups[index].last - groups[index].first + 1;
        let wanted = cues[index].start + style.floor(count);
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

/// Which spoken words the script ends a sentence on.
///
/// The sidecar drops punctuation-only tokens — it has to, or every comma becomes a caption — so
/// the full stops are only in the script. The two are walked together and matched on the letters
/// alone, because a speech engine may say a number as several words and nothing downstream can
/// assume the two lists are the same length.
pub fn sentence_ends(source: &str, words: &[WordSpan]) -> Vec<bool> {
    /// How far ahead to look for a spoken word in the script before giving up on it. Enough to
    /// step over "2024" spoken as three words; small enough that a mis-match cannot run away.
    const LOOKAHEAD: usize = 8;

    let script: Vec<(String, bool)> = source
        .split_whitespace()
        .map(|token| (letters(token), closes_sentence(token)))
        .collect();

    let mut ends = vec![false; words.len()];
    let mut cursor = 0usize;
    for (index, word) in words.iter().enumerate() {
        // A word whose own text kept its punctuation answers the question by itself.
        if closes_sentence(&word.text) {
            ends[index] = true;
        }
        let spoken = letters(&word.text);
        if spoken.is_empty() {
            continue;
        }
        let found = (cursor..script.len().min(cursor + LOOKAHEAD))
            .find(|position| script[*position].0 == spoken);
        if let Some(position) = found {
            ends[index] |= script[position].1;
            cursor = position + 1;
        }
    }
    ends
}

/// The letters and digits of a token, lowercased — what two spellings of the same word share.
fn letters(token: &str) -> String {
    token
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Whether a script token ends a sentence.
///
/// Trailing quotes and brackets are stepped over, so `she said."` counts. Three things are read
/// as abbreviations rather than endings, because splitting a caption at one of them is worse
/// than missing a real full stop: a single initial (`J.`), a token with a stop *inside* it
/// (`e.g.`, `U.S.`), and a short list of the abbreviations that actually occur in a script.
/// A named list, not a length rule — `of.` and `is.` end sentences constantly, and a
/// two-letter cut-off silently swallowed them.
pub fn closes_sentence(token: &str) -> bool {
    const ABBREVIATIONS: [&str; 14] = [
        "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "fig", "approx", "inc",
        "ltd",
    ];
    let trimmed = token.trim_end_matches(['"', '\'', ')', ']', '}', '»', '”', '’']);
    let Some(last) = trimmed.chars().next_back() else {
        return false;
    };
    if !matches!(last, '.' | '!' | '?' | '…') {
        return false;
    }
    if last == '.' {
        let body = trimmed.trim_end_matches('.');
        if body.contains('.') {
            return false;
        }
        let letters = body.chars().filter(|c| c.is_alphanumeric()).count();
        if letters <= 1 {
            return false;
        }
        if ABBREVIATIONS
            .iter()
            .any(|abbreviation| body.eq_ignore_ascii_case(abbreviation))
        {
            return false;
        }
    }
    true
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

    // ------------------------------------------------------------------ cue discipline
    //
    // The four measured defects in the narration this comes from: cues that straddled a full
    // stop, cues under 0.833 s, cues under 0.30 s a word, and a one-word flash left over from
    // the split. Each has a test, and each test is written against the numbers that were wrong.

    /// A caption may not carry the end of one sentence and the start of the next.
    #[test]
    fn a_caption_never_crosses_a_full_stop() {
        let script = "The wick is the range. Price closed here.";
        let spoken = [
            "The", "wick", "is", "the", "range", "Price", "closed", "here",
        ];
        let words: Vec<WordSpan> = spoken
            .iter()
            .enumerate()
            .map(|(i, text)| word(text, i as f64 * 0.45, i as f64 * 0.45 + 0.4))
            .collect();
        let cues = cues_from_spoken(&words, script, &CueStyle::default());
        assert!(
            cues.iter().all(|cue| !(cue.text.contains("range")
                && (cue.text.contains("Price") || cue.text.contains("closed")))),
            "a cue spans the sentence break: {cues:?}"
        );
        let first_sentence: String = cues
            .iter()
            .take_while(|cue| !cue.text.starts_with("Price"))
            .map(|cue| cue.text.clone())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(first_sentence, "The wick is the range");
    }

    /// The break comes from the script, because the speech engine strips the punctuation.
    #[test]
    fn sentence_ends_are_read_out_of_the_script_not_the_word_list() {
        let words = [word("range", 0.0, 0.4), word("price", 0.5, 0.9)];
        let ends = sentence_ends("the range. price closed", &words);
        assert_eq!(ends, vec![true, false], "{ends:?}");
        // …and with no script at all nothing is claimed, rather than guessed.
        assert_eq!(sentence_ends("", &words), vec![false, false]);
    }

    /// An abbreviation is not the end of a sentence, and a stop inside quotes is.
    #[test]
    fn an_abbreviation_does_not_break_a_caption() {
        assert!(!closes_sentence("Mr."));
        assert!(!closes_sentence("e.g."));
        assert!(!closes_sentence("J."));
        assert!(!closes_sentence("range"));
        assert!(closes_sentence("range."));
        assert!(closes_sentence("said.\""));
        assert!(closes_sentence("really?"));
        // Two-letter words end sentences all the time; a length rule swallowed them.
        assert!(closes_sentence("of."));
        assert!(closes_sentence("is."));
    }

    /// Every cue clears both floors when there is room, which is what a 150 wpm read gives.
    #[test]
    fn every_cue_clears_the_reading_floors_at_a_broadcast_rate() {
        // 2.5 words a second: 0.40 s a word, the rate `narrate` now targets.
        let script = "A candle is four numbers. The body is open against close.";
        let words: Vec<WordSpan> = script
            .split_whitespace()
            .enumerate()
            .map(|(i, token)| {
                word(
                    token.trim_end_matches('.'),
                    i as f64 * 0.40,
                    i as f64 * 0.40 + 0.34,
                )
            })
            .collect();
        let style = CueStyle::default();
        let cues = cues_from_spoken(&words, script, &style);
        assert!(!cues.is_empty());
        for cue in &cues {
            let count = cue.text.split_whitespace().count();
            assert!(
                cue.duration() + 1e-9 >= MIN_CUE_SECONDS,
                "{cue:?} is a {:.3}s flash",
                cue.duration()
            );
            assert!(
                cue.duration() + 1e-9 >= MIN_SECONDS_PER_WORD * count as f64,
                "{cue:?} gives {:.3}s for {count} words",
                cue.duration()
            );
        }
    }

    /// A one-word tail left over by the split is folded back into its own sentence rather than
    /// flashed on its own — when there is another sentence right behind it, so it cannot simply
    /// be held longer.
    #[test]
    fn an_orphan_word_is_merged_rather_than_flashed() {
        let script = "open high low close now. Then the next line runs on.";
        let spoken = [
            "open", "high", "low", "close", "now", "Then", "the", "next", "line", "runs", "on",
        ];
        let words: Vec<WordSpan> = spoken
            .iter()
            .enumerate()
            .map(|(i, token)| word(token, i as f64 * 0.30, i as f64 * 0.30 + 0.26))
            .collect();
        let cues = cues_from_spoken(&words, script, &CueStyle::default());
        assert_eq!(
            cues[0].text, "open high low close now",
            "the tail was left on its own: {cues:?}"
        );
        assert!(
            cues.iter()
                .all(|cue| cue.text.split_whitespace().count() > 1),
            "no one-word flash survives: {cues:?}"
        );
    }

    /// …but never across a full stop, however starved the orphan is.
    #[test]
    fn an_orphan_is_not_merged_across_a_sentence_end() {
        let script = "open high low close. Now.";
        let words: Vec<WordSpan> = ["open", "high", "low", "close", "Now"]
            .iter()
            .enumerate()
            .map(|(i, token)| word(token, i as f64 * 0.30, i as f64 * 0.30 + 0.26))
            .collect();
        let cues = cues_from_spoken(&words, script, &CueStyle::default());
        assert_eq!(cues.len(), 2, "{cues:?}");
        assert_eq!(cues[1].text, "Now");
    }

    /// A full-length caption short of time is not "fixed" by doubling its length: merging two
    /// four-word cues keeps the same seconds per word and only makes the line unreadable.
    #[test]
    fn a_fast_full_line_is_not_merged_into_a_wall_of_text() {
        let words: Vec<WordSpan> = (0..8)
            .map(|i| word(&format!("w{i}"), i as f64 * 0.16, i as f64 * 0.16 + 0.14))
            .collect();
        let cues = cues_from_words(&words, &CueStyle::default());
        assert_eq!(cues.len(), 2, "{cues:?}");
        assert!(
            cues.iter()
                .all(|cue| cue.text.split_whitespace().count() <= 4)
        );
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
