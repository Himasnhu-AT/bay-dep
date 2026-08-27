use std::collections::{BTreeMap, BTreeSet};

use bay_core::{Command, ElementRef, Finding, Project, Report, Severity, check::Status};
use bay_project::{
    AudioRole, DuckParams, Element, ElementRole, MediaTime, TextAlign, TextElement, Transform, mix,
};
use bay_text::{TextRaster, TextStyle};

use crate::{FindingTarget, OvershootGuard, Repair, RepairEvaluation, RepairPlanner};

const MODEL_SCALE_DESTINATION: f64 = 0.70;
const MODEL_SCALE_PREFILTER: f64 = 0.36;
const RENDERED_SUBJECT_OWNERSHIP_MINIMUM: f64 = 0.31;
const ANCHOR_MARK_AREA_CEILING: f64 = 0.049;
const ANCHOR_SLENDER_MARK_AREA_CEILING: f64 = 0.049;
const ANCHOR_CLUSTER_X_RADIUS: f32 = 0.08;
const LOWER_FRAME_DESTINATION: f32 = 0.86;
const LOWER_FRAME_COMPOSITION_GOAL: f64 = 0.60;
const LOWER_STACK_ALREADY_PRESENT: f32 = 0.78;
const BEAT_LOCAL_SPAN_CEILING: f64 = 0.75;
const TYPE_SAFE_LEFT: f32 = 0.06;
const TYPE_SAFE_RIGHT: f32 = 0.94;
const TYPE_SAFE_TOP: f32 = 0.06;
const TYPE_SAFE_BOTTOM: f32 = 0.94;
const TYPE_STACK_GAP: f32 = 0.035;
const CHROME_FOOTER_BASELINE: f32 = 0.97;
const AUDIBLE_GAP_LEVEL: f64 = -23.0;
const AUDIBLE_LEVEL_SLACK: f64 = 0.4;

/// Pixel-backed findings converted into the same receipt shape as the model-only report.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameIssue {
    pub code: &'static str,
    pub element_id: Option<String>,
    pub track_id: Option<String>,
    pub at_seconds: Option<f64>,
    pub message: String,
}

/// The evaluated subset of `check_frames` that deterministic repairs consume.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FrameAssessment {
    pub issues: Vec<FrameIssue>,
    pub frozen_windows: Option<usize>,
    pub peak_anchor_sqrt_area: Option<f64>,
    pub bottom_alive_share: Option<f64>,
}

impl FrameAssessment {
    pub fn from_json(value: &serde_json::Value) -> Result<Self, String> {
        if value.get("status").and_then(serde_json::Value::as_str) == Some("unevaluated") {
            return Err(
                "frame checks were unevaluated; deterministic frame repair is unsafe".into(),
            );
        }
        let issues = value
            .get("findings")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let code = frame_code(item.get("code")?.as_str()?)?;
                Some(FrameIssue {
                    code,
                    element_id: item
                        .get("elementId")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                    track_id: item
                        .get("trackId")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                    at_seconds: item.get("atSeconds").and_then(serde_json::Value::as_f64),
                    message: item
                        .get("message")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("frame check finding")
                        .to_owned(),
                })
            })
            .collect();
        let stats = value.get("stats").unwrap_or(&serde_json::Value::Null);
        Ok(Self {
            issues,
            frozen_windows: value
                .get("rollup")
                .and_then(|rollup| rollup.get("frozen"))
                .and_then(serde_json::Value::as_u64)
                .and_then(|count| usize::try_from(count).ok()),
            peak_anchor_sqrt_area: stats
                .get("peakAnchorSqrtArea")
                .and_then(serde_json::Value::as_f64),
            bottom_alive_share: stats
                .get("bottomAliveShare")
                .and_then(serde_json::Value::as_f64),
        })
    }
}

/// Merge an evaluated frame report into a core report without changing either check.
pub fn combine_reports(mut report: Report, frames: &FrameAssessment) -> Report {
    for issue in &frames.issues {
        let severity = bay_core::check::severity_of(issue.code);
        report.findings.push(Finding {
            severity,
            code: issue.code,
            message: issue.message.clone(),
            element_id: issue.element_id.clone(),
            track_id: issue.track_id.clone(),
            at_seconds: issue.at_seconds,
        });
        *report.rollup.entry(issue.code).or_default() += 1;
        report.total += 1;
        match severity {
            Severity::Error => report.errors += 1,
            Severity::Warning => report.warnings += 1,
            Severity::Note => report.notes += 1,
        }
    }
    if report.total > 0 {
        report.status = Status::Findings;
    }
    report.findings.sort_by_key(|finding| finding.severity);
    report
}

