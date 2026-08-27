//! The `Project` aggregate root and its starter/demo constructor.

use bay_time::MediaTime;
use serde::{Deserialize, Serialize};

use crate::element::{
    AudioElement, AudioRole, Element, ElementRole, ElementSource, ImageElement, TextElement,
    Transform, is_caption_id,
};
use crate::scene::{BySource, Scene};
use crate::settings::ProjectSettings;
use crate::track::{Track, TrackKind, Tracks};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    /// How the project is filed in the launcher: its stage, and the user's tags.
    ///
    /// `#[serde(default)]` because every project written before this field existed must still
    /// load, and the default — in progress, untagged — is the honest reading of a project
    /// nobody filed.
    #[serde(default)]
    pub shelf: crate::shelf::Shelf,
}

/// An imported media file the timeline references by id (image/video/audio on disk).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    /// What a probe found, when one succeeded. Optional on purpose: a project can be opened on
    /// a machine with no ffprobe, and projects written before this field existed must still
    /// load. Absent means "unknown", never "zero" — code that trims against the source length
    /// must treat `None` as "cannot check" rather than "the file is empty".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// How loud the file itself is. See [`AssetLoudness`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loudness: Option<AssetLoudness>,
    /// Speech recognised from this asset, persisted with the project so transcript edits are
    /// stable and never require re-running the model merely to reopen a project.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript: Option<Transcript>,
    /// Shot-level visual embeddings used by semantic media search. The vectors are persisted so
    /// reopening a project never requires decoding and embedding the footage again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_index: Option<SemanticMediaIndex>,
    /// Present only when bay verified a generation receipt against this file's bytes. Optional
    /// for backward compatibility: old projects and authored media deserialize as ungenerated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedMediaProvenance>,
}

/// Durable disclosure attached to generated media.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedMediaProvenance {
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub seed: u64,
    pub generated_at_unix_ms: u128,
    pub request_hash: String,
    pub artifact_sha256: String,
}

/// A persisted semantic index produced by bay's provisioned SigLIP encoder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticMediaIndex {
    pub model: String,
    #[serde(default)]
    pub shots: Vec<SemanticShot>,
}

/// One detected shot represented by a frame sampled at its temporal midpoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticShot {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub sample_seconds: f64,
    pub embedding: Vec<f32>,
}

/// A local speech-to-text result. Word timing is the canonical edit surface; utterances retain
/// the coarser structure emitted by the recogniser without making precise cuts depend on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub language: String,
    pub model: String,
    pub duration_seconds: f64,
    #[serde(default)]
    pub words: Vec<TranscriptWord>,
    #[serde(default)]
    pub utterances: Vec<TranscriptUtterance>,
}

/// One recognised word and its source-media interval.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptWord {
    pub text: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    /// Whisper token probability aggregated for this word, in `0..=1`.
    pub confidence: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

/// A recogniser segment, with an optional speaker label when the backend supplies one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptUtterance {
    pub text: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    /// Half-open range into [`Transcript::words`].
    pub word_start: usize,
    pub word_end: usize,
}

/// What a file measures, independent of any gain applied to it on the timeline.
///
/// **The unit a mix can be reasoned in.** A linear `volume` says nothing about how loud a clip
/// will be, because that depends entirely on the asset: the project this comes from ran its bed
/// at `2.0` against a file that integrates to −35.3 LUFS and its narration at `1.15` against
/// files at −25.8, so a gain *ratio* of 4.3 dB was an audible separation of 13.7 dB — and every
/// check written against the gain number inherited that blindness. Measured once at import and
/// carried in the project, so the checks that compare a bed against a voice compare two
/// measurements rather than two multipliers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLoudness {
    /// Sample peak in dBFS. `0.0` is full scale.
    pub peak_db: f32,
    /// Mean level in dBFS — what `volumedetect` calls `mean_volume`.
    pub rms_db: f32,
    /// EBU R128 integrated loudness, in LUFS. The number the mix is specified in.
    pub lufs: f32,
    /// Where the file's transients are, in seconds from its head. A cut placed on one of these
    /// lands on the music instead of near it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accent_seconds: Vec<f64>,
}

