//! One drag, not nine fields.
//!
//! Every press-move-release gesture in the editor has the same three facts: where the pointer
//! went down, where it is now, and which modifiers were held when it started. What differs is
//! only what those facts *mean* — a clip's new start time, a panel's width, a slider's value.
//!
//! So the view keeps exactly one [`Drag`], its `kind` says which gesture is in flight, and the
//! root element has one mouse-move handler and one mouse-up handler that dispatch on it. Before
//! this module the editor had three parallel `Option`/`bool` fields and an `if/else if` chain
//! over them; six more gestures were coming (slider, drag-number, keyframe XY, box-select, level
//! ride, colour wheel), and nine fields is how two of them end up live at once.
//!
//! Holding one slot rather than several is not just tidier — it makes "only one gesture at a
//! time" true by construction instead of by the ordering of an `else if`.
//!
//! GPUI-free apart from its coordinate and modifier types, so every gesture in the app can be
//! tested by pressing, moving and releasing without opening a window.

use gpui::{point, Modifiers, Pixels, Point, SharedString};

/// A gesture in progress.
#[derive(Debug, Clone, PartialEq)]
pub struct Drag<K> {
    /// What this gesture is doing. The view's own enum.
    pub kind: K,
    start: Point<Pixels>,
    position: Point<Pixels>,
    modifiers: Modifiers,
}

impl<K> Drag<K> {
    /// Begin at the press point. `position` starts equal to `start`, so a press with no movement
    /// is a zero delta rather than an uninitialised one.
    pub fn new(kind: K, start: Point<Pixels>, modifiers: Modifiers) -> Self {
        Self {
            kind,
            start,
            position: start,
            modifiers,
        }
    }

    /// Where the pointer went down, in window space.
    pub fn start(&self) -> Point<Pixels> {
        self.start
    }

    /// Where the pointer is now, in window space.
    pub fn position(&self) -> Point<Pixels> {
        self.position
    }

    /// Modifiers as of the press.
    ///
    /// The press, not the current moment: a drag that changes meaning because Shift was tapped
    /// halfway through jumps under the hand. Widgets that genuinely want a live modifier (fine
    /// adjust) read it off the move event instead, and say so.
    pub fn modifiers(&self) -> Modifiers {
        self.modifiers
    }

    /// Movement since the press.
    pub fn delta(&self) -> Point<Pixels> {
        point(
            self.position.x - self.start.x,
            self.position.y - self.start.y,
        )
    }

    pub fn dx(&self) -> f32 {
        f32::from(self.delta().x)
    }

    pub fn dy(&self) -> f32 {
        f32::from(self.delta().y)
    }

    /// Update the pointer. Returns whether it actually moved, so a caller can skip a redraw for
    /// the stream of identical positions macOS delivers while the hand is still.
    pub fn moved_to(&mut self, position: Point<Pixels>) -> bool {
        if position == self.position {
            return false;
        }
        self.position = position;
        true
    }
}

/// A view's whole interaction state: the one gesture in flight, and the one popover open.
///
/// Both are "at most one", and both are here rather than as loose fields for the same reason:
/// two open popovers, or two live drags, are states no code handles and every code path assumes
/// away.
#[derive(Debug, Clone, PartialEq)]
pub struct WidgetState<K> {
    drag: Option<Drag<K>>,
    open: Option<SharedString>,
}

impl<K> Default for WidgetState<K> {
    fn default() -> Self {
        Self {
            drag: None,
            open: None,
        }
    }
}

