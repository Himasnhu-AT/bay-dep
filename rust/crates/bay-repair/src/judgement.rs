use std::{cell::RefCell, collections::BTreeMap};

use bay_agent::trust::{pairwise_decide, register_variant};
use bay_core::{Command, ElementRef, Project, Report};
use bay_project::{
    Direction, Element, ElementRole, MediaTime, MoveKind, PlanArtifact, Transform, moves,
};

use crate::{
    ConvergedCandidate, FindingTarget, OvershootGuard, Repair, RepairEvaluation, RepairPlanner,
};

/// The critic's forced preference between two gate-safe repair candidates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CraftDecision {
    CandidateWins { reason: String },
    IncumbentWins { reason: String },
}

/// Held-out craft judgement over gate-safe survivors, followed by an absolute craft assessment.
pub trait CraftJudge {
    /// Return the index of the accepted winner. Implementations must compare every additional
    /// survivor pairwise and must judge the final winner on its own merits.
    fn choose(&self, candidates: &[ConvergedCandidate]) -> Result<usize, String>;
}

/// Adapter for a repair tournament owned by `bay-agent`.
///
/// `compare` renders and ranks two gate-clean candidates. `assess` then submits fresh panel
/// evidence for the winner and closes the resulting obligations. The adapter verifies both
/// conditions rather than trusting either callback's claim.
pub struct TournamentJudge<F, A> {
    plan: RefCell<PlanArtifact>,
    compare: F,
    assess: A,
}

impl<F, A> TournamentJudge<F, A> {
    pub fn new(plan: PlanArtifact, compare: F, assess: A) -> Self {
        Self {
            plan: RefCell::new(plan),
            compare,
            assess,
        }
    }

    pub fn into_plan(self) -> PlanArtifact {
        self.plan.into_inner()
    }
}

impl<F, A> CraftJudge for TournamentJudge<F, A>
where
    F: Fn(
        &ConvergedCandidate,
        &ConvergedCandidate,
        &mut PlanArtifact,
        &str,
        &str,
    ) -> Result<CraftDecision, String>,
    A: Fn(&ConvergedCandidate, &mut PlanArtifact, &str) -> Result<(), String>,
{
    fn choose(&self, candidates: &[ConvergedCandidate]) -> Result<usize, String> {
        if candidates.is_empty() {
            return Err("the craft judge received no globally clean converged projects".into());
        }
        let mut plan = self.plan.borrow_mut();
        let variants: Vec<Project> = candidates
            .iter()
            .enumerate()
            .map(|(index, candidate)| {
                let mut variant = candidate.project.clone();
                variant.metadata.id =
                    variant_id(&format!("repair-path-{index}"), &candidate.project);
                variant
            })
            .collect();
        let parent_id = variants[0].metadata.id.clone();
        for (index, (candidate, variant)) in candidates.iter().zip(&variants).enumerate() {
            let intents = candidate
                .repairs
                .iter()
                .map(|repair| repair.intent.as_str())
                .collect::<Vec<_>>()
                .join(" → ");
            ensure_registered(
                &mut plan,
                variant,
                &parent_id,
                &format!("converged repair path {}: {intents}", index + 1),
            )?;
        }

        let mut winner = 0usize;
        for challenger in 1..variants.len() {
            let decision = (self.compare)(
                &candidates[winner],
                &candidates[challenger],
                &mut plan,
                &variants[winner].metadata.id,
                &variants[challenger].metadata.id,
            )?;
            let (selected, reason) = match decision {
                CraftDecision::CandidateWins { reason } => (challenger, reason),
                CraftDecision::IncumbentWins { reason } => (winner, reason),
            };
            pairwise_decide(
                &mut plan,
                &variants[winner].metadata.id,
                &variants[challenger].metadata.id,
                &variants[selected].metadata.id,
                &reason,
            )?;
            winner = selected;
        }

        let rounds_before = plan.critic.rounds_completed;
        let obligations_before = plan.critic.obligations.len();
        (self.assess)(
            &candidates[winner],
            &mut plan,
            &variants[winner].metadata.id,
        )?;
        if plan.critic.rounds_completed <= rounds_before
            || plan.critic.obligations.len() <= obligations_before
        {
            return Err("absolute critic accepted without fresh engine-panel evidence".into());
        }
        if plan.critic.obligations[obligations_before..]
            .iter()
            .any(|obligation| !obligation.closed)
        {
            return Err(
                "absolute critic rejected the winner: fresh panel obligations remain open".into(),
            );
        }
        Ok(winner)
    }
}

fn variant_id(prefix: &str, project: &Project) -> String {
    let hash = bay_project::project_hash(project);
    format!("{prefix}-{}", &hash[..hash.len().min(12)])
}

fn ensure_registered(
    plan: &mut PlanArtifact,
    project: &Project,
    parent_id: &str,
    label: &str,
) -> Result<(), String> {
    if plan
        .variants
        .candidates
        .iter()
        .any(|entry| entry.project_id == project.metadata.id)
    {
        return Ok(());
    }
    register_variant(plan, project, parent_id, label).map(|_| ())
}

/// Candidate enumeration for the three judgement-driven finding families.
#[derive(Debug, Default, Clone, Copy)]
pub struct JudgementRepairs;

impl RepairPlanner for JudgementRepairs {
    fn plan(&self, project: &Project, report: &Report) -> Vec<Repair> {
        let mut proposals = continuity_candidates(project, report);
        proposals.extend(frozen_candidates(project, report));
        proposals.extend(lower_layout_candidates(project, report));
        proposals
    }
}

/// Judgement repairs still need semantic guards before they reach the critic.
#[derive(Debug, Default, Clone, Copy)]
pub struct JudgementOvershoot;

