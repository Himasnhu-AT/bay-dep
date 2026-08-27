//! What the Deliver page's form holds, and the `render` call it produces.
//!
//! It lives here rather than in `bay-ui` for the reason `pages.md` rule 4 gives: if a headless
//! test cannot reach a behaviour, it is in the wrong crate. "Which arguments does this form
//! produce, and does the engine honour every one of them?" is the whole question the Deliver
//! page has to answer, and answering it must not need a window.
//!
//! **The page has no encoder of its own.** [`DeliverSettings::render_args`] builds arguments for
//! the same `render` tool an agent calls, and the button hands them to the same
//! [`crate::slow::run`]. That is what makes the editor's Export and the MCP `render` one output
//! path rather than two, so [`bay_core::check::render_gate`] and `frame_check` cannot be
//! enforced for one caller and skipped for the other — which is exactly what they were, and is
//! entry 6 in `fixes.md`.
//!
//! The round trip is pinned by tests: every field this struct offers is read back off the
//! arguments by [`crate::slow::export_settings`] and compared. A control whose value the encoder
//! never sees is the defect the whole `fixes.md` register is about, and here it is caught by
//! construction.

use bay_preview::{ExportPreset, ExportSettings, VideoCodec};
use serde_json::{Map, Value, json};

/// AAC bitrates ffmpeg will actually take. Outside this the encoder either refuses or silently
/// clamps, and a form that offers 800 kbps and delivers 512 is a control that does not do what
/// it says.
pub const MIN_AUDIO_KBPS: u32 = 32;
pub const MAX_AUDIO_KBPS: u32 = 512;

/// CRF's own range. 0 is lossless, 51 is unwatchable; both ends are legal and neither is useful.
pub const MIN_QUALITY: u32 = 0;
pub const MAX_QUALITY: u32 = 51;

/// The section of the timeline a render covers.
///
/// Two numbers rather than a start and a length, because that is what the page draws: an in
/// point and an out point on a ruler. The conversion to what `render` wants happens in
/// [`DeliverSettings::render_args`], and the out point becomes `endSeconds` rather than
/// `duration` — see [`crate::slow`] for why those are different arguments.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Range {
    /// Everything. The default, and the only range most renders want.
    Whole,
    /// From `start` to `end`, in timeline seconds.
    InOut { start: f64, end: f64 },
}

impl Range {
    pub fn start(self) -> f64 {
        match self {
            Range::Whole => 0.0,
            Range::InOut { start, .. } => start.max(0.0),
        }
    }

    /// The out point, or `None` for "to the end of the timeline".
    pub fn end(self) -> Option<f64> {
        match self {
            Range::Whole => None,
            Range::InOut { end, .. } => Some(end),
        }
    }

    /// How long the file will be, given how long the timeline is.
    ///
    /// `None` when the range is empty or inverted — which is what disables the Render button
    /// rather than starting a job that the engine will refuse a moment later.
    pub fn seconds(self, timeline_duration: f64) -> Option<f64> {
        let start = self.start();
        let end = self
            .end()
            .unwrap_or(timeline_duration)
            .min(timeline_duration);
        (end - start > 0.0).then_some(end - start)
    }
}

/// The Deliver page's form, as a value.
///
/// Deliberately not `bay_preview::ExportSettings`: that is what the encoder takes, and this is
/// what a person edits. The two differ in three ways that matter, all of them because a form
/// has to remember choices an encoder does not care about — which preset a field came from, an
/// out point rather than a duration, and where the file goes.
#[derive(Debug, Clone, PartialEq)]
pub struct DeliverSettings {
    /// Which named preset the fields below were last seeded from, if they still match it.
    ///
    /// Kept so the page can show "YouTube" rather than reverse-engineering it from a CRF, and
    /// dropped to `None` the moment a field is edited by hand. A preset is a starting point,
    /// never a lock — `ExportPreset`'s own doc comment says so — and a picker that keeps
    /// claiming "YouTube" after the codec has been changed underneath it is lying.
    pub preset: Option<ExportPreset>,
    pub codec: VideoCodec,
    pub quality: u32,
    /// `None` leaves the mix at whatever level the timeline summed to.
    pub loudness_lufs: Option<f64>,
    pub audio_bitrate_kbps: u32,
    pub range: Range,
    /// The output file's name without its extension — the extension follows the codec, because
    /// a ProRes stream in a `.mp4` is a file some players will refuse to open.
    pub file_stem: String,
}