fn frame_code(code: &str) -> Option<&'static str> {
    match code {
        "text-collision" => Some("text-collision"),
        "anchor-scale" => Some("anchor-scale"),
        "bottom-dead" => Some("bottom-dead"),
        "frozen" => Some("frozen"),
        _ => None,
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DeterministicRepairs;

impl RepairPlanner for DeterministicRepairs {
    fn plan(&self, project: &Project, report: &Report) -> Vec<Repair> {
        ["text-collision", "anchor-scale", "bottom-dead"]
            .into_iter()
            .filter(|code| report.rollup.get(code).copied().unwrap_or_default() > 0)
            .filter_map(|code| repair_for(project, report, code, code != "text-collision"))
            .chain(
                ["off-grid", "bed-too-quiet"]
                    .into_iter()
                    .filter(|code| report.rollup.get(code).copied().unwrap_or_default() > 0)
                    .filter_map(|code| repair_for(project, report, code, false)),
            )
            .collect()
    }
}

/// The production margin validator. It knows editorial destinations, never diagnosis values.
#[derive(Debug, Default, Clone, Copy)]
pub struct DeterministicOvershoot;

impl OvershootGuard for DeterministicOvershoot {
    fn validate(
        &self,
        repair: &Repair,
        before: &Project,
        candidate: &Project,
        evaluation: &RepairEvaluation,
    ) -> Result<(), String> {
        match repair.target.code.as_str() {
            "anchor-scale" => {
                let model_score = strongest_anchor_score(candidate);
                if model_score < MODEL_SCALE_PREFILTER {
                    return Err(format!(
                        "the repaired subject is still too small in the cheap model-space prefilter ({model_score:.3})"
                    ));
                }
                let rendered_score = evaluation.magnitude("anchor-scale").ok_or_else(|| {
                    "rendered anchor sqrt-area is unavailable; overshoot requires an evaluated GPU frame assessment"
                        .to_string()
                })?;
                if rendered_score < RENDERED_SUBJECT_OWNERSHIP_MINIMUM {
                    return Err(format!(
                        "the rendered subject reaches only {rendered_score:.3} sqrt-area; it does not own the frame with a real margin"
                    ));
                }
            }
            "text-collision" => {
                let collisions = measured_text_collisions(candidate);
                if !collisions.is_empty() {
                    return Err(format!(
                        "shaped text ink still overlaps after reflow: {collisions:?}"
                    ));
                }
            }
            "bottom-dead" => {
                let rendered_share = evaluation.magnitude("bottom-dead").ok_or_else(|| {
                    "rendered bottom-alive share is unavailable; overshoot requires an evaluated GPU frame assessment"
                        .to_string()
                })?;
                if rendered_share < LOWER_FRAME_COMPOSITION_GOAL {
                    return Err(format!(
                        "only {:.0}% of rendered samples carry substantial lower-frame composition",
                        rendered_share * 100.0
                    ));
                }
                validate_beat_local_lower_redistribution(before, candidate)?;
            }
            "off-grid" => {
                if !timeline_is_frame_aligned(candidate) {
                    return Err("timeline values still fall between delivered frames".into());
                }
            }
            "bed-too-quiet" => {
                let level = mix::envelope(candidate)
                    .gap_bed_lufs
                    .ok_or_else(|| "the repaired gap bed could not be measured".to_string())?;
                if level < AUDIBLE_GAP_LEVEL - AUDIBLE_LEVEL_SLACK {
                    return Err(format!(
                        "the repaired gap bed is still only {level:.1} LUFS"
                    ));
                }
            }
            _ => {}
        }
        Ok(())
    }
}

fn repair_for(
    project: &Project,
    report: &Report,
    code: &str,
    include_cheap_repairs: bool,
) -> Option<Repair> {
    let target = report
        .findings
        .iter()
        .find(|finding| finding.code == code)
        .map(FindingTarget::from)?;
    let mut candidate = project.clone();
    let changed = match code {
        "anchor-scale" => enlarge_anchor(&mut candidate),
        "text-collision" => reflow_colliding_text(&mut candidate, report),
        "bottom-dead" => redistribute_lower_frame(&mut candidate),
        "off-grid" => align_timeline(&mut candidate),
        "bed-too-quiet" => raise_gap_bed(&mut candidate),
        _ => false,
    };
    if !changed {
        return None;
    }
    if include_cheap_repairs {
        if report.rollup.get("off-grid").copied().unwrap_or_default() > 0 {
            align_timeline(&mut candidate);
        }
        if report
            .rollup
            .get("bed-too-quiet")
            .copied()
            .unwrap_or_default()
            > 0
        {
            raise_gap_bed(&mut candidate);
        }
    }
    let commands = replacement_commands(project, &candidate);
    let (rationale, intent) = match code {
        "anchor-scale" => (
            "the beat has no visual subject with enough measured ink to lead the frame",
            "let the anchor own the frame",
        ),
        "text-collision" => (
            "shaped glyph ink overlaps while both blocks are legible",
            "reflow the copy and preserve a measured gap through the stack",
        ),
        "bottom-dead" => (
            "existing beat content is clustered above the lower reading zone",
            "redistribute the existing stack down the canvas",
        ),
        "off-grid" => (
            "authored timing falls between delivered frames",
            "land cuts and moves on the frame grid",
        ),
        "bed-too-quiet" => (
            "the measured music bed disappears between spoken lines",
            "keep the bed audibly present in speech-free gaps",
        ),
        _ => return None,
    };
    Repair::new(target, rationale, intent, commands).ok()
}

fn replacement_commands(before: &Project, after: &Project) -> Vec<Command> {
    let before_scene = before.active_scene();
    let after_scene = after.active_scene();
    let mut commands = Vec::new();
    for after_track in after_scene.tracks.iter() {
        let Some(before_track) = before_scene.tracks.track(&after_track.id) else {
            continue;
        };
        for after_element in &after_track.elements {
            let Some(before_element) = before_track.element(after_element.id()) else {
                continue;
            };
            if before_element != after_element {
                commands.push(Command::ReplaceElement {
                    reference: ElementRef::new(&after_track.id, after_element.id()),
                    element: after_element.clone(),
                });
            }
        }
    }
    commands
}

fn enlarge_anchor(project: &mut Project) -> bool {
    let canvas = project.settings.canvas;
    let candidate = {
        let scene = project.active_scene();
        let candidates: Vec<_> = scene
            .tracks
            .iter()
            .flat_map(|track| {
                track
                    .elements
                    .iter()
                    .map(move |element| (track.id.as_str(), element))
            })
            .filter(|(_, element)| anchor_eligible(element))
            .map(|(track_id, element)| {
                (
                    anchor_rank(element),
                    visual_score(element, canvas.width, canvas.height),
                    anchor_fitness(element, canvas.width, canvas.height),
                    track_id.to_owned(),
                    element.id().to_owned(),
                )
            })
            .collect();
        candidates
            .iter()
            .filter(|(_, _, _, track_id, element_id)| {
                scene
                    .tracks
                    .track(track_id)
                    .and_then(|track| track.element(element_id))
                    .is_some_and(|element| !matches!(element, Element::Text(_)))
            })
            .max_by(|left, right| left.2.total_cmp(&right.2))
            .filter(|candidate| candidate.2 >= 0.03)
            .or_else(|| {
                candidates.iter().max_by(|left, right| {
                    left.0
                        .cmp(&right.0)
                        .then_with(|| left.1.total_cmp(&right.1))
                })
            })
            .cloned()
    };
    let Some((_, score, _, track_id, element_id)) = candidate else {
        return false;
    };
    let shape_group: Vec<(String, String, f64)> = {
        let scene = project.active_scene();
        let Some(selected) = scene
            .tracks
            .track(&track_id)
            .and_then(|track| track.element(&element_id))
        else {
            return false;
        };
        if !matches!(selected, Element::Shape(_)) {
            Vec::new()
        } else {
            let selected_x = selected.transform().unwrap_or_default().x;
            scene
                .tracks
                .iter()
                .flat_map(|track| {
                    track
                        .elements
                        .iter()
                        .map(move |element| (track.id.as_str(), element))
                })
                .filter(|(_, element)| {
                    matches!(element, Element::Shape(_))
                        && element.role() == selected.role()
                        && element.start() == selected.start()
                        && element.duration() == selected.duration()
                        && element.transform().is_some_and(|transform| {
                            (transform.x - selected_x).abs() <= ANCHOR_CLUSTER_X_RADIUS
                        })
                })
                .map(|(track_id, element)| {
                    (
                        track_id.to_owned(),
                        element.id().to_owned(),
                        peak_visual_score(element, canvas.width, canvas.height).powi(2),
                    )
                })
                .collect()
        }
    };
    if shape_group.len() >= 2 {
        let group_area = shape_group.iter().map(|(_, _, area)| area).sum::<f64>();
        let group_factor = (MODEL_SCALE_DESTINATION.powi(2) / group_area.max(0.0001))
            .sqrt()
            .clamp(1.05, 8.0);
        for (group_track, group_element, area) in shape_group {
            let Some(element) = project
                .active_scene_mut()
                .tracks
                .track_mut(&group_track)
                .and_then(|track| track.element_mut(&group_element))
            else {
                continue;
            };
            let Some(mut transform) = element.transform() else {
                continue;
            };
            let aspect = transform.scale_x.abs().min(transform.scale_y.abs())
                / transform
                    .scale_x
                    .abs()
                    .max(transform.scale_y.abs())
                    .max(f32::EPSILON);
            let area_ceiling = if aspect <= 0.2 {
                ANCHOR_SLENDER_MARK_AREA_CEILING
            } else {
                ANCHOR_MARK_AREA_CEILING
            };
            let factor = group_factor
                .min((area_ceiling / area.max(0.0001)).sqrt())
                .max(1.05) as f32;
            transform.scale *= factor;
            contain_transform(&mut transform);
            element.set_transform(transform);
            if let Some(animations) = element.animations_mut()
                && let Some(channel) = animations.get_mut("scale")
            {
                for key in &mut channel.keys {
                    key.value *= factor;
                }
            }
        }
        return true;
    }
    let Some(element) = project
        .active_scene_mut()
        .tracks
        .track_mut(&track_id)
        .and_then(|track| track.element_mut(&element_id))
    else {
        return false;
    };
    let factor = (MODEL_SCALE_DESTINATION / score.max(0.02)).clamp(1.05, 6.0) as f32;
    match element {
        Element::Text(text) => {
            text.font_size = (text.font_size * factor).min(canvas.height as f32 * 0.42);
            place_text_inside_safe_area(text, canvas.width, canvas.height);
        }
        _ => {
            let Some(mut transform) = element.transform() else {
                return false;
            };
            transform.scale *= factor;
            contain_transform(&mut transform);
            element.set_transform(transform);
            if let Some(channel) = element
                .animations_mut()
                .and_then(|animations| animations.get_mut("scale"))
            {
                for key in &mut channel.keys {
                    key.value *= factor;
                }
            }
        }
    }
    true
}

fn anchor_eligible(element: &Element) -> bool {
    element.is_authored()
        && !matches!(element, Element::Audio(_))
        && !matches!(
            element.role(),
            Some(ElementRole::Ground | ElementRole::Chrome | ElementRole::Caption)
        )
        && element.duration() > MediaTime::ZERO
}

fn anchor_rank(element: &Element) -> u8 {
    match element.role() {
        Some(ElementRole::Hook) => 5,
        Some(ElementRole::Headline | ElementRole::Lockup) => 4,
        Some(ElementRole::Data) => 3,
        Some(ElementRole::Kicker | ElementRole::Label) => 2,
        _ => 1,
    }
}

fn strongest_anchor_score(project: &Project) -> f64 {
    let canvas = project.settings.canvas;
    let individual = project
        .active_scene()
        .elements()
        .filter(|element| anchor_eligible(element))
        .map(|element| visual_score(element, canvas.width, canvas.height))
        .fold(0.0, f64::max);
    let shapes: Vec<&Element> = project
        .active_scene()
        .elements()
        .filter(|element| matches!(element, Element::Shape(_)) && anchor_eligible(element))
        .collect();
    let grouped = shapes
        .iter()
        .map(|seed| {
            shapes
                .iter()
                .filter(|element| {
                    element.role() == seed.role()
                        && element.start() == seed.start()
                        && element.duration() == seed.duration()
                })
                .map(|element| visual_score(element, canvas.width, canvas.height).powi(2))
                .sum::<f64>()
                .sqrt()
        })
        .fold(0.0, f64::max);
    individual.max(grouped)
}

fn visual_score(element: &Element, width: u32, height: u32) -> f64 {
    if let Element::Text(text) = element {
        return text_ink_rect(text, text.transform, width, height)
            .map(|rect| rect.area().sqrt())
            .unwrap_or_default();
    }
    element
        .transform()
        .map(|transform| {
            f64::from(
                transform.scale.abs() * (transform.scale_x.abs() * transform.scale_y.abs()).sqrt(),
            )
        })
        .unwrap_or_default()
}

fn peak_visual_score(element: &Element, width: u32, height: u32) -> f64 {
    let base = visual_score(element, width, height);
    let Some(transform) = element.transform() else {
        return base;
    };
    let animated_scale = element
        .animations()
        .and_then(|animations| animations.get("scale"))
        .into_iter()
        .flat_map(|channel| channel.keys.iter())
        .map(|key| key.value.abs())
        .fold(transform.scale.abs(), f32::max);
    let animated_scale_x = element
        .animations()
        .and_then(|animations| animations.get("scaleX"))
        .into_iter()
        .flat_map(|channel| channel.keys.iter())
        .map(|key| key.value.abs())
        .fold(transform.scale_x.abs(), f32::max);
    let animated_scale_y = element
        .animations()
        .and_then(|animations| animations.get("scaleY"))
        .into_iter()
        .flat_map(|channel| channel.keys.iter())
        .map(|key| key.value.abs())
        .fold(transform.scale_y.abs(), f32::max);
    base.max(f64::from(
        animated_scale * (animated_scale_x * animated_scale_y).sqrt(),
    ))
}

fn anchor_fitness(element: &Element, width: u32, height: u32) -> f64 {
    let score = visual_score(element, width, height);
    let Some(transform) = element.transform() else {
        return 0.0;
    };
    let across = transform.scale_x.abs().max(0.001);
    let down = transform.scale_y.abs().max(0.001);
    score * f64::from(across.min(down) / across.max(down))
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn right(self) -> f64 {
        self.left + self.width
    }

    fn bottom(self) -> f64 {
        self.top + self.height
    }

    fn area(self) -> f64 {
        self.width.max(0.0) * self.height.max(0.0)
    }

    fn overlap(self, other: Self) -> f64 {
        let width = self.right().min(other.right()) - self.left.max(other.left);
        let height = self.bottom().min(other.bottom()) - self.top.max(other.top);
        width.max(0.0) * height.max(0.0)
    }
}

fn text_style(text: &TextElement) -> TextStyle<'_> {
    TextStyle {
        family: text.font_family.as_deref(),
        weight: text.font_weight,
        align: match text.align {
            TextAlign::Left => bay_text::TextAlign::Left,
            TextAlign::Center => bay_text::TextAlign::Center,
            TextAlign::Right => bay_text::TextAlign::Right,
        },
        letter_spacing: text.letter_spacing,
        line_height: text.line_height,
        stroke: text.decorations.as_ref().and_then(|decorations| {
            decorations
                .stroke
                .as_ref()
                .map(|stroke| bay_text::StrokeStyle {
                    width: stroke.width,
                    color: stroke.color.as_str(),
                })
        }),
        shadow: text.decorations.as_ref().and_then(|decorations| {
            decorations
                .shadow
                .as_ref()
                .map(|shadow| bay_text::ShadowStyle {
                    offset_x: shadow.offset_x,
                    offset_y: shadow.offset_y,
                    blur: shadow.blur,
                    color: shadow.color.as_str(),
                })
        }),
        plate: text.decorations.as_ref().and_then(|decorations| {
            decorations
                .plate
                .as_ref()
                .map(|plate| bay_text::PlateStyle {
                    color: plate.color.as_str(),
                    padding_x: plate.padding_x,
                    padding_y: plate.padding_y,
                    radius: plate.radius,
                })
        }),
        highlight: None,
    }
}

