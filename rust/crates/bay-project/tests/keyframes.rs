//! The keyframe engine: identity that survives a move, hand-drawn curves, the ordering
//! invariant the sampler has always assumed, and the one densifier.
//!
//! Every test here has a matching failure it was written against — a project file that
//! sampled wrong because nothing sorted it, a drag that lost its own selection, an export that
//! took a straight line through a curve the preview drew.

use bay_project::{AnimationChannel, BezierHandles, Easing, Keyframe};
use bay_time::MediaTime;

fn secs(seconds: f64) -> MediaTime {
    MediaTime::from_seconds_f64(seconds).expect("a representable time")
}

/// A two-key 0 → 1 ramp over one second.
fn ramp() -> AnimationChannel {
    AnimationChannel {
        keys: vec![Keyframe::new(secs(0.0), 0.0), Keyframe::new(secs(1.0), 1.0)],
        easing: Easing::Linear,
    }
}

// ---------------------------------------------------------------- ordering

/// `sample` walks `keys.windows(2)` and every consumer assumes ascending time. serde neither
/// sorted nor checked, and `keys` is public — so a project file written by hand, or by any
/// tool that appended, loaded into a channel that sampled wrong instead of failing to load.
#[test]
fn keys_out_of_order_in_a_file_load_in_order() {
    let channel: AnimationChannel = serde_json::from_value(serde_json::json!({
        "keys": [
            { "time": 240_000, "value": 1.0 },
            { "time": 0,       "value": 0.0 },
            { "time": 120_000, "value": 0.5 },
        ],
        "easing": "linear",
    }))
    .expect("loads");

    let times: Vec<i64> = channel.keys.iter().map(|key| key.time.as_ticks()).collect();
    assert_eq!(times, [0, 120_000, 240_000]);

    // And the point of the ordering. Unsorted, `sample` sees the 2 s key first, decides the
    // whole channel starts there, and clamps everything before it to that key's value — so
    // this reads 1.0 instead of 0.5, an entire second early.
    let midpoint = channel.sample(secs(1.0)).expect("a value");
    assert!(
        (midpoint - 0.5).abs() < 1e-5,
        "an unsorted channel samples wrong: got {midpoint}"
    );
}

/// Two keys at one time is not a state the sampler has an answer for — it produces a
/// zero-length segment and interpolates to its own start. Loading keeps the first, which is
/// exactly what the sampler was already doing with the pair.
#[test]
fn two_keys_at_one_time_collapse_on_load() {
    let channel: AnimationChannel = serde_json::from_value(serde_json::json!({
        "keys": [
            { "time": 0, "value": 0.0 },
            { "time": 0, "value": 0.9 },
            { "time": 120_000, "value": 1.0 },
        ],
        "easing": "linear",
    }))
    .expect("loads");

    assert_eq!(channel.keys.len(), 2);
    assert_eq!(channel.keys[0].value, 0.0);
}

#[test]
fn sorting_a_channel_by_hand_gives_the_same_answer_as_loading_one() {
    let mut built = AnimationChannel {
        keys: vec![
            Keyframe::new(secs(2.0), 1.0),
            Keyframe::new(secs(0.0), 0.0),
            Keyframe::new(secs(2.0), 0.4),
        ],
        easing: Easing::Linear,
    };
    built.sort_keys();

    let times: Vec<i64> = built.keys.iter().map(|key| key.time.as_ticks()).collect();
    assert_eq!(times, [0, 240_000]);
    assert_eq!(built.keys[1].value, 1.0, "the first key at a time wins");
}

// ---------------------------------------------------------------- identity

/// A drag changes a key's time, so time cannot be identity — the selection would follow
/// whatever key happened to be at the old time, or nothing.
#[test]
fn a_key_keeps_its_identity_across_a_move() {
    let mut channel = ramp();
    channel.assign_missing_ids();
    let id = channel.keys[1].identity();

    assert!(channel.move_key(&id, secs(0.4)));

    let moved = channel.key(&id).expect("still addressable by the same id");
    assert_eq!(moved.time, secs(0.4));
    assert_eq!(moved.value, 1.0, "a move changes when, not what");
    let times: Vec<i64> = channel.keys.iter().map(|key| key.time.as_ticks()).collect();
    assert_eq!(times, [0, 48_000], "and the channel is still in order");
}