impl Default for DeliverSettings {
    fn default() -> Self {
        Self::from_preset(ExportPreset::Social)
    }
}

impl DeliverSettings {
    /// A form seeded from a named preset.
    pub fn from_preset(preset: ExportPreset) -> Self {
        let settings = preset.settings();
        Self {
            preset: Some(preset),
            codec: settings.codec,
            quality: settings.quality,
            loudness_lufs: settings.loudness_lufs,
            audio_bitrate_kbps: settings.audio_bitrate_kbps,
            range: Range::Whole,
            file_stem: "bay-export".to_string(),
        }
    }

    /// Re-seed every encode field from `preset`, leaving the range and the filename alone.
    ///
    /// Picking a preset must not move the in and out points: those are a statement about the
    /// film, not about the delivery target.
    pub fn apply_preset(&mut self, preset: ExportPreset) {
        let settings = preset.settings();
        self.preset = Some(preset);
        self.codec = settings.codec;
        self.quality = settings.quality;
        self.loudness_lufs = settings.loudness_lufs;
        self.audio_bitrate_kbps = settings.audio_bitrate_kbps;
    }

    /// Edit one encode field by hand. The preset label goes with it.
    pub fn customise(&mut self, edit: impl FnOnce(&mut Self)) {
        edit(self);
        self.preset = None;
        self.clamp();
    }

    fn clamp(&mut self) {
        self.quality = self.quality.clamp(MIN_QUALITY, MAX_QUALITY);
        self.audio_bitrate_kbps = self
            .audio_bitrate_kbps
            .clamp(MIN_AUDIO_KBPS, MAX_AUDIO_KBPS);
        if let Some(target) = self.loudness_lufs {
            self.loudness_lufs = Some(target.clamp(-40.0, 0.0));
        }
    }

    /// Whether the quality control means anything for the codec currently chosen.
    ///
    /// ProRes is quality-fixed by its profile: `quality` reaches
    /// `VideoCodec::encoder_args` and is dropped on the floor. So the slider is **drawn and
    /// disabled** rather than hidden — `pages.md` rule 2 — because a CRF slider that moves and
    /// changes nothing about the file is precisely the defect this page exists to not be.
    pub fn quality_applies(&self) -> bool {
        !matches!(self.codec, VideoCodec::ProRes)
    }

    /// The container this codec belongs in.
    pub fn extension(&self) -> &'static str {
        match self.codec {
            VideoCodec::ProRes => "mov",
            VideoCodec::H264 | VideoCodec::Hevc => "mp4",
        }
    }

    /// The file this render writes, inside `directory`.
    pub fn output_path(&self, directory: &std::path::Path) -> std::path::PathBuf {
        let stem = self.file_stem.trim();
        let stem = if stem.is_empty() { "bay-export" } else { stem };
        directory.join(format!("{stem}.{}", self.extension()))
    }

    /// The file's name as the page prints it.
    pub fn file_name(&self) -> String {
        let stem = self.file_stem.trim();
        let stem = if stem.is_empty() { "bay-export" } else { stem };
        format!("{stem}.{}", self.extension())
    }

    /// Why this form cannot be rendered yet, or `None` if it can.
    ///
    /// The Render button reads this: a button that starts a job the engine refuses a second
    /// later has told the user nothing they could not have been told before they pressed it.
    pub fn refusal(&self, timeline_duration: f64) -> Option<String> {
        if timeline_duration <= 0.0 {
            return Some(
                "there is nothing on the timeline to render — add an element first".to_string(),
            );
        }
        if self.range.seconds(timeline_duration).is_none() {
            return Some(format!(
                "the out point ({:.2}s) is not after the in point ({:.2}s), so there is nothing \
                 between them to encode",
                self.range.end().unwrap_or(timeline_duration),
                self.range.start()
            ));
        }
        None
    }

    /// The arguments for a `render` call. The same ones an agent would send.
    ///
    /// Every encode field is written out explicitly rather than as a `preset` name, because the
    /// form's values *are* the answer by the time it is pressed — the preset was only where they
    /// started. Writing `{"preset": "youtube"}` after the user has changed the codec would send
    /// the encoder the preset's codec and not theirs.
    pub fn render_args(&self, path: &std::path::Path) -> Value {
        let mut args = Map::new();
        args.insert("path".into(), json!(path.to_string_lossy()));
        args.insert("codec".into(), json!(self.codec.wire_name()));
        // Sent even for ProRes, which ignores it. Omitting it there would make the round-trip
        // test pass for the wrong reason: the point is that what the form shows is what the
        // encoder is told, and what the encoder does with it is the encoder's business.
        args.insert("quality".into(), json!(self.quality));
        args.insert(
            "loudness".into(),
            match self.loudness_lufs {
                Some(target) => json!(target),
                None => json!(false),
            },
        );
        args.insert(
            "audioBitrateKbps".into(),
            json!(
                self.audio_bitrate_kbps
                    .clamp(MIN_AUDIO_KBPS, MAX_AUDIO_KBPS)
            ),
        );
        if self.range.start() > 0.0 {
            args.insert("startSeconds".into(), json!(self.range.start()));
        }
        // An out point, never a bare `duration`: `duration` is guarded against dropping the
        // tail of the timeline, and dragging an out point is asking for exactly that.
        if let Some(end) = self.range.end() {
            args.insert("endSeconds".into(), json!(end));
        }
        Value::Object(args)
    }

    /// What the encoder will actually be given — the form resolved through the same parser the
    /// wire uses, so a page can print it without a second implementation to drift.
    pub fn resolved(&self) -> Result<ExportSettings, String> {
        crate::slow::export_settings(&self.render_args(std::path::Path::new("/dev/null")))
    }
}

