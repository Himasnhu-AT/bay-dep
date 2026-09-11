//! What can be keyframed on an element, and what a curve editor needs to draw it.
//!
//! Two jobs, deliberately in one place.
//!
//! **What is animatable.** The engine samples more channels than any single list named. The
//! flat [`Element::ANIMATABLE`] covers thirteen transform properties; the sampler also reads
//! `mask.*`, `effect.<id>.<param>`, `shape.radius`, `stroke.width`, `fontSize` and `volume`,
//! each from a different method. Every caller that wanted to validate a property path
//! re-derived a subset of that, and they disagreed: `animate` over MCP accepted `mask.x` and
//! `effect.<id>.<param>`, `AddKeyframe` refused both **silently** — its lowering returns
//! `None`, which is no patch, no error and no undo entry — and nothing anywhere accepted
//! `shape.radius`, `stroke.width` or `fontSize`, which the renderer has sampled all along.
//! [`Element::animatable_paths`] is the one answer, derived per element from what that element
//! actually has.
//!
//! **What the number means.** A curve editor cannot draw a value axis for a channel it only
//! knows by name: opacity runs 0..1, rotation is degrees either side of zero, `x` is a
//! fraction of the canvas, and a blur's sigma has no upper bound at all. That last case is why
//! [`AnimatableProperty::range`] is an `Option` — inventing a range for a shader parameter
//! would draw a confident axis around a guess.

use crate::element::{Element, ShapeKind};

/// What a channel's numbers mean. The axis label, and the difference between "0.5 is halfway
/// across the frame" and "0.5 is half brightness".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Unit {
    /// 0..1 of something's own extent — opacity, a crop inset, a corner radius.
    Fraction,
    /// 0..1 of the canvas. Distinct from [`Unit::Fraction`] because a UI that converts a
    /// dragged pixel back into a value has to know which extent to divide by, and because
    /// these are the only channels whose meaning changes when the canvas is resized.
    CanvasFraction,
    /// Degrees.
    Degrees,
    /// Pixels at the canvas's own resolution.
    Pixels,
    /// A multiplier where 1.0 is unchanged — scale, gain.
    Multiplier,
    /// A bare number whose meaning belongs to whatever consumes it. Shader parameters: `blur`
    /// is a sigma in pixels and `contrast` is a multiplier, and the effect knows which, so
    /// this module declines to guess.
    Scalar,
}

impl Unit {
    /// Whether a value on this channel is a fraction of the canvas rather than of the element.
    pub fn is_canvas_fraction(self) -> bool {
        matches!(self, Unit::CanvasFraction)
    }

    /// The suffix to draw after a value. Empty where a bare number reads better.
    pub fn suffix(self) -> &'static str {
        match self {
            Unit::Degrees => "°",
            Unit::Pixels => "px",
            Unit::Multiplier => "×",
            Unit::Fraction | Unit::CanvasFraction | Unit::Scalar => "",
        }
    }
}

/// One property that can carry an animation channel on one specific element.
#[derive(Debug, Clone, PartialEq)]
pub struct AnimatableProperty {
    /// The channel key, exactly as it appears in `Element::animations()`.
    pub path: String,
    /// For a person. Not derived from the path — "scaleX" is not a label.
    pub label: String,
    pub unit: Unit,
    /// The value axis to draw, when the property has one. Advisory, not a validator: keys may
    /// legitimately sit outside it (a rotation of 720°, a scale of 6), and a curve editor
    /// should grow the axis rather than clamp the key.
    ///
    /// `None` where there is no natural range to draw — a shader parameter or a font size.
    /// The honest axis there is one fitted to the keys that exist.
    pub range: Option<(f32, f32)>,
    /// What the property is worth on **this element** with no channel on it.
    ///
    /// Not a global constant: every sampler in the model starts from the element's own stored
    /// value and lets a channel override it, so this is the value a channel is departing from
    /// and the value removing every key returns to.
    pub default: f32,
}

