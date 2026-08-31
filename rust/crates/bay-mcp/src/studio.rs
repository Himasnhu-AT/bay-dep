//! The editing surface the MCP tools drive.
//!
//! [`Studio`] owns an [`Editor`] (the project + undo stack) and, lazily, a
//! [`PreviewRenderer`] (the GPU compositor). Every tool is a method here that takes already
//! parsed arguments and returns a `serde_json::Value`; the protocol layer in `server.rs` knows
//! nothing about video and this module knows nothing about JSON-RPC.
//!
//! **Layers.** The scene's z-order is `main` (bottom) then `overlay[0..]` (upward). Tools take
//! a single `layer` integer instead of a track id: `0` is main, `n` is `overlay[n-1]`, and
//! missing overlay lanes are created on demand. That makes stacking order an explicit,
//! orderable number rather than something an author has to infer from track names.

use std::collections::BTreeMap;

use bay_core::{Command, Editor, ElementRef, TrackLane};
use bay_preview::PreviewRenderer;
use bay_project::{
    AnimationChannel, AudioElement, AudioRole, BlendMode, CanvasSize, Easing, Element, ElementRole,
    ElementSource, Fps, ImageElement, KaraokeSpec, MediaAsset, MediaTime, Project,
    SemanticMediaIndex, SemanticShot, ShapeElement, ShapeKind, StyleHistory, StyleKit, TextAlign,
    TextDecorations, TextElement, Tone, TrackKind, Transform, VideoElement, is_caption_id,
    kit as style,
};

/// Anything a tool can refuse to do. Surfaces to the caller as an MCP tool error, which the
/// agent sees and can correct — so the messages name the offending value.
#[derive(Debug)]
pub struct ToolError(pub String);

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ToolError {}

pub type ToolResult = Result<serde_json::Value, ToolError>;

pub fn err(message: impl Into<String>) -> ToolError {
    ToolError(message.into())
}

/// Refuse an id bay reserves for its own output.
///
/// `caption-<n>` is what `narrate` and the subtitle tools mint, and it is what tells everything
/// downstream — the SRT exporter, the provenance inferred when an old project is opened, every
/// distribution that filters to authored work — that an element is bay's rather than the
/// author's. A caller allowed to take the name could hand its own elements bay's provenance,
/// which is the one thing an unforgeable field must not permit.
fn reject_reserved_id(id: &str) -> Result<(), ToolError> {
    if is_caption_id(id) {
        return Err(err(format!(
            "{id:?} is reserved: ids of the form caption-<number> belong to narrate and the \
             subtitle tools, which is how captions are told apart from what you wrote. Pick \
             another id."
        )));
    }
    Ok(())
}

fn secs(seconds: f64) -> Result<MediaTime, ToolError> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(err(format!(
            "time must be a finite, non-negative number of seconds (got {seconds})"
        )));
    }
    MediaTime::from_seconds_f64(seconds).ok_or_else(|| {
        err(format!(
            "{seconds}s is outside the representable time range"
        ))
    })
}

/// Explain whether a named move was added, appended, or replaced before the transaction lands.
///
/// Repeating a move at the same `at` is intentionally replacement: two key runs cannot both own
/// the same channel at the same time. A caller that wants thirty accents must give thirty
/// non-overlapping starts. Returning that decision makes the merge rule observable instead of
/// reducing a long authoring session to one unexplained motion signature.
fn named_move_report(project: &Project, args: &serde_json::Value) -> Option<serde_json::Value> {
    let move_id = args.get("move")?.as_str()?;
    let element_id = args.get("elementId")?.as_str()?;
    let chosen = bay_project::moves::find(move_id)?;
    let element = project
        .active_scene()
        .elements()
        .find(|element| element.id() == element_id)?;
    let at = args
        .get("at")
        .and_then(|value| value.as_f64())
        .unwrap_or(0.0);
    let animations = element.animations()?;
    let channels = chosen
        .channels
        .iter()
        .map(|channel| {
            let starts_at = at
                + f64::from(channel.keys.first().map(|key| key.frame).unwrap_or(0.0))
                    / bay_project::moves::REFERENCE_FPS as f64;
            let action = match animations
                .get(channel.property)
                .and_then(|existing| existing.keys.last())
            {
                None => "added",
                Some(last) if last.time.to_seconds_f64() <= starts_at => "appended",
                Some(_) => "replaced-overlap",
            };
            serde_json::json!({
                "property": channel.property,
                "action": action,
                "startsAtSeconds": starts_at,
            })
        })
        .collect::<Vec<_>>();
    Some(serde_json::json!({
        "move": move_id,
        "atSeconds": at,
        "durationSeconds": chosen.duration_seconds(),
        "channels": channels,
        "appendRule": "a channel appends only when its existing last key is at or before the \
                       new move's first key; overlapping calls replace that channel",
        "signatureRule": "motionSignatures is the distinct set of named moves on each element, \
                          not an occurrence count; repeated nudge calls remain one signature",
    }))
}

/// The placement + look shared by every visual element, parsed once from tool arguments.
pub struct VisualArgs {
    pub transform: Transform,
    pub blend_mode: BlendMode,
}

/// Everything `add_text` needs that is not placement.
///
/// A struct rather than eight more positional arguments, and a short one on purpose: the family,
/// the size, the weight and the colour used to be here and are not any more. What an element is
/// *for* (`role`) and how loud it is (`tone`) is the whole surface; the committed [`StyleKit`]
/// answers the rest.
pub struct TextArgs {
    pub content: String,
    pub role: ElementRole,
    pub tone: Tone,
    pub align: TextAlign,
    /// Tracking in em, overriding the ramp's. Rarely needed — the ramp already opens up an
    /// uppercase kicker and closes in display type.
    pub letter_spacing: Option<f32>,
    /// Line box as a multiple of the size, overriding the ramp's.
    pub line_height: Option<f32>,
    pub decorations: Option<TextDecorations>,
    /// Reveal the line a character at a time instead of showing it whole.
    pub type_on: Option<bay_project::TypeOn>,
}

/// How a caller said which style kit it wants.
pub enum KitChoice {
    /// "Here is what the video is about" — the picker seeds on it and decides.
    Brief(String),
    /// A named built-in.
    Named(String),
    /// One the caller declared in full. Validated, and deliberately more work than accepting an
    /// offer.
    Custom(Box<StyleKit>),
}

pub struct Studio {
    editor: Editor,
    renderer: Option<PreviewRenderer>,
    /// Set when the GPU was tried and refused, so a headless box reports the real reason
    /// instead of retrying the adapter request on every single frame.
    renderer_unavailable: Option<String>,
    text_probe: bay_text::TextRaster,
    /// The Kokoro sidecar, owned for the studio's whole lifetime. Building one per call would
    /// spawn and kill the model on every line of narration — the exact cost the sidecar exists
    /// to avoid.
    speech: bay_speech::SpeechEngine,
    /// Whisper is loaded lazily because transcription is optional, then retained so a sequence
    /// of transcript edits does not reload 190 MB of weights.
    listener: Option<bay_listen::Listener>,
    next_id: u64,
    next_caption: u64,
    /// Engine-measured panels from the most recent critic preparation. The caller only sends
    /// forced choices; it cannot replace hashes or ICGS with self-reported values.
    critic_panels: Vec<bay_agent::trust::PanelEvidence>,
    /// Where pathless saves go. `None` means the user's real project library — which is why
    /// tests always set this: a test run must never deposit projects in someone's library.
    library_root: Option<std::path::PathBuf>,
}

impl Default for Studio {
    fn default() -> Self {
        Self::new()
    }
}

impl Studio {
    pub fn new() -> Self {
        Self::with_library_root(None)
    }

    /// A studio whose sidecar uses `port` instead of the product's fixed one.
    ///
    /// Tests only, and not a convenience: `CLAUDE.md` requires that a test never depend on a
    /// shared machine resource. Driving the narration tests through the real port made them
    /// fail whenever anything else on the machine — another test binary, a `bay --mcp` someone
    /// left running — held it, which is precisely how a real failure gets dismissed as flake.
    #[cfg(test)]
    pub(crate) fn for_test(library_root: std::path::PathBuf, speech_port: u16) -> Self {
        let mut studio = Self::with_library_root(Some(library_root));
        studio.speech = bay_speech::SpeechEngine::new(bay_speech::SpeechConfig {
            port: speech_port,
            ..bay_speech::SpeechConfig::default()
        });
        studio
    }

    /// A studio whose pathless saves land in `root` instead of the user's project library.
    pub fn with_library_root(library_root: Option<std::path::PathBuf>) -> Self {
        Self {
            editor: Editor::new(empty_project(
                "Untitled",
                CanvasSize {
                    width: 1080,
                    height: 1920,
                },
                Fps {
                    numerator: 30,
                    denominator: 1,
                },
                "#000000",
                None,
            )),
            renderer: None,
            renderer_unavailable: None,
            text_probe: bay_text::TextRaster::new(),
            speech: bay_speech::SpeechEngine::new(bay_speech::SpeechConfig::default()),
            listener: None,
            next_id: 1,
            next_caption: 0,
            critic_panels: Vec::new(),
            library_root,
        }
    }

    /// Which kits have been committed lately, so the next offer can step over them.
    ///
    /// Follows `library_root` for the same reason the library does: a test run must never write
    /// into — or read a decision out of — the user's own data directory.
    fn history(&self) -> Option<StyleHistory> {
        match &self.library_root {
            Some(root) => Some(StyleHistory::at(root.join(style::HISTORY_FILE))),
            None => StyleHistory::open_default(),
        }
    }

    /// The project library this studio saves into.
    fn library(&self) -> Result<bay_project::ProjectLibrary, ToolError> {
        match &self.library_root {
            Some(root) => bay_project::ProjectLibrary::with_root(root),
            None => bay_project::ProjectLibrary::open_default(),
        }
        .map_err(|e| err(format!("could not open the project library: {e}")))
    }

    /// Replace a media asset, for tests that need a transcript the recogniser would have
    /// written. Diarised speaker labels are the input to speaker-aware captions, and standing
    /// up a real recogniser to get two of them is a slower test that checks less.
    #[cfg(test)]
    pub(crate) fn replace_media_for_test(&mut self, asset: bay_project::MediaAsset) {
        self.editor.add_media(asset);
    }

    pub fn project(&self) -> &Project {
        self.editor.project()
    }

    /// Snapshot the headless document for a background job.
    ///
    /// The render worker owns this clone, so the single-writer studio can keep answering reads
    /// and edits while an encode runs without sharing its editor or GPU renderer across threads.
    pub(crate) fn slow_context(&self) -> bay_agent::slow::SlowContext {
        bay_agent::slow::SlowContext {
            project: self.editor.project().clone(),
            timeline_duration: self.editor.duration().to_seconds_f64(),
            next_id: self.next_id as usize,
        }
    }

    /// Editor access for tests that assert on history. Not part of the tool surface.
    #[cfg(test)]
    pub(crate) fn editor_for_test(&self) -> &Editor {
        &self.editor
    }

    #[cfg(test)]
    pub(crate) fn editor_for_test_mut(&mut self) -> &mut Editor {
        &mut self.editor
    }

