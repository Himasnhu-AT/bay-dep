//! The controls that take a value: slider, drag-number, select.
//!
//! `widgets.rs` stays what it always was — stateless `Div` builders with no click handlers,
//! because interaction needs a `Context<V>` and that would tie every card and chip in the app to
//! one view. These three are the other kind: they own a gesture, so they live here and are
//! generic over the view that hosts them.
//!
//! **What a view has to provide.** One field of [`WidgetState`] and a [`WidgetHost`] impl over
//! it, plus a gesture enum that can carry a [`ValueDrag`] ([`WidgetGesture`]). That is the whole
//! contract; in exchange the view gets sliders and drag-numbers anywhere, and its root mouse
//! handlers keep dispatching on exactly one slot.
//!
//! **Why the widgets do not own their own drag.** GPUI can give an element per-frame state, and
//! a slider that captured the pointer that way would need nothing from its host. It would also
//! be unreachable from a test without a window, and it would leave the editor's existing three
//! gestures on a second, parallel path — which is the thing this milestone exists to remove.
//! One slot, one dispatch, one set of tests.
//!
//! **What is deliberately missing.** None of these can be typed into. bay has no text input
//! widget at all (both "fields" in the app are `String` buffers assembled from raw key events),
//! so a click-to-type numeric field is not something this milestone could honestly ship. Scrub,
//! detent and double-click-to-reset are what there is.

use std::cell::Cell;
use std::rc::Rc;

use gpui::prelude::*;
use gpui::{
    anchored, deferred, div, point, px, relative, rgb, AnyElement, Bounds, Context, Corner, Div,
    Modifiers, MouseButton, MouseDownEvent, Pixels, Point, SharedString,
};

use crate::drag::{Drag, WidgetState};
use crate::draw;
use crate::theme;

/// Alt reduces a drag's sensitivity to this fraction. A fader that moves 0.5 dB per pixel is
/// unusable for the last 0.2 dB, and a curve handle that cannot be placed precisely is a curve
/// editor that produces approximately the motion you asked for.
const FINE_FACTOR: f32 = 0.2;

/// How close, in pixels, a drag has to come to a detent before it is pulled onto it.
///
/// In pixels rather than in value, so the pull feels the same on a 0–1 opacity slider and on a
/// −60…+12 dB fader. Small enough that a detent never steals a value the user meant.
const DETENT_PULL_PX: f32 = 5.0;

/// How a pointer position becomes a value. Pure, and the whole of a widget's behaviour.
///
/// Two ways to read a pointer, and they are not interchangeable. A slider is [`ScrubMap::track`]:
/// the pointer's absolute position along a track of known extent, so the thumb is always under
/// the finger. A drag-number is [`ScrubMap::rate`]: distance travelled since the press times a
/// rate, so it has no extent on screen and can be dragged as far as the value needs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrubMap {
    mode: Mode,
    min: f32,
    max: f32,
    step: Option<f32>,
    detent: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Mode {
    /// Window-space left edge and length of the thumb's travel.
    Track { left: f32, width: f32 },
    /// Value units per pixel of horizontal travel.
    Rate { per_px: f32 },
}

impl ScrubMap {
    /// A slider: the value is wherever the pointer is along the track.
    pub fn track(left: f32, width: f32, min: f32, max: f32) -> Self {
        Self {
            mode: Mode::Track {
                left,
                width: width.max(1.0),
            },
            min,
            max,
            step: None,
            detent: None,
        }
    }

    /// A drag-number: the value moves `per_px` for every pixel the pointer travels.
    pub fn rate(per_px: f32, min: f32, max: f32) -> Self {
        Self {
            mode: Mode::Rate { per_px },
            min,
            max,
            step: None,
            detent: None,
        }
    }

    /// Quantise to a multiple of `step`: opacity in whole percent, a count in frames.
    pub fn step(mut self, step: f32) -> Self {
        self.step = (step > 0.0 && step.is_finite()).then_some(step);
        self
    }

    /// A rest value the drag is pulled onto: 100% opacity, 0 dB, 1.0× scale.
    pub fn detent(mut self, detent: f32) -> Self {
        self.detent = detent.is_finite().then_some(detent);
        self
    }

    /// How much value one pixel of travel is worth. Also what makes [`DETENT_PULL_PX`] a
    /// distance on screen rather than a distance in whatever units the caller happens to use.
    fn value_per_px(&self) -> f32 {
        match self.mode {
            Mode::Track { width, .. } => (self.max - self.min) / width,
            Mode::Rate { per_px } => per_px,
        }
    }

    /// The value for a pointer at `x`, given where the press was and what it was worth then.
    ///
    /// `fine` is read from the *live* modifiers rather than from the press, unlike the rest of a
    /// gesture: holding Alt partway through a fader move is exactly how a real desk works, and
    /// it does not move the value, only the rate from that point on.
    pub fn value_at(&self, start_value: f32, start_x: f32, x: f32, fine: bool) -> f32 {
        if !(start_value.is_finite() && start_x.is_finite() && x.is_finite()) {
            return self.settle(start_value);
        }
        let scale = if fine { FINE_FACTOR } else { 1.0 };
        let raw = match self.mode {
            Mode::Track { left, width } => {
                let at = |x: f32| self.min + ((x - left) / width) * (self.max - self.min);
                if fine {
                    start_value + (at(x) - at(start_x)) * scale
                } else {
                    at(x)
                }
            }
            Mode::Rate { per_px } => start_value + (x - start_x) * per_px * scale,
        };
        self.settle(raw)
    }