impl AssetLoudness {
    /// Loudness so low it is not a measurement of anything — ffmpeg reports `-70.0` for a file
    /// whose content never crosses the gate, and `-inf`/NaN for actual digital silence.
    pub const FLOOR_LUFS: f32 = -70.0;

    /// Whether R128 found a level at all. A file shorter than its 400 ms block never crosses the
    /// gate however loud it is, so this being false says "too short or too quiet to integrate",
    /// not "silent" — see [`Self::level_lufs`].
    pub fn is_audible(&self) -> bool {
        self.lufs.is_finite() && self.lufs > Self::FLOOR_LUFS
    }

    /// The level to place this asset at in a mix.
    ///
    /// Integrated loudness where there is one, and the plain mean otherwise. The fallback is not
    /// a nicety: `tick.wav` is 45 ms long and peaks at **−1.1 dBFS**, and R128 reports it as
    /// −70 LUFS because it is shorter than one gating block. Taking that at face value made a
    /// project with three such files unmeasurable, and treating them as silent would have hidden
    /// a click sitting at the top of the mix.
    pub fn level_lufs(&self) -> f32 {
        if self.is_audible() {
            self.lufs
        } else if self.rms_db.is_finite() {
            self.rms_db
        } else {
            Self::FLOOR_LUFS
        }
    }
}

impl MediaAsset {
    /// An asset nobody has probed yet.
    pub fn new(id: impl Into<String>, name: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            path: path.into(),
            duration_seconds: None,
            width: None,
            height: None,
            loudness: None,
            transcript: None,
            semantic_index: None,
            generated: None,
        }
    }

    /// The source length, if it is known and sane. A still has no length; neither does a file
    /// nobody could probe.
    pub fn source_duration(&self) -> Option<MediaTime> {
        let seconds = self.duration_seconds?;
        if !seconds.is_finite() || seconds <= 0.0 {
            return None;
        }
        MediaTime::from_seconds_f64(seconds)
    }
}

/// What an imported file becomes on the timeline.
///
/// Lives here rather than in the UI because every front end that can place a file — the editor's
/// media panel, a drag-and-drop, an MCP import — has to answer the same question, and answering
/// it twice is how a `.m4a` becomes an image on one of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Image,
    Audio,
}

impl MediaKind {
    /// Classify a file by extension. Anything unrecognised is treated as an image: a still is
    /// the only kind that needs no decoder, so a wrong guess shows a box on the canvas instead
    /// of a clip that will never play.
    pub fn of_path(path: &str) -> Self {
        let extension = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        match extension.as_str() {
            "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" => Self::Video,
            "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" => Self::Audio,
            _ => Self::Image,
        }
    }

    /// Whether a probe for duration is meaningful. Stills are never probed: ffprobe reports a
    /// nominal ~0.04s for a JPEG, which would import a photo as a 40ms clip.
    pub fn is_timed(&self) -> bool {
        matches!(self, Self::Video | Self::Audio)
    }

    /// The element-kind label the timeline and inspector display.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Video => "Video",
            Self::Image => "Image",
            Self::Audio => "Audio",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub metadata: ProjectMetadata,
    pub settings: ProjectSettings,
    pub scenes: Vec<Scene>,
    pub current_scene_id: String,
    /// Imported media assets, referenced by element `media_id`.
    #[serde(default)]
    pub media: Vec<MediaAsset>,
}

/// The stem every WAV `narrate` writes begins with. Matching on it is how a project saved
/// before provenance existed still knows which of its audio clips are the voice.
const NARRATION_STEM: &str = "bay-narration-";

impl Project {
    /// Resolve a media id to its file path.
    pub fn media_path(&self, media_id: &str) -> Option<&str> {
        self.media
            .iter()
            .find(|asset| asset.id == media_id)
            .map(|asset| asset.path.as_str())
    }

