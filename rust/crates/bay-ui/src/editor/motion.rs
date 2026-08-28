//! The Motion page — how a thing moves.
//!
//! Three things live here, and nothing else: the curve and keyframe editor, the composition of
//! the layers stacked over one clip, and that clip's mask and shape. **No node graph** — ruled
//! out in `docs/native/pages.md`, which is the contract this file builds against.
//!
//! ## The rule that decides whether the page is any good
//!
//! The parameter list is **a row per animatable path, animated or not**. A page that lists only
//! *animated* properties is empty for every clip nobody has keyed yet, which is every clip the
//! first time a user opens it — a curve viewer rather than a curve editor. So every row carries
//! its rest line (a dashed line at the descriptor table's default) and a ◆ that keys it at the
//! playhead. The units, the ranges and the rest values all come from
//! `bay_project::animatable` — re-deriving them here is how the table and the drawing drift.
//!
//! ## The two timebases
//!
//! **Element channels are element-local; group channels are absolute scene time**
//! (`bay-project/src/scene.rs:64`). One pane draws both, so the conversion is a type rather
//! than a convention: [`ChannelOwner`] owns it, and every key that reaches the pane has gone
//! through [`ChannelOwner::scene_ticks`] on the way in and [`ChannelOwner::owner_ticks`] on the
//! way back out. Nothing else in this file may add an element start to a key time.
//!
//! ## Why the pane maps time the way the timeline does
//!
//! A curve is built out of `draw::Shape`s, and a `Shape` is built *before* layout — so the
//! pane's own laid-out width is not a number this code can have. Fitting the clip's span to the
//! pane width would need it. Mapping ticks to pixels through the page's own
//! [`crate::geometry::TimelineState`] does not: x is `geometry.ticks_to_px(t)` exactly as the
//! timeline's lanes are, and the canvas's content mask cuts whatever runs past the right edge.
//! It also means the zoom the page remembers is the zoom the curve pane uses.
//!
//! ## One undo entry per gesture
//!
//! Every control here emits a value on every pointer move, and each of those is a `Command`.
//! `bay-core` has no history coalescing — `Command::SetVolume`'s own doc says a dragged control
//! "has to coalesce into history as one gesture" and nothing does it — so a drag would otherwise
//! leave one undo entry per pixel travelled. [`Gesture`] collapses them here.

use std::cell::Cell;

use super::gesture::{fingerprint, Gesture};

use gpui::prelude::*;
use gpui::{div, px, rgb, Bounds, Context, Div, MouseDownEvent, Pixels, SharedString};

use bay_core::project::{
    AnimatableProperty, AnimationChannel, BezierHandles, Easing, Element, ElementGroup, Mask,
    MaskShape, ShapeKind,
};
use bay_core::{BlendMode, Command, ElementRef, KeyframeCurve, MediaTime, Transform};

use super::{timecode, EditorView};
use crate::controls::{self, DragNumber, ScrubMap, Select, SelectOption};
use crate::draw::{self, Shape};
use crate::theme;
use crate::view_model::EditorViewModel;
use crate::widgets;

// ---------------------------------------------------------------------------------------------
// The band geometry
// ---------------------------------------------------------------------------------------------

/// The curve band, and its header.
///
/// 342 is not a taste: the Cut page puts a 40px scene bar and a 300px timeline below its
/// transport, each with a 1px top border. `pages.md` calls the transport **the horizon line of
/// the app** — it must land the same distance from the window top on every page that has one —
/// and that is only true if what sits below it weighs the same.
const BAND_HEIGHT: f32 = 342.0;
const BAND_HEADER: f32 = 40.0;
/// What is left for the parameter list and the curve pane, once the header and its border are.
const BAND_BODY: f32 = BAND_HEIGHT - BAND_HEADER - 1.0;
/// Vertical padding inside the curve pane, and therefore the plotting height.
const PANE_PAD: f32 = 10.0;
const PANE_HEIGHT: f32 = BAND_BODY - PANE_PAD * 2.0;

/// The parameter list's width, and one row's height.
///
/// Deliberately *not* `flex_none`: at 640px of window the list gives way to the curves rather
/// than pushing them off the screen.
const PARAM_WIDTH: f32 = 336.0;
const PARAM_ROW: f32 = 26.0;
/// The inline rest/curve strip in a parameter row. Fixed, so its shapes can be built before
/// layout — see the module note about the pane.
const STRIP_WIDTH: f32 = 84.0;
const STRIP_HEIGHT: f32 = 14.0;

/// The two flanking panels of the top band.
const SIDE_WIDTH: f32 = 288.0;

/// Key dot, bezier handle dot, and the square a pointer has to land in to grab either.
const KEY_RADIUS: f32 = 3.5;
const HANDLE_RADIUS: f32 = 2.5;
const HIT: f32 = 13.0;

/// Breathing room left either side of a clip fitted to the pane, so its first and last keys
/// are grabbable rather than glued to the edge.
const FIT_INSET: f32 = 16.0;

/// How far past the pane's left edge a key is still built. There is no right-hand bound because
/// the pane's width is not known here; the count is bounded by the number of keys, not by the
/// width, so there is nothing to cull.
const CULL_LEFT: f32 = -HIT;

/// The colours a curve is drawn in, cycled per animated channel. Theme tokens rather than new
/// constants, and **not** `ACCENT`: that is the playhead, and a curve wearing the playhead's
/// colour is a curve that reads as a playhead.
const CURVE_COLORS: [u32; 5] = [
    theme::MARKER,
    theme::OK,
    theme::RECORD,
    theme::ACCENT_SOFT,
    theme::TEXT,
];

/// Alt's sensitivity on the value axis.
///
/// The same fraction `controls::FINE_FACTOR` uses on the time axis, restated because that
/// constant is private to the widget layer. Note the asymmetry, which is real: the time axis
/// goes through `ScrubMap`, which reads Alt from the **live** modifiers; the value axis is
/// computed here from the drag, which only carries the modifiers held at the press.
const FINE_FACTOR: f32 = 0.2;

// ---------------------------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------------------------

/// The value axis for one channel: what the top and bottom of the pane are worth.
///
/// Fitted, not fixed. The descriptor table's range is the starting point *and only that* — it
/// says so itself: a rotation of 720° and a scale of 6 are legal, and an axis that clamped them
/// would draw a curve the project does not contain. So the range is grown to hold every key and
/// the rest value, and a property with no range at all (a shader parameter, a font size) gets an
/// axis fitted to its own keys, which is the honest answer there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ValueAxis {
    low: f32,
    high: f32,
}

impl ValueAxis {
    /// Fit an axis around a property's advertised range, its rest value, and the keys it carries.
    pub(crate) fn fit(range: Option<(f32, f32)>, default: f32, keys: &[f32]) -> Self {
        let (mut low, mut high) = match range {
            Some((low, high)) if low.is_finite() && high.is_finite() && low < high => (low, high),
            _ if default.is_finite() => (default, default),
            _ => (0.0, 1.0),
        };
        if default.is_finite() {
            low = low.min(default);
            high = high.max(default);
        }
        for value in keys.iter().copied().filter(|value| value.is_finite()) {
            low = low.min(value);
            high = high.max(value);
        }
        if !(low.is_finite() && high.is_finite()) {
            return Self {
                low: 0.0,
                high: 1.0,
            };
        }
        if high - low <= f32::EPSILON {
            // A channel that never moves still needs a drawable axis, and one of zero extent
            // divides by zero. Centre it on the value it holds.
            let pad = high.abs().max(1.0) * 0.5;
            return Self {
                low: low - pad,
                high: high + pad,
            };
        }
        // A key sitting exactly on the range's end would otherwise be drawn half outside the
        // pane, where the content mask cuts it in half.
        let pad = (high - low) * 0.08;
        Self {
            low: low - pad,
            high: high + pad,
        }
    }

    /// Where `value` sits on the axis, 0 at the bottom and 1 at the top. Unclamped: a value
    /// dragged past the axis draws outside the pane and is cut by the content mask, which is
    /// what should happen while a drag is in flight.
    pub(crate) fn fraction(self, value: f32) -> f32 {
        (value - self.low) / (self.high - self.low)
    }

    pub(crate) fn value_at(self, fraction: f32) -> f32 {
        self.low + fraction * (self.high - self.low)
    }

    /// Pane-local y of a value, given a pane `height`. Zero is the top, so the axis is flipped.
    pub(crate) fn y_of(self, value: f32, height: f32) -> f32 {
        (1.0 - self.fraction(value)) * height
    }

    /// The inverse of [`Self::y_of`].
    pub(crate) fn value_of_y(self, y: f32, height: f32) -> f32 {
        self.value_at(1.0 - y / height.max(1.0))
    }
}

// ---------------------------------------------------------------------------------------------
// The two timebases
// ---------------------------------------------------------------------------------------------

/// What a channel hangs off, and therefore what its key times mean.
///
/// The whole of the conversion `pages.md` names as the Motion page's silent failure. An element
/// channel's keys are relative to the element's start; a group's are absolute scene time, because
/// a group is not on a track and has no start to be relative to. Drawing both in one pane means
/// exactly one of them is offset, and getting it backwards moves a curve by the length of the
/// clip without erroring.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ChannelOwner {
    /// An element's own channel. Keys are element-local.
    Element {
        reference: ElementRef,
        start_ticks: i64,
    },
    /// A group's channel. Keys are already scene time.
    Group { id: String },
}

impl ChannelOwner {
    /// A key's time as absolute scene time — what the pane's x axis is measured in.
    pub(crate) fn scene_ticks(&self, key_ticks: i64) -> i64 {
        match self {
            ChannelOwner::Element { start_ticks, .. } => start_ticks + key_ticks,
            ChannelOwner::Group { .. } => key_ticks,
        }
    }

    /// Scene time back in the units this channel stores. The exact inverse of
    /// [`Self::scene_ticks`], so a key dragged to a pixel and read back lands on the same pixel.
    pub(crate) fn owner_ticks(&self, scene_ticks: i64) -> i64 {
        match self {
            ChannelOwner::Element { start_ticks, .. } => scene_ticks - start_ticks,
            ChannelOwner::Group { .. } => scene_ticks,
        }
    }
}

/// One row of the parameter list: a path that can be keyed, whatever it carries today, and
/// everything needed to draw it.
pub(crate) struct CurveRow {
    property: AnimatableProperty,
    owner: ChannelOwner,
    /// `None` for a property with no keys on it — which is most of them, most of the time, and
    /// the case the page is judged on.
    channel: Option<AnimationChannel>,
    axis: ValueAxis,
    color: u32,
    /// The value at the playhead: sampled if animated, the rest value if not.
    now: f32,
}

impl CurveRow {
    fn is_animated(&self) -> bool {
        self.channel.as_ref().is_some_and(|c| !c.keys.is_empty())
    }
}

// ---------------------------------------------------------------------------------------------
// One undo entry per gesture
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