impl OvershootGuard for JudgementOvershoot {
    fn validate(
        &self,
        repair: &Repair,
        before: &Project,
        candidate: &Project,
        evaluation: &RepairEvaluation,
    ) -> Result<(), String> {
        match repair.target.code.as_str() {
            "broken-continuity" => {
                let seam_remains = evaluation.report.findings.iter().any(|finding| {
                    finding.code == "broken-continuity"
                        && match (repair.target.at_seconds, finding.at_seconds) {
                            (Some(target), Some(found)) => (target - found).abs() < 0.02,
                            (None, _) => true,
                            _ => false,
                        }
                });
                if seam_remains {
                    return Err(
                        "the targeted seam still replaces the composition without a carry".into(),
                    );
                }
            }
            "frozen" => {
                if evaluation
                    .report
                    .rollup
                    .get(repair.target.code.as_str())
                    .copied()
                    .unwrap_or_default()
                    > 0
                {
                    return Err(format!(
                        "{} remains after the complete semantic move",
                        repair.target.code
                    ));
                }
            }
            "bottom-dead" => {
                let share = evaluation.magnitude("bottom-dead").ok_or_else(|| {
                    "rendered bottom-alive share is unavailable; layout judgement requires evaluated GPU frames"
                        .to_string()
                })?;
                if share < 0.60 {
                    return Err(format!(
                        "the rendered lower-frame composition reaches only {:.0}% of samples",
                        share * 100.0
                    ));
                }
                validate_local_layout(before, candidate)?;
            }
            _ => {}
        }
        Ok(())
    }
}

fn continuity_candidates(project: &Project, report: &Report) -> Vec<Repair> {
    let mut proposals = continuity_chain_candidates(project, report);
    proposals.extend(
        report
        .findings
        .iter()
        .filter(|finding| finding.code == "broken-continuity")
        .flat_map(|finding| {
            let Some(seam) = finding.at_seconds.and_then(MediaTime::from_seconds_f64) else {
                return Vec::new();
            };
            let hold_end = seam + seconds(17.0 / 30.0);
            let target = FindingTarget::from(finding);
            let outgoing: Vec<Repair> = project
                .active_scene()
                .tracks
                .iter()
                .flat_map(|track| {
                    track
                        .elements
                        .iter()
                        .map(move |element| (track.id.as_str(), element))
                })
                .filter(|(_, element)| carry_eligible(element, seam))
                .filter_map(|(track_id, element)| {
                    let mut carried = element.clone();
                    carried.set_duration(hold_end - carried.start());
                    carried.set_fades(carried.fade_in(), seconds(1.2));
                    let local_seam = (seam - carried.start()).to_seconds_f64().max(0.0);
                    let movement = seam_bridge_animations(&carried, local_seam)?;
                    *carried.animations_mut()? = movement;
                    let commands = if project
                        .active_scene()
                        .tracks
                        .track(track_id)
                        .is_some_and(|track| {
                            track.elements.iter().any(|other| {
                                other.id() != element.id()
                                    && other.start() < hold_end
                                    && other.end() > seam
                            })
                        })
                    {
                        let destination = project
                            .active_scene()
                            .tracks
                            .overlay
                            .iter()
                            .find(|track| track.id != track_id)?;
                        vec![
                            Command::RemoveElement {
                                reference: ElementRef::new(track_id, element.id()),
                            },
                            Command::AddElement {
                                track_id: destination.id.clone(),
                                element: carried,
                                select: false,
                            },
                        ]
                    } else {
                        vec![Command::ReplaceElement {
                            reference: ElementRef::new(track_id, element.id()),
                            element: carried,
                        }]
                    };
                    Repair::new(
                        target.clone(),
                        format!(
                            "{} already owns the outgoing composition and can remain as the next beat arrives",
                            element.id()
                        ),
                        "carry the incumbent across the seam and let it make room",
                        commands,
                    )
                    .ok()
                })
                .collect();
            let incoming = incoming_bridge_candidates(project, target, seam);
            outgoing.into_iter().chain(incoming).collect()
        })
        .collect::<Vec<_>>(),
    );
    proposals
}

fn continuity_chain_candidates(project: &Project, report: &Report) -> Vec<Repair> {
    let findings: Vec<_> = report
        .findings
        .iter()
        .filter(|finding| finding.code == "broken-continuity")
        .collect();
    let Some(first) = findings.first() else {
        return Vec::new();
    };
    let first_seam = first.at_seconds.unwrap_or_default();
    let seams: Vec<MediaTime> = report
        .stats
        .beats
        .starts
        .iter()
        .copied()
        .filter(|start| *start + 0.02 >= first_seam && *start > 0.0)
        .filter_map(MediaTime::from_seconds_f64)
        .collect();
    let mut proposals: Vec<Repair> = [Direction::Left, Direction::Right]
        .into_iter()
        .filter_map(|direction| {
            let mut candidate = project.clone();
            let mut changed = false;
            for seam in seams.iter().copied() {
                changed |= bridge_incoming_main_picture(&mut candidate, seam, direction);
            }
            if !changed {
                return None;
            }
            Repair::new(
                FindingTarget::from(*first),
                "each replacement cut has an incoming subject that can lead the picture before the outgoing subject leaves",
                "bridge every replacement seam with a matched incoming transition",
                replacement_commands(project, &candidate),
            )
            .ok()
        })
        .collect();
    let mut carried = project.clone();
    if carry_outgoing_chain(&mut carried, &seams)
        && let Ok(repair) = Repair::new(
            FindingTarget::from(*first),
            "each whole-composition replacement has a beat-local subject that can remain while the next scaffold arrives",
            "carry one outgoing subject through every replacement seam",
            project_commands(project, &carried),
        )
    {
        proposals.push(repair);
    }
    proposals
}

