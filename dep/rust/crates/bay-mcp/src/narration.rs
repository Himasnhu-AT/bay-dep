//! Narration and subtitle tools for the [`Studio`](crate::studio::Studio).
//!
//! Three things an agent needs and could not do before: speak a script, put captions on the
//! timeline, and turn a subtitle file into a video. They share one representation — a
//! [`Cue`] — so narration-derived captions and imported SRT captions are the same thing
//! downstream and get the same styling.

use bay_project::Element;
use bay_speech::Cue;

use crate::studio::{Studio, ToolError, ToolResult, err};

/// The caption vocabulary, defined once in the planner and re-exported here.
///
/// **Not mirrored.** These types used to exist twice — once here for the wire and once in
/// `bay_agent::plan` for the editor window — and the two drifted: the window ignored the kit,
/// centred every caption and faded at 0.12 s while the wire did something else. One definition
/// is the only way a caption can mean the same thing on both transports.
pub use bay_agent::plan::{
    CAPTION_FADE_SECONDS, CAPTION_LAYER, CaptionPlacement, CaptionPreset, CaptionStyle,
};

/// Everything one call to [`Studio::narrate`] needs.
///
/// A struct rather than ten positional arguments, and a shorter one than the list it replaces:
/// the eleven caption parameters are gone into [`CaptionStyle`], and `speed` is optional because
/// the rate is now stated in words a second and the multiplier derived from it.
pub struct NarrateArgs {
    pub text: String,
    pub voice: String,
    /// The raw Kokoro multiplier, when a caller insists. `None` derives it from the target rate.
    pub speed: Option<f32>,
    /// How fast the line should be read, in words a second. 2.5 is 150 wpm.
    pub target_words_per_second: f64,
    pub lang_code: String,
    pub start: f64,
    pub volume: f32,
    pub out_path: Option<String>,
    pub peak_db: Option<f32>,
    pub pitch_semitones: f32,
    pub energy: f32,
    /// `None` places no captions — the audio only.
    pub captions: Option<CaptionStyle>,
}

impl Default for NarrateArgs {
    fn default() -> Self {
        Self {
            text: String::new(),
            voice: "af_heart".to_string(),
            speed: None,
            target_words_per_second: bay_speech::TARGET_WORDS_PER_SECOND,
            lang_code: "a".to_string(),
            start: 0.0,
            volume: 1.0,
            out_path: None,
            peak_db: Some(-2.0),
            pitch_semitones: 0.0,
            energy: 1.0,
            captions: None,
        }
    }
}

/// The refusal for a line that is too long to be one clip. The message is
/// [`bay_speech::over_length_message`] so the wire and the window refuse it identically.
fn too_long(text: &str, words: usize, seconds: f64, verb: &str) -> ToolError {
    err(bay_speech::over_length_message(text, words, seconds, verb))
}

impl Studio {
    /// Whether Kokoro is available, and which voices it can speak.
    pub fn speech_status(&mut self) -> ToolResult {
        let engine = self.speech();
        if !engine.is_installed() {
            return Ok(serde_json::json!({
                "available": false,
                "python": engine.config().python,
                "script": engine.config().script,
                // bay installs this itself. The old hint told the user to run `uv` commands —
                // a tool they do not have, referencing docs that do not ship with the binary.
                // This is the headless (`bay --mcp`) copy of a hint that was already fixed on
                // the in-app bridge path; the two being separate is how one of them stayed wrong.
                "hint": "narration is not installed. Call runtime_install with component \
                         \"speech\" and bay will fetch it (~1.2 GB); nothing needs to be \
                         installed first. To use an interpreter you already have, set \
                         BAY_KOKORO_PYTHON.",
            }));
        }
        let python = engine.config().python.clone();
        match engine.voices() {
            Ok(voices) => Ok(serde_json::json!({
                "available": true,
                "python": python,
                "sampleRate": 24_000,
                "voices": voices.get("voices").cloned().unwrap_or(serde_json::Value::Null),
            })),
            Err(error) => Ok(serde_json::json!({
                "available": false,
                "python": python,
                "error": error.to_string(),
            })),
        }
    }