impl EditorView {
    pub(super) fn motion_page(&self, cx: &mut gpui::Context<Self>) -> Div {
        let vm = EditorViewModel::build(&self.editor);
        let selected = self.motion_subject();

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .bg(rgb(theme::BG))
            .child(self.toolbar(&vm, cx))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.motion_composite(&vm, cx))
                    .child(
                        // Picture over transport, the same column the Cut page builds, so the
                        // two pages put the transport on one line.
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(self.preview(&vm))
                            .child(self.motion_transport(&vm, cx)),
                    )
                    .child(self.motion_shape_panel(selected.as_ref(), cx)),
            )
            .child(self.motion_band(selected.as_ref(), cx))
    }

    /// The clip the page is about: the selection, or — with nothing selected — nothing.
    ///
    /// Not "whatever is under the playhead": a page that silently retargets as the playhead
    /// moves would key a property on a clip the user never pointed at.
    fn motion_subject(&self) -> Option<ElementRef> {
        self.editor.selection().first().cloned()
    }

    fn motion_element(&self, reference: &ElementRef) -> Option<&Element> {
        self.editor.active_scene().element(reference)
    }

    /// The group `reference` belongs to, if any.
    fn motion_group(&self, reference: &ElementRef) -> Option<&ElementGroup> {
        self.editor
            .active_scene()
            .groups
            .values()
            .find(|group| group.children.iter().any(|id| id == &reference.element_id))
    }
}

// ---------------------------------------------------------------------------------------------
// Band 1, left — layer composition over one clip
// ---------------------------------------------------------------------------------------------

impl EditorView {
    /// The stack of visual layers active at the playhead, bottom of the composite first.
    ///
    /// This is what "layer composition over one clip" means with the compositor bay actually
    /// has: the main lane, then each overlay lane in order, each layer with the two controls
    /// that decide how it lands on what is beneath it — blend mode and opacity. Both are backed
    /// (`SetBlendMode`, `SetTransform`); nothing here is a label pretending to be a control.
    fn motion_composite(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let playhead = self.editor.playhead();
        let scene = self.editor.active_scene();
        let mut layers: Vec<(ElementRef, String, String, BlendMode, f32)> = Vec::new();
        for track in std::iter::once(&scene.tracks.main).chain(scene.tracks.overlay.iter()) {
            if track.hidden {
                continue;
            }
            for element in &track.elements {
                if element.start() > playhead || playhead >= element.end() {
                    continue;
                }
                let Some(transform) = element.transform() else {
                    continue;
                };
                let local = MediaTime::from_ticks(playhead.as_ticks() - element.start().as_ticks());
                let opacity = element
                    .sampled_transform(local)
                    .map(|t| t.opacity)
                    .unwrap_or(transform.opacity);
                layers.push((
                    ElementRef::new(track.id.clone(), element.id().to_string()),
                    element.name().to_string(),
                    format!("{:?}", element.kind()).to_lowercase(),
                    element.blend_mode().unwrap_or_default(),
                    opacity,
                ));
            }
        }
        // Top of the composite at the top of the list, which is the order every compositing
        // application shows and the reverse of the order the renderer walks.
        layers.reverse();

        let empty = layers.is_empty();
        let mut list = div()
            .id("motion-layers")
            .flex()
            .flex_col()
            .gap(px(2.0))
            .flex_1()
            .min_h(px(0.0))
            .overflow_y_scroll();
        for (index, (reference, name, kind, blend, opacity)) in layers.into_iter().enumerate() {
            list =
                list.child(self.motion_layer_row(index, reference, name, kind, blend, opacity, cx));
        }

        let _ = vm;
        div()
            .w(px(SIDE_WIDTH))
            .min_w(px(0.0))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .p(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("COMPOSITE"))
            .child(
                widgets::note("Every visual layer live at the playhead, top of the stack first.")
                    .text_color(rgb(theme::FAINT)),
            )
            .child(list)
            .children(empty.then(|| {
                widgets::note("Nothing is on screen at the playhead. Move it over a clip.")
            }))
    }

    #[allow(clippy::too_many_arguments)]
    fn motion_layer_row(
        &self,
        index: usize,
        reference: ElementRef,
        name: String,
        kind: String,
        blend: BlendMode,
        opacity: f32,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        let selected = self.editor.is_selected(&reference);
        let modes = blend_modes();
        let current = modes.iter().position(|(mode, _)| *mode == blend);

        let pick_reference = reference.clone();
        let blend_select = Select::new(
            SharedString::from(format!("motion-blend-{}", reference.element_id)),
            modes
                .iter()
                .map(|(_, label)| SelectOption::new(*label))
                .collect(),
        )
        .selected(current)
        .width(112.0)
        .render(self, cx, move |view, index, _cx| {
            let Some((mode, _)) = blend_modes().get(index).copied() else {
                return;
            };
            view.editor.execute(Command::SetBlendMode {
                reference: pick_reference.clone(),
                blend_mode: mode,
            });
        });

        let opacity_reference = reference.clone();
        let gesture = Gesture::new();
        let opacity_number = DragNumber::new(
            SharedString::from(format!("motion-opacity-{}", reference.element_id)),
            opacity,
            0.0,
            1.0,
            0.004,
        )
        .detent(1.0)
        .reset(1.0)
        .width(56.0)
        .format(|value| format!("{:.0}%", value * 100.0))
        .render(self, cx, move |view, value, _cx| {
            let reference = opacity_reference.clone();
            gesture.commit(
                view,
                |view| element_fingerprint(view, &reference),
                |view| {
                    let Some(mut transform) = view
                        .motion_element(&opacity_reference)
                        .and_then(|element| element.transform())
                    else {
                        return 0;
                    };
                    transform.opacity = value;
                    u8::from(view.editor.execute(Command::SetTransform {
                        reference: opacity_reference.clone(),
                        transform,
                    }))
                },
            );
        });

        let click_reference = reference.clone();
        div()
            .id(("motion-layer", index))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .px(px(6.0))
            .py(px(4.0))
            .rounded(px(4.0))
            .bg(rgb(if selected {
                theme::SELECTED
            } else {
                theme::PANEL_ALT
            }))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(theme::HOVER)))
            .on_click(cx.listener(move |view, _event, _window, cx| {
                view.editor.select(vec![click_reference.clone()]);
                cx.notify();
            }))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w(px(0.0))
                    .overflow_hidden()
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(name)),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(Self::shared(kind)),
                    ),
            )
            .child(blend_select)
            .child(opacity_number)
    }
}

/// The blend modes, with the labels the inspector already uses.
fn blend_modes() -> Vec<(BlendMode, &'static str)> {
    vec![
        (BlendMode::Normal, "Normal"),
        (BlendMode::Darken, "Darken"),
        (BlendMode::Multiply, "Multiply"),
        (BlendMode::ColorBurn, "Colour burn"),
        (BlendMode::Lighten, "Lighten"),
        (BlendMode::Screen, "Screen"),
        (BlendMode::PlusLighter, "Plus lighter"),
        (BlendMode::ColorDodge, "Colour dodge"),
        (BlendMode::Overlay, "Overlay"),
        (BlendMode::SoftLight, "Soft light"),
        (BlendMode::HardLight, "Hard light"),
        (BlendMode::Difference, "Difference"),
        (BlendMode::Exclusion, "Exclusion"),
        (BlendMode::Hue, "Hue"),
        (BlendMode::Saturation, "Saturation"),
        (BlendMode::Color, "Colour"),
    ]
}

fn element_fingerprint(view: &EditorView, reference: &ElementRef) -> u64 {
    match view.motion_element(reference) {
        Some(element) => fingerprint(serde_json::to_string(element)),
        None => 0,
    }
}

fn group_fingerprint(view: &EditorView, id: &str) -> u64 {
    match view.editor.active_scene().groups.get(id) {
        Some(group) => fingerprint(serde_json::to_string(group)),
        None => 0,
    }
}

// ---------------------------------------------------------------------------------------------
// Band 1, right — masks and shapes
// ---------------------------------------------------------------------------------------------

impl EditorView {
    /// The mask over one clip, and — for a shape — its own geometry.
    ///
    /// What the engine has is **one** ellipse or rectangle per element, keyframable through
    /// `mask.x` / `mask.y` / `mask.width` / `mask.height` / `mask.feather`. Polygon and bezier
    /// masks do not exist, and neither do multiple windows on one clip. Per `pages.md` those are
    /// drawn as ordinary controls and **disabled** rather than hidden: the disabled controls are
    /// the map of the remaining engine work, and that map is worth having on screen.
    fn motion_shape_panel(&self, selected: Option<&ElementRef>, cx: &mut Context<Self>) -> Div {
        let element = selected.and_then(|reference| self.motion_element(reference));
        let mask = element.and_then(|element| element.mask());
        let maskable = element.is_some_and(|element| element.transform().is_some());

        let mut panel = div()
            .w(px(SIDE_WIDTH))
            .min_w(px(0.0))
            .flex()
            .flex_col()
            .gap(px(8.0))
            .p(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("MASK"));

        let Some(reference) = selected.cloned() else {
            return panel.child(widgets::note("Select a clip to mask it."));
        };
        if !maskable {
            return panel.child(widgets::note("Audio has no picture to mask."));
        }

        let toggle_reference = reference.clone();
        panel = panel.child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(px(6.0))
                .child(self.motion_button(
                    ("motion-mask-toggle", 0),
                    if mask.is_some() {
                        "Remove mask"
                    } else {
                        "Add mask"
                    },
                    true,
                    cx,
                    move |view, _cx| {
                        let next = match view
                            .motion_element(&toggle_reference)
                            .and_then(|element| element.mask())
                        {
                            Some(_) => None,
                            None => Some(Mask::default()),
                        };
                        view.set_element_mask(&toggle_reference, next);
                    },
                ))
                // Every element carries at most one mask, so a second window has nowhere to go.
                .child(self.motion_button(
                    ("motion-mask-add", 0),
                    "＋ Window",
                    false,
                    cx,
                    |_view, _cx| {},
                )),
        );

        let Some(mask) = mask else {
            return panel.child(widgets::note(
                "No mask. One ellipse or rectangle per clip; each of its five numbers can be keyed.",
            ));
        };

        let shape_reference = reference.clone();
        let shapes = [
            SelectOption::new("Ellipse"),
            SelectOption::new("Rectangle"),
            SelectOption::new("Polygon")
                .detail("No polygon mask in the compositor")
                .enabled(false),
            SelectOption::new("Bezier")
                .detail("No bezier mask in the compositor")
                .enabled(false),
        ];
        panel = panel.child(
            Select::new("motion-mask-shape", shapes.to_vec())
                .selected(Some(match mask.shape {
                    MaskShape::Ellipse => 0,
                    MaskShape::Rect => 1,
                }))
                .width(150.0)
                .render(self, cx, move |view, index, _cx| {
                    let shape = match index {
                        0 => MaskShape::Ellipse,
                        1 => MaskShape::Rect,
                        // The other two are drawn disabled; `Select` refuses them, and this
                        // arm exists so a future option cannot silently pick ellipse.
                        _ => return,
                    };
                    let Some(mut mask) = view
                        .motion_element(&shape_reference)
                        .and_then(|element| element.mask())
                    else {
                        return;
                    };
                    mask.shape = shape;
                    view.set_element_mask(&shape_reference, Some(mask));
                }),
        );