/// The half of a descriptor that is true of a path whoever carries it: what to call it, what
/// its numbers mean, and what axis to draw. Separate from [`AnimatableProperty`] because a
/// caller holding only a path — a curve editor handed a channel to render — can have this
/// without an element to read a default from.
#[derive(Debug, Clone, PartialEq)]
pub struct PropertyKind {
    /// For a person. Not derived from the path — "scaleX" is not a label.
    pub label: String,
    pub unit: Unit,
    /// The value axis to draw, when the property has one. See [`AnimatableProperty::range`].
    pub range: Option<(f32, f32)>,
}

/// The label, unit and range for a channel path.
///
/// When the element is available, [`Element::animatable_paths`] is better: it also fills in
/// the default, and it will not describe a path that element cannot carry.
///
/// `effect.<id>.<param>` resolves to the parameter's own name with no range, since only the
/// shader knows what its number means.
pub fn describe_path(path: &str) -> Option<PropertyKind> {
    let kind = |label: &str, unit, range| PropertyKind {
        label: label.to_string(),
        unit,
        range,
    };
    let bounded = |low: f32, high: f32| Some((low, high));
    Some(match path {
        "opacity" => kind("Opacity", Unit::Fraction, bounded(0.0, 1.0)),
        "scale" => kind("Scale", Unit::Multiplier, bounded(0.0, 4.0)),
        "x" => kind("X", Unit::CanvasFraction, bounded(0.0, 1.0)),
        "y" => kind("Y", Unit::CanvasFraction, bounded(0.0, 1.0)),
        "rotation" => kind("Rotation", Unit::Degrees, bounded(-360.0, 360.0)),
        "scaleX" => kind("Scale X", Unit::Multiplier, bounded(0.0, 4.0)),
        "scaleY" => kind("Scale Y", Unit::Multiplier, bounded(0.0, 4.0)),
        "cropLeft" => kind("Crop left", Unit::Fraction, bounded(0.0, 1.0)),
        "cropTop" => kind("Crop top", Unit::Fraction, bounded(0.0, 1.0)),
        "cropRight" => kind("Crop right", Unit::Fraction, bounded(0.0, 1.0)),
        "cropBottom" => kind("Crop bottom", Unit::Fraction, bounded(0.0, 1.0)),
        // ±90 is the geometric limit, not the renderer's: `bay-preview` clamps tighter,
        // because a card edge-on is a zero-width sliver rather than a picture. An axis is a
        // drawing hint and does not need to agree with a clamp to the degree.
        "tiltX" => kind("Tilt X", Unit::Degrees, bounded(-90.0, 90.0)),
        "tiltY" => kind("Tilt Y", Unit::Degrees, bounded(-90.0, 90.0)),
        // Gain, not decibels. 2.0 rather than 1.0 at the top because a bed lifted above unity
        // is ordinary and an axis that ends at unity cannot draw it.
        "volume" => kind("Volume", Unit::Multiplier, bounded(0.0, 2.0)),
        "mask.x" => kind("Mask X", Unit::CanvasFraction, bounded(0.0, 1.0)),
        "mask.y" => kind("Mask Y", Unit::CanvasFraction, bounded(0.0, 1.0)),
        "mask.width" => kind("Mask width", Unit::CanvasFraction, bounded(0.0, 1.0)),
        "mask.height" => kind("Mask height", Unit::CanvasFraction, bounded(0.0, 1.0)),
        "mask.feather" => kind("Mask feather", Unit::Fraction, bounded(0.0, 1.0)),
        // A fraction of the shorter side, which is what makes one number mean the same thing
        // at any size.
        "shape.radius" => kind("Corner radius", Unit::Fraction, bounded(0.0, 1.0)),
        // A fraction of the shape's SHORTER side, like the radius above — not pixels. Half
        // fills the shape from both edges, so the axis ends there; a thicker stroke is legal
        // and simply grows the axis.
        "stroke.width" => kind("Stroke width", Unit::Fraction, bounded(0.0, 0.5)),
        // No range: type runs from a caption to a full-bleed number, and any axis wide enough
        // for both is useless for either.
        "fontSize" => kind("Font size", Unit::Pixels, None),
        _ => {
            let param = path
                .strip_prefix("effect.")
                .and_then(|rest| rest.split_once('.'))
                .map(|(_, param)| param)?;
            kind(param, Unit::Scalar, None)
        }
    })
}

