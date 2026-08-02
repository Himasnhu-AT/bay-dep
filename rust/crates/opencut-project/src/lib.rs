//! `opencut-project` — the editor's pure data model.
//!
//! Single responsibility: the serializable domain types the whole editor is built around,
//! with no editing behavior (that lives in `opencut-core`) and no rendering. The shape mirrors
//! the web app so project JSON stays compatible:
//!
//! ```text
//! Project
//! ├─ metadata (id, name)
//! ├─ settings (fps, canvas, background)
//! └─ scenes: [Scene]
//!    └─ tracks: { overlay: [Track], main: Track, audio: [Track] }
//!       └─ Track → elements: [Element]
//!          └─ Element = Video | Image | Text | Audio
//! ```
//!
//! Time is [`time::MediaTime`] (i64 ticks, 120 000/s) — the one time type shared with the
//! compositor and the web/wasm core.

mod element;
mod project;
mod refs;
mod scene;
mod settings;
mod track;

pub use element::{
    AudioElement, Effect, Element, ElementKind, ImageElement, TextElement, Transform,
    VideoElement,
};
pub use project::{MediaAsset, Project, ProjectMetadata};
pub use refs::ElementRef;
pub use scene::Scene;
pub use settings::{Background, CanvasSize, Fps, ProjectSettings};
pub use track::{Track, TrackKind, Tracks};

pub use time::MediaTime;