fn text_ink_rect(
    text: &TextElement,
    transform: Transform,
    canvas_width: u32,
    canvas_height: u32,
) -> Option<Rect> {
    let mut raster = TextRaster::new();
    let raster_width = (transform.scale.max(0.01) * canvas_width as f32)
        .min(canvas_width as f32)
        .max(1.0) as u32;
    let raster_height = (transform.scale.max(0.01) * canvas_height as f32)
        .min(canvas_height as f32)
        .max(1.0) as u32;
    let font_px = (text.font_size * canvas_height as f32 / 1080.0).max(8.0);
    let image = raster.render_styled(
        &text.content,
        font_px,
        &text.color,
        raster_width,
        raster_height,
        &text_style(text),
    );
    let ink = image.ink_bounds?;
    let image_width = f64::from(image.width);
    let image_height = f64::from(image.height);
    let box_width =
        f64::from(transform.scale * canvas_width as f32) + f64::from(image.margin_x) * 2.0;
    let box_height =
        f64::from(transform.scale * canvas_height as f32) + f64::from(image.margin_y) * 2.0;
    let fit = (box_width / image_width)
        .min(box_height / image_height)
        .max(0.0);
    let layer_width = image_width * fit * f64::from(transform.scale_x);
    let layer_height = image_height * fit * f64::from(transform.scale_y);
    let layer_left = f64::from(transform.x)
        - f64::from(transform.anchor_x) * layer_width / f64::from(canvas_width.max(1));
    let layer_top = f64::from(transform.y)
        - f64::from(transform.anchor_y) * layer_height / f64::from(canvas_height.max(1));
    Some(Rect {
        left: layer_left
            + f64::from(ink.left) / image_width * layer_width / f64::from(canvas_width.max(1)),
        top: layer_top
            + f64::from(ink.top) / image_height * layer_height / f64::from(canvas_height.max(1)),
        width: f64::from(ink.right - ink.left) / image_width * layer_width
            / f64::from(canvas_width.max(1)),
        height: f64::from(ink.bottom - ink.top) / image_height * layer_height
            / f64::from(canvas_height.max(1)),
    })
}

