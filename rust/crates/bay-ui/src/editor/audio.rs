//! The Audio page — the mixer, the loudness meter, and the tall automation lanes.
//!
//! `pages.md`: *"Everything that happens to sound. Mixer, buses, meters, loudness, automation."*
//! The one thing it must not become is **a mixer whose faders are not audible**.
//!
//! # What is real here, and what is drawn dark
//!
//! M9 landed a streaming audio engine — a callback block mixer on a lock-free ring, frame-exact
//! clip windows, K-weighted metering with peak-hold, `pan` on clips *and* lanes, lane gain and
//! solo. Six undoable commands came with it, and **every fader, pan and mute on this page is
//! bound to one of them**. They are not decoration: they change the project, they undo, they
//! reach the export filtergraph, and they are what the next press of play mixes from.
//!
//! What they do **not** yet do is move the sound that is already playing. Playback still runs
//! through [`super::transport::EditorView::start_audio`], which mixes the whole remaining
//! timeline once with [`bay_audio::mix_stereo`] and hands the buffer to `rodio`. Once that
//! buffer is submitted the mix has happened; a fader moved against it changes the *next* play,
//! not this one, and there is no [`bay_audio::stream::BlockMixer`] running for a meter to read.
//! So the meters here are drawn — with their scale, their ticks and their −6 dBFS caution zone —
//! and left **dark**, with the reason on screen next to them. That is the rule from `pages.md`:
//! a control the engine cannot back is drawn and disabled, never hidden, because the disabled
//! controls are the map of the remaining engine work.
//!
//! Restarting the sink on every fader release was considered and rejected: `start_audio` mixes
//! the entire remainder of the timeline synchronously on the UI thread, so a fader on a
//! ten-minute film would stall the window on every touch. The fix is to wire the transport to
//! [`bay_audio::stream::StreamEngine`], which is engine work outside this file.
//!
//! # Composition order is not re-implemented here
//!
//! Clip pan → lane pan → lane gain, multiplied per channel, decided by
//! [`bay_audio::composed_pan_gains`] and pinned by tests in `bay-audio` and `bay-core`. This
//! page reads those numbers and writes them back through commands; it never multiplies two pans
//! together itself. The pan law is a **balance**, not constant power — centre is exactly
//! `[1, 1]` — which is why the pan readout says `C` at zero and never claims a level change.
//!
//! # Geometry: one lane origin, not a second one
//!
//! The tall lanes deliberately reuse the timeline's horizontal metrics — [`TIMELINE_PADDING`],
//! [`TRACK_LABEL_WIDTH`], [`TRACK_GAP`] — so a lane on this page starts at exactly
//! [`lane_origin_x`], the same window-space x the Cut timeline uses. That means
//! [`super::EditorView::scrub_to`] and [`super::EditorView::begin_scrub`] are correct here
//! unchanged, and there is no second coordinate system to drift. `audio_tests` asserts it.
//!
//! Vertically the lanes are tall and their height is **derived, in one function**
//! ([`tall_lane_height`]), which the lane element and everything drawn inside it both call. It
//! is not a second copy of `LANE_HEIGHT`, and it is not state: which track a press lands in is
//! decided by GPUI's own element bounds, because each lane owns its own `on_mouse_down`, so
//! there is no y → track arithmetic that could disagree with the drawing. A resizable lane
//! *would* need per-track state on `EditorView`; the grip that would do it is drawn disabled
//! and says so.

use std::cell::Cell;
use std::rc::Rc;

use gpui::{point, Bounds, Pixels, Point};

use super::gesture::{fingerprint, Gesture};
use super::*;
use crate::controls::Slider;
use crate::draw::{self, Shape};

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/// The fader's travel, in dB. −60 is the bottom of the throw and is treated as −∞: a fader
/// pulled all the way down is silence, not "very quiet", because that is what an editor means
/// when they pull one down.
const FADER_MIN_DB: f32 = -60.0;
const FADER_MAX_DB: f32 = 12.0;

/// The meter's floor. Same number as the fader's bottom so the two scales read together.
const METER_FLOOR_DB: f32 = -60.0;

/// Where the meter turns cautionary. −6 dBFS is the usual "you are close" mark; the delivery
/// chain's true-peak ceiling is −1.5, which is drawn as the last tick before full scale.
const METER_CAUTION_DB: f32 = -6.0;
const METER_CEILING_DB: f32 = -1.5;

/// Widths of the strip's controls. Fixed rather than flexed because a slider has to know its own
/// travel to place a thumb, and a fader whose travel changes with the window is a fader whose
/// detent moves.
const FADER_WIDTH: f32 = 240.0;
const PAN_WIDTH: f32 = 92.0;
const METER_WIDTH: f32 = 132.0;
const METER_HEIGHT: f32 = 26.0;
const STRIP_NAME_WIDTH: f32 = 148.0;

/// The loudness column. Wide enough for a readable contour, narrow enough that the strips keep
/// the room at 1440.
const LOUDNESS_WIDTH: f32 = 320.0;
const CONTOUR_HEIGHT: f32 = 116.0;

/// The loudness plot's vertical extent, in LUFS. −40 is far enough below the −26 bed floor to
/// show a trough; 0 is full scale and the plot never needs to draw above it.
const CONTOUR_TOP_LUFS: f64 = 0.0;
const CONTOUR_BOTTOM_LUFS: f64 = -40.0;

/// Height of the tall-lane band, and of its ruler.
///
/// 300 is `timeline.rs`'s own band height, repeated here on purpose: `pages.md` pins the
/// transport as the horizon line of the app, and this page keeps it at the same distance from
/// the window top as the Cut page by putting the *same* two bands under it —
/// [`super::EditorView::scene_bar`] (reused outright) and a lane band of this height.
const LANES_BAND_HEIGHT: f32 = 300.0;
const AUDIO_RULER_HEIGHT: f32 = RULER_HEIGHT;

/// The shortest a "tall" lane is allowed to get before the band scrolls instead of shrinking.
/// Below this a waveform is not a waveform and an automation curve has nowhere to go — which is
/// the whole reason this page has its own lanes rather than the Cut page's 40px ones.
const MIN_TALL_LANE: f32 = 72.0;

/// The tallest a single lane grows to when there is only one audio track. Without a ceiling a
/// lone lane fills 250px of band with one clip's waveform stretched over it, which reads as a
/// rendering bug rather than as a feature.
const MAX_TALL_LANE: f32 = 148.0;

/// Vertical gap between lanes, and the inset of a clip block inside its lane.
const LANE_GAP: f32 = 6.0;
const CLIP_INSET: f32 = 3.0;

/// How far past the visible lane the ruler's ticks are built.
///
/// A tick ladder is a function of zoom and scroll, and the panel's real width is not known until
/// prepaint — so ticks are built for a generous span and the lane's `overflow_hidden` cuts the
/// ones that fall outside. A few clipped divs are cheaper than a frame of stale geometry.
const RULER_OVERDRAW: f32 = 4000.0;

/// Points a clip's automation polyline is decimated to, at most. `drawing.md`: a plot is at most
/// one point per pixel of its own width, and the cost of a frame is linear in the sum of
/// `Shape::point_count`.
const MAX_AUTOMATION_POINTS: usize = 240;

/// The gain axis of an automation lane. Clips can sit above unity, so the ceiling is above 1.0;
/// `SetVolume` itself is clamped to 2.0 by the transport's mixer, so that is the top.
const AUTOMATION_MAX_GAIN: f32 = 2.0;

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/// Linear gain as dB on the fader's scale. Zero — and anything not a number — is the bottom of
/// the throw, which is where a muted lane's fader sits.
pub(super) fn gain_to_db(gain: f32) -> f32 {
    if !gain.is_finite() || gain <= 0.0 {
        return FADER_MIN_DB;
    }
    (20.0 * gain.log10()).clamp(FADER_MIN_DB, FADER_MAX_DB)
}

/// The inverse. **The bottom of the throw is exactly zero gain**, not 0.001: a fader pulled all
/// the way down has to produce silence, because `Track::mix_gain` and `stream_clips` both test
/// `> 0.0` to decide whether a lane is heard at all, and a lane at −60 dB that still allocates a
/// decode is a lane the user believes they turned off.
pub(super) fn db_to_gain(db: f32) -> f32 {
    if !db.is_finite() || db <= FADER_MIN_DB {
        return 0.0;
    }
    10f32.powf(db.min(FADER_MAX_DB) / 20.0)
}

/// `−6.0 dB`, `0.0 dB`, or `−∞` at the bottom of the throw.
fn format_db(db: f32) -> String {
    if !db.is_finite() || db <= FADER_MIN_DB {
        return "−∞".to_string();
    }
    format!("{db:+.1} dB")
}

/// A balance readout: `C`, `L34`, `R100`. Percent of the way to the near side, which is what the
/// balance law actually does — it attenuates the far channel by that fraction.
fn format_pan(pan: f32) -> String {
    if !pan.is_finite() || pan == 0.0 {
        return "C".to_string();
    }
    let percent = (pan.abs().min(1.0) * 100.0).round() as i32;
    if pan < 0.0 {
        format!("L{percent}")
    } else {
        format!("R{percent}")
    }
}

