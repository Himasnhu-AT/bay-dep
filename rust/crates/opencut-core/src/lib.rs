//! `opencut-core` — headless editor engine (Phase 1 seed).
//!
//! **P0-ARCH-01 borrow-model spike.** Proves the architecture the native rewrite is built
//! on, exercised end-to-end on the two pure managers (Selection, Clipboard):
//!
//! - **One owned [`Editor`]** holding a single [`EditorState`] — the web app's 12
//!   cross-referencing manager singletons collapse into one value. No `Arc`, no `RwLock`,
//!   no `RefCell`: exclusive `&mut` borrows of disjoint state fields, checked at compile time.
//! - **Stateless free-function modules** ([`selection`], [`clipboard`]) that take `&mut`
//!   slices of the state instead of `self`.
//! - **A serde-tagged [`Command`] enum** that is at once the undo/redo unit, the
//!   autosave/replay log entry, and the future MCP surface.
//! - **A coalesced [`EventBus`]** emitting exactly one event per command, carrying which
//!   domains changed — no subscriber ever receives `&Editor`, so nothing can re-enter and
//!   alias the state a command still holds mutably.
//! - **Web-faithful `selectionOverride` undo semantics**: undo restores the prior selection
//!   only for commands that declared a selection change; commands with no selection intent
//!   leave a later UI selection untouched.

pub mod clipboard;
pub mod command;
pub mod editor;
pub mod event;
pub mod refs;
pub mod selection;
pub mod state;

pub use command::Command;
pub use editor::Editor;
pub use event::{Domain, DomainSet, EditorEvent, EventBus};
pub use refs::{ElementRef, KeyframeRef, MaskPointSelection};
pub use state::{
    ClipboardEntry, ClipboardState, Document, EditorState, SelectionKind, SelectionState,
};