    /// Clamp, then let the detent win, then quantise.
    ///
    /// The detent is tested against the *unquantised* value and short-circuits the step, because
    /// a step that does not divide the detent would otherwise push the value off the rest point
    /// by more than the pull radius and make it unreachable — a 0 dB fader with a 0.7 dB step
    /// that can never actually sit at 0 dB.
    fn settle(&self, raw: f32) -> f32 {
        let value = self.clamp(raw);
        if let Some(detent) = self.detent {
            let pull = (DETENT_PULL_PX * self.value_per_px()).abs();
            if (value - detent).abs() <= pull {
                return self.clamp(detent);
            }
        }
        match self.step {
            Some(step) => self.clamp((value / step).round() * step),
            None => value,
        }
    }

    fn clamp(&self, value: f32) -> f32 {
        let (low, high) = if self.min <= self.max {
            (self.min, self.max)
        } else {
            (self.max, self.min)
        };
        if !value.is_finite() {
            return low;
        }
        value.clamp(low, high)
    }

    /// Where `value` sits along the track, as 0…1. What the fill and the thumb are drawn from.
    pub fn fraction(&self, value: f32) -> f32 {
        let span = self.max - self.min;
        if span.abs() < f32::EPSILON || !value.is_finite() {
            return 0.0;
        }
        ((value - self.min) / span).clamp(0.0, 1.0)
    }
}

/// How a value widget hands its result back to the view.
///
/// An `Rc` rather than a `Box` because the dispatcher has to clone it out from under the borrow
/// on the view before calling it — the gesture lives *inside* the view, so there is no way to
/// call `&mut view` while holding a reference into it.
pub type ValueCallback<V> = Rc<dyn Fn(&mut V, f32, &mut Context<V>)>;

/// The same, for a [`Select`], which hands back an index rather than a number.
pub type PickCallback<V> = Rc<dyn Fn(&mut V, usize, &mut Context<V>)>;

/// A value gesture in flight: which widget owns it, how to read the pointer, and what to do with
/// the result.
///
/// The callback is why this is generic over the view; see [`ValueCallback`].
pub struct ValueDrag<V> {
    id: SharedString,
    map: ScrubMap,
    start_value: f32,
    value: f32,
    apply: ValueCallback<V>,
}

impl<V> ValueDrag<V> {
    /// Which widget this gesture belongs to.
    pub fn id(&self) -> &SharedString {
        &self.id
    }

    /// The value as of the last pointer position. What the widget draws while it is being
    /// dragged, so the thumb tracks the hand even if the model behind it lags a frame.
    pub fn value(&self) -> f32 {
        self.value
    }
}

impl<V> std::fmt::Debug for ValueDrag<V> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ValueDrag")
            .field("id", &self.id)
            .field("map", &self.map)
            .field("value", &self.value)
            .finish_non_exhaustive()
    }
}

/// A view's gesture enum, seen from the widget layer.
///
/// The widgets do not know what else a host can drag — a clip, a panel divider, a playhead — so
/// the host says how to put a [`ValueDrag`] into its enum and how to find one again.
pub trait WidgetGesture<V>: Sized {
    fn from_value_drag(drag: ValueDrag<V>) -> Self;
    fn as_value_drag(&self) -> Option<&ValueDrag<V>>;
    fn as_value_drag_mut(&mut self) -> Option<&mut ValueDrag<V>>;
}

/// A view that can host these controls: one interaction slot, and a gesture enum to fill it.
pub trait WidgetHost: Sized + 'static {
    type Gesture: WidgetGesture<Self>;

    fn widgets(&self) -> &WidgetState<Self::Gesture>;
    fn widgets_mut(&mut self) -> &mut WidgetState<Self::Gesture>;

    /// The value a widget should draw: the live gesture's, if this widget is the one being
    /// dragged; otherwise `None` and the caller uses its model's.
    fn dragged_value(&self, id: &SharedString) -> Option<f32> {
        let drag = self.widgets().active()?.kind.as_value_drag()?;
        (drag.id() == id).then(|| drag.value())
    }
}

/// Advance a value gesture to `position` and hand the new value to the view.
///
/// The host calls this first from its one mouse-move handler; `true` means the active gesture
/// was a widget's and has been dealt with, so nothing else in the host needs to know a slider
/// exists.
pub fn drive_value_drag<V: WidgetHost>(
    view: &mut V,
    position: Point<Pixels>,
    fine: bool,
    cx: &mut Context<V>,
) -> bool {
    let Some(drag) = view.widgets_mut().active_mut() else {
        return false;
    };
    if drag.kind.as_value_drag().is_none() {
        return false;
    }
    if !drag.moved_to(position) {
        // Handled, but nothing changed. macOS delivers moves for a hand that is holding still.
        return true;
    }
    let (apply, value) = {
        let start_x = f32::from(drag.start().x);
        let x = f32::from(drag.position().x);
        let gesture = drag
            .kind
            .as_value_drag_mut()
            .expect("checked immediately above");
        let value = gesture.map.value_at(gesture.start_value, start_x, x, fine);
        gesture.value = value;
        (gesture.apply.clone(), value)
    };
    apply(view, value, cx);
    cx.notify();
    true
}

/// Finish a value gesture at `position`.
///
/// Separate from [`drive_value_drag`] because a release carries a final position the last move
/// may never have reached — a fast flick delivers mouse-up somewhere no mouse-move did, and a
/// fader that lands short of where it was let go is the bug that produces.
pub fn end_value_drag<V: WidgetHost>(
    view: &mut V,
    position: Point<Pixels>,
    fine: bool,
    cx: &mut Context<V>,
) -> bool {
    if !drive_value_drag(view, position, fine, cx) {
        return false;
    }
    let _ = view.widgets_mut().end(position);
    cx.notify();
    true
}