impl Element {
    /// Every property path this element can carry a channel on, in the order an inspector
    /// should list them, each with what a curve editor needs to draw it.
    ///
    /// Derived from the element, not from a list: a clip with no mask does not offer
    /// `mask.x`, a shape with no stroke does not offer `stroke.width`, and only the effects
    /// actually attached contribute `effect.<id>.<param>`. Offering a path and then storing a
    /// channel nothing reads is the failure this exists to prevent — it looks exactly like a
    /// successful edit and produces a frame that never changes.
    pub fn animatable_paths(&self) -> Vec<AnimatableProperty> {
        let mut out = Vec::new();
        let mut push = |path: String, default: f32| {
            if let Some(kind) = describe_path(&path) {
                out.push(AnimatableProperty {
                    path,
                    label: kind.label,
                    unit: kind.unit,
                    range: kind.range,
                    default,
                });
            }
        };

        // Transform first, in the order the inspector lists it — and only for elements that
        // have one. Audio has a level and no position; offering `x` on a music bed and
        // quietly doing nothing with the keys is worse than not offering it.
        if let Some(transform) = self.transform() {
            for path in Self::ANIMATABLE {
                let default = match path {
                    "opacity" => transform.opacity,
                    "scale" => transform.scale,
                    "x" => transform.x,
                    "y" => transform.y,
                    "rotation" => transform.rotation,
                    "scaleX" => transform.scale_x,
                    "scaleY" => transform.scale_y,
                    "cropLeft" => transform.crop_left,
                    "cropTop" => transform.crop_top,
                    "cropRight" => transform.crop_right,
                    "cropBottom" => transform.crop_bottom,
                    "tiltX" => transform.tilt_x,
                    "tiltY" => transform.tilt_y,
                    // Unreachable while this loop reads `ANIMATABLE`; a `match` rather than a
                    // lookup so adding a fourteenth transform channel fails to compile here
                    // instead of silently defaulting to zero.
                    other => unreachable!("{other} is in ANIMATABLE with no transform field"),
                };
                push(path.to_string(), default);
            }
        }

        if let Element::Audio(audio) = self {
            push("volume".to_string(), audio.volume);
        }

        if let Element::Text(text) = self {
            push("fontSize".to_string(), text.font_size);
        }

        if let Element::Shape(shape) = self {
            // Only a rectangle has corners to round. On an ellipse the channel would be
            // stored, sampled, and dropped by `sampled_shape_kind`'s `if let Rect`.
            if let ShapeKind::Rect { radius } = shape.shape {
                push("shape.radius".to_string(), radius);
            }
            // A width channel cannot bring a stroke into existence: width is half of a stroke
            // and the colour is not a scalar.
            if let Some(stroke) = &shape.stroke {
                push("stroke.width".to_string(), stroke.width);
            }
        }

        if let Some(mask) = self.mask() {
            push("mask.x".to_string(), mask.x);
            push("mask.y".to_string(), mask.y);
            push("mask.width".to_string(), mask.width);
            push("mask.height".to_string(), mask.height);
            push("mask.feather".to_string(), mask.feather);
        }

        for effect in self.effects() {
            for (param, value) in &effect.params {
                push(format!("effect.{}.{param}", effect.id), *value);
            }
        }

        out
    }