    /// Speak `text`, place the audio on the timeline at `start`, and return the caption cues
    /// its word timings imply.
    ///
    /// The audio and the captions come from the same synthesis, so they cannot drift apart —
    /// which is the whole reason this is one tool rather than two.
    ///
    /// Two refusals live here, both measured on the video this comes from:
    ///
    /// - **A clip longer than [`bay_speech::MAX_NARRATION_SECONDS`] is refused**, before the
    ///   synthesis when the word count already says so and after it when the voice disagreed.
    ///   Its 10.30 s, 29-word run-on landed on the turn of the video, and no caption rule
    ///   repairs a sentence nobody can follow.
    /// - **The read's rate is a stated target, not a multiplier.** `speed: 1.0` delivered 2.99
    ///   words a second in that project — a 179 wpm read — and measures 3.30 through this path,
    ///   while every plan was budgeted at the 2.5 the documentation claimed. The rate is asked
    ///   for in words a second and the speed derived from it; what actually came out is measured
    ///   and returned as `wordsPerSecond`.
    pub fn narrate(&mut self, args: NarrateArgs) -> ToolResult {
        let NarrateArgs {
            text,
            voice,
            speed,
            target_words_per_second,
            lang_code,
            start,
            volume,
            out_path,
            peak_db,
            pitch_semitones,
            energy,
            captions,
        } = args;

        let speed = speed.unwrap_or_else(|| bay_speech::speed_for_rate(target_words_per_second));
        // What this speed will actually deliver, which is what the length has to be judged on.
        let planned_rate = bay_speech::BASE_WORDS_PER_SECOND * f64::from(speed);
        let words = bay_speech::word_count(&text);
        let estimate = bay_speech::estimated_seconds(&text, planned_rate);
        if estimate > bay_speech::MAX_NARRATION_SECONDS {
            return Err(too_long(&text, words, estimate, "would take"));
        }
        // The caption face is checked here rather than where the captions are placed, which is
        // after the audio is already on the timeline: a refusal must not leave half a narration
        // behind for the caller to clean up.
        if let Some(family) = captions
            .as_ref()
            .and_then(|style| style.font_family.clone())
        {
            let weight = captions.as_ref().map(|s| s.font_weight).unwrap_or(400);
            self.require_face(&family, weight, "the captions")?;
        }

        let out_path = out_path.unwrap_or_else(|| {
            std::env::temp_dir()
                .join(format!("bay-narration-{}.wav", self.next_narration_id()))
                .to_string_lossy()
                .to_string()
        });

        let normalized_energy = peak_db
            .map(|peak| 10.0_f32.powf((peak + 2.0) / 20.0))
            .unwrap_or(energy);
        let utterance = bay_speech::TtsProvider::synthesize(
            self.speech(),
            bay_speech::SynthesisRequest {
                text: &text,
                voice: &voice,
                language: &lang_code,
                output_path: &out_path,
                prosody: bay_speech::Prosody {
                    rate: speed,
                    pitch_semitones,
                    energy: normalized_energy,
                },
            },
        )
        .map_err(|error| err(error.to_string()))?;

        // Checked before anything is placed: a refusal must not leave half a narration on the
        // timeline for the caller to clean up.
        if utterance.duration_seconds > bay_speech::MAX_NARRATION_SECONDS {
            return Err(too_long(
                &text,
                utterance.words.len().max(words),
                utterance.duration_seconds,
                "came out at",
            ));
        }

        // Register the WAV and drop it on the audio lane where the caller asked for it.
        let media = self.media_import(&utterance.path, None, None)?;
        let media_id = media
            .get("mediaId")
            .and_then(|id| id.as_str())
            .ok_or_else(|| err("media_import did not return a mediaId"))?
            .to_string();
        let audio = self.add_audio(
            None,
            media_id.clone(),
            start,
            utterance.duration_seconds,
            volume,
            0.0, // a line of narration plays from its own head; there is nothing to skip
            // bay spoke this; the author wrote the words. Stamping it is what lets a mix check
            // ask "is the bed under the voice" without being told which clip the voice is.
            bay_project::ElementSource::Tool,
            bay_project::AudioRole::Speech,
            // Kokoro's output is raw speech; the chain is exactly what it wants.
            true,
        )?;
        if let Some(element_id) = audio.get("elementId").and_then(|value| value.as_str()) {
            self.set_audio_prosody(
                element_id,
                bay_project::SpeechProsody {
                    rate: speed,
                    pitch_semitones,
                    energy: normalized_energy,
                },
            );
        }

        let cue_style = captions
            .as_ref()
            .map(CaptionStyle::cue_style)
            .unwrap_or_default();
        // Against the script, not just the word timings: the sidecar drops punctuation tokens,
        // so a full stop is only visible here.
        let cues = bay_speech::shift(&utterance.cues_for(&text, &cue_style), start);
        let placed = match &captions {
            Some(caption_style) => Some(self.place_cues_with_words(
                &cues,
                caption_style,
                Some((&utterance.words, start)),
            )?),
            None => None,
        };

        let measured = utterance.words_per_second();
        let mut out = serde_json::json!({
            "audioPath": utterance.path,
            "mediaId": media_id,
            "voice": utterance.voice,
            "startSeconds": start,
            "durationSeconds": utterance.duration_seconds,
            "endSeconds": start + utterance.duration_seconds,
            "words": utterance.words.len(),
            "speed": speed,
            "targetWordsPerSecond": target_words_per_second,
            "wordsPerSecond": measured.map(|rate| (rate * 100.0).round() / 100.0),
            "wordsPerMinute": measured.map(|rate| (rate * 60.0).round()),
            "captionStyle": captions
                .as_ref()
                .map(|style| style.preset.as_str())
                .unwrap_or("none"),
            "cues": cues.iter().map(describe_cue).collect::<Vec<_>>(),
            "captionsPlaced": placed,
        });
        // The loop the old surface left open: the caller planned at a rate, and this is what it
        // actually got. Only said when it matters, so it stays readable.
        if let Some(rate) = measured
            && (rate - target_words_per_second).abs() / target_words_per_second > 0.10
        {
            out["rateNote"] = serde_json::json!(format!(
                "this came out at {rate:.2} words a second ({:.0} wpm), not the {target:.2} \
                 asked for. Pass targetWordsPerSecond to aim somewhere else, or speed to set \
                 the multiplier yourself.",
                rate * 60.0,
                target = target_words_per_second,
            ));
        }
        Ok(out)
    }