/// Install a track (slider) gesture, and return the value the press itself lands on.
///
/// Factored out of the mouse listener rather than written inside it so the press → move →
/// release path is reachable from a test: a widget whose behaviour only exists inside a GPUI
/// event closure is a widget nothing can check without a window.
#[allow(clippy::too_many_arguments)]
pub fn begin_track_drag<V: WidgetHost>(
    view: &mut V,
    id: SharedString,
    map: ScrubMap,
    track: Bounds<Pixels>,
    position: Point<Pixels>,
    modifiers: Modifiers,
    value: f32,
    apply: ValueCallback<V>,
) -> f32 {
    let map = ScrubMap {
        mode: Mode::Track {
            left: f32::from(track.origin.x) + THUMB / 2.0,
            width: (f32::from(track.size.width) - THUMB).max(1.0),
        },
        ..map
    };
    let x = f32::from(position.x);
    let jumped = map.value_at(value, x, x, false);
    view.widgets_mut().begin(Drag::new(
        V::Gesture::from_value_drag(ValueDrag {
            id,
            map,
            start_value: jumped,
            value: jumped,
            apply,
        }),
        position,
        modifiers,
    ));
    jumped
}

/// Install a rate (drag-number) gesture. The value does not move until the pointer does.
pub fn begin_rate_drag<V: WidgetHost>(
    view: &mut V,
    id: SharedString,
    map: ScrubMap,
    position: Point<Pixels>,
    modifiers: Modifiers,
    value: f32,
    apply: ValueCallback<V>,
) {
    view.widgets_mut().begin(Drag::new(
        V::Gesture::from_value_drag(ValueDrag {
            id,
            map,
            start_value: value,
            value,
            apply,
        }),
        position,
        modifiers,
    ));
}

/// Close whatever popover is open.
///
/// The host wires this into its root mouse-down. Every widget that must survive the press calls
/// `cx.stop_propagation()`, so by the time this runs the press was on something else — which is
/// a dismissal.
pub fn dismiss_popover<V: WidgetHost>(view: &mut V, cx: &mut Context<V>) {
    if view.widgets().open_popover().is_some() {
        view.widgets_mut().close_popover();
        cx.notify();
    }
}

// ---------------------------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------------------------

/// Track height, thumb diameter, and the row a slider occupies.
///
/// The track is thin because it is a scale, not an object. The thumb is 12px because anything
/// smaller is hard to land a pointer on, and the row is taller than the thumb so the thumb is
/// never clipped by its own bounds.
const TRACK_HEIGHT: f32 = 4.0;
const THUMB: f32 = 12.0;
const SLIDER_HEIGHT: f32 = 18.0;

/// A horizontal slider.
///
/// Behaviour, all of which is what a pointer does on any other desk:
///
/// - **A press anywhere jumps** the thumb there and starts a drag from that value.
/// - **The drag survives the pointer leaving the control**, because the gesture lives on the view
///   and the move handler is on the root. A slider whose value freezes when the hand strays 3px
///   below it is the commonest home-made-slider bug there is.
/// - **A detent** pulls the value onto a rest point within [`DETENT_PULL_PX`], and lets go again.
/// - **Double-click resets**, without jumping to the pointer first.
/// - **Alt is fine adjust**, relative to where the press landed.
pub struct Slider {
    id: SharedString,
    value: f32,
    map: ScrubMap,
    reset: Option<f32>,
    width: f32,
    enabled: bool,
}

impl Slider {
    pub fn new(id: impl Into<SharedString>, value: f32, min: f32, max: f32) -> Self {
        Self {
            id: id.into(),
            value,
            // Placeholder extents: the real ones are measured at press time, because a slider in
            // a flex row does not know where it landed until the frame is laid out.
            map: ScrubMap::track(0.0, 1.0, min, max),
            reset: None,
            width: 160.0,
            enabled: true,
        }
    }

    pub fn step(mut self, step: f32) -> Self {
        self.map = self.map.step(step);
        self
    }

    /// A rest value the drag is pulled onto and — unless [`reset`](Self::reset) says otherwise —
    /// the value a double-click returns to. They are the same point often enough that saying it
    /// twice is how the two drift apart.
    pub fn detent(mut self, detent: f32) -> Self {
        self.map = self.map.detent(detent);
        self.reset = self.reset.or(Some(detent));
        self
    }

    /// Where a double-click returns to.
    pub fn reset(mut self, reset: f32) -> Self {
        self.reset = Some(reset);
        self
    }

    pub fn width(mut self, width: f32) -> Self {
        self.width = width.max(THUMB * 3.0);
        self
    }

