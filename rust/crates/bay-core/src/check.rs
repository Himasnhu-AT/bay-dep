//! A pre-flight pass over a project: the mistakes that make a finished video look wrong.
//!
//! This exists because "is it any good?" is mostly not a taste question. A title three
//! percent off the bottom edge, a caption too small to read at thumbnail size, a clip
//! pointing at a media id nobody imported, a two-second hole in the middle of the main lane —
//! each is a mechanical fact about the project, and each shows up as a broken-looking video.
//! Catching them here turns a judgement call into a test that runs before the encode.
//!
//! The pass has two halves. The first is structural — the mistakes above, each of which makes
//! the render *wrong*. The second is compositional: what is actually on the frame, how much of
//! it can be seen, and whether the opening carries anything. Both are mechanical facts about
//! the project model.
//!
//! **Pure.** No GPU, no ffmpeg, no file reads except the existence of an effect asset:
//! everything else is derived from the project model, so it runs headless, in a unit test, and
//! in the same millisecond an agent asks for it. That bounds what it can know — it cannot see
//! that a frame came out black, only what was scheduled to be on it — and [`Finding`]s are
//! worded to claim only what was actually checked.
//!
//! # The report is an envelope, not a list
//!
//! A previous version of this pass answered `ok: true` with 242 warnings on a video every
//! viewer disliked, and the agent that received it acted on one of them. Three things changed
//! as a result, and they are the shape of [`Report`]:
//!
//! - **[`Status`] is three-state.** `clean`, `findings`, and `unevaluated` — because a suite
//!   that could not run must say so rather than pass. Every check that could not be evaluated
//!   is named in [`Report::skipped`] with the reason it could not run.
//! - **The report is capped at [`MAX_FINDINGS`]**, drawn one per code in rotation so that one
//!   noisy code cannot crowd out eleven distinct ones, with the full counts in
//!   [`Report::rollup`].
//! - **The rule set is capped too**, at [`MAX_GATING_CODES`] `Error` codes, asserted over
//!   [`CODES`] by a test. A short report drawn from an unbounded rule set is worse than a long
//!   one: each render surfaces a different arbitrary dozen and nobody learns the shape of the
//!   space. Adding a fifteenth gating code means deleting one.
//!
//! # Everything measured over a distribution partitions on `source`
//!
//! bay writes elements too — `narrate` and the subtitle tools place captions. Measuring those
//! as though an author chose them is how the same three projects rank in the opposite order on
//! four separate motion measures depending only on whether captions are counted. Every check
//! below that measures a population reads [`Scene::authored_elements`], never `elements`.

use std::collections::{BTreeMap, BTreeSet};

use bay_project::kit::{self, contrast_between, luminance, parse_hex};
use bay_project::{
    AnimationChannel, Background, Easing, Element, ElementRole, MediaTime, Project, Scene, Track,
    Transform, mix, moves,
};
use serde::{Deserialize, Serialize};

/// How much a finding matters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    /// The output will be visibly wrong. Fix before rendering — [`render_gate`] refuses.
    Error,
    /// Probably not what was intended, but it may be deliberate.
    Warning,
    /// Worth knowing; not a defect.
    Note,
}

impl Severity {
    pub fn label(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Note => "note",
        }
    }
}

/// Every code this pass can emit, with what it costs and what it means.
///
/// **One severity per code, looked up here.** A code's severity used to be typed at each call
/// site, which meant the same code could be an error in one branch and a warning in another and
/// nothing could count them. Now [`finding`] reads this table, so the registry is the only
/// place a severity exists — and the budget below is a fact about the registry rather than a
/// hope about the source.
pub const CODES: &[(&str, Severity, &str)] = &[
    // ---------------------------------------------------------------- structural: it breaks
    (
        "zero-length",
        Severity::Error,
        "an element with no duration",
    ),
    (
        "before-zero",
        Severity::Error,
        "an element starting before the timeline does",
    ),
    (
        "missing-media",
        Severity::Error,
        "a clip pointing at media nobody imported",
    ),
    (
        "past-source-end",
        Severity::Error,
        "a clip reading past the end of its own file",
    ),
    (
        "missing-effect-asset",
        Severity::Error,
        "a grade whose .cube is not on disk",
    ),
    (
        "transform-not-finite",
        Severity::Error,
        "a NaN or infinite position",
    ),
    (
        "off-canvas",
        Severity::Error,
        "an element anchored outside the frame",
    ),
    (
        "nothing-visual",
        Severity::Error,
        "no picture on any visible lane",
    ),
    ("empty-text", Severity::Error, "a title with no text in it"),
    // ------------------------------------------------------- compositional: it renders dead
    (
        "dead-plate",
        Severity::Error,
        "a large element too close in colour to what it sits on to be seen",
    ),
    (
        "empty-container",
        Severity::Error,
        "a large shape with nothing legible inside it",
    ),
    (
        "value-overshoot",
        Severity::Error,
        "an overshooting curve on a channel whose size is the number",
    ),
    (
        "broken-continuity",
        Severity::Error,
        "two consecutive beats with nothing carried between them",
    ),
    (
        "speech-masked",
        Severity::Warning,
        "the gaps between the lines are as loud as the lines",
    ),
    (
        "text-collision",
        Severity::Error,
        "simultaneously visible text or an opaque graphic overprints shaped glyph ink",
    ),
    // ------------------------------------------------------------------ judgement: warnings
    (
        "no-hook",
        Severity::Warning,
        "the opening frame is emptier than the video's own median",
    ),
    ("small-text", Severity::Warning, "type too small to read"),
    (
        "unreadable-dwell",
        Severity::Warning,
        "text on screen for less time than it takes to read",
    ),
    (
        "no-response",
        Severity::Warning,
        "new elements arrive without changing the composition already on screen",
    ),
    (
        "off-grid",
        Severity::Warning,
        "cuts and moves that do not land on a frame",
    ),
    (
        "bed-too-quiet",
        Severity::Warning,
        "nothing audible under the picture between the lines",
    ),
    (
        "animation-overruns",
        Severity::Warning,
        "keys running past the end of their own clip",
    ),
    (
        "hidden-track-has-content",
        Severity::Warning,
        "a hidden lane holding elements",
    ),
    (
        "overlap",
        Severity::Warning,
        "two clips covering each other on the main lane",
    ),
    ("invisible", Severity::Warning, "nothing ever raises it"),
    (
        "zero-scale",
        Severity::Warning,
        "scaled to nothing on an axis",
    ),
    ("black-start", Severity::Warning, "the video opens on black"),
    ("gap", Severity::Warning, "a hole in the picture"),
    (
        "monotone-easing",
        Severity::Warning,
        "one curve is the whole motion vocabulary",
    ),
    (
        "monotone-duration",
        Severity::Warning,
        "one speed, or one scene length",
    ),
    (
        "flat-mix",
        Severity::Warning,
        "a bed that never gets out of the way",
    ),
    ("no-bed", Severity::Warning, "narration over silence"),
    (
        moves::OffVocabularyMotion::CODE,
        Severity::Warning,
        "a hand-keyed channel the move registry does not account for",
    ),
    (
        kit::OffToken::CODE,
        Severity::Warning,
        "a value that is not in the project's own kit",
    ),
    ("silent", Severity::Note, "the export carries no sound"),
    (
        "one-scene",
        Severity::Note,
        "a long video with no declared beats",
    ),
];

/// How many `Error`-severity codes may exist at once.
///
/// Not a cap on the report — a cap on the *rule set*. The report is short either way; what a
/// budget on the rules buys is that the space stays learnable. Adding a fifteenth means
/// deleting one, and that argument is the point of the number.
pub const MAX_GATING_CODES: usize = 14;

/// How many findings a report may carry. The rest are in [`Report::rollup`].
pub const MAX_FINDINGS: usize = 12;

/// The `Error` codes, in registry order.
pub fn gating_codes() -> Vec<&'static str> {
    CODES
        .iter()
        .filter(|(_, severity, _)| *severity == Severity::Error)
        .map(|(code, _, _)| *code)
        .collect()
}

/// Severity declared for a stable check code.
///
/// Compositor-backed checks live outside this crate but still read this registry, so one code
/// cannot become a warning in `check` and an error in `check_frames`.
pub fn severity_of(code: &str) -> Severity {
    CODES
        .iter()
        .find(|(name, _, _)| *name == code)
        // An unregistered code is a bug, not an error in the project: report it at the least
        // damaging severity rather than blocking a render on a code nobody declared.
        .map_or(Severity::Note, |(_, severity, _)| *severity)
}

/// One thing worth fixing.
///
/// Serialize-only: `code` is a compile-time constant so callers can match on it without
/// stringly-typed comparisons, and a report is something bay emits, never something it reads
/// back in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    /// Stable machine-readable code, e.g. `off-canvas`. Callers match on this; `message` is
    /// for humans and may be reworded.
    pub code: &'static str,
    /// What is wrong, naming the measured value that makes it wrong.
    pub message: String,
    /// The element it is about, when it is about one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
    /// Where on the timeline to look, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at_seconds: Option<f64>,
}

/// Build a finding. The severity comes from [`CODES`] — never from the call site.
fn finding(code: &'static str, message: impl Into<String>) -> Finding {
    Finding {
        severity: severity_of(code),
        code,
        message: message.into(),
        element_id: None,
        track_id: None,
        at_seconds: None,
    }
}

impl Finding {
    fn on(mut self, track_id: &str, element: &Element) -> Self {
        self.track_id = Some(track_id.to_string());
        self.element_id = Some(element.id().to_string());
        self.at_seconds = Some(element.start().to_seconds_f64());
        self
    }

    fn on_element(mut self, element: &Element) -> Self {
        self.element_id = Some(element.id().to_string());
        self.at_seconds = Some(element.start().to_seconds_f64());
        self
    }

    fn with_element(mut self, id: &str) -> Self {
        self.element_id = Some(id.to_string());
        self
    }

    fn at(mut self, seconds: f64) -> Self {
        self.at_seconds = Some(seconds);
        self
    }
}

/// A check that could not run, and why.
///
/// The whole `spans()` disaster in one field. A pass that cannot evaluate a rule and says
/// nothing is indistinguishable from a pass that evaluated it and found nothing — and the
/// second reading is the one everybody takes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub code: &'static str,
    pub reason: String,
}

/// What a whole pass concluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Every check ran and none of them found anything.
    Clean,
    /// Something was found. Read [`Report::findings`].
    Findings,
    /// Nothing was found, but not every check could run. Read [`Report::skipped`] before
    /// treating this as a pass.
    Unevaluated,
}

/// Numbers the report carries whether or not anything fired, so an agent can see the shape of
/// its own project rather than only the parts that tripped a rule.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub duration_seconds: f64,
    pub elements: usize,
    /// What an author asked for, and what bay generated. Every distribution below is over the
    /// first of these.
    pub authored_elements: usize,
    pub tool_elements: usize,
    pub authored_animated_channels: usize,
    /// Share of authored animated channels that are `opacity`. A project whose channels are all
    /// opacity has no motion in it, only presence — and counting captions inverts this number.
    pub authored_opacity_share: f64,
    /// Ink on the frame at the hook instant, and the video's own median, as fractions of the
    /// canvas. The hook rule is the ratio of the two; both are printed so the ratio can be
    /// argued with.
    pub hook_ink: f64,
    pub median_frame_ink: f64,
    /// The first element acting as the frame's ground. A scene may change ground between beats
    /// and each is exempt in the frames it grounds — this names one so the exemption is visible
    /// rather than implied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground: Option<String>,
    /// How the video was cut into beats, and where they fall. See [`Beats`].
    pub beats: Beats,
    /// What the mix measures. See [`MixStats`].
    pub mix: MixStats,
}

/// The mix, in the unit a mix is specified in.
///
/// Reported whether or not anything fired, because the two numbers an agent needs in order to
/// fix a mix are the two states' levels — and because the third one here, where the loudest
/// moment falls against the `payoff` marker, is a fact about the piece that no threshold in this
/// pass gates on. It is in the report so it can be *seen*: the video this comes from puts its
/// loudest 400 ms at 48.0 s, and has no marker anywhere.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixStats {
    /// Median level while a line is being spoken, in LUFS on the delivered scale.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub narration_lufs: Option<f64>,
    /// Median level between the lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_lufs: Option<f64>,
    /// Median level of the bed alone between the lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_bed_lufs: Option<f64>,
    /// The first of these minus the second. The number `speech-masked` gates on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub separation_lu: Option<f64>,
    /// What the programme integrates to before the export normalises it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authored_lufs: Option<f64>,
    /// Where the loudest 400 ms of the mix falls, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_at_seconds: Option<f64>,
    /// The `payoff` marker, if the project committed to one before it had any audio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payoff_at_seconds: Option<f64>,
    /// Whether the loudest moment lands within 1.5 s of that marker. `None` when there is no
    /// marker to land on — an argmax needs somewhere to point.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_at_payoff: Option<bool>,
    /// Sounds that have never been measured. While this is non-empty the levels above are absent
    /// and the two mix codes appear in `skipped`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unmeasured: Vec<String>,
}

fn mix_stats(envelope: mix::MixEnvelope) -> MixStats {
    let tenth = |value: Option<f64>| value.map(|v| (v * 10.0).round() / 10.0);
    MixStats {
        narration_lufs: tenth(envelope.narration_lufs),
        gap_lufs: tenth(envelope.gap_lufs),
        gap_bed_lufs: tenth(envelope.gap_bed_lufs),
        separation_lu: tenth(envelope.separation_lu()),
        authored_lufs: tenth(envelope.authored_lufs),
        peak_at_seconds: tenth(envelope.peak_at_seconds),
        payoff_at_seconds: tenth(envelope.payoff_at_seconds),
        peak_at_payoff: envelope
            .peak_to_payoff_seconds()
            .map(|apart| apart <= mix::PAYOFF_TOLERANCE_SECONDS),
        unmeasured: envelope.unmeasured,
    }
}

/// What a whole pass found.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub status: Status,
    /// At most [`MAX_FINDINGS`], worst first, one per code in rotation.
    pub findings: Vec<Finding>,
    /// Every code that fired, with how many times — including the ones the cap left out.
    pub rollup: BTreeMap<&'static str, usize>,
    /// Checks that could not be evaluated at all.
    pub skipped: Vec<Skipped>,
    pub stats: Stats,
    pub errors: usize,
    pub warnings: usize,
    pub notes: usize,
    /// How many findings there were before the cap.
    pub total: usize,
}

/// Type smaller than this fraction of the canvas height is unreadable where these videos are
/// watched — a phone, in a feed, often at thumbnail size. 2.2% is roughly 24px on a 1080-tall
/// canvas, which is about where body copy stops being legible on a scroll-past.
const MIN_LEGIBLE_TEXT_FRACTION: f32 = 0.022;

/// Glyph height in canvas pixels, as the renderer computes it.
///
/// **`font_size` is quoted against a 1080-tall canvas and scaled to the real one; it is not
/// multiplied by the transform.** For text, `transform.scale` sizes the *layout box* the type is
/// laid out in — the raster is built at `scale × canvas` with glyphs drawn at this size inside
/// it, so `fit_contain` composites it 1:1 and the scale never reaches the glyph.
///
/// This existed as `font_size × scale × scale_y`, which understated a 26pt kicker at
/// `scale: 0.744` on a 1920 canvas as 19px when it renders at 46px — and reported 67 legible
/// titles as illegible in a single project. A check that cries wolf gets turned off, and then it
/// is worth nothing on the run that matters. **A second copy of that wrong formula lived in the
/// hook check until it was deleted; there is one formula and this is it.**
///
/// Kept in step with `bay-preview`'s `font_px` by [`the test below`](self), because two formulas
/// for one number is how they came to disagree in the first place.
fn rendered_font_px(font_size: f32, canvas_height: f32) -> f32 {
    (font_size * canvas_height / 1080.0).max(8.0)
}

/// A hole shorter than this is a rounding artifact of two clips butted together, not a gap
/// anyone will see.
const GAP_TOLERANCE: MediaTime = MediaTime::from_ticks(bay_time::TICKS_PER_SECOND / 40);

/// Run every check over the active scene.
pub fn check(project: &Project) -> Report {
    let scene = project.active_scene();
    let mut findings = Vec::new();
    let mut skipped = Vec::new();
    let beats = beats(scene);

    findings.extend(element_findings(project, scene, &mut skipped));
    findings.extend(lane_findings(scene));
    findings.extend(timeline_findings(scene));
    findings.extend(motion_findings(project, scene, &beats));
    findings.extend(continuity_findings(project, scene, &beats, &mut skipped));
    findings.extend(response_findings(project, scene));
    findings.extend(scene_note(project, &beats));
    // Measured once and read twice: the findings gate on it and the stats report it, and
    // sampling a 62-second mix at 10 Hz is the most expensive thing in this pass.
    let envelope = mix::envelope(project);
    findings.extend(mix_findings(scene, &envelope, &mut skipped));
    let mut composition = composition_findings(project, scene, &mut skipped);
    findings.append(&mut composition.findings);

    let mix = mix_stats(envelope);
    report(findings, skipped, stats(scene, &composition, beats, mix))
}

/// Run the same pass against only the part of the timeline that will be delivered.
///
/// The render tool accepts a duration, so `check` must be able to inspect that exact population
/// instead of silently certifying elements that begin after the exported file has already ended.
pub fn check_duration(project: &Project, duration: MediaTime) -> Report {
    let mut delivered = project.clone();
    let scene = delivered.active_scene_mut();
    for track in scene.tracks.iter_mut() {
        track.elements.retain(|element| element.start() < duration);
        for element in &mut track.elements {
            let available = duration - element.start();
            if element.duration() > available {
                element.set_duration(available);
                if let Some(channels) = element.animations_mut() {
                    for channel in channels.values_mut() {
                        channel.keys.retain(|key| key.time <= available);
                    }
                }
            }
        }
    }
    scene.markers.retain(|marker| marker.time < duration);
    check(&delivered)
}

/// Assemble the envelope: sort worst-first, roll every code up, and surface at most
/// [`MAX_FINDINGS`] of them.
fn report(mut findings: Vec<Finding>, skipped: Vec<Skipped>, stats: Stats) -> Report {
    // Errors first: an agent that reads only the head of the list should read the worst of it.
    // Stable within a severity, so the same project always produces the same report.
    findings.sort_by_key(|f| f.severity);

    let mut rollup: BTreeMap<&'static str, usize> = BTreeMap::new();
    for f in &findings {
        *rollup.entry(f.code).or_default() += 1;
    }
    let count = |severity| findings.iter().filter(|f| f.severity == severity).count();
    let (errors, warnings, notes) = (
        count(Severity::Error),
        count(Severity::Warning),
        count(Severity::Note),
    );
    let total = findings.len();
    let status = if total > 0 {
        Status::Findings
    } else if skipped.is_empty() {
        Status::Clean
    } else {
        Status::Unevaluated
    };

    Report {
        status,
        findings: surfaced(findings),
        rollup,
        skipped,
        stats,
        errors,
        warnings,
        notes,
        total,
    }
}