    /// Put a list of cues on the timeline as caption elements.
    pub fn place_cues(&mut self, cues: &[Cue], style: &CaptionStyle) -> Result<usize, ToolError> {
        self.place_cues_with_words(cues, style, None)
    }

    fn place_cues_with_words(
        &mut self,
        cues: &[Cue],
        style: &CaptionStyle,
        timed_words: Option<(&[bay_speech::WordSpan], f64)>,
    ) -> Result<usize, ToolError> {
        // Captions are the largest block of type in most of these videos, so they go through the
        // same resolution gate `add_text` does: a family that does not shape is a whole video set
        // in a face nobody chose, and captions would otherwise be the one way past it.
        if let Some(family) = &style.font_family {
            self.require_face(family, style.font_weight, "the captions")?;
        }
        // Who is speaking over each cue, when anything has said. The floor belongs to whoever
        // owns the most words inside the cue rather than to whoever owns the first: a cue that
        // straddles a turn is mostly the new speaker, and labelling it with the old one puts the
        // wrong name on the line that changes the subject.
        let speakers: Vec<Option<String>> =
            if style.speaker_labels.is_empty() && style.speaker_colors.is_empty() {
                vec![None; cues.len()]
            } else {
                let word_speakers = self.projected_word_speakers();
                let words = timed_words.map(|(words, _)| words).unwrap_or(&[]);
                cues.iter()
                    .map(|cue| {
                        let mut tally: std::collections::BTreeMap<&str, usize> =
                            std::collections::BTreeMap::new();
                        for (index, word) in words.iter().enumerate() {
                            if word.start < cue.end
                                && word.end > cue.start
                                && let Some(Some(speaker)) = word_speakers.get(index)
                            {
                                *tally.entry(speaker.as_str()).or_default() += 1;
                            }
                        }
                        tally
                            .into_iter()
                            .max_by_key(|(_, count)| *count)
                            .map(|(speaker, _)| speaker.to_string())
                    })
                    .collect()
            };

        let mut previous: Option<String> = None;
        for (index, cue) in cues.iter().enumerate() {
            let id = format!("caption-{}", self.next_caption_id());
            let duration = cue.duration().max(0.05);
            let karaoke = karaoke_for_cue(cue, style, timed_words);
            let speaker = speakers.get(index).cloned().flatten();

            // Name the speaker only where the floor changes. Every line prefixed is a line of
            // frame spent on something the reader stopped reading after the second one.
            let mut cue = cue.clone();
            if speaker != previous
                && let Some(label) = speaker
                    .as_deref()
                    .and_then(|speaker| style.speaker_labels.get(speaker))
            {
                cue.text = format!("{label}: {}", cue.text);
            }
            let colour = speaker
                .as_deref()
                .and_then(|speaker| style.speaker_colors.get(speaker))
                .cloned();
            if speaker.is_some() {
                previous = speaker;
            }
            self.add_caption_element(&id, &cue, style, duration, Some(karaoke), colour)?;
        }
        Ok(cues.len())
    }