    /// A slider the engine cannot back yet. Drawn and refused, never hidden: the disabled
    /// controls are the map of the remaining engine work, and that map is worth having on screen.
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// Render, calling `on_change` with every new value — throughout the drag, not only at the
    /// end, so what the user sees and hears follows the hand.
    pub fn render<V: WidgetHost>(
        self,
        host: &V,
        cx: &mut Context<V>,
        on_change: impl Fn(&mut V, f32, &mut Context<V>) + 'static,
    ) -> AnyElement {
        let Slider {
            id,
            value,
            map,
            reset,
            width,
            enabled,
        } = self;
        let shown = host.dragged_value(&id).unwrap_or(value);
        let fraction = map.fraction(shown);
        let apply: ValueCallback<V> = Rc::new(on_change);
        // The thumb's centre travels between the two inset ends; the trough is inset to match,
        // so the filled part and the thumb agree about where the value is.
        let travel = width - THUMB;

        let trough = div()
            .absolute()
            .left(px(THUMB / 2.0))
            .top(px((SLIDER_HEIGHT - TRACK_HEIGHT) / 2.0))
            .w(px(travel))
            .h(px(TRACK_HEIGHT))
            .rounded(px(TRACK_HEIGHT / 2.0))
            .bg(rgb(if enabled {
                theme::LANE
            } else {
                theme::DISABLED
            }))
            .child(
                div()
                    .h_full()
                    .w(relative(fraction))
                    .rounded(px(TRACK_HEIGHT / 2.0))
                    .bg(rgb(if enabled {
                        theme::ACCENT
                    } else {
                        theme::DIM_DOT
                    })),
            );

        let thumb = div()
            .absolute()
            .left(px(fraction * travel))
            .top(px((SLIDER_HEIGHT - THUMB) / 2.0))
            .w(px(THUMB))
            .h(px(THUMB))
            .rounded_full()
            .bg(rgb(if enabled {
                theme::TEXT
            } else {
                theme::DISABLED_TEXT
            }));

        let mut row: Div = div()
            .relative()
            .w(px(width))
            .h(px(SLIDER_HEIGHT))
            .flex_none()
            .child(trough);

        // The detent's mark. The first thing in the widget layer that is a *tick* rather than a
        // box, and so the first thing drawn on the path route.
        if let Some(detent) = map.detent {
            let at = map.fraction(detent) * travel + THUMB / 2.0;
            row = row.child(
                draw::paint(vec![draw::Shape::line(
                    vec![
                        point(px(at), px(2.0)),
                        point(px(at), px(SLIDER_HEIGHT - 2.0)),
                    ],
                    1.0,
                    if enabled {
                        theme::FAINT
                    } else {
                        theme::DISABLED
                    },
                )])
                .absolute()
                .size_full(),
            );
        }

        let row = row.child(thumb);
        if !enabled {
            return row.into_any_element();
        }

        let bounds: Rc<Cell<Bounds<Pixels>>> = Rc::new(Cell::new(Bounds::default()));
        let measured = bounds.clone();
        row.child(draw::measure(measured).absolute().size_full())
            .id(id.clone())
            .cursor_pointer()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |view, event: &MouseDownEvent, _window, cx| {
                    // A press on a slider is not also a press on the panel behind it, and it is
                    // not a dismissal of anything.
                    cx.stop_propagation();

                    if event.click_count >= 2 {
                        // Reset outright. Jumping to the pointer and *then* resetting shows a
                        // value nobody asked for one frame before the one they did — and on a
                        // fader that frame is audible.
                        if let Some(reset) = reset {
                            view.widgets_mut().cancel();
                            apply(view, reset, cx);
                            cx.notify();
                        }
                        return;
                    }

                    // Where the control actually landed this frame. Prepaint filled this before
                    // any event was dispatched, so it is never a stale frame's geometry.
                    let jumped = begin_track_drag(
                        view,
                        id.clone(),
                        map,
                        bounds.get(),
                        event.position,
                        event.modifiers,
                        value,
                        apply.clone(),
                    );
                    apply(view, jumped, cx);
                    cx.notify();
                }),
            )
            .into_any_element()
    }
}

// ---------------------------------------------------------------------------------------------
// Drag-number
// ---------------------------------------------------------------------------------------------

/// A number you scrub horizontally.
///
/// This is what replaces the ± steppers. Setting a clip's opacity from 100% to 30% is seven
/// clicks on a stepper whose step is fixed at 0.5; here it is one gesture, and Alt gives the
/// last few percent the precision the stepper had.
///
/// Converting the existing call sites is not part of this milestone, but it is mechanical:
/// `stepper_row(label, value, id, cx, handler)` becomes a `DragNumber` with the same id, `per_px`
/// set to the step that handler applied, and the handler taking a value instead of a ∓1 sign.
pub struct DragNumber {
    id: SharedString,
    value: f32,
    map: ScrubMap,
    reset: Option<f32>,
    width: f32,
    enabled: bool,
    format: Rc<dyn Fn(f32) -> String>,
}

impl DragNumber {
    /// `per_px` is how much the value moves per pixel of travel — the same number the stepper it
    /// replaces used as its step, which is the honest starting point when converting one.
    pub fn new(id: impl Into<SharedString>, value: f32, min: f32, max: f32, per_px: f32) -> Self {
        Self {
            id: id.into(),
            value,
            map: ScrubMap::rate(per_px, min, max),
            reset: None,
            width: 68.0,
            enabled: true,
            format: Rc::new(|value| format!("{value:.2}")),
        }
    }

    pub fn step(mut self, step: f32) -> Self {
        self.map = self.map.step(step);
        self
    }

    pub fn detent(mut self, detent: f32) -> Self {
        self.map = self.map.detent(detent);
        self.reset = self.reset.or(Some(detent));
        self
    }

    pub fn reset(mut self, reset: f32) -> Self {
        self.reset = Some(reset);
        self
    }