fn carry_outgoing_chain(project: &mut Project, seams: &[MediaTime]) -> bool {
    let mut used = std::collections::BTreeSet::new();
    let mut changed = false;
    for seam in seams.iter().copied() {
        let selected = project
            .active_scene()
            .tracks
            .iter()
            .flat_map(|track| {
                track
                    .elements
                    .iter()
                    .map(move |element| (track.id.clone(), element))
            })
            .filter(|(_, element)| carry_eligible(element, seam) && !used.contains(element.id()))
            .max_by(|(_, left), (_, right)| carry_weight(left).total_cmp(&carry_weight(right)))
            .map(|(track_id, element)| (track_id, element.id().to_owned()));
        let Some((track_id, element_id)) = selected else {
            continue;
        };
        let Some(mut carried) = project
            .active_scene()
            .tracks
            .track(&track_id)
            .and_then(|track| track.element(&element_id))
            .cloned()
        else {
            continue;
        };
        let hold_end = seam + seconds(17.0 / 30.0);
        carried.set_duration(hold_end - carried.start());
        carried.set_fades(carried.fade_in(), seconds(1.2));
        let local_seam = (seam - carried.start()).to_seconds_f64().max(0.0);
        let Some(animations) = seam_bridge_animations(&carried, local_seam) else {
            continue;
        };
        let Some(channels) = carried.animations_mut() else {
            continue;
        };
        *channels = animations;

        let destination = project
            .active_scene()
            .tracks
            .overlay
            .iter()
            .find(|track| track.id != track_id)
            .map(|track| track.id.clone())
            .unwrap_or_else(|| track_id.clone());
        if destination == track_id {
            if let Some(element) = project
                .active_scene_mut()
                .tracks
                .track_mut(&track_id)
                .and_then(|track| track.element_mut(&element_id))
            {
                *element = carried;
                used.insert(element_id);
                changed = true;
            }
        } else {
            if let Some(track) = project.active_scene_mut().tracks.track_mut(&track_id) {
                track.elements.retain(|element| element.id() != element_id);
            }
            if let Some(track) = project.active_scene_mut().tracks.track_mut(&destination) {
                track.elements.push(carried);
                used.insert(element_id);
                changed = true;
            }
        }
    }
    changed
}

fn seam_bridge_animations(
    element: &Element,
    local_seam: f64,
) -> Option<BTreeMap<String, bay_project::AnimationChannel>> {
    let make_room = moves::find("make-room")?;
    let starts_down = element
        .transform()
        .is_some_and(|transform| transform.y < 0.5);
    let travel = if starts_down {
        Direction::Down
    } else {
        Direction::Up
    };
    moves::apply(
        element,
        make_room,
        &moves::MoveParams {
            at: local_seam,
            direction: Some(travel),
            distance: 2.0,
        },
    )
    .ok()
}

fn carry_weight(element: &Element) -> f32 {
    element
        .transform()
        .map(|transform| {
            transform.scale.abs() * (transform.scale_x.abs() * transform.scale_y.abs()).sqrt()
        })
        .unwrap_or_default()
}

fn bridge_incoming_main_picture(
    project: &mut Project,
    seam: MediaTime,
    direction: Direction,
) -> bool {
    let lead = seconds(8.0 / 30.0);
    let Some(index) = project
        .active_scene()
        .tracks
        .main
        .elements
        .iter()
        .position(|element| {
            motion_eligible(element)
                && element.start() >= seam - seconds(0.02)
                && element.start() <= seam + seconds(0.25)
        })
    else {
        return false;
    };
    let element = &mut project.active_scene_mut().tracks.main.elements[index];
    let original_end = element.end();
    let fade_out = element.fade_out();
    if let Some(source_start) = element.source_start() {
        if source_start < lead {
            return false;
        }
        element.set_source_start(source_start - lead);
    }
    element.set_start(seam - lead);
    element.set_duration(original_end - element.start());
    element.set_fades(lead, fade_out);
    let Ok(animations) = moves::apply(
        element,
        moves::find("split").expect("registered entrance"),
        &moves::MoveParams {
            at: 0.0,
            direction: Some(direction),
            distance: 1.0,
        },
    ) else {
        return false;
    };
    let Some(channels) = element.animations_mut() else {
        return false;
    };
    *channels = animations;
    true
}

fn incoming_bridge_candidates(
    project: &Project,
    target: FindingTarget,
    seam: MediaTime,
) -> Vec<Repair> {
    let bridge_start = seam - seconds(0.25);
    project
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| {
            track
                .elements
                .iter()
                .map(move |element| (track.id.as_str(), element))
        })
        .filter(|(_, element)| {
            motion_eligible(element)
                && element.start() >= seam - seconds(0.02)
                && element.start() <= seam + seconds(0.25)
        })
        .filter_map(|(track_id, element)| {
            let mut bridged = element.clone();
            let original_end = element.end();
            bridged.set_start(bridge_start);
            bridged.set_duration(original_end - bridge_start);
            let animations = moves::apply(
                &bridged,
                moves::find("whip-in")?,
                &moves::MoveParams {
                    at: 0.0,
                    direction: Some(Direction::Left),
                    distance: 1.0,
                },
            )
            .ok()?;
            *bridged.animations_mut()? = animations;
            let animations = moves::apply(
                &bridged,
                moves::find("make-room")?,
                &moves::MoveParams {
                    at: 0.30,
                    direction: Some(Direction::Up),
                    distance: 1.5,
                },
            )
            .ok()?;
            *bridged.animations_mut()? = animations;
            let destination = project
                .active_scene()
                .tracks
                .overlay
                .iter()
                .find(|track| track.id != track_id)?;
            Repair::new(
                target.clone(),
                format!(
                    "{} can enter before the cut and remain as the next composition",
                    element.id()
                ),
                "bridge the seam with the incoming subject's named arrival",
                vec![
                    Command::RemoveElement {
                        reference: ElementRef::new(track_id, element.id()),
                    },
                    Command::AddElement {
                        track_id: destination.id.clone(),
                        element: bridged,
                        select: false,
                    },
                ],
            )
            .ok()
        })
        .collect()
}

