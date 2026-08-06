//! The owned editor: a single `EditorState` (project + selection + clipboard), undo/redo
//! stacks of reversible patches, and a coalesced event bus. No `Arc`, no `RwLock`, no `RefCell`.
//! The UI reads through the Query API and drives edits with [`Command`]s.

use vii_project::{Element, ElementRef, MediaTime, Project, Scene};

use crate::clipboard;
use crate::command::{Command, CommandKind, Lowered, ProjectPatch};
use crate::event::{Domain, DomainSet, EditorEvent, EventBus};
use crate::selection::{self, SelectionPatch, SelectionSnapshot};
use crate::state::EditorState;

/// One recorded, reversible step.
struct HistoryEntry {
    #[allow(dead_code)]
    kind: CommandKind,
    /// Forward document mutations, replayed on redo.
    forward: Vec<ProjectPatch>,
    /// Inverse document mutations (already reversed), replayed on undo.
    inverse: Vec<ProjectPatch>,
    /// Forward selection change, replayed on redo. `None` for commands with no selection intent.
    selection_patch: Option<SelectionPatch>,
    /// Selection before this command — restored on undo.
    previous_selection: SelectionSnapshot,
    /// `Some` iff the command changed editor-owned selection (the flag that decides whether undo
    /// restores `previous_selection` or leaves a later UI selection untouched).
    selection_override: Option<SelectionSnapshot>,
}

pub struct Editor {
    state: EditorState,
    history: Vec<HistoryEntry>,
    redo_stack: Vec<HistoryEntry>,
    bus: EventBus,
    paste_counter: u64,
}

impl Editor {
    pub fn new(project: Project) -> Self {
        Self {
            state: EditorState::new(project),
            history: Vec::new(),
            redo_stack: Vec::new(),
            bus: EventBus::default(),
            paste_counter: 0,
        }
    }

    /// A ready-to-edit editor over the starter project.
    pub fn starter() -> Self {
        Self::new(Project::starter())
    }

    // ---- Query API (what the UI reads) --------------------------------------------------

    pub fn state(&self) -> &EditorState {
        &self.state
    }

    pub fn project(&self) -> &Project {
        &self.state.project
    }

    /// Direct, unrecorded access to the project, for structural edits that have no `Command`
    /// (adding a track lane, attaching an animation channel wholesale).
    ///
    /// Changes made through this handle are **not undoable**. Taking the handle therefore
    /// *clears* the history rather than leaving it stale: a retained entry could otherwise
    /// replay its inverse patch against a structure that no longer matches, silently
    /// corrupting the project. Clearing makes undo unavailable, which is honest; leaving it
    /// would make undo wrong, which is not.
    pub fn project_mut(&mut self) -> &mut Project {
        self.history.clear();
        self.redo_stack.clear();
        &mut self.state.project
    }

    pub fn active_scene(&self) -> &Scene {
        self.state.project.active_scene()
    }

    pub fn scenes(&self) -> &[Scene] {
        &self.state.project.scenes
    }

    pub fn active_scene_id(&self) -> &str {
        &self.state.project.current_scene_id
    }

    pub fn selection(&self) -> &[ElementRef] {
        &self.state.selection.elements
    }

    pub fn is_selected(&self, reference: &ElementRef) -> bool {
        self.state.selection.elements.contains(reference)
    }

    pub fn selected_element(&self) -> Option<&Element> {
        let reference = self.state.selection.elements.first()?;
        self.active_scene().element(reference)
    }

    /// The transport playhead position.
    pub fn playhead(&self) -> MediaTime {
        self.state.playhead
    }

    /// The active scene's content duration = the latest element end across all lanes.
    pub fn duration(&self) -> MediaTime {
        self.active_scene()
            .tracks
            .iter()
            .flat_map(|track| track.elements.iter())
            .map(|element| element.end())
            .max()
            .unwrap_or(MediaTime::ZERO)
    }

    pub fn clipboard_len(&self) -> usize {
        self.state
            .clipboard
            .entry
            .as_ref()
            .map_or(0, |entry| entry.elements.len())
    }