/// The at-most-twelve that get reported, drawn one per code in rotation.
///
/// Truncating the sorted list would mean 33 `unreadable-dwell` findings hiding a `dead-plate`;
/// the whole point of a short report is that what is in it is *representative*. The counts of
/// everything, including what was left out, are in [`Report::rollup`].
fn surfaced(findings: Vec<Finding>) -> Vec<Finding> {
    let mut keys: Vec<(Severity, &'static str)> = Vec::new();
    let mut buckets: Vec<Vec<Finding>> = Vec::new();
    for f in findings {
        let key = (f.severity, f.code);
        match keys.iter().position(|k| *k == key) {
            Some(index) => buckets[index].push(f),
            None => {
                keys.push(key);
                buckets.push(vec![f]);
            }
        }
    }
    let mut out = Vec::new();
    for round in 0.. {
        let mut took = false;
        for bucket in &buckets {
            let Some(f) = bucket.get(round) else { continue };
            out.push(f.clone());
            took = true;
            if out.len() >= MAX_FINDINGS {
                return out;
            }
        }
        if !took {
            break;
        }
    }
    out
}

fn stats(scene: &Scene, composition: &Composition, beats: Beats, mix: MixStats) -> Stats {
    let split = scene.by_source();
    let mut channels = 0usize;
    let mut opacity = 0usize;
    for element in scene.authored_elements() {
        let Some(animations) = element.animations() else {
            continue;
        };
        for (property, channel) in animations {
            if channel.keys.len() < 2 {
                continue;
            }
            channels += 1;
            if property == "opacity" {
                opacity += 1;
            }
        }
    }
    Stats {
        duration_seconds: timeline_end(scene).to_seconds_f64(),
        elements: split.authored.len() + split.tool.len(),
        authored_elements: split.authored.len(),
        tool_elements: split.tool.len(),
        authored_animated_channels: channels,
        authored_opacity_share: if channels == 0 {
            0.0
        } else {
            opacity as f64 / channels as f64
        },
        hook_ink: composition.hook_ink,
        median_frame_ink: composition.median_ink,
        ground: composition.ground.clone(),
        beats,
        mix,
    }
}

/// Per-element checks: is it addressable, visible, legible, and inside its own media?
fn element_findings(project: &Project, scene: &Scene, skipped: &mut Vec<Skipped>) -> Vec<Finding> {
    let canvas_height = project.settings.canvas.height.max(1) as f32;
    let mut findings = Vec::new();
    let mut media_clips = 0usize;
    let mut probed_clips = 0usize;

    for track in scene.tracks.iter() {
        for element in &track.elements {
            let here = |code, message: String| finding(code, message).on(&track.id, element);

            if element.duration() <= MediaTime::ZERO {
                findings.push(here(
                    "zero-length",
                    format!("{:?} has no duration, so it never appears", element.id()),
                ));
            }
            if element.start() < MediaTime::ZERO {
                findings.push(here(
                    "before-zero",
                    format!(
                        "{:?} starts at {:.3}s, before the beginning of the timeline",
                        element.id(),
                        element.start().to_seconds_f64()
                    ),
                ));
            }

            // A media id with no asset behind it renders nothing and exports nothing. This is
            // the single most common way an agent-built timeline comes out empty.
            if let Some(media_id) = element.media_id() {
                media_clips += 1;
                match project.media.iter().find(|asset| asset.id == media_id) {
                    None => findings.push(here(
                        "missing-media",
                        format!(
                            "{:?} plays media {media_id:?}, which is not in the project — import \
                             it with media_import first",
                            element.id()
                        ),
                    )),
                    Some(asset) if !std::path::Path::new(&asset.path).is_file() => {
                        if asset.source_duration().is_some() {
                            probed_clips += 1;
                        }
                        findings.push(here(
                            "missing-media",
                            format!(
                                "{:?} plays media {media_id:?}, but its file {:?} is missing — \
                                 restore or re-import it before rendering",
                                element.id(),
                                asset.path
                            ),
                        ));
                    }
                    Some(asset) if asset.source_duration().is_some() => probed_clips += 1,
                    Some(_) => {}
                }
            }

            // Trimmed past the end of its own file: the tail plays nothing.
            if let (Some(source_start), Some(media_id)) =
                (element.source_start(), element.media_id())
                && let Some(asset) = project.media.iter().find(|asset| asset.id == media_id)
                && let Some(length) = asset.source_duration()
            {
                let needs = source_start + element.duration();
                if needs > length {
                    findings.push(here(
                        "past-source-end",
                        format!(
                            "{:?} reads to {:.2}s of a {:.2}s file — the last {:.2}s of the clip \
                             has nothing behind it",
                            element.id(),
                            needs.to_seconds_f64(),
                            length.to_seconds_f64(),
                            (needs - length).to_seconds_f64(),
                        ),
                    ));
                }
            }

            // A grade whose file is not there renders nothing at all — the clip simply looks
            // untouched, which is indistinguishable from a subtle look. The renderer drops the
            // pass on purpose rather than losing the frame; saying so is this pass's job.
            for effect in element.effects().iter().filter(|effect| effect.enabled) {
                let Some(asset) = effect.asset.as_deref() else {
                    continue;
                };
                // `asset` is two namespaces: a path, or `look:<id>` naming a grade this build
                // generates itself. A built-in has no file and never will, so testing it with
                // `exists` reported every graded clip as broken — and because a render is
                // refused while an error stands, that turned the documented way to grade into
                // one that could not be exported. The id is still worth checking: a look that
                // does not exist renders ungraded, which is the failure this pass is for.
                if let Some(id) = bay_project::look_id(asset) {
                    if !bay_project::is_builtin_look(id) {
                        findings.push(here(
                            "missing-effect-asset",
                            format!(
                                "{:?} grades through the look {id:?}, which this build does not \
                                 have — the clip renders ungraded. The looks are: {}",
                                element.id(),
                                bay_project::BUILTIN_LOOKS.join(", ")
                            ),
                        ));
                    }
                } else if !std::path::Path::new(asset).exists() {
                    findings.push(here(
                        "missing-effect-asset",
                        format!(
                            "{:?} grades through {asset:?}, which is not on disk — the clip \
                             renders ungraded",
                            element.id()
                        ),
                    ));
                }
            }

            if let Some(transform) = element.transform() {
                findings.extend(transform_findings(&here, element, transform));
            }

            if let Element::Text(text) = element {
                if text.content.trim().is_empty() {
                    findings.push(here(
                        "empty-text",
                        format!("{:?} is a title with no text in it", element.id()),
                    ));
                }
                let effective = rendered_font_px(text.font_size, canvas_height);
                let fraction = effective / canvas_height;
                if fraction < MIN_LEGIBLE_TEXT_FRACTION && !text.content.trim().is_empty() {
                    findings.push(here(
                        "small-text",
                        format!(
                            "{:?} renders about {effective:.0}px tall on a {canvas_height:.0}px \
                             canvas ({:.1}% of the height) — too small to read at thumbnail size",
                            element.id(),
                            fraction * 100.0,
                        ),
                    ));
                }
                findings.extend(unreadable_dwell(&here, element, text));
            }

            // An animation whose keys run past the clip never finishes on screen: the viewer
            // sees the first half of a move and then a cut.
            if let Some(animations) = element.animations() {
                for (property, channel) in animations {
                    let Some(last) = channel.keys.last() else {
                        continue;
                    };
                    if last.time > element.duration() {
                        findings.push(here(
                            "animation-overruns",
                            format!(
                                "{:?} animates {property} out to {:.2}s but the clip is only \
                                 {:.2}s long, so the move never completes on screen",
                                element.id(),
                                last.time.to_seconds_f64(),
                                element.duration().to_seconds_f64(),
                            ),
                        ));
                    }
                }
            }
        }
    }

    if media_clips > 0 && probed_clips == 0 {
        skipped.push(Skipped {
            code: "past-source-end",
            reason: "no file on this timeline has been probed for its length, so there is \
                     nothing to compare a trim against"
                .into(),
        });
    }

    findings
}

/// How long text has to stay on screen to be read.
///
/// `0.30 s` to notice it plus a character every 17 — the subtitling rate — and a floor of 1.1 s
/// for anything that is a phrase rather than a word, because a line that arrives and leaves
/// inside a second is a flash whatever it says.
const DWELL_FIXED: f64 = 0.30;
const DWELL_CHARS_PER_SECOND: f64 = 17.0;
const DWELL_FLOOR: f64 = 1.1;
const DWELL_FLOOR_WORDS: usize = 3;

/// Opacity below which type is not being read, whatever the timeline says it is doing.
const LEGIBLE_OPACITY: f32 = 0.6;

/// Text on screen for less time than it takes to read.
///
/// Measured over the time the element is actually *legible* — sampled opacity times its fades,
/// above [`LEGIBLE_OPACITY`] — not over its duration. An element parked on the timeline for ten
/// seconds at 8 % opacity has a dwell of zero, and duration alone cannot see that.
///
/// **Authored text only.** bay's own captions are timed by `bay_speech`, which enforces its own
/// floor; a check that fires on the tool's output is a check that reports bay's house style as
/// the agent's mistake, and those are the findings that teach an agent to stop reading.
fn unreadable_dwell(
    here: &impl Fn(&'static str, String) -> Finding,
    element: &Element,
    text: &bay_project::TextElement,
) -> Option<Finding> {
    if !element.is_authored() {
        return None;
    }
    let content = text.content.trim();
    if content.is_empty() {
        return None;
    }
    let chars = content.chars().filter(|c| !c.is_whitespace()).count();
    let words = content.split_whitespace().count();
    let mut needs = DWELL_FIXED + chars as f64 / DWELL_CHARS_PER_SECOND;
    if words >= DWELL_FLOOR_WORDS {
        needs = needs.max(DWELL_FLOOR);
    }
    let legible = legible_seconds(element);
    if legible >= needs {
        return None;
    }
    Some(here(
        "unreadable-dwell",
        format!(
            "{:?} is legible for {legible:.2}s and reads in {needs:.2}s ({chars} characters) — \
             it leaves before it can be finished",
            element.id()
        ),
    ))
}

/// How long an element is on screen above [`LEGIBLE_OPACITY`], in seconds.
fn legible_seconds(element: &Element) -> f64 {
    let duration = element.duration();
    if duration <= MediaTime::ZERO {
        return 0.0;
    }
    let steps = SAMPLES_PER_SECOND
        .mul_add(duration.to_seconds_f64(), 1.0)
        .clamp(2.0, 4096.0) as i64;
    let mut legible = 0;
    for step in 0..steps {
        let local = MediaTime::from_ticks(duration.as_ticks() * step / steps);
        if sampled_opacity(element, local) >= LEGIBLE_OPACITY {
            legible += 1;
        }
    }
    duration.to_seconds_f64() * legible as f64 / steps as f64
}

/// Placement checks. `x`/`y` are the anchor as a fraction of the canvas, so anything outside
/// `0..1` has the anchor off the frame entirely.
fn transform_findings(
    here: &impl Fn(&'static str, String) -> Finding,
    element: &Element,
    transform: Transform,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    if !transform.x.is_finite() || !transform.y.is_finite() {
        findings.push(here(
            "transform-not-finite",
            format!("{:?} has a non-finite position", element.id()),
        ));
        return findings;
    }
    // Same trap as `invisible` below, and it went unfixed for the same reason: the base
    // transform is where the element was *authored*, not where it is *seen*. A slide-in is
    // authored off-frame and animated on; a slide-out is the reverse. Reading the base alone
    // refuses both — and `off-canvas` gates `render`, so it refused a correct video outright.
    // Only an element that no sample ever brings inside the frame is genuinely lost.
    if !(0.0..=1.0).contains(&transform.x) || !(0.0..=1.0).contains(&transform.y) {
        let inside = |t: &Transform| {
            t.x.is_finite()
                && t.y.is_finite()
                && (0.0..=1.0).contains(&t.x)
                && (0.0..=1.0).contains(&t.y)
        };
        // Sample the element's own life, endpoints included, so a move that only passes through
        // the frame is still credited with being in it.
        const SAMPLES: u32 = 24;
        let span = element.duration().to_seconds_f64();
        let ever_inside = (0..=SAMPLES).any(|step| {
            let seconds = span * f64::from(step) / f64::from(SAMPLES);
            MediaTime::from_seconds_f64(seconds)
                .and_then(|local| element.sampled_transform(local))
                .is_some_and(|sampled| inside(&sampled))
        });
        if !ever_inside {
            findings.push(here(
                "off-canvas",
                format!(
                    "{:?} is anchored at ({:.2}, {:.2}) for its whole life — outside the frame, \
                     which runs 0..1 on both axes",
                    element.id(),
                    transform.x,
                    transform.y
                ),
            ));
        }
    }
    // A base opacity of zero is the *correct* way to author a fade-in: the element is placed
    // transparent and a channel raises it. Reading the base alone fired on every well-made
    // entrance in the project — 60 findings, all of them wrong — so the animation has the final
    // say, and only an element that no channel ever brings above zero is invisible.
    let raised_by_animation = element
        .animations()
        .and_then(|a| a.get("opacity"))
        .is_some_and(|channel| channel.keys.iter().any(|key| key.value > 0.0));
    if transform.opacity <= 0.0 && !raised_by_animation {
        findings.push(here(
            "invisible",
            format!(
                "{:?} is fully transparent and nothing animates it up, so it renders nothing",
                element.id()
            ),
        ));
    }
    if transform.scale <= 0.0 || transform.scale_x <= 0.0 || transform.scale_y <= 0.0 {
        findings.push(here(
            "zero-scale",
            format!(
                "{:?} is scaled to nothing on at least one axis, so it renders nothing",
                element.id()
            ),
        ));
    }
    findings
}

/// Per-lane checks. Lanes are flat: two clips overlapping on one lane means the later one
/// covers the earlier, which is almost never what was meant on the main lane.
fn lane_findings(scene: &Scene) -> Vec<Finding> {
    let mut findings = Vec::new();
    for track in scene.tracks.iter() {
        if track.hidden && !track.elements.is_empty() {
            findings.push(
                finding(
                    "hidden-track-has-content",
                    format!(
                        "track {:?} holds {} element(s) and is hidden, so none of them render",
                        track.id,
                        track.elements.len()
                    ),
                )
                .at(0.0),
            );
        }

        // Only the main picture lane. Two clips overlapping there means the later one covers
        // the earlier, which is almost never intended — but an overlay lane exists *to* hold
        // things at the same time (a kicker over a chart over a ground), and audio lanes mix
        // rather than cover. Applied to every lane this fired 104 times on one project where
        // every single one was the composition working as designed, and drowned the findings
        // that were real.
        if track.id != scene.tracks.main.id {
            continue;
        }

        let mut ordered: Vec<&Element> = track.elements.iter().collect();
        ordered.sort_by_key(|element| element.start().as_ticks());
        for pair in ordered.windows(2) {
            let (first, second) = (pair[0], pair[1]);
            // An overlap the incoming clip fades into is a cross-dissolve, not a mistake.
            // Reporting one would teach people to ignore this check, which costs more than
            // the overlaps it would have caught.
            let overlap = first.end().as_ticks() - second.start().as_ticks();
            if overlap > 0 && second.fade_in().as_ticks() >= overlap {
                continue;
            }
            if second.start() < first.end() {
                findings.push(
                    finding(
                        "overlap",
                        format!(
                            "{:?} and {:?} overlap by {:.2}s on track {:?} — on one lane the \
                             later clip covers the earlier one",
                            first.id(),
                            second.id(),
                            (first.end() - second.start()).to_seconds_f64(),
                            track.id,
                        ),
                    )
                    .on(&track.id, second),
                );
            }
        }
    }
    findings
}

/// Whole-timeline checks: holes in the picture, and whether there is any sound at all.
fn timeline_findings(scene: &Scene) -> Vec<Finding> {
    let mut findings = Vec::new();

    // Every moment covered by *something* visual, across the main and overlay lanes. A hole in
    // the main lane that an overlay covers is not a black frame, so spans are merged across
    // lanes rather than checked per lane.
    let mut spans: Vec<(MediaTime, MediaTime)> = Vec::new();
    for (_, element) in picture_elements(scene) {
        if element.duration() > MediaTime::ZERO {
            spans.push((element.start(), element.end()));
        }
    }
    if spans.is_empty() {
        findings.push(
            finding(
                "nothing-visual",
                "the timeline has nothing on any visible picture lane — the render would be a \
                 blank frame throughout",
            )
            .at(0.0),
        );
        return findings;
    }

    spans.sort_by_key(|(start, _)| start.as_ticks());
    let mut covered_to = spans[0].1;
    if spans[0].0 > GAP_TOLERANCE {
        findings.push(
            finding(
                "black-start",
                format!(
                    "nothing is on screen for the first {:.2}s — the video opens on black",
                    spans[0].0.to_seconds_f64()
                ),
            )
            .at(0.0),
        );
    }
    for (start, end) in spans.iter().skip(1) {
        if *start > covered_to + GAP_TOLERANCE {
            findings.push(
                finding(
                    "gap",
                    format!(
                        "nothing is on screen from {:.2}s to {:.2}s — {:.2}s of black in the \
                         middle of the video",
                        covered_to.to_seconds_f64(),
                        start.to_seconds_f64(),
                        (*start - covered_to).to_seconds_f64(),
                    ),
                )
                .at(covered_to.to_seconds_f64()),
            );
        }
        covered_to = covered_to.max(*end);
    }

    let audible = scene.tracks.audio.iter().any(|track| {
        !track.muted
            && !track.hidden
            && track.elements.iter().any(|element| match element {
                Element::Audio(audio) => !audio.muted && audio.volume > 0.0,
                _ => false,
            })
    });
    if !audible {
        findings.push(
            finding(
                "silent",
                "nothing will be audible — the export carries no sound",
            )
            .at(0.0),
        );
    }

    findings
}

// Everything above answers "will this render wrong?" — a hole, an off-canvas title, a clip
// pointing at nothing. Everything below answers a different question: "will this render dead?"
//
// It exists because we measured four of our own AI-authored videos and every defect a viewer
// would name passed every check above. The worst of them is 34.2 % of canvas at 1.10:1
// contrast, holds a card that is empty for six seconds, and opens on a frame carrying one
// percent of its own median ink. All of that is a mechanical fact about the project model, so
// all of it can be caught here.
//
// **Three checks that used to live here are gone**: `front-loaded`, `inert-scene` and
// `no-accumulation`. They never fired on any project we condemned, on any bucketing of it,
// because the derivation they ran over collapsed to one bucket whenever the main lane held one
// clip — which it does in every project bay has produced. A check that has never fired is a
// comment, and a comment that looks like a check is worse than nothing.

// ------------------------------------------------------------------------------------- beats
//
// **The addressing scheme, not a quality rule.** A "beat" in the sense the doctrine means has no
// object in the project model, so it has to be derived — and the derivation this replaces was a
// clip on the main lane, which returned **one 62-second bucket** on every project bay has ever
// produced, because the main lane holds one element and the composition lives on overlays. Four
// checks read it and all four were arithmetically incapable of firing.
//
// Two things fix that, and they are different tools for different jobs:
//
// - **Pacing and motion measure on a sliding [`PACING_WINDOW_FRAMES`]-frame window.** Time-based,
//   so there is no structural handle to collapse and it does not care how the author used tracks.
//   It is also what closes round 1's sprinkle: a global min/max over move lengths is satisfied by
//   one 11.7 s outlier among 76 moves of 0.098 s, and a per-window one is not.
// - **Per-beat rules use ONE derivation, published in [`Stats::beats`]** so the agent can see its
//   own beats and argue with them: narration starts ∪ markers, falling back to changes of stage
//   that hold for [`BEAT_STAGE_SECONDS`], falling back to fixed [`BEAT_FIXED_SECONDS`] windows.
//   It must not be re-litigated per check.
//
// **The caveat that matters most, stated where it cannot be missed.** Re-deriving beats on the
// video this work comes from and re-running the four pacing checks over them **fires not one
// finding**: its beat lengths run 1.2–11.8 s, a 9.4× ratio, comfortably clearing the tempo test.
// **That video's pacing is genuinely fine.** Fixing the derivation is necessary — five checks are
// dead without it — and *demonstrably insufficient*. Nothing here should be read as having fixed
// the video; what fixes it is [`continuity_findings`], which asks a question none of the pacing
// checks ask.

/// Two cues closer together than this are one boundary. A breath between two narration lines is
/// not a new beat.
const BEAT_CUE_GAP: f64 = 1.0;

/// How long a change of stage has to hold before it is a beat rather than a flicker.
const BEAT_STAGE_SECONDS: f64 = 4.0;

/// The last-resort window. Nothing about a project can collapse this, which is the point: a
/// derivation with a floor of `ceil(duration / 8)` beats cannot return one bucket for a minute of
/// video however the tracks were used.
const BEAT_FIXED_SECONDS: f64 = 8.0;

/// Opacity at which an element counts as part of the stage. Above zero so that the tail of a
/// fade does not flicker the cast on and off.
const ON_STAGE: f32 = 0.05;

/// How the video was cut into beats, and where they fall.
///
/// Published in the report because an addressing scheme the agent cannot see is one it cannot
/// aim at: `broken-continuity` names beats by index and second, and this is the table that says
/// what those indices mean.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Beats {
    /// `cues` — narration starts and markers. `stage` — changes of what is on screen that hold
    /// for four seconds. `fixed` — eight-second windows, when neither of the above says anything.
    /// `none` — an empty timeline.
    pub derivation: &'static str,
    /// Where each beat starts, in seconds, ascending. The first is always 0.
    pub starts: Vec<f64>,
    /// Where the last beat ends: the end of the timeline.
    pub end_seconds: f64,
}

impl Beats {
    /// Each beat as `(start, end)` in seconds.
    fn spans(&self) -> Vec<(f64, f64)> {
        self.starts
            .iter()
            .enumerate()
            .map(|(index, start)| {
                let end = self
                    .starts
                    .get(index + 1)
                    .copied()
                    .unwrap_or(self.end_seconds);
                (*start, end)
            })
            .filter(|(start, end)| end > start)
            .collect()
    }

    fn lengths(&self) -> Vec<f64> {
        self.spans().iter().map(|(a, b)| b - a).collect()
    }
}

/// Cut the timeline into beats. One derivation, three fallbacks, no per-check opinions.
fn beats(scene: &Scene) -> Beats {
    let end = timeline_end(scene).to_seconds_f64();
    if end <= 0.0 {
        return Beats {
            derivation: "none",
            starts: Vec::new(),
            end_seconds: 0.0,
        };
    }

    // 1. What the author said out loud. A narration clip starting is a new thing being said, and
    //    a marker is the author declaring a beat by hand — the only two places in the model where
    //    the intended structure is written down rather than inferred.
    let spoken = scene
        .tracks
        .audio
        .iter()
        .filter(|track| !track.muted && !track.hidden)
        .flat_map(|track| track.elements.iter())
        .filter(|element| {
            element.audio_role() == Some(bay_project::AudioRole::Speech)
                && element.duration() > MediaTime::ZERO
        })
        .map(|element| element.start().to_seconds_f64());
    let cues: Vec<f64> = spoken
        .chain(
            scene
                .markers
                .iter()
                .map(|marker| marker.time.to_seconds_f64()),
        )
        .collect();
    let starts = condense(cues, BEAT_CUE_GAP, end);
    if starts.len() >= MIN_BEATS {
        return Beats {
            derivation: "cues",
            starts,
            end_seconds: end,
        };
    }

    // 2. What is on screen. A change of cast that holds for four seconds is a beat whether or not
    //    anybody labelled it.
    let starts = condense(stage_changes(scene), BEAT_STAGE_SECONDS, end);
    if starts.len() >= MIN_BEATS {
        return Beats {
            derivation: "stage",
            starts,
            end_seconds: end,
        };
    }

    // 3. The clock. Says nothing about the video, and that is why it is here: a per-beat rule
    //    must never be silent because a project happened to be authored on one lane.
    let count = (end / BEAT_FIXED_SECONDS).ceil().max(1.0) as usize;
    Beats {
        derivation: "fixed",
        starts: (0..count)
            .map(|index| index as f64 * BEAT_FIXED_SECONDS)
            .collect(),
        end_seconds: end,
    }
}

/// Fewer than two beats is not an addressing scheme, it is the bucket that started all this.
const MIN_BEATS: usize = 2;

/// Sort candidate boundaries, drop the ones too close to each other or to either end, and put
/// zero at the front — every derivation's beats start when the video does.
fn condense(mut times: Vec<f64>, gap: f64, end: f64) -> Vec<f64> {
    times.retain(|time| time.is_finite() && *time > gap && *time < end - gap);
    times.sort_by(f64::total_cmp);
    let mut starts = vec![0.0];
    for time in times {
        if time - starts[starts.len() - 1] >= gap {
            starts.push(time);
        }
    }
    starts
}

/// Every moment the cast on screen changes to something new that then holds.
///
/// The cast, not the composition: which authored elements are visible, by id. A move inside a
/// fixed cast is *continuity* — it is what `broken-continuity` is looking for — so treating it as
/// a new beat would cut the video at exactly the moments it is holding together.
///
/// Two clauses, both load-bearing. **It has to hold** for [`BEAT_STAGE_SECONDS`], or a card that
/// flashes for a second restructures the video around itself. And **it has to be new** — compared
/// against the last cast that was accepted, not against the sample before it, or coming back to
/// where you were reads as arriving somewhere.
fn stage_changes(scene: &Scene) -> Vec<f64> {
    let elements = picture_elements(scene);
    let end = timeline_end(scene);
    let mut runs: Vec<(f64, Vec<usize>)> = Vec::new();
    for at in sample_times(end) {
        let cast: Vec<usize> = elements
            .iter()
            .enumerate()
            .filter(|(_, (_, element))| on_stage(element, at))
            .map(|(index, _)| index)
            .collect();
        if runs.last().is_none_or(|(_, previous)| *previous != cast) {
            runs.push((at.to_seconds_f64(), cast));
        }
    }

    let finish = end.to_seconds_f64();
    let mut accepted = runs
        .first()
        .map(|(_, cast)| cast.clone())
        .unwrap_or_default();
    let mut changes = Vec::new();
    for index in 1..runs.len() {
        let holds = runs.get(index + 1).map_or(finish, |(next, _)| *next) - runs[index].0;
        if holds >= BEAT_STAGE_SECONDS && runs[index].1 != accepted {
            changes.push(runs[index].0);
            accepted = runs[index].1.clone();
        }
    }
    changes
}

/// Whether an authored element is visible at `at`.
fn on_stage(element: &Element, at: MediaTime) -> bool {
    element.is_authored()
        && element.duration() > MediaTime::ZERO
        && at >= element.start()
        && at < element.end()
        && sampled_opacity(element, at - element.start()) >= ON_STAGE
}

// -------------------------------------------------------------------------------- continuity
//
// **The one rule that rewards the videos we admire and fails the one we shipped.**
//
// Every difference measure anyone has proposed — ink IoU, descriptor distance, stage novelty,
// perceptual hash — pays for maximal frame-to-frame change, and **not one of them requires
// consecutive beats to share anything**. The global optimum of that rule set is eight unrelated
// full-bleed cards: a carousel, which passes everything else for about forty tool calls and zero
// design decisions.
//
// The clause that kills it cannot be faked by adding keyframes, because element identity across
// time is a **fact in the project file**. What that clause says, though, had to be rewritten
// against the references, and the correction is the important part of this comment:
//
// **Accumulation is continuity.** The first form of this rule asked every seam for a shared
// element that *moved*, and measured against the reference explainer it fired on eleven of
// thirteen seams — 5.5× what it found on the video it exists to condemn. R2's idiom is that an
// asset arrives on the narrated word, settles inside its own beat, and then holds forever, so
// every element it shares across a seam is motionless at both ends of it. The two seams it
// passed were the two diegetic act breaks. The rule was doing exactly what it said; the premise
// was wrong. An element that is present in both beats and never left is *stronger* evidence of
// one continuous composition than one that wiggled.
//
// So the question is asked only of seams where the composition was **replaced**: a quarter or
// more of what was on screen, by rendered area, is gone. Nothing left → the later beat contains
// the earlier one and the composition was carried through by construction, which is what R1's
// locked frame and R2's accumulation both are, and they are now silent *for the same reason*
// rather than R1 escaping on a `fixed` beat derivation and an `Element::Video` exemption.
// A carousel replaces 100 % of its cast at every seam and shares nothing by definition; the only
// way to pass is to carry something through, which **reduces** element count and so inverts
// round 1's incentive: 188 elements were not a success, they were eight beats rebuilt from
// scratch.
//
// The second half is the same idea one level down, borrowed from Manim's `TransformMatchingTex`:
// when two consecutive states show the same word, the word should be the same element, moved.
// Rebuilding it is the cross-fade lie — an assertion that these are two unrelated pictures, which
// is false, and which the video this comes from makes 107 times.

/// How far an element has to move, scale or turn between two beats before it has been *carried*
/// through rather than merely left on. The same numbers `no-response` uses, because it is the
/// same house definition of an element doing something.
const CARRIED_POSITION: f32 = 0.02;
const CARRIED_SCALE: f32 = 0.08;
const CARRIED_ROTATION: f32 = 5.0;

/// How much of the canvas the carried element has to actually occupy.
///
/// **Without this the whole rule is bought with one `add_shape` and one `animate`.** A rectangle
/// at 1 % of the canvas, on for the whole timeline, drifting linearly from x = 0.02 to x = 0.5,
/// clears every seam of a video that is otherwise eight unrelated cards. What survives a state
/// change has to be part of the composition, not a token left in a corner to satisfy a rule.
const CARRIED_AREA: f64 = 0.01;

/// A channel with two keys spanning this much of the runtime is **drift**, and drift never
/// counts toward anything. A single move from one end of the video to the other is ambient
/// liveness — it is not a state change at any particular seam, and it is the second half of the
/// one-element escape above: the element is only ever passing through.
const DRIFT_SHARE: f64 = 0.90;

/// How much of a beat's composition has to be **gone** at the next beat before the seam is a
/// replacement rather than an accumulation.
///
/// Measured, by rendered area, across the five fixtures: the reference explainer departs 0 % at
/// every one of its thirteen seams and the locked demo 0 % at all four of its, because neither
/// ever removes anything; the three condemned videos depart 23–92 %, and a carousel departs
/// 100 % by construction. A quarter of the frame leaving is the line between "the argument grew"
/// and "we cut to something else".
const REPLACED_SHARE: f64 = 0.25;

/// Tokens shorter than this are grammar. A four-character floor plus a short stop list keeps the
/// rule on content words, so "the" appearing in two beats is not a correspondence claim.
const TOKEN_MIN_CHARS: usize = 4;
const TOKEN_MIN_DIGITS: usize = 3;

/// How many words two beats have to have in common before a mismatch between them is a broken
/// correspondence rather than a coincidence. One word shared by two beats of a sixty-second video
/// says nothing; two or more says they are two states of the same content.
const MIN_SHARED_TOKENS: usize = 2;
const STOP_WORDS: &[&str] = &[
    "that", "this", "with", "from", "your", "have", "what", "when", "then", "than", "they", "them",
    "into", "were", "been", "will", "just", "only", "over", "more", "most", "some", "such", "here",
    "there", "these", "those", "about", "which", "would", "could", "should",
];

/// One element's state at the last instant it was on screen inside a beat, and the largest share
/// of the canvas it covered anywhere inside it.
#[derive(Clone, Copy)]
struct Held {
    transform: Transform,
    area: f64,
}

/// Which elements were on screen in a beat, and how they last stood.
fn held(elements: &[(&Track, &Element)], from: f64, to: f64) -> BTreeMap<usize, Held> {
    let mut out = BTreeMap::new();
    let steps = SAMPLES_PER_SECOND
        .mul_add(to - from, 1.0)
        .clamp(2.0, 8192.0) as i64;
    for step in 0..steps {
        let seconds = from + (to - from) * step as f64 / steps as f64;
        let Some(at) = MediaTime::from_seconds_f64(seconds) else {
            continue;
        };
        for (index, (_, element)) in elements.iter().enumerate() {
            if !on_stage(element, at) {
                continue;
            }
            let Some(transform) = element.sampled_transform(at - element.start()) else {
                continue;
            };
            // The last sample wins for the transform: what matters across a seam is how the
            // element stood when the beat ended, not how it arrived. Area is the *largest* it
            // reached, so an element judged too small to count was never big enough to matter.
            let area = Rect::of(&transform).map_or(0.0, |rect| rect.area());
            let area = out
                .get(&index)
                .map_or(area, |held: &Held| held.area.max(area));
            out.insert(index, Held { transform, area });
        }
    }
    out
}

/// Whether an element carries a *replacement* seam rather than merely being left switched on.
///
/// **Never by opacity, and that is the whole force of the rule.** A fade is the one class of
/// change known not to summon the eye, it is free, and it is how the carousel is built — 104 of
/// the 106 opacity channels in the video this comes from start at zero, so every state change in
/// it is a fade from nothing. An element that is on in both beats and did nothing but change how
/// transparent it is has not been carried anywhere. `no-response` draws the same line for the
/// same reason.
///
/// **Never by drift, and never by something too small to be part of the composition.** Those two
/// are one escape: a 1 %-of-canvas rectangle on for the whole timeline with a linear x drift from
/// one edge to the other clears every seam of a carousel for one `add_shape` and one `animate`.
///
/// There is no `Element::Video` exemption. There was one — "its frames advance where the project
/// model cannot see them" — and what it actually did was decide the whole rule on the *kind* of
/// the element holding a composition together: the locked reference passed only because its
/// centre is a screen recording, and swapping that one clip for a still condemned the identical
/// frame at every seam. Both references are now silent for the same reason as each other, which
/// is that neither of them ever takes anything away.
fn carried(before: &Held, after: &Held, drifting: bool) -> bool {
    if before.area.max(after.area) < CARRIED_AREA || drifting {
        return false;
    }
    let (a, b) = (&before.transform, &after.transform);
    let moved = |one: f32, two: f32, epsilon: f32| {
        !one.is_finite() || !two.is_finite() || (one - two).abs() >= epsilon
    };
    moved(a.x, b.x, CARRIED_POSITION)
        || moved(a.y, b.y, CARRIED_POSITION)
        || moved(a.scale, b.scale, CARRIED_SCALE)
        || moved(a.scale_x, b.scale_x, CARRIED_SCALE)
        || moved(a.scale_y, b.scale_y, CARRIED_SCALE)
        || moved(a.rotation, b.rotation, CARRIED_ROTATION)
}

/// New work should make the composition already on screen answer it.
///
/// Opacity never counts: a pulse buys attention without making room. A responder must have been
/// present for 45 frames on both sides of the arrival, occupy real canvas area, and move or scale
/// inside the 24-frame response window. The concentration cap prevents one decorative element
/// from pulsing for every arrival and certifying the whole video.
fn response_findings(project: &Project, scene: &Scene) -> Vec<Finding> {
    let fps = project.settings.fps.as_f64().max(1.0);
    let settled = MediaTime::from_seconds_f64(45.0 / fps).unwrap_or(MediaTime::ZERO);
    let window = MediaTime::from_seconds_f64(12.0 / fps).unwrap_or(MediaTime::ZERO);
    let elements: Vec<&Element> = scene.authored_elements().collect();
    let arrivals: Vec<(usize, &Element)> = elements
        .iter()
        .enumerate()
        .filter_map(|(index, element)| {
            let at = element.start();
            let replaces_something = elements.iter().any(|incumbent| {
                incumbent.id() != element.id()
                    && incumbent.transform().is_some()
                    && incumbent.start() < at
                    && incumbent.end() >= at - window
                    && incumbent.end() <= at + window
            });
            (element.transform().is_some()
                && element.start() > MediaTime::ZERO
                && replaces_something)
                .then_some((index, *element))
        })
        .collect();
    if arrivals.len() < 3 {
        return Vec::new();
    }

    let mut responses: Vec<Vec<usize>> = Vec::with_capacity(arrivals.len());
    let mut usage: BTreeMap<usize, usize> = BTreeMap::new();
    for (_, arriving) in &arrivals {
        let at = arriving.start();
        let mut responders = Vec::new();
        for (candidate_index, candidate) in elements.iter().enumerate() {
            if candidate.id() == arriving.id()
                || candidate.role() == Some(ElementRole::Ground)
                || candidate.start() + settled > at
                || candidate.end() < at + settled
            {
                continue;
            }
            let before_at = if at > window {
                at - window
            } else {
                MediaTime::ZERO
            };
            let after_at = at + window;
            let (Some(before), Some(after), Some(at_transform)) = (
                candidate.sampled_transform(before_at - candidate.start()),
                candidate.sampled_transform(after_at - candidate.start()),
                candidate.sampled_transform(at - candidate.start()),
            ) else {
                continue;
            };
            let area = Rect::of(&at_transform).map_or(0.0, |rect| rect.area());
            if area < CARRIED_AREA {
                continue;
            }
            let moved = (before.x - after.x).abs() >= CARRIED_POSITION
                || (before.y - after.y).abs() >= CARRIED_POSITION;
            let scaled = (before.scale - after.scale).abs() >= CARRIED_SCALE
                || (before.scale_x - after.scale_x).abs() >= CARRIED_SCALE
                || (before.scale_y - after.scale_y).abs() >= CARRIED_SCALE;
            if moved || scaled {
                responders.push(candidate_index);
                *usage.entry(candidate_index).or_default() += 1;
            }
        }
        responses.push(responders);
    }

    let concentration_cap = ((arrivals.len() as f64) * 0.40).ceil() as usize;
    let answered = responses
        .iter()
        .filter(|responders| {
            responders.iter().any(|index| {
                usage
                    .get(index)
                    .is_some_and(|count| *count <= concentration_cap)
            })
        })
        .count();
    if answered * 2 >= arrivals.len() {
        return Vec::new();
    }

    vec![finding(
        "no-response",
        format!(
            "{} of {} authored arrivals ({:.0}%) make an already-present element move or scale; \
             at least half must, and one responder may cover at most 40%",
            answered,
            arrivals.len(),
            answered as f64 * 100.0 / arrivals.len() as f64
        ),
    )]
}

/// Whether everything this element ever does to its own geometry is one drift across the video.
///
/// A channel of exactly two keys spanning more than [`DRIFT_SHARE`] of the runtime is ambient:
/// it is never *at* any particular seam, it is only ever passing through one. An element whose
/// entire motion is drifts of that shape has not changed state anywhere, so it cannot be what
/// carries a state change — which is the second half of the one-element escape, and the plan
/// says drift must never count toward anything.
fn only_drifts(element: &Element, runtime: f64) -> bool {
    const GEOMETRY: [&str; 6] = ["x", "y", "scale", "scaleX", "scaleY", "rotation"];
    let Some(animations) = element.animations() else {
        return false;
    };
    let mut any = false;
    for (property, channel) in animations {
        if !GEOMETRY.contains(&property.as_str()) || channel.keys.len() < 2 {
            continue;
        }
        let (Some(first), Some(last)) = (channel.keys.first(), channel.keys.last()) else {
            continue;
        };
        if channel.keys.iter().all(|key| key.value == first.value) {
            continue;
        }
        any = true;
        let span = (last.time - first.time).to_seconds_f64();
        if channel.keys.len() > 2 || runtime <= 0.0 || span < runtime * DRIFT_SHARE {
            return false;
        }
    }
    any
}

/// The content words a beat shows, and which element carries each.
fn tokens_on_stage<'a>(
    elements: &[(&Track, &'a Element)],
    on: &BTreeMap<usize, Held>,
) -> BTreeMap<String, Vec<&'a str>> {
    let mut out: BTreeMap<String, Vec<&'a str>> = BTreeMap::new();
    for index in on.keys() {
        let Element::Text(text) = elements[*index].1 else {
            continue;
        };
        for token in text.content.split(|c: char| !c.is_alphanumeric()) {
            let token = token.to_lowercase();
            let long_enough = if token.chars().all(|c| c.is_ascii_digit()) {
                token.len() >= TOKEN_MIN_DIGITS
            } else {
                token.chars().count() >= TOKEN_MIN_CHARS
            };
            if !long_enough || STOP_WORDS.contains(&token.as_str()) {
                continue;
            }
            let ids = out.entry(token).or_default();
            if !ids.contains(&text.id.as_str()) {
                ids.push(&text.id);
            }
        }
    }
    out
}

/// `broken-continuity`: what, if anything, survives each seam between beats.
///
/// One finding per seam at most — the shared-element failure first, the token failure second,
/// because a beat pair that carries nothing at all has a bigger problem than a mismatched word.
fn continuity_findings(
    project: &Project,
    scene: &Scene,
    beats: &Beats,
    skipped: &mut Vec<Skipped>,
) -> Vec<Finding> {
    let spans = beats.spans();
    // Fewer than two beats is not the `spans()` failure returning: the fixed fallback guarantees
    // `ceil(duration / 8)` beats whatever the tracks look like, so one beat means the video is
    // under eight seconds long. There is no seam, the rule is vacuous over an empty set of pairs,
    // and saying so on every three-second title card would spend the skip channel on nothing.
    // [`the_beat_derivation_cannot_collapse_to_one_bucket`] is what keeps that true.
    if spans.len() < MIN_BEATS {
        return Vec::new();
    }
    // **Never on the fixed fallback**, for the same reason the tempo check is not: eight-second
    // windows are a clock, and a seam the clock invented is not a seam. A locked composition that
    // holds one stage for forty seconds has no state change in it at all — it is a single take,
    // not a carousel — and cutting it every eight seconds to complain that nothing crosses the
    // cut would condemn the one form this rule exists to reward.
    if beats.derivation == "fixed" {
        skipped.push(Skipped {
            code: "broken-continuity",
            reason: format!(
                "this timeline has no narration and no markers and never changes what is on \
                 screen for {BEAT_STAGE_SECONDS:.0}s at a time, so its beats fall back to \
                 {BEAT_FIXED_SECONDS:.0}s windows — a clock, and a seam a clock invented is not a \
                 seam. narrate or marker_add is how a video says where its beats are."
            ),
        });
        return Vec::new();
    }
    let elements = picture_elements(scene);
    let runtime = timeline_end(scene).to_seconds_f64();
    let drifting: Vec<bool> = elements
        .iter()
        .map(|(_, element)| only_drifts(element, runtime))
        .collect();
    let on: Vec<BTreeMap<usize, Held>> = spans
        .iter()
        .map(|(from, to)| held(&elements, *from, *to))
        .collect();

    let mut findings = Vec::new();
    for (index, pair) in on.windows(2).enumerate() {
        let (before, after) = (&pair[0], &pair[1]);
        let (from, to) = (spans[index].0, spans[index + 1].0);
        let editorial = transcript_splice_departures(project, scene, &elements, before, after, to);
        // How much of the earlier composition is *gone*, by rendered area. Nothing gone is an
        // accumulation: the later beat contains the earlier one, and there is no state change
        // for anything to have to survive. A transcript-aligned, paired A/V splice is one
        // editorial stream rather than a graphic composition being replaced, so only that
        // outgoing video's area leaves this arithmetic. Any cards above it remain in both sums.
        let staged: f64 = before
            .iter()
            .filter(|(key, _)| !editorial.contains(*key))
            .map(|(_, held)| held.area)
            .sum();
        let departed: f64 = before
            .iter()
            .filter(|(key, _)| !editorial.contains(*key) && !after.contains_key(*key))
            .map(|(_, held)| held.area)
            .sum::<f64>()
            .max(0.0);
        let replaced = staged > 0.0 && departed / staged >= REPLACED_SHARE;
        let shared: Vec<usize> = before
            .keys()
            .filter(|key| after.contains_key(key))
            .copied()
            .collect();
        let moving = shared
            .iter()
            .filter(|key| carried(&before[key], &after[key], drifting[**key]))
            .count();

        if replaced && moving == 0 {
            let detail = if shared.is_empty() {
                format!(
                    "they have no element in common at all — {} elements leave and {} arrive",
                    before.len(),
                    after.len()
                )
            } else {
                format!(
                    "{:.0}% of what was on screen is gone and the {} element(s) still there do \
                     not move, scale or turn between the two — a fade does not count, because \
                     fading is what a carousel does, and neither does a drift across the whole \
                     video or something too small to be part of the picture",
                    departed / staged * 100.0,
                    shared.len(),
                )
            };
            findings.push(
                finding(
                    "broken-continuity",
                    format!(
                        "beat {} ({from:.1}s) and beat {} ({to:.1}s) replace the composition and \
                         carry nothing across: {detail}. A cut that shares nothing asserts these \
                         are two unrelated pictures. Keep an element across the seam and animate \
                         it there, or let the next beat build on this one instead of replacing \
                         it — a composition that only ever accumulates is continuous by \
                         construction.",
                        index + 1,
                        index + 2,
                    ),
                )
                .at(to),
            );
            continue;
        }

        // The same question one level down: a word that survives the seam should survive as the
        // same element. Rebuilt, it is a cross-fade between two states that share their content.
        let (was, now) = (
            tokens_on_stage(&elements, before),
            tokens_on_stage(&elements, after),
        );
        let common: Vec<&String> = was
            .keys()
            .filter(|token| now.contains_key(*token))
            .collect();
        if common.len() < MIN_SHARED_TOKENS {
            continue;
        }
        let rebuilt = common
            .iter()
            .find(|token| now[**token].iter().all(|id| !was[**token].contains(id)));
        if let Some(token) = rebuilt {
            findings.push(
                finding(
                    "broken-continuity",
                    format!(
                        "beat {} ({from:.1}s) and beat {} ({to:.1}s) have {} words in common, and \
                         {token:?} is a different element in each ({} then {}). A word that \
                         survives a state change should survive as the same element, moved — \
                         rebuilding it cross-fades between two pictures that share their content, \
                         which says they are unrelated when they are not.",
                        index + 1,
                        index + 2,
                        common.len(),
                        was[*token].join(", "),
                        now[*token].join(", "),
                    ),
                )
                .at(to),
            );
        }
    }
    findings
}

/// Floating Whisper boundaries are persisted as seconds and clip points as integer ticks. This
/// tolerance is only representation slack (six ticks at bay's 120 kHz timebase), not permission
/// to call an arbitrary nearby cut transcript-aligned.
const TRANSCRIPT_SPLICE_EPSILON_SECONDS: f64 = 0.000_05;

/// Outgoing video elements that form a transcript tool's paired A/V splice at `at`.
///
/// No caller assertion participates. The project must prove all of these independently:
///
/// - two butted hard-cut videos on the same lane and from the same transcribed asset;
/// - out/in points that are exact transcript word boundaries (whether adjacent or selected); and
/// - tool-authored speech clips with identical timeline and source intervals for both videos.
///
/// The returned set contains only the outgoing video. Subtracting that area cannot launder a
/// carousel above the footage: those authored elements stay in the replacement numerator and
/// denominator.
fn transcript_splice_departures(
    project: &Project,
    scene: &Scene,
    elements: &[(&Track, &Element)],
    before: &BTreeMap<usize, Held>,
    after: &BTreeMap<usize, Held>,
    at: f64,
) -> BTreeSet<usize> {
    let Some(seam) = MediaTime::from_seconds_f64(at) else {
        return BTreeSet::new();
    };
    let paired_audio = |video: &bay_project::VideoElement| {
        scene
            .tracks
            .audio
            .iter()
            .filter(|track| !track.hidden && !track.muted)
            .flat_map(|track| &track.elements)
            .any(|element| {
                let Element::Audio(audio) = element else {
                    return false;
                };
                audio.media_id == video.media_id
                    && audio.start == video.start
                    && audio.duration == video.duration
                    && audio.trim_start == video.trim_start
                    && audio.source == bay_project::ElementSource::Tool
                    && audio.role == bay_project::AudioRole::Speech
            })
    };
    let boundary = |asset: &bay_project::MediaAsset, seconds: f64, start: bool| {
        asset.transcript.as_ref().is_some_and(|transcript| {
            transcript.words.iter().any(|word| {
                let expected = if start {
                    word.start_seconds
                } else {
                    word.end_seconds
                };
                (expected - seconds).abs() <= TRANSCRIPT_SPLICE_EPSILON_SECONDS
            })
        })
    };

    let mut editorial = BTreeSet::new();
    for outgoing_index in before
        .keys()
        .filter(|key| !after.contains_key(*key))
        .copied()
    {
        let (outgoing_track, Element::Video(outgoing)) = elements[outgoing_index] else {
            continue;
        };
        if outgoing.start + outgoing.duration != seam
            || outgoing.fade_in > MediaTime::ZERO
            || outgoing.fade_out > MediaTime::ZERO
            || !paired_audio(outgoing)
        {
            continue;
        }
        let Some(asset) = project
            .media
            .iter()
            .find(|asset| asset.id == outgoing.media_id)
        else {
            continue;
        };
        if !boundary(asset, outgoing.trim_end.to_seconds_f64(), false) {
            continue;
        }
        let incoming = after
            .keys()
            .filter(|key| !before.contains_key(*key))
            .find_map(|incoming_index| {
                let (incoming_track, Element::Video(incoming)) = elements[*incoming_index] else {
                    return None;
                };
                (incoming_track.id == outgoing_track.id
                    && incoming.media_id == outgoing.media_id
                    && incoming.start == seam
                    && incoming.fade_in == MediaTime::ZERO
                    && incoming.fade_out == MediaTime::ZERO
                    && boundary(asset, incoming.trim_start.to_seconds_f64(), true)
                    && paired_audio(incoming))
                .then_some(incoming)
            });
        if incoming.is_some() {
            editorial.insert(outgoing_index);
        }
    }
    editorial
}

/// A long video that never says where its beats are.
///
/// **A note, and that is the whole decision.** No MCP tool creates a scene and `export_video`
/// takes one `&Scene`, so a project that split itself into seven scenes would render one seventh
/// of itself — shipping this as an error would brick every session. What it is worth saying is
/// what the agent can actually do: `marker_add` is how a beat gets declared, and a declared beat
/// is what the tempo check and `broken-continuity` are addressed against.
fn scene_note(project: &Project, beats: &Beats) -> Option<Finding> {
    const LONG_ENOUGH: f64 = 15.0;
    if project.scenes.len() != 1 || beats.end_seconds <= LONG_ENOUGH || beats.derivation != "fixed"
    {
        return None;
    }
    Some(
        finding(
            "one-scene",
            format!(
                "{:.0}s of video with no narration and no markers, so its beats fall back to \
                 {BEAT_FIXED_SECONDS:.0}s windows — a clock, not a structure. Nothing is wrong \
                 with one scene (bay renders one scene, and no tool makes another), but marker_add \
                 is how you say where a beat lands, and the beats in stats.beats are what the \
                 pacing and continuity checks are addressed against.",
                beats.end_seconds
            ),
        )
        .at(0.0),
    )
}

/// Every element on a lane that renders, **in composite order**: the main lane first, then each
/// overlay lane, each in its own item order — which is exactly how `render_inner` iterates and
/// therefore which element is on top of which.
///
/// Audio is not here: these checks are about what is on screen.
fn picture_elements(scene: &Scene) -> Vec<(&Track, &Element)> {
    std::iter::once(&scene.tracks.main)
        .chain(scene.tracks.overlay.iter())
        .filter(|track| !track.hidden)
        .flat_map(|track| track.elements.iter().map(move |element| (track, element)))
        .collect()
}

fn timeline_end(scene: &Scene) -> MediaTime {
    scene
        .elements()
        .map(|element| element.end())
        .max()
        .unwrap_or(MediaTime::ZERO)
}

/// Below this many animated channels a single curve is a house style applied to a couple of
/// moves. At eight or more it is the whole motion vocabulary of the video — ours used exactly
/// one easing across 70 seconds, because the skill documented exactly one entrance.
const MIN_CHANNELS_FOR_VARIETY: usize = 8;

/// Moves within this ratio of each other read as the same speed. A real vocabulary has a snap
/// and a settle, which is nearer 4×; 1.25 fires only when every move in the project is
/// effectively the same length, as ours were.
const MIN_MOVE_RATIO: f64 = 1.25;

/// Fewer beats than this is not a rhythm, it is a cut.
const MIN_BEATS_FOR_RHYTHM: usize = 3;

/// The doctrine asks for the slowest beat to run about 3× the fastest. Firing below 1.5×
/// leaves a deliberate 2× rhythm alone and still catches 10.5 / 10.0 / 9.6s, which is 1.09×.
const MIN_BEAT_RATIO: f64 = 1.5;

/// How wide the pacing window is, in frames. 150 is five seconds at 30 fps — long enough to hold
/// a phrase of motion, short enough that a project cannot average its way out of one.
const PACING_WINDOW_FRAMES: f64 = 150.0;

/// How far the window steps, as a fraction of itself. Half a window, so a cluster of identical
/// moves cannot sit astride a seam and be counted as two halves of nothing.
const PACING_STEP: f64 = 0.5;

/// What share of the windows have to be internally monotone before the project is.
///
/// **Not all of them, on purpose.** Requiring every window would hand the sprinkle back: one
/// 11.7 s move among 76 of 0.098 s buys variety in the two windows it touches, and if those two
/// windows excused the other twenty the check would measure exactly what round 1 measured.
const MOSTLY_FLAT: f64 = 0.8;

/// One dense window is a moment, not a habit.
const MIN_PACING_WINDOWS: usize = 2;

/// One value-changing animation segment: when it starts, how long it runs, and its curve.
struct Move {
    at: f64,
    length: f64,
    easing: Easing,
}

/// Every move an author asked for. Captions are bay's own timing, not the author's vocabulary.
fn authored_moves(scene: &Scene) -> Vec<Move> {
    let mut moves = Vec::new();
    for element in scene.authored_elements() {
        let Some(animations) = element.animations() else {
            continue;
        };
        let start = element.start().to_seconds_f64();
        for channel in animations.values() {
            for (index, easing) in channel_easings(channel).into_iter().enumerate() {
                let (from, to) = (&channel.keys[index], &channel.keys[index + 1]);
                if from.value == to.value {
                    continue;
                }
                let length = (to.time - from.time).to_seconds_f64();
                if length <= 0.0 {
                    continue;
                }
                moves.push(Move {
                    at: start + from.time.to_seconds_f64(),
                    length,
                    easing,
                });
            }
        }
    }
    moves
}

/// The moves in each sliding window that holds enough of them to have a vocabulary.
///
/// **This is the shape that closes round 1's hole.** A global min/max over move lengths is
/// satisfied by sprinkling one 11.7 s move among 76 of 0.098 s — the measured way the round-1
/// duration metric was hit. Per window, a sprinkle only rescues the window it is in, and the
/// cheapest way to pass is to actually vary the motion where the motion is.
fn pacing_windows(moves: &[Move], end: f64, fps: f64) -> Vec<Vec<usize>> {
    let window = PACING_WINDOW_FRAMES / fps.max(1.0);
    if !window.is_finite() || window <= 0.0 || end <= 0.0 {
        return Vec::new();
    }
    let step = window * PACING_STEP;
    let mut windows = Vec::new();
    let mut from = 0.0;
    while from < end {
        let inside: Vec<usize> = moves
            .iter()
            .enumerate()
            .filter(|(_, one)| one.at >= from && one.at < from + window)
            .map(|(index, _)| index)
            .collect();
        if inside.len() >= MIN_CHANNELS_FOR_VARIETY {
            windows.push(inside);
        }
        from += step;
    }
    windows
}

/// The curve on every segment of a channel: a key's own easing where it has one, the channel's
/// otherwise.
///
/// Easing lives in two places — the channel carries a default and a key may override the
/// segment leaving it — and the count that matters is over *segments*, not over channels. A
/// project that varies its curves key by key would read as monotone if only the channel field
/// were counted, and a check that fires on the author who did the work is a check that gets
/// turned off. The last key is skipped: it has no segment leaving it, so an easing set on it
/// changes nothing and must not count as variety.
fn channel_easings(channel: &AnimationChannel) -> Vec<Easing> {
    let segments = channel.keys.len().saturating_sub(1);
    channel.keys[..segments]
        .iter()
        .map(|key| key.easing.unwrap_or(channel.easing))
        .collect()
}

/// The motion vocabulary: how many different curves and speeds, what the registry accounts for,
/// what lands on a frame, and whether any curve overshoots a number.
fn motion_findings(project: &Project, scene: &Scene, beats: &Beats) -> Vec<Finding> {
    let mut findings = Vec::new();
    let fps = project.settings.fps.as_f64().max(1.0);

    // **The whole-project forms of these two are gone, and their deletion is the point.** They
    // were a distinct-value cardinality (`curves.len() == 1`) and a one-sided global ratio
    // (`longest / shortest < MIN_MOVE_RATIO`) over the project JSON — the two shapes plan §1.4
    // rejects on sight, and the two round 1 shipped and had answered with 130 `hold` keys on flat
    // segments and one 11.7 s move among 76 of 0.098 s. Worse, they fire on a project whose ~40
    // assets share one motion idea *by design*, which is the reference explainer, and not at all
    // on the video this round exists because of: they rank the good video below the bad one,
    // which is round 1's inversion exactly.
    //
    // What survives is the same two questions asked per sliding window. A sprinkle rescues only
    // the window it is in, so the cheapest way to pass is to vary the motion where the motion is.
    let moves = authored_moves(scene);
    let seconds = PACING_WINDOW_FRAMES / fps;
    let windows = pacing_windows(&moves, timeline_end(scene).to_seconds_f64(), fps);
    let mostly = |count: usize| {
        windows.len() >= MIN_PACING_WINDOWS && count as f64 >= windows.len() as f64 * MOSTLY_FLAT
    };
    let flat = windows
        .iter()
        .filter(|inside| {
            let first = moves[inside[0]].easing;
            inside.iter().all(|index| moves[*index].easing == first)
        })
        .count();
    if mostly(flat) {
        findings.push(
            finding(
                "monotone-easing",
                format!(
                    "{flat} of {} {seconds:.0}-second windows of this timeline ease every move \
                     inside them the same way — no moment of the video has more than one curve in \
                     it, so whatever variety the project has is never seen",
                    windows.len(),
                ),
            )
            .at(0.0),
        );
    }
    let flat: Vec<(f64, f64)> = windows
        .iter()
        .filter_map(|inside| {
            let mut lengths: Vec<f64> = inside.iter().map(|index| moves[*index].length).collect();
            lengths.sort_by(f64::total_cmp);
            let (shortest, longest) = (lengths[0], lengths[lengths.len() - 1]);
            (longest / shortest < MIN_MOVE_RATIO).then_some((shortest, longest))
        })
        .collect();
    if mostly(flat.len()) {
        let shortest = flat.iter().map(|(s, _)| *s).fold(f64::INFINITY, f64::min);
        let longest = flat.iter().map(|(_, l)| *l).fold(0.0_f64, f64::max);
        findings.push(
            finding(
                "monotone-duration",
                format!(
                    "{} of {} {seconds:.0}-second windows of this timeline run every move inside \
                     them at one speed ({shortest:.2}s to {longest:.2}s across those windows) — \
                     one long move elsewhere does not give any particular moment a snap and a \
                     settle",
                    flat.len(),
                    windows.len(),
                ),
            )
            .at(0.0),
        );
    }

    // Tempo, per beat. The derivation is published in `stats.beats`; this is the only check that
    // reads beat *lengths*, and on the video this work comes from it does not fire — 1.2–11.8s is
    // a 9.4x ratio. That is the honest result, not a bug in the derivation.
    //
    // **Never on the fixed fallback.** Eight-second windows are eight seconds long by
    // construction, so their ratio is 1.00× and measuring it would report the clock as the
    // video's tempo. When the derivation is `fixed` the project has declared no beats at all,
    // and `one-scene` says so with what to do about it.
    let mut lengths = if beats.derivation == "fixed" {
        Vec::new()
    } else {
        beats.lengths()
    };
    if lengths.len() >= MIN_BEATS_FOR_RHYTHM {
        lengths.sort_by(f64::total_cmp);
        let (shortest, longest) = (lengths[0], lengths[lengths.len() - 1]);
        if longest / shortest < MIN_BEAT_RATIO {
            findings.push(
                finding(
                    "monotone-duration",
                    format!(
                        "all {} beats ({} derivation) run between {shortest:.1}s and {longest:.1}s \
                         ({:.2}× longest to shortest) — the video has one tempo, where the slowest \
                         beat wants to be about 3× the fastest",
                        lengths.len(),
                        beats.derivation,
                        longest / shortest,
                    ),
                )
                .at(0.0),
            );
        }
    }

    // The move registry's own audit, surfaced. Hand-keying survives as an escape hatch; what it
    // does not survive as is anonymous, so every channel that goes around the vocabulary is
    // named with its element and the cost of evasion scales with how much of the project evades.
    for off in moves::off_vocabulary(scene, fps as f32) {
        findings.push(finding(moves::OffVocabularyMotion::CODE, off.message()));
    }
    findings.extend(value_overshoot(scene));
    findings.extend(off_grid(scene, fps));
    if let Some(kit) = project.settings.kit.as_ref() {
        for off in kit.off_token_values(scene) {
            findings.push(finding(kit::OffToken::CODE, off.message()));
        }
    }
    findings
}

/// Channels whose size *is* the number they are drawing.
///
/// A bar's height, a plotted mark's length: an easing that leaves `[0, 1]` on one of these
/// draws a value the data does not contain. `BackOut` peaks at **1.10005** at t = 0.580, so a
/// bar eased into place with it displays 110 % of its own number for a quarter of a second.
///
/// Scoped, deliberately, to the two cases where a scale channel is a magnitude and not a pop:
/// anything the author declared `role: data`, and a `Shape` stretched along a single axis —
/// a rectangle growing in one direction is a bar, and a bar's length is its value. A uniform
/// `scale` overshoot on a title is a pop; it may be cheap, but it is not a false statement.
fn value_overshoot(scene: &Scene) -> Vec<Finding> {
    let mut findings = Vec::new();
    for element in scene.authored_elements() {
        let is_data = element.role() == Some(ElementRole::Data);
        let is_shape = matches!(element, Element::Shape(_));
        let Some(animations) = element.animations() else {
            continue;
        };
        for (property, channel) in animations {
            let magnitude = match property.as_str() {
                "scale" => is_data,
                "scaleX" | "scaleY" => is_data || is_shape,
                _ => false,
            };
            if !magnitude {
                continue;
            }
            for (index, easing) in channel_easings(channel).into_iter().enumerate() {
                let (from, to) = (&channel.keys[index], &channel.keys[index + 1]);
                if from.value == to.value {
                    continue;
                }
                let Some(peak) = overshoot_of(easing) else {
                    continue;
                };
                let reached = from.value + (to.value - from.value) * peak;
                findings.push(
                    finding(
                        "value-overshoot",
                        format!(
                            "{:?} eases {property} to {:.4} with {easing:?}, which passes its own \
                             target and reaches {reached:.4} ({:.1}% of the value) before settling \
                             — on a channel whose size is the number, that draws data nobody has. \
                             spring-out settles without overshooting.",
                            element.id(),
                            to.value,
                            peak * 100.0,
                        ),
                    )
                    .on_element(element),
                );
            }
        }
    }
    findings
}

/// The largest value an easing reaches, if it ever leaves `[0, 1]`.
///
/// Sampled from [`Easing::apply`] rather than listed, so an easing added later is covered by
/// the check the day it exists rather than the day someone remembers this table.
fn overshoot_of(easing: Easing) -> Option<f32> {
    const STEPS: i32 = 200;
    let mut peak = 1.0_f32;
    for step in 0..=STEPS {
        peak = peak.max(easing.apply(step as f32 / STEPS as f32));
    }
    (peak > 1.0 + 1e-4).then_some(peak)
}

/// How many frames a move must last before it reads as a move rather than as a cut, and how
/// much of a project may be under it.
const MIN_SEGMENT_FRAMES: f64 = 4.0;
const MAX_SHORT_SEGMENT_SHARE: f64 = 0.10;

/// The timeline against the frame it will be shown at.
///
/// Two facts, one code, because they are one idea: a cut or a move that does not land on a
/// frame is not the cut or the move that was authored. Times off the grid are rounded by the
/// encoder — an edit half a frame from where it was asked for — and a value-changing segment
/// under four frames is received as a jump, not as motion.
///
/// **A warning, not an error, and that is a decision worth stating.** Every project bay has
/// produced has times off the grid (89 of 300 on the worst, 128 of 196 on one of its
/// predecessors), because nothing in the tool surface snaps them. Shipping this as a gate would
/// mean every existing project needing the render override on its first call, which is how an
/// override becomes habitual — and an override that is habitual is worth less than the rule it
/// bypasses. The right fix is upstream, in a tool that rounds; until then this says so.
fn off_grid(scene: &Scene, fps: f64) -> Option<Finding> {
    let ticks_per_frame = bay_time::TICKS_PER_SECOND as f64 / fps;
    if !ticks_per_frame.is_finite() || ticks_per_frame < 1.0 {
        return None;
    }
    let on_grid = |ticks: i64| {
        let frames = ticks as f64 / ticks_per_frame;
        (frames - frames.round()).abs() < 1e-6
    };

    let (mut off, mut times) = (0usize, 0usize);
    let (mut short, mut segments) = (0usize, 0usize);
    let mut worst = f64::INFINITY;
    for element in scene.authored_elements() {
        for ticks in [element.start().as_ticks(), element.duration().as_ticks()] {
            times += 1;
            if !on_grid(ticks) {
                off += 1;
            }
        }
        let Some(animations) = element.animations() else {
            continue;
        };
        for channel in animations.values() {
            for pair in channel.keys.windows(2) {
                if pair[0].value == pair[1].value {
                    continue;
                }
                segments += 1;
                let frames = (pair[1].time - pair[0].time).as_ticks() as f64 / ticks_per_frame;
                if frames < MIN_SEGMENT_FRAMES {
                    short += 1;
                    worst = worst.min(frames);
                }
            }
        }
    }

    let short_share = if segments == 0 {
        0.0
    } else {
        short as f64 / segments as f64
    };
    if off == 0 && short_share <= MAX_SHORT_SEGMENT_SHARE {
        return None;
    }
    let tail = if short == 0 {
        String::new()
    } else {
        format!(
            "; {short} of {segments} value-changing segments ({:.0}%) run under \
             {MIN_SEGMENT_FRAMES:.0} frames, the shortest {worst:.1}, which is received as a cut \
             rather than as a move",
            short_share * 100.0
        )
    };
    Some(
        finding(
            "off-grid",
            format!(
                "{off} of {times} authored start and duration values do not land on a frame at \
                 {fps:.2} fps{tail}"
            ),
        )
        .at(0.0),
    )
}

/// Two clips have to play together for this long before their levels describe a mix. Anything
/// shorter is a crossfade between two lines, and judging a 0.3s handover as a failed duck is
/// how a check gets switched off.
const MIN_MIX_OVERLAP: f64 = 2.0;

/// A bed under a voice wants 10–15 dB of separation. Firing under 6 dB — one doubling of
/// amplitude — reports only the mixes where the bed is sitting inside the voice's own range,
/// and leaves a deliberately close mix alone.
const MIN_DUCK_DB: f32 = 6.0;

/// How much of the timeline has to carry sound before "there is nothing under it" is a
/// statement about the mix rather than about a video that is mostly quiet on purpose.
const MIN_AUDIO_COVERAGE: f64 = 0.5;

/// Samples taken across an overlap. Enough that an eased duck is measured on its way down
/// rather than only at its endpoints.
const MIX_SAMPLES: i64 = 32;

/// An audio clip with the lane it plays on — enough to report a finding against it.
type Sounding<'a> = (&'a Track, &'a Element);

/// Every audio clip that will actually be heard, with the lane it is on.
///
/// Audibility is read through [`Element::gain_points`] rather than off the `volume` field: a
/// clip at `volume: 0.0` whose keyframes ramp it up is audible, and a clip at unity that is
/// muted is not.
fn audible_audio(scene: &Scene) -> Vec<Sounding<'_>> {
    scene
        .tracks
        .audio
        .iter()
        .filter(|track| !track.muted && !track.hidden)
        .flat_map(|track| track.elements.iter().map(move |element| (track, element)))
        .filter(|(_, element)| element.duration() > MediaTime::ZERO)
        .filter(|(_, element)| element.gain_points().iter().any(|(_, gain)| *gain > 0.0))
        .collect()
}

/// The mix: whether anything plays under the voice, and whether it gets out of the way.
fn mix_findings(
    scene: &Scene,
    envelope: &mix::MixEnvelope,
    skipped: &mut Vec<Skipped>,
) -> Vec<Finding> {
    let audio = audible_audio(scene);
    let mut findings = Vec::new();

    for (first, second) in overlapping_pairs(&audio) {
        findings.extend(flat_mix(first, second));
    }
    findings.extend(no_bed(scene, &audio));
    findings.extend(loudness_findings(&audio, envelope, skipped));
    findings
}

/// The two measured mix checks, and the reasons they could not run.
///
/// Both are computed on [`mix::envelope`] — the project's own levels, in LUFS, from each asset's
/// measured loudness and the gain envelope the timeline describes. That is the whole point: the
/// warning these replace compared raw `volume` floats across files whose loudness differed by 15
/// dB, so its number was fiction, it fired 22 times on one project with 16 of them harmless, and
/// it was satisfiable by scaling every gain down — which changes nothing audible at all.
fn loudness_findings(
    audio: &[Sounding<'_>],
    envelope: &mix::MixEnvelope,
    skipped: &mut Vec<Skipped>,
) -> Vec<Finding> {
    let codes = ["speech-masked", "bed-too-quiet"];
    if audio.is_empty() {
        return Vec::new();
    }

    // Unmeasured assets are not silent ones. Saying so is the difference between "the mix is
    // fine" and "nobody has measured the mix", and those two used to look identical.
    if !envelope.unmeasured.is_empty() {
        let reason = format!(
            "{} of the sounds on this timeline have never been measured ({}), so a bed and a \
             voice cannot be compared in the same unit — call audio_probe on them",
            envelope.unmeasured.len(),
            envelope.unmeasured.join(", "),
        );
        for code in codes {
            skipped.push(Skipped {
                code,
                reason: reason.clone(),
            });
        }
        return Vec::new();
    }
    if !envelope.has_speech {
        for code in codes {
            skipped.push(Skipped {
                code,
                reason: "no clip on this timeline is marked as speech, so there are no lines for \
                         a bed to get out of the way of"
                    .into(),
            });
        }
        return Vec::new();
    }

    let mut findings = Vec::new();
    match (envelope.separation_lu(), envelope.gap_lufs) {
        (Some(separation), Some(gap)) if separation < mix::MIN_SEPARATION_LU => {
            findings.push(
                finding(
                    "speech-masked",
                    format!(
                        "the lines sit at {:.1} LUFS and the gaps between them at {gap:.1} — \
                         {separation:.1} LU apart, where a narrated mix wants at least {:.0}. \
                         The music has to come down under the voice and back up between the \
                         lines: duck(bedId, underIds) writes that as keyframes on the bed \
                         itself. Levels are measured, not typed — turning every gain down \
                         together moves this by zero.",
                        envelope.narration_lufs.unwrap_or_default(),
                        mix::MIN_SEPARATION_LU,
                    ),
                )
                .at(0.0),
            );
        }
        (Some(_), _) => {}
        _ => skipped.push(Skipped {
            code: "speech-masked",
            reason: "the timeline has speech but no stretch where nothing is being said, so \
                     there are no gaps to compare the lines against"
                .into(),
        }),
    }

    match (envelope.has_bed, envelope.gap_bed_lufs) {
        (true, Some(level)) if level < mix::MIN_GAP_BED_LUFS => findings.push(
            finding(
                "bed-too-quiet",
                format!(
                    "between the lines the bed measures {level:.1} LUFS against a delivered \
                     programme of {:.0} — {:.0} LU down, which is not audible on a phone. The \
                     file itself is probably quiet: audio_probe says what it measures, and the \
                     level to reach is about {:.0} LUFS between lines.",
                    mix::DELIVERY_LUFS,
                    mix::DELIVERY_LUFS - level,
                    mix::MIN_GAP_BED_LUFS,
                ),
            )
            .at(0.0),
        ),
        (true, _) => {}
        // A project with no bed at all is `no-bed`'s finding, not this one. Two codes reporting
        // one absence is how a report gets long enough to stop being read.
        (false, _) => skipped.push(Skipped {
            code: "bed-too-quiet",
            reason: "there is no music bed on this timeline to measure".into(),
        }),
    }
    findings
}

/// Pairs of audio clips that sound together for longer than [`MIN_MIX_OVERLAP`].
fn overlapping_pairs<'a>(audio: &[Sounding<'a>]) -> Vec<(Sounding<'a>, Sounding<'a>)> {
    let mut pairs = Vec::new();
    for (index, first) in audio.iter().enumerate() {
        for second in audio.iter().skip(index + 1) {
            let start = first.1.start().max(second.1.start());
            let end = first.1.end().min(second.1.end());
            if (end - start).to_seconds_f64() >= MIN_MIX_OVERLAP {
                pairs.push((*first, *second));
            }
        }
    }
    pairs
}