        for (index, (label, value, path)) in [
            ("Centre X", mask.x, "mask.x"),
            ("Centre Y", mask.y, "mask.y"),
            ("Width", mask.width, "mask.width"),
            ("Height", mask.height, "mask.height"),
            ("Feather", mask.feather, "mask.feather"),
        ]
        .into_iter()
        .enumerate()
        {
            panel = panel.child(self.motion_mask_row(index, &reference, label, path, value, cx));
        }

        let invert_reference = reference.clone();
        panel = panel.child(self.motion_button(
            ("motion-mask-invert", 0),
            if mask.inverted {
                "Inverted ✓"
            } else {
                "Invert"
            },
            true,
            cx,
            move |view, _cx| {
                let Some(mut mask) = view
                    .motion_element(&invert_reference)
                    .and_then(|element| element.mask())
                else {
                    return;
                };
                mask.inverted = !mask.inverted;
                view.set_element_mask(&invert_reference, Some(mask));
            },
        ));

        // A shape element has geometry of its own, and both of its numbers are keyable — which
        // is why they are here rather than in the inspector.
        if let Some(Element::Shape(shape)) = self.motion_element(&reference) {
            panel = panel.child(widgets::section("SHAPE"));
            if let ShapeKind::Rect { radius } = shape.shape {
                panel = panel.child(self.motion_shape_row(
                    0,
                    &reference,
                    "Corner radius",
                    radius,
                    0.0,
                    0.5,
                    cx,
                ));
            }
            if let Some(stroke) = &shape.stroke {
                panel = panel.child(self.motion_shape_row(
                    1,
                    &reference,
                    "Stroke width",
                    stroke.width,
                    0.0,
                    0.5,
                    cx,
                ));
            } else {
                panel = panel.child(widgets::note(
                    "No stroke. A width channel cannot bring one into existence — the colour is not a number.",
                ));
            }
        }

        panel.child(widgets::note(
            "On-canvas mask handles are not built: the viewer draws the composited frame and has no overlay layer.",
        ))
    }

    fn motion_mask_row(
        &self,
        index: usize,
        reference: &ElementRef,
        label: &'static str,
        path: &'static str,
        value: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let drag_reference = reference.clone();
        let gesture = Gesture::new();
        let number = DragNumber::new(
            SharedString::from(format!("motion-{path}")),
            value,
            0.0,
            2.0,
            0.004,
        )
        .width(64.0)
        .format(|value| format!("{value:.3}"))
        .render(self, cx, move |view, value, _cx| {
            let reference = drag_reference.clone();
            gesture.commit(
                view,
                |view| element_fingerprint(view, &reference),
                |view| {
                    let Some(mut mask) = view
                        .motion_element(&drag_reference)
                        .and_then(|element| element.mask())
                    else {
                        return 0;
                    };
                    match path {
                        "mask.x" => mask.x = value,
                        "mask.y" => mask.y = value,
                        "mask.width" => mask.width = value,
                        "mask.height" => mask.height = value,
                        "mask.feather" => mask.feather = value,
                        _ => return 0,
                    }
                    u8::from(view.set_element_mask(&drag_reference, Some(mask)))
                },
            );
        });

        let key_reference = reference.clone();
        widgets::row()
            .gap(px(6.0))
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(label),
            )
            .child(number)
            .child(self.motion_button(
                ("motion-mask-key", index),
                "◆",
                true,
                cx,
                move |view, _cx| {
                    view.key_property_at_playhead(&key_reference, path);
                },
            ))
    }

    #[allow(clippy::too_many_arguments)]
    fn motion_shape_row(
        &self,
        index: usize,
        reference: &ElementRef,
        label: &'static str,
        value: f32,
        min: f32,
        max: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let drag_reference = reference.clone();
        let radius = index == 0;
        let gesture = Gesture::new();
        let number = DragNumber::new(
            SharedString::from(format!("motion-shape-{index}")),
            value,
            min,
            max,
            0.002,
        )
        .width(64.0)
        .format(|value| format!("{value:.3}"))
        .render(self, cx, move |view, value, _cx| {
            let reference = drag_reference.clone();
            gesture.commit(
                view,
                |view| element_fingerprint(view, &reference),
                |view| {
                    let Some(Element::Shape(shape)) = view.motion_element(&drag_reference) else {
                        return 0;
                    };
                    let mut shape = shape.clone();
                    if radius {
                        if let ShapeKind::Rect { radius } = &mut shape.shape {
                            *radius = value;
                        }
                    } else if let Some(stroke) = &mut shape.stroke {
                        stroke.width = value;
                    }
                    u8::from(view.editor.execute(Command::ReplaceElement {
                        reference: drag_reference.clone(),
                        element: Element::Shape(shape),
                    }))
                },
            );
        });

        let path = if radius {
            "shape.radius"
        } else {
            "stroke.width"
        };
        let key_reference = reference.clone();
        widgets::row()
            .gap(px(6.0))
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(label),
            )
            .child(number)
            .child(self.motion_button(
                ("motion-shape-key", index),
                "◆",
                true,
                cx,
                move |view, _cx| {
                    view.key_property_at_playhead(&key_reference, path);
                },
            ))
    }

    /// Replace an element's mask, as one undoable edit. Returns whether anything changed.
    ///
    /// A mask has no command of its own, so this is `ReplaceElement` with an edited copy —
    /// which is exactly what that command's doc says it is for.
    fn set_element_mask(&mut self, reference: &ElementRef, mask: Option<Mask>) -> bool {
        let Some(element) = self.motion_element(reference) else {
            return false;
        };
        let mut edited = element.clone();
        edited.set_mask(mask);
        self.editor.execute(Command::ReplaceElement {
            reference: reference.clone(),
            element: edited,
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Band 2 — the transport
// ---------------------------------------------------------------------------------------------

impl EditorView {
    /// The transport, at the Cut page's height so the horizon line holds.
    ///
    /// The Cut page's transport is reused nowhere here because two of its controls — fit to
    /// window, and the zoom that anchors on the lane — are measured against the timeline's lane
    /// width, which this page does not have. What is left is what a curve editor needs: move the
    /// playhead, and change how much time a pixel is worth.
    fn motion_transport(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let now = timecode(vm.playhead_seconds);
        let total = timecode(vm.duration_seconds);
        let playing = self.playing;
        let pps = self.timeline.pixels_per_second();

        widgets::row()
            .h(px(54.0))
            .flex_none()
            .justify_center()
            .gap(px(14.0))
            .px(px(16.0))
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("motion-start", "⏮", cx, |view| {
                        view.editor.seek(MediaTime::ZERO);
                    }))
                    .child(self.transport_button("motion-back", "◀◀", cx, |view| {
                        view.step_frames(-1);
                    }))
                    .child(self.transport_button(
                        "motion-play",
                        if playing { "⏸" } else { "▶" },
                        cx,
                        |view| view.toggle_play(),
                    ))
                    .child(self.transport_button("motion-forward", "▶▶", cx, |view| {
                        view.step_frames(1);
                    }))
                    .child(self.transport_button("motion-end", "⏭", cx, |view| {
                        let end = view.editor.duration();
                        view.editor.seek(end);
                    })),
            )
            .child(widgets::readout(format!("{now} / {total}"), false))
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("motion-zoom-out", "－", cx, |view| {
                        let pps = view.timeline.pixels_per_second();
                        view.timeline = view.timeline.with_pixels_per_second(pps / 1.5);
                    }))
                    .child(widgets::readout(format!("{pps:.0} px/s"), true))
                    .child(self.transport_button("motion-zoom-in", "＋", cx, |view| {
                        let pps = view.timeline.pixels_per_second();
                        view.timeline = view.timeline.with_pixels_per_second(pps * 1.5);
                    })),
            )
    }
}

// ---------------------------------------------------------------------------------------------
// Band 3 — the curve and keyframe editor
// ---------------------------------------------------------------------------------------------

impl EditorView {
    fn motion_band(&self, selected: Option<&ElementRef>, cx: &mut Context<Self>) -> Div {
        let rows = selected
            .map(|reference| self.motion_rows(reference))
            .unwrap_or_default();
        // Where the curve pane lands, filled during prepaint and read back by the mouse
        // handlers built in this same pass. The header's "Fit" needs it as much as the pane's
        // own hit-testing does: fitting a clip to the pane means knowing how wide the pane is,
        // and that is not a number an element tree being *built* can have.
        let bounds: std::rc::Rc<Cell<Bounds<Pixels>>> =
            std::rc::Rc::new(Cell::new(Bounds::default()));

        div()
            .h(px(BAND_HEIGHT))
            // Not `flex_none`. On a window too short for the three bands the curve band gives
            // way instead of pushing the picture off the top — at 560px of window height the
            // fixed chrome alone is 440 of it, and a band that refuses to shrink overlaps the
            // panel above rather than losing its own last rows.
            .flex_shrink()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .child(self.motion_band_header(selected, &rows, &bounds, cx))
            .child(
                div()
                    .h(px(BAND_BODY))
                    .flex_shrink()
                    .flex()
                    .flex_row()
                    .min_w(px(0.0))
                    .min_h(px(0.0))
                    .overflow_hidden()
                    .child(self.motion_param_list(&rows, cx))
                    .child(self.motion_curve_pane(&rows, &bounds, cx)),
            )
    }