    pub fn width(mut self, width: f32) -> Self {
        self.width = width.max(28.0);
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// How the value reads: `"30%"`, `"1.25×"`, `"−6.0 dB"`. A bare float in a field somebody is
    /// dragging tells them the number but not what it is.
    pub fn format(mut self, format: impl Fn(f32) -> String + 'static) -> Self {
        self.format = Rc::new(format);
        self
    }

    pub fn render<V: WidgetHost>(
        self,
        host: &V,
        cx: &mut Context<V>,
        on_change: impl Fn(&mut V, f32, &mut Context<V>) + 'static,
    ) -> AnyElement {
        let DragNumber {
            id,
            value,
            map,
            reset,
            width,
            enabled,
            format,
        } = self;
        let live = host.dragged_value(&id);
        let shown = live.unwrap_or(value);
        let apply: ValueCallback<V> = Rc::new(on_change);

        let field = div()
            .w(px(width))
            .h(px(20.0))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(px(5.0))
            .bg(rgb(if !enabled {
                theme::DISABLED
            } else if live.is_some() {
                theme::PRESSED
            } else {
                theme::PANEL_ALT
            }))
            .border_1()
            .border_color(rgb(if live.is_some() {
                theme::FOCUS_RING
            } else {
                theme::BORDER
            }))
            .font_family("ui-monospace")
            .text_xs()
            .text_color(rgb(if enabled {
                theme::TEXT
            } else {
                theme::DISABLED_TEXT
            }))
            .child(SharedString::from(format(shown)));

        if !enabled {
            return field.into_any_element();
        }

        field
            .id(id.clone())
            // The cursor is the whole affordance: nothing about a number in a box says "drag
            // me", so the pointer has to.
            .cursor(gpui::CursorStyle::ResizeLeftRight)
            .hover(|style| style.bg(rgb(theme::HOVER)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |view, event: &MouseDownEvent, _window, cx| {
                    cx.stop_propagation();
                    if event.click_count >= 2 {
                        if let Some(reset) = reset {
                            view.widgets_mut().cancel();
                            apply(view, reset, cx);
                            cx.notify();
                        }
                        return;
                    }
                    begin_rate_drag(
                        view,
                        id.clone(),
                        map,
                        event.position,
                        event.modifiers,
                        value,
                        apply.clone(),
                    );
                    cx.notify();
                }),
            )
            .into_any_element()
    }
}

// ---------------------------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------------------------

/// One row of a [`Select`].
#[derive(Debug, Clone)]
pub struct SelectOption {
    pub label: SharedString,
    /// A second line: what the option means, or why it cannot be picked.
    pub detail: Option<SharedString>,
    /// A codec this build cannot write; an easing the engine does not interpolate. Drawn and
    /// refused, never omitted — an option that is missing looks like a bay that never had it.
    pub enabled: bool,
}

impl SelectOption {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            detail: None,
            enabled: true,
        }
    }

    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

/// A button that opens a list and closes on a pick.
///
/// The control this replaces is the blend-mode button, which cycles through all seventeen modes
/// one click at a time and never shows what the other sixteen are. A fourteen-value easing
/// picker built the same way would be unusable, and the Deliver form needs three of these.
///
/// **One constraint, and GPUI enforces it with an abort.** The open list is `deferred`, so a
/// `Select` may not itself sit inside a deferred subtree — `defer_draw` during deferred drawing
/// fails an assertion and takes the process with it. Put a select in an ordinary panel; if a
/// panel has to float over its siblings, position it absolutely and put it last rather than
/// deferring it. `editor::paint_tests::an_open_select_paints_at_both_sizes` catches this.
pub struct Select {
    id: SharedString,
    options: Vec<SelectOption>,
    selected: Option<usize>,
    width: f32,
    placeholder: SharedString,
    enabled: bool,
}

/// The trigger's height, and therefore how far below it the list hangs.
const TRIGGER_HEIGHT: f32 = 24.0;

impl Select {
    pub fn new(id: impl Into<SharedString>, options: Vec<SelectOption>) -> Self {
        Self {
            id: id.into(),
            options,
            selected: None,
            width: 160.0,
            placeholder: "Choose…".into(),
            enabled: true,
        }
    }

    pub fn selected(mut self, selected: Option<usize>) -> Self {
        self.selected = selected;
        self
    }

    pub fn width(mut self, width: f32) -> Self {
        self.width = width.max(64.0);
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// Render. `on_pick` gets the index into the options the control was built with.
    pub fn render<V: WidgetHost>(
        self,
        host: &V,
        cx: &mut Context<V>,
        on_pick: impl Fn(&mut V, usize, &mut Context<V>) + 'static,
    ) -> AnyElement {
        let Select {
            id,
            options,
            selected,
            width,
            placeholder,
            enabled,
        } = self;
        let open = enabled && host.widgets().is_open(&id);
        let label = selected
            .and_then(|index| options.get(index))
            .map(|option| option.label.clone())
            .unwrap_or(placeholder);

        let trigger = div()
            .w(px(width))
            .h(px(TRIGGER_HEIGHT))
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .gap(px(6.0))
            .px(px(8.0))
            .rounded(px(5.0))
            .bg(rgb(if !enabled {
                theme::DISABLED
            } else if open {
                theme::PRESSED
            } else {
                theme::PANEL_ALT
            }))
            .border_1()
            .border_color(rgb(if open {
                theme::FOCUS_RING
            } else {
                theme::BORDER
            }))
            .text_xs()
            .text_color(rgb(if enabled {
                theme::TEXT
            } else {
                theme::DISABLED_TEXT
            }))
            .child(div().overflow_hidden().child(label))
            .child(
                div()
                    .flex_none()
                    .text_color(rgb(if enabled {
                        theme::MUTED
                    } else {
                        theme::DISABLED_TEXT
                    }))
                    .child("▾"),
            );

        let root: Div = div().relative().flex_none().w(px(width));

        if !enabled {
            return root.child(trigger).into_any_element();
        }

        let on_pick: PickCallback<V> = Rc::new(on_pick);
        let trigger_id = id.clone();
        let root = root.child(
            trigger
                .id(id.clone())
                .cursor_pointer()
                .hover(|style| style.bg(rgb(theme::HOVER)))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |view, _event: &MouseDownEvent, _window, cx| {
                        // Without this the root's dismiss handler runs straight afterwards and
                        // the list opens and closes inside a single press.
                        cx.stop_propagation();
                        view.widgets_mut().toggle_popover(trigger_id.clone());
                        cx.notify();
                    }),
                ),
        );

        if !open {
            return root.into_any_element();
        }