/// A bed that never ducks. Sampled through [`Element::sampled_gain`], which is the same
/// function the preview mixer and the export use, so what this measures is what will be heard.
///
/// **The window excludes both clips' fades.** It used to return "nothing to report" the moment
/// either level reached zero anywhere in the overlap, which a fade does by definition — so
/// adding a 0.3 s `fadeIn` took a project from six `flat-mix` findings to zero with its
/// separation unchanged at 4.3 dB. A check a bad video silences with a cosmetic edit certifies
/// the mix. A *keyframed* zero inside the window is still total separation and still ends the
/// comparison; the difference is that a fade is the clip arriving, not the mix ducking.
fn flat_mix(first: Sounding<'_>, second: Sounding<'_>) -> Option<Finding> {
    let ((_, first), (track, second)) = (first, second);
    let overlap_start = first.start().max(second.start());
    let overlap_end = first.end().min(second.end());
    // The interior of each clip: after it has finished arriving, before it starts leaving.
    let start = overlap_start
        .max(first.start() + first.fade_in())
        .max(second.start() + second.fade_in());
    let end = overlap_end
        .min(first.end() - first.fade_out())
        .min(second.end() - second.fade_out());
    if (end - start).to_seconds_f64() < MIN_MIX_OVERLAP {
        return None;
    }
    let (from, to) = (start.as_ticks(), end.as_ticks());

    let mut widest = 0.0_f32;
    for step in 0..=MIX_SAMPLES {
        let at = MediaTime::from_ticks(from + (to - from) * step / MIX_SAMPLES);
        let (a, b) = (
            first.sampled_gain(at - first.start())?,
            second.sampled_gain(at - second.start())?,
        );
        let (quiet, loud) = (a.min(b), a.max(b));
        // One of them silent is total separation, whatever the other is doing.
        if quiet <= 0.0 {
            return None;
        }
        widest = widest.max(20.0 * (loud / quiet).log10());
    }
    if widest >= MIN_DUCK_DB {
        return None;
    }
    Some(
        finding(
            "flat-mix",
            format!(
                "{:?} and {:?} play together from {:.2}s to {:.2}s and never get more than \
                 {widest:.1} dB apart — nothing ducks, and a voice over a bed wants 10–15 dB of \
                 separation. Fades at the edges are excluded from the window, so easing one in \
                 does not answer this.",
                first.id(),
                second.id(),
                start.to_seconds_f64(),
                end.to_seconds_f64(),
            ),
        )
        .on(&track.id, second)
        .at(start.to_seconds_f64()),
    )
}