    fn motion_band_header(
        &self,
        selected: Option<&ElementRef>,
        rows: &[CurveRow],
        bounds: &std::rc::Rc<Cell<Bounds<Pixels>>>,
        cx: &mut Context<Self>,
    ) -> Div {
        let name = selected
            .and_then(|reference| self.motion_element(reference))
            .map(|element| element.name().to_string())
            .unwrap_or_else(|| "no clip selected".to_string());
        let animated = rows.iter().filter(|row| row.is_animated()).count();
        let keys: usize = rows
            .iter()
            .filter_map(|row| row.channel.as_ref())
            .map(|channel| channel.keys.len())
            .sum();

        widgets::row()
            .h(px(BAND_HEADER))
            .flex_none()
            .gap(px(10.0))
            .px(px(10.0))
            .bg(rgb(theme::PANEL_ALT))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("CURVES"))
            .child(widgets::readout(name, false))
            .child(widgets::readout(
                format!("{animated} animated · {keys} keys"),
                true,
            ))
            .child({
                // Without this the pane is a clip's four seconds inside half a minute of
                // timeline: the curves land in a tenth of the width and the rest is empty.
                let reference = selected.cloned();
                let bounds = bounds.clone();
                self.motion_button(("motion-fit", 0), "Fit clip", reference.is_some(), cx, {
                    move |view, _cx| {
                        let Some(reference) = reference.clone() else {
                            return;
                        };
                        view.fit_clip_to_pane(&reference, bounds.get());
                    }
                })
            })
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .overflow_hidden()
                    .child("Drag a key to move it · ⌥-click to draw its curve · ⌘-click to delete"),
            )
            // Per-key *named* easing needs a selected key, and a selected key needs
            // `SelectionState::keyframes` to be reachable from the UI. It exists in `bay-core`
            // and no `Command` writes it, so this control cannot be backed — drawn and
            // disabled, per `pages.md`, rather than hidden.
            .child(
                Select::new(
                    "motion-key-easing",
                    easings()
                        .iter()
                        .map(|(_, label)| SelectOption::new(*label))
                        .collect(),
                )
                .placeholder("Key easing")
                .width(130.0)
                .enabled(false)
                .render(self, cx, |_view, _index, _cx| {}),
            )
    }

    /// One row per animatable path, animated or not.
    ///
    /// The whole reason the page is not empty for a clip nobody has keyed. Element rows come
    /// first, then the rows of the group the clip belongs to — those are drawn from the same
    /// descriptor table and live on the other timebase.
    fn motion_rows(&self, reference: &ElementRef) -> Vec<CurveRow> {
        let Some(element) = self.motion_element(reference) else {
            return Vec::new();
        };
        let start_ticks = element.start().as_ticks();
        let playhead = self.editor.playhead().as_ticks();
        let local = MediaTime::from_ticks(playhead - start_ticks);
        let animations = element.animations();

        let mut rows: Vec<CurveRow> = Vec::new();
        let mut color = 0usize;
        for property in element.animatable_paths() {
            let channel = animations
                .and_then(|map| map.get(&property.path))
                .filter(|channel| !channel.keys.is_empty())
                .cloned();
            let keys: Vec<f32> = channel
                .as_ref()
                .map(|channel| channel.keys.iter().map(|key| key.value).collect())
                .unwrap_or_default();
            let now = channel
                .as_ref()
                .and_then(|channel| channel.sample(local))
                .unwrap_or(property.default);
            let axis = ValueAxis::fit(property.range, property.default, &keys);
            let animated = channel.is_some();
            rows.push(CurveRow {
                property,
                owner: ChannelOwner::Element {
                    reference: reference.clone(),
                    start_ticks,
                },
                channel,
                axis,
                color: CURVE_COLORS[color % CURVE_COLORS.len()],
                now,
            });
            if animated {
                color += 1;
            }
        }

        if let Some(group) = self.motion_group(reference) {
            let scene_now = self.editor.playhead();
            for path in ElementGroup::ANIMATABLE {
                let Some(kind) = bay_core::project::describe_path(path) else {
                    continue;
                };
                let default = group_default(&group.transform, path);
                let channel = group
                    .animations
                    .get(path)
                    .filter(|channel| !channel.keys.is_empty())
                    .cloned();
                let keys: Vec<f32> = channel
                    .as_ref()
                    .map(|channel| channel.keys.iter().map(|key| key.value).collect())
                    .unwrap_or_default();
                // Sampled at *scene* time, not element-local. This is the whole conversion.
                let now = channel
                    .as_ref()
                    .and_then(|channel| channel.sample(scene_now))
                    .unwrap_or(default);
                let axis = ValueAxis::fit(kind.range, default, &keys);
                let animated = channel.is_some();
                rows.push(CurveRow {
                    property: AnimatableProperty {
                        path: path.to_string(),
                        label: format!("Group {}", kind.label.to_lowercase()),
                        unit: kind.unit,
                        range: kind.range,
                        default,
                    },
                    owner: ChannelOwner::Group {
                        id: group.id.clone(),
                    },
                    channel,
                    axis,
                    color: CURVE_COLORS[color % CURVE_COLORS.len()],
                    now,
                });
                if animated {
                    color += 1;
                }
            }
        }

        rows
    }

    fn motion_param_list(&self, rows: &[CurveRow], cx: &mut Context<Self>) -> gpui::Stateful<Div> {
        let mut list = div()
            .id("motion-params")
            .w(px(PARAM_WIDTH))
            .min_w(px(0.0))
            .flex()
            .flex_col()
            .gap(px(1.0))
            .p(px(6.0))
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .overflow_y_scroll();

        if rows.is_empty() {
            return list.child(widgets::note(
                "Select a clip. Every property it can animate gets a row here, keyed or not.",
            ));
        }
        for (index, row) in rows.iter().enumerate() {
            list = list.child(self.motion_param_row(index, row, cx));
        }
        list
    }

    fn motion_param_row(&self, index: usize, row: &CurveRow, cx: &mut Context<Self>) -> Div {
        let animated = row.is_animated();
        let suffix = row.property.unit.suffix();
        let value = format!("{:.3}{suffix}", row.now);
        let owner = row.owner.clone();
        let path = row.property.path.clone();

        widgets::row()
            .h(px(PARAM_ROW))
            .flex_none()
            .gap(px(6.0))
            .px(px(4.0))
            .rounded(px(3.0))
            .child(
                // The swatch is the legend: the pane draws this channel in this colour.
                div()
                    .w(px(6.0))
                    .h(px(6.0))
                    .rounded(px(3.0))
                    .flex_none()
                    .bg(rgb(if animated { row.color } else { theme::DIM_DOT })),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_xs()
                    .overflow_hidden()
                    .text_color(rgb(if animated { theme::TEXT } else { theme::MUTED }))
                    .child(Self::shared(row.property.label.clone())),
            )
            .child(
                div()
                    .w(px(STRIP_WIDTH))
                    .h(px(STRIP_HEIGHT))
                    .flex_none()
                    .child(draw::paint(row_strip(row))),
            )
            .child(
                div()
                    .w(px(62.0))
                    .flex_none()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(value)),
            )
            .child(
                self.motion_button(("motion-key", index), "◆", true, cx, move |view, _cx| {
                    match &owner {
                        ChannelOwner::Element { reference, .. } => {
                            view.key_property_at_playhead(&reference.clone(), &path);
                        }
                        ChannelOwner::Group { id } => {
                            view.key_group_property_at_playhead(&id.clone(), &path);
                        }
                    }
                }),
            )
    }
}

/// The value of one of a group's seven channels with nothing keyed on it.
///
/// A `match` rather than a lookup, so the seven stay tied to `ElementGroup::ANIMATABLE`.
fn group_default(transform: &Transform, path: &str) -> f32 {
    match path {
        "opacity" => transform.opacity,
        "scale" => transform.scale,
        "x" => transform.x,
        "y" => transform.y,
        "rotation" => transform.rotation,
        "scaleX" => transform.scale_x,
        "scaleY" => transform.scale_y,
        _ => 0.0,
    }
}

/// The inline strip in a parameter row: the channel's own shape, or — the case that matters —
/// **a dashed rest line at the property's default**, for a property nobody has keyed.
///
/// Its own width is a constant, so unlike the pane its shapes can be built before layout.
fn row_strip(row: &CurveRow) -> Vec<Shape> {
    let y = row.axis.y_of(row.property.default, STRIP_HEIGHT);
    let rest = Shape::dashed(
        vec![
            gpui::point(px(0.0), px(y)),
            gpui::point(px(STRIP_WIDTH), px(y)),
        ],
        1.0,
        theme::DIM_DOT,
        [3.0, 3.0],
    );
    let Some(channel) = row.channel.as_ref().filter(|c| !c.keys.is_empty()) else {
        return vec![rest];
    };

    let first = channel.keys.first().map(|key| key.time).unwrap_or_default();
    let last = channel.keys.last().map(|key| key.time).unwrap_or_default();
    let span = (last.as_ticks() - first.as_ticks()).max(1) as f32;
    let points: Vec<gpui::Point<Pixels>> = channel
        .polyline(first..=last)
        .into_iter()
        .map(|(time, value)| {
            let x = (time.as_ticks() - first.as_ticks()) as f32 / span * STRIP_WIDTH;
            gpui::point(px(x), px(row.axis.y_of(value, STRIP_HEIGHT)))
        })
        .collect();
    vec![rest, Shape::line(points, 1.2, row.color)]
}

/// The easing vocabulary, in the order `Easing` declares it.
fn easings() -> Vec<(Easing, &'static str)> {
    vec![
        (Easing::Linear, "Linear"),
        (Easing::EaseIn, "Ease in"),
        (Easing::EaseOut, "Ease out"),
        (Easing::EaseInOut, "Ease in-out"),
        (Easing::PowerOut, "Power out"),
        (Easing::PowerIn, "Power in"),
        (Easing::ExpoOut, "Expo out"),
        (Easing::ExpoIn, "Expo in"),
        (Easing::Power4Out, "Power4 out"),
        (Easing::Power4In, "Power4 in"),
        (Easing::SpringOut, "Spring out"),
        (Easing::SineInOut, "Sine in-out"),
        (Easing::BackOut, "Back out"),
        (Easing::Hold, "Hold"),
    ]
}

// ---------------------------------------------------------------------------------------------
// The curve pane
// ---------------------------------------------------------------------------------------------

/// A key or a bezier handle, placed. Built once and used twice — for the shapes and for the hit
/// targets — so what is drawn and what is grabbable cannot disagree.
struct Placed {
    row: usize,
    key_index: usize,
    /// `None` for the key itself; `Some(true)` for the handle leaving it, `Some(false)` for the
    /// handle arriving at the next key.
    handle_out: Option<bool>,
    x: f32,
    y: f32,
}