        let rows: Vec<AnyElement> = options
            .iter()
            .enumerate()
            .map(|(index, option)| {
                let chosen = selected == Some(index);
                let row = div()
                    .flex()
                    .flex_col()
                    .gap(px(1.0))
                    .px(px(8.0))
                    .py(px(5.0))
                    .rounded(px(4.0))
                    .bg(rgb(if chosen {
                        theme::SELECTED
                    } else if option.enabled {
                        theme::PANEL_ALT
                    } else {
                        theme::DISABLED
                    }))
                    .text_xs()
                    .text_color(rgb(if option.enabled {
                        theme::TEXT
                    } else {
                        theme::DISABLED_TEXT
                    }))
                    .child(option.label.clone())
                    .children(option.detail.clone().map(|detail| {
                        div()
                            .text_xs()
                            .text_color(rgb(if option.enabled {
                                theme::FAINT
                            } else {
                                theme::DISABLED_TEXT
                            }))
                            .child(detail)
                    }));
                if !option.enabled {
                    return row.into_any_element();
                }
                let on_pick = on_pick.clone();
                row.id(("bay-select-option", index))
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(theme::HOVER)))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |view, _event: &MouseDownEvent, _window, cx| {
                            cx.stop_propagation();
                            view.widgets_mut().close_popover();
                            on_pick(view, index, cx);
                            cx.notify();
                        }),
                    )
                    .into_any_element()
            })
            .collect();

        let list = div()
            .w(px(width))
            .flex()
            .flex_col()
            .gap(px(2.0))
            .p(px(4.0))
            .rounded(px(6.0))
            .bg(rgb(theme::PANEL))
            .border_1()
            .border_color(rgb(theme::BORDER))
            .children(rows)
            // Nothing behind an open list is a legitimate target; without this the option under
            // the pointer and whatever is under *that* both fire.
            .occlude();

        root.child(
            // Deferred so the list paints over its siblings — a popover inside a panel is
            // otherwise drawn under whatever comes after that panel in the tree. Anchored so it
            // stays inside the window instead of falling off the bottom of a short one.
            deferred(
                anchored()
                    .anchor(Corner::TopLeft)
                    .offset(point(px(0.0), px(TRIGGER_HEIGHT + 4.0)))
                    .snap_to_window()
                    .child(list),
            )
            .with_priority(1),
        )
        .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 200px track from 0 to 1, starting at window x = 100.
    fn slider_map() -> ScrubMap {
        ScrubMap::track(100.0, 200.0, 0.0, 1.0)
    }

    #[test]
    fn a_slider_reads_the_pointer_where_it_is() {
        let map = slider_map();
        assert_eq!(map.value_at(0.0, 100.0, 100.0, false), 0.0);
        assert_eq!(map.value_at(0.0, 100.0, 200.0, false), 0.5);
        assert_eq!(map.value_at(0.0, 100.0, 300.0, false), 1.0);
    }

    /// The drag has to survive the pointer leaving the track — the whole reason the gesture
    /// lives on the view and the move handler on the root.
    #[test]
    fn a_pointer_past_the_end_pins_the_value_rather_than_losing_it() {
        let map = slider_map();
        assert_eq!(map.value_at(0.5, 200.0, 9000.0, false), 1.0);
        assert_eq!(map.value_at(0.5, 200.0, -9000.0, false), 0.0);
    }

    #[test]
    fn a_drag_number_moves_by_travel_not_by_position() {
        let map = ScrubMap::rate(0.5, -60.0, 12.0);
        assert_eq!(map.value_at(-30.0, 10.0, 50.0, false), -10.0);
        assert_eq!(
            map.value_at(-30.0, 900.0, 940.0, false),
            -10.0,
            "the same travel elsewhere on screen is the same change"
        );
    }

    #[test]
    fn alt_slows_a_drag_number_without_moving_it() {
        let map = ScrubMap::rate(0.5, -60.0, 12.0);
        assert_eq!(
            map.value_at(-30.0, 0.0, 0.0, true),
            -30.0,
            "no travel, no change"
        );
        assert_eq!(map.value_at(-30.0, 0.0, 40.0, false), -10.0);
        let fine = map.value_at(-30.0, 0.0, 40.0, true);
        assert!((fine - (-26.0)).abs() < 1e-4, "fine was {fine}");
    }

    /// Fine adjust on a track slider is relative to the grab point, not to the track's origin —
    /// otherwise pressing Alt teleports the thumb towards the left edge.
    #[test]
    fn alt_on_a_slider_is_relative_to_the_grab() {
        let map = slider_map();
        assert_eq!(
            map.value_at(0.5, 200.0, 200.0, true),
            0.5,
            "Alt alone must not move it"
        );
        let fine = map.value_at(0.5, 200.0, 240.0, true);
        assert!((fine - 0.54).abs() < 1e-5, "fine was {fine}");
    }

    #[test]
    fn a_detent_pulls_and_then_lets_go() {
        let map = slider_map().detent(0.5);
        assert_eq!(
            map.value_at(0.0, 100.0, 198.0, false),
            0.5,
            "2px short of the middle is inside the pull"
        );
        let free = map.value_at(0.0, 100.0, 220.0, false);
        assert!((free - 0.6).abs() < 1e-5, "20px past it, free at {free}");
    }

    /// A step that does not divide the detent must not make the rest value unreachable, which is
    /// exactly what quantising before the pull would do: 0.99 rounds to 0.7, which is then 0.3
    /// away from the detent and outside its 0.15 pull.
    #[test]
    fn a_detent_survives_a_step_that_does_not_divide_it() {
        let map = ScrubMap::track(0.0, 100.0, 0.0, 3.0).step(0.7).detent(1.0);
        assert_eq!(map.value_at(0.0, 0.0, 33.0, false), 1.0);
        let stepped = map.value_at(0.0, 0.0, 60.0, false);
        assert!(
            (stepped - 2.1).abs() < 1e-5,
            "away from the detent the step still applies: {stepped}"
        );
    }

    #[test]
    fn a_step_quantises_and_still_reaches_both_ends() {
        let map = ScrubMap::track(0.0, 100.0, 0.0, 100.0).step(10.0);
        assert_eq!(map.value_at(0.0, 0.0, 44.0, false), 40.0);
        assert_eq!(map.value_at(0.0, 0.0, 46.0, false), 50.0);
        assert_eq!(map.value_at(0.0, 0.0, 0.0, false), 0.0);
        assert_eq!(map.value_at(0.0, 0.0, 100.0, false), 100.0);
    }

    /// A descending range — a fader written top-to-bottom, a reversed axis — still clamps to the
    /// range, not to whichever end happens to be written first.
    #[test]
    fn a_reversed_range_still_clamps() {
        let map = ScrubMap::rate(1.0, 12.0, -60.0);
        assert_eq!(map.value_at(0.0, 0.0, 10_000.0, false), 12.0);
        assert_eq!(map.value_at(0.0, 0.0, -10_000.0, false), -60.0);
    }

    /// Transforms in this app can hold NaN and ±inf and the render path is tested against them,
    /// so the controls that feed it have to be too.
    #[test]
    fn nonsense_never_escapes_a_control() {
        let map = slider_map().detent(0.5);
        assert!(map.value_at(f32::NAN, 100.0, 150.0, false).is_finite());
        assert!(map.value_at(0.5, f32::INFINITY, 150.0, false).is_finite());
        assert!(map.value_at(0.5, 100.0, f32::NAN, false).is_finite());
        assert_eq!(map.fraction(f32::NAN), 0.0);

        let degenerate = ScrubMap::track(0.0, 0.0, 1.0, 1.0);
        assert_eq!(degenerate.fraction(1.0), 0.0);
        assert!(degenerate.value_at(1.0, 0.0, 50.0, false).is_finite());
    }

    #[test]
    fn the_fill_fraction_follows_the_value() {
        let map = slider_map();
        assert_eq!(map.fraction(0.0), 0.0);
        assert_eq!(map.fraction(0.25), 0.25);
        assert_eq!(map.fraction(1.0), 1.0);
        assert_eq!(
            map.fraction(4.0),
            1.0,
            "out of range clamps rather than overflowing the track"
        );
    }
}