fn measured_text_collisions(project: &Project) -> Vec<(String, String, f64)> {
    let canvas = project.settings.canvas;
    let scene = project.active_scene();
    let texts: Vec<(&str, &TextElement)> = scene
        .tracks
        .iter()
        .flat_map(|track| {
            track
                .elements
                .iter()
                .filter_map(move |element| match element {
                    Element::Text(text)
                        if text.duration > MediaTime::ZERO
                            && !(text.source == bay_project::ElementSource::Tool
                                && text.role == ElementRole::Caption) =>
                    {
                        Some((track.id.as_str(), text))
                    }
                    _ => None,
                })
        })
        .collect();
    let mut collisions = Vec::new();
    for (index, (_, first)) in texts.iter().enumerate() {
        for (_, second) in texts.iter().skip(index + 1) {
            let start = first.start.max(second.start);
            let end = (first.start + first.duration).min(second.start + second.duration);
            if end <= start {
                continue;
            }
            let at = start + MediaTime::from_ticks((end - start).as_ticks() / 2);
            let Some(first_transform) =
                scene.sampled_transform(&Element::Text((*first).clone()), at - first.start, at)
            else {
                continue;
            };
            let Some(second_transform) =
                scene.sampled_transform(&Element::Text((*second).clone()), at - second.start, at)
            else {
                continue;
            };
            let Some(first_rect) =
                text_ink_rect(first, first_transform, canvas.width, canvas.height)
            else {
                continue;
            };
            let Some(second_rect) =
                text_ink_rect(second, second_transform, canvas.width, canvas.height)
            else {
                continue;
            };
            let covered = first_rect.overlap(second_rect)
                / first_rect.area().min(second_rect.area()).max(f64::EPSILON);
            if covered > 0.01 {
                collisions.push((first.id.clone(), second.id.clone(), covered));
            }
        }
    }
    collisions
}

fn reflow_colliding_text(project: &mut Project, report: &Report) -> bool {
    let targets: BTreeSet<String> = report
        .findings
        .iter()
        .filter(|finding| finding.code == "text-collision")
        .filter_map(|finding| finding.element_id.clone())
        .collect();
    if targets.is_empty() {
        return false;
    }
    let canvas = project.settings.canvas;
    let collisions = measured_text_collisions(project);
    let roles: BTreeMap<String, ElementRole> = project
        .active_scene()
        .elements()
        .filter_map(|element| {
            matches!(element, Element::Text(_))
                .then(|| element.role().map(|role| (element.id().to_owned(), role)))
                .flatten()
        })
        .collect();
    let mut affected = BTreeSet::new();
    for (first, second, _) in collisions {
        if targets.contains(&first) || targets.contains(&second) {
            let first_is_chrome = roles.get(&first) == Some(&ElementRole::Chrome);
            let second_is_chrome = roles.get(&second) == Some(&ElementRole::Chrome);
            if first_is_chrome {
                affected.insert(first);
            } else if second_is_chrome || targets.contains(&second) {
                affected.insert(second);
            } else {
                affected.insert(first);
            }
        }
    }
    if affected.is_empty() {
        return false;
    }
    let mut changed = false;
    for track in project.active_scene_mut().tracks.iter_mut() {
        for element in &mut track.elements {
            let Element::Text(text) = element else {
                continue;
            };
            if !affected.contains(&text.id) {
                continue;
            }
            let before = text_ink_rect(text, text.transform, canvas.width, canvas.height);
            if text.role != ElementRole::Chrome {
                reflow_to_safe_width(text, canvas.width, canvas.height);
            }
            let old_y = text.transform.y;
            if text.role == ElementRole::Chrome {
                text.transform.anchor_x = 0.0;
                text.transform.anchor_y = 0.0;
                text.transform.x = TYPE_SAFE_LEFT;
                text.transform.y = CHROME_FOOTER_BASELINE;
            } else {
                text.transform.anchor_y = 0.0;
                place_text_inside_safe_area(text, canvas.width, canvas.height);
            }
            let after = text_ink_rect(text, text.transform, canvas.width, canvas.height);
            let ink_delta = match (before, after) {
                (Some(before), Some(after)) => (after.height - before.height).max(0.0) as f32,
                _ => 0.0,
            };
            if text.role == ElementRole::Chrome {
                text.transform.y = old_y.max(CHROME_FOOTER_BASELINE + ink_delta).min(0.98);
            } else {
                text.transform.y = text
                    .transform
                    .y
                    .max(TYPE_SAFE_TOP + ink_delta + TYPE_STACK_GAP);
                place_text_inside_safe_area(text, canvas.width, canvas.height);
            }
            let y_delta = text.transform.y - old_y;
            if let Some(channel) = text.animations.get_mut("y") {
                for key in &mut channel.keys {
                    key.value = (key.value + y_delta).clamp(0.02, 0.99);
                }
            }
            changed = true;
        }
    }
    changed
}