/// Narration with nothing underneath it.
///
/// The project model has no flag saying which clip is speech, so this claims only what it can
/// measure: several audio clips, carrying most of the timeline, that never once sound together.
/// That is the shape of a narration lane — a video is spoken in lines, with breaths between
/// them — and it is also proof that whatever the sound is, nothing is layered under it. A
/// single music-only clip has one element and is left alone, and so is a narration lane that
/// was written as one unbroken clip: this reports what it is sure of, not what it suspects.
fn no_bed(scene: &Scene, audio: &[Sounding<'_>]) -> Option<Finding> {
    if audio.len() < 2 || !overlapping_pairs(audio).is_empty() {
        return None;
    }

    let timeline = timeline_end(scene).as_ticks();
    if timeline <= 0 {
        return None;
    }

    let mut sounding: Vec<(i64, i64)> = audio
        .iter()
        .map(|(_, element)| (element.start().as_ticks(), element.end().as_ticks()))
        .collect();
    sounding.sort_unstable();
    let (mut covered, mut reached) = (0i64, 0i64);
    for (start, end) in sounding {
        covered += (end - start.max(reached)).max(0);
        reached = reached.max(end);
    }
    let coverage = covered as f64 / timeline as f64;
    if coverage < MIN_AUDIO_COVERAGE {
        return None;
    }

    Some(
        finding(
            "no-bed",
            format!(
                "{} audio clips carry {:.0}% of the timeline and none of them ever overlap — \
                 every moment of sound holds exactly one thing, so there is no bed under the \
                 voice and the gaps between lines are silence",
                audio.len(),
                coverage * 100.0,
            ),
        )
        .at(0.0),
    )
}

// ------------------------------------------------------------------ what is actually on the frame
//
// The three checks below share one model of a moment: every visible element resolved at a time,
// in composite order, with the colour it will draw and what is beneath it. It is built once per
// sample and read by all three, because they are three questions about the same picture.

/// How often the frame is sampled, in hertz. Ten is enough to see a card that is empty for half
/// a second and cheap enough that a sixty-second timeline costs a few milliseconds.
const SAMPLES_PER_SECOND: f64 = 10.0;

/// The instant the hook is measured at. Early enough to be the first thing a viewer sees, late
/// enough that a normal entrance has landed.
const HOOK_AT: f64 = 0.40;

/// How long the opening has to settle before what is on screen is what the video chose to open
/// with. Past this the frame is no longer an entrance, it is the first beat.
const HOOK_SETTLED: f64 = 1.0;

/// What the hook has to carry, as a share of what the video's own opening second reaches.
///
/// **Relative, and relative to the opening rather than to the median.** Measured against the
/// median frame this fires on the reference explainer, and it has to: a video that *fills* over
/// its runtime has a median denser than any opening it could possibly have — R2 opens on a
/// proverb pull-quote carrying 2.83 % of the canvas against a 15.32 % median, which is 18 % of
/// its own weight, and there is no opening frame of that video that would clear 60 %. Density is
/// not what separates it from the four videos this round condemns. **Waiting is.** All four are
/// literally blank at the hook instant — 0.0000 ink at 0.40 s, first mark at 0.8 s, 1.3 s and
/// 2.0 s — while R2 and R1 are already showing what they open with. So the denominator is what
/// the frame reaches inside [`HOOK_SETTLED`]: the opening must already *be* the first second,
/// not still be assembling it.
const HOOK_INK_SHARE: f64 = 0.60;

/// Contrast at which something counts as ink at all. WCAG AA for large text, and the only
/// definition of ink anything here may use.
const INK_CONTRAST: f32 = 4.5;

/// Contrast a mark needs against the fill it sits *on* — not against the canvas ground. A
/// gridline at 3.12:1 against the background measures 1.40:1 against the card it is drawn on,
/// and it is the card the eye is comparing it to.
const MARK_CONTRAST: f32 = 3.0;

/// Opacity below which a full-bleed shape is a wash laid over the composition rather than the
/// surface the composition is drawn on.
///
/// **This is the only opacity threshold left in the two shape checks, and it is about which
/// element is the ground, not about whether an element counts.** `dead-plate` and
/// `empty-container` used to require opacity ≥ 0.5 before an element was even looked at, which
/// meant both were cleared by turning the offending plate *down* to 0.49 — a change that makes
/// it harder to see, not easier. The frame model composites opacity into `composited[i]`
/// already, so a plate drawn at half opacity has a *lower* measured contrast, not an absent
/// one, and it is judged at whatever opacity it is drawn at.
const GROUND_OPACITY: f32 = 0.5;

/// Contrast below which a large element cannot be seen against what it sits on.
const MIN_PLATE_CONTRAST: f32 = 2.0;

/// Rendered area at which an element is large enough that its being invisible is a defect
/// rather than a detail.
const PLATE_AREA: f64 = 0.04;

/// The smallest shape worth carrying through the frame loop at all.
///
/// Well under [`PLATE_AREA`], because the whole point of aggregation is that a plate split into
/// pieces each individually below the floor is still a plate: seventeen of these butted
/// together are the 34 % panel this check exists for.
const AGGREGATE_AREA: f64 = 0.002;

/// A container this big with nothing in it reads as a failed asset load.
const CONTAINER_AREA: f64 = 0.05;

/// How much of a container's own fill has to be marks.
const CONTAINER_INK_SHARE: f64 = 0.04;

/// And how many separate marks. One dot satisfies an area test; two marks is the smallest thing
/// that is a composition rather than an accident.
const CONTAINER_MIN_MARKS: usize = 2;

/// How long a container may be empty before it is worth reporting. Shorter than this is content
/// fading out a beat before its card does, which is how a dissolve is authored.
const CONTAINER_EMPTY_SECONDS: f64 = 0.5;

/// An element that covers this much of the canvas *and* has nothing but the background beneath
/// it is the ground the video is composed on. Exactly one per scene is exempt from `dead-plate`
/// and from `empty-container`.
///
/// The number is what blocks the obvious escape. Calling a 34 %-of-canvas panel `role: ground`
/// buys nothing, because a ground is a thing you compose *on*, and something covering a third
/// of the frame is a thing you compose *with*.
const GROUND_AREA: f64 = 0.60;

/// Opacity at which a shape counts as the surface the next element up is drawn onto.
///
/// Very low on purpose: what an element sits on is read as the *composited* luminance of the
/// stack under it, so a 5 % wash contributes 5 % and the threshold is only there to stop the
/// search on things that contribute nothing at all. A high threshold here is what made a plate
/// at 85 % opacity invisible to the model that was supposed to be measuring it.
const COVERS: f32 = 0.05;

/// A photograph is not solid ink. Half its area is the honest guess for how much of a picture
/// reads against the frame's ground, and the hook rule is a ratio, so the constant cancels out
/// of every comparison where both frames contain pictures.
const MEDIA_INK: f64 = 0.5;

/// Ink a glyph puts down, as a fraction of its own square em. A character's advance is about
/// half an em wide and its cap height about seven tenths of one, and roughly a third of that
/// box is ink — 0.12 em² per character, which is within a few percent of measured type.
const GLYPH_INK: f64 = 0.12;

/// A rectangle in canvas fractions: `0..1` on both axes, origin top-left.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

impl Rect {
    /// The layer box a transform draws into. `scale × scale_x` is the box width as a fraction of
    /// the canvas; `anchor_x`/`anchor_y` say where in that box the `x`/`y` position sits.
    fn of(transform: &Transform) -> Option<Rect> {
        let fields = [
            transform.x,
            transform.y,
            transform.scale,
            transform.scale_x,
            transform.scale_y,
            transform.anchor_x,
            transform.anchor_y,
        ];
        if fields.iter().any(|value| !value.is_finite()) {
            return None;
        }
        let width = f64::from(transform.scale * transform.scale_x).max(0.0);
        let height = f64::from(transform.scale * transform.scale_y).max(0.0);
        Some(Rect {
            left: f64::from(transform.x) - width * f64::from(transform.anchor_x),
            top: f64::from(transform.y) - height * f64::from(transform.anchor_y),
            width,
            height,
        })
    }

    /// Area inside the canvas, as a fraction of it. Everything outside the frame is not drawn.
    fn area(&self) -> f64 {
        let across = (self.left + self.width).min(1.0) - self.left.max(0.0);
        let down = (self.top + self.height).min(1.0) - self.top.max(0.0);
        across.max(0.0) * down.max(0.0)
    }

    fn centre(&self) -> (f64, f64) {
        (self.left + self.width / 2.0, self.top + self.height / 2.0)
    }

    fn contains(&self, (x, y): (f64, f64)) -> bool {
        x >= self.left
            && x <= self.left + self.width
            && y >= self.top
            && y <= self.top + self.height
    }

    /// Whether two rectangles touch, allowing `gap` between them — two plates butted together
    /// with a hairline between them are one plate.
    fn touches(&self, other: &Rect, gap: f64) -> bool {
        self.left - gap <= other.left + other.width
            && other.left - gap <= self.left + self.width
            && self.top - gap <= other.top + other.height
            && other.top - gap <= self.top + self.height
    }
}

/// One visual element resolved at one moment.
struct Placed<'a> {
    element: &'a Element,
    rect: Rect,
    opacity: f32,
    /// The colour it draws, for the elements whose colour the model knows. `None` for pictures
    /// and clips, whose content this pass cannot see and must not guess at.
    fill: Option<[u8; 3]>,
}

/// Every visible element at one moment, in composite order, with the stack resolved.
///
/// `under[i]` is the luminance of the surface element `i` is drawn onto and `composited[i]` is
/// what it comes out as on top of that surface — both computed bottom-up in one pass, so an
/// element sitting on a half-opaque wash is measured against the wash *as it composites*, not
/// against the wash's declared colour. Reading the declared colour is how a plate at 85 %
/// opacity stopped being the ground of its own frame.
struct Frame<'a> {
    placed: Vec<Placed<'a>>,
    under: Vec<Option<f32>>,
    composited: Vec<Option<f32>>,
    /// Luminance of the project's own background colour.
    background: Option<f32>,
    /// Index into `placed` of the thing acting as the frame's ground, if anything is.
    ground: Option<usize>,
}

impl<'a> Frame<'a> {
    fn at(
        elements: &[(&'a Track, &'a Element)],
        at: MediaTime,
        background: Option<[u8; 3]>,
    ) -> Self {
        let mut placed = Vec::new();
        for (_, element) in elements {
            if let Some(one) = place(element, at) {
                placed.push(one);
            }
        }
        let ground_luminance = background.map(luminance);
        let mut under: Vec<Option<f32>> = Vec::with_capacity(placed.len());
        let mut composited: Vec<Option<f32>> = Vec::with_capacity(placed.len());
        let mut covered: Vec<bool> = Vec::with_capacity(placed.len());
        for index in 0..placed.len() {
            let below = beneath(&placed[..index], &placed[index].rect);
            covered.push(below.is_some());
            let surface = below.and_then(|j| composited[j]).or(ground_luminance);
            under.push(surface);
            composited.push(match (surface, placed[index].fill) {
                (Some(surface), Some(fill)) => {
                    Some(surface + placed[index].opacity * (luminance(fill) - surface))
                }
                _ => None,
            });
        }
        let ground = (0..placed.len()).rev().find(|index| {
            let one = &placed[*index];
            fills_its_box(one)
                && one.opacity >= GROUND_OPACITY
                && one.rect.area() >= GROUND_AREA
                // Nothing but the background beneath it: a plate laid over other work is
                // covering the composition, not grounding it.
                && !covered[*index]
        });
        Frame {
            placed,
            under,
            composited,
            background: ground_luminance,
            ground,
        }
    }

    /// Luminance of the surface an element at `index` is drawn onto.
    fn under(&self, index: usize) -> Option<f32> {
        self.under[index]
    }

    /// Luminance of the frame's modal background — the ground as it composites if the frame has
    /// one, the project's background colour otherwise.
    fn ground_luminance(&self) -> Option<f32> {
        match self.ground {
            Some(index) => self.composited[index],
            None => self.background,
        }
    }

    /// What an element composites to, given what is under it.
    fn composited(&self, index: usize) -> Option<f32> {
        self.composited[index]
    }

    /// Ink this element puts on the frame, as a fraction of the canvas — zero unless it reads
    /// against the ground at [`INK_CONTRAST`].
    fn ink(&self, index: usize, canvas: (f64, f64)) -> f64 {
        if Some(index) == self.ground {
            return 0.0;
        }
        let one = &self.placed[index];
        let Some(ground) = self.ground_luminance() else {
            return 0.0;
        };
        let area = match one.element {
            Element::Text(text) => glyph_ink(text, canvas),
            Element::Shape(_) => one.rect.area(),
            // A picture's content is not in the model. Counting its area at half weight claims
            // only that something was scheduled to be there, which is all this pass knows.
            Element::Image(_) | Element::Video(_) => one.rect.area() * MEDIA_INK,
            Element::Audio(_) => return 0.0,
        } * f64::from(one.opacity);
        match self.composited(index) {
            Some(luminance) if contrast_between(luminance, ground) >= INK_CONTRAST => area,
            // No colour to read: a picture is taken at its word.
            None if one.fill.is_none() => area,
            _ => 0.0,
        }
    }
}

/// Where an element is, and how opaque, at one moment. `None` when it is not on screen.
fn place(element: &Element, at: MediaTime) -> Option<Placed<'_>> {
    if at < element.start() || at >= element.end() || element.duration() <= MediaTime::ZERO {
        return None;
    }
    let local = at - element.start();
    let transform = element.sampled_transform(local)?;
    let rect = Rect::of(&transform)?;
    let opacity = sampled_opacity(element, local);
    if opacity <= 0.0 {
        return None;
    }
    Some(Placed {
        element,
        rect,
        opacity,
        fill: fill_of(element),
    })
}

/// An element's opacity at `local`, animation and fades included — what will actually be drawn.
fn sampled_opacity(element: &Element, local: MediaTime) -> f32 {
    let base = element
        .sampled_transform(local)
        .map_or(0.0, |transform| transform.opacity);
    (base * element.fade_gain(local)).clamp(0.0, 1.0)
}

fn fill_of(element: &Element) -> Option<[u8; 3]> {
    match element {
        Element::Shape(shape) => parse_hex(&shape.color),
        Element::Text(text) => parse_hex(&text.color),
        _ => None,
    }
}

/// Whether an element paints its whole layer box.
///
/// A `Shape` does; nothing else in the model does. Text is glyphs inside a box that is mostly
/// empty — reading a title's box as a fill would make a headline the ground of its own frame,
/// and would say the caption under it is drawn on white when it is drawn on the picture.
fn fills_its_box(one: &Placed<'_>) -> bool {
    matches!(one.element, Element::Shape(_)) && one.fill.is_some()
}