    /// Whether `path` is a channel this element actually reads.
    ///
    /// The one validator. `animate`, `AddKeyframe` and `RemoveKeyframe` each grew their own
    /// and disagreed about `mask.*` and `effect.<id>.<param>`, so the same edit succeeded over
    /// MCP and vanished from the editor.
    pub fn can_animate(&self, path: &str) -> bool {
        self.animatable_paths()
            .iter()
            .any(|property| property.path == path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Elements built from their own wire format rather than from struct literals.
    ///
    /// These types have a lot of fields and no `Default`, and a twenty-line literal per test
    /// buries the two values the test is actually about. Deserializing also means every
    /// fixture here is a project file that would really load.
    fn element(json: serde_json::Value) -> Element {
        serde_json::from_value(json).expect("a well-formed element")
    }

    fn text() -> Element {
        element(serde_json::json!({
            "type": "text",
            "id": "t1", "name": "Title",
            "start": 0, "duration": 120_000,
            "content": "Hello", "fontSize": 48.0, "color": "#ffffff",
        }))
    }

    fn paths(element: &Element) -> Vec<String> {
        element
            .animatable_paths()
            .into_iter()
            .map(|property| property.path)
            .collect()
    }

    fn property(element: &Element, path: &str) -> AnimatableProperty {
        element
            .animatable_paths()
            .into_iter()
            .find(|property| property.path == path)
            .unwrap_or_else(|| panic!("{path} is not offered"))
    }

    /// The regression this module exists for: the sampler reads these three, and until now no
    /// validator anywhere let them through, so the capability was unreachable from every
    /// surface at once.
    #[test]
    fn the_paths_the_sampler_reads_are_all_offered() {
        assert!(
            text().can_animate("fontSize"),
            "sampled_font_size reads fontSize"
        );

        let rect = element(serde_json::json!({
            "type": "shape",
            "id": "s1", "name": "Card",
            "start": 0, "duration": 120_000,
            "shape": { "kind": "rect", "radius": 0.25 },
            "color": "#ffffff",
            "stroke": { "color": "#000000", "width": 0.02 },
        }));
        assert!(
            rect.can_animate("shape.radius"),
            "sampled_shape_kind reads shape.radius"
        );
        assert!(
            rect.can_animate("stroke.width"),
            "sampled_stroke reads stroke.width"
        );
    }

    /// And the converse: a path is offered only when this element has the thing behind it. A
    /// channel with nothing behind it is stored, serialized, and never read.
    #[test]
    fn a_path_is_offered_only_when_the_element_has_it_behind() {
        let bare = element(serde_json::json!({
            "type": "shape",
            "id": "s1", "name": "Dot",
            "start": 0, "duration": 120_000,
            "shape": { "kind": "ellipse" },
            "color": "#ffffff",
        }));
        assert!(!bare.can_animate("stroke.width"), "no stroke to widen");
        assert!(
            !bare.can_animate("shape.radius"),
            "an ellipse has no corners — sampled_shape_kind drops the channel"
        );
        assert!(!bare.can_animate("mask.x"), "no mask to move");
        assert!(!bare.can_animate("fontSize"), "a shape has no type to size");
        assert!(bare.can_animate("opacity"), "but it does have a transform");
    }

    #[test]
    fn a_mask_brings_its_five_channels_and_their_current_values() {
        let masked = element(serde_json::json!({
            "type": "text",
            "id": "t1", "name": "Title",
            "start": 0, "duration": 120_000,
            "content": "Hello", "fontSize": 48.0, "color": "#ffffff",
            "mask": { "shape": "ellipse", "x": 0.25, "y": 0.75,
                      "width": 0.4, "height": 0.2, "feather": 0.1, "inverted": false },
        }));

        let listed = paths(&masked);
        for path in [
            "mask.x",
            "mask.y",
            "mask.width",
            "mask.height",
            "mask.feather",
        ] {
            assert!(listed.contains(&path.to_string()), "{path} missing");
        }
        let mask_x = property(&masked, "mask.x");
        assert_eq!(mask_x.default, 0.25, "the default is this mask's own x");
        assert!(mask_x.unit.is_canvas_fraction());
    }

    /// Effect parameters depend on what is attached, and carry no range — only the shader
    /// knows whether its number is a sigma, a multiplier or a fraction.
    #[test]
    fn effect_params_are_named_by_the_effects_actually_attached() {
        let blurred = element(serde_json::json!({
            "type": "text",
            "id": "t1", "name": "Title",
            "start": 0, "duration": 120_000,
            "content": "Hello", "fontSize": 48.0, "color": "#ffffff",
            "effects": [{ "id": "fx-1", "effectType": "blur", "enabled": true,
                          "params": { "amount": 6.0 } }],
        }));

        let blur = property(&blurred, "effect.fx-1.amount");
        assert_eq!(blur.label, "amount");
        assert_eq!(blur.default, 6.0, "departing from the value it has now");
        assert_eq!(
            blur.range, None,
            "a sigma has no upper bound; an invented axis would be a confident guess"
        );
        assert_eq!(blur.unit, Unit::Scalar);

        assert!(
            !blurred.can_animate("effect.fx-2.amount"),
            "an effect that is not attached has no parameters to animate"
        );
    }

    /// Audio has a level and no position. A flat list would have offered `x` on a music bed.
    #[test]
    fn audio_offers_its_level_and_no_geometry() {
        let bed = element(serde_json::json!({
            "type": "audio",
            "id": "a1", "name": "Bed",
            "start": 0, "duration": 120_000,
            "mediaId": "m1", "volume": 0.8, "muted": false,
        }));
        assert_eq!(paths(&bed), vec!["volume".to_string()]);
        let volume = property(&bed, "volume");
        assert_eq!(volume.default, 0.8);
        assert_eq!(volume.unit, Unit::Multiplier);
    }

    /// Every transform channel reports the element's own value, not a global neutral — that
    /// is what "the value removing every key returns to" means, and it is what the samplers
    /// in `element.rs` actually do.
    #[test]
    fn defaults_come_from_the_element_not_from_a_constant() {
        let moved = element(serde_json::json!({
            "type": "text",
            "id": "t1", "name": "Title",
            "start": 0, "duration": 120_000,
            "content": "Hello", "fontSize": 48.0, "color": "#ffffff",
            "transform": { "x": 0.2, "y": 0.5, "scale": 1.0, "rotation": 15.0, "opacity": 0.6 },
        }));

        assert_eq!(property(&moved, "x").default, 0.2);
        assert_eq!(property(&moved, "opacity").default, 0.6);
        assert_eq!(property(&moved, "rotation").default, 15.0);
    }

    /// The thirteen stay reachable — replacing the flat list must not have narrowed it.
    #[test]
    fn every_flat_animatable_is_still_offered_on_a_visual_element() {
        let element = text();
        for path in Element::ANIMATABLE {
            assert!(element.can_animate(path), "{path} was dropped");
        }
    }

    /// Only `x`, `y` and the mask rectangle are measured against the canvas. A UI turning a
    /// dragged pixel back into a value divides by the wrong extent otherwise.
    #[test]
    fn exactly_the_canvas_relative_paths_say_so() {
        let masked = element(serde_json::json!({
            "type": "text",
            "id": "t1", "name": "Title",
            "start": 0, "duration": 120_000,
            "content": "Hello", "fontSize": 48.0, "color": "#ffffff",
            "mask": { "shape": "rect", "x": 0.5, "y": 0.5,
                      "width": 1.0, "height": 1.0, "feather": 0.0, "inverted": false },
        }));

        let canvas: Vec<String> = masked
            .animatable_paths()
            .into_iter()
            .filter(|property| property.unit.is_canvas_fraction())
            .map(|property| property.path)
            .collect();
        assert_eq!(
            canvas,
            ["x", "y", "mask.x", "mask.y", "mask.width", "mask.height"]
        );
    }

    /// Every path the table knows has a label that is not just the path back again, and a
    /// range that is the right way round.
    #[test]
    fn every_described_path_is_drawable() {
        let element = text();
        for property in element.animatable_paths() {
            assert!(!property.label.is_empty(), "{} has no label", property.path);
            if let Some((low, high)) = property.range {
                assert!(low < high, "{} has an inverted axis", property.path);
                assert!(
                    low.is_finite() && high.is_finite(),
                    "{} has an unbounded axis, which is what None is for",
                    property.path
                );
            }
        }
    }

    #[test]
    fn an_unknown_path_is_described_by_nobody() {
        assert!(describe_path("wobble").is_none());
        assert!(describe_path("effect.fx-1").is_none(), "no parameter named");
        assert!(describe_path("mask.rotation").is_none());
    }
}