fn carry_eligible(element: &Element, seam: MediaTime) -> bool {
    element.is_authored()
        && element.transform().is_some()
        && element.start() < seam
        && element.end() > seam - seconds(0.5)
        && element.end() <= seam + seconds(0.25)
        && !matches!(element, Element::Audio(_))
        && !matches!(
            element.role(),
            Some(ElementRole::Ground | ElementRole::Chrome | ElementRole::Caption)
        )
}

fn frozen_candidates(project: &Project, report: &Report) -> Vec<Repair> {
    let Some(finding) = report
        .findings
        .iter()
        .find(|finding| finding.code == "frozen")
    else {
        return Vec::new();
    };
    ["shunt", "drift", "creep"]
        .into_iter()
        .filter_map(|move_id| {
            let mut candidate = project.clone();
            let changed = animate_held_subjects(&mut candidate, move_id);
            if !changed {
                return None;
            }
            let commands = replacement_commands(project, &candidate);
            Repair::new(
                FindingTarget::from(finding),
                format!(
                    "held beat anchors can carry authored {} motion instead of a static arrangement",
                    moves::find(move_id)?.kind.as_str()
                ),
                format!("give held anchors named {move_id} motion"),
                commands,
            )
            .ok()
        })
        .collect()
}

fn animate_held_subjects(project: &mut Project, move_id: &str) -> bool {
    let Some(mv) = moves::find(move_id) else {
        return false;
    };
    debug_assert!(matches!(mv.kind, MoveKind::Ambient | MoveKind::Seam));
    let mut changed = false;
    let mut ordinal = 0usize;
    for track in project.active_scene_mut().tracks.iter_mut() {
        for element in &mut track.elements {
            if !frozen_motion_eligible(element, move_id) {
                continue;
            }
            let phase = (ordinal % 4) as f64 * 0.11;
            ordinal += 1;
            if move_id == "creep"
                && element
                    .transform()
                    .is_some_and(|transform| transform.y >= 0.68)
            {
                continue;
            }
            let duration = element.duration().to_seconds_f64();
            let span = mv.duration_seconds();
            if duration <= span + 0.1 {
                continue;
            }
            // Keep a four-frame hold between signatures. Starting the next move on the previous
            // move's final key would overwrite that key's terminal easing and make both named
            // moves unreadable to the registry audit; a shorter reset is itself received as a
            // cut.
            let cadence = span + 4.0 / 30.0;
            let mut animations = element.animations().cloned().unwrap_or_default();
            let mut at = phase;
            let mut iteration = 0usize;
            while at + span <= duration {
                let mut staged = element.clone();
                if let Some(channels) = staged.animations_mut() {
                    *channels = animations.clone();
                }
                let direction = match (move_id, mv.lead, iteration % 2) {
                    ("shunt", "y", 0) => Some(Direction::Down),
                    ("shunt", "y", _) => Some(Direction::Up),
                    (_, "x", 0) => Some(Direction::Left),
                    (_, "x", _) => Some(Direction::Right),
                    ("creep", "y", _) => Some(Direction::Down),
                    _ => None,
                };
                let Ok(next) = moves::apply(
                    &staged,
                    mv,
                    &moves::MoveParams {
                        at,
                        direction,
                        distance: match move_id {
                            "drift" => 4.0,
                            "shunt" => 1.0,
                            _ => 1.0,
                        },
                    },
                ) else {
                    break;
                };
                animations = next;
                at += cadence;
                iteration += 1;
            }
            if move_id == "drift" {
                let shunt = moves::find("shunt").expect("registered ground motion");
                let shunt_cadence = shunt.duration_seconds() + 4.0 / 30.0;
                let mut shunt_at = 0.31;
                let mut shunt_iteration = 0usize;
                while shunt_at + shunt.duration_seconds() <= duration {
                    let mut staged = element.clone();
                    if let Some(channels) = staged.animations_mut() {
                        *channels = animations.clone();
                    }
                    let direction = if shunt_iteration.is_multiple_of(2) {
                        Direction::Down
                    } else {
                        Direction::Up
                    };
                    let Ok(next) = moves::apply(
                        &staged,
                        shunt,
                        &moves::MoveParams {
                            at: shunt_at,
                            direction: Some(direction),
                            distance: 0.25,
                        },
                    ) else {
                        break;
                    };
                    animations = next;
                    shunt_at += shunt_cadence;
                    shunt_iteration += 1;
                }
            }
            if animations != element.animations().cloned().unwrap_or_default()
                && let Some(channels) = element.animations_mut()
            {
                *channels = animations;
                changed = true;
            }
        }
    }
    changed
}

fn frozen_motion_eligible(element: &Element, move_id: &str) -> bool {
    element.is_authored()
        && element.transform().is_some()
        && element.fade_out() == MediaTime::ZERO
        && !matches!(element, Element::Audio(_))
        && !matches!(
            element.role(),
            Some(ElementRole::Chrome | ElementRole::Caption)
        )
        && (element.role() != Some(ElementRole::Ground) || move_id == "drift")
}

fn motion_eligible(element: &Element) -> bool {
    element.is_authored()
        && element.transform().is_some()
        && !matches!(element, Element::Audio(_))
        && !matches!(
            element.role(),
            Some(ElementRole::Ground | ElementRole::Chrome | ElementRole::Caption)
        )
}