impl EditorView {
    fn motion_curve_pane(
        &self,
        rows: &[CurveRow],
        bounds: &std::rc::Rc<Cell<Bounds<Pixels>>>,
        cx: &mut Context<Self>,
    ) -> Div {
        let geometry = self.geometry();
        let mut shapes = pane_grid(&geometry, self.editor.duration());
        let mut placed: Vec<Placed> = Vec::new();

        for (index, row) in rows.iter().enumerate() {
            let Some(channel) = row.channel.as_ref().filter(|c| !c.keys.is_empty()) else {
                continue;
            };
            let first = channel.keys.first().map(|key| key.time).unwrap_or_default();
            let last = channel.keys.last().map(|key| key.time).unwrap_or_default();

            let points: Vec<gpui::Point<Pixels>> = channel
                .polyline(first..=last)
                .into_iter()
                .map(|(time, value)| {
                    gpui::point(
                        px(geometry.ticks_to_px(MediaTime::from_ticks(
                            row.owner.scene_ticks(time.as_ticks()),
                        ))),
                        px(row.axis.y_of(value, PANE_HEIGHT)),
                    )
                })
                .collect();
            if points.len() >= 2 {
                shapes.push(Shape::line(points, 1.6, row.color));
            }

            for (key_index, key) in channel.keys.iter().enumerate() {
                let x = geometry.ticks_to_px(MediaTime::from_ticks(
                    row.owner.scene_ticks(key.time.as_ticks()),
                ));
                let y = row.axis.y_of(key.value, PANE_HEIGHT);
                shapes.push(Shape::disc(
                    gpui::point(px(x), px(y)),
                    KEY_RADIUS,
                    row.color,
                ));
                if x >= CULL_LEFT {
                    placed.push(Placed {
                        row: index,
                        key_index,
                        handle_out: None,
                        x,
                        y,
                    });
                }

                // Handles exist only where a segment carries a drawn curve. A named easing is
                // not a bezier — `SpringOut` and `Hold` have no tangents at all — so drawing
                // handles for one would be a picture of a curve the sampler does not evaluate.
                let (Some(handles), Some(next)) = (key.handles, channel.keys.get(key_index + 1))
                else {
                    continue;
                };
                let nx = geometry.ticks_to_px(MediaTime::from_ticks(
                    row.owner.scene_ticks(next.time.as_ticks()),
                ));
                let ny = row.axis.y_of(next.value, PANE_HEIGHT);
                for (out, hx, hy) in [
                    (true, handles.out_x, handles.out_y),
                    (false, handles.in_x, handles.in_y),
                ] {
                    let (ax, ay) = if out { (x, y) } else { (nx, ny) };
                    let px_ = x + (nx - x) * hx;
                    let py_ = y + (ny - y) * hy;
                    shapes.push(Shape::dashed(
                        vec![gpui::point(px(ax), px(ay)), gpui::point(px(px_), px(py_))],
                        1.0,
                        row.color,
                        [2.0, 3.0],
                    ));
                    shapes.push(Shape::ring(
                        gpui::point(px(px_), px(py_)),
                        HANDLE_RADIUS,
                        1.2,
                        row.color,
                    ));
                    if px_ >= CULL_LEFT {
                        placed.push(Placed {
                            row: index,
                            key_index,
                            handle_out: Some(out),
                            x: px_,
                            y: py_,
                        });
                    }
                }
            }
        }

        // The playhead last, so it is over every curve — it is the thing being read against.
        let playhead_x = geometry.ticks_to_px(self.editor.playhead());
        shapes.push(Shape::line(
            vec![
                gpui::point(px(playhead_x), px(0.0)),
                gpui::point(px(playhead_x), px(PANE_HEIGHT)),
            ],
            1.0,
            theme::ACCENT,
        ));

        let bounds = bounds.clone();
        let mut pane = div()
            .flex_1()
            .min_w(px(0.0))
            .h(px(BAND_BODY))
            .relative()
            .overflow_hidden()
            .bg(rgb(theme::LANE))
            // `measure` spans the whole pane, so its origin is the pane's own top-left and a
            // window-space pointer becomes a pane-local one by subtracting it. The plot is
            // inset from that by `PANE_PAD`, explicitly rather than through padding — an
            // absolutely positioned child and a padded parent do not agree about which box
            // `size_full` means, and a drag that is ten pixels off is a drag nobody trusts.
            .child(draw::measure(bounds.clone()).absolute().size_full())
            .child(
                draw::paint(shapes)
                    .absolute()
                    .top(px(PANE_PAD))
                    .left(px(0.0))
                    .right(px(0.0))
                    .h(px(PANE_HEIGHT)),
            )
            // A press moves the playhead to the time under it, and stops there.
            //
            // Deliberately not a scrub: continuing one would mean an `EditorDrag::Scrub`, whose
            // move handler converts x through `lane_origin_x()` — the timeline's lane origin,
            // not this pane's — so the playhead would jump the width of the track labels the
            // moment the hand moved. A press that lands exactly is better than a drag that lies.
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(move |view, event: &MouseDownEvent, _window, cx| {
                    let origin = f32::from(bounds.get().origin.x);
                    let time = view
                        .geometry()
                        .px_to_frame_time(f32::from(event.position.x) - origin);
                    view.editor.seek(time.max(MediaTime::ZERO));
                    cx.notify();
                }),
            );

        if rows.is_empty() {
            return pane;
        }
        if placed.is_empty() {
            pane = pane.child(
                div()
                    .absolute()
                    .left(px(12.0))
                    .top(px(12.0))
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child("Nothing is keyed yet. ◆ on a row drops a key at the playhead."),
            );
        }

        for (index, spot) in placed.into_iter().enumerate() {
            pane = pane.child(self.motion_hit_target(index, spot, rows, cx));
        }
        pane
    }

    /// The grab target over a key or a handle.
    ///
    /// A path is geometry, not an element — a canvas has no `on_click` — so hit-testing is a
    /// sibling element at the same place. Building it from the same `(x, y)` the shape was drawn
    /// at is what keeps the two from drifting.
    fn motion_hit_target(
        &self,
        index: usize,
        spot: Placed,
        rows: &[CurveRow],
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        let id = ("motion-hit", index);
        let Some(row) = rows.get(spot.row) else {
            return div().id(id);
        };
        let owner = row.owner.clone();
        let path = row.property.path.clone();
        let axis = row.axis;
        let Some(channel) = row.channel.clone() else {
            return div().id(id);
        };

        div()
            .id(id)
            .absolute()
            .left(px(spot.x - HIT / 2.0))
            .top(px(spot.y - HIT / 2.0 + PANE_PAD))
            .w(px(HIT))
            .h(px(HIT))
            .cursor_pointer()
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(move |view, event: &MouseDownEvent, _window, cx| {
                    // The pane scrubs on a press. Grabbing a key is not also a request to move
                    // the playhead.
                    cx.stop_propagation();
                    view.begin_curve_drag(
                        &owner,
                        &path,
                        &channel,
                        spot.key_index,
                        spot.handle_out,
                        axis,
                        event,
                        cx,
                    );
                }),
            )
    }
}

/// The pane's graticule: a second grid, and three horizontal guides.
///
/// The horizontals are *not* labelled with a value, on purpose. Every channel is normalised to
/// its own axis, so one number against the line would be true of one curve and a lie about the
/// rest; the value each curve holds at the playhead is in its row instead.
fn pane_grid(geometry: &crate::geometry::TimelineGeometry, duration: MediaTime) -> Vec<Shape> {
    let mut shapes = Vec::new();
    for fraction in [0.25_f32, 0.5, 0.75] {
        let y = PANE_HEIGHT * fraction;
        shapes.push(Shape::dashed(
            vec![gpui::point(px(0.0), px(y)), gpui::point(px(4000.0), px(y))],
            1.0,
            if fraction == 0.5 {
                theme::BORDER
            } else {
                theme::BORDER_SOFT
            },
            [3.0, 5.0],
        ));
    }
    // One line a second, dropped once they would be closer together than they are wide.
    let step = geometry.pixels_per_second();
    if step >= 8.0 {
        let seconds =
            (duration.as_ticks() as f64 / crate::geometry::TICKS_PER_SECOND as f64).ceil();
        let count = (seconds as i64).clamp(0, 4000);
        for second in 0..=count {
            let x = geometry.seconds_to_px(second as f64);
            if !(CULL_LEFT..4000.0).contains(&x) {
                continue;
            }
            shapes.push(Shape::line(
                vec![
                    gpui::point(px(x), px(0.0)),
                    gpui::point(px(x), px(PANE_HEIGHT)),
                ],
                1.0,
                theme::BORDER_SOFT,
            ));
        }
    }
    shapes
}

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

impl EditorView {
    /// Zoom and scroll so the clip fills the curve pane.
    ///
    /// The one control that needs the pane's laid-out width, which is why the band mints the
    /// measured bounds and hands them to both halves. Without it a four-second clip on a
    /// half-minute timeline draws its curves into a tenth of the pane and leaves the rest
    /// empty — technically correct, and useless to aim a keyframe in.
    fn fit_clip_to_pane(&mut self, reference: &ElementRef, pane: Bounds<Pixels>) {
        let width = f32::from(pane.size.width);
        let Some(element) = self.motion_element(reference) else {
            return;
        };
        let seconds =
            element.duration().as_ticks() as f32 / crate::geometry::TICKS_PER_SECOND as f32;
        // A pane narrower than its own inset, or a zero-length clip, has no fit to compute.
        // Both tests are written positively and include `is_finite`, because the negated form
        // (`width <= inset`) is *false* for NaN and would let a NaN through into
        // `pixels_per_second`, which poisons the timeline zoom for the rest of the session.
        let pane_is_wide_enough = width.is_finite() && width > FIT_INSET * 4.0;
        let clip_has_duration = seconds.is_finite() && seconds > 0.0;
        if !pane_is_wide_enough || !clip_has_duration {
            return;
        }
        let pixels_per_second = (width - FIT_INSET * 2.0) / seconds;
        let start = element.start().as_ticks() as f32 / crate::geometry::TICKS_PER_SECOND as f32;
        // Set the zoom first: the scroll is measured in pixels, so it means nothing until the
        // pixels are worth what they will be worth.
        self.timeline = self.timeline.with_pixels_per_second(pixels_per_second);
        let pixels_per_second = self.timeline.pixels_per_second();
        self.timeline = self
            .timeline
            .with_scroll_x(start * pixels_per_second - FIT_INSET);
    }

    /// Drop a key on an element property at the playhead, holding the value it already has.
    ///
    /// The value matters: keying at the rest value is what makes a second key somewhere else
    /// produce a move *from here*, which is how anyone actually builds an animation.
    fn key_property_at_playhead(&mut self, reference: &ElementRef, path: &str) {
        let Some(element) = self.motion_element(reference) else {
            return;
        };
        let start = element.start().as_ticks();
        let playhead = self.editor.playhead().as_ticks();
        if playhead < start || playhead >= element.end().as_ticks() {
            self.status = Some("The playhead is outside this clip.".to_string());
            return;
        }
        let local = MediaTime::from_ticks(playhead - start);
        let value = element
            .animations()
            .and_then(|map| map.get(path))
            .and_then(|channel| channel.sample(local))
            .or_else(|| {
                element
                    .animatable_paths()
                    .into_iter()
                    .find(|property| property.path == path)
                    .map(|property| property.default)
            });
        let Some(value) = value else {
            return;
        };
        if !self.editor.execute(Command::AddKeyframe {
            reference: reference.clone(),
            property: path.to_string(),
            time: local,
            value,
        }) {
            self.status = Some(format!("{path} cannot be animated on this clip."));
        }
    }

    /// The same for a group channel — whose keys are in **scene** time, and which has no
    /// keyframe command of its own, so the whole group is rewritten in one `SetGroup`.
    fn key_group_property_at_playhead(&mut self, group_id: &str, path: &str) {
        let playhead = self.editor.playhead();
        let Some(group) = self.editor.active_scene().groups.get(group_id) else {
            return;
        };
        let mut group = group.clone();
        let default = group_default(&group.transform, path);
        let channel = group.animations.entry(path.to_string()).or_default();
        let value = channel.sample(playhead).unwrap_or(default);
        channel.upsert(playhead, value);
        self.editor.execute(Command::SetGroup { group });
    }

