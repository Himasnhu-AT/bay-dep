//! `opencut-core` — the headless editor engine.
//!
//! One owned [`Editor`] holds a single [`EditorState`] (an [`opencut_project::Project`] plus the
//! session selection and clipboard). Edits are [`Command`]s that lower into reversible
//! `ProjectPatch`es, so undo/redo is two patch lists per step. A coalesced [`EventBus`] emits
//! exactly one event per command; the UI reads state through the Query API on `Editor` and never
//! receives `&Editor` in an event, so nothing can re-enter and alias mid-command. No `Arc`,
//! no `RwLock`, no `RefCell` — the borrow checker guarantees no aliasing.

pub mod clipboard;
pub mod command;
pub mod editor;
pub mod event;
pub mod refs;
pub mod selection;
pub mod state;

pub use command::{Command, CommandKind, TrackLane};
pub use editor::Editor;
pub use event::{Domain, DomainSet, EditorEvent, EventBus};
pub use refs::{ElementRef, KeyframeRef, MaskPointSelection};
pub use selection::{SelectionPatch, SelectionSnapshot};
pub use state::{ClipboardEntry, ClipboardState, EditorState, SelectionKind, SelectionState};

/// The domain model this engine edits.
pub use opencut_project as project;
pub use opencut_project::{
    AudioElement, Background, CanvasSize, Element, ElementKind, Fps, ImageElement, MediaTime,
    Project, ProjectMetadata, ProjectSettings, Scene, TextElement, Track, TrackKind, Tracks,
    Transform, VideoElement,
};
