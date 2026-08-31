//! The spike panel: every widget and every drawing primitive, on screen at once.
//!
//! This is the thing that was actually looked at to decide the drawing route, and it stays so
//! the next five milestones can look at it too — a curve editor built against a path layer
//! nobody has seen render is a curve editor discovered to be wrong after it ships.
//!
//! **Not in the product.** It draws only when `BAY_UI_LAB=1` is set in the environment; with the
//! variable unset the state is never constructed and `render` is never reached. It is a
//! developer's panel, not a hidden feature.
//!
//! ```text
//! BAY_UI_LAB=1 ./run.sh
//! ```

use crate::theme::rgb;
use gpui::prelude::*;
use gpui::{div, point, px, Div, SharedString};

use crate::controls::{DragNumber, Select, SelectOption, Slider, WidgetHost};
use crate::draw::{self, Shape};
use crate::theme;
use crate::widgets;

/// Whether the lab is switched on for this run.
pub fn enabled() -> bool {
    std::env::var("BAY_UI_LAB").is_ok_and(|value| value != "0" && !value.is_empty())
}

/// The lab's own state. Nothing here is project data; it exists so the controls have something
/// to move.
pub struct Lab {
    pub opacity: f32,
    pub gain_db: f32,
    pub scale: f32,
    pub easing: Option<usize>,
}

impl Default for Lab {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            gain_db: 0.0,
            scale: 1.0,
            easing: Some(0),
        }
    }
}

/// The fourteen names a keyframe easing picker has to offer, with the ones the engine cannot
/// interpolate today drawn and refused rather than left out.
fn easings() -> Vec<SelectOption> {
    let supported = ["Linear", "Ease In", "Ease Out", "Ease In Out"];
    let planned = [
        "Ease In Quad",
        "Ease Out Quad",
        "Ease In Cubic",
        "Ease Out Cubic",
        "Ease In Quart",
        "Ease Out Quart",
        "Ease In Expo",
        "Ease Out Expo",
        "Back Out",
        "Bezier…",
    ];
    supported
        .iter()
        .map(|name| SelectOption::new(*name))
        .chain(planned.iter().map(|name| {
            SelectOption::new(*name)
                .detail("no engine support yet")
                .enabled(false)
        }))
        .collect()
}

/// A sine, decimated to one point per pixel of the plot's width — the shape a curve editor and
/// an EQ response both are.
fn curve(width: f32, height: f32) -> Vec<gpui::Point<gpui::Pixels>> {
    let count = width.max(2.0) as usize;
    (0..count)
        .map(|index| {
            let t = index as f32 / (count - 1) as f32;
            let y = height / 2.0
                - (t * std::f32::consts::TAU * 2.0).sin() * (height / 2.0 - 4.0) * (1.0 - t * 0.6);
            point(px(t * width), px(y))
        })
        .collect()
}

/// A synthetic signal, so the waveform outline is drawn from the same `envelope` a mixer will
/// use rather than from hand-placed points.
fn signal(count: usize) -> Vec<f32> {
    (0..count)
        .map(|index| {
            let t = index as f32 / count as f32;
            (t * std::f32::consts::TAU * 40.0).sin() * (0.2 + 0.8 * (t * 3.0).sin().abs())
        })
        .collect()
}

const PLOT_W: f32 = 300.0;
const PLOT_H: f32 = 86.0;

fn heading(label: &str) -> Div {
    widgets::section(label).mt(px(4.0))
}