    /// Start dragging a key or one of its bezier handles.
    ///
    /// Both are the same gesture, so both go through the widget layer's one drag slot: the time
    /// axis is a `ScrubMap::rate` (ticks per pixel of travel, snapped to a frame), and the value
    /// axis is read off the live drag inside the callback, because a `ScrubMap` reads x only.
    #[allow(clippy::too_many_arguments)]
    fn begin_curve_drag(
        &mut self,
        owner: &ChannelOwner,
        path: &str,
        channel: &AnimationChannel,
        key_index: usize,
        handle_out: Option<bool>,
        axis: ValueAxis,
        event: &MouseDownEvent,
        cx: &mut Context<Self>,
    ) {
        let Some(key) = channel.keys.get(key_index).copied() else {
            return;
        };
        // ⌘-click deletes, which is the one destructive thing a click here can do and so is the
        // one that needs a modifier.
        if event.modifiers.platform {
            self.remove_key(owner, path, key.time);
            cx.notify();
            return;
        }
        // ⌥-click on a key gives its outgoing segment a drawn curve, which is what puts handles
        // on screen at all. A named easing has no tangents to show.
        if event.modifiers.alt && handle_out.is_none() {
            self.toggle_drawn_curve(owner, path, channel, key_index);
            cx.notify();
            return;
        }

        match handle_out {
            None => self.begin_key_drag(owner, path, key, axis, event),
            // No pane origin: a handle is normalised to its own segment, so what moves it is the
            // pointer's *travel*, not where in the pane it landed.
            Some(out) => self.begin_handle_drag(owner, path, channel, key_index, out, axis, event),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn begin_key_drag(
        &mut self,
        owner: &ChannelOwner,
        path: &str,
        key: bay_core::Keyframe,
        axis: ValueAxis,
        event: &MouseDownEvent,
    ) {
        let geometry = self.geometry();
        let ticks_per_px = crate::geometry::TICKS_PER_SECOND as f32 / geometry.pixels_per_second();
        let scene_ticks = owner.scene_ticks(key.time.as_ticks());
        // The travel bounds. A key belongs to its clip, so it cannot be dragged out of it; a
        // group's channel spans the scene.
        let (low, high) = match owner {
            ChannelOwner::Element {
                reference,
                start_ticks,
            } => {
                let duration = self
                    .motion_element(reference)
                    .map(|element| element.duration().as_ticks())
                    .unwrap_or(0);
                (*start_ticks as f32, (start_ticks + duration) as f32)
            }
            ChannelOwner::Group { .. } => (0.0, self.editor.duration().as_ticks().max(1) as f32),
        };
        let frame_ticks = geometry.ticks_per_frame().unwrap_or(1).max(1) as f32;

        let owner = owner.clone();
        let path = path.to_string();
        let key_id = key.identity();
        let origin_value = key.value;
        let origin_ticks = key.time.as_ticks();
        let fine = event.modifiers.alt;
        let start_y = f32::from(event.position.y);
        // The key's *drawn* y, not the pointer's. The grab target is 13px across, so a press
        // near its edge would otherwise snap the key six pixels the moment the hand moved —
        // and it means this gesture needs nothing from the pane's window position at all.
        let origin_y = axis.y_of(key.value, PANE_HEIGHT);
        let gesture = Gesture::new();

        controls::begin_rate_drag(
            self,
            SharedString::from(format!("motion-key-{path}-{key_id}")),
            ScrubMap::rate(ticks_per_px, low, high).step(frame_ticks),
            event.position,
            event.modifiers,
            scene_ticks as f32,
            std::rc::Rc::new(move |view: &mut EditorView, scene: f32, _cx| {
                // The value axis. `ScrubMap` maps x; y is read from the gesture itself, which is
                // the only thing that knows where the pointer is now.
                let Some(drag) = view.widgets.active() else {
                    return;
                };
                let dy = f32::from(drag.position().y) - start_y;
                let dy = if fine { dy * FINE_FACTOR } else { dy };
                let value = axis.value_of_y(origin_y + dy, PANE_HEIGHT);
                let target_ticks = owner.owner_ticks(scene.round() as i64);
                let owner_for_probe = owner.clone();
                let path_for_run = path.clone();
                let key_id = key_id.clone();
                let owner_for_run = owner.clone();
                gesture.commit(
                    view,
                    move |view| owner_fingerprint(view, &owner_for_probe),
                    move |view| {
                        view.write_key(
                            &owner_for_run,
                            &path_for_run,
                            &key_id,
                            origin_ticks,
                            origin_value,
                            target_ticks,
                            value,
                        )
                    },
                );
            }),
        );
    }

    /// Move one key to `(ticks, value)` from the state it had at the press, and say how many
    /// commands that took — which is what [`Gesture`] unwinds on the next move.
    #[allow(clippy::too_many_arguments)]
    fn write_key(
        &mut self,
        owner: &ChannelOwner,
        path: &str,
        key_id: &str,
        origin_ticks: i64,
        origin_value: f32,
        ticks: i64,
        value: f32,
    ) -> u8 {
        let moved = ticks != origin_ticks;
        let revalued = value != origin_value;
        if !moved && !revalued {
            return 0;
        }
        match owner {
            // A group has no keyframe commands, so the whole group is rewritten as one edit.
            ChannelOwner::Group { id } => {
                let Some(group) = self.editor.active_scene().groups.get(id) else {
                    return 0;
                };
                let mut group = group.clone();
                let Some(channel) = group.animations.get_mut(path) else {
                    return 0;
                };
                channel.assign_missing_ids();
                if moved {
                    channel.move_key(key_id, MediaTime::from_ticks(ticks));
                }
                channel.upsert(MediaTime::from_ticks(ticks), value);
                u8::from(self.editor.execute(Command::SetGroup { group }))
            }
            ChannelOwner::Element { reference, .. } => {
                let mut steps = 0u8;
                if moved {
                    // A key written before keyframe ids existed is addressed by its *time*, and
                    // `MoveKeyframe` assigns ids before it looks the key up — so the id it was
                    // handed no longer resolves and the move silently does nothing. Reach the
                    // same state with the two commands that do not need an id.
                    let legacy = key_id.starts_with('t');
                    if legacy {
                        steps += u8::from(self.editor.execute(Command::AddKeyframe {
                            reference: reference.clone(),
                            property: path.to_string(),
                            time: MediaTime::from_ticks(ticks),
                            value,
                        }));
                        steps += u8::from(self.editor.execute(Command::RemoveKeyframe {
                            reference: reference.clone(),
                            property: path.to_string(),
                            time: MediaTime::from_ticks(origin_ticks),
                        }));
                        return steps;
                    }
                    steps += u8::from(self.editor.execute(Command::MoveKeyframe {
                        reference: reference.clone(),
                        property: path.to_string(),
                        keyframe_id: key_id.to_string(),
                        time: MediaTime::from_ticks(ticks),
                    }));
                }
                if revalued {
                    // `AddKeyframe` upserts, and an upsert onto an existing time keeps that
                    // key's id — so this sets the value without the key ceasing to exist.
                    steps += u8::from(self.editor.execute(Command::AddKeyframe {
                        reference: reference.clone(),
                        property: path.to_string(),
                        time: MediaTime::from_ticks(ticks),
                        value,
                    }));
                }
                steps
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn begin_handle_drag(
        &mut self,
        owner: &ChannelOwner,
        path: &str,
        channel: &AnimationChannel,
        key_index: usize,
        out: bool,
        axis: ValueAxis,
        event: &MouseDownEvent,
    ) {
        let (Some(key), Some(next)) = (
            channel.keys.get(key_index).copied(),
            channel.keys.get(key_index + 1).copied(),
        ) else {
            return;
        };
        let Some(handles) = key.handles else {
            return;
        };
        let geometry = self.geometry();
        let span_ticks = (next.time.as_ticks() - key.time.as_ticks()).max(1) as f32;
        let span_px = geometry.delta_ticks_to_px(MediaTime::from_ticks(span_ticks as i64));
        // The handle is normalised to its own segment, so a pixel of travel is worth
        // `1 / segment width` of it — which is what keeps a curve's shape when the segment is
        // stretched.
        let per_px = 1.0 / span_px.max(1.0);
        let start = if out { handles.out_x } else { handles.in_x };
        // x is clamped into the segment because a control point outside it makes the curve
        // non-monotonic in time, which is a curve that runs backwards.
        let map = ScrubMap::rate(per_px, 0.0, 1.0);

        let value_span = next.value - key.value;
        let key_y = axis.y_of(key.value, PANE_HEIGHT);
        let next_y = axis.y_of(next.value, PANE_HEIGHT);
        let y_span = next_y - key_y;
        let start_y = f32::from(event.position.y);
        let start_handle_y = if out { handles.out_y } else { handles.in_y };
        let fine = event.modifiers.alt;

        let owner = owner.clone();
        let path = path.to_string();
        let key_id = key.identity();
        let gesture = Gesture::new();

        controls::begin_rate_drag(
            self,
            SharedString::from(format!("motion-handle-{path}-{key_id}-{out}")),
            map,
            event.position,
            event.modifiers,
            start,
            std::rc::Rc::new(move |view: &mut EditorView, x: f32, _cx| {
                let Some(drag) = view.widgets.active() else {
                    return;
                };
                let dy = f32::from(drag.position().y) - start_y;
                let dy = if fine { dy * FINE_FACTOR } else { dy };
                // A flat segment has no value span to normalise against, so its y handles mean
                // nothing and are left where they are. The x half still works.
                let y = if value_span == 0.0 || y_span == 0.0 {
                    start_handle_y
                } else {
                    start_handle_y + dy / y_span
                };
                let mut handles = handles;
                if out {
                    handles.out_x = x;
                    handles.out_y = y;
                } else {
                    handles.in_x = x;
                    handles.in_y = y;
                }
                let owner_for_probe = owner.clone();
                let owner_for_run = owner.clone();
                let path_for_run = path.clone();
                let key_id = key_id.clone();
                gesture.commit(
                    view,
                    move |view| owner_fingerprint(view, &owner_for_probe),
                    move |view| {
                        view.write_curve(
                            &owner_for_run,
                            &path_for_run,
                            &key_id,
                            KeyframeCurve::Drawn { handles },
                        )
                    },
                );
            }),
        );
    }

    /// Give a key's outgoing segment a drawn curve, or hand it back to the channel's easing.
    fn toggle_drawn_curve(
        &mut self,
        owner: &ChannelOwner,
        path: &str,
        channel: &AnimationChannel,
        key_index: usize,
    ) {
        let Some(key) = channel.keys.get(key_index).copied() else {
            return;
        };
        if channel.keys.len() <= key_index + 1 {
            self.status = Some("The last key on a channel leaves no segment to curve.".to_string());
            return;
        }
        let curve = match key.handles {
            Some(_) => KeyframeCurve::Channel,
            None => KeyframeCurve::Drawn {
                handles: BezierHandles::default(),
            },
        };
        self.write_curve(owner, path, &key.identity(), curve);
    }

    fn write_curve(
        &mut self,
        owner: &ChannelOwner,
        path: &str,
        key_id: &str,
        curve: KeyframeCurve,
    ) -> u8 {
        match owner {
            ChannelOwner::Element { reference, .. } => {
                u8::from(self.editor.execute(Command::SetKeyframeCurve {
                    reference: reference.clone(),
                    property: path.to_string(),
                    keyframe_id: key_id.to_string(),
                    curve,
                }))
            }
            ChannelOwner::Group { id } => {
                let Some(group) = self.editor.active_scene().groups.get(id) else {
                    return 0;
                };
                let mut group = group.clone();
                let Some(channel) = group.animations.get_mut(path) else {
                    return 0;
                };
                let Some(index) = channel.index_of(key_id) else {
                    return 0;
                };
                let key = &mut channel.keys[index];
                match curve {
                    KeyframeCurve::Channel => {
                        key.easing = None;
                        key.handles = None;
                    }
                    KeyframeCurve::Named { easing } => {
                        key.easing = Some(easing);
                        key.handles = None;
                    }
                    KeyframeCurve::Drawn { handles } => {
                        key.easing = None;
                        key.handles = Some(handles);
                    }
                }
                u8::from(self.editor.execute(Command::SetGroup { group }))
            }
        }
    }

    fn remove_key(&mut self, owner: &ChannelOwner, path: &str, time: MediaTime) {
        match owner {
            ChannelOwner::Element { reference, .. } => {
                self.editor.execute(Command::RemoveKeyframe {
                    reference: reference.clone(),
                    property: path.to_string(),
                    time,
                });
            }
            ChannelOwner::Group { id } => {
                let Some(group) = self.editor.active_scene().groups.get(id) else {
                    return;
                };
                let mut group = group.clone();
                let Some(channel) = group.animations.get_mut(path) else {
                    return;
                };
                channel.keys.retain(|key| key.time != time);
                if channel.keys.is_empty() {
                    group.animations.remove(path);
                }
                self.editor.execute(Command::SetGroup { group });
            }
        }
    }

    /// A small button with a dynamic id. `EditorView::button` takes a `&'static str`, and the
    /// rows here are one per property of whatever clip is selected.
    fn motion_button(
        &self,
        id: (&'static str, usize),
        label: &'static str,
        enabled: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, &mut Context<EditorView>) + 'static,
    ) -> gpui::Stateful<Div> {
        let face = widgets::button_face(widgets::ButtonKind::Normal, enabled)
            .id(id)
            .flex_none()
            .px(px(6.0))
            .py(px(2.0))
            .rounded(px(3.0))
            .text_xs()
            .child(label);
        if !enabled {
            return face;
        }
        widgets::pressable(widgets::ButtonKind::Normal, face)
            .cursor_pointer()
            .on_click(cx.listener(move |view, _event, _window, cx| {
                handler(view, cx);
                cx.notify();
            }))
    }
}

fn owner_fingerprint(view: &EditorView, owner: &ChannelOwner) -> u64 {
    match owner {
        ChannelOwner::Element { reference, .. } => element_fingerprint(view, reference),
        ChannelOwner::Group { id } => group_fingerprint(view, id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_core::project::Unit;

    #[test]
    fn an_axis_starts_from_the_descriptor_range() {
        let axis = ValueAxis::fit(Some((0.0, 1.0)), 1.0, &[]);
        assert!((0.0..=1.0).contains(&axis.fraction(0.0)));
        assert!((0.0..=1.0).contains(&axis.fraction(1.0)));
        assert!(axis.fraction(0.0) < axis.fraction(1.0));
    }

    /// The range is a drawing hint, not a validator — `animatable.rs` says so itself. A rotation
    /// of 720° is legal and the axis has to grow rather than clamp it.
    #[test]
    fn an_axis_grows_to_hold_a_key_outside_the_range() {
        let axis = ValueAxis::fit(Some((-360.0, 360.0)), 0.0, &[720.0]);
        assert!(
            (0.0..=1.0).contains(&axis.fraction(720.0)),
            "a key was clipped off the axis"
        );
        assert!((0.0..=1.0).contains(&axis.fraction(-360.0)));
    }

    /// A shader parameter has no range at all, and inventing one would draw a confident guess.
    #[test]
    fn a_property_with_no_range_is_fitted_to_its_own_keys() {
        let axis = ValueAxis::fit(None, 6.0, &[2.0, 18.0]);
        assert!((0.0..=1.0).contains(&axis.fraction(2.0)));
        assert!((0.0..=1.0).contains(&axis.fraction(18.0)));
        assert!(axis.fraction(2.0) < axis.fraction(18.0));
    }

    /// A channel that never moves still has to be drawable: a zero-extent axis divides by zero
    /// and puts a NaN into a path, which `draw` then refuses to draw at all.
    #[test]
    fn a_flat_channel_still_has_an_axis_with_extent() {
        let axis = ValueAxis::fit(None, 0.5, &[0.5, 0.5]);
        assert!(
            axis.fraction(0.5).is_finite(),
            "a zero-extent axis is a NaN"
        );
        assert!(axis.y_of(0.5, 100.0).is_finite());
        assert!(axis.y_of(0.6, 100.0) < axis.y_of(0.5, 100.0));
    }

    #[test]
    fn the_value_axis_is_flipped_so_larger_is_higher() {
        let axis = ValueAxis::fit(Some((0.0, 1.0)), 0.0, &[]);
        assert!(axis.y_of(1.0, 100.0) < axis.y_of(0.0, 100.0));
    }

    #[test]
    fn a_value_survives_a_round_trip_through_the_pane() {
        let axis = ValueAxis::fit(Some((0.0, 2.0)), 1.0, &[]);
        let y = axis.y_of(1.25, 200.0);
        assert!((axis.value_of_y(y, 200.0) - 1.25).abs() < 1e-4);
    }

    /// The conversion `pages.md` names as the page's silent failure: an element channel is
    /// element-local, a group channel is already scene time.
    #[test]
    fn an_element_channel_is_offset_by_its_clip_and_a_group_channel_is_not() {
        let element = ChannelOwner::Element {
            reference: ElementRef::new("t1", "e1"),
            start_ticks: 240_000,
        };
        let group = ChannelOwner::Group {
            id: "g1".to_string(),
        };
        assert_eq!(element.scene_ticks(60_000), 300_000);
        assert_eq!(group.scene_ticks(60_000), 60_000);
    }

    #[test]
    fn the_two_timebase_conversions_are_exact_inverses() {
        for owner in [
            ChannelOwner::Element {
                reference: ElementRef::new("t1", "e1"),
                start_ticks: 137,
            },
            ChannelOwner::Group {
                id: "g1".to_string(),
            },
        ] {
            for ticks in [0_i64, 1, 120_000, -4_004] {
                assert_eq!(owner.owner_ticks(owner.scene_ticks(ticks)), ticks);
            }
        }
    }

    /// A row with no keys is the case the page is judged on, and it must still draw its rest
    /// line — otherwise the pane is blank for every clip nobody has animated.
    #[test]
    fn an_unkeyed_row_still_draws_a_rest_line() {
        let row = CurveRow {
            property: AnimatableProperty {
                path: "opacity".to_string(),
                label: "Opacity".to_string(),
                unit: Unit::Fraction,
                range: Some((0.0, 1.0)),
                default: 1.0,
            },
            owner: ChannelOwner::Element {
                reference: ElementRef::new("t1", "e1"),
                start_ticks: 0,
            },
            channel: None,
            axis: ValueAxis::fit(Some((0.0, 1.0)), 1.0, &[]),
            color: theme::MARKER,
            now: 1.0,
        };
        assert!(!row.is_animated());
        let strip = row_strip(&row);
        assert_eq!(strip.len(), 1, "the rest line and nothing else");
        assert!(strip[0].point_count() >= 2);
    }

    #[test]
    fn a_keyed_row_draws_its_curve_over_the_rest_line() {
        let mut channel = AnimationChannel::default();
        channel.upsert(MediaTime::from_ticks(0), 0.0);
        channel.upsert(MediaTime::from_ticks(120_000), 1.0);
        let row = CurveRow {
            property: AnimatableProperty {
                path: "opacity".to_string(),
                label: "Opacity".to_string(),
                unit: Unit::Fraction,
                range: Some((0.0, 1.0)),
                default: 1.0,
            },
            owner: ChannelOwner::Element {
                reference: ElementRef::new("t1", "e1"),
                start_ticks: 0,
            },
            channel: Some(channel),
            axis: ValueAxis::fit(Some((0.0, 1.0)), 1.0, &[0.0, 1.0]),
            color: theme::MARKER,
            now: 0.0,
        };
        assert!(row.is_animated());
        let strip = row_strip(&row);
        assert_eq!(strip.len(), 2);
        assert!(strip[1].point_count() >= 2);
    }

    /// Every group channel the page offers must be one `compose_group_transform` actually
    /// carries — a row for `cropLeft` would be a control that writes a channel nothing reads.
    #[test]
    fn every_group_row_has_a_default_and_a_description() {
        let transform = Transform::default();
        for path in ElementGroup::ANIMATABLE {
            assert!(
                bay_core::project::describe_path(path).is_some(),
                "{path} has no descriptor to draw an axis from"
            );
            assert!(group_default(&transform, path).is_finite());
        }
    }

    #[test]
    fn the_easing_list_covers_the_whole_vocabulary() {
        // Fourteen, which is why the picker is a popover rather than a button that cycles.
        assert_eq!(easings().len(), 14);
    }

    /// The band has to weigh exactly what the Cut page hangs below its transport, or the two
    /// pages put the transport on different lines and `pages.md`'s horizon line is a claim
    /// rather than a fact.
    #[test]
    fn the_band_matches_the_cut_pages_scene_bar_and_timeline() {
        const CUT_SCENE_BAR: f32 = 40.0 + 1.0;
        const CUT_TIMELINE: f32 = 300.0 + 1.0;
        assert_eq!(BAND_HEIGHT, CUT_SCENE_BAR + CUT_TIMELINE);
    }

    #[test]
    fn the_pane_leaves_room_for_its_own_padding() {
        assert_eq!(PANE_HEIGHT, BAND_BODY - PANE_PAD * 2.0);
        // And the plot it leaves actually holds an axis: every value on a bounded channel has
        // to land inside the pane, or the content mask cuts the curve the page is drawing.
        let axis = ValueAxis::fit(Some((0.0, 1.0)), 0.0, &[]);
        for value in [0.0_f32, 0.5, 1.0] {
            let y = axis.y_of(value, PANE_HEIGHT);
            assert!(
                (0.0..=PANE_HEIGHT).contains(&y),
                "{value} plots at {y}, outside a {PANE_HEIGHT}px pane"
            );
        }
    }
}

/// Drawing the page for real: layout, prepaint and paint, at three window sizes.
///
/// The editor's own `paint_tests` open the *Cut* page, so none of this file is in the tree they
/// walk. These are what catch a canvas painting outside its phase, a path built from a NaN, a
/// colliding element id, or a plot squeezed to a negative width — none of which a state test can
/// see, and all of which this page has more of than any other.
///
/// Still not a substitute for looking at the app. This is the part of looking at it that runs on
/// every commit.
#[cfg(test)]
mod paint_tests {
    use super::*;
    use crate::page::Page;
    use bay_core::Editor;
    use gpui::{Modifiers, MouseButton, TestAppContext, VisualTestContext};

    fn title() -> ElementRef {
        ElementRef::new("track-main", "el-title")
    }

    fn motion_editor(
        cx: &mut TestAppContext,
    ) -> (gpui::Entity<EditorView>, &mut VisualTestContext) {
        let (view, cx) = crate::paint_harness::window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            let mut view = EditorView::new(Editor::starter(), focus, None, None);
            view.show_page(Page::Motion);
            view
        });
        (view, cx)
    }

    /// The starter project with the title selected, two keys on opacity, a hand-drawn curve on
    /// the first of them, and a group over the clip — so every branch of the pane is in the
    /// tree at once: keyed rows, unkeyed rows, bezier handles, and the other timebase.
    fn arrange(view: &mut EditorView) {
        let reference = title();
        view.editor.select(vec![reference.clone()]);
        for (ticks, value) in [(0_i64, 0.0_f32), (60_000, 1.0)] {
            assert!(
                view.editor.execute(Command::AddKeyframe {
                    reference: reference.clone(),
                    property: "opacity".to_string(),
                    time: MediaTime::from_ticks(ticks),
                    value,
                }),
                "opacity is animatable on a text element"
            );
        }
        let key_id = opacity(view).keys[0].identity();
        assert!(view.editor.execute(Command::SetKeyframeCurve {
            reference,
            property: "opacity".to_string(),
            keyframe_id: key_id,
            curve: KeyframeCurve::Drawn {
                handles: BezierHandles::default(),
            },
        }));

        let mut channel = AnimationChannel::default();
        // Scene time, not element-local — which is the whole point of putting a group here.
        channel.upsert(MediaTime::from_ticks(0), 0.4);
        channel.upsert(MediaTime::from_ticks(240_000), 0.6);
        view.editor.execute(Command::SetGroup {
            group: ElementGroup {
                id: "grp-1".to_string(),
                children: vec!["el-title".to_string()],
                transform: Transform::default(),
                animations: std::collections::BTreeMap::from([("x".to_string(), channel)]),
            },
        });
    }

    fn opacity(view: &EditorView) -> AnimationChannel {
        view.motion_element(&title())
            .and_then(|element| element.animations())
            .and_then(|map| map.get("opacity"))
            .cloned()
            .expect("the opacity channel that was just written")
    }

    use crate::paint_harness::paint;

    /// With nothing selected — the state the page opens in, and the one where a curve editor
    /// most easily draws an empty frame.
    #[gpui::test]
    fn the_page_paints_with_no_clip_selected(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| view.editor.select(Vec::new()));
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 640.0, 420.0);
    }

    /// A clip that nobody has keyed. Every row is a rest line, and this is the case the page is
    /// judged on — an empty pane here is a curve *viewer*.
    #[gpui::test]
    fn the_page_paints_for_a_clip_with_no_keys(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            view.editor.select(vec![title()]);
            let rows = view.motion_rows(&title());
            assert!(
                rows.len() >= 13,
                "a text clip offers its thirteen transform channels and its font size"
            );
            assert!(
                rows.iter().all(|row| !row.is_animated()),
                "nothing has been keyed yet"
            );
        });
        paint(&view, cx, 1440.0, 900.0);
    }

    #[gpui::test]
    fn the_page_paints_with_keys_handles_and_a_group(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            arrange(view);
            let rows = view.motion_rows(&title());
            assert!(
                rows.iter()
                    .any(|row| matches!(row.owner, ChannelOwner::Group { .. }) && row.is_animated()),
                "the group's animated channel has to reach the pane"
            );
        });
        paint(&view, cx, 1440.0, 900.0);
    }

    /// A window small enough that the toolbar already collides with itself. `pages.md` requires
    /// every page milestone to be looked at here; this is the half of that a test can do.
    #[gpui::test]
    fn the_page_paints_in_a_small_window(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| arrange(view));
        paint(&view, cx, 640.0, 420.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// A curve drawn at a zoom where the whole clip is a few pixels wide, and at one where a
    /// frame is. Both put the plot somewhere a naive mapping divides by zero.
    #[gpui::test]
    fn the_page_paints_at_both_ends_of_the_zoom(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            arrange(view);
            view.timeline = view
                .timeline
                .with_pixels_per_second(crate::geometry::MIN_PIXELS_PER_SECOND);
        });
        paint(&view, cx, 1440.0, 900.0);
        view.update(cx, |view, _| {
            view.timeline = view
                .timeline
                .with_pixels_per_second(crate::geometry::MAX_PIXELS_PER_SECOND);
        });
        paint(&view, cx, 1440.0, 900.0);
    }

    fn press(x: f32, y: f32) -> gpui::MouseDownEvent {
        gpui::MouseDownEvent {
            button: MouseButton::Left,
            position: gpui::point(px(x), px(y)),
            modifiers: Modifiers::default(),
            click_count: 1,
            first_mouse: false,
        }
    }

    /// The gesture, end to end, without a window drawing it: press, two moves, release.
    ///
    /// And the thing the page would be unusable without — the whole drag is **one** undo entry,
    /// not one per pointer move.
    #[gpui::test]
    fn dragging_a_key_along_time_leaves_one_undo_entry(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, cx| {
            arrange(view);
            let before = opacity(view);
            let rows = view.motion_rows(&title());
            let row = rows
                .iter()
                .find(|row| row.property.path == "opacity")
                .expect("opacity is a row");
            let (owner, axis) = (row.owner.clone(), row.axis);
            let key = before.keys[1];

            view.begin_key_drag(&owner, "opacity", key, axis, &press(500.0, 600.0));
            // The default zoom is 48 px/s, so 24 px of travel is half a second. y is held, so
            // the value does not change and the move is one command.
            controls::drive_value_drag(view, gpui::point(px(512.0), px(600.0)), false, cx);
            controls::end_value_drag(view, gpui::point(px(524.0), px(600.0)), false, cx);

            let after = opacity(view);
            assert!(
                after.keys[1].time > before.keys[1].time,
                "the key did not move: {:?} → {:?}",
                before.keys[1].time,
                after.keys[1].time
            );
            assert_eq!(after.keys[1].value, before.keys[1].value, "y was held");
            assert_eq!(
                after.keys.len(),
                before.keys.len(),
                "a key was created or lost"
            );
            assert!(
                after.keys[1].identity() == before.keys[1].identity(),
                "the key lost its name mid-drag, so the selection would have lost it too"
            );

            assert!(view.editor.undo(), "the drag left nothing to undo");
            assert_eq!(
                opacity(view),
                before,
                "two pointer moves left more than one undo entry"
            );
        });
    }

    /// A key dragged in both axes at once. Two commands, because moving a key and revaluing it
    /// are two verbs and `bay-core` has none that carries both — so it is **two** undo entries,
    /// pinned here rather than left to be discovered. The first ⌘Z is a coherent state (the
    /// move, without the value change), which is why the order is move-then-value.
    #[gpui::test]
    fn dragging_a_key_diagonally_takes_two(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, cx| {
            arrange(view);
            let before = opacity(view);
            let rows = view.motion_rows(&title());
            let row = rows
                .iter()
                .find(|row| row.property.path == "opacity")
                .expect("opacity is a row");
            let (owner, axis) = (row.owner.clone(), row.axis);

            view.begin_key_drag(
                &owner,
                "opacity",
                before.keys[1],
                axis,
                &press(500.0, 600.0),
            );
            controls::end_value_drag(view, gpui::point(px(524.0), px(660.0)), false, cx);

            let after = opacity(view);
            assert!(after.keys[1].time > before.keys[1].time);
            assert!(
                after.keys[1].value < before.keys[1].value,
                "dragging down has to lower the value"
            );
            assert!(view.editor.undo());
            assert!(view.editor.undo());
            assert_eq!(opacity(view), before);
        });
    }

    /// A handle drag writes the segment's curve, and the same collapse applies.
    #[gpui::test]
    fn dragging_a_bezier_handle_writes_one_curve(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, cx| {
            arrange(view);
            let before = opacity(view);
            let handles = before.keys[0].handles.expect("arrange drew a curve");
            let rows = view.motion_rows(&title());
            let row = rows
                .iter()
                .find(|row| row.property.path == "opacity")
                .expect("opacity is a row");
            let (owner, axis) = (row.owner.clone(), row.axis);

            view.begin_handle_drag(
                &owner,
                "opacity",
                &before,
                0,
                true,
                axis,
                &press(500.0, 600.0),
            );
            controls::drive_value_drag(view, gpui::point(px(520.0), px(600.0)), false, cx);
            controls::end_value_drag(view, gpui::point(px(540.0), px(590.0)), false, cx);

            let after = opacity(view);
            let moved = after.keys[0].handles.expect("still a drawn curve");
            assert!(
                moved.out_x > handles.out_x,
                "the handle did not move along x"
            );
            assert!(
                (0.0..=1.0).contains(&moved.out_x),
                "x outside the segment makes the curve run backwards"
            );
            assert!(view.editor.undo());
            assert_eq!(opacity(view), before, "one entry for the whole handle drag");
        });
    }

    /// ⌥-click is how a segment gets handles at all — a named easing has no tangents to show,
    /// so without this the handle drag above is unreachable from the app.
    #[gpui::test]
    fn alt_click_gives_a_segment_a_drawn_curve_and_takes_it_back(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            view.editor.select(vec![title()]);
            for (ticks, value) in [(0_i64, 0.0_f32), (60_000, 1.0)] {
                view.editor.execute(Command::AddKeyframe {
                    reference: title(),
                    property: "opacity".to_string(),
                    time: MediaTime::from_ticks(ticks),
                    value,
                });
            }
            let channel = opacity(view);
            let owner = ChannelOwner::Element {
                reference: title(),
                start_ticks: 0,
            };
            assert!(
                channel.keys[0].handles.is_none(),
                "a fresh key has no curve"
            );

            view.toggle_drawn_curve(&owner, "opacity", &channel, 0);
            assert!(opacity(view).keys[0].handles.is_some());

            let channel = opacity(view);
            view.toggle_drawn_curve(&owner, "opacity", &channel, 0);
            assert!(
                opacity(view).keys[0].handles.is_none(),
                "the same gesture has to hand the segment back to the channel's easing"
            );

            // The last key leaves no segment, so there is nothing to curve and the page says so
            // rather than writing handles nothing evaluates.
            let channel = opacity(view);
            view.toggle_drawn_curve(&owner, "opacity", &channel, 1);
            assert!(opacity(view).keys[1].handles.is_none());
            assert!(view.status.is_some(), "and it says why");
        });
    }

    /// Keying at the playhead holds the value the property already has, so a second key
    /// elsewhere produces a move *from here* — which is how anyone actually builds one.
    #[gpui::test]
    fn keying_at_the_playhead_holds_the_value_it_already_had(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            view.editor.select(vec![title()]);
            view.editor.seek(MediaTime::from_ticks(60_000));
            let rest = view
                .motion_element(&title())
                .and_then(|element| element.transform())
                .expect("a text element has a transform")
                .opacity;

            view.key_property_at_playhead(&title(), "opacity");
            let channel = opacity(view);
            assert_eq!(channel.keys.len(), 1);
            assert_eq!(channel.keys[0].time, MediaTime::from_ticks(60_000));
            assert_eq!(channel.keys[0].value, rest);
        });
    }

    /// The playhead outside the clip is the one case where ◆ has nothing to write, and it has
    /// to say so rather than silently doing nothing.
    #[gpui::test]
    fn keying_outside_the_clip_refuses_out_loud(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            view.editor.select(vec![title()]);
            let end = view
                .motion_element(&title())
                .expect("the title clip")
                .end()
                .as_ticks();
            view.editor.seek(MediaTime::from_ticks(end + 120_000));
            view.key_property_at_playhead(&title(), "opacity");
            assert!(view
                .motion_element(&title())
                .and_then(|element| element.animations())
                .map(|map| !map.contains_key("opacity"))
                .unwrap_or(true));
            assert!(view.status.is_some(), "a refusal nobody is told about");
        });
    }

    /// A group key is written in scene time, through `SetGroup` — the group has no keyframe
    /// command of its own.
    #[gpui::test]
    fn a_group_key_lands_in_scene_time(cx: &mut TestAppContext) {
        let (view, cx) = motion_editor(cx);
        view.update(cx, |view, _| {
            arrange(view);
            view.editor.seek(MediaTime::from_ticks(96_000));
            view.key_group_property_at_playhead("grp-1", "y");
            let group = view
                .editor
                .active_scene()
                .groups
                .get("grp-1")
                .expect("the group")
                .clone();
            let channel = group.animations.get("y").expect("the y channel");
            assert_eq!(
                channel.keys[0].time,
                MediaTime::from_ticks(96_000),
                "a group key is scene time, not element-local"
            );
        });
    }
}