    /// Read an SRT or WebVTT file and place every cue as a caption.
    pub fn subtitles_add(&mut self, path: &str, offset: f64, style: &CaptionStyle) -> ToolResult {
        let source = std::fs::read_to_string(path)
            .map_err(|e| err(format!("could not read {path}: {e}")))?;
        let cues = bay_speech::parse(&source).map_err(err)?;
        let cues = if offset != 0.0 {
            bay_speech::shift(&cues, offset)
        } else {
            cues
        };
        let timed_words = self.projected_transcript_words();
        let placed = self.place_cues_with_words(
            &cues,
            style,
            timed_words.as_deref().map(|words| (words, 0.0)),
        )?;
        let last = cues.last().map(|cue| cue.end).unwrap_or(0.0);
        Ok(serde_json::json!({
            "path": path,
            "cues": placed,
            "firstSeconds": cues.first().map(|cue| cue.start).unwrap_or(0.0),
            "lastSeconds": last,
        }))
    }

    /// Project source transcript intervals through placed speech clips into timeline time.
    ///
    /// Transcript cuts are non-contiguous: each clip has its own source in-point and timeline
    /// start. A word survives only when its complete half-open source interval belongs to a
    /// placed clip. This both drops words from removed regions and prevents a word straddling a
    /// cut boundary from being presented as fully audible.
    /// The speaker of every projected word, in the same order — see
    /// [`Self::projected_transcript_words`]. Separate so the word timing, which every caption
    /// path needs, does not have to grow a type only the speaker-aware one reads.
    fn projected_word_speakers(&self) -> Vec<Option<String>> {
        let project = self.project();
        let mut projected: Vec<(f64, Option<String>)> = Vec::new();
        for element in project.active_scene().elements() {
            let Element::Audio(audio) = element else {
                continue;
            };
            if audio.role != bay_project::AudioRole::Speech || audio.speed <= 0.0 {
                continue;
            }
            let Some(transcript) = project
                .media
                .iter()
                .find(|asset| asset.id == audio.media_id)
                .and_then(|asset| asset.transcript.as_ref())
            else {
                continue;
            };
            let speed = f64::from(audio.speed);
            let source_start = audio.trim_start.to_seconds_f64();
            let source_end = source_start + audio.duration.to_seconds_f64() * speed;
            let timeline_start = audio.start.to_seconds_f64();
            projected.extend(
                transcript
                    .words
                    .iter()
                    .filter(|word| {
                        word.start_seconds >= source_start && word.end_seconds <= source_end
                    })
                    .map(|word| {
                        (
                            timeline_start + (word.start_seconds - source_start) / speed,
                            word.speaker.clone(),
                        )
                    }),
            );
        }
        projected.sort_by(|left, right| left.0.total_cmp(&right.0));
        projected.into_iter().map(|(_, speaker)| speaker).collect()
    }