fn lower_layout_candidates(project: &Project, report: &Report) -> Vec<Repair> {
    let Some(finding) = report
        .findings
        .iter()
        .find(|finding| finding.code == "bottom-dead")
    else {
        return Vec::new();
    };
    if !has_lower_layout_material(project) {
        return Vec::new();
    }
    [
        (0.72, 1.05),
        (0.74, 1.05),
        (0.76, 1.10),
        (0.78, 1.15),
    ]
        .into_iter()
        .filter_map(|(destination, growth)| {
            let mut candidate = project.clone();
            if !spread_beat_content(&mut candidate, destination, growth, true) {
                return None;
            }
            Repair::new(
                FindingTarget::from(finding),
                "beat-local subjects leave the lower composition structurally empty",
                format!(
                    "rescale and redistribute each beat's own subject at {destination:.2} with {growth:.2}x growth"
                ),
                replacement_commands(project, &candidate),
            )
            .ok()
        })
        .collect()
}

fn has_lower_layout_material(project: &Project) -> bool {
    project
        .active_scene()
        .elements()
        .filter(|element| motion_eligible(element) && !matches!(element, Element::Text(_)))
        .map(|element| (element.start(), element.end()))
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        >= 2
}

fn spread_beat_content(
    project: &mut Project,
    destination: f32,
    growth: f32,
    include_text: bool,
) -> bool {
    type BeatSpan = (MediaTime, MediaTime);
    type WeightedElement = (String, String, f32);
    let groups: BTreeMap<BeatSpan, Vec<WeightedElement>> = {
        let mut groups = BTreeMap::new();
        for track in project.active_scene().tracks.iter() {
            for element in &track.elements {
                if motion_eligible(element)
                    && element.transform().is_some()
                    && (include_text || !matches!(element, Element::Text(_)))
                {
                    groups
                        .entry((element.start(), element.end()))
                        .or_insert_with(Vec::new)
                        .push((
                            track.id.clone(),
                            element.id().to_owned(),
                            carry_weight(element),
                        ));
                }
            }
        }
        groups
    };
    let mut changed = false;
    for mut members in groups.into_values() {
        members.sort_by(|left, right| right.2.total_cmp(&left.2));
        for (index, (track_id, element_id, _)) in members.into_iter().take(3).enumerate() {
            let Some(element) = project
                .active_scene_mut()
                .tracks
                .track_mut(&track_id)
                .and_then(|track| track.element_mut(&element_id))
            else {
                continue;
            };
            let Some(before_transform) = element.transform() else {
                continue;
            };
            let mut transform = before_transform;
            if transform.y >= 0.72 {
                continue;
            }
            let slot = destination - index as f32 * 0.16;
            transform.y = slot.max(0.46);
            let member_growth = if index == 0 {
                growth
            } else {
                1.0 + (growth - 1.0) * 0.5
            };
            transform.scale *= member_growth;
            transform.scale_y *= member_growth.sqrt();
            contain(&mut transform);
            element.set_transform(transform);
            if let Some(animations) = element.animations_mut() {
                if let Some(channel) = animations.get_mut("y") {
                    let delta = transform.y - before_transform.y;
                    for key in &mut channel.keys {
                        key.value += delta;
                    }
                }
                if before_transform.scale.abs() > f32::EPSILON
                    && let Some(channel) = animations.get_mut("scale")
                {
                    let ratio = transform.scale / before_transform.scale;
                    for key in &mut channel.keys {
                        key.value *= ratio;
                    }
                }
                if before_transform.scale_y.abs() > f32::EPSILON
                    && let Some(channel) = animations.get_mut("scaleY")
                {
                    let ratio = transform.scale_y / before_transform.scale_y;
                    for key in &mut channel.keys {
                        key.value *= ratio;
                    }
                }
            }
            changed = true;
        }
    }
    changed
}

fn validate_local_layout(before: &Project, candidate: &Project) -> Result<(), String> {
    let timeline = candidate
        .active_scene()
        .elements()
        .map(Element::end)
        .max()
        .unwrap_or(MediaTime::ZERO);
    let mut spans = Vec::new();
    for element in candidate.active_scene().elements() {
        let Some(before_element) = before
            .active_scene()
            .elements()
            .find(|entry| entry.id() == element.id())
        else {
            continue;
        };
        let (Some(old), Some(new)) = (before_element.transform(), element.transform()) else {
            continue;
        };
        if new.y >= 0.72 && new.y > old.y + 0.01 && new.scale > old.scale {
            spans.push((element.start(), element.end()));
        }
    }
    spans.sort_unstable();
    spans.dedup();
    if spans.len() < 2 {
        return Err("lower-frame layout must be owned by multiple beat-local spans".into());
    }
    if spans
        .iter()
        .any(|(start, end)| (*end - *start).as_ticks() * 4 >= timeline.as_ticks() * 3)
    {
        return Err("a persistent element was parked and enlarged in the lower frame".into());
    }
    Ok(())
}

fn replacement_commands(before: &Project, after: &Project) -> Vec<Command> {
    let mut commands = Vec::new();
    for after_track in after.active_scene().tracks.iter() {
        let Some(before_track) = before.active_scene().tracks.track(&after_track.id) else {
            continue;
        };
        for after_element in &after_track.elements {
            if before_track.element(after_element.id()) != Some(after_element) {
                commands.push(Command::ReplaceElement {
                    reference: ElementRef::new(&after_track.id, after_element.id()),
                    element: after_element.clone(),
                });
            }
        }
    }
    commands
}