    pub fn can_undo(&self) -> bool {
        !self.history.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Subscribe to coalesced change events (exactly one per state-changing operation).
    pub fn subscribe(&mut self, subscriber: impl FnMut(&EditorEvent) + 'static) {
        self.bus.subscribe(subscriber);
    }

    // ---- Commands -----------------------------------------------------------------------

    /// Execute a command; returns `false` (no history, no event) for a no-op.
    pub fn execute(&mut self, command: Command) -> bool {
        if matches!(command, Command::Paste) {
            return self.execute_paste();
        }
        match command.lower(&self.state) {
            Some(lowered) => self.apply_lowered(lowered),
            None => false,
        }
    }

    /// Replace the whole project (e.g. after loading a file). Resets history, selection, and the
    /// playhead, and emits one event. Not itself undoable.
    pub fn load_project(&mut self, project: Project) {
        self.state = EditorState::new(project);
        self.history.clear();
        self.redo_stack.clear();
        self.paste_counter = 0;
        self.bus.begin();
        self.bus.mark(Domain::Document);
        self.bus.mark(Domain::Selection);
        self.bus.mark(Domain::Playhead);
        self.bus.commit();
    }

    /// Add an imported media asset to the project library (non-undoable).
    pub fn add_media(&mut self, asset: vii_project::MediaAsset) {
        self.bus.begin();
        self.state.project.media.push(asset);
        self.bus.mark(Domain::Document);
        self.bus.commit();
    }

    pub fn media(&self) -> &[vii_project::MediaAsset] {
        &self.state.project.media
    }

    /// Copy the selected elements to the clipboard. Non-undoable; emits one event iff non-empty.
    pub fn copy(&mut self) -> bool {
        self.bus.begin();
        let copied = clipboard::copy(
            &mut self.state.clipboard,
            &self.state.project,
            &self.state.selection,
        );
        if copied {
            self.bus.mark(Domain::Clipboard);
        }
        self.bus.commit();
        copied
    }

    /// Move the transport playhead, clamped to `[0, duration]`. Direct, non-undoable UI state;
    /// emits one `Playhead` event iff the position actually changed.
    pub fn seek(&mut self, time: MediaTime) {
        let clamped = time.clamp(MediaTime::ZERO, self.duration());
        if clamped == self.state.playhead {
            return;
        }
        self.bus.begin();
        self.state.playhead = clamped;
        self.bus.mark(Domain::Playhead);
        self.bus.commit();
    }

    /// Switch the active scene (non-undoable navigation). Clears selection and resets the
    /// playhead; no-op if the scene doesn't exist or is already active.
    pub fn switch_scene(&mut self, scene_id: impl Into<String>) {
        let scene_id = scene_id.into();
        if self.state.project.current_scene_id == scene_id
            || !self.state.project.scenes.iter().any(|s| s.id == scene_id)
        {
            return;
        }
        self.bus.begin();
        self.state.project.current_scene_id = scene_id;
        selection::clear(&mut self.state.selection);
        self.state.playhead = MediaTime::ZERO;
        self.bus.mark(Domain::Document);
        self.bus.mark(Domain::Selection);
        self.bus.mark(Domain::Playhead);
        self.bus.commit();
    }

    /// Direct, non-undoable selection change — a UI click / box-select between commands.
    pub fn select(&mut self, elements: Vec<ElementRef>) {
        self.bus.begin();
        selection::set_elements(&mut self.state.selection, elements);
        self.bus.mark(Domain::Selection);
        self.bus.commit();
    }

    pub fn undo(&mut self) -> bool {
        let Some(entry) = self.history.pop() else {
            return false;
        };
        self.bus.begin();
        let mut changed = DomainSet::default();
        for patch in entry.inverse.iter().cloned() {
            if !matches!(patch.apply(&mut self.state.project), ProjectPatch::Noop) {
                changed.document = true;
            }
        }
        if entry.selection_override.is_some() {
            selection::restore(&mut self.state.selection, entry.previous_selection.clone());
            changed.selection = true;
        }
        self.bus.mark_set(changed);
        self.redo_stack.push(entry);
        self.bus.commit();
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(mut entry) = self.redo_stack.pop() else {
            return false;
        };
        self.bus.begin();
        let previous_selection = selection::snapshot(&self.state.selection);
        let mut changed = DomainSet::default();
        for patch in entry.forward.iter().cloned() {
            if !matches!(patch.apply(&mut self.state.project), ProjectPatch::Noop) {
                changed.document = true;
            }
        }
        let selection_override = match entry.selection_patch.clone() {
            Some(patch) => {
                let snapshot = selection::apply_patch(&mut self.state.selection, patch);
                changed.selection = true;
                Some(snapshot)
            }
            None => None,
        };
        entry.previous_selection = previous_selection;
        entry.selection_override = selection_override;
        self.bus.mark_set(changed);
        self.history.push(entry);
        self.bus.commit();
        true
    }

    // ---- internals ----------------------------------------------------------------------

    fn apply_lowered(&mut self, lowered: Lowered) -> bool {
        self.bus.begin();
        let previous_selection = selection::snapshot(&self.state.selection);
        let mut changed = DomainSet::default();

        let forward = lowered.forward.clone();
        let mut inverse = Vec::with_capacity(forward.len());
        for patch in lowered.forward {
            let step_inverse = patch.apply(&mut self.state.project);
            if !matches!(step_inverse, ProjectPatch::Noop) {
                changed.document = true;
            }
            inverse.push(step_inverse);
        }
        inverse.reverse();

        let selection_override = match lowered.selection_patch.clone() {
            Some(patch) => {
                let snapshot = selection::apply_patch(&mut self.state.selection, patch);
                changed.selection = true;
                Some(snapshot)
            }
            None => None,
        };

        if !changed.any() {
            // Nothing actually changed (e.g. patches degenerated to no-ops) — abort cleanly.
            self.bus.commit();
            return false;
        }

        self.bus.mark_set(changed);
        self.history.push(HistoryEntry {
            kind: lowered.kind,
            forward,
            inverse,
            selection_patch: lowered.selection_patch,
            previous_selection,
            selection_override,
        });
        self.redo_stack.clear();
        self.bus.commit();
        true
    }

    /// Paste: clone each clipboard element with a freshly-minted id onto the main track, and
    /// select the pasted copies. Undoable via the standard patch path.
    fn execute_paste(&mut self) -> bool {
        let Some(entry) = self.state.clipboard.entry.clone() else {
            return false;
        };
        if entry.elements.is_empty() {
            return false;
        }

        let track_id = self.state.project.active_scene().tracks.main.id.clone();
        let base_index = self.state.project.active_scene().tracks.main.elements.len();

        let mut forward = Vec::with_capacity(entry.elements.len());
        let mut new_refs = Vec::with_capacity(entry.elements.len());
        for (offset, element) in entry.elements.iter().enumerate() {
            self.paste_counter += 1;
            let new_id = format!("{}-copy-{}", element.id(), self.paste_counter);
            let mut clone = element.clone();
            clone.set_id(new_id.clone());
            forward.push(ProjectPatch::InsertElement {
                track_id: track_id.clone(),
                index: base_index + offset,
                element: clone,
            });
            new_refs.push(ElementRef::new(track_id.clone(), new_id));
        }

        self.apply_lowered(Lowered {
            kind: CommandKind::Paste,
            forward,
            selection_patch: Some(SelectionPatch::select_elements(new_refs)),
        })
    }
}