    /// The active scene's elements split by who put them there. See [`Scene::by_source`].
    pub fn by_source(&self) -> BySource<'_> {
        self.active_scene().by_source()
    }

    /// Recover provenance for a project written before `source` and `role` existed.
    ///
    /// Every project already on disk says nothing about either, so it would all read as
    /// authored — and the whole point of the field is that bay's own output is not. The two
    /// facts that survive in an old file are the caption id (`caption-<n>`, minted by nothing
    /// but the caption writer) and the narration WAV's name, so those are what this reads.
    ///
    /// **Only ever upgrades.** It sets `Tool` and it sets a non-default role; it never puts
    /// anything back to `Author` or to `label`. That makes it idempotent and safe to run over a
    /// project that already carries real provenance — a saved project keeps what it was stamped
    /// with, and only the gaps are filled.
    pub fn infer_provenance(&mut self) {
        let narration: Vec<String> = self
            .media
            .iter()
            .filter(|asset| {
                file_stem(&asset.path).starts_with(NARRATION_STEM)
                    || asset.name.starts_with(NARRATION_STEM)
            })
            .map(|asset| asset.id.clone())
            .collect();
        let sfx: Vec<String> = self
            .media
            .iter()
            .filter(|asset| asset.id.starts_with("sfx-"))
            .map(|asset| asset.id.clone())
            .collect();

        for scene in &mut self.scenes {
            for track in scene.tracks.iter_mut() {
                for element in &mut track.elements {
                    if let Element::Text(text) = element
                        && is_caption_id(&text.id)
                    {
                        text.source = ElementSource::Tool;
                        if text.role == ElementRole::default() {
                            text.role = ElementRole::Caption;
                        }
                        continue;
                    }
                    let Element::Audio(audio) = element else {
                        continue;
                    };
                    if narration.contains(&audio.media_id) {
                        audio.source = ElementSource::Tool;
                        if audio.role == AudioRole::default() {
                            audio.role = AudioRole::Speech;
                        }
                    } else if sfx.contains(&audio.media_id) && audio.role == AudioRole::default() {
                        audio.role = AudioRole::Sfx;
                    }
                }
            }
        }
    }
}

/// A path's file name without its extension. Used only for matching bay's own generated file
/// names, so it does not need to be a general path utility.
fn file_stem(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_seconds_f64(seconds).unwrap_or(MediaTime::ZERO)
}

impl Project {
    /// The scene currently being edited. A `Project` is expected to always hold at least one
    /// scene (the constructors guarantee it); falls back to the first scene if the
    /// `current_scene_id` does not resolve.
    pub fn active_scene(&self) -> &Scene {
        self.scenes
            .iter()
            .find(|scene| scene.id == self.current_scene_id)
            .or_else(|| self.scenes.first())
            .expect("a project always has at least one scene")
    }

    pub fn active_scene_mut(&mut self) -> &mut Scene {
        let target = self
            .scenes
            .iter()
            .position(|scene| scene.id == self.current_scene_id)
            .unwrap_or(0);
        self.scenes
            .get_mut(target)
            .expect("a project always has at least one scene")
    }