/// Press, move, release — through the same functions the mouse listeners call.
///
/// The tests above check the arithmetic; these check the *gesture*. A slider whose maths is
/// right but whose press never installs a drag, or whose release never commits, passes every
/// one of the tests above and does nothing on screen.
#[cfg(test)]
mod gesture_tests {
    use super::*;
    use gpui::{size, Render, TestAppContext, Window};

    /// The smallest thing that can host a widget: one interaction slot, one value.
    struct Host {
        state: WidgetState<Gesture>,
        value: f32,
        changes: usize,
    }

    enum Gesture {
        Value(ValueDrag<Host>),
        /// A second gesture kind, so the dispatcher is exercised against a host that drags other
        /// things too — which is the only kind of host there is in the real app.
        Other,
    }

    impl WidgetGesture<Host> for Gesture {
        fn from_value_drag(drag: ValueDrag<Host>) -> Self {
            Gesture::Value(drag)
        }
        fn as_value_drag(&self) -> Option<&ValueDrag<Host>> {
            match self {
                Gesture::Value(drag) => Some(drag),
                Gesture::Other => None,
            }
        }
        fn as_value_drag_mut(&mut self) -> Option<&mut ValueDrag<Host>> {
            match self {
                Gesture::Value(drag) => Some(drag),
                Gesture::Other => None,
            }
        }
    }

    impl WidgetHost for Host {
        type Gesture = Gesture;
        fn widgets(&self) -> &WidgetState<Gesture> {
            &self.state
        }
        fn widgets_mut(&mut self) -> &mut WidgetState<Gesture> {
            &mut self.state
        }
    }

    impl Render for Host {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }

    fn host(value: f32) -> Host {
        Host {
            state: WidgetState::new(),
            value,
            changes: 0,
        }
    }

    fn writer() -> ValueCallback<Host> {
        Rc::new(|host: &mut Host, value: f32, _cx: &mut Context<Host>| {
            host.value = value;
            host.changes += 1;
        })
    }

    fn at(x: f32) -> Point<Pixels> {
        point(px(x), px(9.0))
    }

    /// A 212px-wide slider at window x = 100, so the thumb's centre travels x = 106 … 306.
    fn track() -> Bounds<Pixels> {
        Bounds {
            origin: point(px(100.0), px(0.0)),
            size: size(px(212.0), px(SLIDER_HEIGHT)),
        }
    }

