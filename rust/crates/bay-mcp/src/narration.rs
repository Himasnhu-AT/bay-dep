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

        let utterance = self
            .speech()
            .speak_normalized(&text, &voice, speed, &lang_code, &out_path, peak_db)
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
        let media = self.media_import(&utterance.path, None)?;
        let media_id = media
            .get("mediaId")
            .and_then(|id| id.as_str())
            .ok_or_else(|| err("media_import did not return a mediaId"))?
            .to_string();
        self.add_audio(
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
        )?;

        let cue_style = captions
            .as_ref()
            .map(CaptionStyle::cue_style)
            .unwrap_or_default();
        // Against the script, not just the word timings: the sidecar drops punctuation tokens,
        // so a full stop is only visible here.
        let cues = bay_speech::shift(&utterance.cues_for(&text, &cue_style), start);
        let placed = match &captions {
            Some(caption_style) => Some(self.place_cues(&cues, caption_style)?),
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
        // Captions are the largest block of type in most of these videos, so they go through the
        // same resolution gate `add_text` does: a family that does not shape is a whole video set
        // in a face nobody chose, and captions would otherwise be the one way past it.
        if let Some(family) = &style.font_family {
            self.require_face(family, style.font_weight, "the captions")?;
        }
        for cue in cues {
            let id = format!("caption-{}", self.next_caption_id());
            let duration = cue.duration().max(0.05);
            self.add_caption_element(&id, cue, style, duration)?;
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
        let placed = self.place_cues(&cues, style)?;
        let last = cues.last().map(|cue| cue.end).unwrap_or(0.0);
        Ok(serde_json::json!({
            "path": path,
            "cues": placed,
            "firstSeconds": cues.first().map(|cue| cue.start).unwrap_or(0.0),
            "lastSeconds": last,
        }))
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

fn describe_cue(cue: &Cue) -> serde_json::Value {
    serde_json::json!({
        "start": (cue.start * 1000.0).round() / 1000.0,
        "end": (cue.end * 1000.0).round() / 1000.0,
        "text": cue.text,
    })
}