    fn projected_transcript_words(&self) -> Option<Vec<bay_speech::WordSpan>> {
        let project = self.project();
        let mut has_word_timing = false;
        let mut projected = Vec::new();
        for element in project.active_scene().elements() {
            let Element::Audio(audio) = element else {
                continue;
            };
            if audio.role != bay_project::AudioRole::Speech || audio.speed <= 0.0 {
                continue;
            }
            let Some(transcript) = project
                .media
                .iter()
                .find(|asset| asset.id == audio.media_id)
                .and_then(|asset| asset.transcript.as_ref())
            else {
                continue;
            };
            has_word_timing |= !transcript.words.is_empty();
            let speed = f64::from(audio.speed);
            let source_start = audio.trim_start.to_seconds_f64();
            let source_end = source_start + audio.duration.to_seconds_f64() * speed;
            let timeline_start = audio.start.to_seconds_f64();
            projected.extend(
                transcript
                    .words
                    .iter()
                    .filter(|word| {
                        word.start_seconds >= source_start && word.end_seconds <= source_end
                    })
                    .map(|word| bay_speech::WordSpan {
                        text: word.text.clone(),
                        start: timeline_start + (word.start_seconds - source_start) / speed,
                        end: timeline_start + (word.end_seconds - source_start) / speed,
                    }),
            );
        }
        projected.sort_by(|left, right| {
            left.start
                .total_cmp(&right.start)
                .then_with(|| left.end.total_cmp(&right.end))
        });
        has_word_timing.then_some(projected)
    }

    /// Write the project's captions out as SRT or WebVTT.
    pub fn subtitles_export(&self, path: &str, format: &str) -> ToolResult {
        let cues = self.caption_cues();
        if cues.is_empty() {
            return Err(err(
                "there are no captions on the timeline to export — add some with narrate or \
                 subtitles_add first",
            ));
        }
        let body = match format {
            "srt" => bay_speech::to_srt(&cues),
            "vtt" => bay_speech::to_vtt(&cues),
            other => {
                return Err(err(format!(
                    "unknown subtitle format {other:?} — srt or vtt"
                )));
            }
        };
        std::fs::write(path, body).map_err(|e| err(format!("could not write {path}: {e}")))?;
        Ok(serde_json::json!({ "path": path, "format": format, "cues": cues.len() }))
    }

    /// Every caption currently on the timeline, as cues in timeline order.
    pub fn caption_cues(&self) -> Vec<Cue> {
        let mut cues: Vec<Cue> = self
            .project()
            .active_scene()
            .tracks
            .iter()
            .flat_map(|track| track.elements.iter())
            .filter_map(|element| match element {
                Element::Text(text) if text.id.starts_with("caption-") => Some(Cue {
                    start: text.start.to_seconds_f64(),
                    end: (text.start + text.duration).to_seconds_f64(),
                    text: text.content.clone(),
                }),
                _ => None,
            })
            .collect();
        cues.sort_by(|a, b| a.start.total_cmp(&b.start));
        cues
    }
}

fn karaoke_for_cue(
    cue: &Cue,
    style: &CaptionStyle,
    timed_words: Option<(&[bay_speech::WordSpan], f64)>,
) -> bay_project::KaraokeSpec {
    let words = match timed_words {
        Some((words, offset)) => words
            .iter()
            .filter_map(|word| {
                let start = word.start + offset;
                let end = word.end + offset;
                (start >= cue.start && start < cue.end).then(|| bay_project::KaraokeWord {
                    text: word.text.clone(),
                    start: bay_project::MediaTime::from_seconds_f64((start - cue.start).max(0.0))
                        .unwrap_or(bay_project::MediaTime::ZERO),
                    end: bay_project::MediaTime::from_seconds_f64(
                        (end - cue.start).min(cue.duration()).max(0.0),
                    )
                    .unwrap_or(bay_project::MediaTime::ZERO),
                })
            })
            .collect(),
        None => {
            let tokens: Vec<&str> = cue.text.split_whitespace().collect();
            let slice = cue.duration().max(0.05) / tokens.len().max(1) as f64;
            tokens
                .iter()
                .enumerate()
                .map(|(index, token)| bay_project::KaraokeWord {
                    text: (*token).to_string(),
                    start: bay_project::MediaTime::from_seconds_f64(index as f64 * slice)
                        .unwrap_or(bay_project::MediaTime::ZERO),
                    end: bay_project::MediaTime::from_seconds_f64((index + 1) as f64 * slice)
                        .unwrap_or(bay_project::MediaTime::ZERO),
                })
                .collect()
        }
    };
    bay_project::KaraokeSpec {
        words,
        highlight_color: style.highlight_color.clone(),
    }
}