/// The height of one tall lane, given how many there are and how much band there is.
///
/// **The one source.** The lane element, the waveform inside it and the automation curve over it
/// all call this; nothing recomputes a lane height from a different expression. That is the
/// discipline `LANE_HEIGHT` earns by being a constant — the moment a height is derived in one
/// place and consumed in another, a click lands somewhere other than where it was drawn.
///
/// Clamped at both ends: below [`MIN_TALL_LANE`] the band scrolls rather than squashing, above
/// [`MAX_TALL_LANE`] a lone track stops filling the whole band.
fn tall_lane_height(track_count: usize, band_height: f32) -> f32 {
    if track_count == 0 || !band_height.is_finite() {
        return MIN_TALL_LANE;
    }
    let gaps = LANE_GAP * track_count.saturating_sub(1) as f32;
    let each = (band_height - gaps) / track_count as f32;
    if !each.is_finite() {
        return MIN_TALL_LANE;
    }
    each.clamp(MIN_TALL_LANE, MAX_TALL_LANE)
}

/// A peak-per-bucket run as a symmetric `(min, max)` envelope.
///
/// The timeline's cached peaks keep magnitude only, so this is a **peak envelope** — the shape a
/// rectified signal makes about its own axis — and not the signal. `drawing.md` is explicit that
/// the two are different claims, so the lane labels which one it is showing and draws them in
/// different colours. Real bipolar samples go through [`draw::envelope`] instead.
fn peak_envelope(peaks: &[f32]) -> Vec<(f32, f32)> {
    peaks
        .iter()
        .map(|peak| {
            let magnitude = if peak.is_finite() {
                peak.abs().min(1.0)
            } else {
                0.0
            };
            (-magnitude, magnitude)
        })
        .collect()
}

/// A clip's gain polyline as points in the clip's own box.
///
/// `points` is `(seconds from the clip's head, linear gain)` — exactly what
/// `Element::gain_points` produces and what the export's `volume` expression is built from, so
/// the curve drawn and the curve delivered are the same list of numbers.
///
/// Decimated to [`MAX_AUTOMATION_POINTS`] before any shape is built, never after.
fn automation_polyline(
    points: &[(f64, f32)],
    duration_seconds: f64,
    width: f32,
    height: f32,
) -> Vec<Point<Pixels>> {
    if points.len() < 2 || duration_seconds <= 0.0 || !(width.is_finite() && height.is_finite()) {
        return Vec::new();
    }
    // `div_ceil`, not integer division: 5,000 points over a 240-point budget divides to a
    // stride of 20 and yields 250 shapes, which is over budget by the amount the truncation
    // threw away. Rounding the stride up is what makes the budget a budget.
    let step = points.len().div_ceil(MAX_AUTOMATION_POINTS).max(1);
    let mut plotted: Vec<Point<Pixels>> = points
        .iter()
        .step_by(step)
        .map(|(seconds, gain)| gain_point(*seconds, *gain, duration_seconds, width, height))
        .collect();
    // Step-by can drop the last point, and the last point is where a fade-out reaches zero —
    // the one value of the curve a mixer most wants to see.
    if let Some(last) = points.last() {
        plotted.push(gain_point(last.0, last.1, duration_seconds, width, height));
    }
    plotted
}

fn gain_point(
    seconds: f64,
    gain: f32,
    duration_seconds: f64,
    width: f32,
    height: f32,
) -> Point<Pixels> {
    let x = unit(seconds / duration_seconds) as f32 * width;
    let level = unit(f64::from(gain) / f64::from(AUTOMATION_MAX_GAIN)) as f32;
    point(px(x), px(height - level * height))
}

