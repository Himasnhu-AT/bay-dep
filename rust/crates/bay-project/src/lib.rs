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

pub mod duck;
mod element;
pub mod kit;
pub mod library;
pub mod mix;
pub mod moves;
mod project;
mod refs;
mod scene;
mod settings;
pub mod templates;
mod track;

pub use duck::{Duck, DuckKey, DuckParams};
pub use element::{
    AnimationChannel, AudioElement, AudioRole, BlendMode, Easing, Effect, Element, ElementKind,
    ElementRole, ElementSource, ImageElement, Keyframe, Mask, MaskShape, ShapeElement, ShapeKind,
    TextAlign, TextElement, Transform, VideoElement, is_caption_id,
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
pub use project::{AssetLoudness, MediaAsset, MediaKind, Project, ProjectMetadata};
pub use refs::ElementRef;
pub use scene::{BySource, Marker, Scene};
pub use settings::{Background, CanvasSize, Fps, ProjectSettings};
pub use templates::{Template, TemplateLibrary, builtin_templates};
pub use track::{Track, TrackKind, Tracks};

pub use bay_time::MediaTime;