fn describe_cue(cue: &Cue) -> serde_json::Value {
    serde_json::json!({
        "start": (cue.start * 1000.0).round() / 1000.0,
        "end": (cue.end * 1000.0).round() / 1000.0,
        "text": cue.text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_listen::SourceRange;
    use bay_project::{MediaAsset, Transcript, TranscriptWord};

    fn scratch_studio(tag: &str) -> (Studio, std::path::PathBuf) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("bay-word-captions-{tag}-{stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        (Studio::with_library_root(Some(root.clone())), root)
    }

    fn caption_words(studio: &Studio) -> Vec<Vec<bay_project::KaraokeWord>> {
        let mut captions = studio
            .project()
            .active_scene()
            .elements()
            .filter_map(|element| match element {
                Element::Text(text) if text.id.starts_with("caption-") => Some(text),
                _ => None,
            })
            .collect::<Vec<_>>();
        captions.sort_by_key(|caption| caption.start);
        captions
            .into_iter()
            .map(|caption| caption.karaoke.clone().unwrap().words)
            .collect()
    }

    #[test]
    fn subtitle_karaoke_projects_transcript_words_across_non_contiguous_cuts() {
        let (mut studio, root) = scratch_studio("projected");
        let mut asset = MediaAsset::new(
            "interview",
            "interview.wav",
            root.join("missing.wav").to_string_lossy(),
        );
        asset.duration_seconds = Some(30.0);
        asset.transcript = Some(Transcript {
            language: "en".into(),
            model: "test".into(),
            duration_seconds: 30.0,
            words: vec![
                TranscriptWord {
                    text: "first".into(),
                    start_seconds: 10.2,
                    end_seconds: 10.5,
                    confidence: 1.0,
                    speaker: None,
                },
                TranscriptWord {
                    text: "kept".into(),
                    start_seconds: 11.1,
                    end_seconds: 11.4,
                    confidence: 1.0,
                    speaker: None,
                },
                TranscriptWord {
                    text: "removed".into(),
                    start_seconds: 15.0,
                    end_seconds: 15.4,
                    confidence: 1.0,
                    speaker: None,
                },
                TranscriptWord {
                    text: "second".into(),
                    start_seconds: 20.1,
                    end_seconds: 20.6,
                    confidence: 1.0,
                    speaker: None,
                },
            ],
            utterances: Vec::new(),
        });
        studio.editor_for_test_mut().add_media(asset);
        studio
            .cut_by_transcript(
                "interview",
                &[
                    SourceRange {
                        start_seconds: 10.0,
                        end_seconds: 12.0,
                        text: "first kept".into(),
                    },
                    SourceRange {
                        start_seconds: 20.0,
                        end_seconds: 22.0,
                        text: "second".into(),
                    },
                ],
                0.0,
                0,
            )
            .unwrap();
        let path = root.join("captions.srt");
        std::fs::write(
            &path,
            "1\n00:00:00,000 --> 00:00:02,000\nfirst kept\n\n\
             2\n00:00:02,000 --> 00:00:04,000\nsecond\n\n",
        )
        .unwrap();

        studio
            .subtitles_add(path.to_str().unwrap(), 0.0, &CaptionStyle::default())
            .unwrap();

        let words = caption_words(&studio);
        assert_eq!(
            words
                .iter()
                .flatten()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>(),
            ["first", "kept", "second"]
        );
        assert!((words[0][0].start.to_seconds_f64() - 0.2).abs() < 1e-6);
        assert!((words[0][1].start.to_seconds_f64() - 1.1).abs() < 1e-6);
        assert!((words[1][0].start.to_seconds_f64() - 0.1).abs() < 1e-6);
    }

    #[test]
    fn subtitle_karaoke_evenly_divides_cues_without_word_timings() {
        let (mut studio, root) = scratch_studio("fallback");
        let path = root.join("captions.srt");
        std::fs::write(
            &path,
            "1\n00:00:00,000 --> 00:00:02,000\nfallback remains\n\n",
        )
        .unwrap();

        studio
            .subtitles_add(path.to_str().unwrap(), 0.0, &CaptionStyle::default())
            .unwrap();

        let words = caption_words(&studio);
        assert_eq!(words[0].len(), 2);
        assert_eq!(words[0][0].start.to_seconds_f64(), 0.0);
        assert_eq!(words[0][0].end.to_seconds_f64(), 1.0);
        assert_eq!(words[0][1].start.to_seconds_f64(), 1.0);
        assert_eq!(words[0][1].end.to_seconds_f64(), 2.0);
    }
}