    #[gpui::test]
    fn a_slider_press_moves_the_value_and_the_release_commits_it(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(1.0));
        view.update(cx, |host, cx| {
            let jumped = begin_track_drag(
                host,
                "opacity".into(),
                ScrubMap::track(0.0, 1.0, 0.0, 1.0),
                track(),
                at(106.0),
                Modifiers::default(),
                1.0,
                writer(),
            );
            assert_eq!(jumped, 0.0, "a press at the left end is the minimum");
            assert!(host.widgets().is_dragging());

            assert!(drive_value_drag(host, at(206.0), false, cx));
            assert_eq!(host.value, 0.5, "the middle of the track");

            // Past the right edge and well below the control: the gesture is still live, which
            // is the point of holding it on the view rather than on the element.
            assert!(drive_value_drag(
                host,
                point(px(900.0), px(700.0)),
                false,
                cx
            ));
            assert_eq!(host.value, 1.0);

            assert!(end_value_drag(host, at(256.0), false, cx));
            assert_eq!(host.value, 0.75, "the release position is the final value");
            assert!(!host.widgets().is_dragging(), "the slot has to empty");
        });
    }

    #[gpui::test]
    fn a_slider_press_that_never_moves_still_commits_the_jump(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.0));
        view.update(cx, |host, cx| {
            let jumped = begin_track_drag(
                host,
                "opacity".into(),
                ScrubMap::track(0.0, 1.0, 0.0, 1.0),
                track(),
                at(206.0),
                Modifiers::default(),
                0.0,
                writer(),
            );
            host.value = jumped;
            assert!(end_value_drag(host, at(206.0), false, cx));
            assert_eq!(host.value, 0.5, "click-to-jump has to land somewhere");
            assert!(!host.widgets().is_dragging());
        });
    }

    #[gpui::test]
    fn a_drag_number_scrubs_from_where_it_was(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(-6.0));
        view.update(cx, |host, cx| {
            begin_rate_drag(
                host,
                "gain".into(),
                ScrubMap::rate(0.25, -60.0, 12.0),
                at(400.0),
                Modifiers::default(),
                -6.0,
                writer(),
            );
            assert_eq!(host.changes, 0, "a press alone must not change the value");

            assert!(drive_value_drag(host, at(440.0), false, cx));
            assert_eq!(host.value, 4.0);
            assert!(drive_value_drag(host, at(360.0), false, cx));
            assert_eq!(
                host.value, -16.0,
                "dragging back retraces, it does not accumulate"
            );

            assert!(end_value_drag(host, at(400.0), false, cx));
            assert_eq!(host.value, -6.0, "back where it started");
        });
    }

    /// Alt mid-drag changes the rate from that point on. It must not jump the value, which is
    /// what recomputing the whole travel at the fine rate would do.
    #[gpui::test]
    fn alt_partway_through_slows_a_drag_number(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.0));
        view.update(cx, |host, cx| {
            begin_rate_drag(
                host,
                "gain".into(),
                ScrubMap::rate(1.0, -60.0, 12.0),
                at(400.0),
                Modifiers::default(),
                0.0,
                writer(),
            );
            drive_value_drag(host, at(410.0), false, cx);
            assert_eq!(host.value, 10.0);
            drive_value_drag(host, at(410.0 + 10.0), true, cx);
            assert!(
                (host.value - 4.0).abs() < 1e-4,
                "20px of travel at the fine rate is 4, not 20: {}",
                host.value
            );
        });
    }

    /// The one live gesture may belong to something that is not a widget. The dispatcher has to
    /// say so and leave it alone, or the editor's clip drags start being interpreted as values.
    #[gpui::test]
    fn a_gesture_that_is_not_a_widgets_is_left_alone(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.5));
        view.update(cx, |host, cx| {
            host.widgets_mut()
                .begin(Drag::new(Gesture::Other, at(10.0), Modifiers::default()));
            assert!(!drive_value_drag(host, at(200.0), false, cx));
            assert!(!end_value_drag(host, at(200.0), false, cx));
            assert_eq!(host.value, 0.5);
            assert!(
                host.widgets().is_dragging(),
                "someone else's gesture survives"
            );
        });
    }

    #[gpui::test]
    fn nothing_in_flight_means_nothing_to_drive(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.5));
        view.update(cx, |host, cx| {
            assert!(!drive_value_drag(host, at(200.0), false, cx));
            assert!(!end_value_drag(host, at(200.0), false, cx));
            assert_eq!(host.changes, 0);
        });
    }

    /// A still hand still generates move events. Applying on each of them redraws the editor for
    /// nothing, sixty times a second.
    #[gpui::test]
    fn a_repeated_position_does_not_reapply(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.0));
        view.update(cx, |host, cx| {
            begin_rate_drag(
                host,
                "gain".into(),
                ScrubMap::rate(1.0, 0.0, 100.0),
                at(400.0),
                Modifiers::default(),
                0.0,
                writer(),
            );
            drive_value_drag(host, at(410.0), false, cx);
            let after_first = host.changes;
            drive_value_drag(host, at(410.0), false, cx);
            assert_eq!(host.changes, after_first);
        });
    }

    /// A popover open when a drag starts has to go away, or it hangs over the control the user
    /// is now dragging.
    #[gpui::test]
    fn a_press_on_a_widget_dismisses_an_open_list(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.0));
        view.update(cx, |host, cx| {
            host.widgets_mut().toggle_popover("easing".into());
            assert!(host.widgets().open_popover().is_some());
            begin_rate_drag(
                host,
                "gain".into(),
                ScrubMap::rate(1.0, 0.0, 100.0),
                at(400.0),
                Modifiers::default(),
                0.0,
                writer(),
            );
            assert!(host.widgets().open_popover().is_none());

            host.widgets_mut().cancel();
            host.widgets_mut().toggle_popover("easing".into());
            dismiss_popover(host, cx);
            assert!(host.widgets().open_popover().is_none());
        });
    }

    /// While a widget is being dragged it draws the gesture's value, not the model's — the model
    /// may be a frame behind, and a thumb that lags the hand feels broken.
    #[gpui::test]
    fn the_widget_being_dragged_draws_the_live_value(cx: &mut TestAppContext) {
        let view = cx.new(|_| host(0.0));
        view.update(cx, |host, cx| {
            begin_rate_drag(
                host,
                "gain".into(),
                ScrubMap::rate(1.0, 0.0, 100.0),
                at(400.0),
                Modifiers::default(),
                0.0,
                // A callback that deliberately does not write back, standing in for a value the
                // engine has not applied yet.
                Rc::new(|_, _, _| {}),
            );
            drive_value_drag(host, at(430.0), false, cx);
            assert_eq!(host.dragged_value(&"gain".into()), Some(30.0));
            assert_eq!(
                host.dragged_value(&"other".into()),
                None,
                "one widget's gesture must not move another's thumb"
            );
        });
    }
}