fn project_commands(before: &Project, after: &Project) -> Vec<Command> {
    let before_by_id: BTreeMap<&str, (&str, &Element)> = before
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| {
            track
                .elements
                .iter()
                .map(move |element| (element.id(), (track.id.as_str(), element)))
        })
        .collect();
    let after_by_id: BTreeMap<&str, (&str, &Element)> = after
        .active_scene()
        .tracks
        .iter()
        .flat_map(|track| {
            track
                .elements
                .iter()
                .map(move |element| (element.id(), (track.id.as_str(), element)))
        })
        .collect();
    let mut commands = Vec::new();
    for (id, (track_id, _)) in &before_by_id {
        if after_by_id
            .get(id)
            .is_none_or(|(after_track, _)| after_track != track_id)
        {
            commands.push(Command::RemoveElement {
                reference: ElementRef::new(*track_id, *id),
            });
        }
    }
    for (id, (track_id, element)) in after_by_id {
        match before_by_id.get(id) {
            Some((before_track, before_element)) if *before_track == track_id => {
                if *before_element != element {
                    commands.push(Command::ReplaceElement {
                        reference: ElementRef::new(track_id, id),
                        element: element.clone(),
                    });
                }
            }
            _ => commands.push(Command::AddElement {
                track_id: track_id.to_owned(),
                element: element.clone(),
                select: false,
            }),
        }
    }
    commands
}