/// One render in the queue, as the Deliver page needs it.
///
/// A projection of [`bay_jobs`], not a second registry. That registry is process-global, so the
/// queue on screen contains renders an agent started over MCP as well as ones a person started
/// by pressing the button — which is the visible half of the two paths having become one.
#[derive(Debug, Clone, PartialEq)]
pub struct QueuedRender {
    pub id: bay_jobs::JobId,
    /// The output path the render was started with.
    pub label: String,
    pub message: String,
    /// 0.0 to 1.0, or `None` while the frame count is not yet known. A render reports frames,
    /// so this becomes `Some` as soon as the first frame is encoded.
    pub fraction: Option<f32>,
    pub finished: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

impl QueuedRender {
    /// Whether asking this job to stop would do anything.
    pub fn can_cancel(&self) -> bool {
        !self.finished && !self.cancelled
    }
}

/// Every render this process knows about, newest last.
///
/// Filtered by `kind` rather than by who started it: an install and a narration are jobs too,
/// and a Deliver queue listing a Kokoro download would be a different page.
pub fn queue() -> Vec<QueuedRender> {
    bay_jobs::all()
        .into_iter()
        .filter(|state| state.kind == "render")
        .map(|state| QueuedRender {
            id: state.id,
            label: state.label.clone(),
            message: state.message.clone(),
            fraction: state.fraction(),
            finished: state.finished,
            cancelled: state.cancelled,
            error: state.error.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The test this module exists for. Every field the form offers has to survive the trip
    /// through `render_args` into the settings the encoder is handed — a control the encoder
    /// never hears about is the defect the whole `fixes.md` register is about.
    #[test]
    fn every_field_the_form_offers_reaches_the_encoder() {
        let mut form = DeliverSettings::from_preset(ExportPreset::Youtube);
        form.customise(|form| {
            form.codec = VideoCodec::Hevc;
            form.quality = 26;
            form.loudness_lufs = Some(-16.0);
            form.audio_bitrate_kbps = 320;
        });

        let resolved = form
            .resolved()
            .expect("the form's own arguments must parse");
        assert_eq!(resolved.codec, VideoCodec::Hevc);
        assert_eq!(resolved.quality, 26);
        assert_eq!(resolved.loudness_lufs, Some(-16.0));
        assert_eq!(resolved.audio_bitrate_kbps, 320);
    }

    /// Loudness off is a *choice*, and `None` and "leave the default alone" are different
    /// things. Sending nothing would silently normalise a mix the user asked not to touch.
    #[test]
    fn turning_loudness_off_reaches_the_encoder_as_off() {
        let mut form = DeliverSettings::default();
        form.customise(|form| form.loudness_lufs = None);
        assert_eq!(
            form.resolved().expect("parses").loudness_lufs,
            None,
            "loudness off must survive the round trip, not fall back to -14"
        );
    }

    #[test]
    fn each_preset_reaches_the_encoder_as_itself() {
        for preset in [
            ExportPreset::Social,
            ExportPreset::Youtube,
            ExportPreset::Master,
        ] {
            let form = DeliverSettings::from_preset(preset);
            let resolved = form.resolved().expect("parses");
            let expected = preset.settings();
            assert_eq!(resolved.codec, expected.codec, "{preset:?}");
            assert_eq!(resolved.quality, expected.quality, "{preset:?}");
            assert_eq!(resolved.loudness_lufs, expected.loudness_lufs, "{preset:?}");
            assert_eq!(
                resolved.audio_bitrate_kbps, expected.audio_bitrate_kbps,
                "{preset:?}"
            );
        }
    }

    /// The disabled control this page has, and the reason it is disabled rather than hidden.
    #[test]
    fn quality_is_inert_on_prores_and_the_form_says_so() {
        let mut form = DeliverSettings::from_preset(ExportPreset::Master);
        assert_eq!(form.codec, VideoCodec::ProRes);
        assert!(
            !form.quality_applies(),
            "ProRes is quality-fixed by its profile; a live CRF slider over it would be a \
             control that changes nothing"
        );
        form.customise(|form| form.codec = VideoCodec::H264);
        assert!(form.quality_applies());
    }

    /// A ProRes stream in an `.mp4` is a file some players refuse. The extension is not a
    /// preference, it follows the codec.
    #[test]
    fn the_extension_follows_the_codec() {
        let mut form = DeliverSettings::from_preset(ExportPreset::Master);
        assert_eq!(form.file_name(), "bay-export.mov");
        form.customise(|form| form.codec = VideoCodec::H264);
        assert_eq!(form.file_name(), "bay-export.mp4");
        form.customise(|form| form.codec = VideoCodec::Hevc);
        assert_eq!(form.file_name(), "bay-export.mp4");
    }

    #[test]
    fn an_empty_filename_falls_back_rather_than_writing_a_dotfile() {
        let form = DeliverSettings {
            file_stem: "   ".into(),
            ..DeliverSettings::default()
        };
        assert_eq!(form.file_name(), "bay-export.mp4");
        assert_eq!(
            form.output_path(std::path::Path::new("/tmp")),
            std::path::PathBuf::from("/tmp/bay-export.mp4")
        );
    }

    /// Editing a field by hand drops the preset label. A picker still reading "YouTube" after
    /// the codec underneath it has changed is telling the user something untrue.
    #[test]
    fn editing_a_field_stops_the_form_claiming_a_preset() {
        let mut form = DeliverSettings::from_preset(ExportPreset::Youtube);
        assert_eq!(form.preset, Some(ExportPreset::Youtube));
        form.customise(|form| form.quality = 30);
        assert_eq!(form.preset, None);
        // And picking one again re-seeds everything.
        form.apply_preset(ExportPreset::Youtube);
        assert_eq!(form.preset, Some(ExportPreset::Youtube));
        assert_eq!(form.quality, ExportPreset::Youtube.settings().quality);
    }

    /// Picking a preset must not move the in and out points: a range is a statement about the
    /// film, and the delivery target has no opinion about it.
    #[test]
    fn a_preset_does_not_move_the_range() {
        let mut form = DeliverSettings {
            range: Range::InOut {
                start: 2.0,
                end: 6.0,
            },
            ..DeliverSettings::default()
        };
        form.apply_preset(ExportPreset::Master);
        assert_eq!(
            form.range,
            Range::InOut {
                start: 2.0,
                end: 6.0
            }
        );
    }

    /// A range becomes an out point, never a bare `duration` — `slow::render_duration` refuses
    /// a duration that stops before the end of the timeline, which is exactly what an out point
    /// is for.
    #[test]
    fn a_range_travels_as_an_out_point() {
        let form = DeliverSettings {
            range: Range::InOut {
                start: 3.0,
                end: 9.0,
            },
            ..DeliverSettings::default()
        };
        let args = form.render_args(std::path::Path::new("/tmp/a.mp4"));
        assert_eq!(args["startSeconds"], 3.0);
        assert_eq!(args["endSeconds"], 9.0);
        assert!(
            args.get("duration").is_none(),
            "a duration would be refused for dropping the tail: {args}"
        );
    }

    #[test]
    fn the_whole_timeline_sends_no_range_at_all() {
        let args = DeliverSettings::default().render_args(std::path::Path::new("/tmp/a.mp4"));
        assert!(args.get("startSeconds").is_none(), "{args}");
        assert!(args.get("endSeconds").is_none(), "{args}");
        assert!(args.get("duration").is_none(), "{args}");
    }

    #[test]
    fn a_range_reports_its_own_length_and_refuses_an_inverted_one() {
        let whole = Range::Whole;
        assert_eq!(whole.seconds(12.0), Some(12.0));

        let section = Range::InOut {
            start: 2.0,
            end: 5.0,
        };
        assert_eq!(section.seconds(12.0), Some(3.0));
        // An out point past the end of the timeline is clamped, not refused.
        assert_eq!(
            Range::InOut {
                start: 2.0,
                end: 99.0
            }
            .seconds(12.0),
            Some(10.0)
        );
        assert_eq!(
            Range::InOut {
                start: 5.0,
                end: 5.0
            }
            .seconds(12.0),
            None
        );
    }

    /// The button reads this instead of starting a job the engine refuses a moment later.
    #[test]
    fn the_form_refuses_before_a_job_is_started_rather_than_after() {
        let mut form = DeliverSettings::default();
        assert_eq!(form.refusal(10.0), None);

        let empty = form.refusal(0.0).expect("an empty timeline is refused");
        assert!(empty.contains("nothing on the timeline"), "{empty}");

        form.range = Range::InOut {
            start: 6.0,
            end: 4.0,
        };
        let inverted = form.refusal(10.0).expect("an inverted range is refused");
        assert!(inverted.contains("out point"), "{inverted}");
    }

    /// Out-of-range values are clamped where the encoder's own limits are, so the form cannot
    /// show a number the file will not have.
    #[test]
    fn the_form_clamps_to_what_the_encoder_accepts() {
        let mut form = DeliverSettings::default();
        form.customise(|form| {
            form.quality = 900;
            form.audio_bitrate_kbps = 4000;
        });
        assert_eq!(form.quality, MAX_QUALITY);
        assert_eq!(form.audio_bitrate_kbps, MAX_AUDIO_KBPS);

        form.customise(|form| form.audio_bitrate_kbps = 1);
        assert_eq!(form.audio_bitrate_kbps, MIN_AUDIO_KBPS);
    }

    /// The queue is a view of the shared registry, so a render an agent started over MCP is in
    /// it too. Two output paths that do not appear in one list are two output paths.
    #[test]
    fn the_queue_shows_renders_whoever_started_them() {
        let handle = bay_jobs::start(
            "render",
            "/tmp/from-an-agent.mov",
            bay_jobs::Unit::Frames,
            90,
        );
        handle.progress(45, 90, "encoding frame 45 of 90");

        let mine = queue()
            .into_iter()
            .find(|render| render.id == handle.id())
            .expect("a started render is in the queue");
        assert_eq!(mine.label, "/tmp/from-an-agent.mov");
        assert_eq!(mine.fraction, Some(0.5));
        assert!(mine.can_cancel());

        bay_jobs::finish(&handle, Ok(json!({ "path": "/tmp/from-an-agent.mov" })));
        let done = queue()
            .into_iter()
            .find(|render| render.id == handle.id())
            .expect("still listed once finished");
        assert!(done.finished);
        assert!(!done.can_cancel(), "a finished render cannot be cancelled");
    }

    /// Anything that is not a render stays out of the Deliver queue.
    #[test]
    fn the_queue_is_renders_and_not_every_job_in_the_process() {
        let narration = bay_jobs::start("narrate", "a script", bay_jobs::Unit::Steps, 0);
        assert!(
            !queue().iter().any(|render| render.id == narration.id()),
            "a narration is not a render"
        );
        bay_jobs::finish(&narration, Ok(json!({})));
    }
}