fn reflow_to_safe_width(text: &mut TextElement, canvas_width: u32, canvas_height: u32) -> bool {
    let available = 0.98 * canvas_width as f32;
    let words: Vec<&str> = text.content.split_whitespace().collect();
    if words.len() < 2 {
        return false;
    }
    let mut raster = TextRaster::new();
    let font_px = (text.font_size * canvas_height as f32 / 1080.0).max(8.0);
    let width_of = |raster: &mut TextRaster, value: &str| {
        raster
            .render_styled(
                value,
                font_px,
                &text.color,
                canvas_width.saturating_mul(4),
                canvas_height,
                &text_style(text),
            )
            .ink_bounds
            .map(|ink| (ink.right - ink.left) as f32)
            .unwrap_or_default()
    };
    if width_of(&mut raster, &text.content) <= available {
        return false;
    }
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in words {
        let proposed = if line.is_empty() {
            word.to_owned()
        } else {
            format!("{line} {word}")
        };
        if !line.is_empty() && width_of(&mut raster, &proposed) > available {
            lines.push(line);
            line = word.to_owned();
        } else {
            line = proposed;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    if lines.len() > 3 {
        let words: Vec<&str> = text.content.split_whitespace().collect();
        let chunk_size = words.len().div_ceil(3);
        lines = words
            .chunks(chunk_size)
            .map(|chunk| chunk.join(" "))
            .collect();
    }
    let widest = lines
        .iter()
        .map(|line| width_of(&mut raster, line))
        .fold(0.0_f32, f32::max);
    if widest > available {
        text.transform.scale_x *= (available / widest).clamp(0.72, 1.0);
    }
    let reflowed = lines.join("\n");
    if reflowed == text.content {
        false
    } else {
        text.content = reflowed;
        true
    }
}

fn place_text_inside_safe_area(text: &mut TextElement, width: u32, height: u32) {
    text.transform.anchor_x = match text.align {
        TextAlign::Left => 0.0,
        TextAlign::Center => 0.5,
        TextAlign::Right => 1.0,
    };
    text.transform.anchor_y = 0.0;
    let rect = text_ink_rect(text, text.transform, width, height);
    if let Some(rect) = rect {
        if rect.left < f64::from(TYPE_SAFE_LEFT) {
            text.transform.x += (f64::from(TYPE_SAFE_LEFT) - rect.left) as f32;
        }
        if rect.right() > f64::from(TYPE_SAFE_RIGHT) {
            text.transform.x -= (rect.right() - f64::from(TYPE_SAFE_RIGHT)) as f32;
        }
        if rect.top < f64::from(TYPE_SAFE_TOP) {
            text.transform.y += (f64::from(TYPE_SAFE_TOP) - rect.top) as f32;
        }
        if rect.bottom() > f64::from(TYPE_SAFE_BOTTOM) {
            text.transform.y -= (rect.bottom() - f64::from(TYPE_SAFE_BOTTOM)) as f32;
        }
    }
}

type LowerMember = (String, String, MediaTime, MediaTime, f32, f64, f32, bool);

fn redistribute_lower_frame(project: &mut Project) -> bool {
    let before = project.clone();
    let original_elements: BTreeMap<String, Element> = before
        .active_scene()
        .elements()
        .map(|element| (element.id().to_owned(), element.clone()))
        .collect();
    let original_collisions: BTreeSet<(String, String)> = measured_text_collisions(&before)
        .into_iter()
        .map(|(first, second, _)| (first, second))
        .collect();
    let text_spans: Vec<(String, MediaTime, MediaTime)> = project
        .active_scene()
        .elements()
        .filter(|element| matches!(element, Element::Text(_)) && lower_frame_eligible(element))
        .map(|element| (element.id().to_owned(), element.start(), element.end()))
        .collect();
    let members: Vec<LowerMember> = {
        let scene = project.active_scene();
        scene
            .tracks
            .iter()
            .flat_map(|track| {
                track
                    .elements
                    .iter()
                    .map(move |element| (track.id.as_str(), element))
            })
            .filter(|(_, element)| lower_frame_eligible(element))
            .filter_map(|(track_id, element)| {
                if matches!(element, Element::Text(_))
                    && text_spans.iter().any(|(other_id, other_start, other_end)| {
                        other_id != element.id()
                            && *other_start > element.start()
                            && *other_start < element.end()
                            && *other_end > element.start()
                    })
                {
                    return None;
                }
                let transform = element.transform()?;
                let available_drop = if let Element::Text(text) = element {
                    text_ink_rect(
                        text,
                        transform,
                        project.settings.canvas.width,
                        project.settings.canvas.height,
                    )
                    .map(|rect| (f64::from(TYPE_SAFE_BOTTOM) - rect.bottom()) as f32)
                    .unwrap_or_default()
                    .max(0.0)
                } else {
                    let height = transform.scale.abs() * transform.scale_y.abs();
                    let lowest_safe_y = 0.98 - (1.0 - transform.anchor_y) * height.min(0.96);
                    (lowest_safe_y - transform.y).max(0.0)
                };
                if available_drop <= 0.01 {
                    return None;
                }
                Some((
                    track_id.to_owned(),
                    element.id().to_owned(),
                    element.start(),
                    element.end(),
                    transform.y,
                    visual_score(
                        element,
                        project.settings.canvas.width,
                        project.settings.canvas.height,
                    ),
                    available_drop,
                    matches!(element, Element::Text(_)),
                ))
            })
            .collect()
    };
    if members.is_empty() {
        return false;
    }
    let mut temporal_groups: BTreeMap<(MediaTime, MediaTime), Vec<LowerMember>> = BTreeMap::new();
    for member in members {
        temporal_groups
            .entry((member.2, member.3))
            .or_default()
            .push(member);
    }
    let selected: Vec<(String, String, f32)> = temporal_groups
        .into_values()
        .flat_map(|mut members| {
            if members
                .iter()
                .any(|(_, _, _, _, _, _, _, is_text)| !is_text)
            {
                members.retain(|(_, _, _, _, _, _, _, is_text)| !is_text);
            }
            let total_weight = members
                .iter()
                .map(|(_, _, _, _, _, score, _, _)| score.powi(2))
                .sum::<f64>();
            let reference_y = (total_weight > f64::EPSILON)
                .then(|| {
                    members
                        .iter()
                        .map(|(_, _, _, _, y, score, _, _)| f64::from(*y) * score.powi(2))
                        .sum::<f64>()
                        / total_weight
                })
                .map(|value| value as f32)
                .unwrap_or_else(|| {
                    members
                        .iter()
                        .map(|(_, _, _, _, y, _, _, _)| *y)
                        .max_by(f32::total_cmp)
                        .unwrap_or(LOWER_FRAME_DESTINATION)
                });
            let available_drop = members
                .iter()
                .map(|(_, _, _, _, _, _, drop, _)| *drop)
                .min_by(f32::total_cmp)
                .unwrap_or_default();
            let desired_delta = if reference_y >= LOWER_STACK_ALREADY_PRESENT {
                0.0
            } else {
                (LOWER_FRAME_DESTINATION - reference_y).max(0.0)
            };
            let delta = desired_delta.min(available_drop);
            members
                .into_iter()
                .filter(move |_| delta > 0.01)
                .map(move |(track_id, element_id, _, _, _, _, _, _)| (track_id, element_id, delta))
        })
        .collect();
    let mut changed = false;
    let mut moved_text = BTreeSet::new();
    for (track_id, element_id, delta) in selected {
        let Some(element) = project
            .active_scene_mut()
            .tracks
            .track_mut(&track_id)
            .and_then(|track| track.element_mut(&element_id))
        else {
            continue;
        };
        let Some(mut transform) = element.transform() else {
            continue;
        };
        if matches!(element, Element::Text(_)) {
            moved_text.insert(element_id.clone());
        }
        let old_y = transform.y;
        transform.y += delta;
        if matches!(element, Element::Text(_)) {
            element.set_transform(transform);
        } else {
            contain_transform(&mut transform);
            element.set_transform(transform);
        }
        let applied_delta = element
            .transform()
            .map(|transform| transform.y - old_y)
            .unwrap_or(delta);
        if let Some(channel) = element
            .animations_mut()
            .and_then(|channels| channels.get_mut("y"))
        {
            for key in &mut channel.keys {
                key.value += applied_delta;
            }
        }
        changed = true;
    }
    let introduced_collision_elements: BTreeSet<String> = measured_text_collisions(project)
        .into_iter()
        .filter(|(first, second, _)| {
            !original_collisions.contains(&(first.clone(), second.clone()))
        })
        .flat_map(|(first, second, _)| [first, second])
        .collect();
    if !introduced_collision_elements.is_empty() {
        for track in project.active_scene_mut().tracks.iter_mut() {
            for element in &mut track.elements {
                if moved_text.contains(element.id())
                    && introduced_collision_elements.contains(element.id())
                    && let Some(original) = original_elements.get(element.id())
                {
                    *element = original.clone();
                }
            }
        }
    }
    changed && *project != before
}

fn lower_frame_eligible(element: &Element) -> bool {
    element.is_authored()
        && !matches!(element, Element::Audio(_))
        && !matches!(
            element.role(),
            Some(ElementRole::Ground | ElementRole::Chrome | ElementRole::Caption)
        )
        && element.duration() > MediaTime::ZERO
}

fn contain_transform(transform: &mut Transform) {
    let width = transform.scale.abs() * transform.scale_x.abs();
    let height = transform.scale.abs() * transform.scale_y.abs();
    let left = transform.anchor_x * width;
    let right = (1.0 - transform.anchor_x) * width;
    let top = transform.anchor_y * height;
    let bottom = (1.0 - transform.anchor_y) * height;
    if left + right <= 0.96 {
        transform.x = transform.x.clamp(0.02 + left, 0.98 - right);
    }
    if top + bottom <= 0.96 {
        transform.y = transform.y.clamp(0.02 + top, 0.98 - bottom);
    }
}

#[cfg(test)]
fn lower_frame_layout_share(project: &Project) -> f64 {
    let scene = project.active_scene();
    let end = scene
        .elements()
        .map(Element::end)
        .max()
        .unwrap_or(MediaTime::ZERO)
        .to_seconds_f64();
    if end <= 0.0 {
        return 0.0;
    }
    let steps = (end * 4.0).ceil().max(1.0) as usize;
    let alive = (0..steps)
        .filter(|index| {
            let at = MediaTime::from_seconds_f64(*index as f64 / 4.0).unwrap_or(MediaTime::ZERO);
            scene.authored_elements().any(|element| {
                anchor_eligible(element)
                    && element.start() <= at
                    && element.end() > at
                    && element
                        .sampled_transform(at - element.start())
                        .is_some_and(|transform| transform.y >= 0.70)
            })
        })
        .count();
    alive as f64 / steps as f64
}

fn validate_beat_local_lower_redistribution(
    before: &Project,
    candidate: &Project,
) -> Result<(), String> {
    let before_elements: BTreeMap<&str, &Element> = before
        .active_scene()
        .elements()
        .map(|element| (element.id(), element))
        .collect();
    let timeline = candidate
        .active_scene()
        .elements()
        .map(Element::end)
        .max()
        .unwrap_or(MediaTime::ZERO)
        .to_seconds_f64();
    if timeline <= 0.0 {
        return Err("lower-frame beat ownership cannot be measured on an empty timeline".into());
    }

    let moved_spans: BTreeSet<(MediaTime, MediaTime)> = candidate
        .active_scene()
        .elements()
        .filter(|element| lower_frame_eligible(element))
        .filter_map(|element| {
            let before_element = before_elements.get(element.id())?;
            let before_y = before_element.transform()?.y;
            let candidate_y = element.transform()?.y;
            (candidate_y >= 0.70 && candidate_y > before_y + 0.01)
                .then_some((element.start(), element.end()))
        })
        .collect();

    if moved_spans.len() < 2 {
        return Err(
            "lower-frame coverage comes from one persistent temporal span; redistribute beat-local content instead"
                .into(),
        );
    }
    if moved_spans
        .iter()
        .any(|(start, end)| (*end - *start).to_seconds_f64() / timeline >= BEAT_LOCAL_SPAN_CEILING)
    {
        return Err(
            "a timeline-spanning element was parked low; lower-frame composition must belong to the individual beats"
                .into(),
        );
    }
    Ok(())
}

fn align_timeline(project: &mut Project) -> bool {
    let fps = project.settings.fps.as_f64();
    let mut changed = false;
    for track in project.active_scene_mut().tracks.iter_mut() {
        for element in &mut track.elements {
            if !element.is_authored() {
                continue;
            }
            let start = snap_to_frame(element.start(), fps);
            let duration = floor_to_frame(element.duration(), fps);
            if start != element.start() {
                element.set_start(start);
                changed = true;
            }
            if duration > MediaTime::ZERO && duration != element.duration() {
                element.set_duration(duration);
                changed = true;
            }
        }
    }
    changed
}

fn snap_to_frame(time: MediaTime, fps: f64) -> MediaTime {
    if !fps.is_finite() || fps <= 0.0 {
        return time;
    }
    let frame = (time.to_seconds_f64() * fps).round();
    MediaTime::from_seconds_f64(frame / fps).unwrap_or(time)
}

fn floor_to_frame(time: MediaTime, fps: f64) -> MediaTime {
    if !fps.is_finite() || fps <= 0.0 {
        return time;
    }
    let frame = (time.to_seconds_f64() * fps).floor();
    MediaTime::from_seconds_f64(frame / fps).unwrap_or(time)
}

fn timeline_is_frame_aligned(project: &Project) -> bool {
    let fps = project.settings.fps.as_f64();
    project.active_scene().authored_elements().all(|element| {
        snap_to_frame(element.start(), fps) == element.start()
            && snap_to_frame(element.duration(), fps) == element.duration()
    }) && bay_core::check(project)
        .rollup
        .get("off-grid")
        .copied()
        .unwrap_or_default()
        == 0
}

fn raise_gap_bed(project: &mut Project) -> bool {
    let Some(level) = mix::envelope(project).gap_bed_lufs else {
        return false;
    };
    if level >= AUDIBLE_GAP_LEVEL - 0.05 {
        return false;
    }
    let gain = 10.0_f64.powf((AUDIBLE_GAP_LEVEL - level) / 20.0) as f32;
    let speech: Vec<Element> = project
        .active_scene()
        .elements()
        .filter(
            |element| matches!(element, Element::Audio(audio) if audio.role == AudioRole::Speech),
        )
        .cloned()
        .collect();
    let under: Vec<&Element> = speech.iter().collect();
    let mut changed = false;
    for track in project.active_scene_mut().tracks.audio.iter_mut() {
        for element in &mut track.elements {
            if !matches!(element, Element::Audio(audio) if audio.role == AudioRole::Bed) {
                continue;
            }
            if let Element::Audio(audio) = element {
                audio.volume *= gain;
            }
            let had_volume_curve = matches!(
                element,
                Element::Audio(audio)
                    if audio.animations.get("volume").is_some_and(|channel| {
                        channel
                            .keys
                            .windows(2)
                            .any(|pair| (pair[1].value - pair[0].value).abs() > f32::EPSILON)
                    })
            );
            let params = DuckParams {
                depth_db: 24.0,
                ..DuckParams::default()
            };
            if had_volume_curve
                && let Ok(derived) = bay_project::duck::duck(element, &under, &params)
            {
                let Element::Audio(audio) = element else {
                    unreachable!()
                };
                audio.animations.insert("volume".into(), derived.channel);
            } else if let Element::Audio(audio) = element
                && let Some(channel) = audio.animations.get_mut("volume")
            {
                for key in &mut channel.keys {
                    key.value *= gain;
                }
            }
            changed = true;
        }
    }
    for _ in 0..3 {
        let Some(level) = mix::envelope(project).gap_bed_lufs else {
            break;
        };
        if level >= AUDIBLE_GAP_LEVEL - 0.05 {
            break;
        }
        let correction = 10.0_f64.powf((AUDIBLE_GAP_LEVEL - level) / 20.0) as f32;
        for track in project.active_scene_mut().tracks.audio.iter_mut() {
            for element in &mut track.elements {
                let Element::Audio(audio) = element else {
                    continue;
                };
                if audio.role != AudioRole::Bed {
                    continue;
                }
                audio.volume *= correction;
                if let Some(channel) = audio.animations.get_mut("volume") {
                    for key in &mut channel.keys {
                        key.value *= correction;
                    }
                }
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LowerToCommands;
    use bay_core::check;
    use bay_project::{
        AudioElement, BlendMode, ElementSource, Fps, Keyframe, MediaAsset, ProjectSettings,
        TextElement,
    };
    use std::collections::BTreeMap;

    fn seconds(value: f64) -> MediaTime {
        MediaTime::from_seconds_f64(value).expect("representable")
    }

    fn empty_project() -> Project {
        let mut project = Project::starter();
        for track in project.active_scene_mut().tracks.iter_mut() {
            track.elements.clear();
        }
        project
    }

    fn text(id: &str, content: &str, role: ElementRole, y: f32) -> Element {
        Element::Text(TextElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: seconds(4.0),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            content: content.into(),
            font_size: 72.0,
            color: "#ffffff".into(),
            transform: Transform {
                x: 0.5,
                y,
                scale: 0.84,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: BTreeMap::new(),
            blend_mode: BlendMode::Normal,
            mask: None,
            font_family: None,
            font_weight: 700,
            align: TextAlign::Center,
            letter_spacing: 0.0,
            line_height: 1.1,
            decorations: None,
            karaoke: None,
            type_on: None,
            source: ElementSource::Author,
            role,
        })
    }

    fn report_with(code: &'static str, element_id: Option<&str>) -> Report {
        let mut report = check(&Project::starter());
        let severity = bay_core::check::severity_of(code);
        report.findings.insert(
            0,
            Finding {
                severity,
                code,
                message: "fixture".into(),
                element_id: element_id.map(str::to_owned),
                track_id: Some("track-overlay-1".into()),
                at_seconds: Some(0.0),
            },
        );
        *report.rollup.entry(code).or_default() += 1;
        report.total += 1;
        if severity == Severity::Error {
            report.errors += 1;
        } else {
            report.warnings += 1;
        }
        report
    }

    fn apply(project: Project, repair: &Repair) -> Project {
        let mut editor = bay_core::Editor::new(project);
        for command in repair.lower_to_commands().iter().cloned() {
            assert!(editor.execute(command));
        }
        editor.project().clone()
    }

    fn evaluated_with_frames(
        project: &Project,
        peak_anchor_sqrt_area: Option<f64>,
        bottom_alive_share: Option<f64>,
    ) -> RepairEvaluation {
        RepairEvaluation::from_report_and_frames(
            check(project),
            &FrameAssessment {
                peak_anchor_sqrt_area,
                bottom_alive_share,
                ..FrameAssessment::default()
            },
        )
    }

    #[test]
    fn anchor_repair_makes_the_subject_own_the_frame_without_new_core_codes() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements =
            vec![text("anchor", "A SMALL SUBJECT", ElementRole::Hook, 0.20)];
        let before = check(&project);
        let report = report_with("anchor-scale", None);
        let repair = repair_for(&project, &report, "anchor-scale", false).expect("repair");
        let candidate = apply(project.clone(), &repair);
        let after = check(&candidate);

        assert!(strongest_anchor_score(&candidate) >= MODEL_SCALE_PREFILTER);
        assert!(
            added_rollup_codes(&before, &after).is_empty(),
            "{:?}",
            added_rollup_codes(&before, &after)
        );
        DeterministicOvershoot
            .validate(
                &repair,
                &Project::starter(),
                &candidate,
                &evaluated_with_frames(&candidate, Some(0.36), None),
            )
            .expect("real margin");
    }

    #[test]
    fn anchor_repair_declines_background_only_layouts() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements =
            vec![text("ground", "BACKGROUND", ElementRole::Ground, 0.5)];
        let report = report_with("anchor-scale", None);
        assert!(repair_for(&project, &report, "anchor-scale", false).is_none());
    }

    #[test]
    fn anchor_overshoot_rejects_a_gate_measured_floor_skimming_result() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements =
            vec![text("anchor", "A SMALL SUBJECT", ElementRole::Hook, 0.20)];
        let report = report_with("anchor-scale", None);
        let repair = repair_for(&project, &report, "anchor-scale", false).expect("repair");
        let candidate = apply(project.clone(), &repair);
        let gate_measured_peak = 0.265_855;

        assert!(
            strongest_anchor_score(&candidate) >= MODEL_SCALE_PREFILTER,
            "fixture must clear the obsolete model-space guard"
        );
        assert!(
            DeterministicOvershoot
                .validate(
                    &repair,
                    &project,
                    &candidate,
                    &evaluated_with_frames(&candidate, Some(gate_measured_peak), None),
                )
                .is_err(),
            "a {gate_measured_peak:.6} rendered-pixel result lands on the gate floor and must be rejected"
        );
    }

    #[test]
    fn collision_repair_clears_shaped_ink_with_margin_and_no_new_core_codes() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements = vec![
            text(
                "hook",
                "THIS LONG HEADING MUST REFLOW",
                ElementRole::Hook,
                0.12,
            ),
            text("credit", "SOURCE CREDIT", ElementRole::Chrome, 0.12),
        ];
        let before = check(&project);
        assert!(!measured_text_collisions(&project).is_empty());
        let report = report_with("text-collision", Some("credit"));
        let repair = repair_for(&project, &report, "text-collision", false).expect("repair");
        let candidate = apply(project, &repair);
        let after = check(&candidate);

        assert!(measured_text_collisions(&candidate).is_empty());
        assert!(
            added_rollup_codes(&before, &after).is_empty(),
            "{:?}",
            added_rollup_codes(&before, &after)
        );
        DeterministicOvershoot
            .validate(
                &repair,
                &Project::starter(),
                &candidate,
                &RepairEvaluation::from(after),
            )
            .expect("ink gap");
    }

    #[test]
    fn collision_repair_declines_non_overlapping_text() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements = vec![
            text("hook", "TOP", ElementRole::Hook, 0.08),
            text("credit", "BOTTOM", ElementRole::Chrome, 0.88),
        ];
        let report = report_with("text-collision", Some("credit"));
        assert!(repair_for(&project, &report, "text-collision", false).is_none());
    }

    #[test]
    fn bottom_repair_redistributes_existing_content_without_new_core_codes() {
        let mut project = empty_project();
        let mut first = text("headline-1", "FIRST BEAT", ElementRole::Headline, 0.12);
        first.set_duration(seconds(2.0));
        let mut second = text("headline-2", "SECOND BEAT", ElementRole::Headline, 0.16);
        second.set_start(seconds(2.0));
        second.set_duration(seconds(2.0));
        project.active_scene_mut().tracks.overlay[0].elements = vec![first, second];
        let before = check(&project);
        let report = report_with("bottom-dead", None);
        let repair = repair_for(&project, &report, "bottom-dead", false).expect("repair");
        let candidate = apply(project.clone(), &repair);
        let after = check(&candidate);

        assert!(lower_frame_layout_share(&candidate) >= LOWER_FRAME_COMPOSITION_GOAL);
        assert!(added_rollup_codes(&before, &after).is_empty());
        assert_eq!(
            candidate.active_scene().authored_elements().count(),
            2,
            "repair redistributes; it does not invent content"
        );
        DeterministicOvershoot
            .validate(
                &repair,
                &project,
                &candidate,
                &evaluated_with_frames(&candidate, None, Some(0.75)),
            )
            .expect("beat-local lower-frame composition");
    }

    #[test]
    fn bottom_repair_declines_a_stack_already_low() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements =
            vec![text("headline", "ALREADY LOW", ElementRole::Headline, 0.80)];
        let report = report_with("bottom-dead", None);
        assert!(repair_for(&project, &report, "bottom-dead", false).is_none());
    }

    #[test]
    fn bottom_overshoot_rejects_one_persistent_element_parked_low() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.overlay[0].elements =
            vec![text("headline", "PERSISTENT", ElementRole::Headline, 0.12)];
        let report = report_with("bottom-dead", None);
        let repair = repair_for(&project, &report, "bottom-dead", false).expect("repair");
        let candidate = apply(project.clone(), &repair);

        assert_eq!(lower_frame_layout_share(&candidate), 1.0);
        assert!(
            DeterministicOvershoot
                .validate(
                    &repair,
                    &project,
                    &candidate,
                    &evaluated_with_frames(&candidate, None, Some(1.0)),
                )
                .is_err(),
            "one timeline-spanning occupant is metric gaming, not beat redistribution"
        );
    }

    #[test]
    fn off_grid_repair_aligns_cuts_and_preserves_clean_codes() {
        let mut project = empty_project();
        project.settings.fps = Fps {
            numerator: 30,
            denominator: 1,
        };
        let mut item = text("title", "GRID", ElementRole::Headline, 0.5);
        let animations = bay_project::moves::apply(
            &item,
            bay_project::moves::find("lift").expect("registered move"),
            &bay_project::moves::MoveParams::default(),
        )
        .expect("move applies to text");
        *item.animations_mut().expect("text has animations") = animations;
        let original_animations = item.animations().expect("text has animations").clone();
        item.set_start(seconds(0.014));
        item.set_duration(seconds(1.017));
        project.active_scene_mut().tracks.overlay[0].elements = vec![item];
        let before = check(&project);
        let report = report_with("off-grid", None);
        let repair = repair_for(&project, &report, "off-grid", false).expect("repair");
        let candidate = apply(project, &repair);
        let after = check(&candidate);

        assert!(timeline_is_frame_aligned(&candidate));
        assert_eq!(
            candidate.active_scene().tracks.overlay[0].elements[0]
                .animations()
                .expect("text has animations"),
            &original_animations,
            "timing repair must preserve named move channels byte-for-byte"
        );
        assert!(
            added_rollup_codes(&before, &after).is_empty(),
            "{:?}",
            added_rollup_codes(&before, &after)
        );
        DeterministicOvershoot
            .validate(
                &repair,
                &Project::starter(),
                &candidate,
                &RepairEvaluation::from(after),
            )
            .expect("exact frame landing");
    }

    #[test]
    fn off_grid_repair_declines_an_aligned_timeline() {
        let project = Project::starter();
        let report = report_with("off-grid", None);
        assert!(repair_for(&project, &report, "off-grid", false).is_none());
    }

    #[test]
    fn quiet_bed_repair_reaches_an_audible_gap_without_new_codes() {
        let mut project = audible_bed_project(0.05);
        let before = check(&project);
        let report = report_with("bed-too-quiet", Some("bed"));
        let repair = repair_for(&project, &report, "bed-too-quiet", false).expect("repair");
        let candidate = apply(project.clone(), &repair);
        let after = check(&candidate);
        let level = mix::envelope(&candidate)
            .gap_bed_lufs
            .expect("measured gap");

        assert!(level >= AUDIBLE_GAP_LEVEL - AUDIBLE_LEVEL_SLACK);
        assert!(
            added_rollup_codes(&before, &after).is_empty(),
            "{:?}",
            added_rollup_codes(&before, &after)
        );
        DeterministicOvershoot
            .validate(
                &repair,
                &project,
                &candidate,
                &RepairEvaluation::from(after),
            )
            .expect("audible margin");
        project = candidate;
        assert!(mix::envelope(&project).has_bed);
    }

    #[test]
    fn quiet_bed_repair_declines_a_bed_already_present() {
        let project = audible_bed_project(10.0);
        let report = report_with("bed-too-quiet", Some("bed"));
        assert!(repair_for(&project, &report, "bed-too-quiet", false).is_none());
    }

    fn audible_bed_project(volume: f32) -> Project {
        let mut project = empty_project();
        project.settings = ProjectSettings {
            fps: Fps {
                numerator: 30,
                denominator: 1,
            },
            ..project.settings
        };
        project.media = vec![
            MediaAsset {
                id: "music".into(),
                name: "music".into(),
                path: "music.wav".into(),
                duration_seconds: Some(8.0),
                width: None,
                height: None,
                loudness: Some(bay_project::AssetLoudness {
                    peak_db: -3.0,
                    rms_db: -30.0,
                    lufs: -30.0,
                    accent_seconds: Vec::new(),
                }),
                transcript: None,
                semantic_index: None,
                generated: None,
            },
            MediaAsset {
                id: "voice".into(),
                name: "voice".into(),
                path: "voice.wav".into(),
                duration_seconds: Some(4.0),
                width: None,
                height: None,
                loudness: Some(bay_project::AssetLoudness {
                    peak_db: -2.0,
                    rms_db: -14.0,
                    lufs: -14.0,
                    accent_seconds: Vec::new(),
                }),
                transcript: None,
                semantic_index: None,
                generated: None,
            },
        ];
        project.active_scene_mut().tracks.audio[0].elements = vec![
            Element::Audio(AudioElement {
                id: "bed".into(),
                name: "bed".into(),
                start: MediaTime::ZERO,
                duration: seconds(8.0),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "music".into(),
                muted: false,
                volume,
                pan: 0.0,
                speed: 1.0,
                prosody: None,
                dialogue_chain: None,
                animations: BTreeMap::from([(
                    "volume".into(),
                    bay_project::AnimationChannel {
                        keys: vec![
                            Keyframe::new(MediaTime::ZERO, volume),
                            Keyframe::new(seconds(8.0), volume),
                        ],
                        ..Default::default()
                    },
                )]),
                trim_start: MediaTime::ZERO,
                source: ElementSource::Author,
                role: AudioRole::Bed,
            }),
            Element::Audio(AudioElement {
                id: "speech".into(),
                name: "speech".into(),
                start: MediaTime::ZERO,
                duration: seconds(4.0),
                fade_in: MediaTime::ZERO,
                fade_out: MediaTime::ZERO,
                media_id: "voice".into(),
                muted: false,
                volume: 1.0,
                pan: 0.0,
                speed: 1.0,
                prosody: None,
                dialogue_chain: None,
                animations: BTreeMap::new(),
                trim_start: MediaTime::ZERO,
                source: ElementSource::Author,
                role: AudioRole::Speech,
            }),
        ];
        project
    }

    fn added_rollup_codes(before: &Report, after: &Report) -> Vec<&'static str> {
        after
            .rollup
            .keys()
            .copied()
            .filter(|code| !before.rollup.contains_key(code))
            .collect()
    }
}