/// Clamp to 0..=1, and send anything that is not a number to the bottom.
///
/// `f64::clamp` **passes NaN straight through** — it is `self.max(min).min(max)` and NaN
/// propagates through both. Every scale on this page runs a user-supplied or engine-supplied
/// number through a fraction, and one NaN reaching a `Shape` makes `draw` refuse the *whole*
/// polyline, so a single unmeasurable sample would delete the contour rather than dent it.
/// `drawing.md`: bad numbers draw nothing, they do not panic and they do not lie — which means
/// they have to be caught here, one value at a time, and not at the shape.
fn unit(fraction: f64) -> f64 {
    if fraction.is_finite() {
        fraction.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Where a LUFS value sits in the contour plot, as a y in a box `height` tall.
fn contour_y(lufs: f64, height: f32) -> f32 {
    let span = CONTOUR_TOP_LUFS - CONTOUR_BOTTOM_LUFS;
    unit((CONTOUR_TOP_LUFS - lufs) / span) as f32 * height
}

/// Where a dB value sits along a meter `width` wide.
fn meter_x(db: f32, width: f32) -> f32 {
    unit(f64::from(db - METER_FLOOR_DB) / f64::from(-METER_FLOOR_DB)) as f32 * width
}

/// `−14.2 LUFS`, or an em dash where there is no measurement. Never `0.0` for "unknown": a mixer
/// reading zero where nothing was measured is the failure this whole module is trying not to be.
fn format_lufs(value: Option<f64>) -> String {
    match value {
        Some(lufs) if lufs.is_finite() => format!("{lufs:.1} LUFS"),
        _ => "—".to_string(),
    }
}

fn format_lu(value: Option<f64>) -> String {
    match value {
        Some(lu) if lu.is_finite() => format!("{lu:.1} LU"),
        _ => "—".to_string(),
    }
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

impl EditorView {
    /// Whether the built mixer is shown instead of the placeholder.
    ///
    /// The mixer below is finished and tested, and it is *not* what a user should meet: its
    /// faders reach the export and the next press of play but are inaudible during playback,
    /// and its meters are dark, because the streaming block mixer exists and nothing calls it
    /// (`fixes.md` entry 15). A page full of controls that move and do nothing you can hear is
    /// worse than a page that says it is not ready.
    ///
    /// Kept behind a flag rather than deleted, following `lab.rs`: the work stands, it compiles,
    /// and it comes back the moment the transport runs the block mixer.
    pub(super) fn audio_mixer_enabled() -> bool {
        std::env::var("BAY_UI_AUDIO").is_ok_and(|value| value != "0" && !value.is_empty())
    }

    pub(super) fn audio_page(&self, cx: &mut gpui::Context<Self>) -> Div {
        if !Self::audio_mixer_enabled() {
            return self.placeholder_page(crate::page::Page::Audio);
        }
        self.audio_mixer(cx)
    }

    fn audio_mixer(&self, cx: &mut gpui::Context<Self>) -> Div {
        let vm = EditorViewModel::build(&self.editor);
        // Where the lanes landed this frame. `draw::measure` fills it at prepaint, which runs
        // before any event for this frame is dispatched, so the zoom and scroll handlers built
        // below read this frame's width rather than the last one's. See `drawing.md`.
        let lane_bounds: Rc<Cell<Bounds<Pixels>>> = Rc::new(Cell::new(Bounds::default()));

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .child(self.toolbar(&vm, cx))
            .child(self.mixer_band(cx))
            // The horizon line. Same construction as the Cut page: a 54px transport, then
            // `scene_bar`, then a 300px band. `pages.md` pins this, and matching it by reusing
            // the same elements is the only way to keep it matched.
            .child(self.audio_transport(&vm, lane_bounds.clone(), cx))
            .child(self.scene_bar(&vm, cx))
            .child(self.audio_lanes(&vm, lane_bounds, cx))
    }

    // -- the mixer -----------------------------------------------------------------------

    fn mixer_band(&self, cx: &mut Context<Self>) -> Div {
        let scene = self.editor.active_scene();
        let any_solo = scene.tracks.any_audio_solo();
        let strips: Vec<Div> = scene
            .tracks
            .audio
            .iter()
            .map(|track| self.track_strip(track, any_solo, cx))
            .collect();

        div()
            .flex()
            .flex_row()
            .flex_1()
            .min_h(px(0.0))
            .bg(rgb(theme::BG))
            .child(
                div()
                    .id("audio-strips")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w(px(0.0))
                    .min_h(px(0.0))
                    .overflow_y_scroll()
                    .p(px(10.0))
                    .gap(px(6.0))
                    .child(self.mixer_header())
                    .child(self.master_strip(cx))
                    .children(strips)
                    .children(
                        scene
                            .tracks
                            .audio
                            .is_empty()
                            .then(|| widgets::note("No audio lanes in this scene.")),
                    )
                    .child(self.clip_strip(cx))
                    .child(self.processing_panel(cx)),
            )
            .child(self.loudness_panel())
    }

    /// The one place the honest state of playback is stated, so it is not repeated on every
    /// strip. It is the sentence `pages.md` says this page must be able to make, and it cannot
    /// make it yet.
    fn mixer_header(&self) -> Div {
        widgets::row()
            .gap(px(10.0))
            .items_start()
            .child(widgets::section("MIXER"))
            .child(
                widgets::banner(
                    "Faders, pans, mutes and solo are live and undoable — they reach the export \
                     and the next press of play. They are not audible *during* playback, and the \
                     meters are dark: the transport still submits one pre-mixed buffer to rodio \
                     rather than running M9's streaming block mixer, so nothing is metering and \
                     a mix already handed to the device cannot be changed.",
                    theme::Severity::Warn.dot(),
                )
                .flex_1()
                .min_w(px(0.0)),
            )
    }

    /// The master bus, drawn and refused.
    ///
    /// There is no master in the model: `Tracks` holds `audio: Vec<Track>` and nothing they sum
    /// into, and the export filtergraph mixes the lanes straight to the output. A master fader
    /// here would be a control with nowhere to write — the exact thing `pages.md` forbids — so
    /// it is drawn at full size, disabled, and says why.
    fn master_strip(&self, cx: &mut Context<Self>) -> Div {
        self.strip_frame(theme::FAINT)
            .child(
                widgets::row()
                    .gap(px(10.0))
                    .child(self.strip_name("Master", "no bus in the project format", true))
                    .child(self.strip_toggle("master-mute", "M", false, false, cx, |_| {}))
                    .child(self.strip_toggle("master-solo", "S", false, false, cx, |_| {}))
                    .child(
                        self.labelled(
                            "PAN",
                            Slider::new("master-pan", 0.0, -1.0, 1.0)
                                .width(PAN_WIDTH)
                                .enabled(false)
                                .render(self, cx, |_, _, _| {}),
                            "C",
                        ),
                    )
                    .child(
                        self.labelled(
                            "FADER",
                            Slider::new("master-fader", 0.0, FADER_MIN_DB, FADER_MAX_DB)
                                .width(FADER_WIDTH)
                                .enabled(false)
                                .render(self, cx, |_, _, _| {}),
                            "0.0 dB",
                        ),
                    )
                    .child(self.meter(false)),
            )
            .child(widgets::note(
                "Buses do not exist. `Tracks` has one flat list of audio lanes and no bus they \
                 sum into, so a master fader would change nothing in the file and nothing in the \
                 export. Sub-mixes and aux sends wait on the same model change.",
            ))
    }

    /// One lane. Everything on this row is bound to a real, undoable command.
    fn track_strip(&self, track: &bay_core::Track, any_solo: bool, cx: &mut Context<Self>) -> Div {
        let id = track.id.clone();
        let clips = track.elements.len();
        let audible = track.is_audible(any_solo);
        let gain_db = gain_to_db(track.gain);

        // A lane silenced by someone *else's* solo is not muted and its fader is not down — it
        // is being held out of the mix by a rule about the other lanes. Saying "silent" and
        // naming the reason is the difference between a mixer and a set of checkboxes.
        let state = if track.hidden {
            "hidden".to_string()
        } else if track.muted {
            "muted".to_string()
        } else if any_solo && !track.solo {
            "silent — another lane is soloed".to_string()
        } else {
            format!("{clips} clip{}", if clips == 1 { "" } else { "s" })
        };

        self.strip_frame(if audible {
            theme::ACCENT
        } else {
            theme::DIM_DOT
        })
        .child(
            widgets::row()
                .gap(px(10.0))
                .child(self.strip_name(&track.name, &state, !audible))
                .child(self.strip_toggle(
                    SharedString::from(format!("strip-mute-{id}")),
                    "M",
                    track.muted,
                    true,
                    cx,
                    {
                        let (id, muted) = (id.clone(), track.muted);
                        move |this| {
                            this.editor.execute(Command::SetTrackMuted {
                                track_id: id.clone(),
                                muted: !muted,
                            });
                        }
                    },
                ))
                .child(self.strip_toggle(
                    SharedString::from(format!("strip-solo-{id}")),
                    "S",
                    track.solo,
                    true,
                    cx,
                    {
                        let (id, solo) = (id.clone(), track.solo);
                        move |this| {
                            this.editor.execute(Command::SetTrackSolo {
                                track_id: id.clone(),
                                solo: !solo,
                            });
                        }
                    },
                ))
                .child(
                    self.labelled(
                        "PAN",
                        Slider::new(format!("pan-{id}"), track.pan, -1.0, 1.0)
                            .width(PAN_WIDTH)
                            .detent(0.0)
                            .render(self, cx, {
                                let id = id.clone();
                                let gesture = Gesture::new();
                                move |this, pan, _| {
                                    let id = id.clone();
                                    gesture.commit(
                                        this,
                                        |view| track_fingerprint(view, &id),
                                        |view| {
                                            u8::from(view.editor.execute(Command::SetTrackPan {
                                                track_id: id.clone(),
                                                pan,
                                            }))
                                        },
                                    );
                                }
                            }),
                        &format_pan(track.pan),
                    ),
                )
                .child(
                    self.labelled(
                        "FADER",
                        // No detent at unity: `DETENT_PULL_PX` is 5px, which over a 72 dB throw
                        // is more than a decibel of dead zone either side of 0 dB — a fader you
                        // cannot set to −1 dB. Double-click returns to unity instead.
                        Slider::new(format!("fader-{id}"), gain_db, FADER_MIN_DB, FADER_MAX_DB)
                            .width(FADER_WIDTH)
                            .reset(0.0)
                            .render(self, cx, {
                                let id = id.clone();
                                let gesture = Gesture::new();
                                move |this, db, _| {
                                    let id = id.clone();
                                    gesture.commit(
                                        this,
                                        |view| track_fingerprint(view, &id),
                                        |view| {
                                            u8::from(view.editor.execute(Command::SetTrackVolume {
                                                track_id: id.clone(),
                                                gain: db_to_gain(db),
                                            }))
                                        },
                                    );
                                }
                            }),
                        &format_db(gain_db),
                    ),
                )
                .child(self.meter(false)),
        )
    }

    /// The selected clip, if it is audio. A clip's own level, pan and mute are separate gain
    /// stages from its lane's and are edited separately, the same way the mixer composes them.
    fn clip_strip(&self, cx: &mut Context<Self>) -> Div {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return widgets::note("Select an audio clip to edit its own level, pan and mute.");
        };
        let Some(audio) = self.editor.selected_element().and_then(|e| e.audio()) else {
            return widgets::note("The selected clip is not audio.");
        };
        let volume_db = gain_to_db(audio.volume);
        let role = audio.role.as_str();

        self.strip_frame(theme::MARKER)
            .child(
                widgets::row()
                    .gap(px(10.0))
                    .child(self.strip_name(&audio.name, &format!("clip · {role}"), audio.muted))
                    .child(self.strip_toggle("clip-mute", "M", audio.muted, true, cx, {
                        let (reference, muted) = (reference.clone(), audio.muted);
                        move |this| {
                            this.editor.execute(Command::SetMuted {
                                reference: reference.clone(),
                                muted: !muted,
                            });
                        }
                    }))
                    // Solo is a property of a lane, not of a clip — `Tracks::any_audio_solo`
                    // decides what it means and there is no per-clip equivalent. Drawn so the
                    // strip reads like the others, disabled because there is nothing to write.
                    .child(self.strip_toggle("clip-solo", "S", false, false, cx, |_| {}))
                    .child(
                        self.labelled(
                            "PAN",
                            Slider::new("clip-pan", audio.pan, -1.0, 1.0)
                                .width(PAN_WIDTH)
                                .detent(0.0)
                                .render(self, cx, {
                                    let reference = reference.clone();
                                    let gesture = Gesture::new();
                                    move |this, pan, _| {
                                        let reference = reference.clone();
                                        gesture.commit(
                                            this,
                                            |view| clip_fingerprint(view, &reference),
                                            |view| {
                                                u8::from(view.editor.execute(Command::SetPan {
                                                    reference: reference.clone(),
                                                    pan,
                                                }))
                                            },
                                        );
                                    }
                                }),
                            &format_pan(audio.pan),
                        ),
                    )
                    .child(
                        self.labelled(
                            "LEVEL",
                            Slider::new("clip-fader", volume_db, FADER_MIN_DB, FADER_MAX_DB)
                                .width(FADER_WIDTH)
                                .reset(0.0)
                                .render(self, cx, {
                                    let reference = reference.clone();
                                    let gesture = Gesture::new();
                                    move |this, db, _| {
                                        let reference = reference.clone();
                                        gesture.commit(
                                            this,
                                            |view| clip_fingerprint(view, &reference),
                                            |view| {
                                                u8::from(view.editor.execute(Command::SetVolume {
                                                    reference: reference.clone(),
                                                    volume: db_to_gain(db),
                                                }))
                                            },
                                        );
                                    }
                                }),
                            &format_db(volume_db),
                        ),
                    )
                    .child(self.meter(false)),
            )
            .child(widgets::note(format!(
                "Fades {:.2}s in, {:.2}s out. Composed as clip pan → lane pan → lane fader, \
                 multiplied per channel — the order the export filtergraph uses.",
                audio.fade_in.to_seconds_f64(),
                audio.fade_out.to_seconds_f64(),
            )))
    }

    /// Everything a Fairlight strip has that this engine does not.
    ///
    /// Drawn as ordinary controls and disabled, each naming what is missing. `DialogueAudioChain`
    /// is the interesting one: it is in the project format *and* it reaches the export
    /// filtergraph, so the processing exists — there is simply no verb that edits it and no UI
    /// that ever wrote one.
    fn processing_panel(&self, cx: &mut Context<Self>) -> Div {
        let mut chain = |label: &'static str, id: &'static str, why: &str| -> Div {
            widgets::row()
                .gap(px(10.0))
                .child(
                    div()
                        .w(px(STRIP_NAME_WIDTH))
                        .flex_none()
                        .text_xs()
                        .text_color(rgb(theme::DISABLED_TEXT))
                        .child(Self::shared(label.to_string())),
                )
                .child(
                    Slider::new(id, 0.0, -12.0, 12.0)
                        .width(PAN_WIDTH)
                        .enabled(false)
                        .render(self, cx, |_, _, _| {}),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .text_xs()
                        .text_color(rgb(theme::FAINT))
                        .child(Self::shared(why.to_string())),
                )
        };

        widgets::card()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .child(widgets::section("PROCESSING"))
            .child(chain(
                "EQ",
                "fx-eq",
                "`DialogueAudioChain` carries a high-pass and a presence band into the export \
                 filtergraph, but nothing in the model or the MCP surface can set one.",
            ))
            .child(chain(
                "Dynamics",
                "fx-comp",
                "Same chain: compressor and limiter stages exist and are applied on export. \
                 There is no verb that edits them, so there is nothing for this to write.",
            ))
            .child(chain(
                "Aux send",
                "fx-send",
                "No buses. A send needs somewhere to send to; see the master strip.",
            ))
            .child(chain(
                "ADR",
                "fx-adr",
                "Not in the engine. Recording is not a capability bay has at all — there is no \
                 input path, only decode and playback.",
            ))
            .child(chain(
                "Voice isolation",
                "fx-isolate",
                "Not in the engine. `bay-speech` synthesises; it does not separate sources.",
            ))
    }

    // -- strip pieces --------------------------------------------------------------------

    fn strip_frame(&self, edge: u32) -> Div {
        widgets::card_edged(edge)
            .flex()
            .flex_col()
            .gap(px(4.0))
            .overflow_hidden()
    }

    fn strip_name(&self, name: &str, detail: &str, dim: bool) -> Div {
        div()
            .w(px(STRIP_NAME_WIDTH))
            .flex_none()
            .overflow_hidden()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(if dim { theme::MUTED } else { theme::TEXT }))
                    .child(Self::shared(name.to_string())),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child(Self::shared(detail.to_string())),
            )
    }

    /// A label above a control with its value beside it. The value is the model's, not the
    /// slider's — a readout that only updated on release would disagree with the thumb.
    fn labelled(&self, label: &'static str, control: gpui::AnyElement, value: &str) -> Div {
        widgets::row()
            .gap(px(6.0))
            .flex_none()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child(Self::shared(label.to_string())),
            )
            .child(control)
            .child(
                div()
                    .w(px(58.0))
                    .flex_none()
                    .font_family("ui-monospace")
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(value.to_string())),
            )
    }

    /// A small on/off square. `id` is an `ElementId` rather than a `&'static str` because
    /// there is one of these per lane and a repeated id is a collision, not a duplicate — the
    /// class of bug the paint tests exist to catch.
    #[allow(clippy::too_many_arguments)]
    fn strip_toggle(
        &self,
        id: impl Into<gpui::ElementId>,
        label: &'static str,
        on: bool,
        enabled: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        let face = div()
            .id(id)
            .w(px(24.0))
            .h(px(22.0))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(px(4.0))
            .text_xs()
            .bg(rgb(match (enabled, on) {
                (false, _) => theme::DISABLED,
                (true, true) => theme::ACCENT,
                (true, false) => theme::PANEL_ALT,
            }))
            .text_color(rgb(match (enabled, on) {
                (false, _) => theme::DISABLED_TEXT,
                (true, true) => theme::ON_ACCENT,
                (true, false) => theme::MUTED,
            }))
            .child(label);
        if !enabled {
            return face;
        }
        face.cursor_pointer()
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this);
                cx.notify();
            }))
    }

    /// A level meter: the scale, the ticks, the caution zone — and no bar.
    ///
    /// `live` is always false today and is a parameter rather than a constant so that wiring the
    /// transport to `StreamEngine` lights this by passing a `Levels` in, without redrawing the
    /// scale. Everything here is a path (`drawing.md`: vector geometry is a path), so it costs
    /// one canvas per strip.
    fn meter(&self, live: bool) -> Div {
        let ink = if live {
            theme::TEXT
        } else {
            theme::DISABLED_TEXT
        };
        let mut shapes = vec![
            // The trough.
            Shape::area(
                vec![
                    point(px(0.0), px(4.0)),
                    point(px(METER_WIDTH), px(4.0)),
                    point(px(METER_WIDTH), px(16.0)),
                    point(px(0.0), px(16.0)),
                ],
                if live { theme::LANE } else { theme::DISABLED },
            ),
            // Where the meter starts warning, and the delivered true-peak ceiling. Dashed
            // because they are guides, not data — the same distinction the graticules use.
            Shape::dashed(
                vec![
                    point(px(meter_x(METER_CAUTION_DB, METER_WIDTH)), px(3.0)),
                    point(px(meter_x(METER_CAUTION_DB, METER_WIDTH)), px(17.0)),
                ],
                1.0,
                if live { theme::WARN } else { theme::DIM_DOT },
                [2.0, 2.0],
            ),
            Shape::line(
                vec![
                    point(px(meter_x(METER_CEILING_DB, METER_WIDTH)), px(3.0)),
                    point(px(meter_x(METER_CEILING_DB, METER_WIDTH)), px(17.0)),
                ],
                1.0,
                if live { theme::RECORD } else { theme::DIM_DOT },
            ),
        ];
        for db in [-60.0f32, -40.0, -20.0, -12.0, -6.0, 0.0] {
            let x = meter_x(db, METER_WIDTH);
            shapes.push(Shape::line(
                vec![point(px(x), px(18.0)), point(px(x), px(22.0))],
                1.0,
                theme::DIM_DOT,
            ));
        }

        div()
            .w(px(METER_WIDTH))
            .h(px(METER_HEIGHT))
            .flex_none()
            .relative()
            .child(draw::paint(shapes).absolute().size_full())
            .child(
                div()
                    .absolute()
                    .left(px(4.0))
                    .top(px(4.0))
                    .text_xs()
                    .text_color(rgb(ink))
                    .child(if live { "" } else { "no signal" }),
            )
    }

    // -- loudness ------------------------------------------------------------------------

    /// The loudness column, measured rather than guessed.
    ///
    /// `bay_project::mix::envelope` builds the contour from each asset's integrated loudness —
    /// measured once at import and carried in the project — and the gain envelope the project
    /// describes. It is pure: no decode, no ffmpeg, no device, which is why it can run on a page
    /// that has no engine under it. What it cannot do is measure an asset nobody has measured,
    /// and when that is the case it says so and draws **no numbers at all** rather than numbers
    /// that are not comparable.
    fn loudness_panel(&self) -> Div {
        let envelope = bay_core::project::mix::envelope(self.editor.project());
        let width = LOUDNESS_WIDTH - 24.0;

        let body = if !envelope.unmeasured.is_empty() {
            let names: Vec<String> = envelope
                .unmeasured
                .iter()
                .take(4)
                .map(|id| {
                    self.editor
                        .media()
                        .iter()
                        .find(|asset| &asset.id == id)
                        .map(|asset| asset.name.clone())
                        .unwrap_or_else(|| id.clone())
                })
                .collect();
            div().child(widgets::banner(
                format!(
                    "Not measurable. These are heard but have never been measured, so no level \
                     here would be comparable: {}.",
                    names.join(", ")
                ),
                theme::Severity::Warn.dot(),
            ))
        } else if envelope.samples.is_empty() {
            div().child(widgets::note("Nothing sounding on this timeline."))
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(self.loudness_contour(&envelope, width))
                .child(self.loudness_readouts(&envelope))
        };

        div()
            .w(px(LOUDNESS_WIDTH))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .p(px(12.0))
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("LOUDNESS"))
            .child(body)
    }

    fn loudness_contour(&self, envelope: &bay_core::project::mix::MixEnvelope, width: f32) -> Div {
        let samples = &envelope.samples;
        // One point per pixel at most, decimated before any shape is built.
        let step = (samples.len() / width.max(1.0) as usize).max(1);
        let span = samples.len().saturating_sub(1).max(1) as f32;
        let x_of = |index: usize| px(index as f32 / span * width);

        let programme: Vec<Point<Pixels>> = samples
            .iter()
            .enumerate()
            .step_by(step)
            .map(|(index, sample)| point(x_of(index), px(contour_y(sample.lufs, CONTOUR_HEIGHT))))
            .collect();
        let bed: Vec<Point<Pixels>> = samples
            .iter()
            .enumerate()
            .step_by(step)
            .filter_map(|(index, sample)| {
                sample
                    .bed_lufs
                    .map(|lufs| point(x_of(index), px(contour_y(lufs, CONTOUR_HEIGHT))))
            })
            .collect();

        let mut shapes = Vec::new();
        // The two levels the delivery chain and the mix check are specified against.
        for (lufs, color) in [
            (bay_core::project::mix::DELIVERY_LUFS, theme::OK),
            (bay_core::project::mix::MIN_GAP_BED_LUFS, theme::FAINT),
        ] {
            let y = px(contour_y(lufs, CONTOUR_HEIGHT));
            shapes.push(Shape::dashed(
                vec![point(px(0.0), y), point(px(width), y)],
                1.0,
                color,
                [3.0, 3.0],
            ));
        }
        if bed.len() > 1 {
            shapes.push(Shape::line(bed, 1.0, theme::MUTED));
        }
        if programme.len() > 1 {
            shapes.push(Shape::line(programme, 1.5, theme::ACCENT));
        }
        // The loudest 400ms of the film, which is where the payoff is supposed to land.
        if let Some(at) = envelope.peak_at_seconds {
            let end = samples.last().map(|s| s.at_seconds).unwrap_or(0.0);
            if end > 0.0 {
                let x = px((at / end).clamp(0.0, 1.0) as f32 * width);
                shapes.push(Shape::line(
                    vec![point(x, px(0.0)), point(x, px(CONTOUR_HEIGHT))],
                    1.0,
                    theme::MARKER,
                ));
            }
        }

        div()
            .w(px(width))
            .h(px(CONTOUR_HEIGHT))
            .bg(rgb(theme::LANE))
            .rounded(px(4.0))
            .overflow_hidden()
            .child(draw::paint(shapes).size_full())
    }

    fn loudness_readouts(&self, envelope: &bay_core::project::mix::MixEnvelope) -> Div {
        let separation = envelope.separation_lu();
        let short = separation.is_some_and(|lu| lu < bay_core::project::mix::MIN_SEPARATION_LU)
            && envelope.has_speech;

        let line = |label: &str, value: String, warn: bool| -> Div {
            widgets::row()
                .justify_between()
                .gap(px(8.0))
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(theme::FAINT))
                        .child(Self::shared(label.to_string())),
                )
                .child(
                    div()
                        .font_family("ui-monospace")
                        .text_xs()
                        .text_color(rgb(if warn { theme::WARN } else { theme::TEXT }))
                        .child(Self::shared(value)),
                )
        };

        div()
            .flex()
            .flex_col()
            .gap(px(3.0))
            .child(line("Authored", format_lufs(envelope.authored_lufs), false))
            .child(line(
                "Delivered at",
                format!("{:.1} LUFS", bay_core::project::mix::DELIVERY_LUFS),
                false,
            ))
            .child(line(
                "Narration",
                format_lufs(envelope.narration_lufs),
                false,
            ))
            .child(line("Gap", format_lufs(envelope.gap_lufs), false))
            .child(line(
                "Bed in gaps",
                format_lufs(envelope.gap_bed_lufs),
                false,
            ))
            .child(line("Separation", format_lu(separation), short))
            .children(short.then(|| {
                widgets::note(format!(
                    "The lines are only {} above the gaps; the mix check wants {:.0} LU. \
                     Positional, so scaling every fader changes it by nothing.",
                    format_lu(separation),
                    bay_core::project::mix::MIN_SEPARATION_LU,
                ))
            }))
            .children((!envelope.has_speech).then(|| {
                widgets::note(
                    "No speech clip sounds, so narration, gap and separation are not questions \
                     about this project.",
                )
            }))
    }

    // -- transport -----------------------------------------------------------------------

    /// This page's transport band.
    ///
    /// The same height and the same left-to-right rhythm as the Cut page's, so `pages.md`'s
    /// horizon line holds; the right-hand cluster is this page's own, because zoom on this page
    /// applies to these lanes and "clear solo" has nowhere else to live. The zoom anchors read
    /// the lane width that `draw::measure` recorded at prepaint rather than deriving one from
    /// the window, which is how a zoom stays anchored on the playhead when a panel is open.
    fn audio_transport(
        &self,
        vm: &EditorViewModel,
        lane_bounds: Rc<Cell<Bounds<Pixels>>>,
        cx: &mut Context<Self>,
    ) -> Div {
        let any_solo = self.editor.active_scene().tracks.any_audio_solo();
        let zoom_out = lane_bounds.clone();
        let zoom_in = lane_bounds.clone();
        let fit = lane_bounds;

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
                    .child(self.transport_button("audio-seek-start", "|◀", cx, |this| {
                        this.editor.seek(MediaTime::ZERO)
                    }))
                    .child(self.transport_button("audio-seek-back", "◀◀", cx, |this| {
                        this.seek_by(-TICKS_PER_SECOND);
                    })),
            )
            .child(
                div()
                    .id("audio-play")
                    .w(px(44.0))
                    .h(px(32.0))
                    .rounded(px(6.0))
                    .bg(rgb(theme::ACCENT))
                    .text_color(rgb(theme::ON_ACCENT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(if self.playing { "❚❚" } else { "▶" })
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_play();
                        cx.notify();
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("audio-seek-fwd", "▶▶", cx, |this| {
                        this.seek_by(TICKS_PER_SECOND);
                    }))
                    .child(self.transport_button("audio-seek-end", "▶|", cx, |this| {
                        this.editor.seek(this.editor.duration())
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(6.0))
                    .ml(px(6.0))
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_color(rgb(theme::TEXT))
                            .child(shared_text(timecode(vm.playhead_seconds))),
                    )
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(shared_text(format!("/ {}", timecode(vm.duration_seconds)))),
                    ),
            )
            .child(div().flex_1())
            .child(self.transport_button(
                "audio-clear-solo",
                if any_solo { "Clear solo" } else { "No solo" },
                cx,
                |this| {
                    // One undo step per lane, which is what six separate `SetTrackSolo` commands
                    // are. Grouping them would need a batch verb the engine does not have, and
                    // inventing one in the view is exactly the logic that belongs in `bay-core`.
                    let soloed: Vec<String> = this
                        .editor
                        .active_scene()
                        .tracks
                        .audio
                        .iter()
                        .filter(|track| track.solo)
                        .map(|track| track.id.clone())
                        .collect();
                    for track_id in soloed {
                        this.editor.execute(Command::SetTrackSolo {
                            track_id,
                            solo: false,
                        });
                    }
                },
            ))
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(
                        self.transport_button("audio-zoom-out", "−", cx, move |this| {
                            let width = f32::from(zoom_out.get().size.width).max(1.0);
                            let anchor = this.playhead_anchor_x(width);
                            this.zoom_by(1.0 / 1.5, anchor, width);
                        }),
                    )
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(shared_text(format!(
                                "{} px/s",
                                self.timeline.pixels_per_second().round() as i64
                            ))),
                    )
                    .child(
                        self.transport_button("audio-zoom-in", "+", cx, move |this| {
                            let width = f32::from(zoom_in.get().size.width).max(1.0);
                            let anchor = this.playhead_anchor_x(width);
                            this.zoom_by(1.5, anchor, width);
                        }),
                    )
                    .child(self.transport_button("audio-fit", "Fit", cx, move |this| {
                        this.fit_to_window(f32::from(fit.get().size.width).max(1.0));
                    })),
            )
    }

    // -- the tall lanes ------------------------------------------------------------------

    /// The lane band: a ruler and one tall lane per audio track.
    ///
    /// Horizontally identical to the Cut timeline's rows — `TIMELINE_PADDING`,
    /// `TRACK_LABEL_WIDTH`, `TRACK_GAP` — so the lanes start at exactly `lane_origin_x()` and
    /// the existing scrub arithmetic is correct here without a second origin to keep in step.
    fn audio_lanes(
        &self,
        vm: &EditorViewModel,
        lane_bounds: Rc<Cell<Bounds<Pixels>>>,
        cx: &mut Context<Self>,
    ) -> Div {
        let scene = self.editor.active_scene();
        let any_solo = scene.tracks.any_audio_solo();
        let count = scene.tracks.audio.len();
        let band = LANES_BAND_HEIGHT - AUDIO_RULER_HEIGHT - TIMELINE_PADDING * 2.0;
        let height = tall_lane_height(count, band);
        let scroll_bounds = lane_bounds.clone();

        let lanes: Vec<Div> = scene
            .tracks
            .audio
            .iter()
            .enumerate()
            .map(|(index, track)| {
                self.tall_lane(track, index, height, any_solo, vm.playhead_seconds, cx)
            })
            .collect();

        div()
            .flex()
            .flex_col()
            .h(px(LANES_BAND_HEIGHT))
            .flex_none()
            .p(px(TIMELINE_PADDING))
            .gap_1()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .on_scroll_wheel(cx.listener(
                move |this, event: &gpui::ScrollWheelEvent, window, cx| {
                    let delta = event.delta.pixel_delta(window.line_height());
                    if delta.x != gpui::Pixels::ZERO {
                        let width = f32::from(scroll_bounds.get().size.width).max(1.0);
                        this.scroll_by(f32::from(delta.x), width);
                        cx.notify();
                    }
                },
            ))
            .child(self.audio_ruler(lane_bounds, cx))
            .child(
                div()
                    .id("audio-lanes")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h(px(0.0))
                    .gap(px(LANE_GAP))
                    .overflow_y_scroll()
                    .children(lanes)
                    .children((count == 0).then(|| widgets::note("No audio lanes in this scene."))),
            )
    }

    /// The ruler over the lanes. Also the element that measures the lane width for this frame.
    fn audio_ruler(&self, lane_bounds: Rc<Cell<Bounds<Pixels>>>, cx: &mut Context<Self>) -> Div {
        let geometry = self.geometry();
        let ticks = geometry.ruler_ticks(RULER_OVERDRAW);
        let playhead_x = geometry.ticks_to_px(self.editor.playhead());

        widgets::row()
            .gap(px(TRACK_GAP))
            .h(px(AUDIO_RULER_HEIGHT))
            .flex_none()
            .child(
                div()
                    .w(px(TRACK_LABEL_WIDTH))
                    .flex_none()
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child("AUTOMATION"),
            )
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_w(px(0.0))
                    .h(px(AUDIO_RULER_HEIGHT))
                    .overflow_hidden()
                    // A press on the ruler scrubs, exactly as on the Cut page — and correctly,
                    // because this lane's left edge is `lane_origin_x()` by construction.
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                            this.begin_scrub(event);
                            cx.notify();
                        }),
                    )
                    // `label` is `Some` only on major ticks; a minor tick is a hairline.
                    .children(ticks.into_iter().map(|tick| {
                        match tick.label {
                            Some(label) => div()
                                .absolute()
                                .left(px(tick.x))
                                .top(px(2.0))
                                .text_xs()
                                .text_color(rgb(theme::FAINT))
                                .child(Self::shared(label)),
                            None => div()
                                .absolute()
                                .left(px(tick.x))
                                .top(px(AUDIO_RULER_HEIGHT - 5.0))
                                .w(px(1.0))
                                .h(px(4.0))
                                .bg(rgb(theme::DIM_DOT)),
                        }
                    }))
                    .child(
                        div()
                            .absolute()
                            .left(px(playhead_x))
                            .top(px(0.0))
                            .w(px(2.0))
                            .h(px(AUDIO_RULER_HEIGHT))
                            .bg(rgb(theme::ACCENT)),
                    )
                    // Zero ink, and the frame's real lane geometry. Placed last so it covers the
                    // whole lane; `measure` paints nothing, so it hides none of it.
                    .child(draw::measure(lane_bounds).absolute().size_full()),
            )
    }

    /// One tall lane: its header, its clips, their waveforms and their automation curves.
    #[allow(clippy::too_many_arguments)]
    fn tall_lane(
        &self,
        track: &bay_core::Track,
        index: usize,
        height: f32,
        any_solo: bool,
        playhead_seconds: f64,
        cx: &mut Context<Self>,
    ) -> Div {
        let geometry = self.geometry();
        let audible = track.is_audible(any_solo);
        let clips: Vec<gpui::Stateful<Div>> = track
            .elements
            .iter()
            .enumerate()
            .filter_map(|(clip_index, element)| {
                let audio = element.audio()?;
                Some(self.tall_clip(
                    element,
                    audio,
                    &track.id,
                    (index, clip_index),
                    height,
                    audible,
                    cx,
                ))
            })
            .collect();

        widgets::row()
            .gap(px(TRACK_GAP))
            .flex_none()
            .items_start()
            .child(self.lane_header(track, height, cx))
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_w(px(0.0))
                    .h(px(height))
                    .rounded_md()
                    .bg(rgb(theme::LANE))
                    .overflow_hidden()
                    // The lane's own press. **This** is what maps a pointer to a track: GPUI's
                    // element bounds, not arithmetic over a lane height — so a press at the very
                    // bottom of a tall lane belongs to this lane by construction and cannot be
                    // off by the difference between two copies of a height.
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _window, cx| {
                            this.begin_scrub(event);
                            cx.notify();
                        }),
                    )
                    .children(clips)
                    .child(
                        div()
                            .absolute()
                            .left(px(geometry.seconds_to_px(playhead_seconds)))
                            .top(px(0.0))
                            .w(px(2.0))
                            .h(px(height))
                            .bg(rgb(theme::ACCENT)),
                    ),
            )
    }

    fn lane_header(&self, track: &bay_core::Track, height: f32, cx: &mut Context<Self>) -> Div {
        let id = track.id.clone();
        div()
            .w(px(TRACK_LABEL_WIDTH))
            .h(px(height))
            .flex_none()
            .flex()
            .flex_col()
            .justify_between()
            .overflow_hidden()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(track.name.clone())),
            )
            .child(
                widgets::row()
                    .gap(px(3.0))
                    .child(self.strip_toggle(
                        SharedString::from(format!("lane-mute-{id}")),
                        "M",
                        track.muted,
                        true,
                        cx,
                        {
                            let (id, muted) = (id.clone(), track.muted);
                            move |this| {
                                this.editor.execute(Command::SetTrackMuted {
                                    track_id: id.clone(),
                                    muted: !muted,
                                });
                            }
                        },
                    ))
                    .child(self.strip_toggle(
                        SharedString::from(format!("lane-solo-{id}")),
                        "S",
                        track.solo,
                        true,
                        cx,
                        {
                            let (id, solo) = (id.clone(), track.solo);
                            move |this| {
                                this.editor.execute(Command::SetTrackSolo {
                                    track_id: id.clone(),
                                    solo: !solo,
                                });
                            }
                        },
                    ))
                    // The grip that would make this lane resizable. `tall_lane_height` derives
                    // every lane's height from the band, and a lane the user can drag taller is
                    // a per-track height that has to live on `EditorView` — state, not a
                    // derivation. Drawn disabled rather than hidden, per `pages.md`.
                    .child(self.strip_toggle(
                        SharedString::from(format!("lane-resize-{id}")),
                        "⇕",
                        false,
                        false,
                        cx,
                        |_| {},
                    )),
            )
    }

    /// One audio clip in a tall lane: a waveform, its automation curve, and its name.
    ///
    /// Long in arguments because a clip block is a function of its element, its lane, its lane's
    /// audibility and this frame's geometry, and bundling four of those into a struct that
    /// exists only to be unpacked here would hide rather than simplify.
    #[allow(clippy::too_many_arguments)]
    fn tall_clip(
        &self,
        element: &Element,
        audio: &bay_core::AudioElement,
        track_id: &str,
        ids: (usize, usize),
        lane_height: f32,
        audible: bool,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        let geometry = self.geometry();
        let reference = ElementRef::new(track_id.to_string(), element.id().to_string());
        let selected = self.editor.is_selected(&reference);
        let left = geometry.seconds_to_px(element.start().to_seconds_f64());
        let duration = element.duration().to_seconds_f64();
        let width = (duration as f32 * self.timeline.pixels_per_second()).max(MIN_BLOCK_WIDTH);
        let inner = (lane_height - CLIP_INSET * 2.0).max(1.0);
        let plot_width = (width - 2.0).max(1.0);

        // A real bipolar waveform if the samples are in the play cache; the cached peak
        // envelope otherwise. They are different claims and the corner label says which.
        let (shape, source) = match self.audio_cache.get(&audio.media_id) {
            Some(pcm) => {
                let buckets = plot_width.min(MAX_AUTOMATION_POINTS as f32) as usize;
                let envelope = draw::envelope(&pcm.samples, buckets.max(2));
                (
                    draw::envelope_outline(&envelope, plot_width, inner),
                    "waveform",
                )
            }
            None => {
                let peaks = self.waveforms.peaks(&audio.media_id, WAVEFORM_BUCKETS);
                match peaks.filter(|peaks| peaks.len() > 1) {
                    Some(peaks) => (
                        draw::envelope_outline(&peak_envelope(peaks), plot_width, inner),
                        "peaks",
                    ),
                    None => (Vec::new(), ""),
                }
            }
        };

        let mut shapes = Vec::new();
        if shape.len() > 2 {
            shapes.push(Shape::area(
                shape,
                if source == "waveform" {
                    theme::ACCENT_SOFT
                } else {
                    theme::MUTED
                },
            ));
        }
        // Unity, so a curve that sits above or below it is readable as such without a scale.
        let unity_y = px(inner - (1.0 / AUTOMATION_MAX_GAIN) * inner);
        shapes.push(Shape::dashed(
            vec![point(px(0.0), unity_y), point(px(plot_width), unity_y)],
            1.0,
            theme::FAINT,
            [3.0, 3.0],
        ));
        // The automation curve: the same `(seconds, gain)` polyline the export's `volume`
        // expression is built from, fades included. Read-only — riding it needs a vertical
        // pointer gesture, and every gesture in this editor is driven from the x axis alone
        // (`controls::drive_value_drag`). A curve that looked draggable and was not would be
        // the lying control this repo keeps a register for.
        let curve = automation_polyline(&element.gain_points(), duration, plot_width, inner);
        if curve.len() > 1 {
            shapes.push(Shape::line(curve.clone(), 1.5, theme::MARKER));
            for at in &curve {
                shapes.push(Shape::disc(*at, 2.0, theme::MARKER));
            }
        }

        let mut block = div()
            .id(("audio-clip", ids.0 * 1_000 + ids.1))
            .absolute()
            .left(px(left))
            .top(px(CLIP_INSET))
            .w(px(width))
            .h(px(inner))
            .rounded_md()
            .overflow_hidden()
            .bg(rgb(if audible && !audio.muted {
                theme::PANEL_ALT
            } else {
                theme::DISABLED
            }))
            .child(draw::paint(shapes).absolute().size_full())
            .child(
                div()
                    .absolute()
                    .left(px(4.0))
                    .top(px(2.0))
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(audio.name.clone())),
            )
            .children((!source.is_empty()).then(|| {
                div()
                    .absolute()
                    .right(px(4.0))
                    .top(px(2.0))
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child(source)
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, _window, cx| {
                    // Selecting a clip is not also a scrub of the lane underneath it.
                    cx.stop_propagation();
                    this.editor.select(vec![reference.clone()]);
                    cx.notify();
                }),
            );
        if selected {
            block = block.border_1().border_color(rgb(theme::SELECTED_BORDER));
        }
        block
    }
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