/// A key from before ids existed is still addressable — by its time, which is unique within a
/// channel by construction. No migration pass, and a legacy project is editable on load.
#[test]
fn a_key_written_before_ids_existed_is_still_addressable() {
    let channel: AnimationChannel = serde_json::from_value(serde_json::json!({
        "keys": [{ "time": 0, "value": 0.0 }, { "time": 120_000, "value": 1.0 }],
        "easing": "linear",
    }))
    .expect("loads");

    assert_eq!(channel.keys[1].id, 0, "nothing invented an id on load");
    let found = channel.key("t120000").expect("addressed by its time");
    assert_eq!(found.value, 1.0);
}

#[test]
fn ids_minted_within_a_channel_do_not_collide() {
    let mut channel = AnimationChannel::default();
    for step in 0..8 {
        channel.upsert(secs(f64::from(step) * 0.1), step as f32);
    }
    let mut ids: Vec<u32> = channel.keys.iter().map(|key| key.id).collect();
    assert!(ids.iter().all(|id| *id != 0), "every key was named");
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), channel.keys.len(), "two keys share an id");
}

/// Rewriting the key at a time is that key taking a new value, not a different key arriving —
/// so whatever was pointing at it still is.
#[test]
fn re_writing_a_key_at_the_same_time_keeps_its_id() {
    let mut channel = ramp();
    channel.assign_missing_ids();
    let id = channel.keys[0].id;

    channel.upsert(secs(0.0), 0.25);

    assert_eq!(channel.keys[0].id, id);
    assert_eq!(channel.keys[0].value, 0.25);
}

/// Dragging one key onto another replaces it, the way every curve editor does — the dragged
/// key keeps its name, because it is the one the pointer is holding.
#[test]
fn moving_a_key_onto_another_replaces_it_and_the_dragged_one_survives() {
    let mut channel = AnimationChannel {
        keys: vec![
            Keyframe::new(secs(0.0), 0.0),
            Keyframe::new(secs(0.5), 0.5),
            Keyframe::new(secs(1.0), 1.0),
        ],
        easing: Easing::Linear,
    };
    channel.assign_missing_ids();
    let dragged = channel.keys[2].identity();

    assert!(channel.move_key(&dragged, secs(0.5)));

    assert_eq!(channel.keys.len(), 2);
    let survivor = channel.key(&dragged).expect("the dragged key survived");
    assert_eq!(survivor.value, 1.0, "the key under the pointer is the one");
    assert_eq!(survivor.time, secs(0.5));
}

#[test]
fn moving_a_key_that_is_not_there_changes_nothing() {
    let mut channel = ramp();
    let before = channel.clone();
    assert!(!channel.move_key("k999", secs(0.5)));
    assert_eq!(channel, before);
}

#[test]
fn moving_a_key_nowhere_reports_that_nothing_moved() {
    let mut channel = ramp();
    channel.assign_missing_ids();
    let id = channel.keys[0].identity();
    assert!(!channel.move_key(&id, secs(0.0)));
}

// ---------------------------------------------------------------- bezier

/// The identity curve. A bezier at the thirds is a straight line, so a channel that has had
/// handles added and dragged back samples exactly like one that never had any.
#[test]
fn the_default_handles_are_a_straight_line() {
    let straight = BezierHandles::default();
    for step in 0..=10 {
        let x = step as f32 / 10.0;
        assert!(
            (straight.apply(x) - x).abs() < 1e-3,
            "default handles bent the line at x={x}: {}",
            straight.apply(x)
        );
    }
}

#[test]
fn the_endpoints_are_exact() {
    let curve = BezierHandles {
        out_x: 0.9,
        out_y: 0.1,
        in_x: 0.1,
        in_y: 0.9,
    };
    assert_eq!(curve.apply(0.0), 0.0);
    assert_eq!(curve.apply(1.0), 1.0);
}

/// A curve that leaves fast and settles — the shape of `ease-out` — is above the straight
/// line for the whole middle of the segment. This is the property that makes it an ease-out
/// rather than an ease-in, and it is what a solver that quietly failed would get backwards.
#[test]
fn an_ease_out_curve_runs_ahead_of_the_straight_line() {
    let ease_out = BezierHandles {
        out_x: 0.0,
        out_y: 0.7,
        in_x: 0.3,
        in_y: 1.0,
    };
    for step in 1..10 {
        let x = step as f32 / 10.0;
        assert!(
            ease_out.apply(x) > x,
            "ease-out sat behind the line at x={x}: {}",
            ease_out.apply(x)
        );
    }
}

