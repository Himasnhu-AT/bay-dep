//! Coalesced event bus. A command may touch several domains (document + selection),
//! but subscribers must see **exactly one** event per command — the web app's per-manager
//! listener storms (a notify() from selection, another from clipboard, another from the
//! store) collapsed into a single coalesced notification carrying which domains changed.
//!
//! Subscribers receive only `&EditorEvent` (changed domains + a monotonic epoch), never
//! `&Editor` — so a subscriber cannot re-enter and alias the state the command still holds
//! `&mut` to. A real UI reads fresh state through a separate borrow after the event.

/// Which parts of the editor changed during one command.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainSet {
    pub selection: bool,
    pub clipboard: bool,
    pub document: bool,
    pub playhead: bool,
}

impl DomainSet {
    pub fn any(&self) -> bool {
        self.selection || self.clipboard || self.document || self.playhead
    }

    fn union(&mut self, other: DomainSet) {
        self.selection |= other.selection;
        self.clipboard |= other.clipboard;
        self.document |= other.document;
        self.playhead |= other.playhead;
    }
}

/// A single domain, used with [`EventBus::mark`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Domain {
    Selection,
    Clipboard,
    Document,
    Playhead,
}

/// One coalesced notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorEvent {
    pub changed: DomainSet,
    pub epoch: u64,
}

type Subscriber = Box<dyn FnMut(&EditorEvent)>;

/// Buffers domain marks inside a transaction and flushes a single event on commit.
#[derive(Default)]
pub struct EventBus {
    subscribers: Vec<Subscriber>,
    pending: Option<DomainSet>,
    epoch: u64,
}

impl EventBus {
    pub fn subscribe(&mut self, subscriber: impl FnMut(&EditorEvent) + 'static) {
        self.subscribers.push(Box::new(subscriber));
    }

    /// Open a coalescing window. Marks made until [`commit`](Self::commit) fold into one event.
    pub fn begin(&mut self) {
        debug_assert!(self.pending.is_none(), "nested EventBus transaction");
        self.pending = Some(DomainSet::default());
    }

    /// Record that `domain` changed within the current transaction.
    pub fn mark(&mut self, domain: Domain) {
        let Some(pending) = self.pending.as_mut() else {
            debug_assert!(false, "mark() outside a transaction");
            return;
        };
        match domain {
            Domain::Selection => pending.selection = true,
            Domain::Clipboard => pending.clipboard = true,
            Domain::Document => pending.document = true,
            Domain::Playhead => pending.playhead = true,
        }
    }

    /// Close the window and emit exactly one event **iff** anything changed. Returns the
    /// emitted event (or `None` for a no-op command that changed nothing).
    pub fn commit(&mut self) -> Option<EditorEvent> {
        let pending = self.pending.take().unwrap_or_default();
        if !pending.any() {
            return None;
        }
        self.epoch += 1;
        let event = EditorEvent {
            changed: pending,
            epoch: self.epoch,
        };
        for subscriber in &mut self.subscribers {
            subscriber(&event);
        }
        Some(event)
    }

    /// Fold an already-computed change set into the current transaction (used by the
    /// executor to merge a command's touched domains).
    pub fn mark_set(&mut self, set: DomainSet) {
        if let Some(pending) = self.pending.as_mut() {
            pending.union(set);
        }
    }
}