/// The topmost element in `below` that covers `rect`'s centre opaquely — what an element at the
/// end of that slice is drawn onto.
fn beneath(below: &[Placed<'_>], rect: &Rect) -> Option<usize> {
    let centre = rect.centre();
    below
        .iter()
        .enumerate()
        .rev()
        .find(|(_, one)| fills_its_box(one) && one.opacity >= COVERS && one.rect.contains(centre))
        .map(|(index, _)| index)
}

/// Ink a text element puts down, as a fraction of the canvas.
fn glyph_ink(text: &bay_project::TextElement, (width, height): (f64, f64)) -> f64 {
    let chars = text.content.chars().filter(|c| !c.is_whitespace()).count();
    let px = f64::from(rendered_font_px(text.font_size, height as f32));
    (chars as f64 * px * px * GLYPH_INK / (width * height)).min(1.0)
}

/// What the composition checks found, plus the two numbers the report prints either way.
struct Composition {
    findings: Vec<Finding>,
    hook_ink: f64,
    median_ink: f64,
    ground: Option<String>,
}

/// `dead-plate`, `empty-container` and `no-hook`: three questions about what is on the frame.
fn composition_findings(
    project: &Project,
    scene: &Scene,
    skipped: &mut Vec<Skipped>,
) -> Composition {
    let canvas = (
        f64::from(project.settings.canvas.width.max(1)),
        f64::from(project.settings.canvas.height.max(1)),
    );
    let background = match &project.settings.background {
        Background::Color { color } => parse_hex(color),
        // A blurred background is the picture behind it, which this pass cannot see. Every
        // contrast below is measured against *something*, so with no ground colour there is
        // nothing to measure against and the honest answer is that these did not run.
        Background::Blur { .. } => None,
    };
    let elements = picture_elements(scene);
    let end = timeline_end(scene);

    if background.is_none() {
        for code in ["dead-plate", "empty-container", "no-hook"] {
            skipped.push(Skipped {
                code,
                reason: "the project background is a blur, so there is no colour beneath the \
                         bottom layer to measure contrast against"
                    .into(),
            });
        }
        return Composition {
            findings: Vec::new(),
            hook_ink: 0.0,
            median_ink: 0.0,
            ground: None,
        };
    }
    if elements.is_empty() || end <= MediaTime::ZERO {
        // `nothing-visual` has already said so; there is no frame to measure.
        return Composition {
            findings: Vec::new(),
            hook_ink: 0.0,
            median_ink: 0.0,
            ground: None,
        };
    }

    let samples = sample_times(end);
    let mut ink = Vec::with_capacity(samples.len());
    // Per element, over its whole life: the best contrast it ever reaches, and how long it
    // spends as an empty container.
    let mut plates: Vec<Plate> = Vec::new();
    let mut ground_id: Option<String> = None;

    for at in &samples {
        let frame = Frame::at(&elements, *at, background);
        ink.push(frame_ink(&frame, canvas));
        if let Some(index) = frame.ground
            && ground_id.is_none()
        {
            ground_id = Some(frame.placed[index].element.id().to_string());
        }
        observe(&frame, &mut plates, canvas, at.to_seconds_f64());
    }

    let median = median(&ink);
    let hook_at = MediaTime::from_seconds_f64(HOOK_AT).unwrap_or(MediaTime::ZERO);
    let mut findings = Vec::new();
    let hook_ink = if end <= hook_at {
        skipped.push(Skipped {
            code: "no-hook",
            reason: format!(
                "the timeline is {:.2}s long, which ends before the {HOOK_AT:.2}s the hook is \
                 measured at",
                end.to_seconds_f64()
            ),
        });
        0.0
    } else {
        // What the opening second reaches, and when the frame first carries anything at all.
        // A title 40 % through a one-second fade composites below 4.5:1 and puts down exactly
        // zero ink, so measuring only the instant would call every ordinary entrance a blank
        // opening; the instant slides to the first sample inside the opening that reads.
        let opening: Vec<(f64, f64)> = samples
            .iter()
            .zip(&ink)
            .map(|(at, value)| (at.to_seconds_f64(), *value))
            .filter(|(at, _)| *at <= HOOK_SETTLED)
            .collect();
        let settled = opening.iter().map(|(_, v)| *v).fold(0.0_f64, f64::max);
        let total = frame_ink(&Frame::at(&elements, hook_at, background), canvas);
        let (at, total) = if total > 0.0 {
            (HOOK_AT, total)
        } else {
            opening
                .iter()
                .copied()
                .find(|(at, value)| *at > HOOK_AT && *value > 0.0)
                .unwrap_or((HOOK_AT, total))
        };
        findings.extend(no_hook(total, at, settled));
        total
    };

    findings.extend(dead_plate(&plates));
    findings.extend(empty_container(&plates));

    Composition {
        findings,
        hook_ink,
        median_ink: median,
        ground: ground_id,
    }
}

/// Ink on one frame, as a fraction of the canvas. **Authored elements only** — bay's own
/// captions are not the hook, and a caption arriving at 0.4s would certify one that is not
/// there.
fn frame_ink(frame: &Frame<'_>, canvas: (f64, f64)) -> f64 {
    (0..frame.placed.len())
        .filter(|index| frame.placed[*index].element.is_authored())
        .map(|index| frame.ink(index, canvas))
        .sum()
}

/// Every moment the frame is sampled at, from zero to the end of the timeline.
fn sample_times(end: MediaTime) -> Vec<MediaTime> {
    let seconds = end.to_seconds_f64();
    let steps = (seconds * SAMPLES_PER_SECOND).ceil().clamp(1.0, 20_000.0) as i64;
    (0..steps)
        .map(|step| MediaTime::from_ticks(end.as_ticks() * step / steps))
        .collect()
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[sorted.len() / 2]
}

/// What one large shape did over the whole timeline.
///
/// Both shape checks are statements about an element's *life*, not about one frame — "the
/// largest object in every frame for 60 of 61 seconds", "the card is empty for six seconds" —
/// so the frame loop folds into this and the checks read it once at the end.
struct Plate {
    id: String,
    color: [u8; 3],
    /// The largest box it ever occupies, and that box's area.
    rect: Rect,
    area: f64,
    /// The most contrast it ever reached against what it sits on. The most favourable reading:
    /// an element is judged at its best moment, not at its fade-in.
    best_contrast: f32,
    exempt: bool,
    /// The current run of samples with nothing legible in it, and the longest such run.
    empty_run: f64,
    run_at: f64,
    /// The best the container ever looked *during the current run* — reported, rather than the
    /// first sample of it, so the finding states the run's most favourable moment.
    run_marks: usize,
    run_share: f64,
    longest_empty: f64,
    longest_at: f64,
    /// When it was last on screen, so a shape that leaves and comes back does not carry its
    /// empty run across the gap.
    last_at: f64,
    marks: usize,
    mark_share: f64,
}

/// Fold one frame into the per-element record the two shape checks read.
fn observe(frame: &Frame<'_>, plates: &mut Vec<Plate>, canvas: (f64, f64), at: f64) {
    for index in 0..frame.placed.len() {
        let one = &frame.placed[index];
        let (Element::Shape(shape), Some(fill)) = (one.element, one.fill) else {
            continue;
        };
        if !one.element.is_authored() {
            continue;
        }
        let area = one.rect.area();
        if area < AGGREGATE_AREA {
            continue;
        }
        let (Some(under), Some(composited)) = (frame.under(index), frame.composited(index)) else {
            continue;
        };
        let contrast = contrast_between(composited, under);
        let entry = match plates.iter().position(|plate| plate.id == shape.id) {
            Some(existing) => existing,
            None => {
                plates.push(Plate {
                    id: shape.id.clone(),
                    color: fill,
                    rect: one.rect,
                    area,
                    best_contrast: 1.0,
                    exempt: Some(index) == frame.ground,
                    empty_run: 0.0,
                    run_at: at,
                    run_marks: 0,
                    run_share: 0.0,
                    longest_empty: 0.0,
                    longest_at: at,
                    last_at: at,
                    marks: 0,
                    mark_share: 0.0,
                });
                plates.len() - 1
            }
        };
        // Measured before the mutable borrow, because it reads the whole frame.
        let inside = (area >= CONTAINER_AREA).then(|| marks_inside(frame, index, canvas));

        let plate = &mut plates[entry];
        // Sticky: a wash that is the frame's ground at any point in its life is the ground.
        // Deciding it on the first sample judged a plate by its own fade-in.
        plate.exempt |= Some(index) == frame.ground;
        if area > plate.area {
            plate.area = area;
            plate.rect = one.rect;
        }
        if contrast > plate.best_contrast {
            plate.best_contrast = contrast;
        }
        if at - plate.last_at > 1.5 / SAMPLES_PER_SECOND {
            plate.empty_run = 0.0;
        }
        plate.last_at = at;

        let Some((marks, share)) = inside else {
            // Not on screen enough to be a container this sample; an invisible card is not an
            // empty one.
            plate.empty_run = 0.0;
            continue;
        };
        if marks >= CONTAINER_MIN_MARKS && share >= CONTAINER_INK_SHARE {
            plate.empty_run = 0.0;
            continue;
        }
        if plate.empty_run == 0.0 {
            plate.run_at = at;
            plate.run_marks = 0;
            plate.run_share = 0.0;
        }
        plate.empty_run += 1.0 / SAMPLES_PER_SECOND;
        plate.run_marks = plate.run_marks.max(marks);
        plate.run_share = plate.run_share.max(share);
        if plate.empty_run > plate.longest_empty {
            plate.longest_empty = plate.empty_run;
            plate.longest_at = plate.run_at;
            plate.marks = plate.run_marks;
            plate.mark_share = plate.run_share;
        }
    }
}

/// How many marks sit inside a container, and how much of its fill they cover.
///
/// A mark is anything above the container in composite order whose centre is inside it and
/// which reads against the container's **own fill** at [`MARK_CONTRAST`] — not against the
/// canvas ground. Every gridline in the project this comes from measures 3.12:1 against the
/// background and 1.40:1 against the card it is drawn on, and it is the card the eye compares
/// it to.
fn marks_inside(frame: &Frame<'_>, container: usize, canvas: (f64, f64)) -> (usize, f64) {
    let plate = &frame.placed[container];
    let Some(fill) = plate.fill else {
        return (0, 0.0);
    };
    let on = luminance(fill);
    let area = plate.rect.area().max(f64::MIN_POSITIVE);
    let (mut marks, mut covered) = (0usize, 0.0);
    for index in container + 1..frame.placed.len() {
        let one = &frame.placed[index];
        if !one.element.is_authored() {
            continue;
        }
        if !plate.rect.contains(one.rect.centre()) {
            continue;
        }
        let reads = match frame.composited(index) {
            Some(luminance) => contrast_between(luminance, on) >= MARK_CONTRAST,
            // A picture is content whatever it contains.
            None => one.fill.is_none(),
        };
        if !reads {
            continue;
        }
        let ink = match one.element {
            Element::Text(text) => glyph_ink(text, canvas),
            Element::Audio(_) => continue,
            _ => one.rect.area(),
        };
        marks += 1;
        covered += ink;
    }
    (marks, covered / area)
}

/// A large element too close in colour to what it sits on to be seen.
///
/// The single largest defect in the video this comes from: a rectangle covering 34.2 % of the
/// canvas at 1.10:1 against the ground, present in 60 of 61 seconds, the largest object in
/// every frame. Below about 2:1 a fill is not a shape, it is a slightly different black.
///
/// **Contiguous same-colour elements are aggregated first**, so eight 4.5 % plates butted
/// together are one 36 % plate and not eight exempt ones. Every other escape is a better video:
/// raise it to 2.01:1 and it becomes a real design element; delete it and the frame is cleaner.
fn dead_plate(plates: &[Plate]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for group in aggregate(plates) {
        let members: Vec<&Plate> = group.iter().map(|index| &plates[*index]).collect();
        if members.iter().any(|plate| plate.exempt) {
            continue;
        }
        // On screen at [`PLATE_AREA`] or more at some point in its life — and *as a group*,
        // because a plate cut into nine tiles is still a plate. Nothing about opacity: the
        // aggregate is judged at whatever opacity it is drawn at, and its composited contrast
        // already carries that.
        let area: f64 = members.iter().map(|plate| plate.area).sum::<f64>().min(1.0);
        if area < PLATE_AREA {
            continue;
        }
        // The most favourable reading: the best contrast any member ever reaches.
        let contrast = members
            .iter()
            .map(|plate| plate.best_contrast)
            .fold(1.0_f32, f32::max);
        if contrast >= MIN_PLATE_CONTRAST {
            continue;
        }
        let first = members[0];
        let named = members
            .iter()
            .map(|plate| plate.id.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        findings.push(
            finding(
                "dead-plate",
                format!(
                    "{named} covers {:.1}% of the canvas at {contrast:.2}:1 against what it sits \
                     on — under {MIN_PLATE_CONTRAST:.1}:1 a fill this large is not an object, it \
                     is a slightly different background. Raise its contrast, or delete it and let \
                     the ground show.",
                    area * 100.0,
                ),
            )
            .with_element(&first.id),
        );
    }
    findings
}

/// Group plates that touch and are **the same colour to the eye**. Union-find over the touching
/// relation, so a chain of butted plates is one group however it was authored.
///
/// **Proximity, not byte equality.** Exact `[u8; 3]` comparison was defeated by one hex digit:
/// nine tiles at `#191922`…`#19192A` are pixel-indistinguishable, each falls under
/// [`PLATE_AREA`], and none of them ever unioned with its neighbour — which cleared `dead-plate`
/// on a 34 % panel and left the output visually identical. ΔE00 is the metric in which "the same
/// colour" is a measurement rather than a string compare; below [`SAME_COLOUR`] two fills are
/// inside the range a display's own dither covers.
fn aggregate(plates: &[Plate]) -> Vec<Vec<usize>> {
    /// A hairline seam between two plates of the same colour is not a seam.
    const SEAM: f64 = 0.005;

    let mut parent: Vec<usize> = (0..plates.len()).collect();
    fn root(parent: &mut [usize], mut index: usize) -> usize {
        while parent[index] != index {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        index
    }
    for a in 0..plates.len() {
        for b in a + 1..plates.len() {
            // The ground is never a member of anything. It is the surface the others are drawn
            // on, and a dead plate is *by definition* nearly the colour of what it sits on — so
            // under a perceptual test the panel this check exists for would union with the very
            // ground it fails against and take the ground's exemption with it.
            if plates[a].exempt || plates[b].exempt {
                continue;
            }
            if !same_colour(plates[a].color, plates[b].color)
                || !plates[a].rect.touches(&plates[b].rect, SEAM)
            {
                continue;
            }
            let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
            parent[ra] = rb;
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for index in 0..plates.len() {
        let key = root(&mut parent, index);
        groups.entry(key).or_default().push(index);
    }
    groups.into_values().collect()
}

/// ΔE00 below which two fills are the same colour. Around 2 is a just-noticeable difference on a
/// large flat field and 10 already reads as a different colour; 5 is the conventional "matched"
/// tolerance, and it is well under the distance between any two colours a palette would put next
/// to each other on purpose.
const SAME_COLOUR: f32 = 5.0;

/// Whether two fills are the same colour to the eye.
fn same_colour(a: [u8; 3], b: [u8; 3]) -> bool {
    if a == b {
        return true;
    }
    let hex = |[r, g, b]: [u8; 3]| format!("#{r:02X}{g:02X}{b:02X}");
    kit::delta_e_2000(&hex(a), &hex(b)).is_some_and(|distance| distance < SAME_COLOUR)
}

/// A container with nothing legible in it.
///
/// Six seconds of an empty card reads as a failed asset load, and this pass is the only thing
/// that can see it — the card renders perfectly, it is simply empty. Scoped to `Shape`, because
/// applied to a picture or a clip it would fire on a static PNG that is the whole point of the
/// frame.
fn empty_container(plates: &[Plate]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for plate in plates {
        if plate.exempt || plate.area < CONTAINER_AREA {
            continue;
        }
        if plate.longest_empty < CONTAINER_EMPTY_SECONDS {
            continue;
        }
        findings.push(
            finding(
                "empty-container",
                format!(
                    "{:?} covers {:.1}% of the canvas and holds at most {} mark(s) covering {:.1}% \
                     of its own fill for {:.2}s from {:.2}s — a container this size wants \
                     {:.0}% of itself in marks and at least {CONTAINER_MIN_MARKS} of them, or it \
                     reads as an asset that failed to load. Marks have to clear \
                     {MARK_CONTRAST:.1}:1 against the card itself, not against the background.",
                    plate.id,
                    plate.area * 100.0,
                    plate.marks,
                    plate.mark_share * 100.0,
                    plate.longest_empty,
                    plate.longest_at,
                    CONTAINER_INK_SHARE * 100.0,
                ),
            )
            .with_element(&plate.id)
            .at(plate.longest_at),
        );
    }
    findings
}

/// Whether the opening carries anything worth stopping for.
///
/// One instant, one threshold, **relative to the video's own opening second**. Every absolute
/// form of this rule fires on the reference explainer, and — measured — so did the median-
/// relative form that replaced them: a video whose frame fills over its runtime has a median
/// denser than any opening it could have, so R2's proverb pull-quote reads as 18 % of the
/// video's weight while being exactly what R2 chose to open on. What separated the four
/// condemned videos from both references was not density; it was that all four are **blank** at
/// the hook instant and stay blank for another 0.4–1.6 s. So what the opening owes is that it is
/// already what the first second is, rather than still assembling it.
///
/// The check this replaces was suppressed by three separate early returns — a shape under 95 %
/// of frame, any picture at all, and any type over 5.5 % of canvas height — and one of them was
/// tripped by an element whose opacity was `0.0@0s → 0.0@0.15s → 1.0@1.55s`. An element that is
/// *literally invisible at the instant measured* certified the hook of a video whose opening
/// frame carries one percent of its own median ink.
fn no_hook(hook_ink: f64, at: f64, settled: f64) -> Option<Finding> {
    if hook_ink > 0.0 && hook_ink >= settled * HOOK_INK_SHARE {
        return None;
    }
    let measured = if hook_ink <= 0.0 {
        format!(
            "nothing on it reads against the ground at all, and nothing does for the whole first \
             {HOOK_SETTLED:.1}s"
        )
    } else {
        format!(
            "it carries {:.2}% of the canvas in ink where the same frame reaches {:.2}% by \
             {HOOK_SETTLED:.1}s — {:.0}% of its own opening, so the video is still arriving",
            hook_ink * 100.0,
            settled * 100.0,
            if settled > 0.0 {
                hook_ink / settled * 100.0
            } else {
                0.0
            }
        )
    };
    Some(
        finding(
            "no-hook",
            format!(
                "at {at:.2}s, {measured}. The opening frame decides whether the rest is watched, \
                 and it wants at least {:.0}% of what the frame carries once the entrance has \
                 landed — an opening nobody can see yet is a wait, not a hook.",
                HOOK_INK_SHARE * 100.0
            ),
        )
        .at(at),
    )
}

// ------------------------------------------------------------------------------- the render gate

/// How long a reason for overriding the checks has to be.
///
/// Not an obstacle course: it is the length at which "n/a" stops being possible and the writer
/// has to say what they know that the check does not. The string is stamped into the job result
/// and into the file's metadata, so it is a written claim in the artefact rather than a flag.
pub const MIN_OVERRIDE_REASON: usize = 40;

/// Decide whether a render may proceed.
///
/// - `Ok(None)` — nothing gating; render.
/// - `Ok(Some(stamp))` — gated, but overridden. Put `stamp` in the job result **and** in the
///   file's metadata.
/// - `Err(message)` — refused, with what to fix.
///
/// There is exactly one escape and it is all-or-nothing. Per-code suppression is what turns a
/// report into a configuration file: the first thing anybody suppresses is the code that keeps
/// firing, which is the code that keeps being right.
pub fn render_gate(
    project: &Project,
    ignore_checks: bool,
    reason: Option<&str>,
) -> Result<Option<String>, String> {
    gate_report(check(project), ignore_checks, reason)
}

fn gate_report(
    report: Report,
    ignore_checks: bool,
    reason: Option<&str>,
) -> Result<Option<String>, String> {
    let gating: Vec<&Finding> = report
        .findings
        .iter()
        .filter(|f| f.severity == Severity::Error)
        .collect();
    if report.errors == 0 {
        return Ok(None);
    }

    let listed = gating
        .iter()
        .map(|f| format!("  {} — {}", f.code, f.message))
        .collect::<Vec<_>>()
        .join("\n");
    let codes = {
        let mut codes: Vec<&str> = gating.iter().map(|f| f.code).collect();
        codes.sort_unstable();
        codes.dedup();
        codes.join(", ")
    };

    let Some(reason) = reason.map(str::trim).filter(|_| ignore_checks) else {
        return Err(format!(
            "check found {} error(s) and a render would ship them:\n{listed}\nFix them, or \
             render again with ignoreChecks: true and a reason of at least \
             {MIN_OVERRIDE_REASON} characters saying why this is right anyway — it is written \
             into the file.",
            report.errors
        ));
    };
    if reason.chars().count() < MIN_OVERRIDE_REASON {
        return Err(format!(
            "ignoreChecks needs a reason of at least {MIN_OVERRIDE_REASON} characters; {:?} is \
             {}. Say what you know that check does not — it is stamped into the file.",
            reason,
            reason.chars().count()
        ));
    }
    Ok(Some(format!(
        "checks overridden ({}): {reason}",
        if codes.is_empty() {
            "unknown".to_string()
        } else {
            codes
        }
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_project::{
        AudioElement, ElementSource, MediaAsset, ShapeElement, TextElement, Track, TrackKind,
        VideoElement,
    };

    fn seconds(n: f64) -> MediaTime {
        MediaTime::from_seconds_f64(n).expect("representable")
    }

    /// A project with exactly the elements given on the main lane, and nothing else — so a
    /// finding can only have come from what the test put there.
    fn project_with(elements: Vec<Element>) -> Project {
        let mut project = Project::starter();
        {
            let scene = project.active_scene_mut();
            scene.tracks.main.elements = elements;
            scene.tracks.overlay.clear();
            scene.tracks.audio.clear();
        }
        project
    }

    fn title(id: &str, content: &str, font_size: f32, transform: Transform) -> Element {
        Element::Text(TextElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: seconds(3.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: content.into(),
            font_size,
            color: "#ffffff".into(),
            transform,
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            font_family: None,
            font_weight: 400,
            align: Default::default(),
            letter_spacing: 0.0,
            line_height: 1.2,
            decorations: None,
            karaoke: None,
            source: Default::default(),
            role: Default::default(),
        })
    }

    fn shape(id: &str, start: f64, duration: f64) -> Element {
        Element::Shape(ShapeElement {
            id: id.into(),
            name: id.into(),
            start: seconds(start),
            duration: seconds(duration),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: Default::default(),
            color: "#ffffff".into(),
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })
    }

    /// A shape of a given colour and size, anchored where the caller wants it.
    fn plate(id: &str, color: &str, width: f32, height: f32, duration: f64) -> Element {
        let mut element = shape(id, 0.0, duration);
        if let Element::Shape(s) = &mut element {
            s.color = color.into();
            s.transform.scale_x = width;
            s.transform.scale_y = height;
        }
        element
    }

    /// A caption on a lane of its own, placed where the test needs it.
    fn text_at(id: &str, start: f64, duration: f64, font_size: f32) -> Element {
        let mut element = title(id, "Caption", font_size, Transform::default());
        element.set_start(seconds(start));
        element.set_duration(seconds(duration));
        element
    }

    /// Keyframe `property` from `keys`, given as `(seconds from the element's start, value)`.
    fn animate(element: &mut Element, property: &str, keys: &[(f64, f32)], easing: Easing) {
        let mut channel = AnimationChannel {
            easing,
            ..Default::default()
        };
        for (at, value) in keys {
            channel.upsert(seconds(*at), *value);
        }
        element
            .animations_mut()
            .expect("visual elements animate")
            .insert(property.into(), channel);
    }

    fn sound(id: &str, start: f64, duration: f64, volume: f32) -> Element {
        Element::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: seconds(start),
            duration: seconds(duration),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m".into(),
            muted: false,
            volume,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: Default::default(),
            role: Default::default(),
        })
    }

    /// A narration clip: the only thing in the model that says "a new thing is being said here",
    /// and the first input to the beat derivation.
    fn speech(id: &str, start: f64, duration: f64) -> Element {
        let mut element = sound(id, start, duration, 1.0);
        element.set_audio_role(bay_project::AudioRole::Speech);
        element
    }

    fn with_audio(project: &mut Project, elements: Vec<Element>) {
        let mut track = Track::new("track-audio", "Audio", TrackKind::Audio);
        track.elements = elements;
        project.active_scene_mut().tracks.audio = vec![track];
        project
            .media
            .push(MediaAsset::new("m", "m.wav", "/tmp/m.wav"));
    }

    fn with_overlay(project: &mut Project, elements: Vec<Element>) {
        let mut track = Track::new("track-overlay", "Overlay", TrackKind::Overlay);
        track.elements = elements;
        project.active_scene_mut().tracks.overlay = vec![track];
    }

    /// A ten-second scene: one full-frame ground on the main lane, captions over it.
    fn scene_of(captions: Vec<Element>) -> Project {
        let mut project = project_with(vec![shape("ground", 0.0, 10.0)]);
        with_overlay(&mut project, captions);
        project
    }

    fn codes(report: &Report) -> Vec<&str> {
        report.findings.iter().map(|f| f.code).collect()
    }

    /// Reads the rollup, not the surfaced list — the cap is deliberate and a test that only
    /// looked at the twelve would start passing for the wrong reason.
    fn has(report: &Report, code: &str) -> bool {
        report.rollup.contains_key(code)
    }

    fn count(report: &Report, code: &str) -> usize {
        report.rollup.get(code).copied().unwrap_or(0)
    }

    fn message(report: &Report, code: &str) -> String {
        report
            .findings
            .iter()
            .find(|f| f.code == code)
            .unwrap_or_else(|| panic!("{code} is not in {:?}", codes(report)))
            .message
            .clone()
    }

    // -------------------------------------------------------------------- the envelope itself

    /// The budget. Adding a fifteenth gating code means deleting one, and this is the argument.
    #[test]
    fn the_gating_rule_set_stays_inside_its_budget() {
        let gating = gating_codes();
        assert!(
            gating.len() <= MAX_GATING_CODES,
            "{} gating codes, budget is {MAX_GATING_CODES}: {gating:?}",
            gating.len()
        );
    }

    /// Every code the pass can emit has to be declared, because the severity is read off the
    /// registry — an undeclared code would silently become a note.
    #[test]
    fn every_code_the_pass_emits_is_registered() {
        let source = include_str!("check.rs");
        let mut emitted = Vec::new();
        // Split so that this array is not itself a call site the scan then reads.
        for opener in [format!("find{}", "ing("), format!("he{}", "re(")] {
            for (index, _) in source.match_indices(&opener) {
                let rest = source[index + opener.len()..].trim_start();
                // Anything that is not a string literal is a definition or a call passing a
                // variable, and neither names a code.
                let Some(rest) = rest.strip_prefix('"') else {
                    continue;
                };
                let Some(end) = rest.find('"') else { continue };
                emitted.push(&rest[..end]);
            }
        }
        assert!(!emitted.is_empty(), "the scan found no call sites at all");
        for code in emitted {
            assert!(
                CODES.iter().any(|(name, _, _)| *name == code),
                "{code:?} is emitted but not in CODES"
            );
        }
    }

    /// No code may be declared twice: two entries mean two severities and the second one wins
    /// silently.
    #[test]
    fn the_registry_has_no_duplicates() {
        let mut names: Vec<&str> = CODES.iter().map(|(name, _, _)| *name).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len(), "duplicate codes in CODES");
    }

    /// The three checks that were retired stay retired. They never fired on any project we
    /// condemned, on any bucketing of it, and a check that has never fired is a comment.
    #[test]
    fn the_retired_pacing_checks_are_gone() {
        for code in ["front-loaded", "inert-scene", "no-accumulation"] {
            assert!(
                !CODES.iter().any(|(name, _, _)| *name == code),
                "{code} is back in the registry"
            );
        }
        // And nothing can emit them, because an unregistered code cannot be emitted at all —
        // see `every_code_the_pass_emits_is_registered`.
    }

    /// A report that found nothing and ran everything is clean; one that could not run a check
    /// says so instead of passing.
    #[test]
    fn a_suite_that_could_not_run_does_not_report_clean() {
        let clean = report(Vec::new(), Vec::new(), blank_stats());
        assert_eq!(clean.status, Status::Clean);

        let unevaluated = report(
            Vec::new(),
            vec![Skipped {
                code: "dead-plate",
                reason: "no ground colour".into(),
            }],
            blank_stats(),
        );
        assert_eq!(unevaluated.status, Status::Unevaluated);
        assert_eq!(unevaluated.errors, 0);
    }

    fn blank_stats() -> Stats {
        Stats {
            duration_seconds: 0.0,
            elements: 0,
            authored_elements: 0,
            tool_elements: 0,
            authored_animated_channels: 0,
            authored_opacity_share: 0.0,
            hook_ink: 0.0,
            median_frame_ink: 0.0,
            ground: None,
            beats: Beats {
                derivation: "none",
                starts: Vec::new(),
                end_seconds: 0.0,
            },
            mix: MixStats {
                narration_lufs: None,
                gap_lufs: None,
                gap_bed_lufs: None,
                separation_lu: None,
                authored_lufs: None,
                peak_at_seconds: None,
                payoff_at_seconds: None,
                peak_at_payoff: None,
                unmeasured: Vec::new(),
            },
        }
    }

    /// Twelve findings, drawn one per code in rotation — so thirty of one code cannot hide one
    /// of another, which is exactly how the report that produced 242 warnings buried its three
    /// real findings at position ~237.
    #[test]
    fn the_report_is_capped_and_representative() {
        let mut findings: Vec<Finding> = (0..30)
            .map(|index| finding("small-text", format!("small {index}")))
            .collect();
        findings.push(finding("dead-plate", "the plate"));
        let report = report(findings, Vec::new(), blank_stats());

        assert_eq!(report.findings.len(), MAX_FINDINGS);
        assert_eq!(report.total, 31);
        assert_eq!(report.rollup["small-text"], 30);
        assert_eq!(report.rollup["dead-plate"], 1);
        assert!(
            report.findings.iter().any(|f| f.code == "dead-plate"),
            "the one error must survive the cap"
        );
        assert_eq!(report.findings[0].severity, Severity::Error);
    }

    // ------------------------------------------------------------------------- the render gate

    #[test]
    fn a_render_is_refused_while_an_error_stands() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                y: 1.4,
                ..Transform::default()
            },
        )]);
        let error = render_gate(&project, false, None).expect_err("off-canvas gates the render");
        assert!(error.contains("off-canvas"), "{error}");
    }

    #[test]
    fn a_clean_project_renders_without_a_stamp() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                y: 0.5,
                ..Transform::default()
            },
        )]);
        assert_eq!(render_gate(&project, false, None).expect("no errors"), None);
    }

    /// The escape exists, and it costs a written claim. A short reason is not one.
    #[test]
    fn the_override_needs_a_reason_worth_stamping() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                y: 1.4,
                ..Transform::default()
            },
        )]);
        let error = render_gate(&project, true, Some("looks fine")).expect_err("too short");
        assert!(error.contains("at least"), "{error}");

        let reason = "the title is anchored off frame on purpose: it slides in from the right \
                      and the anchor is its resting point";
        let stamp = render_gate(&project, true, Some(reason))
            .expect("a real reason is accepted")
            .expect("an overridden render is stamped");
        assert!(stamp.contains(reason), "{stamp}");
        assert!(stamp.contains("off-canvas"), "{stamp}");
    }

    /// There is no per-code suppression, and there must never be one: the first code anybody
    /// suppresses is the one that keeps firing, which is the one that keeps being right.
    #[test]
    fn there_is_no_per_code_suppression() {
        let source = include_str!("check.rs");
        // Built rather than written, so this test's own needles are not what it finds.
        for word in ["suppress", "allow", "ignore", "disable"] {
            let needle = format!("{word}_code");
            assert!(
                !source.contains(&needle),
                "{needle} is a per-code escape hatch"
            );
        }
    }

    // ------------------------------------------------------------------------ structural checks

    /// The baseline: a plain, correct timeline must produce no errors. A check that fires on
    /// good work gets ignored, and then it is worth nothing on bad work.
    #[test]
    fn a_sound_timeline_reports_no_errors() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                y: 0.5,
                ..Transform::default()
            },
        )]);
        let report = check(&project);
        assert_eq!(report.errors, 0, "unexpected errors: {:?}", report.findings);
    }

    #[test]
    fn an_element_anchored_off_the_frame_is_an_error() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                y: 1.4,
                ..Transform::default()
            },
        )]);
        let report = check(&project);
        assert!(has(&report, "off-canvas"), "{:?}", codes(&report));
        assert!(report.errors >= 1);
        assert_eq!(report.status, Status::Findings);
    }

    /// A slide-in is authored off-frame and animated on. `off-canvas` gates `render`, so reading
    /// the base transform alone refused a correct video outright — the same trap `invisible`
    /// already had to be dug out of. Only an element no sample ever brings inside is lost.
    #[test]
    fn an_element_that_slides_in_from_off_frame_is_not_off_canvas() {
        let mut element = title(
            "slide",
            "Hello",
            96.0,
            Transform {
                x: -0.30,
                ..Transform::default()
            },
        );
        animate(
            &mut element,
            "x",
            &[(0.0, -0.30), (0.5, 0.50), (2.0, 0.50)],
            Easing::PowerOut,
        );
        let report = check(&project_with(vec![element]));
        assert!(
            !has(&report, "off-canvas"),
            "a slide-in must render: {:?}",
            codes(&report)
        );
    }

    /// The other half of the same rule: an element animated but never once inside the frame is
    /// still lost, and must still be caught.
    #[test]
    fn an_element_that_never_enters_the_frame_is_still_off_canvas() {
        let mut element = title(
            "gone",
            "Hello",
            96.0,
            Transform {
                x: -0.30,
                ..Transform::default()
            },
        );
        animate(
            &mut element,
            "x",
            &[(0.0, -0.30), (2.0, -0.80)],
            Easing::PowerOut,
        );
        let report = check(&project_with(vec![element]));
        assert!(
            has(&report, "off-canvas"),
            "an element that never arrives is still lost: {:?}",
            codes(&report)
        );
    }

    /// The failure nobody notices until the video is posted: type that is fine on a 27" display
    /// and unreadable in a feed.
    #[test]
    fn type_too_small_to_read_is_flagged_with_its_measurement() {
        let project = project_with(vec![title("t", "Body copy", 18.0, Transform::default())]);
        let report = check(&project);
        assert!(
            message(&report, "small-text").contains("1080px canvas"),
            "{:?}",
            codes(&report)
        );
        let found = report
            .findings
            .iter()
            .find(|f| f.code == "small-text")
            .expect("small text is caught");
        assert_eq!(found.element_id.as_deref(), Some("t"));
    }

    /// **This test used to assert the bug.** It read "scale counts: 18px at 4× is legible", and
    /// it passed because the check multiplied by `transform.scale` — which the renderer does not
    /// do. For text, `scale` sizes the layout box; the glyph is `font_size × height / 1080`. So
    /// 18pt stays 18pt at any box size, and a scaled-up box does not rescue small type.
    #[test]
    fn a_bigger_layout_box_does_not_make_small_type_legible() {
        let project = project_with(vec![title(
            "t",
            "Body copy",
            18.0,
            Transform {
                scale: 4.0,
                ..Transform::default()
            },
        )]);
        assert!(
            has(&check(&project), "small-text"),
            "18pt is 18pt whatever box it is laid out in"
        );
    }

    /// The regression that made the check worthless in the field: a 26pt kicker in a 0.744-wide
    /// box on a 1920 canvas renders at 46px — comfortably legible — and was reported as 19px.
    /// 67 of 69 `small-text` findings in one real project were this.
    #[test]
    fn a_kicker_in_a_narrow_box_is_not_called_illegible() {
        let mut project = project_with(vec![title(
            "kicker",
            "ONE SESSION",
            26.0,
            Transform {
                scale: 0.744,
                ..Transform::default()
            },
        )]);
        project.settings.canvas = bay_project::CanvasSize {
            width: 1080,
            height: 1920,
        };
        assert!(!has(&check(&project), "small-text"));
    }

    /// The check and the renderer must agree on one number. They disagreed for as long as each
    /// had its own formula, so this pins ours to `bay-preview`'s `font_px` — and there is now
    /// exactly one copy of it here, the hook check's second formula having been deleted.
    #[test]
    fn the_size_formula_matches_the_renderer() {
        for (font_size, canvas_height) in [(26.0, 1920.0), (18.0, 1080.0), (96.0, 1920.0)] {
            // Copied from bay-preview: `(text.font_size * height as f32 / 1080.0).max(8.0)`.
            let renderer = (font_size * canvas_height / 1080.0f32).max(8.0);
            assert_eq!(rendered_font_px(font_size, canvas_height), renderer);
        }
    }

    /// Placing an element transparent and animating it up is the house entrance. Flagging it
    /// fired on 60 correctly-authored elements in one project and taught the author to stop
    /// reading the report.
    #[test]
    fn an_element_faded_in_from_zero_is_not_called_invisible() {
        let mut element = title(
            "t",
            "Hello",
            96.0,
            Transform {
                opacity: 0.0,
                ..Transform::default()
            },
        );
        let mut channel = AnimationChannel::default();
        channel.upsert(MediaTime::ZERO, 0.0);
        channel.upsert(seconds(0.5), 1.0);
        element
            .animations_mut()
            .expect("text animates")
            .insert("opacity".into(), channel);
        assert!(!has(&check(&project_with(vec![element])), "invisible"));
    }

    /// But one that nothing ever raises really does render nothing.
    #[test]
    fn a_transparent_element_with_no_animation_is_still_flagged() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                opacity: 0.0,
                ..Transform::default()
            },
        )]);
        assert!(has(&check(&project), "invisible"));
    }

    /// Layering on an overlay lane is the composition working, not a defect. This fired 104
    /// times on one real project, every one of them a decorative sitting under a title.
    #[test]
    fn layered_overlays_are_not_reported_as_overlaps() {
        let mut project = project_with(Vec::new());
        let scene = project.active_scene_mut();
        let mut overlay = bay_project::Track::new("track-overlay-1", "Overlay", TrackKind::Video);
        overlay.elements = vec![shape("ground", 0.0, 20.0), shape("kicker", 1.0, 18.0)];
        scene.tracks.overlay.push(overlay);
        // Something on the main lane so the timeline is not otherwise empty.
        scene.tracks.main.elements = vec![shape("bed", 0.0, 20.0)];
        assert!(!has(&check(&project), "overlap"));
    }

    /// On the main lane it is still a defect: the later clip covers the earlier one.
    #[test]
    fn two_clips_on_the_main_lane_still_overlap() {
        let project = project_with(vec![shape("a", 0.0, 5.0), shape("b", 2.0, 5.0)]);
        assert!(has(&check(&project), "overlap"));
    }

    #[test]
    fn a_clip_pointing_at_media_nobody_imported_is_an_error() {
        let project = project_with(vec![Element::Video(VideoElement {
            id: "v".into(),
            name: "v".into(),
            start: MediaTime::ZERO,
            duration: seconds(3.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "never-imported".into(),
            trim_start: MediaTime::ZERO,
            trim_end: seconds(3.0),
            speed: 1.0,
            freeze: None,
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })]);
        let report = check(&project);
        assert!(has(&report, "missing-media"), "{:?}", codes(&report));
    }

    #[test]
    fn a_registered_media_asset_whose_file_is_gone_is_an_error() {
        let mut project = project_with(vec![Element::Video(VideoElement {
            id: "v".into(),
            name: "v".into(),
            start: MediaTime::ZERO,
            duration: seconds(3.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "gone".into(),
            trim_start: MediaTime::ZERO,
            trim_end: seconds(3.0),
            speed: 1.0,
            freeze: None,
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })]);
        project.media.push(bay_project::MediaAsset::new(
            "gone",
            "gone.mp4",
            "/nonexistent/bay-media-is-gone.mp4",
        ));

        let report = check(&project);
        assert!(has(&report, "missing-media"), "{:?}", codes(&report));
    }

    /// The check that the source-range work made possible: a clip reading past the end of its
    /// own file. Its tail is frames that do not exist.
    #[test]
    fn a_clip_trimmed_past_the_end_of_its_file_is_an_error() {
        let mut project = project_with(vec![Element::Video(VideoElement {
            id: "v".into(),
            name: "v".into(),
            start: MediaTime::ZERO,
            duration: seconds(5.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "clip".into(),
            trim_start: seconds(8.0),
            trim_end: seconds(13.0),
            speed: 1.0,
            freeze: None,
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })]);
        let mut asset = MediaAsset::new("clip", "clip.mp4", "/tmp/clip.mp4");
        asset.duration_seconds = Some(10.0);
        project.media.push(asset);

        let report = check(&project);
        assert!(
            message(&report, "past-source-end").contains("3.00s"),
            "{:?}",
            codes(&report)
        );
        assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    }

    /// An unprobed file has no known length, so there is nothing to compare against — and the
    /// pass must say it could not evaluate the rule rather than quietly pass it.
    #[test]
    fn an_unprobed_file_is_reported_as_a_skip_not_a_pass() {
        let mut project = project_with(vec![Element::Video(VideoElement {
            id: "v".into(),
            name: "v".into(),
            start: MediaTime::ZERO,
            duration: seconds(5.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "clip".into(),
            trim_start: seconds(8.0),
            trim_end: seconds(13.0),
            speed: 1.0,
            freeze: None,
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })]);
        project
            .media
            .push(MediaAsset::new("clip", "clip.mp4", "/tmp/clip.mp4"));
        let report = check(&project);
        assert!(!has(&report, "past-source-end"));
        assert!(
            report
                .skipped
                .iter()
                .any(|skip| skip.code == "past-source-end"),
            "{:?}",
            report.skipped
        );
    }

    #[test]
    fn a_hole_in_the_picture_is_reported_with_where_it_starts() {
        let project = project_with(vec![shape("a", 0.0, 2.0), shape("b", 5.0, 2.0)]);
        let report = check(&project);
        let gap = report
            .findings
            .iter()
            .find(|f| f.code == "gap")
            .expect("the hole is caught");
        assert_eq!(gap.at_seconds, Some(2.0));
        assert!(gap.message.contains("3.00s of black"), "{}", gap.message);
    }

    /// Two clips butted together are not a gap. Tick-level rounding must not manufacture one.
    #[test]
    fn butted_clips_are_not_a_gap() {
        let project = project_with(vec![shape("a", 0.0, 2.0), shape("b", 2.0, 2.0)]);
        assert!(!has(&check(&project), "gap"));
    }

    /// A hole on the main lane that an overlay covers is not a black frame. Checking lanes
    /// separately would report it, which would teach people to ignore the check.
    #[test]
    fn an_overlay_covering_the_hole_means_there_is_no_hole() {
        let mut project = project_with(vec![shape("a", 0.0, 2.0), shape("b", 5.0, 2.0)]);
        let mut overlay = Track::new("track-overlay", "Overlay", TrackKind::Overlay);
        overlay.elements = vec![shape("cover", 2.0, 3.0)];
        project.active_scene_mut().tracks.overlay = vec![overlay];
        assert!(!has(&check(&project), "gap"));
    }

    #[test]
    fn opening_on_black_is_called_out() {
        let project = project_with(vec![shape("a", 1.5, 2.0)]);
        assert!(has(&check(&project), "black-start"));
    }

    #[test]
    fn an_empty_picture_lane_is_an_error() {
        let project = project_with(Vec::new());
        let report = check(&project);
        assert!(has(&report, "nothing-visual"));
        // And it stops there rather than also reporting the gaps in a timeline that has none.
        assert!(!has(&report, "gap"));
    }

    #[test]
    fn overlapping_clips_on_one_lane_are_reported_once() {
        let project = project_with(vec![shape("a", 0.0, 3.0), shape("b", 2.0, 3.0)]);
        assert_eq!(count(&check(&project), "overlap"), 1);
    }

    /// A cross-dissolve is two clips overlapping with the incoming one fading in. Calling
    /// that a mistake is how a check gets switched off.
    #[test]
    fn a_dissolve_is_not_reported_as_an_overlap() {
        let mut a = shape("a", 0.0, 3.0);
        let mut b = shape("b", 2.0, 3.0);
        b.set_fades(seconds(1.0), MediaTime::ZERO);
        let project = project_with(vec![a.clone(), b]);
        assert!(!has(&check(&project), "overlap"));

        // The same overlap with no fade is still worth saying.
        a.set_fades(MediaTime::ZERO, MediaTime::ZERO);
        let project = project_with(vec![a, shape("b", 2.0, 3.0)]);
        assert!(has(&check(&project), "overlap"));
    }

    #[test]
    fn an_animation_that_runs_past_its_clip_is_reported() {
        let mut element = title("t", "Hello", 96.0, Transform::default());
        let mut channel = bay_project::AnimationChannel::default();
        channel.upsert(MediaTime::ZERO, 0.0);
        channel.upsert(seconds(9.0), 1.0); // the clip is 3s long
        element
            .animations_mut()
            .unwrap()
            .insert("opacity".into(), channel);
        let report = check(&project_with(vec![element]));
        assert!(has(&report, "animation-overruns"), "{:?}", codes(&report));
    }

    /// A LUT whose file is missing renders nothing, and a clip that looks untouched is
    /// indistinguishable from one with a subtle grade — so it has to be said out loud.
    #[test]
    fn a_grade_whose_file_is_missing_is_an_error() {
        let mut element = title("t", "Hello", 96.0, Transform::default());
        element.effects_mut().unwrap().push(bay_project::Effect {
            id: "fx".into(),
            effect_type: "lut".into(),
            enabled: true,
            params: Default::default(),
            asset: Some("/tmp/bay-no-such-grade.cube".into()),
        });
        let report = check(&project_with(vec![element]));
        assert!(has(&report, "missing-effect-asset"), "{:?}", codes(&report));
    }

    /// A built-in look is not a file, and must not be reported as a missing one.
    ///
    /// `looks_list` offers six grades the machine generates itself; `effect_add` records one
    /// as `look:<id>`. This pass used to test that string with `Path::exists`, so every clip
    /// graded the documented way came back as "not on disk — the clip renders ungraded". A
    /// render is refused while an error stands, so grading a timeline made it unexportable.
    #[test]
    fn a_built_in_look_is_not_a_missing_file() {
        for id in bay_project::BUILTIN_LOOKS {
            let mut element = title("t", "Hello", 96.0, Transform::default());
            element.effects_mut().unwrap().push(bay_project::Effect {
                id: "fx".into(),
                effect_type: "lut".into(),
                enabled: true,
                params: Default::default(),
                asset: Some(format!("{}{id}", bay_project::LOOK_PREFIX)),
            });
            let report = check(&project_with(vec![element]));
            assert!(
                !has(&report, "missing-effect-asset"),
                "{id} is generated, not loaded: {:?}",
                codes(&report)
            );
        }
    }

    /// A look that does not exist still renders ungraded, so that stays an error — the check
    /// moved from "is there a file" to "is this a look", rather than being switched off.
    #[test]
    fn a_look_this_build_does_not_have_is_still_an_error() {
        let mut element = title("t", "Hello", 96.0, Transform::default());
        element.effects_mut().unwrap().push(bay_project::Effect {
            id: "fx".into(),
            effect_type: "lut".into(),
            enabled: true,
            params: Default::default(),
            asset: Some("look:warm-flim".into()),
        });
        let report = check(&project_with(vec![element]));
        assert!(has(&report, "missing-effect-asset"), "{:?}", codes(&report));
    }

    #[test]
    fn a_silent_timeline_is_a_note_not_an_error() {
        let report = check(&project_with(vec![shape("a", 0.0, 2.0)]));
        let found = report
            .findings
            .iter()
            .find(|f| f.code == "silent")
            .expect("silence is mentioned");
        assert_eq!(found.severity, Severity::Note);
        assert_eq!(report.errors, 0, "silence must not block a render");
    }

    #[test]
    fn audio_on_the_timeline_clears_the_silence_note() {
        let mut project = project_with(vec![shape("a", 0.0, 2.0)]);
        with_audio(&mut project, vec![sound("bed", 0.0, 2.0, 1.0)]);
        assert!(!has(&check(&project), "silent"));
    }

    #[test]
    fn hidden_tracks_holding_content_are_worth_saying() {
        let mut project = project_with(vec![shape("a", 0.0, 2.0)]);
        project.active_scene_mut().tracks.main.hidden = true;
        assert!(has(&check(&project), "hidden-track-has-content"));
    }

    /// The worst news first, so a caller that reads only the top of the list reads the errors.
    #[test]
    fn findings_come_back_worst_first() {
        let project = project_with(vec![
            title("small", "tiny", 8.0, Transform::default()),
            title(
                "gone",
                "off",
                96.0,
                Transform {
                    x: 3.0,
                    ..Transform::default()
                },
            ),
        ]);
        let report = check(&project);
        assert_eq!(report.findings[0].severity, Severity::Error);
        assert!(report.errors >= 1 && report.warnings >= 1);
    }

    /// The other half of the baseline. A plain, correct timeline must not trip any of the
    /// judgement checks either — a warning nobody can act on is exactly the noise that gets a
    /// check switched off.
    #[test]
    fn the_judgement_checks_stay_quiet_on_a_plain_timeline() {
        let project = project_with(vec![title(
            "t",
            "Hello",
            96.0,
            Transform {
                y: 0.5,
                ..Transform::default()
            },
        )]);
        let report = check(&project);
        for code in [
            "monotone-easing",
            "monotone-duration",
            "no-bed",
            "flat-mix",
            "no-hook",
            "dead-plate",
            "empty-container",
            "value-overshoot",
            "off-grid",
            "unreadable-dwell",
        ] {
            assert!(!has(&report, code), "{code} fired: {:?}", report.findings);
        }
    }

    /// Every move in every window eased the same way. That is the whole motion vocabulary of the
    /// video, and it is asked per window rather than per project — see
    /// [`the_whole_project_forms_of_the_monotone_checks_are_gone`] for why the global form is
    /// not here any more.
    #[test]
    fn one_easing_across_every_window_is_monotone() {
        let report = check(&scene_of(one_move_each(40, Easing::EaseOut, 0.4)));
        assert!(
            message(&report, "monotone-easing").contains("ease every move"),
            "{:?}",
            codes(&report)
        );
    }

    /// **The two shapes plan §1.4 rejects on sight, deleted.** `monotone-easing` was a
    /// distinct-value cardinality over the whole project (`curves.len() == 1`) and
    /// `monotone-duration` a one-sided global ratio (`longest / shortest`), which is what round 1
    /// shipped and what round 1's agent answered with 130 `hold` keys on flat segments and one
    /// 11.7 s move among 76 of 0.098 s. They also fired on a video whose forty assets share one
    /// motion idea on purpose while staying silent on the video this round exists because of.
    ///
    /// Ten moves over ten seconds is one curve and one duration for the entire project and never
    /// enough moves in any five-second window to have a vocabulary — the global forms reported
    /// it, and nothing does now.
    #[test]
    fn the_whole_project_forms_of_the_monotone_checks_are_gone() {
        let report = check(&scene_of(one_move_each(10, Easing::EaseOut, 0.4)));
        assert!(!has(&report, "monotone-easing"), "{:?}", codes(&report));
        assert!(!has(&report, "monotone-duration"), "{:?}", codes(&report));
    }

    /// `n` captions spread evenly over ten seconds, each with one move of `length` on one curve
    /// — dense enough that a five-second window has a vocabulary to be monotone about.
    fn one_move_each(n: usize, easing: Easing, length: f64) -> Vec<Element> {
        (0..n)
            .map(|index| {
                let at = index as f64 * 10.0 / n as f64;
                let mut caption = text_at(&format!("c{index}"), at, 1.0, 96.0);
                animate(
                    &mut caption,
                    "opacity",
                    &[(0.0, 0.0), (length, 1.0)],
                    easing,
                );
                caption
            })
            .collect()
    }

    /// A curve set on the key rather than on the channel is still a curve. Counting only the
    /// channel field would report the author who varies their easing per segment — the exact
    /// thing this check exists to ask for — as monotone.
    #[test]
    fn per_key_easings_count_as_variety() {
        let curves = [Easing::SpringOut, Easing::ExpoOut, Easing::SineInOut];
        let captions = (0..40)
            .map(|index| {
                let mut caption = text_at(&format!("c{index}"), index as f64 * 0.25, 1.0, 96.0);
                // Every channel keeps the default channel easing; the variety is on the keys.
                let mut channel = AnimationChannel::default();
                channel.upsert_eased(seconds(0.0), 0.0, curves[index % curves.len()]);
                channel.upsert(seconds(0.4), 1.0);
                caption
                    .animations_mut()
                    .expect("visual elements animate")
                    .insert("opacity".into(), channel);
                caption
            })
            .collect();
        let report = check(&scene_of(captions));
        assert!(!has(&report, "monotone-easing"), "{:?}", codes(&report));
    }

    /// The same shape with the override removed is monotone again — the keys are what made
    /// the difference, not the number of channels.
    #[test]
    fn the_same_channels_without_per_key_curves_are_monotone() {
        let captions = one_move_each(40, Easing::SpringOut, 0.4);
        assert!(has(&check(&scene_of(captions)), "monotone-easing"));
    }

    #[test]
    fn a_project_that_varies_its_curves_is_not_monotone() {
        let curves = [Easing::EaseOut, Easing::ExpoOut, Easing::BackOut];
        let captions = (0..40)
            .map(|index| {
                let mut caption = text_at(&format!("c{index}"), index as f64 * 0.25, 1.0, 96.0);
                animate(
                    &mut caption,
                    "opacity",
                    &[(0.0, 0.0), (0.4, 1.0)],
                    curves[index % curves.len()],
                );
                caption
            })
            .collect();
        let report = check(&scene_of(captions));
        assert!(!has(&report, "monotone-easing"), "{:?}", codes(&report));
    }

    /// Forty moves, all 0.4s long: nothing can snap and nothing can settle, in any window.
    #[test]
    fn moves_that_are_all_the_same_length_are_monotone() {
        let report = check(&scene_of(one_move_each(40, Easing::EaseOut, 0.4)));
        let found = report
            .findings
            .iter()
            .find(|f| f.code == "monotone-duration" && f.message.contains("windows"))
            .unwrap_or_else(|| panic!("one speed everywhere is caught: {:?}", codes(&report)));
        assert!(found.message.contains("0.40s"), "{}", found.message);
    }

    /// 10.5 / 10.0 / 9.6 seconds — the pacing of one of the videos this check comes from.
    #[test]
    fn scenes_of_the_same_length_have_one_tempo() {
        let project = project_with(vec![
            shape("a", 0.0, 10.5),
            shape("b", 10.5, 10.0),
            shape("c", 20.5, 9.6),
        ]);
        let report = check(&project);
        let found = report
            .findings
            .iter()
            .find(|f| f.code == "monotone-duration" && f.message.contains("tempo"))
            .unwrap_or_else(|| panic!("uniform pacing is caught: {:?}", codes(&report)));
        assert!(found.message.contains("1.09×"), "{}", found.message);
    }

    #[test]
    fn a_real_rhythm_of_scene_lengths_is_not_flagged() {
        let project = project_with(vec![
            shape("a", 0.0, 4.0),
            shape("b", 4.0, 8.0),
            shape("c", 12.0, 16.0),
        ]);
        assert!(!has(&check(&project), "monotone-duration"));
    }

    /// Three lines of narration with silence between them and nothing underneath — all three
    /// of the videos we measured.
    #[test]
    fn narration_with_nothing_under_it_has_no_bed() {
        let mut project = project_with(vec![shape("ground", 0.0, 30.0)]);
        with_audio(
            &mut project,
            vec![
                sound("line1", 0.0, 8.0, 1.0),
                sound("line2", 9.0, 8.0, 1.0),
                sound("line3", 18.0, 10.0, 1.0),
            ],
        );
        let report = check(&project);
        assert!(
            message(&report, "no-bed").contains("3 audio clips"),
            "{:?}",
            codes(&report)
        );
    }

    #[test]
    fn a_bed_under_the_narration_clears_no_bed() {
        let mut project = project_with(vec![shape("ground", 0.0, 30.0)]);
        with_audio(
            &mut project,
            vec![
                sound("line1", 0.0, 8.0, 1.0),
                sound("line2", 9.0, 8.0, 1.0),
                sound("line3", 18.0, 10.0, 1.0),
                sound("bed", 0.0, 30.0, 0.2),
            ],
        );
        let report = check(&project);
        assert!(!has(&report, "no-bed"), "{:?}", codes(&report));
        // A bed 14 dB under the voice is a mix, not a flat one.
        assert!(!has(&report, "flat-mix"), "{:?}", codes(&report));
    }

    /// A bed at 0.8 under a voice at 1.0 is 1.9 dB of separation for the whole overlap: the
    /// words land inside the music.
    #[test]
    fn a_bed_that_never_ducks_is_a_flat_mix() {
        let mut project = project_with(vec![shape("ground", 0.0, 10.0)]);
        with_audio(
            &mut project,
            vec![sound("voice", 0.0, 10.0, 1.0), sound("bed", 0.0, 10.0, 0.8)],
        );
        let report = check(&project);
        assert!(
            message(&report, "flat-mix").contains("1.9 dB"),
            "{:?}",
            codes(&report)
        );
    }

    /// The same two clips with the bed keyframed out of the way. Sampled through the mixer's
    /// own `sampled_gain`, so what the check measures is what will be heard.
    #[test]
    fn a_bed_that_ducks_under_the_voice_is_not_flat() {
        let mut bed = sound("bed", 0.0, 10.0, 0.8);
        animate(
            &mut bed,
            "volume",
            &[(0.0, 0.8), (0.5, 0.12), (9.5, 0.12), (10.0, 0.8)],
            Easing::EaseOut,
        );
        let mut project = project_with(vec![shape("ground", 0.0, 10.0)]);
        with_audio(&mut project, vec![sound("voice", 0.0, 10.0, 1.0), bed]);
        let report = check(&project);
        assert!(!has(&report, "flat-mix"), "{:?}", codes(&report));
    }

    /// **A check a bad video silences with a cosmetic edit certifies the mix.**
    ///
    /// The window used to end the moment either level reached zero, which is what a fade does by
    /// definition — so a 0.3 s `fadeIn` took the project this comes from from six `flat-mix`
    /// findings to zero with the separation unchanged at 4.3 dB. The fade is now excluded from
    /// the window instead of ending it.
    #[test]
    fn a_cosmetic_fade_does_not_silence_the_flat_mix_check() {
        let mut project = project_with(vec![shape("ground", 0.0, 10.0)]);
        let mut bed = sound("bed", 0.0, 10.0, 0.8);
        bed.set_fades(seconds(0.3), seconds(0.3));
        with_audio(&mut project, vec![sound("voice", 0.0, 10.0, 1.0), bed]);
        let report = check(&project);
        assert!(
            message(&report, "flat-mix").contains("1.9 dB"),
            "the separation is what it always was: {:?}",
            codes(&report),
        );
    }

    /// …and a fade long enough to swallow the whole overlap leaves nothing to judge, which is
    /// reported as nothing rather than as a pass for the mix.
    #[test]
    fn two_clips_that_are_all_fade_are_not_judged_at_all() {
        let mut project = project_with(vec![shape("ground", 0.0, 10.0)]);
        let mut bed = sound("bed", 0.0, 10.0, 0.8);
        bed.set_fades(seconds(5.0), seconds(5.0));
        with_audio(&mut project, vec![sound("voice", 0.0, 10.0, 1.0), bed]);
        assert!(!has(&check(&project), "flat-mix"));
    }

    // ------------------------------------------------------- the mix, measured in its own unit

    /// An asset with a measured loudness, which is what makes a level comparable to another
    /// level rather than to another multiplier.
    fn measured(id: &str, lufs: f32) -> MediaAsset {
        let mut asset = MediaAsset::new(id, format!("{id}.wav"), format!("/tmp/{id}.wav"));
        asset.loudness = Some(bay_project::AssetLoudness {
            peak_db: -3.0,
            rms_db: lufs - 6.0,
            lufs,
            accent_seconds: Vec::new(),
        });
        asset
    }

    /// A bed and three lines, with every asset measured. `bed_gain` is the level the music sits
    /// at between the lines; `duck` is what it drops to under them.
    fn narrated_mix(bed_lufs: f32, bed_gain: f32, duck: Option<f32>) -> Project {
        let mut project = project_with(vec![shape("ground", 0.0, 30.0)]);
        let mut bed = sound("bed", 0.0, 30.0, bed_gain);
        if let Element::Audio(audio) = &mut bed {
            audio.media_id = "bed".into();
        }
        if let Some(ducked) = duck {
            let mut keys = vec![(0.0, bed_gain)];
            for index in 0..3 {
                let start = 2.0 + index as f64 * 10.0;
                keys.push((start - 0.25, bed_gain));
                keys.push((start - 0.1, ducked));
                keys.push((start + 5.15, ducked));
                keys.push((start + 5.65, bed_gain));
            }
            let pairs: Vec<(f64, f32)> = keys;
            animate(&mut bed, "volume", &pairs, Easing::Linear);
        }
        let mut clips = vec![bed];
        for index in 0..3 {
            let mut line = speech(&format!("line-{index}"), 2.0 + index as f64 * 10.0, 5.0);
            if let Element::Audio(audio) = &mut line {
                audio.media_id = "voice".into();
            }
            clips.push(line);
        }
        with_audio(&mut project, clips);
        project.media = vec![measured("bed", bed_lufs), measured("voice", -20.0)];
        project
    }

    /// The defect the whole module exists for: the gaps between the lines are as loud as the
    /// lines. On the video this comes from they were **1.1 dB louder** — the duck ran backwards
    /// for 61 seconds and nothing in the pass could say so, because everything it measured was a
    /// dimensionless multiplier.
    #[test]
    fn gaps_as_loud_as_the_lines_are_a_masked_mix() {
        let project = narrated_mix(-20.0, 1.0, None);
        let report = check(&project);
        let found = message(&report, "speech-masked");
        assert!(found.contains("LU apart"), "{found}");
        assert!(
            report.stats.mix.separation_lu.expect("measured") < 6.0,
            "{:?}",
            report.stats.mix
        );
    }

    /// The same three lines over a bed placed and ducked the way the spec asks for: 6 LU under
    /// the voice between lines, 8 dB further under them.
    #[test]
    fn a_bed_placed_and_ducked_to_spec_is_not_masked() {
        let project = narrated_mix(-20.0, 0.5, Some(0.2));
        let report = check(&project);
        assert!(!has(&report, "speech-masked"), "{:?}", codes(&report));
        assert!(!has(&report, "bed-too-quiet"), "{:?}", codes(&report));
        assert!(report.stats.mix.separation_lu.expect("measured") >= 6.0);
    }

    /// The gaming move the pair brackets: turn the bed down until the lines tower over it. The
    /// separation passes and the floor does not, which is what the old one-sided check lacked.
    #[test]
    fn a_bed_nobody_can_hear_fails_the_other_side_of_the_bracket() {
        let project = narrated_mix(-45.0, 0.5, Some(0.2));
        let report = check(&project);
        assert!(
            !has(&report, "speech-masked"),
            "a bed this quiet does buy separation — that is why the floor exists: {:?}",
            codes(&report)
        );
        let found = message(&report, "bed-too-quiet");
        assert!(found.contains("audio_probe"), "{found}");
    }

    /// Scaling every gain by a constant was how the deleted `gain-above-unity` warning was
    /// answered. It changes no relative level, `loudnorm` undoes it, and it must move this
    /// measurement by exactly nothing.
    #[test]
    fn turning_every_gain_down_together_changes_no_measurement() {
        let before = check(&narrated_mix(-20.0, 1.0, None)).stats.mix;
        let mut project = narrated_mix(-20.0, 1.0, None);
        for track in project.active_scene_mut().tracks.audio.iter_mut() {
            for element in &mut track.elements {
                if let Element::Audio(audio) = element {
                    audio.volume *= 0.25;
                }
            }
        }
        let after = check(&project).stats.mix;
        assert_eq!(before.separation_lu, after.separation_lu);
        assert_eq!(before.gap_bed_lufs, after.gap_bed_lufs);
    }

    /// An unmeasured sound is not a silent one. Before the assets are probed the two mix codes
    /// have to say they could not run — a pass here would be the `spans()` degeneracy again,
    /// with a new noun.
    #[test]
    fn an_unprobed_sound_is_reported_as_unevaluated_not_as_a_pass() {
        let mut project = narrated_mix(-20.0, 1.0, None);
        project.media.retain(|asset| asset.id != "bed");
        project
            .media
            .push(MediaAsset::new("bed", "bed.wav", "/tmp/bed.wav"));
        let report = check(&project);
        assert!(!has(&report, "speech-masked"), "{:?}", codes(&report));
        let skipped: Vec<&str> = report.skipped.iter().map(|s| s.code).collect();
        assert!(skipped.contains(&"speech-masked"), "{skipped:?}");
        assert!(skipped.contains(&"bed-too-quiet"), "{skipped:?}");
        assert!(
            report
                .skipped
                .iter()
                .any(|s| s.reason.contains("audio_probe")),
            "the reason has to name the call that fixes it: {:?}",
            report.skipped
        );
    }

    /// Music with no narration has no lines for a bed to make room for. The pass says that
    /// rather than reporting a separation against an empty set.
    #[test]
    fn music_with_no_speech_skips_the_separation_rather_than_passing_it() {
        let mut project = project_with(vec![shape("ground", 0.0, 30.0)]);
        let mut bed = sound("bed", 0.0, 30.0, 1.0);
        if let Element::Audio(audio) = &mut bed {
            audio.media_id = "bed".into();
        }
        with_audio(&mut project, vec![bed]);
        project.media = vec![measured("bed", -20.0)];
        let report = check(&project);
        let skipped: Vec<&str> = report.skipped.iter().map(|s| s.code).collect();
        assert!(skipped.contains(&"speech-masked"), "{skipped:?}");
    }

    /// The argmax, reported and not gated: where the loudest 400 ms falls, and whether it is at
    /// the `payoff` marker. A table of levels makes everything equal; this asks for exactly one
    /// thing to be unequal, and it is in `stats` so it can be argued with.
    #[test]
    fn the_loudest_moment_is_reported_against_the_payoff_marker() {
        let mut project = narrated_mix(-20.0, 0.5, Some(0.2));
        let mut hit = sound("hit", 24.0, 0.5, 1.0);
        if let Element::Audio(audio) = &mut hit {
            audio.media_id = "hit".into();
            audio.role = bay_project::AudioRole::Sfx;
        }
        project.active_scene_mut().tracks.audio[0]
            .elements
            .push(hit);
        project.media.push(measured("hit", -4.0));
        project
            .active_scene_mut()
            .markers
            .push(bay_project::Marker {
                id: "m1".into(),
                time: seconds(24.2),
                label: "payoff".into(),
            });
        let mix = check(&project).stats.mix;
        assert_eq!(mix.payoff_at_seconds, Some(24.2));
        assert_eq!(mix.peak_at_payoff, Some(true), "{mix:?}");
    }

    /// …and a project that never says where its payoff is gets `None` rather than a pass. An
    /// argmax needs somewhere to point, and the marker has to be committed before the audio
    /// exists or it is placed wherever the mix already peaks.
    #[test]
    fn no_payoff_marker_is_not_a_passing_argmax() {
        let mix = check(&narrated_mix(-20.0, 0.5, Some(0.2))).stats.mix;
        assert_eq!(mix.payoff_at_seconds, None);
        assert_eq!(mix.peak_at_payoff, None);
    }

    /// The warning these replace stays deleted. It fired 22 times on one project — 16 of them on
    /// levels that were right, including six on bay's own `narrate` output — it measured a
    /// dimensionless number, and it was satisfiable by scaling everything down, which changes
    /// nothing audible and which `loudnorm` then undoes.
    #[test]
    fn the_dimensionless_gain_warning_is_gone() {
        assert!(
            !CODES.iter().any(|(name, _, _)| *name == "gain-above-unity"),
            "gain-above-unity is back in the registry"
        );
    }

    /// The budget, stated as arithmetic rather than as a hope. `text-collision` is measured from
    /// shaped glyph bounds and takes the slot previously held by `speech-masked`, which remains a
    /// warning until a checked-in fixture can evaluate it — see `docs/native/check-codes.md`.
    #[test]
    fn text_collision_replaces_the_unmeasured_mix_gate() {
        assert_eq!(severity_of("speech-masked"), Severity::Warning);
        assert_eq!(severity_of("bed-too-quiet"), Severity::Warning);
        assert_eq!(severity_of("text-collision"), Severity::Error);
        assert_eq!(
            gating_codes().len(),
            MAX_GATING_CODES,
            "the gating budget is now full: {:?}",
            gating_codes()
        );
    }

    // ------------------------------------------------------------------- what is on the frame

    /// The single largest defect in the project this comes from, to the digit: a panel covering
    /// 34.2 % of a 1080×1920 canvas, filled `#191922` on a `#0E0E12` ground — 1.10:1.
    #[test]
    fn a_large_fill_too_close_to_its_ground_is_a_dead_plate() {
        let mut project = project_with(vec![plate("panel", "#191922", 0.9, 0.38, 10.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        project.settings.canvas = bay_project::CanvasSize {
            width: 1080,
            height: 1920,
        };
        let report = check(&project);
        let found = message(&report, "dead-plate");
        assert!(found.contains("1.10:1"), "{found}");
        assert!(found.contains("34.2%"), "{found}");
    }

    /// **Turning the plate down does not make it visible.** The same panel at opacity 0.49
    /// cleared both shape checks outright, because each of them asked for opacity ≥ 0.5 before
    /// looking at the element at all — so the cheapest way to answer "this fill cannot be seen"
    /// was to make it *harder* to see, and the measured cost was two of wicks-v2's five errors.
    /// Opacity is composited into the measurement now: at 0.49 the panel's contrast against its
    /// ground is lower, not absent.
    #[test]
    fn a_plate_turned_down_to_half_opacity_is_still_a_dead_plate() {
        let mut project = project_with(vec![plate("panel", "#191922", 0.9, 0.38, 10.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        for opacity in [1.0_f32, 0.49] {
            if let Element::Shape(s) = &mut project.active_scene_mut().tracks.main.elements[0] {
                s.transform.opacity = opacity;
            }
            let report = check(&project);
            assert!(
                has(&report, "dead-plate"),
                "at opacity {opacity}: {:?}",
                codes(&report)
            );
        }
    }

    /// The same plate lifted to 2.4:1 is a design element, and the layout rules then apply to
    /// it. Every escape from this check is a better video.
    #[test]
    fn a_plate_that_can_be_seen_is_not_reported() {
        let mut project = project_with(vec![plate("panel", "#4A4A58", 0.9, 0.38, 10.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        assert!(!has(&check(&project), "dead-plate"));
    }

    /// Split into eight slices each under the four-percent floor, it is still one plate.
    /// Aggregation is what stops the only escape that does not improve the video.
    #[test]
    fn eight_small_plates_butted_together_are_one_plate() {
        let mut elements = Vec::new();
        for index in 0..8 {
            // 3.6 % each — under the floor on its own, 28.8 % butted together.
            let mut element = plate(&format!("slice{index}"), "#191922", 0.9, 0.04, 10.0);
            if let Element::Shape(s) = &mut element {
                s.transform.y = 0.3 + index as f32 * 0.04;
            }
            elements.push(element);
        }
        let mut project = project_with(Vec::new());
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        with_overlay(&mut project, elements);
        // Something small on the main lane so the timeline is not empty, and small enough that
        // it is not the frame's ground.
        let mut marker = plate("marker", "#FFFFFF", 0.1, 0.1, 10.0);
        if let Element::Shape(s) = &mut marker {
            s.transform.y = 0.95;
        }
        project.active_scene_mut().tracks.main.elements = vec![marker];
        let report = check(&project);
        assert!(has(&report, "dead-plate"), "{:?}", codes(&report));
        assert_eq!(
            count(&report, "dead-plate"),
            1,
            "one plate, one finding: {:?}",
            report.findings
        );
    }

    /// **One hex digit used to defeat the aggregation.** Nine tiles at `#191922`…`#19192A` are
    /// the same colour to any eye and to any encoder, each falls under the four-percent floor,
    /// and none of them ever unioned with its neighbour because the grouping compared colours by
    /// byte equality. Errors went 5 → 3 on wicks-v2 for an output that is pixel-equivalent.
    /// Grouping is on ΔE00 now, so nine jittered tiles are one 34 % plate.
    #[test]
    fn nine_tiles_jittered_by_one_hex_digit_are_still_one_plate() {
        let mut elements = Vec::new();
        for index in 0..9u8 {
            // 3.8 % each — under the floor on its own, 34.2 % butted together, and every one of
            // them a different `[u8; 3]`.
            let mut element = plate(
                &format!("tile{index}"),
                &format!("#1919{:02X}", 0x22 + index),
                0.9,
                0.0422,
                10.0,
            );
            if let Element::Shape(s) = &mut element {
                s.transform.y = 0.28 + f32::from(index) * 0.0422;
            }
            elements.push(element);
        }
        let mut project = project_with(Vec::new());
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        with_overlay(&mut project, elements);
        let mut marker = plate("marker", "#FFFFFF", 0.1, 0.1, 10.0);
        if let Element::Shape(s) = &mut marker {
            s.transform.y = 0.95;
        }
        project.active_scene_mut().tracks.main.elements = vec![marker];
        let report = check(&project);
        assert_eq!(
            count(&report, "dead-plate"),
            1,
            "nine tiles, one plate: {:?}",
            report.findings
        );
        let found = message(&report, "dead-plate");
        assert!(found.contains("34.2%"), "{found}");
        assert!(found.contains("tile0, tile1"), "{found}");
    }

    /// A ground is exempt — but only one per scene, and only something that is actually the
    /// surface everything else sits on. A third of the canvas is not a ground.
    #[test]
    fn the_ground_is_exempt_and_a_third_of_the_canvas_is_not_a_ground() {
        let mut ground = plate("ground", "#131318", 1.0, 1.0, 10.0);
        if let Element::Shape(s) = &mut ground {
            s.role = ElementRole::Ground;
        }
        let mut panel = plate("panel", "#191922", 0.9, 0.38, 10.0);
        if let Element::Shape(s) = &mut panel {
            s.role = ElementRole::Ground;
            s.transform.y = 0.5;
        }
        let mut project = project_with(vec![ground]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        with_overlay(&mut project, vec![panel]);
        let report = check(&project);
        assert_eq!(count(&report, "dead-plate"), 1, "{:?}", report.findings);
        assert_eq!(
            report.findings[0].element_id.as_deref(),
            Some("panel"),
            "the ground is exempt, the panel calling itself one is not"
        );
    }

    /// Six seconds of a card with nothing on it. The card renders perfectly; it is empty.
    ///
    /// `#4A4A58` on purpose: it clears `dead-plate` at 2.4:1, so this test is about emptiness
    /// and nothing else. (It is also the colour the old skill listed in its palette and
    /// labelled "2.21:1 — still too low", which is its own small lesson.)
    #[test]
    fn a_large_shape_with_nothing_in_it_is_an_empty_container() {
        let mut project = project_with(vec![plate("card", "#4A4A58", 0.8, 0.5, 6.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        let report = check(&project);
        assert!(!has(&report, "dead-plate"), "{:?}", codes(&report));
        assert!(
            message(&report, "empty-container").contains("0 mark(s)"),
            "{:?}",
            codes(&report)
        );
    }

    /// Two marks that read against the card itself are a composition.
    #[test]
    fn a_card_with_marks_on_it_is_not_empty() {
        let mut project = project_with(vec![plate("card", "#4A4A58", 0.8, 0.5, 6.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        // Side by side rather than stacked: a white bar drawn on top of another white bar is
        // invisible, and this check is right to say so.
        let mut left = plate("bar", "#FFFFFF", 0.2, 0.2, 6.0);
        if let Element::Shape(s) = &mut left {
            s.transform.x = 0.3;
        }
        let mut right = plate("bar2", "#FFFFFF", 0.2, 0.2, 6.0);
        if let Element::Shape(s) = &mut right {
            s.transform.x = 0.7;
        }
        with_overlay(&mut project, vec![left, right]);
        assert!(!has(&check(&project), "empty-container"));
    }

    /// Marks that clear 3:1 against the background and 1.2:1 against the card they sit on are
    /// not marks. This is the gridline case, exactly: every gridline in the project this comes
    /// from passes against the background and vanishes against the card.
    #[test]
    fn marks_are_measured_against_the_card_not_the_background() {
        let mut project = project_with(vec![plate("card", "#4A4A58", 0.8, 0.5, 6.0)]);
        project.settings.background = Background::Color {
            color: "#000000".into(),
        };
        assert!(
            kit::contrast_ratio("#5C5C66", "#000000").expect("parses") >= MARK_CONTRAST,
            "the fixture's premise: these marks pass against the background"
        );
        let mut a = plate("rule1", "#5C5C66", 0.2, 0.2, 6.0);
        if let Element::Shape(s) = &mut a {
            s.transform.x = 0.3;
        }
        let mut b = plate("rule2", "#5C5C66", 0.2, 0.2, 6.0);
        if let Element::Shape(s) = &mut b {
            s.transform.x = 0.7;
        }
        with_overlay(&mut project, vec![a, b]);
        assert!(has(&check(&project), "empty-container"));
    }

    /// Scoped to `Shape`. A static PNG that is the whole point of the frame is not an empty
    /// container, and applying this to pictures fires on the reference that motivated it.
    #[test]
    fn a_picture_is_never_an_empty_container() {
        let mut project = project_with(vec![Element::Image(bay_project::ImageElement {
            id: "still".into(),
            name: "still".into(),
            start: MediaTime::ZERO,
            duration: seconds(6.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "png".into(),
            transform: Transform::default(),
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: Default::default(),
            role: Default::default(),
        })]);
        project
            .media
            .push(MediaAsset::new("png", "still.png", "/tmp/still.png"));
        assert!(!has(&check(&project), "empty-container"));
    }

    /// The measured failure: an opening frame carrying one percent of the video's own median
    /// ink, certified by an element whose opacity at the instant measured was zero.
    #[test]
    fn an_opening_emptier_than_the_video_itself_has_no_hook() {
        let mut project = project_with(vec![shape("bed", 0.0, 20.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        if let Element::Shape(s) = &mut project.active_scene_mut().tracks.main.elements[0] {
            s.color = "#101014".into();
        }
        // A panel that is invisible for the first second and a half — the element that used to
        // certify the hook by existing.
        let mut panel = plate("panel", "#191922", 0.9, 0.38, 20.0);
        animate(
            &mut panel,
            "opacity",
            &[(0.0, 0.0), (1.55, 1.0)],
            Easing::Linear,
        );
        let mut body = Vec::new();
        for index in 0..8 {
            let mut line = text_at(&format!("line{index}"), 2.0, 18.0, 64.0);
            if let Element::Text(t) = &mut line {
                t.content = "a line of body copy that fills the frame".into();
                t.transform.y = 0.2 + index as f32 * 0.08;
            }
            body.push(line);
        }
        body.insert(0, panel);
        with_overlay(&mut project, body);

        let report = check(&project);
        assert!(has(&report, "no-hook"), "{:?}", codes(&report));
        assert!(report.stats.hook_ink < report.stats.median_frame_ink * HOOK_INK_SHARE);
    }

    /// A headline at the top carries the frame, and the check stays quiet. The same absolute
    /// ink would fire on an explainer whose whole idiom is an empty frame; the ratio does not.
    #[test]
    fn an_opening_carrying_the_videos_own_weight_is_a_hook() {
        let mut project = project_with(vec![shape("bed", 0.0, 20.0)]);
        project.settings.background = Background::Color {
            color: "#0E0E12".into(),
        };
        if let Element::Shape(s) = &mut project.active_scene_mut().tracks.main.elements[0] {
            s.color = "#101014".into();
        }
        let mut hook = text_at("hook", 0.0, 4.0, 200.0);
        if let Element::Text(t) = &mut hook {
            t.content = "Every wick is a lie".into();
            t.role = ElementRole::Hook;
        }
        let mut later = text_at("body", 5.0, 15.0, 48.0);
        if let Element::Text(t) = &mut later {
            t.content = "the rest of the video".into();
        }
        with_overlay(&mut project, vec![hook, later]);
        assert!(!has(&check(&project), "no-hook"));
    }

    /// A full-frame plate is the ground the video is composed on, not content. If it counted,
    /// every one of the three videos would have passed the hook check on the strength of it.
    #[test]
    fn a_full_frame_ground_does_not_count_as_a_hook() {
        let project = project_with(vec![shape("ground", 0.0, 10.0)]);
        let report = check(&project);
        assert!(has(&report, "no-hook"), "{:?}", codes(&report));
        assert_eq!(report.stats.hook_ink, 0.0);
    }

    /// An opening of one grey kicker on a plate, which is the first two seconds of the worst of
    /// the three: the kicker does not read against the plate it sits on, so no ink is on the
    /// frame at all.
    #[test]
    fn an_opening_of_only_unreadable_kicker_type_has_no_hook() {
        let project = scene_of(vec![text_at("kicker", 0.0, 2.0, 40.0)]);
        let report = check(&project);
        assert!(
            message(&report, "no-hook").contains("nothing on it reads"),
            "{:?}",
            codes(&report)
        );
    }

    /// A timeline that ends before the hook instant cannot be measured, and the report says so
    /// rather than passing it.
    #[test]
    fn a_timeline_shorter_than_the_hook_instant_is_a_skip() {
        let project = project_with(vec![shape("flash", 0.0, 0.2)]);
        let report = check(&project);
        assert!(!has(&report, "no-hook"));
        assert!(
            report.skipped.iter().any(|skip| skip.code == "no-hook"),
            "{:?}",
            report.skipped
        );
    }

    /// A blurred background has no colour, so the three contrast checks have nothing to measure
    /// against — and must say so rather than return quietly.
    #[test]
    fn a_blurred_background_makes_the_contrast_checks_unevaluated() {
        let mut project = project_with(vec![plate("panel", "#191922", 0.9, 0.38, 10.0)]);
        project.settings.background = Background::Blur {
            blur_intensity: 0.5,
        };
        let report = check(&project);
        let skipped: Vec<&str> = report.skipped.iter().map(|skip| skip.code).collect();
        assert!(skipped.contains(&"dead-plate"), "{skipped:?}");
        assert!(skipped.contains(&"empty-container"), "{skipped:?}");
        assert!(skipped.contains(&"no-hook"), "{skipped:?}");
        assert!(!has(&report, "dead-plate"));
    }

    // ---------------------------------------------------------------------- the one-liners

    /// `BackOut` peaks at 1.10005. On a bar whose height is its value, that draws 110 % of the
    /// number for a quarter of a second — which is the measured defect, on the element it was
    /// measured on: a rect eased into place on `scaleY`.
    #[test]
    fn an_overshooting_curve_on_a_bar_draws_data_nobody_has() {
        let mut bar = plate("bar", "#FF5B5B", 0.2, 0.1, 4.0);
        animate(
            &mut bar,
            "scaleY",
            &[(0.0, 0.0), (0.5, 0.4)],
            Easing::BackOut,
        );
        let report = check(&project_with(vec![bar]));
        let found = message(&report, "value-overshoot");
        assert!(found.contains("110.0%"), "{found}");
        assert!(found.contains("spring-out"), "{found}");
    }

    /// The same curve on a title popping in is a pop. It may be cheap; it is not a false
    /// statement about a number, and a check that cannot tell the two apart fires on the wrong
    /// one.
    #[test]
    fn an_overshooting_pop_on_a_title_is_not_a_value_overshoot() {
        let mut headline = title("head", "Hello", 96.0, Transform::default());
        animate(
            &mut headline,
            "scale",
            &[(0.0, 0.8), (0.9, 1.0)],
            Easing::BackOut,
        );
        assert!(!has(
            &check(&project_with(vec![headline])),
            "value-overshoot"
        ));
    }

    /// Declaring the role is what extends it to a channel that is not a one-axis stretch.
    #[test]
    fn a_data_role_carries_the_rule_onto_any_scale_channel() {
        let mut dot = plate("dot", "#FF5B5B", 0.1, 0.1, 4.0);
        if let Element::Shape(s) = &mut dot {
            s.role = ElementRole::Data;
        }
        animate(
            &mut dot,
            "scale",
            &[(0.0, 0.1), (0.5, 0.5)],
            Easing::BackOut,
        );
        assert!(has(&check(&project_with(vec![dot])), "value-overshoot"));
    }

    /// `spring-out` is critically damped and provably monotone, which is why it is the escape.
    #[test]
    fn spring_out_never_overshoots() {
        assert_eq!(overshoot_of(Easing::SpringOut), None);
        assert_eq!(overshoot_of(Easing::EaseOut), None);
        assert!(overshoot_of(Easing::BackOut).is_some());
    }

    /// A cut half a frame from where it was asked for is not the cut that was authored.
    #[test]
    fn times_that_do_not_land_on_a_frame_are_reported() {
        let project = project_with(vec![shape("a", 0.0, 2.0), text_at("b", 2.0134, 3.0, 96.0)]);
        let report = check(&project);
        assert!(
            message(&report, "off-grid").contains("30.00 fps"),
            "{:?}",
            codes(&report)
        );
    }

    #[test]
    fn a_timeline_on_the_grid_is_not_reported() {
        let project = project_with(vec![shape("a", 0.0, 2.0), shape("b", 2.0, 3.0)]);
        assert!(!has(&check(&project), "off-grid"));
    }

    /// Three-frame moves are received as cuts. Under a tenth of the project they are accents;
    /// over it they are the motion vocabulary.
    #[test]
    fn a_project_of_three_frame_moves_is_off_grid() {
        let captions = (0..10)
            .map(|index| {
                let mut caption = text_at(&format!("c{index}"), index as f64, 1.0, 96.0);
                animate(
                    &mut caption,
                    "opacity",
                    &[(0.0, 0.0), (0.1, 1.0)],
                    Easing::EaseOut,
                );
                caption
            })
            .collect();
        let report = check(&scene_of(captions));
        assert!(
            message(&report, "off-grid").contains("under 4 frames"),
            "{:?}",
            codes(&report)
        );
    }

    /// "All of it" is three words and nine characters: it reads in 1.1s and it is on screen for
    /// a third of that.
    #[test]
    fn text_that_leaves_before_it_can_be_read_is_reported() {
        let mut line = text_at("line", 1.0, 0.36, 96.0);
        if let Element::Text(t) = &mut line {
            t.content = "All of it".into();
        }
        let report = check(&scene_of(vec![line]));
        assert!(
            message(&report, "unreadable-dwell").contains("1.10s"),
            "{:?}",
            codes(&report)
        );
    }

    /// Dwell is measured over the time it is *legible*, not over its duration. An element
    /// parked on the timeline for ten seconds at 8 % opacity has been read by nobody.
    #[test]
    fn a_line_held_at_eight_percent_opacity_has_not_been_read() {
        let mut line = text_at("line", 1.0, 10.0, 96.0);
        if let Element::Text(t) = &mut line {
            t.content = "All of it".into();
            t.transform.opacity = 0.08;
        }
        assert!(has(&check(&scene_of(vec![line])), "unreadable-dwell"));
    }

    /// bay's own captions are timed by `bay_speech`, which enforces its own floor. A check that
    /// fires on the tool's output reports bay's house style as the agent's mistake, and those
    /// are the findings that teach an agent to stop reading the report.
    #[test]
    fn a_caption_is_not_the_authors_dwell_to_answer_for() {
        let mut caption = text_at("caption-1", 1.0, 0.36, 96.0);
        if let Element::Text(t) = &mut caption {
            t.content = "All of it".into();
            t.source = ElementSource::Tool;
        }
        assert!(!has(&check(&scene_of(vec![caption])), "unreadable-dwell"));
    }

    /// Hand-keyed motion stays reachable and stops being anonymous — the registry's own audit,
    /// surfaced with the element that went around it.
    #[test]
    fn hand_keyed_motion_is_named_in_the_report() {
        let mut element = text_at("t", 0.0, 4.0, 96.0);
        animate(
            &mut element,
            "x",
            &[(0.0, 0.1), (1.7, 0.9)],
            Easing::SineInOut,
        );
        let report = check(&scene_of(vec![element]));
        assert!(
            has(&report, moves::OffVocabularyMotion::CODE),
            "{:?}",
            codes(&report)
        );
    }

    // ------------------------------------------------------------------------------- beats

    /// **The test that keeps the `spans()` disaster from coming back.**
    ///
    /// The exact shape that broke it: one clip on the main lane and the whole composition on
    /// overlays, which is what every project bay has produced looks like. The old derivation
    /// returned a single 62-second bucket for this and four checks went quiet for two rounds. No
    /// derivation here may return fewer than `floor(duration / 8)` beats, whatever the tracks
    /// look like, because the last fallback is a clock and a clock cannot be collapsed.
    #[test]
    fn the_beat_derivation_cannot_collapse_to_one_bucket() {
        let mut project = project_with(vec![shape("one-long-clip", 0.0, 62.0)]);
        let overlay = (0..40)
            .map(|index| text_at(&format!("t{index}"), index as f64 * 1.5, 1.2, 64.0))
            .collect();
        with_overlay(&mut project, overlay);
        let beats = beats(project.active_scene());
        assert!(
            beats.starts.len() >= 7,
            "{} beats from {:?}: a 62s timeline cannot address itself as one bucket",
            beats.starts.len(),
            beats.derivation
        );
    }

    /// What the author said out loud comes first: a narration clip starting is a new thing being
    /// said, and a marker is a beat declared by hand.
    #[test]
    fn narration_starts_and_markers_are_where_the_beats_are() {
        let mut project = project_with(vec![shape("ground", 0.0, 30.0)]);
        with_audio(
            &mut project,
            vec![
                speech("line1", 0.0, 7.0),
                speech("line2", 8.0, 6.0),
                speech("line3", 20.0, 6.0),
                sound("bed", 0.0, 30.0, 0.2),
            ],
        );
        project
            .active_scene_mut()
            .markers
            .push(bay_project::Marker {
                id: "m".into(),
                time: seconds(15.0),
                label: "payoff".into(),
            });
        let beats = beats(project.active_scene());
        assert_eq!(beats.derivation, "cues");
        assert_eq!(beats.starts, vec![0.0, 8.0, 15.0, 20.0]);
        // The bed is not a cue: only speech and markers say where a beat is.
        assert_eq!(beats.end_seconds, 30.0);
    }

    /// With nothing said and nothing marked, a change of what is on screen that holds for four
    /// seconds is a beat.
    #[test]
    fn a_stage_that_holds_is_a_beat() {
        let project = project_with(vec![
            shape("a", 0.0, 10.5),
            shape("b", 10.5, 10.0),
            shape("c", 20.5, 9.6),
        ]);
        let beats = beats(project.active_scene());
        assert_eq!(beats.derivation, "stage");
        assert_eq!(beats.starts, vec![0.0, 10.5, 20.5]);
    }

    /// And a flicker is not. A card that appears for a second and leaves does not restructure
    /// the video around itself.
    #[test]
    fn a_stage_that_does_not_hold_is_not_a_beat() {
        let mut project = project_with(vec![shape("held", 0.0, 30.0)]);
        with_overlay(&mut project, vec![shape("flash", 12.0, 1.0)]);
        let beats = beats(project.active_scene());
        assert_eq!(
            beats.derivation, "fixed",
            "two one-second flickers are not a structure: {:?}",
            beats.starts
        );
    }

    /// The report carries its own beats, because a finding that says "beat 4" is unreadable
    /// without the table that says where beat 4 is.
    #[test]
    fn the_report_publishes_the_beats_its_findings_are_addressed_in() {
        let mut project = project_with(vec![shape("ground", 0.0, 30.0)]);
        with_audio(
            &mut project,
            vec![
                speech("line1", 0.0, 7.0),
                speech("line2", 9.0, 6.0),
                speech("line3", 20.0, 6.0),
            ],
        );
        let report = check(&project);
        assert_eq!(report.stats.beats.derivation, "cues");
        assert_eq!(report.stats.beats.starts, vec![0.0, 9.0, 20.0]);
        assert_eq!(report.stats.beats.end_seconds, 30.0);
    }

    /// Eight-second windows are eight seconds long by construction. Measuring their ratio would
    /// report the clock as the video's tempo, and every project bay has made would fail it.
    #[test]
    fn the_tempo_check_never_measures_the_clock() {
        // 24s of one unchanging stage: three fixed beats of exactly 8s, a 1.00× ratio.
        let project = project_with(vec![shape("held", 0.0, 24.0)]);
        let derived = beats(project.active_scene());
        assert_eq!(derived.derivation, "fixed");
        assert_eq!(derived.lengths(), vec![8.0, 8.0, 8.0]);
        assert!(!has(&check(&project), "monotone-duration"));
    }

    /// A long video that never says where its beats are gets a note — and only a note. No MCP
    /// tool creates a scene and `export_video` takes one, so an error here bricks every session.
    #[test]
    fn a_long_video_with_no_declared_beats_is_a_note_not_an_error() {
        let project = project_with(vec![shape("held", 0.0, 24.0)]);
        let report = check(&project);
        let found = report
            .findings
            .iter()
            .find(|f| f.code == "one-scene")
            .unwrap_or_else(|| panic!("{:?}", codes(&report)));
        assert_eq!(found.severity, Severity::Note);
        assert!(found.message.contains("marker_add"), "{}", found.message);
        assert_eq!(report.errors, 0, "one scene must not block a render");
    }

    /// And a short one does not get it at all: a title card is not missing a structure.
    #[test]
    fn a_short_video_is_not_told_to_declare_beats() {
        assert!(!has(
            &check(&project_with(vec![shape("held", 0.0, 8.0)])),
            "one-scene"
        ));
    }

    // -------------------------------------------------------------------------- continuity

    /// Eight full-bleed cards, one word each, nothing shared between them. It passes essentially
    /// every other rule in this file for about forty tool calls and zero design decisions, and it
    /// is a Canva carousel. This is the rule that says so.
    fn carousel() -> Project {
        // Eight unrelated words on purpose: the cards share no content either, so this fixture
        // measures the one thing it is named for.
        const SAID: [&str; 8] = [
            "latency",
            "throughput",
            "storage",
            "bandwidth",
            "caching",
            "routing",
            "failover",
            "recovery",
        ];
        let (mut cards, mut words) = (Vec::new(), Vec::new());
        for (index, said) in SAID.iter().enumerate() {
            let start = index as f64 * 6.0;
            let mut card = plate(&format!("card{index}"), "#123456", 1.0, 1.0, 6.0);
            card.set_start(seconds(start));
            cards.push(card);
            let mut word = text_at(&format!("word{index}"), start, 6.0, 160.0);
            if let Element::Text(t) = &mut word {
                t.content = (*said).into();
            }
            words.push(word);
        }
        let mut project = project_with(cards);
        with_overlay(&mut project, words);
        project
    }

    fn transcript_cut_project() -> Project {
        let mut clips = Vec::new();
        let mut speech = Vec::new();
        for (index, source_start) in [10.0, 20.0, 30.0].into_iter().enumerate() {
            let timeline_start = index as f64 * 4.0;
            clips.push(Element::Video(VideoElement {
                id: format!("video-{index}"),
                name: format!("video-{index}"),
                start: seconds(timeline_start),
                duration: seconds(4.0),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "interview".into(),
                trim_start: seconds(source_start),
                trim_end: seconds(source_start + 4.0),
                speed: 1.0,
                freeze: None,
                transform: Transform::default(),
                effects: Vec::new(),
                animations: Default::default(),
                blend_mode: Default::default(),
                mask: None,
                source: ElementSource::Author,
                role: Default::default(),
            }));
            let mut audio = sound(&format!("speech-{index}"), timeline_start, 4.0, 1.0);
            if let Element::Audio(audio) = &mut audio {
                audio.media_id = "interview".into();
                audio.trim_start = seconds(source_start);
                audio.source = ElementSource::Tool;
                audio.role = bay_project::AudioRole::Speech;
            }
            speech.push(audio);
        }
        let mut project = project_with(clips);
        with_audio(&mut project, speech);
        project.media.clear();
        let mut asset = MediaAsset::new("interview", "interview.mp4", "/tmp/interview.mp4");
        asset.duration_seconds = Some(40.0);
        asset.transcript = Some(bay_project::Transcript {
            language: "en".into(),
            model: "test".into(),
            duration_seconds: 40.0,
            words: [10.0, 20.0, 30.0]
                .into_iter()
                .map(|start| bay_project::TranscriptWord {
                    text: "word".into(),
                    start_seconds: start,
                    end_seconds: start + 4.0,
                    confidence: 1.0,
                    speaker: None,
                })
                .collect(),
            utterances: Vec::new(),
        });
        project.media.push(asset);
        project
    }

    /// The transcript tool's butted A/V clips are one editorial stream. A hard jump in source
    /// time is intentional here; requiring a graphic element to animate across it misclassifies
    /// ordinary dialogue editing as a carousel.
    #[test]
    fn transcript_aligned_av_splices_are_not_broken_composition_seams() {
        let project = transcript_cut_project();
        let report = check(&project);
        assert_eq!(
            count(&report, "broken-continuity"),
            0,
            "{:?}",
            report.findings
        );
    }

    /// A transcript splice cannot launder an unrelated card swap above the footage. Once the
    /// outgoing video is removed from the continuity arithmetic, the authored replacement still
    /// occupies the whole remaining composition and must be caught.
    #[test]
    fn transcript_splices_do_not_exempt_a_graphics_carousel_on_top() {
        let mut project = transcript_cut_project();
        let cards = (0..3)
            .map(|index| {
                let mut card = plate(&format!("card-{index}"), "#123456", 1.0, 1.0, 4.0);
                card.set_start(seconds(index as f64 * 4.0));
                card
            })
            .collect();
        with_overlay(&mut project, cards);
        assert_eq!(
            count(&check(&project), "broken-continuity"),
            2,
            "both unrelated card replacements remain broken"
        );
    }

    #[test]
    fn eight_unrelated_cards_are_a_carousel() {
        let report = check(&carousel());
        assert_eq!(
            report.stats.beats.starts.len(),
            8,
            "{:?}",
            report.stats.beats
        );
        assert_eq!(
            count(&report, "broken-continuity"),
            7,
            "every seam is broken: {:?}",
            report.findings
        );
        assert!(
            message(&report, "broken-continuity").contains("no element in common"),
            "{}",
            message(&report, "broken-continuity")
        );
    }

    /// One element carried across every seam, moving as it goes, and the carousel becomes a
    /// video. **Passing reduces element count**, which is the point: 188 elements were not a
    /// success, they were eight beats rebuilt from scratch.
    ///
    /// A quarter of the canvas, and it changes state four times rather than sliding once — see
    /// [`one_small_element_drifting_across_the_video_does_not_carry_a_carousel`] for the version
    /// of this test that used to pass and is now the escape it was closing.
    #[test]
    fn an_element_carried_through_the_seams_clears_them() {
        let mut project = carousel();
        let mut lockup = plate("lockup", "#FFFFFF", 0.25, 0.25, 48.0);
        animate(
            &mut lockup,
            "x",
            &[(0.0, 0.15), (16.0, 0.55), (32.0, 0.2), (48.0, 0.7)],
            Easing::Linear,
        );
        project.active_scene_mut().tracks.overlay[0]
            .elements
            .push(lockup);
        let report = check(&project);
        assert!(
            !has(&report, "broken-continuity"),
            "{:?}",
            report
                .findings
                .iter()
                .filter(|f| f.code == "broken-continuity")
                .collect::<Vec<_>>()
        );
    }

    /// **The one-element escape, closed.** A rectangle at one percent of the canvas, on for the
    /// whole timeline, drifting linearly from one edge to the other: one `add_shape` and one
    /// `animate`, and the version of this rule that shipped counted it at all seven seams of a
    /// carousel. Drift is ambient liveness — it is never *at* a seam, it is only ever passing
    /// through one — and something that small was never part of the composition to begin with.
    #[test]
    fn one_small_element_drifting_across_the_video_does_not_carry_a_carousel() {
        let mut project = carousel();
        let mut sprinkle = plate("sprinkle", "#FFFFFF", 0.1, 0.1, 48.0);
        animate(
            &mut sprinkle,
            "x",
            &[(0.0, 0.02), (48.0, 0.5)],
            Easing::Linear,
        );
        project.active_scene_mut().tracks.overlay[0]
            .elements
            .push(sprinkle);
        assert_eq!(
            count(&check(&project), "broken-continuity"),
            7,
            "a drifting sprinkle is not what holds a video together"
        );
    }

    /// **Accumulation is continuity.** Cards that arrive and never leave, each holding still
    /// once it has landed — the reference explainer's whole idiom, and the shape the first form
    /// of this rule condemned eleven times out of thirteen. Nothing is replaced at any seam, so
    /// there is no state change for anything to have to survive.
    #[test]
    fn a_composition_that_only_accumulates_carries_every_seam() {
        let mut project = carousel();
        // The same eight cards and eight words, except nothing ever leaves.
        {
            let scene = project.active_scene_mut();
            for element in &mut scene.tracks.main.elements {
                let start = element.start();
                element.set_duration(seconds(48.0) - start);
            }
            for element in &mut scene.tracks.overlay[0].elements {
                let start = element.start();
                element.set_duration(seconds(48.0) - start);
            }
        }
        let report = check(&project);
        assert!(
            !has(&report, "broken-continuity"),
            "{:?}",
            report
                .findings
                .iter()
                .filter(|f| f.code == "broken-continuity")
                .collect::<Vec<_>>()
        );
    }

    /// **A fade is not carrying an element through.** The same lockup, present at every seam,
    /// doing nothing but changing how transparent it is. 104 of the 106 opacity channels in the
    /// video this comes from start at zero — if opacity counted, that video would pass by
    /// construction and so would every carousel with a pulsing background.
    #[test]
    fn a_fade_does_not_carry_an_element_through_a_seam() {
        let mut project = carousel();
        let mut lockup = plate("lockup", "#FFFFFF", 0.1, 0.1, 48.0);
        animate(
            &mut lockup,
            "opacity",
            &[(0.0, 0.3), (24.0, 1.0), (48.0, 0.3)],
            Easing::Linear,
        );
        project.active_scene_mut().tracks.overlay[0]
            .elements
            .push(lockup);
        let report = check(&project);
        assert_eq!(
            count(&report, "broken-continuity"),
            7,
            "{:?}",
            report.findings
        );
        assert!(
            message(&report, "broken-continuity").contains("do not move, scale or turn"),
            "{}",
            message(&report, "broken-continuity")
        );
    }

    /// Beats a clock invented are not seams. A locked composition holding one stage for
    /// twenty-four seconds is a single take, and cutting it every eight seconds to complain that
    /// nothing crosses the cut would condemn the one form this rule exists to reward.
    #[test]
    fn a_clock_derived_beat_is_not_a_seam_and_the_report_says_so() {
        let report = check(&project_with(vec![shape("held", 0.0, 24.0)]));
        assert!(!has(&report, "broken-continuity"));
        assert!(
            report
                .skipped
                .iter()
                .any(|skip| skip.code == "broken-continuity"),
            "{:?}",
            report.skipped
        );
    }

    /// Two states of one piece of content, rebuilt instead of transformed: the same word, a
    /// different element in each beat. Manim calls the correct move `TransformMatchingTex`; the
    /// wrong one is a cross-fade, and a cross-fade between states that share their content
    /// asserts they are unrelated pictures.
    fn two_states(first: &str, second: &str, second_id: &str) -> Project {
        let mut project = project_with(vec![shape("ground", 0.0, 24.0)]);
        project
            .active_scene_mut()
            .markers
            .push(bay_project::Marker {
                id: "m1".into(),
                time: seconds(8.0),
                label: String::new(),
            });
        project
            .active_scene_mut()
            .markers
            .push(bay_project::Marker {
                id: "m2".into(),
                time: seconds(16.0),
                label: String::new(),
            });
        // Something that really is carried across both seams, so the first half of the rule is
        // satisfied and the token half is what the test is measuring. Big enough to be part of
        // the picture and moving *at* the seams rather than drifting across the whole video —
        // neither of which the first form of the rule asked for.
        let mut anchor = plate("anchor", "#FFFFFF", 0.3, 0.3, 24.0);
        animate(
            &mut anchor,
            "y",
            &[(7.0, 0.2), (9.0, 0.6), (15.0, 0.6), (17.0, 0.25)],
            Easing::Linear,
        );

        let mut before = text_at("state-a", 0.0, 8.0, 96.0);
        if let Element::Text(t) = &mut before {
            t.content = first.into();
        }
        let mut after = text_at(second_id, 8.0, 16.0, 96.0);
        if let Element::Text(t) = &mut after {
            t.content = second.into();
        }
        with_overlay(&mut project, vec![anchor, before, after]);
        project
    }

    #[test]
    fn a_word_rebuilt_as_a_new_element_across_a_seam_is_reported() {
        let project = two_states("market close friday", "market close monday", "state-b");
        let report = check(&project);
        let found = message(&report, "broken-continuity");
        assert!(found.contains("words in common"), "{found}");
        assert!(found.contains("state-a"), "{found}");
        assert!(found.contains("state-b"), "{found}");
    }

    /// The same two states with the words carried by one element that survives the seam. This is
    /// the passing form, and it is one element rather than two.
    #[test]
    fn a_word_carried_by_the_same_element_is_not_reported() {
        let mut project = two_states("market close friday", "market close monday", "state-b");
        // `state-a` now spans both beats, so the shared words are the same element in each.
        let overlay = &mut project.active_scene_mut().tracks.overlay[0].elements;
        overlay[1].set_duration(seconds(24.0));
        assert!(!has(&check(&project), "broken-continuity"));
    }

    /// One word in common between two beats of a twenty-four second video is a coincidence, not a
    /// correspondence. Firing on it would make the rule a word-frequency check.
    #[test]
    fn one_word_in_common_is_not_a_correspondence() {
        let project = two_states("market opens early", "supply chain market", "state-b");
        assert!(!has(&check(&project), "broken-continuity"));
    }

    // ------------------------------------------------------------------- the pacing window

    /// **The sprinkle, closed.** Round 1 asked for a spread of move durations and got 76 moves at
    /// 0.098 s and one at 11.7 s: a 454× ratio over the project, and every single moment of the
    /// video still running at one speed. Measured per five-second window, one long move somewhere
    /// else rescues only the window it is in.
    #[test]
    fn one_long_move_does_not_buy_a_project_a_vocabulary() {
        let mut elements = Vec::new();
        for index in 0..60 {
            let mut line = text_at(&format!("t{index}"), index as f64 * 0.5, 2.0, 64.0);
            animate(
                &mut line,
                "y",
                &[(0.0, 0.2), (0.1, 0.5)],
                if index % 3 == 0 {
                    Easing::EaseOut
                } else {
                    Easing::ExpoOut
                },
            );
            elements.push(line);
        }
        // The sprinkle: one eleven-second move, which clears the whole-project ratio outright.
        let mut slow = text_at("slow", 0.0, 30.0, 64.0);
        animate(&mut slow, "x", &[(0.0, 0.2), (11.7, 0.8)], Easing::EaseOut);
        elements.push(slow);

        let project = scene_of(elements);
        let report = check(&project);
        let found = report
            .findings
            .iter()
            .find(|f| f.code == "monotone-duration" && f.message.contains("windows"))
            .unwrap_or_else(|| panic!("the sprinkle must not pass: {:?}", codes(&report)));
        assert!(found.message.contains("at one speed"), "{}", found.message);
    }

    /// And a project whose moves really do vary inside each window is left alone.
    #[test]
    fn moves_that_vary_within_each_window_are_not_reported() {
        let mut elements = Vec::new();
        let lengths = [0.18, 0.42, 0.9, 1.6, 0.3, 0.65];
        for index in 0..60 {
            let mut line = text_at(&format!("t{index}"), index as f64 * 0.5, 2.0, 64.0);
            animate(
                &mut line,
                "y",
                &[(0.0, 0.2), (lengths[index % lengths.len()], 0.5)],
                Easing::EaseOut,
            );
            elements.push(line);
        }
        let report = check(&scene_of(elements));
        assert!(
            !report
                .findings
                .iter()
                .any(|f| f.code == "monotone-duration" && f.message.contains("windows")),
            "{:?}",
            report.findings
        );
    }

    /// The whole pass has to be cheap enough to run before every render. It was bypassed once
    /// already — two calls in 455 — and a rule nobody runs is worth nothing.
    #[test]
    fn a_long_timeline_checks_in_well_under_a_frame() {
        let mut elements = Vec::new();
        for index in 0..200 {
            let mut element = text_at(&format!("t{index}"), index as f64 * 0.3, 6.0, 48.0);
            if let Element::Text(t) = &mut element {
                t.content = format!("line number {index} of the timeline");
                t.transform.y = 0.1 + (index % 8) as f32 * 0.1;
            }
            animate(
                &mut element,
                "opacity",
                &[(0.0, 0.0), (0.4, 1.0)],
                Easing::EaseOut,
            );
            elements.push(element);
        }
        let project = scene_of(elements);
        let started = std::time::Instant::now();
        let report = check(&project);
        let elapsed = started.elapsed();
        assert!(
            elapsed.as_millis() < 250,
            "check took {elapsed:?} on a 66s timeline"
        );
        assert!(report.total > 0);
    }

    #[test]
    fn arrivals_without_any_incumbent_response_are_reported() {
        let mut elements = Vec::new();
        for index in 0..5 {
            let at = 2.0 + index as f64 * 2.0;
            elements.push(shape(&format!("departure-{index}"), 0.0, at));
            elements.push(shape(&format!("arrival-{index}"), at, 1.0));
        }
        let project = scene_of(elements);
        let report = check(&project);
        assert!(has(&report, "no-response"), "{:?}", report.findings);
        assert!(message(&report, "no-response").contains("0 of 5"));
    }

    #[test]
    fn responses_must_be_distributed_across_more_than_one_incumbent() {
        let mut elements = Vec::new();
        for index in 0..5 {
            let at = 2.0 + index as f64 * 2.0;
            elements.push(shape(&format!("departure-{index}"), 0.0, at));
            elements.push(shape(&format!("arrival-{index}"), at, 1.0));
        }
        for (id, keys) in [
            (
                "responder-a",
                vec![(0.0, 0.2), (1.6, 0.2), (2.4, 0.3), (3.6, 0.3), (4.4, 0.4)],
            ),
            (
                "responder-b",
                vec![(0.0, 0.2), (5.6, 0.2), (6.4, 0.3), (7.6, 0.3), (8.4, 0.4)],
            ),
            (
                "responder-c",
                vec![(0.0, 0.2), (9.6, 0.2), (10.4, 0.3), (12.0, 0.3)],
            ),
        ] {
            let mut responder = shape(id, 0.0, 12.0);
            animate(&mut responder, "x", &keys, Easing::Linear);
            elements.push(responder);
        }
        let report = check(&scene_of(elements));
        assert!(!has(&report, "no-response"), "{:?}", report.findings);
    }

    #[test]
    fn duration_checks_only_the_population_that_will_ship() {
        let mut project = scene_of(vec![
            text_at("delivered", 0.0, 2.0, 64.0),
            text_at("omitted", 10.0, 2.0, 64.0),
        ]);
        if let Element::Text(text) = &mut project.active_scene_mut().tracks.overlay[0].elements[1] {
            text.content.clear();
        }
        assert!(has(&check(&project), "empty-text"));
        assert!(!has(&check_duration(&project, seconds(5.0)), "empty-text"));
    }
}