    fn fresh_id(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}-{}", self.next_id);
        self.next_id += 1;
        id
    }

    /// Sequence number for the next narration WAV, so repeated calls do not overwrite one
    /// another's audio on disk.
    pub(crate) fn next_narration_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    /// Sequence number for the next caption element. Caption ids are prefixed `caption-`,
    /// which is also how `caption_cues` recognises them for export.
    pub(crate) fn next_caption_id(&mut self) -> u64 {
        self.next_caption += 1;
        self.next_caption
    }

    /// Refuse a `(family, weight)` that will not render as asked — **the font resolution gate**.
    ///
    /// cosmic-text does not snap to the nearest weight. It drops the family and shapes in
    /// something else entirely, and every frame still comes out, so nothing downstream can tell:
    /// measured on this machine, `Avenir` at 700 shapes in **Menlo Bold** — a terminal face — and
    /// `Baskerville` at 900 in **Apple SD Gothic Neo Heavy**, a Korean UI face. The obvious
    /// typographic improvement ("extreme weight contrast, 300 against 900") therefore ships a
    /// video set in two faces nobody chose, while passing every check bay has.
    ///
    /// The answer comes from shaping one glyph and reading the face id off it, not from asking
    /// the font database what exists — so it is the renderer's own answer, and there is nothing
    /// to game: it can only be satisfied by naming a face that is really there.
    pub(crate) fn require_face(
        &mut self,
        family: &str,
        weight: u16,
        what: &str,
    ) -> Result<(), ToolError> {
        let Some(resolved) = self.text_probe.resolve_face(family, weight) else {
            return Err(err(format!(
                "no fonts at all are installed on this machine, so {what} cannot be set"
            )));
        };
        if resolved.is(family) && resolved.weight == weight {
            return Ok(());
        }
        let weights = self.text_probe.resolvable_weights(family);
        let available = if weights.is_empty() {
            format!("{family:?} is not installed here at all")
        } else {
            format!("{family:?} is installed at weight(s) {weights:?}")
        };
        Err(err(format!(
            "{what} asks for {family:?} at weight {weight}, and this machine would render it in \
             {:?} at weight {} instead — cosmic-text drops the family rather than snapping to the \
             nearest weight, so the whole block would come out in a face nobody chose. {available}. \
             Call fonts_check for the weights a family really has, or style_pick for a kit whose \
             typefaces are installed here.",
            resolved.family, resolved.weight,
        )))
    }

    pub(crate) fn speech(&mut self) -> &mut bay_speech::SpeechEngine {
        &mut self.speech
    }

    /// Place one caption: centred text across the content width, fading in and out so a cut
    /// between neighbouring captions does not read as a flicker.
    /// Place one caption. `colour` overrides the style's own, which is how a speaker-coloured
    /// caption carries who is talking without spending any of the frame; `None` keeps the
    /// style's.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn add_caption_element(
        &mut self,
        id: &str,
        cue: &bay_speech::Cue,
        style: &crate::narration::CaptionStyle,
        duration: f64,
        karaoke: Option<KaraokeSpec>,
        colour: Option<String>,
    ) -> Result<(), ToolError> {
        let element = Element::Text(TextElement {
            id: id.to_string(),
            name: cue.text.chars().take(24).collect(),
            start: secs(cue.start)?,
            duration: secs(duration)?,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: cue.text.clone(),
            font_size: style.font_size,
            color: colour.unwrap_or_else(|| style.color.clone()),
            transform: Transform {
                x: style.x,
                y: style.y,
                scale: style.scale,
                anchor_x: style.anchor_x(),
                anchor_y: 0.0,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: BlendMode::Normal,
            mask: None,
            font_family: style.font_family.clone(),
            font_weight: style.font_weight,
            align: style.align,
            letter_spacing: style.letter_spacing,
            line_height: style.line_height,
            decorations: None,
            karaoke,
            type_on: None,
            // bay wrote this, not the author. Everything downstream that measures type size,
            // position or motion has to be able to leave it out — 38 of the 73 text elements in
            // the project that prompted provenance are exactly this call's output, and counting
            // them inverted four separate motion measurements.
            source: ElementSource::Tool,
            role: ElementRole::Caption,
        });
        let track_id = self.track_for_layer(style.layer);
        if !self.editor.execute(Command::AddElement {
            track_id,
            element,
            select: false,
        }) {
            return Err(err("could not add the caption to the timeline"));
        }

        // Fade the caption in and out inside its own window. Clamped so a very short cue does
        // not end up with a fade longer than the caption itself.
        let fade = style.fade.min(duration / 3.0).max(0.0);
        if fade > 0.0 {
            let mut channel = AnimationChannel {
                keys: Vec::new(),
                easing: Easing::EaseOut,
            };
            for (t, value) in [
                (0.0, 0.0),
                (fade, 1.0),
                (duration - fade, 1.0),
                (duration, 0.0),
            ] {
                channel.upsert(secs(t)?, value);
            }
            self.set_channel(id, "opacity", channel)?;
        }
        Ok(())
    }

    /// Write one animation channel onto an element, through a reversible command.
    ///
    /// bay's own, for the caption fade. It is deliberately *not* the agent-facing `animate`:
    /// that one is planned by `bay_agent::plan` like every other revising tool, so the live
    /// editor and the wire cannot come to disagree about what an animation is.
    fn set_channel(
        &mut self,
        element_id: &str,
        property: &str,
        channel: AnimationChannel,
    ) -> Result<(), ToolError> {
        let reference = self
            .find_element_ref(element_id)
            .ok_or_else(|| err(format!("no element {element_id:?} on the timeline")))?;
        let element = self
            .editor
            .active_scene()
            .element(&reference)
            .ok_or_else(|| err(format!("no element {element_id:?} on the timeline")))?;
        let mut animations = element
            .animations()
            .cloned()
            .ok_or_else(|| err(format!("{element_id:?} has nothing to animate")))?;
        let effects = element.effects().to_vec();
        animations.insert(property.to_string(), channel);
        if !self.editor.execute(Command::ApplyMotionPreset {
            reference,
            effects,
            animations,
        }) {
            return Err(err(format!("could not animate {element_id:?}")));
        }
        Ok(())
    }

    /// The compositor, built on first use. Held open afterwards because adapter acquisition
    /// costs far more than a frame does.
    fn renderer(&mut self) -> Result<&mut PreviewRenderer, ToolError> {
        if self.renderer.is_none() {
            if let Some(reason) = &self.renderer_unavailable {
                return Err(err(reason.clone()));
            }
            match PreviewRenderer::new() {
                Some(renderer) => self.renderer = Some(renderer),
                None => {
                    let reason = "no GPU adapter available — bay cannot composite frames on \
                                  this machine (a headless Linux box usually needs a Vulkan \
                                  or GL driver installed)"
                        .to_string();
                    self.renderer_unavailable = Some(reason.clone());
                    return Err(err(reason));
                }
            }
        }
        Ok(self.renderer.as_mut().expect("just constructed"))
    }

    // ---------------------------------------------------------------- project

    pub fn project_create(
        &mut self,
        name: &str,
        canvas: CanvasSize,
        fps: Fps,
        background: Option<&str>,
        choice: KitChoice,
        format: Option<&str>,
    ) -> ToolResult {
        let (width, height) = (canvas.width, canvas.height);
        if width == 0 || height == 0 {
            return Err(err("canvas width and height must both be non-zero"));
        }
        if fps.numerator == 0 {
            return Err(err("fps must be at least 1"));
        }
        if fps.denominator == 0 {
            return Err(err("fpsDenominator must be at least 1"));
        }
        if let Some(id) = format
            && bay_project::format::by_id(id).is_none()
        {
            return Err(err(format!(
                "unknown format {id:?} — one of: {}",
                bay_project::format::ids().join(", ")
            )));
        }
        let (kit, alternatives) = self.resolve_kit(&choice)?;
        // The ground is the kit's, unless the caller insisted. A background chosen apart from the
        // palette is exactly the "five colours, none of them a decision" state that the kit
        // exists to close, so it is reported back rather than accepted silently.
        let ground = background.unwrap_or(&kit.palette.bg).to_string();
        let mut project = empty_project(name, canvas, fps, &ground, Some(kit.clone()));
        project.settings.format = format.map(str::to_string);
        self.editor.load_project(project);
        self.next_id = 1;
        self.critic_panels.clear();
        self.record_kit(&kit.id);
        let mut out = serde_json::json!({
            "name": name,
            "canvas": { "width": width, "height": height },
            "fps": self.editor.project().settings.fps.as_f64(),
            "frameRate": { "numerator": fps.numerator, "denominator": fps.denominator },
            "format": describe_format(bay_project::format::resolve(format)),
            "background": ground,
            "kit": describe_kit(&kit),
            "alternatives": alternatives,
        });
        if let Some(given) = background
            && !given.eq_ignore_ascii_case(&kit.palette.bg)
        {
            out["backgroundWarning"] = serde_json::json!(format!(
                "the canvas is {given}, which is not the {} kit's ground ({}). check reports \
                 every colour the kit does not name as off-token-value.",
                kit.id, kit.palette.bg
            ));
        }
        Ok(out)
    }

    /// The kit this project is committed to, committing one if it has none.
    ///
    /// The tool layer needs it before it can decode arguments — to say what a rejected
    /// `fontSize` should have been, and to look a `framing` name up — so it is reachable from
    /// there rather than only from inside the placement calls.
    pub fn committed_kit(&mut self) -> Result<StyleKit, ToolError> {
        self.kit()
    }

    /// The kit this project is committed to.
    ///
    /// A project written before kits existed has none. Rather than refusing to draw on it — which
    /// would make every old project unopenable — the first tool that needs a kit commits one.
    fn kit(&mut self) -> Result<StyleKit, ToolError> {
        if let Some(kit) = &self.editor.project().settings.kit {
            return Ok(kit.clone());
        }
        let (kit, _) = self.resolve_kit(&KitChoice::Brief(
            self.editor.project().metadata.name.clone(),
        ))?;
        self.commit_kit(kit.clone());
        self.record_kit(&kit.id);
        Ok(kit)
    }

    /// The kit a caller asked for, plus the ids of everything else the picker offered.
    fn resolve_kit(&mut self, choice: &KitChoice) -> Result<(StyleKit, Vec<String>), ToolError> {
        match choice {
            KitChoice::Named(id) => {
                let kit = bay_project::builtin_kit(id).ok_or_else(|| {
                    err(format!(
                        "no style kit {id:?} — bay ships {:?}. Call style_pick with a brief to be \
                         offered three that suit it, or pass a whole kit as customKit.",
                        bay_project::builtin_kit_ids()
                    ))
                })?;
                Ok((kit.clone(), vec![kit.id.clone()]))
            }
            KitChoice::Custom(kit) => {
                // The shaping probe, not the database: a custom kit has to clear exactly the
                // gate `add_text` will apply to every element drawn with it, or it commits a
                // look that refuses every placement made against it.
                let probe = &mut self.text_probe;
                kit.validate(|family, weight| {
                    probe
                        .resolve_face(family, weight)
                        .is_some_and(|face| face.is(family) && face.weight == weight)
                })
                .map_err(|problems| {
                    err(format!(
                        "that custom kit is not usable:\n  - {}",
                        problems.join("\n  - ")
                    ))
                })?;
                Ok((kit.as_ref().clone(), vec!["custom".to_string()]))
            }
            KitChoice::Brief(brief) => {
                let recent = self
                    .history()
                    .map(|history| history.recent(style::HISTORY_EXCLUDED))
                    .unwrap_or_default();
                let offered = style::offer(brief, &style::today(), &recent);
                let ids: Vec<String> = offered.iter().map(|kit| kit.id.clone()).collect();
                let kit = offered
                    .first()
                    .copied()
                    .ok_or_else(|| err("bay ships no style kits, which cannot happen"))?;
                Ok((kit.clone(), ids))
            }
        }
    }

    fn commit_kit(&mut self, kit: StyleKit) {
        // Through a command, not `project_mut`: taking that handle clears the undo history, so
        // choosing a look would throw away the ability to undo everything done before it.
        self.editor
            .execute(Command::SetStyleKit { kit: Box::new(kit) });
    }

    fn commit_plan(&mut self, plan: bay_project::PlanArtifact) {
        self.editor.execute(Command::SetPlan {
            plan: Box::new(plan),
        });
    }

    fn record_kit(&self, id: &str) {
        if let Some(history) = self.history() {
            history.record(id, &style::today());
        }
    }

    /// `style_pick`: three kits to choose between, or the one being committed.
    ///
    /// Offering without committing is the normal first call. The offer is seeded by the brief and
    /// today's date and steps over the last five kits this machine committed, so the same brief a
    /// week later cannot land on the same look — which is the whole mechanism against "the house
    /// palette" reappearing under another name.
    pub fn style_pick(&mut self, brief: &str, choice: Option<KitChoice>) -> ToolResult {
        match choice {
            Some(choice) => {
                let (kit, _) = self.resolve_kit(&choice)?;
                self.commit_kit(kit.clone());
                self.record_kit(&kit.id);
                // Everything already on the timeline was drawn against the old kit; say so
                // rather than leaving a project in two looks at once.
                let stale = kit
                    .off_token_values(self.editor.project().active_scene())
                    .len();
                let mut out = serde_json::json!({
                    "committed": kit.id,
                    "kit": describe_kit(&kit),
                });
                if stale > 0 {
                    out["restyle"] = serde_json::json!(format!(
                        "{stale} value(s) already on the timeline are not this kit's. Elements \
                         placed before the switch keep the look they were given."
                    ));
                }
                Ok(out)
            }
            None => {
                let recent = self
                    .history()
                    .map(|history| history.recent(style::HISTORY_EXCLUDED))
                    .unwrap_or_default();
                let offered = style::offer(brief, &style::today(), &recent);
                Ok(serde_json::json!({
                    "brief": brief,
                    "offers": offered.iter().map(|kit| describe_kit(kit)).collect::<Vec<_>>(),
                    "recentlyUsed": recent,
                    "next": "call style_pick again with kit: \"<id>\" to commit one, or pass \
                             customKit to declare your own (which is validated, and more work).",
                }))
            }
        }
    }

    /// Run a tool that [`bay_agent::plan`] owns: plan it against this project, then execute the
    /// commands it returned.
    ///
    /// The planner is pure and is the same one the editor window uses, so a revising tool has
    /// exactly one definition. Duplicating them here is how `element_trim` would come to mean
    /// "eat the source" in the window and "reposition" over the wire — the two front ends must
    /// not be able to disagree about what an edit is.
    pub fn apply_planned(&mut self, name: &str, args: &serde_json::Value) -> ToolResult {
        let motion = named_move_report(self.editor.project(), args);
        let planned = bay_agent::plan(name, args, self.editor.project()).map_err(err)?;
        match planned {
            bay_agent::Planned::Read(value) => Ok(value),
            bay_agent::Planned::Tx {
                label,
                commands,
                new_ids,
                ..
            } => {
                // No scene check: this studio is the only writer, so the project cannot have
                // moved between planning and applying the way it can with a window open.
                let mut applied = 0usize;
                for command in commands {
                    if self.editor.execute(command) {
                        applied += 1;
                    }
                }
                if applied == 0 {
                    return Err(err(format!(
                        "{label} changed nothing — re-read the timeline and check the values"
                    )));
                }
                let revised_text = matches!(name, "text_update" | "transform_set")
                    .then(|| args.get("elementId")?.as_str())
                    .flatten()
                    .and_then(|id| {
                        self.editor
                            .active_scene()
                            .elements()
                            .find(|element| element.id() == id)
                    })
                    .and_then(|element| match element {
                        Element::Text(text) => Some(text.clone()),
                        _ => None,
                    });
                let text_layout = revised_text
                    .as_ref()
                    .and_then(|text| self.text_layout(text));
                let mut result = serde_json::json!({
                    "applied": applied,
                    "tool": label,
                    "ids": new_ids,
                    "durationSeconds": self.editor.duration().to_seconds_f64(),
                });
                if let Some(layout) = text_layout {
                    result["textLayout"] = layout;
                }
                if let Some(motion) = motion {
                    result["motion"] = motion;
                }
                Ok(result)
            }
        }
    }

    pub fn project_info(&self) -> ToolResult {
        let project = self.editor.project();
        let scene = project.active_scene();
        let visual: usize = scene
            .tracks
            .iter()
            .filter(|t| !matches!(t.kind, TrackKind::Audio))
            .map(|t| t.elements.len())
            .sum();
        let audio: usize = scene.tracks.audio.iter().map(|t| t.elements.len()).sum();
        // Reported separately because they are not the same population. Counting bay's own
        // captions as elements the author placed is how a project of 73 titles was read as one
        // choice repeated 73 times when 38 of them were never a choice at all.
        let split = scene.by_source();
        // The kit is what every `role` and `tone` on the tool surface resolves against, so an
        // agent re-reading its own project has to be able to see which one it committed to.
        let kit = project.settings.kit.as_ref().map(describe_kit);
        let off_token: Vec<serde_json::Value> = project
            .settings
            .kit
            .as_ref()
            .map(|kit| {
                kit.off_token_values(scene)
                    .iter()
                    .map(|token| serde_json::json!(token.message()))
                    .collect()
            })
            .unwrap_or_default();
        // The escape hatch, named. Raw `animate` keys are legal — a refused escape hatch is one
        // that gets worked around — but they are not anonymous: every channel no registry move
        // accounts for is listed here with its element, so the cost of going around the
        // vocabulary is proportional to how much of the project goes around it.
        let off_vocabulary: Vec<serde_json::Value> =
            bay_project::moves::off_vocabulary(scene, project.settings.fps.as_f64() as f32)
                .iter()
                .map(|finding| serde_json::json!(finding.message()))
                .collect();
        Ok(serde_json::json!({
            "name": project.metadata.name,
            "kit": kit,
            "offTokenValues": off_token,
            "offVocabularyMotion": off_vocabulary,
            "moveHistogram": bay_project::moves::histogram(scene),
            "motionSignatures": bay_project::moves::signatures(scene),
            "canvas": {
                "width": project.settings.canvas.width,
                "height": project.settings.canvas.height,
            },
            "fps": project.settings.fps.as_f64(),
            // An agent choosing text colour needs to know what it is drawing on; without this
            // it can set a background and never read one back.
            "background": project.settings.background,
            "durationSeconds": self.editor.duration().to_seconds_f64(),
            "visualElements": visual,
            "audioElements": audio,
            "authoredElements": split.authored.len(),
            "toolElements": split.tool.len(),
            "mediaAssets": project.media.len(),
            "layers": 1 + scene.tracks.overlay.len(),
        }))
    }

    /// Save to an explicit path, or — the normal case — into the user's project library, where
    /// the desktop app's launcher will list it.
    pub fn project_save(&self, path: Option<&str>) -> ToolResult {
        let target = match path {
            Some(path) => std::path::PathBuf::from(path),
            None => self.library()?.path_for(&self.editor.project().metadata.id),
        };
        bay_project::library::write_project(&target, self.editor.project())
            .map_err(|e| err(format!("could not save the project: {e}")))?;
        Ok(serde_json::json!({
            "path": target.to_string_lossy(),
            "id": self.editor.project().metadata.id,
            "name": self.editor.project().metadata.name,
        }))
    }

    pub fn project_list(&self) -> ToolResult {
        let library = self.library()?;
        let projects: Vec<_> = library
            .list()
            .map_err(|e| err(format!("could not read the project library: {e}")))?
            .into_iter()
            .map(|summary| {
                serde_json::json!({
                    "id": summary.id,
                    "name": summary.name,
                    "path": summary.path.to_string_lossy(),
                    "canvas": { "width": summary.canvas.width, "height": summary.canvas.height },
                    "fps": summary.fps,
                    "durationSeconds": summary.duration_seconds,
                    "elements": summary.element_count,
                })
            })
            .collect();
        Ok(serde_json::json!({
            "root": library.root().to_string_lossy(),
            "projects": projects,
        }))
    }

    pub fn project_load(&mut self, id: Option<&str>, path: Option<&str>) -> ToolResult {
        let project: Project = match (id, path) {
            (Some(id), None) => self
                .library()?
                .load(id)
                .map_err(|e| err(format!("could not load project {id}: {e}")))?,
            (None, Some(path)) => bay_project::library::read_project(std::path::Path::new(path))
                .map_err(|e| err(format!("could not load {path}: {e}")))?,
            (Some(_), Some(_)) => return Err(err("give either id or path, not both")),
            (None, None) => return Err(err("give a project id (see project_list) or a path")),
        };
        self.editor.load_project(project);
        self.critic_panels.clear();
        self.project_info()
    }

    // ------------------------------------------------------------------ media

    pub fn media_import(
        &mut self,
        path: &str,
        id: Option<String>,
        generated: Option<bay_project::GeneratedMediaProvenance>,
    ) -> ToolResult {
        let absolute = std::fs::canonicalize(path)
            .map_err(|e| err(format!("could not resolve media path {path}: {e}")))?;
        let absolute = absolute.to_string_lossy().to_string();
        let name = std::path::Path::new(&absolute)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "media".to_string());
        let media_id = id.unwrap_or_else(|| self.fresh_id("media"));

        // Probe so callers get the real duration/size rather than guessing. A probe failure is
        // not fatal — an asset can still be placed with an explicit duration — but it IS
        // reported, because silently defaulting is how a 3-minute clip became a 4-second one.
        let probed = bay_preview::probe::probe_media(&absolute);
        let mut asset = MediaAsset::new(media_id.clone(), name.clone(), absolute.clone());
        asset.generated = generated.clone();
        if let Ok(meta) = &probed {
            // Stored, not just reported: this is what stops a trim running off the end of the
            // file, and what `check` measures a clip against.
            asset.duration_seconds = Some(meta.duration.to_seconds_f64());
            asset.width = Some(meta.width);
            asset.height = Some(meta.height);
        }
        // Loudness, for anything with a sound in it. Measured here rather than asked for later
        // because a level is only a decision once the file's own loudness is known — a bed at
        // `2.0` against a file that integrates to -35 LUFS is still 9 LU too quiet, and no
        // amount of reasoning about the multiplier can discover that.
        let carries_audio = probed.as_ref().map(|meta| meta.has_audio).unwrap_or(false);
        let measured = carries_audio
            .then(|| bay_preview::probe::probe_loudness(&absolute))
            .transpose();
        if let Ok(Some(loudness)) = &measured {
            asset.loudness = Some(loudness.clone());
        }
        // No ffmpeg, or a probe that could not run: a WAV is still measurable, because the
        // samples are right there. This is not a nicety — every sound bay generates is a WAV
        // (Kokoro's narration, the bundled library), Kokoro needs no ffmpeg to run, and an audio
        // asset with no loudness makes the *whole* mix envelope unmeasurable rather than just
        // its own clip. Measured from the file, so it is the same measurement ffmpeg would make
        // (held to a tenth of a LU in `bay-audio/tests/loudness.rs`) rather than a guess.
        let from_samples = asset
            .loudness
            .is_none()
            .then(|| {
                bay_audio::wav::read(std::path::Path::new(&absolute))
                    .map(|pcm| loudness_from_samples(&bay_audio::loudness::measure(&pcm)))
            })
            .and_then(Result::ok);
        if let Some(loudness) = &from_samples {
            asset.loudness = Some(loudness.clone());
        }
        self.editor.add_media(asset);

        let mut out = serde_json::json!({
            "mediaId": media_id,
            "name": name,
            "path": absolute,
            "generated": generated,
        });
        match probed {
            Ok(meta) => {
                out["durationSeconds"] = serde_json::json!(meta.duration.to_seconds_f64());
                out["width"] = serde_json::json!(meta.width);
                out["height"] = serde_json::json!(meta.height);
                out["hasAudio"] = serde_json::json!(meta.has_audio);
                out["hasVideo"] = serde_json::json!(meta.has_video);
            }
            Err(e) => {
                out["probeError"] = serde_json::json!(e.to_string());
            }
        }
        match (measured, &from_samples) {
            (Ok(Some(loudness)), _) => out["loudness"] = loudness_json(&loudness),
            // Measured off the samples instead. Said plainly, because the two differ in one
            // respect an agent can act on: there are no accent times to cut against.
            (_, Some(loudness)) => {
                out["loudness"] = loudness_json(loudness);
                out["loudnessFrom"] = serde_json::json!("samples");
            }
            (Ok(None), None) => {}
            // Not fatal: the file is imported and placeable, and the mix checks say they could
            // not evaluate rather than passing. Silence here would be indistinguishable from a
            // measurement of zero.
            (Err(e), None) => out["loudnessError"] = serde_json::json!(e.to_string()),
        }
        Ok(out)
    }

    /// Measure an imported sound, and remember what it measured.
    ///
    /// Idempotent and cheap to repeat — one decode, no encode. It exists as its own verb for
    /// the assets imported before the measurement did, and because "how loud is this file"
    /// is a question worth being able to ask without placing anything.
    /// The canvas, in pixels.
    pub fn canvas(&self) -> (u32, u32) {
        let canvas = &self.editor.project().settings.canvas;
        (canvas.width, canvas.height)
    }

    /// The file behind a media id, or `None` when nothing in the project has that id.
    ///
    /// Read-only and takes `&self`, so a tool that only needs to look at the file — measuring a
    /// tempo, say — does not have to borrow the editor mutably.
    pub fn media_path(&self, media_id: &str) -> Option<String> {
        self.editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .map(|asset| asset.path.clone())
    }

    /// The pixel size of a media asset, when a probe found one.
    pub fn media_size(&self, media_id: &str) -> Option<(u32, u32)> {
        self.editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .and_then(|asset| Some((asset.width?, asset.height?)))
    }

    pub fn transcribe(&mut self, media_id: &str) -> ToolResult {
        let mut asset = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .cloned()
            .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?;
        if self.listener.is_none() {
            self.listener = Some(
                bay_listen::Listener::new(bay_listen::ListenConfig::default())
                    .map_err(|error| err(error.to_string()))?,
            );
        }
        let transcript = self
            .listener
            .as_ref()
            .expect("listener was initialised")
            .transcribe_file(&asset.path)
            .map_err(|error| err(error.to_string()))?;
        asset.transcript = Some(transcript.clone());
        self.editor.add_media(asset);
        Ok(serde_json::json!({
            "mediaId": media_id,
            "language": transcript.language,
            "model": transcript.model,
            "durationSeconds": transcript.duration_seconds,
            "words": transcript.words.len(),
            "utterances": transcript.utterances.len(),
            "transcript": transcript,
        }))
    }

    pub fn transcript_get(&self, media_id: &str) -> ToolResult {
        let transcript = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?
            .transcript
            .as_ref()
            .ok_or_else(|| {
                err(format!(
                    "media {media_id:?} has no transcript — call transcribe first"
                ))
            })?;
        serde_json::to_value(transcript).map_err(|error| err(error.to_string()))
    }

    pub fn transcript_search(&self, media_id: &str, query: &str) -> ToolResult {
        if query.trim().is_empty() {
            return Err(err("query must contain at least one word"));
        }
        let transcript = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?
            .transcript
            .as_ref()
            .ok_or_else(|| {
                err(format!(
                    "media {media_id:?} has no transcript — call transcribe first"
                ))
            })?;
        Ok(serde_json::json!({
            "mediaId": media_id,
            "query": query,
            "matches": bay_listen::search(transcript, query).iter().map(|range| serde_json::json!({
                "startSeconds": range.start_seconds,
                "endSeconds": range.end_seconds,
                "text": range.text,
            })).collect::<Vec<_>>(),
        }))
    }

    /// Detect shot boundaries, embed one midpoint frame per shot, and persist the index.
    pub fn media_index(&mut self, media_id: &str) -> ToolResult {
        let mut asset = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .cloned()
            .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?;
        let shots = bay_preview::probe::detect_shots(
            &asset.path,
            bay_preview::probe::DEFAULT_SHOT_THRESHOLD,
            0.4,
        )
        .map_err(|error| {
            err(format!(
                "could not detect shots in {:?}: {error}",
                asset.name
            ))
        })?;
        let ranges = shots
            .iter()
            .map(|shot| bay_vision::ShotRange {
                start_seconds: shot.start_seconds,
                end_seconds: shot.end_seconds,
            })
            .collect::<Vec<_>>();
        let encoder = bay_vision::Encoder::load().map_err(|error| err(error.to_string()))?;
        let indexed = bay_vision::index_shots(&encoder, &asset.path, &ranges)
            .map_err(|error| err(error.to_string()))?;
        asset.semantic_index = Some(SemanticMediaIndex {
            model: "siglip-base-patch16-224".into(),
            shots: indexed
                .iter()
                .map(|shot| SemanticShot {
                    start_seconds: shot.range.start_seconds,
                    end_seconds: shot.range.end_seconds,
                    sample_seconds: shot.sample_seconds,
                    embedding: shot.embedding.as_slice().to_vec(),
                })
                .collect(),
        });
        self.editor.add_media(asset);
        Ok(serde_json::json!({
            "mediaId": media_id,
            "model": "siglip-base-patch16-224",
            "granularity": "one midpoint frame per detected shot",
            "shots": indexed.len(),
        }))
    }

    /// Search every persisted shot index with SigLIP. Scores are returned with relative
    /// separation; no absolute score is treated as a calibrated relevance threshold.
    pub fn media_search(&self, query: &str, media_id: Option<&str>, limit: usize) -> ToolResult {
        let query = query.trim();
        if query.is_empty() {
            return Err(err("media_search needs a plain-language query"));
        }
        let encoder = bay_vision::Encoder::load().map_err(|error| err(error.to_string()))?;
        let text = encoder
            .embed_text(&[query.to_string()])
            .map_err(|error| err(error.to_string()))?;
        let mut matches = Vec::new();
        for asset in &self.editor.project().media {
            if media_id.is_some_and(|wanted| wanted != asset.id) {
                continue;
            }
            let Some(index) = &asset.semantic_index else {
                continue;
            };
            for shot in &index.shots {
                let embedding = bay_vision::Embedding::new(shot.embedding.clone());
                if embedding.len() != bay_vision::DIMENSIONS {
                    continue;
                }
                matches.push((
                    bay_vision::cosine(&text[0], &embedding),
                    asset.id.clone(),
                    asset.name.clone(),
                    shot,
                ));
            }
        }
        if matches.is_empty() {
            return Err(err(
                "no indexed shots to search — call media_index for imported footage first",
            ));
        }
        matches.sort_by(|a, b| b.0.total_cmp(&a.0));
        let separation = matches[0].0 - matches[matches.len() / 2].0;
        Ok(serde_json::json!({
            "query": query,
            "separation": separation,
            "hint": "SigLIP scores are not calibrated; use ranking and best-vs-median separation.",
            "matches": matches.into_iter().take(limit.clamp(1, 100)).map(
                |(score, media_id, media_name, shot)| serde_json::json!({
                    "mediaId": media_id,
                    "mediaName": media_name,
                    "startSeconds": shot.start_seconds,
                    "endSeconds": shot.end_seconds,
                    "sampleSeconds": shot.sample_seconds,
                    "score": score,
                })
            ).collect::<Vec<_>>(),
        }))
    }

    /// Cluster transcript utterances acoustically and write speaker labels back into the same
    /// persisted transcript object used by transcript editing.
    pub fn diarize(&mut self, media_id: &str, speakers: usize) -> ToolResult {
        let mut asset = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .cloned()
            .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?;
        let transcript = asset.transcript.as_mut().ok_or_else(|| {
            err(format!(
                "media {media_id:?} has no transcript — call transcribe first"
            ))
        })?;
        let summary = bay_listen::diarize_file(&asset.path, transcript, speakers)
            .map_err(|error| err(error.to_string()))?;
        let transcript_value =
            serde_json::to_value(&*transcript).map_err(|error| err(error.to_string()))?;
        self.editor.add_media(asset);
        Ok(serde_json::json!({
            "mediaId": media_id,
            "summary": summary,
            "transcript": transcript_value,
        }))
    }

    /// Track a video's subject and convert the damped path into animated crop insets.
    pub fn auto_reframe(
        &mut self,
        element_id: &str,
        target_width: u32,
        target_height: u32,
        sample_seconds: f64,
        smoothing_seconds: f64,
    ) -> ToolResult {
        if target_width == 0 || target_height == 0 {
            return Err(err(
                "targetWidth and targetHeight must be greater than zero",
            ));
        }
        let reference = self
            .find_element_ref(element_id)
            .ok_or_else(|| err(format!("no element {element_id:?} on the timeline")))?;
        let (video, effects, mut animations) = match self
            .editor
            .active_scene()
            .element(&reference)
            .ok_or_else(|| err(format!("no element {element_id:?} on the timeline")))?
        {
            Element::Video(video) => (
                video.clone(),
                video.effects.clone(),
                video.animations.clone(),
            ),
            _ => return Err(err("auto_reframe needs a video element")),
        };
        let asset = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == video.media_id)
            .cloned()
            .ok_or_else(|| err(format!("no media {:?}", video.media_id)))?;
        let (source_width, source_height) = match (asset.width, asset.height) {
            (Some(width), Some(height)) if width > 0 && height > 0 => (width, height),
            _ => {
                let metadata = bay_preview::probe::probe_media(&asset.path)
                    .map_err(|error| err(error.to_string()))?;
                (metadata.width, metadata.height)
            }
        };
        let source_start = video.trim_start.to_seconds_f64();
        let source_end = video.trim_end.to_seconds_f64();
        let shot_boundaries = match asset.semantic_index.as_ref() {
            Some(index) => index
                .shots
                .iter()
                .map(|shot| shot.start_seconds)
                .filter(|time| *time > source_start && *time < source_end)
                .collect::<Vec<_>>(),
            None => bay_preview::probe::detect_shots(
                &asset.path,
                bay_preview::probe::DEFAULT_SHOT_THRESHOLD,
                0.4,
            )
            .map_err(|error| err(format!("could not detect shot boundaries: {error}")))?
            .into_iter()
            .map(|shot| shot.start_seconds)
            .filter(|time| *time > source_start && *time < source_end)
            .collect(),
        };
        let encoder = bay_vision::Encoder::load().map_err(|error| err(error.to_string()))?;
        let path = bay_vision::track_subject_siglip(
            &encoder,
            &asset.path,
            source_start,
            source_end,
            bay_vision::ReframeTrackingConfig {
                source_aspect: source_width as f32 / source_height.max(1) as f32,
                target_aspect: target_width as f32 / target_height as f32,
                shot_boundaries: &shot_boundaries,
                tracking: bay_vision::TrackingConfig {
                    sample_seconds,
                    smoothing_seconds,
                },
            },
        )
        .map_err(|error| err(error.to_string()))?;
        // The geometry lives in `bay_project::reframe`, not here. It used to be written out
        // twice — identically — in this method and in `bay_agent::slow::auto_reframe`, which is
        // two places for a detector change to land and one of them to be missed.
        let plan = bay_project::reframe::plan_reframe(
            &path,
            source_start,
            source_width as f32 / source_height.max(1) as f32,
            target_width as f32 / target_height as f32,
        )
        .map_err(&err)?;
        let mut transform = video.transform;
        plan.first.apply_to(&mut transform);
        animations.extend(plan.channels);
        if !self.editor.execute(Command::SetTransform {
            reference: reference.clone(),
            transform,
        }) {
            return Err(err(format!("could not set crop on {element_id:?}")));
        }
        if !self.editor.execute(Command::ApplyMotionPreset {
            reference,
            effects,
            animations,
        }) {
            return Err(err(format!("could not animate crop on {element_id:?}")));
        }
        let raw_x = path.iter().map(|point| point.raw_x).collect::<Vec<_>>();
        let smooth_x = path.iter().map(|point| point.x).collect::<Vec<_>>();
        Ok(serde_json::json!({
            "elementId": element_id,
            "target": { "width": target_width, "height": target_height },
            "detector": "SigLIP-ranked subject crops with local appearance prior",
            "smoothing": {
                "method": "exponential damping",
                "seconds": smoothing_seconds,
                "rawJitter": bay_vision::path_jitter(&raw_x),
                "smoothedJitter": bay_vision::path_jitter(&smooth_x),
            },
            "points": path,
        }))
    }

    /// Place source ranges consecutively as paired video and speech clips.
    /// What kinds of video bay knows, and what declaring one changes.
    pub fn formats_list(&self) -> ToolResult {
        let declared = self.editor.project().settings.format.clone();
        Ok(serde_json::json!({
            "current": declared,
            "resolved": describe_format(bay_project::format::resolve(declared.as_deref())),
            "formats": bay_project::format::FORMATS
                .iter()
                .map(|format| describe_format(*format))
                .collect::<Vec<_>>(),
            "note": "A format only ever relaxes checks, and only ones it names a reason for. \
                     A suspended check still runs and is still reported — as a note carrying \
                     that reason — so it stops blocking an export without stopping being \
                     visible. If none of these describes what you are making, leave it \
                     undeclared: `general` suspends nothing, and one justified `ignoreChecks` \
                     is better than a format that quietly relaxes a check you needed.",
        }))
    }

    /// Drive an element's scale from how loud the sound is, moment to moment.
    ///
    /// The orb that pulses with the voice is this genre's one piece of life, and without it a
    /// circle on a ground is a circle on a ground. bay has no audio-reactive *channel* — a
    /// channel would have to be sampled every frame by the renderer, which is a decode on the
    /// render path — so this samples the sound once, here, and writes ordinary keyframes. The
    /// result is a normal animation: editable, visible in the timeline, and identical in the
    /// preview and the export because there is nothing left to re-derive.
    ///
    /// The window sampled is the element's own, mapped through wherever that audio actually
    /// sits on the timeline, so an orb over the second half of a bed reacts to the second half
    /// of the bed rather than to its opening.
    pub fn audio_react(
        &mut self,
        element_id: &str,
        media_id: &str,
        channel: &str,
        depth: f64,
        floor_db: f64,
    ) -> ToolResult {
        if !matches!(channel, "scale" | "scaleX" | "scaleY" | "opacity") {
            return Err(err(format!(
                "cannot drive {channel:?} from sound — scale, scaleX, scaleY or opacity"
            )));
        }
        let path = self
            .media_path(media_id)
            .ok_or_else(|| err(format!("no media with id {media_id:?}")))?;

        // If the channel is already animated, the pulse rides ON that curve rather than
        // replacing it. Overwriting is what the first version did, and it silently deleted
        // every authored scale move on the element — the orb's whole arc through the film
        // vanished the moment the pulse was added, with nothing said.
        let existing = {
            let project = self.editor.project();
            project
                .active_scene()
                .elements()
                .find(|element| element.id() == element_id)
                .and_then(|element| element.animations())
                .and_then(|animations| animations.get(channel))
                .cloned()
        };
        let (start, duration, base) = {
            let element = self
                .editor
                .project()
                .active_scene()
                .elements()
                .find(|element| element.id() == element_id)
                .ok_or_else(|| err(format!("no element with id {element_id:?}")))?;
            let transform = element.transform().unwrap_or_default();
            let base = match channel {
                "scale" => transform.scale,
                "scaleX" => transform.scale_x,
                "scaleY" => transform.scale_y,
                _ => transform.opacity,
            };
            (element.start(), element.duration(), base)
        };
        if duration <= MediaTime::ZERO {
            return Err(err("that element has no duration to animate over"));
        }

        // Where this media sits on the timeline, so the element's window maps onto the right
        // part of the sound. Without this an orb placed at 20s reacts to the first second.
        let placed = self
            .editor
            .project()
            .active_scene()
            .tracks
            .audio
            .iter()
            .flat_map(|track| track.elements.iter())
            .find_map(|element| match element {
                bay_project::Element::Audio(audio) if audio.media_id == media_id => {
                    Some((audio.start, audio.trim_start))
                }
                _ => None,
            });
        let (audio_start, audio_trim) = placed.unwrap_or((MediaTime::ZERO, MediaTime::ZERO));

        let pcm = bay_audio::decode_pcm(&path, 16000).ok_or_else(|| {
            err(format!(
                "could not read audio from {path}. Decoding needs ffmpeg — runtime_install \
                 with component \"video\" installs it."
            ))
        })?;
        let rate = pcm.sample_rate.max(1) as f64;
        let channels = pcm.channels.max(1) as usize;

        // 20 Hz: fast enough that a syllable moves it, slow enough that a five-second element
        // is a hundred keys rather than a thousand.
        const HZ: f64 = 20.0;
        let steps = ((duration.to_seconds_f64() * HZ).round() as usize).clamp(2, 2000);
        let window = (rate / HZ) as usize * channels;

        let mut levels = Vec::with_capacity(steps);
        for step in 0..steps {
            let local = duration.to_seconds_f64() * step as f64 / (steps - 1).max(1) as f64;
            let source = (audio_trim.to_seconds_f64() + (start.to_seconds_f64() + local)
                - audio_start.to_seconds_f64())
            .max(0.0);
            let at = (source * rate) as usize * channels;
            let slice = pcm
                .samples
                .get(at..(at + window).min(pcm.samples.len()))
                .unwrap_or(&[]);
            let rms = if slice.is_empty() {
                0.0
            } else {
                (slice
                    .iter()
                    .map(|s| f64::from(*s) * f64::from(*s))
                    .sum::<f64>()
                    / slice.len() as f64)
                    .sqrt()
            };
            levels.push(20.0 * (rms.max(1e-9)).log10());
        }

        // Normalise against what this sound actually does, not against full scale: speech
        // peaking at -12 dB would otherwise never move the orb more than a fraction of the
        // depth asked for.
        let loudest = levels.iter().copied().fold(f64::MIN, f64::max);
        let quietest = floor_db.min(loudest - 1.0);
        let span = (loudest - quietest).max(1.0);

        let keys: Vec<bay_project::Keyframe> = levels
            .iter()
            .enumerate()
            .map(|(step, level)| {
                let amount = ((level - quietest) / span).clamp(0.0, 1.0);
                let local = duration.to_seconds_f64() * step as f64 / (steps - 1).max(1) as f64;
                let time = MediaTime::from_seconds_f64(local).unwrap_or(MediaTime::ZERO);
                // The value the element would have had here without the pulse.
                let under = existing
                    .as_ref()
                    .and_then(|channel| channel.sample(time))
                    .unwrap_or(base);
                bay_project::Keyframe {
                    time,
                    value: (f64::from(under) * (1.0 + depth * amount)) as f32,
                    easing: None,
                    handles: None,
                    id: 0,
                }
            })
            .collect();

        let reference = self
            .find_element_ref(element_id)
            .ok_or_else(|| err(format!("no element with id {element_id:?}")))?;
        let mut element = self
            .editor
            .project()
            .active_scene()
            .elements()
            .find(|element| element.id() == element_id)
            .cloned()
            .ok_or_else(|| err("the element went away"))?;
        if let Some(animations) = element.animations_mut() {
            animations.insert(
                channel.to_string(),
                bay_project::AnimationChannel {
                    keys: keys.clone(),
                    easing: bay_project::Easing::Linear,
                },
            );
        } else {
            return Err(err(format!("{element_id:?} cannot be animated")));
        }
        if !self
            .editor
            .execute(Command::ReplaceElement { reference, element })
        {
            return Err(err("could not write the animation"));
        }

        Ok(serde_json::json!({
            "elementId": element_id,
            "mediaId": media_id,
            "channel": channel,
            "keys": keys.len(),
            "baseValue": base,
            "rodeExistingCurve": existing.is_some(),
            "depth": depth,
            "quietestDb": (quietest * 10.0).round() / 10.0,
            "loudestDb": (loudest * 10.0).round() / 10.0,
            "note": "Ordinary keyframes, sampled from the sound once. `check` reports a \
                     hand-keyed channel as off-vocabulary-motion, which this is — the \
                     vocabulary has no move for it, and a pulse driven by a voice is the one \
                     case where that is the point rather than a shortcut.",
        }))
    }

    /// Lay the room itself under the whole cut, lifted from a pause in the recording.
    ///
    /// The companion to [`Studio::audio_smooth`], and the half of the problem a crossfade does
    /// not solve. A crossfade fixes how *fast* you cross a join; it cannot change what the two
    /// sides sound like. Two moments of the same recording still differ in noise floor and
    /// timbre — measured across one edit, about 18 dB in the worst band — and at every cut the
    /// listener hears the background change even when the change is smooth.
    ///
    /// A continuous bed of the room's own tone masks that, because the background stops being
    /// something that changes at cuts and becomes something that is simply there. The material
    /// is the recording's own silence: whichever pause is longest and sits closest to the
    /// measured noise floor, which is what makes it room tone rather than a clipped word. So
    /// nothing is synthesised and nothing is imported — the room under the edit is the room.
    ///
    /// Laid down as overlapping copies with crossfades, because a loop butt-joined to itself
    /// ticks for exactly the reason a dialogue edit does.
    pub fn room_tone(
        &mut self,
        media_id: &str,
        seconds: Option<f64>,
        level_db: f64,
        crossfade_ms: f64,
    ) -> ToolResult {
        let path = self
            .media_path(media_id)
            .ok_or_else(|| err(format!("no media with id {media_id:?}")))?;
        let pcm = bay_audio::decode_pcm(&path, 16000).ok_or_else(|| {
            err(format!(
                "could not read audio from {path}. Decoding needs ffmpeg — runtime_install \
                 with component \"video\" installs it."
            ))
        })?;
        let scan = bay_audio::silence::detect(
            &pcm,
            bay_audio::silence::Options {
                threshold_db: None,
                minimum_seconds: 0.35,
                pad_seconds: 0.0,
            },
        )
        .ok_or_else(|| err(format!("{path} has no audio to measure")))?;

        // The best chunk is long *and* quiet: a long pause with a peak well above the floor is
        // a breath or the tail of a word, and looping one puts a heartbeat under the cut.
        let floor = scan.noise_floor_db;
        let best = scan
            .silences
            .iter()
            .filter(|silence| silence.duration_seconds >= 0.35)
            .min_by(|a, b| {
                let cost = |s: &bay_audio::silence::Silence| {
                    (s.peak_db - floor) - 6.0 * s.duration_seconds.min(2.0)
                };
                cost(a)
                    .partial_cmp(&cost(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .ok_or_else(|| {
                err(format!(
                    "no pause in {path} is long enough to lift room tone from — the quietest \
                     run is under 0.35s. Record a few seconds of the empty room, or pass a \
                     different file."
                ))
            })?;

        let chunk = best.duration_seconds.min(4.0);
        let cover = seconds.unwrap_or_else(|| self.editor.duration().to_seconds_f64());
        if cover <= 0.0 {
            return Err(err("there is no timeline to lay room tone under"));
        }
        let fade = (crossfade_ms.clamp(0.0, 1000.0) / 1000.0).min(chunk / 3.0);
        let gain = 10f32.powf((level_db as f32) / 20.0);

        let step = (chunk - fade).max(0.05);
        let mut placed = Vec::new();
        let mut at = 0.0f64;
        let mut index = 0usize;
        // A cap, so a bad chunk length cannot carpet the timeline with thousands of clips.
        while at < cover && index < 4000 {
            // Never past the end: a bed that outlasts the picture lengthens the timeline and
            // leaves black on the end of the video.
            let duration = chunk.min(cover - at);
            if duration <= 0.02 {
                break;
            }
            let id = format!("room-tone-{index}");
            self.add_audio(
                Some(id.clone()),
                media_id.to_string(),
                at,
                duration,
                gain,
                best.start_seconds,
                ElementSource::Tool,
                AudioRole::Bed,
                false,
            )?;
            placed.push(id);
            at += step;
            index += 1;
        }

        // Crossfade the loop into itself, and ease the two open ends.
        let fade_time = secs(fade)?;
        for (position, id) in placed.iter().enumerate() {
            let Some(reference) = self.find_element_ref(id) else {
                continue;
            };
            let fade_in = if position == 0 {
                secs(fade.min(0.25))?
            } else {
                fade_time
            };
            let fade_out = if position + 1 == placed.len() {
                secs(fade.min(0.25))?
            } else {
                fade_time
            };
            self.editor.execute(Command::SetFades {
                reference,
                fade_in,
                fade_out,
            });
        }

        Ok(serde_json::json!({
            "mediaId": media_id,
            "liftedFrom": {
                "startSeconds": best.start_seconds,
                "durationSeconds": best.duration_seconds,
                "peakDb": best.peak_db,
            },
            "noiseFloorDb": floor,
            "speechDb": scan.speech_db,
            "chunkSeconds": chunk,
            "crossfadeSeconds": fade,
            "levelDb": level_db,
            "clips": placed.len(),
            "coversSeconds": cover,
            "elementIds": placed,
        }))
    }

    /// Crossfade every place two sounds meet, so a dialogue edit stops ticking at its joins.
    ///
    /// A cut in dialogue is not a cut in the *room*. Butt two takes together and the noise
    /// floor, the reverb tail and the timbre all change between one sample and the next —
    /// measured across one such edit: +7.5 dB of level at one join and -20.8 dB of top end at
    /// another, instantaneously. There is no click to find, because nothing is discontinuous
    /// in the waveform; what the ear hears is the room teleporting, and it reads as a fault in
    /// the recording rather than as an edit.
    ///
    /// The fix is the one every editor makes by hand: overlap the two clips by a few tens of
    /// milliseconds and fade one down as the other comes up. The material for the overlap is
    /// real — the outgoing clip is extended into the source it was cut from, so the tail is
    /// the room continuing, not silence.
    ///
    /// **Both sides move, which is where this parts company with a picture dissolve.**
    /// [`Command::SetFades`] documents a dissolve as the incoming clip alone fading over an
    /// outgoing one still at full, and for opacity that is right. Sum two sounds that way and
    /// the overlap is *louder* than either — up to 6 dB for uncorrelated room tone. So the
    /// outgoing fades down as the incoming fades up.
    pub fn audio_smooth(&mut self, join_ms: f64, element_ids: Option<Vec<String>>) -> ToolResult {
        let join = secs(join_ms.clamp(0.0, 500.0) / 1000.0)?;
        if join <= MediaTime::ZERO {
            return Err(err("joinMs must be greater than zero"));
        }
        let wanted: Option<std::collections::BTreeSet<String>> =
            element_ids.map(|ids| ids.into_iter().collect());

        // (id, track, start, duration, source room left after the out-point)
        let mut clips: Vec<(String, String, MediaTime, MediaTime, MediaTime)> = Vec::new();
        {
            let project = self.editor.project();
            let scene = project.active_scene();
            for track in &scene.tracks.audio {
                for element in &track.elements {
                    let bay_project::Element::Audio(audio) = element else {
                        continue;
                    };
                    if wanted.as_ref().is_some_and(|ids| !ids.contains(&audio.id)) {
                        continue;
                    }
                    // How much source lies past this clip's out-point — the material the
                    // overlap is made of. Without it there is nothing to fade *through*.
                    let room = project
                        .media
                        .iter()
                        .find(|asset| asset.id == audio.media_id)
                        .and_then(|asset| asset.source_duration())
                        .map(|length| {
                            (length - (audio.trim_start + audio.duration)).max(MediaTime::ZERO)
                        })
                        .unwrap_or(MediaTime::ZERO);
                    clips.push((
                        audio.id.clone(),
                        track.id.clone(),
                        audio.start,
                        audio.duration,
                        room,
                    ));
                }
            }
        }
        clips.sort_by_key(|(_, _, start, _, _)| *start);
        if clips.is_empty() {
            return Err(err("no audio clips to smooth"));
        }

        // A join is two clips that meet: touching, or overlapping already, or with a gap too
        // short to be a deliberate silence.
        let tolerance = join;
        let mut fades: std::collections::BTreeMap<String, (MediaTime, MediaTime)> =
            std::collections::BTreeMap::new();
        let mut extend: std::collections::BTreeMap<String, MediaTime> =
            std::collections::BTreeMap::new();
        let mut joins = Vec::new();
        for pair in clips.windows(2) {
            let (a_id, _, a_start, a_duration, a_room) = &pair[0];
            let (b_id, _, b_start, _, _) = &pair[1];
            let a_end = *a_start + *a_duration;
            let gap = *b_start - a_end;
            if gap > tolerance || gap < -tolerance {
                continue;
            }
            // Overlap by as much as the source allows, up to the asked-for join.
            let overlap = join.min(*a_room + (a_end - *b_start).max(MediaTime::ZERO));
            if overlap <= MediaTime::ZERO {
                continue;
            }
            let grow = (*b_start + overlap - a_end).max(MediaTime::ZERO);
            if grow > MediaTime::ZERO {
                extend.insert(a_id.clone(), grow);
            }
            fades.entry(a_id.clone()).or_default().1 = overlap;
            fades.entry(b_id.clone()).or_default().0 = overlap;
            joins.push(serde_json::json!({
                "from": a_id, "to": b_id,
                "atSeconds": b_start.to_seconds_f64(),
                "crossfadeSeconds": overlap.to_seconds_f64(),
                "grewOutgoingBySeconds": grow.to_seconds_f64(),
            }));
        }

        // The two open ends. A clip that starts at full level on the first sample ticks just as
        // audibly as a join does, and nothing is overlapping there to hide it.
        let edge = join.min(secs(0.010)?);
        fades.entry(clips[0].0.clone()).or_default().0 = fades
            .get(&clips[0].0)
            .map(|f| f.0)
            .unwrap_or(MediaTime::ZERO)
            .max(edge);
        let last = clips[clips.len() - 1].0.clone();
        let existing = fades.get(&last).map(|f| f.1).unwrap_or(MediaTime::ZERO);
        fades.entry(last).or_default().1 = existing.max(edge);

        let mut changed = 0usize;
        for (id, grow) in &extend {
            let Some((_, _, start, duration, _)) = clips.iter().find(|(c, ..)| c == id) else {
                continue;
            };
            let Some(reference) = self.find_element_ref(id) else {
                continue;
            };
            if self.editor.execute(Command::TrimElement {
                reference,
                start: *start,
                duration: *duration + *grow,
            }) {
                changed += 1;
            }
        }
        for (id, (fade_in, fade_out)) in &fades {
            let Some(reference) = self.find_element_ref(id) else {
                continue;
            };
            if self.editor.execute(Command::SetFades {
                reference,
                fade_in: *fade_in,
                fade_out: *fade_out,
            }) {
                changed += 1;
            }
        }

        Ok(serde_json::json!({
            "joinMs": join.to_seconds_f64() * 1000.0,
            "clips": clips.len(),
            "joinsSmoothed": joins.len(),
            "edits": changed,
            "joins": joins,
        }))
    }

    pub fn cut_by_transcript(
        &mut self,
        media_id: &str,
        ranges: &[bay_listen::SourceRange],
        timeline_start: f64,
        layer: usize,
    ) -> ToolResult {
        let asset = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .cloned()
            .ok_or_else(|| err(format!("no media {media_id:?} — call media_import first")))?;
        if asset.transcript.is_none() {
            return Err(err(format!(
                "media {media_id:?} has no transcript — call transcribe first"
            )));
        }
        if ranges.is_empty() {
            return Err(err("give at least one transcript range"));
        }
        let source_end = asset.duration_seconds.unwrap_or(f64::INFINITY);
        for range in ranges {
            if !range.start_seconds.is_finite()
                || !range.end_seconds.is_finite()
                || range.start_seconds < 0.0
                || range.end_seconds <= range.start_seconds
                || range.end_seconds > source_end
            {
                return Err(err(format!(
                    "invalid source range {:.3}..{:.3}; media duration is {}",
                    range.start_seconds,
                    range.end_seconds,
                    asset
                        .duration_seconds
                        .map(|seconds| format!("{seconds:.3}s"))
                        .unwrap_or_else(|| "unknown".into())
                )));
            }
        }

        let mut at = timeline_start;
        let mut placed = Vec::new();
        for range in ranges {
            let duration = range.end_seconds - range.start_seconds;
            let video = self.add_video(
                layer,
                None,
                media_id.to_string(),
                at,
                duration,
                range.start_seconds,
                ElementRole::Label,
                VisualArgs {
                    transform: Transform::default(),
                    blend_mode: BlendMode::default(),
                },
            )?;
            let audio = self.add_audio(
                None,
                media_id.to_string(),
                at,
                duration,
                1.0,
                range.start_seconds,
                ElementSource::Tool,
                AudioRole::Speech,
                true,
            )?;
            placed.push(serde_json::json!({
                "timelineStart": at,
                "duration": duration,
                "sourceStart": range.start_seconds,
                "sourceEnd": range.end_seconds,
                "text": range.text,
                "videoElementId": video["elementId"],
                "audioElementId": audio["elementId"],
            }));
            at += duration;
        }
        Ok(serde_json::json!({
            "mediaId": media_id,
            "timelineStart": timeline_start,
            "duration": at - timeline_start,
            "clips": placed,
        }))
    }

    pub fn audio_probe(&mut self, media_id: &str) -> ToolResult {
        let asset = self
            .editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == media_id)
            .cloned()
            .ok_or_else(|| {
                err(format!(
                    "no media {media_id:?} in this project — call media_import first"
                ))
            })?;
        // ffmpeg first, because it reads every format and finds the accents. A WAV it could not
        // reach is still measured, off its own samples: the same three levels, and the mix needs
        // them far more than it needs a beat grid. Both failing is an error — an asset this was
        // called on and could not measure must not look like one that was never asked about.
        let (loudness, from_samples) = match bay_preview::probe::probe_loudness(&asset.path) {
            Ok(loudness) => (loudness, false),
            Err(ffmpeg_error) => match bay_audio::wav::read(std::path::Path::new(&asset.path)) {
                Ok(pcm) => (
                    loudness_from_samples(&bay_audio::loudness::measure(&pcm)),
                    true,
                ),
                Err(wav_error) => {
                    return Err(err(format!(
                        "could not measure {:?}: {ffmpeg_error}. Nor as a WAV: {wav_error}. \
                         Until it is measured the mix checks report that they could not \
                         evaluate rather than passing.",
                        asset.name
                    )));
                }
            },
        };

        let mut updated = asset.clone();
        updated.loudness = Some(loudness.clone());
        self.editor.add_media(updated);

        let mut out = loudness_json(&loudness);
        if let Some(object) = out.as_object_mut() {
            object.insert("mediaId".into(), serde_json::json!(media_id));
            object.insert("name".into(), serde_json::json!(asset.name));
            if from_samples {
                object.insert("loudnessFrom".into(), serde_json::json!("samples"));
            }
        }
        Ok(out)
    }

    /// Which of `families` are actually installed, **and at which weights**.
    ///
    /// The weights are the half that matters. A family being present says nothing: cosmic-text
    /// drops the family when the weight is missing, so `Avenir` is installed and `Avenir` at 700
    /// is Menlo Bold. Each row is generated by shaping a glyph at each of the nine CSS steps and
    /// reading back the face that carried it — the same probe `add_text` refuses on.
    /// Every family installed here, so a kit can be chosen rather than guessed at.
    ///
    /// `fonts_check` answers "is this one here?", which needs a name already in mind. A name
    /// guessed wrong is not refused — the shaper drops the family and substitutes another face,
    /// so the project renders in something nobody picked and nothing downstream can tell.
    pub fn fonts_list(&mut self, contains: Option<&str>, weight: Option<u16>) -> ToolResult {
        let needle = contains.map(str::to_lowercase);
        let mut families: Vec<String> = self
            .text_probe
            .families()
            .into_iter()
            .filter(|family| {
                needle
                    .as_ref()
                    .is_none_or(|needle| family.to_lowercase().contains(needle.as_str()))
            })
            .collect();
        // Asking for a weight is asking which families can carry a *kit* at that weight, which
        // is the shaper's answer and not the database's.
        if let Some(weight) = weight {
            families.retain(|family| self.text_probe.resolves(family, weight));
        }
        let total = families.len();
        // A machine can carry hundreds; a list that long is not a choice, it is a wall.
        const CAP: usize = 200;
        let truncated = total > CAP;
        families.truncate(CAP);
        let mut out = serde_json::json!({
            "families": families,
            "total": total,
        });
        if truncated {
            out["note"] = serde_json::json!(format!(
                "{total} families installed; the first {CAP} are listed. Pass `contains` to \
                 narrow it, or `weight` to see only the families a kit could use at that weight."
            ));
        }
        Ok(out)
    }

    pub fn fonts_check(&mut self, families: &[String]) -> ToolResult {
        let mut available = Vec::new();
        let mut missing = Vec::new();
        let mut faces = Vec::new();
        for family in families {
            let weights = self.text_probe.resolvable_weights(family);
            if weights.is_empty() {
                missing.push(family.clone());
            } else {
                available.push(family.clone());
            }
            let resolved = weights
                .first()
                .and_then(|weight| self.text_probe.resolve_face(family, *weight));
            faces.push(serde_json::json!({
                "family": family,
                "weights": weights,
                "metricClass": resolved.as_ref().map(|face| face.metric_class()),
                "capPerEm": resolved
                    .as_ref()
                    .and_then(|face| face.cap_per_em)
                    .map(|cap| (cap * 1000.0).round() / 1000.0),
            }));
        }
        Ok(serde_json::json!({
            "available": available,
            "missing": missing,
            "faces": faces,
        }))
    }

    // --------------------------------------------------------------- elements

    /// The track id for `layer`, creating overlay lanes as needed so an author can address
    /// layer 4 without having created layers 1–3 by hand.
    pub(crate) fn track_for_layer(&mut self, layer: usize) -> String {
        if layer == 0 {
            return self.editor.active_scene().tracks.main.id.clone();
        }
        // Through AddTrack, not project_mut: creating a lane used to clear the undo history,
        // so an agent adding a caption on layer 9 silently destroyed the user's undo stack.
        while self.editor.active_scene().tracks.overlay.len() < layer {
            let index = self.editor.active_scene().tracks.overlay.len() + 1;
            self.editor.execute(Command::AddTrack {
                lane: TrackLane::Overlay,
                id: format!("track-overlay-{index}"),
                name: format!("Overlay {index}"),
            });
        }
        self.editor.active_scene().tracks.overlay[layer - 1]
            .id
            .clone()
    }

    fn audio_track(&mut self) -> String {
        if self.editor.active_scene().tracks.audio.is_empty() {
            self.editor.execute(Command::AddTrack {
                lane: TrackLane::Audio,
                id: "track-audio".to_string(),
                name: "Audio".to_string(),
            });
        }
        self.editor.active_scene().tracks.audio[0].id.clone()
    }

    fn add(&mut self, layer: usize, element: Element) -> ToolResult {
        let id = element.id().to_string();
        reject_reserved_id(&id)?;
        let track_id = self.track_for_layer(layer);
        let start = element.start().to_seconds_f64();
        let end = element.end().to_seconds_f64();
        if !self.editor.execute(Command::AddElement {
            track_id: track_id.clone(),
            element,
            select: false,
        }) {
            return Err(err(format!("could not add element to track {track_id}")));
        }
        Ok(serde_json::json!({
            "elementId": id,
            "layer": layer,
            "trackId": track_id,
            "startSeconds": start,
            "endSeconds": end,
        }))
    }

    /// The text ink exactly as bay will place it, in canvas pixels and fractions.
    ///
    /// Returned by `add_text` so callers that stack type can place the next block after the
    /// measured wrapped height instead of assuming one line. Decorations expand the texture but
    /// not these ink bounds: layout follows glyphs, while plates and shadows are allowed to
    /// overlap neighbouring decoration.
    fn text_layout(&mut self, text: &TextElement) -> Option<serde_json::Value> {
        let (canvas_width, canvas_height) = self.canvas();
        let (canvas_width, canvas_height) = (canvas_width.max(1), canvas_height.max(1));
        let base_scale = text.transform.scale.max(0.01);
        let width = (base_scale * canvas_width as f32)
            .min(canvas_width as f32)
            .max(1.0) as u32;
        let height = (base_scale * canvas_height as f32)
            .min(canvas_height as f32)
            .max(1.0) as u32;
        let font_px = (text.font_size * canvas_height as f32 / 1080.0).max(8.0);
        let style = bay_text::TextStyle {
            family: text.font_family.as_deref(),
            weight: text.font_weight,
            align: match text.align {
                TextAlign::Left => bay_text::TextAlign::Left,
                TextAlign::Center => bay_text::TextAlign::Center,
                TextAlign::Right => bay_text::TextAlign::Right,
            },
            letter_spacing: text.letter_spacing,
            line_height: text.line_height,
            stroke: text.decorations.as_ref().and_then(|decorations| {
                decorations
                    .stroke
                    .as_ref()
                    .map(|stroke| bay_text::StrokeStyle {
                        width: stroke.width,
                        color: stroke.color.as_str(),
                    })
            }),
            shadow: text.decorations.as_ref().and_then(|decorations| {
                decorations
                    .shadow
                    .as_ref()
                    .map(|shadow| bay_text::ShadowStyle {
                        offset_x: shadow.offset_x,
                        offset_y: shadow.offset_y,
                        blur: shadow.blur,
                        color: shadow.color.as_str(),
                    })
            }),
            plate: text.decorations.as_ref().and_then(|decorations| {
                decorations
                    .plate
                    .as_ref()
                    .map(|plate| bay_text::PlateStyle {
                        color: plate.color.as_str(),
                        padding_x: plate.padding_x,
                        padding_y: plate.padding_y,
                        radius: plate.radius,
                    })
            }),
            highlight: None,
        };
        let image = self.text_probe.render_styled(
            &text.content,
            font_px,
            &text.color,
            width,
            height,
            &style,
        );
        let ink = image.ink_bounds?;
        let box_width =
            f64::from(text.transform.scale * canvas_width as f32 + image.margin_x as f32 * 2.0);
        let box_height =
            f64::from(text.transform.scale * canvas_height as f32 + image.margin_y as f32 * 2.0);
        let fit = (box_width / f64::from(image.width))
            .min(box_height / f64::from(image.height))
            .max(0.0);
        let layer_width = f64::from(image.width) * fit * f64::from(text.transform.scale_x.max(0.0));
        let layer_height =
            f64::from(image.height) * fit * f64::from(text.transform.scale_y.max(0.0));
        let layer_left = f64::from(text.transform.x * canvas_width as f32)
            - f64::from(text.transform.anchor_x) * layer_width;
        let layer_top = f64::from(text.transform.y * canvas_height as f32)
            - f64::from(text.transform.anchor_y) * layer_height;
        let left = layer_left + f64::from(ink.left) / f64::from(image.width) * layer_width;
        let top = layer_top + f64::from(ink.top) / f64::from(image.height) * layer_height;
        let right = layer_left + f64::from(ink.right) / f64::from(image.width) * layer_width;
        let bottom = layer_top + f64::from(ink.bottom) / f64::from(image.height) * layer_height;
        Some(serde_json::json!({
            "basis": "glyph-ink",
            "left": left / f64::from(canvas_width),
            "top": top / f64::from(canvas_height),
            "right": right / f64::from(canvas_width),
            "bottom": bottom / f64::from(canvas_height),
            "width": (right - left) / f64::from(canvas_width),
            "height": (bottom - top) / f64::from(canvas_height),
            "pixels": {
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
                "width": right - left,
                "height": bottom - top,
            },
        }))
    }

    /// Place type. The face, the size, the weight and the colour come from the committed kit,
    /// resolved through `role` and `tone` — they are not arguments any more, because the default
    /// beat the caller's explicit choice on 72 of 73 elements in the project this comes from.
    #[allow(clippy::too_many_arguments)]
    pub fn add_text(
        &mut self,
        layer: usize,
        id: Option<String>,
        start: f64,
        duration: f64,
        text: TextArgs,
        visual: VisualArgs,
    ) -> ToolResult {
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let kit = self.kit()?;
        let style = kit.resolve(text.role, text.tone);
        // The kit's families are checked when it is committed; this is the belt-and-braces
        // check for a kit that came off disk on a machine with a different font set, where the
        // symptom would otherwise be a fallback face that looks almost right.
        self.require_face(
            &style.family,
            style.weight,
            &format!("the {:?} kit's {} step", kit.id, text.role.as_str()),
        )?;
        let id = id.unwrap_or_else(|| self.fresh_id("text"));
        let element = Element::Text(TextElement {
            id,
            name: text.content.chars().take(24).collect(),
            start: secs(start)?,
            duration: secs(duration)?,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: text.content,
            font_size: style.size,
            color: style.color,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
            mask: None,
            font_family: Some(style.family),
            font_weight: style.weight,
            align: text.align,
            letter_spacing: text.letter_spacing.unwrap_or(style.tracking),
            line_height: text.line_height.unwrap_or(style.line_height),
            decorations: text.decorations,
            karaoke: None,
            type_on: text.type_on,
            source: ElementSource::Author,
            role: text.role,
        });
        let layout = self.text_layout(match &element {
            Element::Text(text) => text,
            _ => unreachable!("add_text constructs text"),
        });
        let mut result = self.add(layer, element)?;
        if let Some(layout) = layout {
            result["textLayout"] = layout;
        }
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_shape(
        &mut self,
        layer: usize,
        id: Option<String>,
        start: f64,
        duration: f64,
        shape: ShapeKind,
        role: ElementRole,
        tone: Tone,
        fill: ShapeFill,
        visual: VisualArgs,
    ) -> ToolResult {
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let color = self.kit()?.color(tone).to_string();
        let id = id.unwrap_or_else(|| self.fresh_id("shape"));
        let element = Element::Shape(ShapeElement {
            name: id.clone(),
            id,
            start: secs(start)?,
            duration: secs(duration)?,
            gradient: fill.gradient,
            stroke: fill.stroke,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape,
            color,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
            mask: None,
            source: ElementSource::Author,
            role,
        });
        self.add(layer, element)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_image(
        &mut self,
        layer: usize,
        id: Option<String>,
        media_id: String,
        start: f64,
        duration: f64,
        role: ElementRole,
        visual: VisualArgs,
    ) -> ToolResult {
        self.require_media(&media_id)?;
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("image"));
        let element = Element::Image(ImageElement {
            name: id.clone(),
            id,
            start: secs(start)?,
            duration: secs(duration)?,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
            mask: None,
            source: ElementSource::Author,
            role,
        });
        self.add(layer, element)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_video(
        &mut self,
        layer: usize,
        id: Option<String>,
        media_id: String,
        start: f64,
        duration: f64,
        trim_start: f64,
        role: ElementRole,
        visual: VisualArgs,
    ) -> ToolResult {
        self.require_media(&media_id)?;
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("video"));
        let element = Element::Video(VideoElement {
            name: id.clone(),
            id,
            start: secs(start)?,
            duration: secs(duration)?,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id,
            trim_start: secs(trim_start)?,
            // The out-point is the in-point plus the length — it is not independent. It used
            // to be written as zero here, which described a clip that plays backwards to
            // nowhere; nothing read it, so nothing complained.
            trim_end: secs(trim_start + duration)?,
            speed: 1.0,
            freeze: None,
            transform: visual.transform,
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: visual.blend_mode,
            mask: None,
            source: ElementSource::Author,
            role,
        });
        self.add(layer, element)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_audio(
        &mut self,
        id: Option<String>,
        media_id: String,
        start: f64,
        duration: f64,
        volume: f32,
        trim_start: f64,
        source: ElementSource,
        role: AudioRole,
        process_dialogue: bool,
    ) -> ToolResult {
        self.require_media(&media_id)?;
        if duration <= 0.0 {
            return Err(err("duration must be greater than zero"));
        }
        let id = id.unwrap_or_else(|| self.fresh_id("audio"));
        // The same reservation the visual `add` applies. Audio does not go through it, and a
        // rule that holds on four of the five kinds is a rule nobody can state.
        reject_reserved_id(&id)?;
        let element = Element::Audio(AudioElement {
            name: id.clone(),
            id: id.clone(),
            start: secs(start)?,
            duration: secs(duration)?,
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id,
            muted: false,
            volume,
            pan: 0.0,
            speed: 1.0,
            prosody: (source == ElementSource::Tool && role == AudioRole::Speech)
                .then(bay_project::SpeechProsody::default),
            // Speech gets the EQ/compressor/limiter chain, because raw dialogue always wants
            // it. Not unconditionally, though: a bed that arrives already mixed and levelled
            // is dialogue too, and running the chain over it a second time is what took a mix
            // mastered to -13.9 LUFS down to -19.6 with its loudness range squashed from 5.9
            // to 3.5. `loudness: false` on the export cannot prevent that — the chain is a
            // property of the element, not of the encode.
            dialogue_chain: (role == AudioRole::Speech && process_dialogue)
                .then(bay_project::DialogueAudioChain::default),
            trim_start: secs(trim_start)?,
            animations: BTreeMap::new(),
            source,
            role,
        });
        let track_id = self.audio_track();
        if !self.editor.execute(Command::AddElement {
            track_id: track_id.clone(),
            element,
            select: false,
        }) {
            return Err(err("could not add audio element"));
        }
        Ok(serde_json::json!({ "elementId": id, "trackId": track_id }))
    }

    fn require_media(&self, media_id: &str) -> Result<(), ToolError> {
        if self.editor.project().media_path(media_id).is_none() {
            return Err(err(format!(
                "no media asset {media_id:?} — import it with media_import first"
            )));
        }
        Ok(())
    }

    // `Studio::animate` used to live here — a second, headless implementation of `animate` with
    // its own keyframe parser and its own easing parser. The two front ends diverged, as two
    // implementations of one verb always do, and the divergence was expensive: this one knew 8
    // of the 14 easings (it **rejected `spring-out`**, the curve five documents call the house
    // entrance), validated `property` against `Element::ANIMATABLE` rather than against the
    // element's own kind so it **refused `volume`**, and silently dropped per-key easing. An
    // agent that could not keyframe a bed's volume built a 13-clip stepped music bed instead,
    // and an agent that could not spend a `spring-out` spent `ease-out` 103 times.
    //
    // `animate` is now planned by `bay_agent::plan`, exactly like every other revising tool, and
    // reaches this file only through `apply_planned`. There is one implementation.

    /// Locate an element by id, as a track-qualified reference. A reference rather than a
    /// `&mut` because every mutation now goes through a `Command`.
    pub(crate) fn find_element_ref(&self, element_id: &str) -> Option<ElementRef> {
        let scene = self.editor.active_scene();
        scene.tracks.iter().find_map(|track| {
            track
                .elements
                .iter()
                .any(|element| element.id() == element_id)
                .then(|| ElementRef::new(track.id.clone(), element_id.to_string()))
        })
    }

    pub(crate) fn set_audio_prosody(
        &mut self,
        element_id: &str,
        prosody: bay_project::SpeechProsody,
    ) {
        let Some(reference) = self.find_element_ref(element_id) else {
            return;
        };
        let Some(mut element) = self.editor.active_scene().element(&reference).cloned() else {
            return;
        };
        if let Element::Audio(audio) = &mut element {
            audio.prosody = Some(prosody);
            let _ = self
                .editor
                .execute(Command::ReplaceElement { reference, element });
        }
    }

    pub fn element_delete(&mut self, element_id: &str) -> ToolResult {
        let reference = self
            .find_element_ref(element_id)
            .ok_or_else(|| err(format!("no element {element_id:?} on the timeline")))?;
        // RemoveElement is reversible; the old raw removal cleared the undo history.
        if !self.editor.execute(Command::RemoveElement { reference }) {
            return Err(err(format!("could not delete {element_id:?}")));
        }
        Ok(serde_json::json!({ "deleted": element_id }))
    }

    /// Where installed sound packs live: inside the runtime directory, so "everything bay
    /// downloaded" stays one directory the user can measure and delete.
    fn sfx_root() -> Option<std::path::PathBuf> {
        bay_paths::runtime_dir().map(|runtime| runtime.join("sfx"))
    }

    /// Search both halves of the sound library at once.
    ///
    /// Deliberately one tool over two sources. An author looking for a click does not care
    /// whether it is synthesised or recorded, and making them ask twice would mean discovering
    /// the packs only if they already knew packs existed.
    pub fn sfx_search(&self, query: &str) -> ToolResult {
        let synthesised: Vec<serde_json::Value> = bay_audio::sfx::EFFECTS
            .iter()
            .filter(|effect| {
                let haystack =
                    format!("{} {} {}", effect.id, effect.name, effect.description).to_lowercase();
                query.trim().is_empty()
                    || query
                        .to_lowercase()
                        .split_whitespace()
                        .all(|term| haystack.contains(term))
            })
            .map(|effect| {
                serde_json::json!({
                    "sfx": effect.id,
                    "name": effect.name,
                    "description": effect.description,
                    "defaultSeconds": effect.default_seconds,
                    "source": "synthesised",
                })
            })
            .collect();

        let root = Self::sfx_root();
        let recorded: Vec<serde_json::Value> = root
            .as_deref()
            .map(|root| bay_audio::library::search(root, query))
            .unwrap_or_default()
            .into_iter()
            .take(40) // a search that returns 150 rows is a directory listing, not a search
            .map(|sound| {
                serde_json::json!({
                    "sound": sound.id,
                    "name": sound.name,
                    "pack": sound.pack,
                    "source": "recorded",
                })
            })
            .collect();

        // An empty recorded half is worth explaining: it means nothing is installed, which is
        // a different answer from "there is no such sound".
        let installed = root
            .as_deref()
            .map(|root| !bay_audio::library::installed(root).is_empty())
            .unwrap_or(false);
        Ok(serde_json::json!({
            "synthesised": synthesised,
            "recorded": recorded,
            "packsInstalled": installed,
            "hint": if installed {
                serde_json::Value::Null
            } else {
                serde_json::json!(
                    "No recorded sound packs are installed. Synthesised effects work with no \
                     download at all; for recorded interface sound call runtime_install with \
                     component \"sfx\" (about 1.5 MB, CC0)."
                )
            },
        }))
    }

    /// Place an installed recorded sound on the audio lane.
    pub fn sound_add(&mut self, sound_id: &str, start: f64, volume: f32) -> ToolResult {
        let root = Self::sfx_root()
            .ok_or_else(|| err("no runtime directory, so no sound packs can be found"))?;
        let sound = bay_audio::library::installed(&root)
            .into_iter()
            .find(|sound| sound.id == sound_id)
            .ok_or_else(|| {
                err(format!(
                    "no installed sound {sound_id:?} — call sfx_search to see what is there, or \
                     runtime_install component \"sfx\" if nothing is"
                ))
            })?;

        // The file is already on disk, so this is an ordinary import: the pack is a source of
        // media, not a special case in the timeline.
        let imported = self.media_import(&sound.path.to_string_lossy(), None, None)?;
        let media_id = imported
            .get("mediaId")
            .and_then(|id| id.as_str())
            .ok_or_else(|| err("importing the sound returned no mediaId"))?
            .to_string();
        let duration = imported
            .get("durationSeconds")
            .and_then(|d| d.as_f64())
            .filter(|d| *d > 0.0)
            // ffprobe absent: a UI sound is well under a second, and a wrong length here is a
            // clip that ends early rather than a failed placement.
            .unwrap_or(0.5);

        let placed = self.add_audio(
            None,
            media_id.clone(),
            start,
            duration,
            volume,
            0.0,
            ElementSource::Author,
            AudioRole::Sfx,
            // Not speech, so the chain does not apply either way.
            true,
        )?;
        Ok(serde_json::json!({
            "sound": sound.id,
            "mediaId": media_id,
            // `add_audio` answers with `elementId`; reading `id` off it returned null here for
            // every sound ever placed, which is an id an agent cannot animate, trim or delete.
            "elementId": placed.get("elementId").cloned().unwrap_or(serde_json::Value::Null),
            "startSeconds": start,
            "durationSeconds": duration,
        }))
    }

    /// Synthesise a sound effect, register it, and drop it on the audio lane.
    ///
    /// One call rather than three because there is no file to import — the sound is rendered
    /// here, written once, and referenced like any other media. The WAV goes beside the
    /// project library so a saved project still finds it later; a sound that vanished when the
    /// app restarted would be worse than no sound.
    pub fn sfx_add(
        &mut self,
        effect_id: &str,
        start: f64,
        seconds: Option<f64>,
        tone: f32,
        level: f32,
        volume: f32,
    ) -> ToolResult {
        let effect = bay_audio::sfx::Sfx::by_id(effect_id).ok_or_else(|| {
            err(format!(
                "unknown sound {effect_id:?} — bay synthesises {:?}",
                bay_audio::sfx::EFFECTS
                    .iter()
                    .map(|e| e.id)
                    .collect::<Vec<_>>()
            ))
        })?;
        let params = bay_audio::sfx::SfxParams {
            seconds: seconds.unwrap_or(effect.default_seconds),
            tone,
            level,
        };
        let pcm = effect.render(params);
        let duration = pcm.samples.len() as f64 / pcm.sample_rate.max(1) as f64;

        let directory = self
            .library_root
            .clone()
            .or_else(bay_paths::data_dir)
            .ok_or_else(|| err("no data directory, so there is nowhere to write the sound"))?
            .join("sfx");
        std::fs::create_dir_all(&directory)
            .map_err(|e| err(format!("could not create {}: {e}", directory.display())))?;

        // Measured here, from the samples themselves, before anything is written. An audio
        // asset with no loudness is not "quiet" — it makes the *whole* mix envelope
        // unmeasurable, because a level nobody has measured cannot be compared with one that
        // has (`bay_project::mix`). One unmeasured click therefore used to put `speech-masked`
        // and `bed-too-quiet` into `skipped` and null every `stats.mix` field, for any project
        // that placed a single sound effect. Nothing here needs ffmpeg: bay rendered these
        // samples, so it can read their level off them. Measured once and used for both the
        // asset and the reply, so what the caller is told is what the project holds.
        let measured = loudness_from_samples(&bay_audio::loudness::measure(&pcm));

        let media_id = self.fresh_id("sfx");
        let path = directory.join(format!("{media_id}-{effect_id}.wav"));
        std::fs::write(&path, bay_audio::sfx::encode_wav(&pcm))
            .map_err(|e| err(format!("could not write {}: {e}", path.display())))?;

        let mut asset = MediaAsset::new(
            media_id.clone(),
            format!("{} ({:.2}s)", effect.name, duration),
            path.to_string_lossy().into_owned(),
        );
        asset.duration_seconds = Some(duration);
        asset.loudness = Some(measured.clone());
        self.editor.add_media(asset);

        let placed = self.add_audio(
            None,
            media_id.clone(),
            start,
            duration,
            volume,
            0.0,
            ElementSource::Author,
            AudioRole::Sfx,
            // Not speech, so the chain does not apply either way.
            true,
        )?;
        Ok(serde_json::json!({
            "sfx": effect.id,
            "mediaId": media_id,
            "elementId": placed.get("elementId").cloned().unwrap_or(serde_json::Value::Null),
            "path": path.to_string_lossy(),
            "startSeconds": start,
            "durationSeconds": duration,
            // Reported for the same reason `media_import` reports it: the caller is about to
            // set levels against this sound, and a level is only a decision once the file's own
            // loudness is known.
            "loudness": loudness_json(&measured),
        }))
    }

    // `Studio::timeline` used to live here, over a second `describe_element` below it. Both
    // are gone. The copy had drifted behind `bay_agent::plan`'s: it reported no effects, no
    // trim in-point and no media id — so an agent that added a blur over the wire and then
    // re-read the timeline could not see it, and one that trimmed a clip could read its
    // position and length but not what was playing. `timeline` is planned like every other
    // tool now, and there is one description of an element.

    pub fn variant_create(&mut self, label: &str) -> ToolResult {
        let library = self.library()?;
        let mut source = self.editor.project().clone();
        let source_id = source.metadata.id.clone();
        let mut plan = source
            .settings
            .plan
            .clone()
            .ok_or_else(|| err("create and approve a plan before making variants"))?;
        if plan.status != bay_project::PlanStatus::Committed {
            return Err(err("approve the plan before making variants"));
        }
        if !plan
            .variants
            .candidates
            .iter()
            .any(|candidate| candidate.project_id == source_id)
        {
            plan.variants
                .candidates
                .push(bay_project::VariantCandidate {
                    project_id: source_id.clone(),
                    parent_project_id: source_id.clone(),
                    label: "incumbent".into(),
                    project_hash: bay_agent::trust::project_hash(&source),
                    render_path: None,
                    valid_render: false,
                });
            plan.variants.incumbent_project_id = Some(source_id.clone());
        }

        let placeholder = library
            .create(label, source.settings.canvas, source.settings.fps)
            .map_err(|error| err(format!("could not reserve a variant project: {error}")))?;
        let mut variant = source.clone();
        variant.metadata.id = placeholder.metadata.id;
        variant.metadata.name = format!("{} — {}", source.metadata.name, label.trim());
        let candidate = bay_agent::trust::register_variant(&mut plan, &variant, &source_id, label)
            .map_err(err)?;
        source.settings.plan = Some(plan.clone());
        variant.settings.plan = Some(plan.clone());
        library
            .save(&source)
            .and_then(|_| library.save(&variant))
            .map_err(|error| err(format!("could not save variant projects: {error}")))?;
        self.commit_plan(plan);
        Ok(serde_json::json!({
            "projectId": candidate.project_id,
            "parentProjectId": source_id,
            "label": candidate.label,
            "projectHash": candidate.project_hash,
            "next": "load this projectId, make one deliberate alternative, render it, then call variant_register_render",
        }))
    }

    fn sync_plan_to_variants(&mut self, plan: &bay_project::PlanArtifact) -> Result<(), ToolError> {
        let library = self.library()?;
        let active = self.editor.project().metadata.id.clone();
        let ids = plan
            .variants
            .candidates
            .iter()
            .map(|candidate| candidate.project_id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        for id in ids {
            if id == active {
                continue;
            }
            let mut project = library
                .load(&id)
                .map_err(|error| err(format!("could not load variant {id:?}: {error}")))?;
            project.settings.plan = Some(plan.clone());
            library
                .save(&project)
                .map_err(|error| err(format!("could not update variant {id:?}: {error}")))?;
        }
        self.commit_plan(plan.clone());
        library
            .save(self.editor.project())
            .map_err(|error| err(format!("could not save active tournament state: {error}")))?;
        Ok(())
    }

    pub fn variant_register_render(&mut self, project_id: &str, path: &str) -> ToolResult {
        let metadata = std::fs::metadata(path).map_err(|error| {
            err(format!(
                "could not inspect rendered artifact {path:?}: {error}"
            ))
        })?;
        if metadata.len() == 0 {
            return Err(err("rendered artifact is empty"));
        }
        let library = self.library()?;
        let project = if self.editor.project().metadata.id == project_id {
            self.editor.project().clone()
        } else {
            library
                .load(project_id)
                .map_err(|error| err(format!("could not load variant {project_id:?}: {error}")))?
        };
        let receipt_path = format!("{path}.bay-render.json");
        let receipt: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&receipt_path).map_err(|error| {
                err(format!(
                    "missing engine render receipt {receipt_path:?}: {error}; render this variant with bay"
                ))
            })?,
        )
        .map_err(|error| err(format!("invalid engine render receipt: {error}")))?;
        let expected_hash = bay_agent::trust::project_hash(&project);
        if receipt.get("path").and_then(serde_json::Value::as_str) != Some(path)
            || receipt.get("projectId").and_then(serde_json::Value::as_str) != Some(project_id)
            || receipt
                .get("projectHash")
                .and_then(serde_json::Value::as_str)
                != Some(expected_hash.as_str())
            || receipt.get("bytes").and_then(serde_json::Value::as_u64) != Some(metadata.len())
        {
            return Err(err(
                "render receipt does not match this file and saved project; render the loaded variant again",
            ));
        }
        let mut plan = project
            .settings
            .plan
            .clone()
            .ok_or_else(|| err("that variant has no plan artifact"))?;
        let model_report = serde_json::to_value(bay_core::check(&project))
            .map_err(|error| err(format!("could not serialize model checks: {error}")))?;
        let frame_report = {
            let renderer = self.renderer()?;
            bay_preview::frame_check::check_frames(&project, renderer, None)
        };
        bay_agent::trust::record_render(&mut plan, project_id, path, &model_report, &frame_report)
            .map_err(err)?;
        self.sync_plan_to_variants(&plan)?;
        Ok(serde_json::json!({
            "projectId": project_id,
            "path": path,
            "valid": true,
            "modelChecks": model_report,
            "frameChecks": frame_report,
        }))
    }

    pub fn tournament_compare(
        &mut self,
        left: &str,
        right: &str,
        winner: &str,
        reason: &str,
    ) -> ToolResult {
        let mut plan = self
            .editor
            .project()
            .settings
            .plan
            .clone()
            .ok_or_else(|| err("this project has no plan artifact"))?;
        let incumbent = bay_agent::trust::pairwise_decide(&mut plan, left, right, winner, reason)
            .map_err(err)?;
        self.sync_plan_to_variants(&plan)?;
        Ok(serde_json::json!({
            "winner": winner,
            "incumbent": incumbent,
            "forcedOptimization": true,
            "comparisons": plan.variants.comparisons.len(),
        }))
    }

    pub fn critic_prepare(&mut self, path: &str) -> ToolResult {
        let plan = self
            .editor
            .project()
            .settings
            .plan
            .clone()
            .ok_or_else(|| err("create and approve a plan before running the critic"))?;
        if plan.status != bay_project::PlanStatus::Committed {
            return Err(err("approve the plan before running the critic"));
        }
        if plan.critic.rounds_completed >= 2 {
            return Err(err("the critic loop is bounded at two rounds"));
        }
        let sheet = self.contact_sheet(path, &[], 3)?;
        let times = sheet
            .get("times")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_f64)
            .collect::<Vec<_>>();
        let project = self.editor.project().clone();
        let signatures = {
            let renderer = self.renderer()?;
            bay_preview::frame_check::sample_signatures(&project, renderer, &times).map_err(err)?
        };
        self.critic_panels = signatures
            .into_iter()
            .enumerate()
            .map(|(index, signature)| {
                let beat = plan
                    .beats
                    .iter()
                    .rev()
                    .find(|beat| beat.marker_seconds <= signature.at)
                    .unwrap_or(&plan.beats[0]);
                bay_agent::trust::PanelEvidence {
                    panel: index + 1,
                    beat_id: beat.id.clone(),
                    sample_time_seconds: signature.at,
                    content_hash: signature.content_hash,
                    icgs: signature.icgs,
                }
            })
            .collect();
        let model = serde_json::to_value(bay_core::check(&project))
            .map_err(|error| err(format!("could not serialize model checks: {error}")))?;
        let frames = self.check_frames(None)?;
        Ok(serde_json::json!({
            "round": plan.critic.rounds_completed + 1,
            "brief": plan.brief,
            "contactSheet": sheet,
            "computed": { "model": model, "frames": frames },
            "forcedChoices": [
                "weakestPanel: choose exactly one panel",
                "mostAlikePair: choose exactly two different panels",
                "thumbnailPanel: choose exactly one panel"
            ],
            "binaries": [
                "hook communicates value without context",
                "visual hierarchy is intentional",
                "assets are relevant to the spoken claim",
                "pacing feels authored rather than uniform",
                "captions remain readable over the picture",
                "motion explains rather than decorates",
                "audio supports the editorial emphasis",
                "payoff resolves the opening promise",
                "the result feels made by a person who cared"
            ],
            "instruction": "Use a fresh critic with only this payload. Do not provide the plan or transcript.",
        }))
    }

    pub fn critic_submit(
        &mut self,
        weakest_panel: usize,
        most_alike_pair: (usize, usize),
        thumbnail_panel: usize,
        binaries: [bool; 9],
        rationale: &str,
    ) -> ToolResult {
        if self.critic_panels.is_empty() {
            return Err(err("call critic_prepare immediately before critic_submit"));
        }
        let mut plan = self
            .editor
            .project()
            .settings
            .plan
            .clone()
            .ok_or_else(|| err("this project has no plan artifact"))?;
        let obligations = bay_agent::trust::apply_critic_submission(
            &mut plan,
            &self.critic_panels,
            &bay_agent::trust::CriticSubmission {
                weakest_panel,
                most_alike_pair,
                thumbnail_panel,
                binaries,
                rationale: rationale.to_string(),
            },
        )
        .map_err(err)?;
        self.critic_panels.clear();
        self.commit_plan(plan.clone());
        Ok(serde_json::json!({
            "round": plan.critic.rounds_completed,
            "verdict": "revision-required",
            "renderBlocked": true,
            "obligations": obligations,
        }))
    }

    pub fn critic_refresh(&mut self) -> ToolResult {
        let project = self.editor.project().clone();
        let mut plan = project
            .settings
            .plan
            .clone()
            .ok_or_else(|| err("this project has no plan artifact"))?;
        let times = plan
            .critic
            .obligations
            .iter()
            .filter(|obligation| !obligation.closed)
            .map(|obligation| obligation.sample_time_seconds)
            .collect::<Vec<_>>();
        let signatures = {
            let renderer = self.renderer()?;
            bay_preview::frame_check::sample_signatures(&project, renderer, &times).map_err(err)?
        };
        let mut current = BTreeMap::new();
        for (obligation, signature) in plan
            .critic
            .obligations
            .iter()
            .filter(|obligation| !obligation.closed)
            .zip(signatures)
        {
            current.insert(
                format!(
                    "{}@{:.6}",
                    obligation.beat_id, obligation.sample_time_seconds
                ),
                (signature.content_hash, signature.icgs),
            );
        }
        let closed = bay_agent::trust::refresh_obligations(&mut plan, &current);
        let open = plan
            .critic
            .obligations
            .iter()
            .filter(|obligation| !obligation.closed)
            .count();
        self.commit_plan(plan);
        Ok(serde_json::json!({
            "closed": closed,
            "open": open,
            "renderBlocked": open > 0,
        }))
    }

    // ----------------------------------------------------------------- output

    /// Render a single frame to a PNG. The point of this tool is that an agent can *look* at
    /// what it built — every quality failure that matters (blank frame, collided type, a hero
    /// number too small to read) is invisible to a structural check and obvious in a frame.
    pub fn snapshot(&mut self, at: f64, path: &str, scale: f32) -> ToolResult {
        let project = self.editor.project().clone();
        let canvas = project.settings.canvas;
        let width = ((canvas.width as f32 * scale) as u32).max(16);
        let height = ((canvas.height as f32 * scale) as u32).max(16);
        let playhead = secs(at)?;
        let renderer = self.renderer()?;
        let frame = renderer
            .render(
                project.active_scene(),
                playhead,
                width,
                height,
                &project.settings.background,
                &project.media,
            )
            .ok_or_else(|| {
                err("the GPU could not produce a frame — the device may have been lost")
            })?;

        // The compositor hands back BGRA; PNG wants RGBA.
        let mut rgba = frame.bgra;
        for texel in rgba.chunks_exact_mut(4) {
            texel.swap(0, 2);
        }
        let buffer = image::RgbaImage::from_raw(width, height, rgba)
            .ok_or_else(|| err("rendered frame did not match its declared size"))?;
        buffer
            .save(path)
            .map_err(|e| err(format!("could not write {path}: {e}")))?;

        Ok(serde_json::json!({
            "path": path,
            "atSeconds": at,
            "width": width,
            "height": height,
        }))
    }

    /// Read the four scopes off one composited frame.
    ///
    /// Waits for decodes first, and says so if one never arrives: a placeholder is an honest
    /// interactive preview fallback, but measuring one and reporting its histogram as the shot's
    /// would be a scope that lies. Follows `check_frames` in returning `unevaluated` rather than
    /// an error when there is no GPU — a machine that cannot composite has not found a problem
    /// with the grade, it has failed to look.
    pub fn scopes_read(&mut self, at: f64, scale: f32, stride: usize) -> ToolResult {
        let project = self.editor.project().clone();
        let canvas = project.settings.canvas;
        let width = ((canvas.width as f32 * scale) as u32).max(16);
        let height = ((canvas.height as f32 * scale) as u32).max(16);
        let playhead = secs(at)?;
        let renderer = match self.renderer() {
            Ok(renderer) => renderer,
            Err(error) => return Ok(scopes_unevaluated(&error.0)),
        };
        if let Err(reason) = renderer.await_decodes_checked(project.active_scene(), &project.media)
        {
            return Ok(scopes_unevaluated(&reason));
        }
        let Some(frame) = renderer.render(
            project.active_scene(),
            playhead,
            width,
            height,
            &project.settings.background,
            &project.media,
        ) else {
            return Ok(scopes_unevaluated(
                "the GPU could not produce a frame — the device may have been lost",
            ));
        };

        let options = bay_preview::scopes::ScopeOptions {
            stride,
            ..Default::default()
        };
        let scopes = bay_preview::scopes::Scopes::from_preview_frame(&frame, options)
            .map_err(|e| err(e.to_string()))?;
        let mut report = scopes.summary().to_json();
        report["status"] = serde_json::json!("measured");
        report["atSeconds"] = serde_json::json!(at);
        Ok(report)
    }

    /// Pixel-level checks kept separate from the pure project pass.
    pub fn check_frames(&mut self, requested_duration: Option<f64>) -> ToolResult {
        let project = self.editor.project().clone();
        let renderer = match self.renderer() {
            Ok(renderer) => renderer,
            Err(error) => return Ok(frame_unevaluated(&error.0)),
        };
        Ok(bay_preview::frame_check::check_frames(
            &project,
            renderer,
            requested_duration,
        ))
    }

    /// Render review frames into one labelled image.
    pub fn contact_sheet(
        &mut self,
        path: &str,
        requested_times: &[f64],
        columns: usize,
    ) -> ToolResult {
        let project = self.editor.project().clone();
        let report = bay_core::check(&project);
        let mut times = requested_times
            .iter()
            .copied()
            .filter(|time| time.is_finite() && *time >= 0.0)
            .collect::<Vec<_>>();
        if times.is_empty() {
            let fallback_starts;
            let starts = if report.stats.beats.starts.is_empty() {
                fallback_starts = vec![0.0];
                &fallback_starts
            } else {
                &report.stats.beats.starts
            };
            let timeline = self.editor.duration().to_seconds_f64();
            for (index, start) in starts.iter().copied().enumerate() {
                let end = starts
                    .get(index + 1)
                    .copied()
                    .unwrap_or(report.stats.beats.end_seconds.max(timeline));
                if end <= start {
                    continue;
                }
                let span = end - start;
                let jitter = seeded_jitter(&project.metadata.id, index) * span * 0.08;
                times.push((start + span / 3.0 + jitter).clamp(start, end));
                times.push((start + span * 2.0 / 3.0 - jitter).clamp(start, end));
            }
        }
        if times.is_empty() {
            return Err(err(
                "contact_sheet needs a non-empty timeline or explicit times",
            ));
        }
        let columns = columns.clamp(1, 8);
        let thumb_height = 240u32;
        let canvas = project.settings.canvas;
        let thumb_width =
            ((thumb_height as f64 * canvas.width as f64 / canvas.height.max(1) as f64).round()
                as u32)
                .max(16);
        let label_height = 18u32;
        let rows = times.len().div_ceil(columns);
        let mut sheet = image::RgbaImage::from_pixel(
            thumb_width * columns as u32,
            (thumb_height + label_height) * rows as u32,
            image::Rgba([16, 16, 18, 255]),
        );
        let renderer = self.renderer()?;
        for (index, at) in times.iter().copied().enumerate() {
            let playhead = secs(at)?;
            let frame = renderer
                .render(
                    project.active_scene(),
                    playhead,
                    thumb_width,
                    thumb_height,
                    &project.settings.background,
                    &project.media,
                )
                .ok_or_else(|| err(format!("the GPU could not render the panel at {at:.2}s")))?;
            let mut rgba = frame.bgra;
            for texel in rgba.chunks_exact_mut(4) {
                texel.swap(0, 2);
            }
            let panel = image::RgbaImage::from_raw(thumb_width, thumb_height, rgba)
                .ok_or_else(|| err("a contact-sheet panel had the wrong byte length"))?;
            let x = (index % columns) as u32 * thumb_width;
            let y = (index / columns) as u32 * (thumb_height + label_height);
            image::imageops::replace(&mut sheet, &panel, i64::from(x), i64::from(y));
            draw_label(
                &mut sheet,
                x + 4,
                y + thumb_height + 4,
                &format!("{} {:.2}s", index + 1, at),
            );
        }
        sheet
            .save(path)
            .map_err(|error| err(format!("could not write contact sheet {path}: {error}")))?;
        Ok(serde_json::json!({
            "path": path,
            "times": times,
            "columns": columns,
            "rows": rows,
            "width": sheet.width(),
            "height": sheet.height(),
        }))
    }

    /// Encode the timeline to a file, picture and sound.
    pub fn render_video(
        &mut self,
        path: &str,
        duration: Option<f64>,
        settings: bay_preview::ExportSettings,
        overridden: Option<String>,
    ) -> ToolResult {
        let project = self.editor.project().clone();
        let timeline_duration = self.editor.duration().to_seconds_f64();
        // A range shortens what is left, so a caller who gave a start and no duration gets the
        // rest of the timeline rather than the whole of it starting late.
        let remaining = (timeline_duration - settings.start_seconds).max(0.0);
        if let Some(requested) = duration {
            let tolerance = 1.0 / project.settings.fps.as_f64().max(1.0);
            if remaining > tolerance && requested + tolerance < remaining {
                return Err(err(format!(
                    "render refused: duration {requested:.2}s would omit {:.2}s from the populated \
                     end of the timeline. Remove duration to render everything, or trim/delete \
                     the tail first.",
                    remaining - requested
                )));
            }
        }
        let duration = duration
            .unwrap_or(remaining)
            .min(remaining.max(f64::MIN_POSITIVE));
        if duration <= 0.0 {
            return Err(err(
                "nothing to render — the timeline is empty, so its duration is zero",
            ));
        }
        let fps = project.settings.fps.as_f64();
        let canvas = project.settings.canvas;
        let renderer = self.renderer()?;
        let started = std::time::Instant::now();
        renderer
            .export_video(
                project.active_scene(),
                duration,
                fps,
                canvas.width,
                canvas.height,
                &project.settings.background,
                &project.media,
                path,
                &settings,
            )
            .map_err(|reason| err(format!("could not encode {path}: {reason}")))?;
        let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let project_hash = bay_agent::trust::project_hash(&project);
        let receipt_path = format!("{path}.bay-render.json");
        let receipt = serde_json::json!({
            "path": path,
            "bytes": bytes,
            "projectId": project.metadata.id,
            "projectHash": project_hash,
        });
        std::fs::write(
            &receipt_path,
            serde_json::to_vec_pretty(&receipt)
                .map_err(|error| err(format!("could not encode render receipt: {error}")))?,
        )
        .map_err(|error| {
            err(format!(
                "could not write render receipt {receipt_path}: {error}"
            ))
        })?;
        Ok(serde_json::json!({
            "path": path,
            "durationSeconds": duration,
            "fps": fps,
            "width": canvas.width,
            "height": canvas.height,
            "bytes": bytes,
            "projectHash": project_hash,
            "receipt": receipt_path,
            "encodeSeconds": started.elapsed().as_secs_f64(),
            "checksOverridden": overridden,
        }))
    }
}

/// A scope reading that did not happen, and why. Shaped so a caller cannot mistake it for a
/// black frame: there are no numbers in it at all, only the reason there are none.
fn scopes_unevaluated(reason: &str) -> serde_json::Value {
    serde_json::json!({
        "status": "unevaluated",
        "reason": reason,
    })
}

fn frame_unevaluated(reason: &str) -> serde_json::Value {
    serde_json::json!({
        "status": "unevaluated",
        "gate": "unevaluated",
        "findings": [],
        "rollup": {},
        "skipped": [
            { "code": "frozen", "reason": reason },
            { "code": "anchor-scale", "reason": reason },
            { "code": "bottom-dead", "reason": reason },
        ],
        "stats": {},
    })
}

fn seeded_jitter(seed: &str, index: usize) -> f64 {
    let mut hash = 0xcbf29ce484222325u64 ^ index as u64;
    for byte in seed.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash as f64 / u64::MAX as f64 * 2.0 - 1.0
}

fn draw_label(image: &mut image::RgbaImage, x: u32, y: u32, text: &str) {
    for (column, character) in text.chars().enumerate() {
        let glyph = match character {
            '0' => ["111", "101", "101", "101", "111"],
            '1' => ["010", "110", "010", "010", "111"],
            '2' => ["111", "001", "111", "100", "111"],
            '3' => ["111", "001", "111", "001", "111"],
            '4' => ["101", "101", "111", "001", "001"],
            '5' => ["111", "100", "111", "001", "111"],
            '6' => ["111", "100", "111", "101", "111"],
            '7' => ["111", "001", "010", "010", "010"],
            '8' => ["111", "101", "111", "101", "111"],
            '9' => ["111", "101", "111", "001", "111"],
            '.' => ["000", "000", "000", "000", "010"],
            's' => ["000", "111", "100", "001", "111"],
            _ => ["000", "000", "000", "000", "000"],
        };
        let origin_x = x + column as u32 * 5;
        for (row, bits) in glyph.iter().enumerate() {
            for (bit, value) in bits.bytes().enumerate() {
                if value == b'1'
                    && origin_x + (bit as u32) < image.width()
                    && y + (row as u32) < image.height()
                {
                    image.put_pixel(
                        origin_x + bit as u32,
                        y + row as u32,
                        image::Rgba([240, 240, 244, 255]),
                    );
                }
            }
        }
    }
}

/// How a shape is painted, beyond the flat tone every shape has always had.
///
/// A struct rather than two more arguments because `add_shape` already carries eight, and
/// because the two travel together: a stroked shape with a gradient is an outline drawn in the
/// ramp, which is one decision rather than two.
#[derive(Debug, Clone, Default)]
pub struct ShapeFill {
    pub gradient: Option<bay_project::Gradient>,
    pub stroke: Option<bay_project::Stroke>,
}

/// What a caller needs to choose a format, and to see what one is doing to their report.
fn describe_format(format: bay_project::format::Format) -> serde_json::Value {
    serde_json::json!({
        "id": format.id,
        "name": format.name,
        "note": format.note,
        "builtFrom": format.built_from,
        "suspends": format.suspends
            .iter()
            .map(|(code, why)| serde_json::json!({ "code": code, "why": why }))
            .collect::<Vec<_>>(),
    })
}

/// A project with one empty scene — the starting point every reel is built up from. The
/// `Project::starter()` demo scene would otherwise leave placeholder blocks in the render.
fn empty_project(
    name: &str,
    canvas: CanvasSize,
    fps: Fps,
    background: &str,
    kit: Option<StyleKit>,
) -> Project {
    let mut project = Project::empty(&fresh_project_id(), name, canvas, fps, background);
    project.settings.kit = kit;
    project
}

/// What a caller needs to *use* a kit, and what an agent choosing between three offers needs to
/// tell them apart. The whole kit is in the project file; this is the readable summary.
fn describe_kit(kit: &StyleKit) -> serde_json::Value {
    let sizes: serde_json::Map<String, serde_json::Value> = ElementRole::ALL
        .iter()
        .map(|role| {
            let step = kit.ramp.step(*role);
            (
                role.as_str().to_string(),
                serde_json::json!({
                    "fontSize": step.size,
                    "family": kit.faces.for_role(*role).family,
                    "weight": kit.faces.for_role(*role).weight,
                }),
            )
        })
        .collect();
    serde_json::json!({
        "id": kit.id,
        "name": kit.name,
        "note": kit.note,
        "faces": {
            "display": { "family": kit.faces.display.family, "weight": kit.faces.display.weight },
            "body": { "family": kit.faces.body.family, "weight": kit.faces.body.weight },
            "mono": { "family": kit.faces.mono.family, "weight": kit.faces.mono.weight },
        },
        "palette": {
            "bg": kit.palette.bg,
            "surface": kit.palette.surface,
            "ink": kit.palette.ink,
            "dim": kit.palette.dim,
            "accent": kit.palette.accent,
            "accent2": kit.palette.accent2,
        },
        "roles": sizes,
        "framings": kit.framings.iter().map(|framing| serde_json::json!({
            "name": framing.name,
            "x": framing.x,
            "y": framing.y,
            "anchorX": framing.anchor_x,
            "anchorY": framing.anchor_y,
            "scale": framing.scale,
            "bottomWeighted": framing.is_bottom_weighted(),
        })).collect::<Vec<_>>(),
        "capRatio": (kit.cap_ratio() * 100.0).round() / 100.0,
    })
}

/// A distinct id per created project. Every MCP project used to be born as `project-mcp`, which
/// was harmless while projects only went to explicit paths — but the library keys files by id,
/// so a shared id would mean each new project silently overwriting the last one.
fn fresh_project_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!(
        "project-{stamp}-{}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

// `parse_keys` and `parse_easing` used to live here, serving this file's own `animate`. Both are
// gone with it. `parse_easing` in particular was a *second* easing table that had fallen six
// names behind `bay_agent::plan::EASINGS` — the enum the schema advertises — so six curves an
// agent could read in the tool description were rejected when it called with them, `spring-out`
// among them. A parser and a schema that can disagree is a tool call that fails for no reason the
// caller can see, and the only fix that stays fixed is having one of each.

pub fn parse_blend(name: Option<&str>) -> Result<BlendMode, ToolError> {
    let Some(name) = name else {
        return Ok(BlendMode::Normal);
    };
    serde_json::from_value(serde_json::Value::String(name.to_string())).map_err(|_| {
        err(format!(
            "unknown blend mode {name:?} — use one of {:?}",
            BlendMode::ALL
                .iter()
                .map(|m| serde_json::to_value(m).unwrap())
                .collect::<Vec<_>>()
        ))
    })
}

/// Map a wire role name onto the engine enum.
///
/// Required rather than defaulted on `add_text`/`add_shape`: "what is this for" is the question
/// whose absence let 46 shapes into one project with no answer to it, and a default would be
/// taken whole exactly as `fontWeight: 400` was, on 73 elements out of 73.
pub fn parse_role(name: Option<&str>, tool: &str) -> Result<ElementRole, ToolError> {
    let Some(name) = name else {
        return Err(err(format!(
            "{tool} requires \"role\": what this element is FOR. One of {:?}. hook is the \
             opening claim, headline the line a beat is built around, kicker the small line \
             framing it, label names a thing, data is a mark whose size or position IS the \
             number, lockup the end card, and ground/chrome are background and frame furniture \
             (kept to a small share of the project on purpose).",
            ElementRole::NAMES
        )));
    };
    ElementRole::from_wire(name).ok_or_else(|| {
        err(format!(
            "unknown role {name:?} — use one of {:?}",
            ElementRole::NAMES
        ))
    })
}

/// Map a wire tone name onto the engine enum, defaulting to the one the role wants.
///
/// The default is the load-bearing half: a headline asked for without a tone comes out in ink, a
/// data mark in the accent, a plate in the surface colour. That is the answer that is *right*
/// for the role, which matters more than any of them being available — the default won 98.6 % of
/// the time in the project this exists to prevent.
pub fn parse_tone(name: Option<&str>, role: ElementRole) -> Result<Tone, ToolError> {
    let Some(name) = name else {
        return Ok(Tone::default_for(role));
    };
    Tone::from_wire(name).ok_or_else(|| {
        err(format!(
            "unknown tone {name:?} — use one of {:?}. ink is the loudest value, dim is secondary \
             type, accent is the point (one per beat), accent2 the opposition, surface a plate.",
            Tone::NAMES
        ))
    })
}

/// A level measured in this process, as the project model records it.
///
/// The three numbers are the same three `probe_loudness` returns, and they agree with ffmpeg to
/// within 0.05 LU on every effect bay synthesises and every WAV width it reads
/// (`bay-audio/tests/loudness.rs`). They have to: a sound measured one way and a bed measured
/// the other sit in the same envelope, and a constant offset between the two paths would be a
/// mix decision nobody made.
///
/// `accent_seconds` is deliberately left empty. Accents are onset hints for cutting picture
/// against *music*, found from a per-frame peak series with 500 ms of history behind it; that
/// detector cannot report an onset inside its own first half-second, which is all a one-shot
/// has. Empty means "no beat grid", not "not measured" — the mix reads
/// [`bay_project::AssetLoudness::level_lufs`], which is set. `audio_probe` still returns the
/// accents for any file ffmpeg can reach.
fn loudness_from_samples(measured: &bay_audio::loudness::Loudness) -> bay_project::AssetLoudness {
    bay_project::AssetLoudness {
        peak_db: measured.peak_db,
        rms_db: measured.rms_db,
        lufs: measured.lufs,
        accent_seconds: Vec::new(),
    }
}

/// A measurement, as an agent reads it. Rounded to a tenth of a dB because that is the
/// resolution ffmpeg reports and the resolution the ear has for a level difference.
fn loudness_json(loudness: &bay_project::AssetLoudness) -> serde_json::Value {
    let tenth = |value: f32| (f64::from(value) * 10.0).round() / 10.0;
    serde_json::json!({
        "lufs": tenth(loudness.lufs),
        "peakDb": tenth(loudness.peak_db),
        "rmsDb": tenth(loudness.rms_db),
        "accentSeconds": loudness.accent_seconds,
        "audible": loudness.is_audible(),
    })
}

/// Map a wire audio-role name onto the engine enum. Defaults to a bed, which is what an
/// unlabelled `add_audio` almost always is.
pub fn parse_audio_role(name: Option<&str>) -> Result<AudioRole, ToolError> {
    let Some(name) = name else {
        return Ok(AudioRole::default());
    };
    AudioRole::from_wire(name).ok_or_else(|| {
        err(format!(
            "unknown audio role {name:?} — use one of {:?}",
            AudioRole::NAMES
        ))
    })
}

pub fn parse_align(name: Option<&str>) -> Result<TextAlign, ToolError> {
    Ok(match name.unwrap_or("left") {
        "left" => TextAlign::Left,
        "center" => TextAlign::Center,
        "right" => TextAlign::Right,
        other => {
            return Err(err(format!(
                "unknown align {other:?} — left, center or right"
            )));
        }
    })
}