/// The whole panel. `host` is read for the live value of whatever is being dragged.
pub fn panel<V>(host: &V, lab: &Lab, cx: &mut gpui::Context<V>) -> Div
where
    V: WidgetHost + LabHost,
{
    let (opacity, gain_db, scale, easing) = (lab.opacity, lab.gain_db, lab.scale, lab.easing);

    // --- the drawing spike ---------------------------------------------------------------
    let mut shapes = Vec::new();
    // A dashed graticule, which is the thing a scope needs and a div cannot be.
    for step in 1..4 {
        let y = PLOT_H * step as f32 / 4.0;
        shapes.push(Shape::dashed(
            vec![point(px(0.0), px(y)), point(px(PLOT_W), px(y))],
            1.0,
            theme::BORDER,
            [3.0, 4.0],
        ));
    }
    shapes.push(Shape::line(curve(PLOT_W, PLOT_H), 1.5, theme::ACCENT));
    // Handles, as a curve editor would draw them: a filled dot inside a ring.
    for at in [0.0f32, 0.5, 1.0] {
        let centre = point(px(at * PLOT_W), px(PLOT_H / 2.0));
        shapes.push(Shape::ring(centre, 7.0, 1.5, theme::ACCENT_SOFT));
        shapes.push(Shape::disc(centre, 3.5, theme::TEXT));
    }

    let plot = div()
        .w(px(PLOT_W))
        .h(px(PLOT_H))
        .bg(rgb(theme::LANE))
        .rounded(px(6.0))
        .child(draw::paint(shapes).size_full());

    // One closed path around 130,000 samples reduced to one bucket per pixel — the tall
    // waveform the mixer needs, and the reason `envelope` returns both signs.
    let envelope = draw::envelope(&signal(130_000), PLOT_W as usize);
    let waveform = div()
        .w(px(PLOT_W))
        .h(px(52.0))
        .bg(rgb(theme::LANE))
        .rounded(px(6.0))
        .child(
            draw::paint(vec![Shape::area(
                draw::envelope_outline(&envelope, PLOT_W, 52.0),
                theme::OK,
            )])
            .size_full(),
        );

    // --- the widgets ---------------------------------------------------------------------
    let opacity_slider = Slider::new("lab-opacity", opacity, 0.0, 1.0)
        .width(PLOT_W)
        .detent(1.0)
        .render(host, cx, |view, value, _| view.lab_mut().opacity = value);

    let refused = Slider::new("lab-refused", 0.35, 0.0, 1.0)
        .width(PLOT_W)
        .enabled(false)
        .render(host, cx, |_, _, _| {});

    let gain = DragNumber::new("lab-gain", gain_db, -60.0, 12.0, 0.25)
        .detent(0.0)
        .step(0.1)
        .format(|value| format!("{value:+.1} dB"))
        .render(host, cx, |view, value, _| view.lab_mut().gain_db = value);

    let scale_number = DragNumber::new("lab-scale", scale, 0.05, 8.0, 0.01)
        .detent(1.0)
        .format(|value| format!("{value:.2}×"))
        .render(host, cx, |view, value, _| view.lab_mut().scale = value);

    let easing_select = Select::new("lab-easing", easings())
        .selected(easing)
        .width(PLOT_W)
        .render(host, cx, |view, index, _| {
            view.lab_mut().easing = Some(index)
        });

    // --- the tokens ----------------------------------------------------------------------
    let states = widgets::row().gap(px(6.0)).children([
        widgets::button_face(widgets::ButtonKind::Normal, true)
            .px(px(9.0))
            .py(px(4.0))
            .rounded(px(5.0))
            .text_xs()
            .child("Normal"),
        widgets::button_face(widgets::ButtonKind::Primary, true)
            .px(px(9.0))
            .py(px(4.0))
            .rounded(px(5.0))
            .text_xs()
            .child("Primary"),
        widgets::button_face(widgets::ButtonKind::Danger, true)
            .px(px(9.0))
            .py(px(4.0))
            .rounded(px(5.0))
            .text_xs()
            .child("Danger"),
        widgets::button_face(widgets::ButtonKind::Normal, false)
            .px(px(9.0))
            .py(px(4.0))
            .rounded(px(5.0))
            .text_xs()
            .child("Disabled"),
    ]);

    let severities = widgets::row().gap(px(10.0)).children(
        [
            (theme::Severity::Ok, "Ok"),
            (theme::Severity::Warn, "Warn"),
            (theme::Severity::Danger, "Danger"),
            (theme::Severity::Off, "Off"),
            (theme::Severity::Absent, "Absent"),
        ]
        .map(|(severity, label)| {
            widgets::row()
                .gap(px(4.0))
                .child(widgets::dot(severity.dot()))
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(severity.text()))
                        .child(SharedString::from(label)),
                )
        }),
    );

    div()
        .absolute()
        .top(px(0.0))
        .right(px(0.0))
        .bottom(px(0.0))
        .w(px(PLOT_W + 26.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(13.0))
        .bg(rgb(theme::PANEL))
        .border_l_1()
        .border_color(rgb(theme::BORDER))
        .overflow_hidden()
        .child(
            div()
                .text_sm()
                .text_color(rgb(theme::TEXT))
                .child("Lab · BAY_UI_LAB=1"),
        )
        .child(heading("PATHS — CURVE, HANDLES, DASHED GRATICULE"))
        .child(plot)
        .child(heading("PATHS — 130,000 SAMPLES, ONE CLOSED OUTLINE"))
        .child(waveform)
        .child(heading("SLIDER — DETENT AT 1.0, DOUBLE-CLICK RESETS"))
        .child(opacity_slider)
        .child(heading("SLIDER — DISABLED, NOT HIDDEN"))
        .child(refused)
        .child(heading("DRAG-NUMBER — SCRUB, ALT FOR FINE"))
        .child(widgets::row().gap(px(8.0)).child(gain).child(scale_number))
        .child(heading("SELECT — 14 EASINGS, 10 REFUSED"))
        .child(easing_select)
        .child(heading("BUTTON STATES"))
        .child(states)
        .child(heading("SEVERITY — THE SETTINGS VOCABULARY"))
        .child(severities)
}

/// A view that owns a [`Lab`]. Only [`crate::editor::EditorView`] does.
pub trait LabHost {
    fn lab_mut(&mut self) -> &mut Lab;
}