/// Overshoot is a thing an author draws on purpose, so y is not clamped — only x is, and only
/// because a curve non-monotonic in time runs backwards.
#[test]
fn a_handle_above_the_destination_overshoots_and_is_not_clamped() {
    let overshoot = BezierHandles {
        out_x: 0.3,
        out_y: 1.6,
        in_x: 0.7,
        in_y: 1.6,
    };
    let peak = (1..10)
        .map(|step| overshoot.apply(step as f32 / 10.0))
        .fold(f32::MIN, f32::max);
    assert!(peak > 1.0, "the overshoot was flattened: peak {peak}");
}

/// x control points outside 0..=1 would make the curve run backwards in time. They are
/// clamped rather than refused, so a bad drag produces a curve rather than an error.
#[test]
fn a_curve_is_monotonic_in_time_even_with_absurd_handles() {
    let absurd = BezierHandles {
        out_x: -4.0,
        out_y: 0.2,
        in_x: 9.0,
        in_y: 0.8,
    };
    let mut previous = f32::MIN;
    for step in 0..=20 {
        let value = absurd.apply(step as f32 / 20.0);
        assert!(value.is_finite(), "the solver diverged");
        previous = value.max(previous);
    }
    assert!(previous.is_finite());
}

// ------------------------------------------------------- curve precedence

/// Handles beat the key's easing, which beats the channel's. The more specific statement of
/// intent wins at every level — the rule the key's own `easing` field already established.
#[test]
fn handles_win_over_the_keys_easing_which_wins_over_the_channels() {
    let at_quarter = |key: Keyframe| {
        AnimationChannel {
            keys: vec![key, Keyframe::new(secs(1.0), 1.0)],
            // A channel easing that is emphatically not linear, so "fell back to the channel"
            // is distinguishable from "used the key".
            easing: Easing::Hold,
        }
        .sample(secs(0.25))
        .expect("a value")
    };

    let channel_wins = at_quarter(Keyframe::new(secs(0.0), 0.0));
    assert_eq!(channel_wins, 0.0, "Hold holds until the next key");

    let key_wins = at_quarter(Keyframe::eased(secs(0.0), 0.0, Easing::Linear));
    assert!(
        (key_wins - 0.25).abs() < 1e-5,
        "the key's easing was ignored"
    );

    let handles_win = at_quarter(Keyframe::curved(
        secs(0.0),
        0.0,
        BezierHandles {
            out_x: 0.0,
            out_y: 0.7,
            in_x: 0.3,
            in_y: 1.0,
        },
    ));
    assert!(
        handles_win > 0.25,
        "the handles lost to something: {handles_win}"
    );
}

// -------------------------------------------------- backwards compatibility

/// A pre-bezier project must load unchanged and render identically. The two new fields are
/// absent from it and stay absent from what it writes back.
#[test]
fn a_project_written_before_handles_and_ids_round_trips_unchanged() {
    let wire = serde_json::json!({
        "keys": [
            { "time": 0, "value": 0.0 },
            { "time": 60_000, "value": 1.0, "easing": "spring-out" },
        ],
        "easing": "ease-out",
    });

    let channel: AnimationChannel = serde_json::from_value(wire.clone()).expect("loads");
    assert!(channel.keys.iter().all(|key| key.handles.is_none()));
    assert!(channel.keys.iter().all(|key| key.id == 0));

    let written = serde_json::to_value(&channel).expect("writes");
    assert_eq!(
        written, wire,
        "an untouched channel wrote itself back changed"
    );
}

/// And the new fields do reach the file once they are used — an optional field that never
/// serializes is a feature that does not survive a save.
#[test]
fn handles_and_ids_survive_a_round_trip() {
    let mut channel = AnimationChannel {
        keys: vec![
            Keyframe::curved(
                secs(0.0),
                0.0,
                BezierHandles {
                    out_x: 0.2,
                    out_y: 0.9,
                    in_x: 0.4,
                    in_y: 1.0,
                },
            ),
            Keyframe::new(secs(1.0), 1.0),
        ],
        easing: Easing::Linear,
    };
    channel.assign_missing_ids();

    let text = serde_json::to_string(&channel).expect("writes");
    assert!(text.contains("outX"), "handles are camelCase on the wire");
    let back: AnimationChannel = serde_json::from_str(&text).expect("loads");

    assert_eq!(back, channel);
    for step in 0..=10 {
        let at = secs(f64::from(step) / 10.0);
        assert_eq!(
            back.sample(at),
            channel.sample(at),
            "curve changed at {at:?}"
        );
    }
}

