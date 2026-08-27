//! `bay-project` — the editor's pure data model.
//!
//! Single responsibility: the serializable domain types the whole editor is built around,
//! with no editing behavior (that lives in `bay-core`) and no rendering. The shape mirrors
//! the web app so project JSON stays compatible:
//!
//! ```text
//! Project
//! ├─ metadata (id, name)
//! ├─ settings (fps, canvas, background)
//! └─ scenes: [Scene]
//!    └─ tracks: { overlay: [Track], main: Track, audio: [Track] }
//!       └─ Track → elements: [Element]
//!          └─ Element = Video | Image | Text | Audio | Shape
//! ```
//!
//! Time is [`bay_time::MediaTime`] (i64 ticks, 120 000/s) — the one time type shared with the
//! compositor and the web/wasm core.

pub mod animatable;
pub mod duck;
mod element;
pub mod format;
pub mod kit;
pub mod library;
pub mod mix;
pub mod moves;
pub mod plan;
mod project;
mod refs;
mod scene;
mod settings;
pub mod shelf;
pub mod templates;
mod track;

pub use animatable::{AnimatableProperty, PropertyKind, Unit, describe_path};
pub use duck::{Duck, DuckKey, DuckParams};
pub use element::{
    AnimationChannel, AudioElement, AudioRole, BUILTIN_LOOKS, BezierHandles, BlendMode,
    DialogueAudioChain, DialogueCompressor, DialogueEq, DialogueLimiter, Easing, Effect, Element,
    ElementKind, ElementRole, ElementSource, FreezeFrame, Gradient, ImageElement, KaraokeSpec,
    KaraokeWord, Keyframe, LOOK_PREFIX, Mask, MaskShape, ShapeElement, ShapeKind, SpeechProsody,
    Stroke, TextAlign, TextDecorations, TextElement, TextPlate, TextShadow, TextStroke, Transform,
    TypeOn, VideoElement, is_builtin_look, is_caption_id, look_id,
};
pub use kit::{
    Framing, OffToken, Palette, ResolvedStyle, StyleHistory, StyleKit, Tone, TypeFace, TypeRamp,
    TypeRoles, TypeStep, builtin_kit, builtin_kit_ids, builtin_kits,
};
pub use library::{ProjectLibrary, ProjectSummary};
pub use mix::{MixEnvelope, MixSample};
pub use moves::{
    ChannelAudit, Direction, Move, MoveKind, MoveParams, OffVocabularyMotion, core_span,
};
pub use plan::{
    AssetSlot, BeatPlan, CriticObligation, CriticState, FORMAT_REGISTRY, FormatPlaybook,
    PairwiseDecision, PlanArtifact, PlanStatus, VariantCandidate, VariantState, format,
};
pub use project::{
    AssetLoudness, GeneratedMediaProvenance, MediaAsset, MediaKind, Project, ProjectMetadata,
    SemanticMediaIndex, SemanticShot, Transcript, TranscriptUtterance, TranscriptWord,
};
pub use refs::ElementRef;
pub use scene::{BySource, ElementGroup, Marker, Scene, compose_group_transform};
pub use settings::{Background, CanvasSize, Fps, ProjectSettings};
pub use shelf::{ProjectStatus, Shelf, TAG_SUGGESTIONS};
pub use templates::{Template, TemplateLibrary, builtin_templates};
pub use track::{Track, TrackKind, Tracks};

pub use bay_time::MediaTime;

/// Deterministic identity fingerprint of a serialized project.
///
/// This lives with the project model rather than in `bay-agent` so lower-level, headless
/// orchestration crates can detect cycles without depending upward on the agent that drives them.
/// It is an identity fingerprint, not an authentication primitive.
pub fn project_hash(project: &Project) -> String {
    let bytes = serde_json::to_vec(project).unwrap_or_default();
    stable_hash(&bytes)
}

fn stable_hash(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