impl<K> WidgetState<K> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a gesture, replacing any that was somehow still live and dismissing an open
    /// popover — a press anywhere else is a dismissal, and this is the only place that has to
    /// know it.
    pub fn begin(&mut self, drag: Drag<K>) {
        self.open = None;
        self.drag = Some(drag);
    }

    pub fn active(&self) -> Option<&Drag<K>> {
        self.drag.as_ref()
    }

    pub fn active_mut(&mut self) -> Option<&mut Drag<K>> {
        self.drag.as_mut()
    }

    pub fn is_dragging(&self) -> bool {
        self.drag.is_some()
    }

    /// Feed the root element's mouse-move. Returns the gesture if it moved, so the caller can
    /// act on it and redraw; `None` means nothing to do.
    pub fn pointer_moved(&mut self, position: Point<Pixels>) -> Option<&Drag<K>> {
        let drag = self.drag.as_mut()?;
        drag.moved_to(position).then_some(&*drag)
    }

    /// Finish on mouse-up, handing back the gesture to be committed.
    pub fn end(&mut self, position: Point<Pixels>) -> Option<Drag<K>> {
        let mut drag = self.drag.take()?;
        drag.moved_to(position);
        Some(drag)
    }

    /// Abandon whatever is in flight without committing it: a project closing, a page switching.
    pub fn cancel(&mut self) {
        self.drag = None;
        self.open = None;
    }

    /// The popover currently open, if any.
    pub fn open_popover(&self) -> Option<&SharedString> {
        self.open.as_ref()
    }

    pub fn is_open(&self, id: &SharedString) -> bool {
        self.open.as_ref() == Some(id)
    }

    /// Open `id`, or close it if it is already the open one. Opening a second popover closes the
    /// first by assignment, which is the behaviour every menu bar has.
    pub fn toggle_popover(&mut self, id: SharedString) {
        if self.is_open(&id) {
            self.open = None;
        } else {
            self.open = Some(id);
        }
    }

    pub fn close_popover(&mut self) {
        self.open = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::px;

    #[derive(Debug, Clone, PartialEq)]
    enum Kind {
        Scrub,
        Panel { start_width: f32 },
    }

    fn at(x: f32, y: f32) -> Point<Pixels> {
        point(px(x), px(y))
    }

    #[test]
    fn a_press_with_no_movement_is_a_zero_delta() {
        let drag = Drag::new(Kind::Scrub, at(120.0, 40.0), Modifiers::default());
        assert_eq!(drag.delta(), at(0.0, 0.0));
        assert_eq!(drag.position(), drag.start());
    }

    #[test]
    fn the_delta_is_measured_from_the_press() {
        let mut state = WidgetState::new();
        state.begin(Drag::new(
            Kind::Panel { start_width: 264.0 },
            at(100.0, 10.0),
            Modifiers::default(),
        ));
        assert!(state.pointer_moved(at(160.0, 30.0)).is_some());
        let drag = state.active().expect("still dragging");
        assert_eq!(drag.dx(), 60.0);
        assert_eq!(drag.dy(), 20.0);
        assert_eq!(drag.kind, Kind::Panel { start_width: 264.0 });
    }

    /// macOS delivers a move event for a hand that has not moved. Redrawing the whole editor for
    /// each of those is how a still pointer costs a frame.
    #[test]
    fn a_pointer_that_did_not_move_asks_for_no_redraw() {
        let mut state = WidgetState::new();
        state.begin(Drag::new(Kind::Scrub, at(10.0, 10.0), Modifiers::default()));
        assert!(state.pointer_moved(at(11.0, 10.0)).is_some());
        assert!(state.pointer_moved(at(11.0, 10.0)).is_none());
    }

    #[test]
    fn a_move_with_nothing_pressed_does_nothing() {
        let mut state: WidgetState<Kind> = WidgetState::new();
        assert!(state.pointer_moved(at(50.0, 50.0)).is_none());
        assert!(state.end(at(50.0, 50.0)).is_none());
        assert!(!state.is_dragging());
    }

    /// The release position counts: a fast drag can deliver mouse-up somewhere the last
    /// mouse-move never reached, and a clip that lands short of where it was dropped is the bug
    /// that produces.
    #[test]
    fn release_takes_the_last_position_with_it() {
        let mut state = WidgetState::new();
        state.begin(Drag::new(Kind::Scrub, at(0.0, 0.0), Modifiers::default()));
        state.pointer_moved(at(30.0, 0.0));
        let finished = state.end(at(90.0, 0.0)).expect("a gesture to commit");
        assert_eq!(finished.dx(), 90.0);
        assert!(!state.is_dragging(), "the slot has to empty on release");
    }

    #[test]
    fn only_one_popover_is_ever_open() {
        let mut state: WidgetState<Kind> = WidgetState::new();
        state.toggle_popover("easing".into());
        assert!(state.is_open(&"easing".into()));
        state.toggle_popover("codec".into());
        assert!(state.is_open(&"codec".into()));
        assert!(!state.is_open(&"easing".into()));
        state.toggle_popover("codec".into());
        assert!(state.open_popover().is_none(), "a second click closes it");
    }

    #[test]
    fn starting_a_drag_dismisses_an_open_popover() {
        let mut state = WidgetState::new();
        state.toggle_popover("easing".into());
        state.begin(Drag::new(Kind::Scrub, at(0.0, 0.0), Modifiers::default()));
        assert!(state.open_popover().is_none());
    }

    #[test]
    fn cancelling_leaves_nothing_in_flight() {
        let mut state = WidgetState::new();
        state.begin(Drag::new(Kind::Scrub, at(0.0, 0.0), Modifiers::default()));
        state.toggle_popover("easing".into());
        state.cancel();
        assert!(!state.is_dragging());
        assert!(state.open_popover().is_none());
    }
}