    /// A small, representative project so the editor opens with visible content: a main scene
    /// with a title + logo on the main track, a caption overlay, and a music clip on audio.
    pub fn starter() -> Self {
        let main = Track {
            id: "track-main".into(),
            name: "Main".into(),
            kind: TrackKind::Video,
            hidden: false,
            muted: false,
            elements: vec![
                Element::Text(TextElement {
                    id: "el-title".into(),
                    name: "Title".into(),
                    start: secs(0.0),
                    duration: secs(3.0),
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    content: "Hello, bay".into(),
                    font_size: 96.0,
                    color: "#ffffff".into(),
                    transform: Transform {
                        x: 0.5,
                        y: 0.42,
                        scale: 0.8,
                        rotation: 0.0,
                        opacity: 1.0,
                        ..Transform::default()
                    },
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
                    type_on: None,
                    source: ElementSource::Author,
                    role: ElementRole::Headline,
                }),
                Element::Image(ImageElement {
                    id: "el-logo".into(),
                    name: "Logo".into(),
                    start: secs(3.0),
                    duration: secs(4.0),
                    fade_in: MediaTime::ZERO,
                    fade_out: MediaTime::ZERO,
                    media_id: "media-logo".into(),
                    transform: Transform {
                        x: 0.72,
                        y: 0.28,
                        scale: 0.35,
                        rotation: 0.0,
                        opacity: 1.0,
                        ..Transform::default()
                    },
                    effects: Vec::new(),
                    animations: Default::default(),
                    blend_mode: Default::default(),
                    mask: None,
                    source: ElementSource::Author,
                    role: ElementRole::Lockup,
                }),
            ],
        };

        let overlay = vec![Track {
            id: "track-overlay".into(),
            name: "Overlay".into(),
            kind: TrackKind::Overlay,
            hidden: false,
            muted: false,
            elements: vec![Element::Text(TextElement {
                id: "el-caption".into(),
                name: "Caption".into(),
                start: secs(1.0),
                duration: secs(2.0),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                content: "native • fast".into(),
                font_size: 48.0,
                color: "#99aadd".into(),
                transform: Transform {
                    x: 0.5,
                    y: 0.84,
                    scale: 0.5,
                    rotation: 0.0,
                    opacity: 0.85,
                    ..Transform::default()
                },
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
                type_on: None,
                source: ElementSource::Author,
                role: ElementRole::Kicker,
            })],
        }];

        let audio = vec![Track {
            id: "track-audio".into(),
            name: "Audio".into(),
            kind: TrackKind::Audio,
            hidden: false,
            muted: false,
            elements: vec![Element::Audio(AudioElement {
                id: "el-music".into(),
                name: "Music".into(),
                start: secs(0.0),
                duration: secs(7.0),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "media-music".into(),
                muted: false,
                volume: 1.0,
                speed: 1.0,
                prosody: None,
                dialogue_chain: None,
                animations: Default::default(),
                trim_start: MediaTime::ZERO,
                source: ElementSource::Author,
                role: AudioRole::Bed,
            })],
        }];

        let scene = Scene {
            id: "scene-main".into(),
            name: "Main scene".into(),
            is_main: true,
            tracks: Tracks {
                overlay,
                main,
                audio,
            },
            markers: Vec::new(),
            groups: Default::default(),
        };

        Self {
            metadata: ProjectMetadata {
                id: "project-1".into(),
                name: "Untitled".into(),
                shelf: crate::shelf::Shelf::default(),
            },
            settings: ProjectSettings::default(),
            scenes: vec![scene],
            current_scene_id: "scene-main".into(),
            media: Vec::new(),
        }
    }
}

#[cfg(test)]
mod media_kind_tests {
    use super::MediaKind;

    #[test]
    fn extensions_decide_the_kind_case_insensitively() {
        assert_eq!(MediaKind::of_path("/a/b/clip.MP4"), MediaKind::Video);
        assert_eq!(MediaKind::of_path("/a/b/take.mov"), MediaKind::Video);
        assert_eq!(MediaKind::of_path("/a/b/bed.M4A"), MediaKind::Audio);
        assert_eq!(MediaKind::of_path("/a/b/logo.png"), MediaKind::Image);
    }

    /// A file with no extension, or one nobody recognises, must not be guessed into a decoder.
    #[test]
    fn an_unknown_file_is_a_still() {
        assert_eq!(MediaKind::of_path("/a/b/README"), MediaKind::Image);
        assert_eq!(MediaKind::of_path("/a/b/thing.xyz"), MediaKind::Image);
        assert!(!MediaKind::of_path("/a/b/thing.xyz").is_timed());
    }

    #[test]
    fn only_timed_media_is_worth_probing() {
        assert!(MediaKind::of_path("/a/b/clip.mp4").is_timed());
        assert!(MediaKind::of_path("/a/b/bed.mp3").is_timed());
        assert!(!MediaKind::of_path("/a/b/logo.png").is_timed());
    }
}