fn contain(transform: &mut Transform) {
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

fn seconds(value: f64) -> MediaTime {
    MediaTime::from_seconds_f64(value).unwrap_or(MediaTime::ZERO)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FrameAssessment, LowerToCommands};
    use bay_agent::trust::{
        CriticSubmission, PanelEvidence, apply_critic_submission, record_render,
        refresh_obligations,
    };
    use bay_core::{Editor, Finding, Severity, check};
    use bay_project::{BlendMode, ElementSource, Marker, PlanStatus, ShapeElement, ShapeKind};

    fn empty_project() -> Project {
        let mut project = Project::starter();
        for track in project.active_scene_mut().tracks.iter_mut() {
            track.elements.clear();
        }
        project.active_scene_mut().markers.clear();
        project
    }

    fn shape(id: &str, start: f64, duration: f64, y: f32) -> Element {
        Element::Shape(ShapeElement {
            id: id.into(),
            name: id.into(),
            start: seconds(start),
            duration: seconds(duration),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: ShapeKind::Rect { radius: 0.0 },
            color: "#ffffff".into(),
            transform: Transform {
                x: 0.5,
                y,
                scale: 0.48,
                scale_x: 0.8,
                scale_y: 0.5,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: BlendMode::Normal,
            mask: None,
            source: ElementSource::Author,
            role: ElementRole::Data,
        })
    }

    fn report_with(project: &Project, code: &'static str, at: Option<f64>) -> Report {
        let mut report = check(project);
        if report.rollup.get(code).copied().unwrap_or_default() == 0 {
            let severity = bay_core::check::severity_of(code);
            report.findings.push(Finding {
                severity,
                code,
                message: "fixture".into(),
                element_id: None,
                track_id: None,
                at_seconds: at,
            });
            *report.rollup.entry(code).or_default() += 1;
            report.total += 1;
            match severity {
                Severity::Error => report.errors += 1,
                Severity::Warning => report.warnings += 1,
                Severity::Note => report.notes += 1,
            }
        }
        report
    }

    fn apply(project: Project, repair: &Repair) -> Project {
        let mut editor = Editor::new(project);
        for command in repair.lower_to_commands().iter().cloned() {
            assert!(editor.execute(command));
        }
        editor.project().clone()
    }

    fn converged(project: Project, repair: Repair) -> ConvergedCandidate {
        ConvergedCandidate {
            report: check(&project),
            project,
            repairs: vec![repair],
            rounds: 1,
        }
    }

    fn assert_no_count_rises(before: &Report, after: &Report) {
        for (code, count) in &after.rollup {
            assert!(
                *count <= before.rollup.get(code).copied().unwrap_or_default(),
                "{code} rose from {:?} to {count}: {:?}",
                before.rollup.get(code),
                after
                    .findings
                    .iter()
                    .filter(|finding| finding.code == *code)
                    .map(|finding| finding.message.as_str())
                    .collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn continuity_enumerates_each_legal_carry_and_clears_the_seam() {
        let mut project = empty_project();
        project.active_scene_mut().markers = vec![
            Marker {
                id: "beat-1".into(),
                time: MediaTime::ZERO,
                label: "hook".into(),
            },
            Marker {
                id: "beat-2".into(),
                time: seconds(2.0),
                label: "answer".into(),
            },
        ];
        project.active_scene_mut().tracks.main.elements = vec![
            shape("outgoing", 0.0, 2.0, 0.35),
            shape("incoming", 2.0, 2.0, 0.55),
        ];
        let before = check(&project);
        assert_eq!(before.rollup.get("broken-continuity").copied(), Some(1));

        let repairs = continuity_candidates(&project, &before);
        assert!(
            repairs.len() >= 4,
            "the per-seam carries remain available alongside any chain repair"
        );
        let carry = repairs
            .iter()
            .find(|repair| repair.intent.contains("carry the incumbent"))
            .expect("outgoing incumbent should be an enumerated carry");
        let candidate = apply(project, carry);
        let after = check(&candidate);

        assert_eq!(
            after
                .rollup
                .get("broken-continuity")
                .copied()
                .unwrap_or_default(),
            0
        );
        assert_no_count_rises(&before, &after);
        assert!(moves::histogram(candidate.active_scene()).contains_key("make-room"));
    }

    #[test]
    fn continuity_declines_a_lookalike_without_an_outgoing_incumbent() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.main.elements = vec![shape("incoming", 3.0, 1.0, 0.55)];
        let report = report_with(&project, "broken-continuity", Some(2.0));

        assert!(continuity_candidates(&project, &report).is_empty());
    }

    #[test]
    fn brief_a_outgoing_chain_clears_every_replacement_seam() {
        let project: Project = serde_json::from_str(include_str!(
            "../../../../research/final-acceptance/brief-a-2.project.json"
        ))
        .expect("decode Brief A corpus fixture");
        let before = check(&project);
        assert_eq!(
            before
                .rollup
                .get("broken-continuity")
                .copied()
                .unwrap_or_default(),
            8
        );
        let repair = continuity_candidates(&project, &before)
            .into_iter()
            .find(|repair| repair.intent.contains("outgoing subject"))
            .expect("Brief A needs a chain of beat-local outgoing transitions");
        let candidate = apply(project, &repair);
        let after = check(&candidate);

        assert_eq!(
            after
                .rollup
                .get("broken-continuity")
                .copied()
                .unwrap_or_default(),
            0
        );
        assert_no_count_rises(&before, &after);
        assert!(moves::histogram(candidate.active_scene()).contains_key("make-room"));
    }

    #[test]
    fn tournament_judge_registers_engine_verified_variants_and_critic_evidence() {
        let mut first = empty_project();
        first.active_scene_mut().tracks.main.elements = vec![shape("subject", 0.0, 2.0, 0.35)];
        let mut candidate = first.clone();
        let transform = Transform {
            y: 0.60,
            ..Transform::default()
        };
        candidate.active_scene_mut().tracks.main.elements[0].set_transform(transform);
        let repair = Repair::new(
            FindingTarget {
                code: "bottom-dead".into(),
                at_seconds: Some(0.0),
                track_id: None,
                element_id: None,
            },
            "the subject can carry the lower composition",
            "place the beat subject lower",
            vec![Command::ReplaceElement {
                reference: ElementRef::new("main", "subject"),
                element: candidate.active_scene().tracks.main.elements[0].clone(),
            }],
        )
        .expect("valid repair");
        let plan = PlanArtifact {
            id: "repair-plan".into(),
            brief: "test repair tournament".into(),
            format: "test".into(),
            target_runtime_seconds: 2.0,
            beats: Vec::new(),
            status: PlanStatus::Committed,
            critic: Default::default(),
            variants: Default::default(),
        };
        let compare = |_: &ConvergedCandidate,
                       _: &ConvergedCandidate,
                       plan: &mut PlanArtifact,
                       first_id: &str,
                       candidate_id: &str| {
            let model = serde_json::json!({"status": "clean", "findings": []});
            let frames = serde_json::json!({"status": "clean", "findings": []});
            record_render(
                plan,
                first_id,
                "research/final-acceptance/test-first.mov",
                &model,
                &frames,
            )?;
            record_render(
                plan,
                candidate_id,
                "research/final-acceptance/test-candidate.mov",
                &model,
                &frames,
            )?;
            Ok(CraftDecision::CandidateWins {
                reason: "the second repair has stronger hierarchy".into(),
            })
        };
        let assess = |_: &ConvergedCandidate, plan: &mut PlanArtifact, _: &str| {
            let panels = vec![
                PanelEvidence {
                    panel: 0,
                    beat_id: "beat-1".into(),
                    sample_time_seconds: 0.5,
                    content_hash: "old-a".into(),
                    icgs: vec![1],
                },
                PanelEvidence {
                    panel: 1,
                    beat_id: "beat-1".into(),
                    sample_time_seconds: 1.0,
                    content_hash: "old-b".into(),
                    icgs: vec![2],
                },
                PanelEvidence {
                    panel: 2,
                    beat_id: "beat-1".into(),
                    sample_time_seconds: 1.5,
                    content_hash: "old-c".into(),
                    icgs: vec![3],
                },
            ];
            apply_critic_submission(
                plan,
                &panels,
                &CriticSubmission {
                    weakest_panel: 0,
                    most_alike_pair: (0, 1),
                    thumbnail_panel: 2,
                    binaries: [true; 9],
                    rationale: "candidate has stronger hierarchy and continuity".into(),
                },
            )?;
            let current = panels
                .iter()
                .map(|panel| {
                    (
                        format!("{}@{:.6}", panel.beat_id, panel.sample_time_seconds),
                        (
                            format!("new-{}", panel.panel),
                            vec![10 + panel.panel as u16],
                        ),
                    )
                })
                .collect();
            assert_eq!(refresh_obligations(plan, &current), 3);
            Ok(())
        };
        let judge = TournamentJudge::new(plan, compare, assess);

        assert_eq!(
            judge
                .choose(&[
                    converged(first, repair.clone()),
                    converged(candidate, repair.clone()),
                ])
                .expect("pairwise winner also clears absolute panel judgement"),
            1
        );
        let plan = judge.into_plan();
        assert_eq!(plan.variants.candidates.len(), 2);
        assert_eq!(plan.variants.comparisons.len(), 1);
        assert_eq!(plan.critic.rounds_completed, 1);
        assert!(plan.critic.obligations.iter().all(|entry| entry.closed));
    }

    #[test]
    fn pairwise_winner_that_fails_absolute_panel_judgement_is_rejected() {
        let mut first = empty_project();
        first.active_scene_mut().tracks.main.elements = vec![shape("subject", 0.0, 2.0, 0.35)];
        let mut second = first.clone();
        second.active_scene_mut().tracks.main.elements[0].set_transform(Transform {
            y: 0.62,
            ..Transform::default()
        });
        let repair = Repair::new(
            FindingTarget {
                code: "bottom-dead".into(),
                at_seconds: Some(0.0),
                track_id: None,
                element_id: None,
            },
            "the beat needs a lower-frame subject",
            "redistribute the beat subject",
            vec![Command::ReplaceElement {
                reference: ElementRef::new("main", "subject"),
                element: second.active_scene().tracks.main.elements[0].clone(),
            }],
        )
        .expect("valid repair");
        let plan = PlanArtifact {
            id: "absolute-rejection-plan".into(),
            brief: "test absolute rejection".into(),
            format: "test".into(),
            target_runtime_seconds: 2.0,
            beats: Vec::new(),
            status: PlanStatus::Committed,
            critic: Default::default(),
            variants: Default::default(),
        };
        let compare = |_: &ConvergedCandidate,
                       _: &ConvergedCandidate,
                       plan: &mut PlanArtifact,
                       first_id: &str,
                       second_id: &str| {
            let model = serde_json::json!({"status": "clean", "findings": []});
            let frames = serde_json::json!({"status": "clean", "findings": []});
            record_render(
                plan,
                first_id,
                "research/final-acceptance/test-a.mov",
                &model,
                &frames,
            )?;
            record_render(
                plan,
                second_id,
                "research/final-acceptance/test-b.mov",
                &model,
                &frames,
            )?;
            Ok(CraftDecision::CandidateWins {
                reason: "the second candidate is better than the first".into(),
            })
        };
        let assess = |_: &ConvergedCandidate, plan: &mut PlanArtifact, _: &str| {
            let panels = vec![
                PanelEvidence {
                    panel: 0,
                    beat_id: "beat-1".into(),
                    sample_time_seconds: 0.5,
                    content_hash: "panel-a".into(),
                    icgs: vec![1],
                },
                PanelEvidence {
                    panel: 1,
                    beat_id: "beat-1".into(),
                    sample_time_seconds: 1.0,
                    content_hash: "panel-b".into(),
                    icgs: vec![2],
                },
                PanelEvidence {
                    panel: 2,
                    beat_id: "beat-1".into(),
                    sample_time_seconds: 1.5,
                    content_hash: "panel-c".into(),
                    icgs: vec![3],
                },
            ];
            apply_critic_submission(
                plan,
                &panels,
                &CriticSubmission {
                    weakest_panel: 0,
                    most_alike_pair: (0, 1),
                    thumbnail_panel: 2,
                    binaries: [false; 9],
                    rationale: "the winner is still flat and lacks a readable focal event".into(),
                },
            )?;
            Err("absolute panel judgement failed: the winner is not good on its own merits".into())
        };
        let judge = TournamentJudge::new(plan, compare, assess);

        let error = judge
            .choose(&[converged(first, repair.clone()), converged(second, repair)])
            .expect_err("pairwise victory must not bypass absolute craft judgement");

        assert!(error.contains("absolute panel judgement failed"));
        let plan = judge.into_plan();
        assert_eq!(plan.variants.comparisons.len(), 1);
        assert_eq!(plan.critic.rounds_completed, 1);
        assert!(plan.critic.obligations.iter().all(|entry| !entry.closed));
    }

    #[test]
    fn frozen_candidates_use_only_named_motion_and_preserve_code_counts() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.main.elements = vec![
            shape("first", 0.0, 4.0, 0.35),
            shape("second", 4.0, 4.0, 0.55),
        ];
        let report = report_with(&project, "frozen", Some(0.0));
        let before = check(&project);

        let repairs = frozen_candidates(&project, &report);
        assert_eq!(
            repairs.len(),
            2,
            "drift is five seconds long and is not legal on this four-second fixture"
        );
        for repair in repairs {
            let candidate = apply(project.clone(), &repair);
            let after = check(&candidate);
            assert_no_count_rises(&before, &after);
            assert!(
                moves::off_vocabulary(
                    candidate.active_scene(),
                    candidate.settings.fps.as_f64() as f32
                )
                .is_empty()
            );
        }
    }

    #[test]
    fn frozen_declines_clips_too_short_for_a_complete_named_move() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.main.elements = vec![shape("flash", 0.0, 0.1, 0.5)];
        let report = report_with(&project, "frozen", Some(0.0));

        assert!(frozen_candidates(&project, &report).is_empty());
    }

    #[test]
    fn bottom_layout_resizes_multiple_beat_local_subjects_with_rendered_margin() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.main.elements = vec![
            shape("first", 0.0, 2.0, 0.20),
            shape("second", 2.0, 2.0, 0.24),
        ];
        let report = report_with(&project, "bottom-dead", None);
        let before = check(&project);
        let repair = lower_layout_candidates(&project, &report)
            .into_iter()
            .next()
            .expect("layout candidate");
        let candidate = apply(project.clone(), &repair);
        let after = check(&candidate);
        let evaluation = RepairEvaluation::from_report_and_frames(
            after.clone(),
            &FrameAssessment {
                bottom_alive_share: Some(0.75),
                ..FrameAssessment::default()
            },
        );

        assert_eq!(
            candidate.active_scene().authored_elements().count(),
            project.active_scene().authored_elements().count()
        );
        assert_no_count_rises(&before, &after);
        JudgementOvershoot
            .validate(&repair, &project, &candidate, &evaluation)
            .expect("gate-measured margin and beat-local ownership");
    }

    #[test]
    fn bottom_layout_declines_subjects_already_composed_low() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.main.elements = vec![shape("low", 0.0, 2.0, 0.80)];
        let report = report_with(&project, "bottom-dead", None);

        assert!(lower_layout_candidates(&project, &report).is_empty());
    }

    #[test]
    fn bottom_layout_declines_a_persistent_scaffold_without_beat_local_visuals() {
        let mut project = empty_project();
        project.active_scene_mut().tracks.main.elements = vec![shape("scaffold", 0.0, 20.0, 0.35)];
        let report = report_with(&project, "bottom-dead", None);

        assert!(lower_layout_candidates(&project, &report).is_empty());
    }
}