/// The arithmetic first, then the tree.
///
/// The value tests are what stop a fader lying about a level; the paint tests are what stop a
/// canvas painting outside its phase or a shape being built from a NaN. Neither substitutes for
/// looking at the app, which `todo.pages.md` tracks separately.
/// Fingerprint of one audio lane, for [`Gesture`].
///
/// Scoped to the lane rather than the whole scene: a fingerprint that changes when *anything*
/// changes would refuse to coalesce whenever a worker finished a waveform mid-drag.
fn track_fingerprint(view: &EditorView, track_id: &str) -> u64 {
    match view.editor.active_scene().tracks.track(track_id) {
        Some(track) => fingerprint(serde_json::to_string(track)),
        None => 0,
    }
}

/// Fingerprint of one clip, for [`Gesture`]. Same reasoning as [`track_fingerprint`].
fn clip_fingerprint(view: &EditorView, reference: &ElementRef) -> u64 {
    match view.editor.active_scene().element(reference) {
        Some(element) => fingerprint(serde_json::to_string(element)),
        None => 0,
    }
}

#[cfg(test)]
mod audio_tests {
    use super::*;
    use gpui::{size, TestAppContext, VisualTestContext};

    // -- one drag, one undo entry --------------------------------------------------------

    /// A fader drag is one undo entry, not one per pointer sample.
    ///
    /// `Slider::render`'s contract is explicit that `on_change` fires "throughout the drag, not
    /// only at the end", and these four controls called `editor.execute` directly — so a drag at
    /// 120 Hz left a hundred-odd entries and backing it out took a hundred presses of Cmd+Z.
    /// `Command::SetVolume`'s own doc said a dragged control "has to coalesce into history as one
    /// gesture"; the Motion page did it and the Audio page did not, because `Gesture` lived
    /// inside `motion.rs`.
    ///
    /// Driven through `Gesture` directly rather than through a synthetic pointer drag: what is
    /// under test is the coalescing, and routing it through the widget layer would test that too
    /// and fail for its reasons.
    #[gpui::test]
    fn a_fader_drag_is_one_undo_entry(cx: &mut TestAppContext) {
        let view = cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| EditorView::new(Editor::starter(), focus, None, None))
        });
        view.update(cx, |this, _| {
            let track_id = this
                .editor
                .active_scene()
                .tracks
                .audio
                .first()
                .map(|t| t.id.clone());
            let Some(track_id) = track_id else {
                panic!("the starter project has no audio lane to drag a fader on");
            };

            let gesture = Gesture::new();
            // Sixty samples is half a second of dragging at 120 Hz.
            for step in 0..60 {
                let gain = 0.2 + step as f32 * 0.01;
                let id = track_id.clone();
                gesture.commit(
                    this,
                    |view| track_fingerprint(view, &id),
                    |view| {
                        u8::from(view.editor.execute(Command::SetTrackVolume {
                            track_id: id.clone(),
                            gain,
                        }))
                    },
                );
            }

            let moved = this
                .editor
                .active_scene()
                .tracks
                .track(&track_id)
                .expect("the lane is still there")
                .gain;
            assert!(
                (moved - 0.79).abs() < 0.01,
                "the drag did not land on its final value, it landed on {moved}"
            );

            // One undo returns the fader to where the drag started, not to the previous sample.
            this.editor.undo();
            let after = this
                .editor
                .active_scene()
                .tracks
                .track(&track_id)
                .expect("the lane is still there")
                .gain;
            assert!(
                (after - 1.0).abs() < 1e-6,
                "one undo left the fader at {after}; sixty samples became sixty history entries"
            );
        });
    }

    // -- the fader's scale ---------------------------------------------------------------

    /// Unity has to survive the round trip exactly, or a fader that was never touched writes a
    /// gain a hair off 1.0 into the project the first time anything redraws it.
    #[test]
    fn unity_is_exactly_unity_in_both_directions() {
        assert_eq!(gain_to_db(1.0), 0.0);
        assert_eq!(db_to_gain(0.0), 1.0);
    }

    /// The bottom of the throw is silence, not "quiet". `Track::mix_gain` and `stream_clips`
    /// both test `> 0.0` to decide whether a lane is heard at all — a fader pulled all the way
    /// down that still returned 0.001 would leave the lane in the mix and its files decoding.
    #[test]
    fn the_bottom_of_the_throw_is_silence() {
        assert_eq!(db_to_gain(FADER_MIN_DB), 0.0);
        assert_eq!(db_to_gain(-1000.0), 0.0);
        assert_eq!(gain_to_db(0.0), FADER_MIN_DB);
    }

    /// Halving the gain is −6 dB, and it comes back.
    #[test]
    fn the_fader_is_a_decibel_scale() {
        assert!((gain_to_db(0.5) + 6.0206).abs() < 0.001);
        assert!((db_to_gain(-6.0206) - 0.5).abs() < 0.0001);
        assert!((gain_to_db(2.0) - 6.0206).abs() < 0.001);
    }

    /// Every value the fader can produce is a gain the mixer will accept. NaN reaching
    /// `SetTrackVolume` would silence a lane with no way to tell why.
    #[test]
    fn no_fader_position_produces_a_gain_the_mixer_would_refuse() {
        for step in 0..=720 {
            let db = FADER_MIN_DB + step as f32 * 0.1;
            let gain = db_to_gain(db);
            assert!(gain.is_finite() && gain >= 0.0, "{db} dB gave {gain}");
        }
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(db_to_gain(bad).is_finite());
            assert!(gain_to_db(bad).is_finite());
        }
    }

    /// The pan readout must never claim a side at centre — the law is a balance and centre is
    /// exactly `[1, 1]`, so "C" is a statement about the gains and not a rounding.
    #[test]
    fn the_pan_readout_names_the_side_it_is_on() {
        assert_eq!(format_pan(0.0), "C");
        assert_eq!(format_pan(-0.34), "L34");
        assert_eq!(format_pan(1.0), "R100");
        assert_eq!(format_pan(f32::NAN), "C");
        assert_eq!(bay_audio::pan_gains(0.0), bay_audio::CENTRE);
    }

    #[test]
    fn a_fader_at_the_bottom_reads_as_minus_infinity() {
        assert_eq!(format_db(FADER_MIN_DB), "−∞");
        assert_eq!(format_db(f32::NAN), "−∞");
        assert_eq!(format_db(0.0), "+0.0 dB");
    }

    // -- lane height ---------------------------------------------------------------------

    /// The height is derived once and clamped at both ends. Ten lanes in a 250px band cannot
    /// each be 25px tall — below `MIN_TALL_LANE` the band scrolls instead, which is the
    /// behaviour that makes these "tall tracks" rather than the Cut page's lanes with more air.
    #[test]
    fn a_tall_lane_is_tall_however_many_there_are() {
        for count in 1..=12 {
            let height = tall_lane_height(count, 250.0);
            assert!(
                height >= MIN_TALL_LANE,
                "{count} lanes gave {height}px, below the floor"
            );
            assert!(height <= MAX_TALL_LANE);
        }
        // A lone lane does not swallow the whole band.
        assert_eq!(tall_lane_height(1, 1000.0), MAX_TALL_LANE);
        // Degenerate inputs give a lane, not a panic or a negative height.
        assert_eq!(tall_lane_height(0, 250.0), MIN_TALL_LANE);
        assert_eq!(tall_lane_height(3, f32::NAN), MIN_TALL_LANE);
        assert!(tall_lane_height(3, -500.0) >= MIN_TALL_LANE);
    }

    /// **The lane origin is not a second coordinate system.** The tall lanes are built from the
    /// same three constants the Cut timeline's rows are, so a press anywhere in them is read by
    /// the existing `scrub_to` correctly. If this ever stops holding, a scrub on this page
    /// lands somewhere other than the pointer — the `lane_origin_x` defect, again.
    #[test]
    fn the_tall_lanes_start_at_the_same_x_as_the_cut_timelines() {
        assert_eq!(
            TIMELINE_PADDING + TRACK_LABEL_WIDTH + TRACK_GAP,
            lane_origin_x()
        );
    }

    // -- automation ----------------------------------------------------------------------

    /// The curve is decimated before shapes are built, never after — `drawing.md`'s first rule
    /// for anything that plots.
    #[test]
    fn an_automation_curve_is_decimated_before_it_becomes_a_shape() {
        let points: Vec<(f64, f32)> = (0..5_000)
            .map(|i| (i as f64 / 100.0, (i % 100) as f32 / 100.0))
            .collect();
        let plotted = automation_polyline(&points, 50.0, 300.0, 90.0);
        assert!(
            plotted.len() <= MAX_AUTOMATION_POINTS + 1,
            "{} points would be tessellated",
            plotted.len()
        );
        // The last point survives decimation, wherever it falls: it is where a fade-out
        // reaches zero, which is the one value of the curve a mixer most wants to see, and a
        // stride that skips it draws a fade that does not end.
        let last = plotted.last().expect("a curve");
        let (seconds, gain) = *points.last().expect("input");
        assert_eq!(*last, gain_point(seconds, gain, 50.0, 300.0, 90.0));
    }

    /// A curve stays inside its own box, and a degenerate clip draws nothing rather than a line
    /// through infinity.
    #[test]
    fn an_automation_curve_stays_in_its_box() {
        let points = vec![(0.0, 0.0), (1.0, 2.0), (2.0, 1.0)];
        for at in automation_polyline(&points, 2.0, 120.0, 60.0) {
            assert!((0.0..=120.0).contains(&f32::from(at.x)));
            assert!((0.0..=60.0).contains(&f32::from(at.y)));
        }
        assert!(automation_polyline(&points, 0.0, 120.0, 60.0).is_empty());
        assert!(automation_polyline(&points[..1], 2.0, 120.0, 60.0).is_empty());
    }

    /// A gain above the axis ceiling is clamped to the top rather than drawn off the lane, and
    /// a NaN gain is drawn at the floor rather than skipped — `draw` refuses a whole shape with
    /// a non-finite point in it, so letting one through would delete the curve.
    #[test]
    fn a_bad_gain_does_not_delete_the_curve() {
        let points = vec![(0.0, f32::NAN), (1.0, 99.0), (2.0, 1.0)];
        let plotted = automation_polyline(&points, 2.0, 100.0, 50.0);
        assert!(plotted.len() > 1);
        for at in plotted {
            assert!(f32::from(at.x).is_finite() && f32::from(at.y).is_finite());
        }
    }

    // -- meter and contour scales ---------------------------------------------------------

    /// The meter's floor is the fader's floor, so the two scales on one strip read together.
    #[test]
    fn the_meter_and_the_fader_share_a_floor() {
        assert_eq!(METER_FLOOR_DB, FADER_MIN_DB);
        assert_eq!(meter_x(METER_FLOOR_DB, 100.0), 0.0);
        assert_eq!(meter_x(0.0, 100.0), 100.0);
        assert_eq!(meter_x(-30.0, 100.0), 50.0);
        // Above full scale is pinned at full scale, not drawn off the end of the trough.
        assert_eq!(meter_x(6.0, 100.0), 100.0);
        // A NaN goes to the floor rather than through the clamp — `f32::clamp` propagates NaN,
        // and one NaN in a shape makes `draw` refuse the whole polyline.
        assert_eq!(meter_x(f32::NAN, 100.0), 0.0);
    }

    /// The shared guard. `f64::clamp` is `max(min).min(max)`, so it hands NaN back unchanged —
    /// which is the whole reason this function exists rather than a bare `.clamp(0.0, 1.0)`.
    #[test]
    fn a_fraction_that_is_not_a_number_goes_to_the_floor() {
        assert_eq!(unit(0.5), 0.5);
        assert_eq!(unit(-3.0), 0.0);
        assert_eq!(unit(7.0), 1.0);
        assert_eq!(unit(f64::NAN), 0.0);
        assert_eq!(unit(f64::INFINITY), 0.0);
        assert_eq!(unit(f64::NEG_INFINITY), 0.0);
        assert!(
            f64::NAN.clamp(0.0, 1.0).is_nan(),
            "if clamp ever starts catching NaN, `unit` can go"
        );
    }

    #[test]
    fn the_contour_maps_lufs_top_down() {
        assert_eq!(contour_y(CONTOUR_TOP_LUFS, 100.0), 0.0);
        assert_eq!(contour_y(CONTOUR_BOTTOM_LUFS, 100.0), 100.0);
        assert!(contour_y(-14.0, 100.0) > 0.0 && contour_y(-14.0, 100.0) < 100.0);
        assert_eq!(contour_y(f64::NAN, 100.0), 0.0);
        assert_eq!(contour_y(f64::INFINITY, 100.0), 0.0);
    }

    /// A peak run is a *magnitude*, so it is drawn about its own axis and labelled `peaks`, not
    /// `waveform`. `drawing.md` names the two as different claims.
    #[test]
    fn a_peak_envelope_is_symmetric_about_the_axis() {
        let envelope = peak_envelope(&[0.0, 0.5, 1.0, f32::NAN, 2.0]);
        assert_eq!(envelope[1], (-0.5, 0.5));
        assert_eq!(envelope[3], (0.0, 0.0), "NaN is silence, not a spike");
        assert_eq!(envelope[4], (-1.0, 1.0), "clamped to full scale");
    }

    #[test]
    fn nothing_measured_reads_as_nothing_rather_than_zero() {
        assert_eq!(format_lufs(None), "—");
        assert_eq!(format_lufs(Some(f64::NAN)), "—");
        assert_eq!(format_lufs(Some(-14.25)), "-14.2 LUFS");
        assert_eq!(format_lu(None), "—");
    }

    // -- behaviour on a real editor ------------------------------------------------------

    fn view(cx: &mut TestAppContext) -> gpui::Entity<EditorView> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| {
                let mut view = EditorView::new(Editor::starter(), focus, None, None);
                view.page = Page::Audio;
                view
            })
        })
    }

    /// A fader moved to −6 dB writes a gain of 0.5, undoes back to what it was, and the value
    /// the strip would redraw is the one that went in. This is the whole claim of the page: the
    /// control is bound to a real, undoable command and not to a field in the view.
    #[gpui::test]
    fn a_fader_writes_an_undoable_gain(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let track_id = this.editor.active_scene().tracks.audio[0].id.clone();
            let before = this.editor.active_scene().tracks.audio[0].gain;

            this.editor.execute(Command::SetTrackVolume {
                track_id: track_id.clone(),
                gain: db_to_gain(-6.0206),
            });
            let after = this.editor.active_scene().tracks.audio[0].gain;
            assert!((after - 0.5).abs() < 0.0001, "gain came out {after}");
            assert!((gain_to_db(after) + 6.0206).abs() < 0.01, "and reads back");

            assert!(this.editor.undo());
            assert_eq!(this.editor.active_scene().tracks.audio[0].gain, before);
        });
    }

    /// Solo silences the other lanes, and the mixer the *room* would use agrees with the model
    /// the strip is drawn from. `stream_clips` is where that rule actually lives — the strip
    /// must not have its own copy of it.
    #[gpui::test]
    fn solo_is_a_rule_about_the_other_lanes_not_a_checkbox(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let scene = this.editor.active_scene();
            if scene.tracks.audio.len() < 2 {
                return;
            }
            let first = scene.tracks.audio[0].id.clone();
            this.editor.execute(Command::SetTrackSolo {
                track_id: first.clone(),
                solo: true,
            });
            let tracks = &this.editor.active_scene().tracks;
            assert!(tracks.any_audio_solo());
            for track in &tracks.audio {
                assert_eq!(track.is_audible(true), track.id == first);
            }
        });
    }

    /// **A press at the bottom of a tall lane.** The lane is up to 148px tall and the time under
    /// the pointer must not depend on how far down it landed — the vertical axis carries no time
    /// and the horizontal mapping is `lane_origin_x`-relative for every y. This is the test the
    /// brief asked for; it passes because the page never turns a y into a track, and instead
    /// lets each lane element own its own press.
    #[gpui::test]
    fn a_press_at_the_bottom_of_a_tall_lane_seeks_to_the_same_time(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            let height = tall_lane_height(this.editor.active_scene().tracks.audio.len(), 250.0);
            assert!(height >= MIN_TALL_LANE);

            this.scrub_to(lane_origin_x() + 96.0);
            let at_top = this.editor.playhead();
            this.editor.seek(MediaTime::ZERO);
            // The same x, however tall the lane is: `scrub_to` takes only an x, which is
            // exactly why a tall lane cannot mis-map. If a y ever enters this path, this test
            // stops being the guarantee it is.
            this.scrub_to(lane_origin_x() + 96.0);
            assert_eq!(this.editor.playhead(), at_top);
            assert_eq!(at_top.to_seconds_f64(), 2.0);
        });
    }

    /// Scrolled lanes, too: the scroll offset is in the geometry both the drawing and the scrub
    /// read, so a clip drawn under the pointer is the clip the press lands on.
    #[gpui::test]
    fn a_scrolled_tall_lane_still_scrubs_where_it_was_drawn(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |this, _| {
            this.timeline = this.timeline.with_scroll_x(240.0);
            this.scrub_to(lane_origin_x() + 96.0);
            let expected = this.geometry().px_to_frame_time(96.0);
            assert_eq!(this.editor.playhead(), expected);
            assert_eq!(this.editor.playhead().to_seconds_f64(), 7.0);
        });
    }

    // -- paint ---------------------------------------------------------------------------

    fn windowed(cx: &mut TestAppContext) -> (gpui::Entity<EditorView>, &mut VisualTestContext) {
        let (view, cx) = crate::paint_harness::window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            let mut view = EditorView::new(Editor::starter(), focus, None, None);
            view.page = Page::Audio;
            view
        });
        (view, cx)
    }

    use crate::paint_harness::paint;

    /// The window the app opens, and two that are far too small for this page's fixed columns.
    /// `pages.md` makes the small window a condition of the milestone, and a contour plot
    /// squeezed to a negative width is exactly the shape of bug this catches.
    #[gpui::test]
    fn the_audio_page_paints_at_every_size(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 640.0, 420.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// With a clip selected the clip strip appears, adding four more controls and a second set
    /// of paths — and with a lane muted and another soloed, every disabled branch is drawn too.
    #[gpui::test]
    fn the_audio_page_paints_with_a_selection_and_a_solo(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |this, _| {
            let scene = this.editor.active_scene();
            let Some(track) = scene.tracks.audio.first() else {
                return;
            };
            let track_id = track.id.clone();
            if let Some(element) = track.elements.first() {
                let reference = ElementRef::new(track_id.clone(), element.id().to_string());
                this.editor.select(vec![reference]);
            }
            this.editor.execute(Command::SetTrackSolo {
                track_id: track_id.clone(),
                solo: true,
            });
            this.editor.execute(Command::SetTrackMuted {
                track_id,
                muted: true,
            });
        });
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// A fader mid-drag paints from the live gesture, and a gesture dragged far off the control
    /// still has to paint inside it.
    #[gpui::test]
    fn a_fader_mid_drag_paints(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |this, cx| {
            let track_id = this.editor.active_scene().tracks.audio[0].id.clone();
            let track = gpui::Bounds {
                origin: gpui::point(px(400.0), px(200.0)),
                size: size(px(FADER_WIDTH), px(18.0)),
            };
            crate::controls::begin_track_drag(
                this,
                format!("fader-{track_id}").into(),
                crate::controls::ScrubMap::track(0.0, 1.0, FADER_MIN_DB, FADER_MAX_DB),
                track,
                gpui::point(px(500.0), px(209.0)),
                gpui::Modifiers::default(),
                0.0,
                std::rc::Rc::new(move |view: &mut EditorView, db, _| {
                    view.editor.execute(Command::SetTrackVolume {
                        track_id: track_id.clone(),
                        gain: db_to_gain(db),
                    });
                }),
            );
            crate::controls::drive_value_drag(this, gpui::point(px(-4000.0), px(2000.0)), true, cx);
        });
        paint(&view, cx, 1440.0, 900.0);
    }
}
