//! Narration and subtitle tools for the [`Studio`](crate::studio::Studio).
//!
//! Three things an agent needs and could not do before: speak a script, put captions on the
//! timeline, and turn a subtitle file into a video. They share one representation — a
//! [`Cue`] — so narration-derived captions and imported SRT captions are the same thing
//! downstream and get the same styling.

use vii_project::Element;
use vii_speech::{Cue, CueStyle};

use crate::studio::{Studio, ToolError, ToolResult, err};

/// How a caption block is drawn. Defaults are sized for a 1080x1920 social reel, sitting above
/// the platform caption band rather than under it.
#[derive(Debug, Clone)]
pub struct CaptionStyle {
    pub font_size: f32,
    pub color: String,
    pub font_family: Option<String>,
    pub font_weight: u16,
    /// Vertical position of the caption box's top, as a fraction of the canvas.
    pub y: f32,
    pub layer: usize,
    /// Fade in/out time in seconds. A hard cut on every caption reads as a flicker.
    pub fade: f64,
}

impl Default for CaptionStyle {
    fn default() -> Self {
        Self {
            font_size: 46.0,
            color: "#EDECE6".to_string(),
            font_family: None,
            font_weight: 600,
            y: 0.70,
            layer: 9,
            fade: 0.12,
        }
    }
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
                "hint": "create the venv with `uv venv --python 3.12 ~/.local/share/vii/kokoro-venv` \
                         then `uv pip install kokoro soundfile`; see docs/native/speech.md",
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
    #[allow(clippy::too_many_arguments)]
    pub fn narrate(
        &mut self,
        text: &str,
        voice: &str,
        speed: f32,
        lang_code: &str,
        start: f64,
        volume: f32,
        out_path: Option<String>,
        peak_db: Option<f32>,
        style: CueStyle,
        captions: Option<CaptionStyle>,
    ) -> ToolResult {
        let out_path = out_path.unwrap_or_else(|| {
            std::env::temp_dir()
                .join(format!("vii-narration-{}.wav", self.next_narration_id()))
                .to_string_lossy()
                .to_string()
        });

        let utterance = self
            .speech()
            .speak_normalized(text, voice, speed, lang_code, &out_path, peak_db)
            .map_err(|error| err(error.to_string()))?;

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
        )?;

        let cues = vii_speech::shift(&utterance.cues(&style), start);
        let placed = match captions {
            Some(caption_style) => Some(self.place_cues(&cues, &caption_style)?),
            None => None,
        };

        Ok(serde_json::json!({
            "audioPath": utterance.path,
            "mediaId": media_id,
            "voice": utterance.voice,
            "startSeconds": start,
            "durationSeconds": utterance.duration_seconds,
            "endSeconds": start + utterance.duration_seconds,
            "words": utterance.words.len(),
            "cues": cues.iter().map(describe_cue).collect::<Vec<_>>(),
            "captionsPlaced": placed,
        }))
    }

    /// Put a list of cues on the timeline as caption elements.
    pub fn place_cues(&mut self, cues: &[Cue], style: &CaptionStyle) -> Result<usize, ToolError> {
        if let Some(family) = &style.font_family
            && !self.has_font_family(family)
        {
            return Err(err(format!(
                "caption font family {family:?} is not installed — call fonts_check first"
            )));
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
        let cues = vii_speech::parse(&source).map_err(err)?;
        let cues = if offset != 0.0 {
            vii_speech::shift(&cues, offset)
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
            "srt" => vii_speech::to_srt(&cues),
            "vtt" => vii_speech::to_vtt(&cues),
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