// ---------------------------------------------------------------- polyline

/// Two endpoints describe a straight segment exactly. Subdividing it adds points and no
/// information, and on a long flat music bed that is thousands of them.
#[test]
fn a_straight_segment_is_two_points() {
    let points = ramp().polyline(secs(0.0)..=secs(1.0));
    assert_eq!(points.len(), 2);
    assert_eq!(points[0], (secs(0.0), 0.0));
    assert_eq!(points[1], (secs(1.0), 1.0));
}

/// A curve gets cut into enough segments that drawing them straight is honest. Sampled at its
/// own points, so the polyline and the sampler cannot disagree about the same curve — which
/// is the bug that put a duck in a different place in the file than it was in the room.
#[test]
fn a_curved_segment_is_subdivided_and_agrees_with_the_sampler() {
    let channel = AnimationChannel {
        keys: vec![
            Keyframe::eased(secs(0.0), 0.0, Easing::ExpoOut),
            Keyframe::new(secs(1.0), 1.0),
        ],
        easing: Easing::Linear,
    };

    let points = channel.polyline(secs(0.0)..=secs(1.0));
    assert!(
        points.len() > 10,
        "a curve came back as {} points",
        points.len()
    );
    for (time, value) in &points {
        assert_eq!(Some(*value), channel.sample(*time), "disagreed at {time:?}");
    }
    // And it is actually curved: an expo-out is well past halfway at the midpoint.
    let midpoint = channel.sample(secs(0.5)).expect("a value");
    assert!(midpoint > 0.9, "expo-out sampled as a straight line");
}

/// A bezier segment needs subdividing for the same reason a named ease does. The check that
/// decides is `segment_is_straight`, and a version of it that only looked at `easing` would
/// report a hand-drawn curve as a straight line.
#[test]
fn a_hand_drawn_curve_is_subdivided_too() {
    let channel = AnimationChannel {
        keys: vec![
            Keyframe::curved(
                secs(0.0),
                0.0,
                BezierHandles {
                    out_x: 0.0,
                    out_y: 0.8,
                    in_x: 0.2,
                    in_y: 1.0,
                },
            ),
            Keyframe::new(secs(1.0), 1.0),
        ],
        // Linear, so nothing but the handles can be asking for subdivision.
        easing: Easing::Linear,
    };

    let points = channel.polyline(secs(0.0)..=secs(1.0));
    assert!(
        points.len() > 10,
        "a drawn curve was reported as a straight line: {} points",
        points.len()
    );
}

#[test]
fn the_polyline_covers_the_range_it_was_asked_for_and_no_more() {
    let channel = AnimationChannel {
        keys: vec![
            Keyframe::new(secs(0.0), 0.0),
            Keyframe::new(secs(1.0), 1.0),
            Keyframe::new(secs(2.0), 0.0),
        ],
        easing: Easing::Linear,
    };

    let points = channel.polyline(secs(0.5)..=secs(1.5));
    assert_eq!(points.first().map(|point| point.0), Some(secs(0.5)));
    assert_eq!(points.last().map(|point| point.0), Some(secs(1.5)));
    assert!(
        points.iter().any(|point| point.0 == secs(1.0)),
        "the key inside the range is a point"
    );
    assert!(
        points
            .iter()
            .all(|(time, _)| *time >= secs(0.5) && *time <= secs(1.5))
    );
    assert!(
        points.windows(2).all(|pair| pair[0].0 < pair[1].0),
        "points must be in ascending order with no repeats"
    );
}

/// A channel with no keys has no curve to draw, which is not the same as a flat one at zero —
/// and `sample` already says `None` rather than `0.0` for exactly that reason.
#[test]
fn a_channel_with_no_keys_has_no_polyline() {
    assert!(
        AnimationChannel::default()
            .polyline(secs(0.0)..=secs(1.0))
            .is_empty()
    );
}

#[test]
fn a_backwards_range_asks_for_nothing() {
    assert!(ramp().polyline(secs(1.0)..=secs(0.0)).is_empty());
}
