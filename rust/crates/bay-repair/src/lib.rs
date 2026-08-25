//! Headless repair proposals and the bounded harness that evaluates them.
//!
//! Diagnosis remains in `bay-core`; this crate only consumes findings and proposes existing
//! [`bay_core::Command`] values. Keeping those responsibilities in separate crates makes it
//! harder for a repair and its gate to be quietly tuned into agreement.

use std::collections::{BTreeMap, BTreeSet};

use bay_core::{Command, Editor, Finding, Project, Report, Severity};
use serde::{Deserialize, Serialize};

mod deterministic;
mod judgement;

pub use deterministic::{
    DeterministicOvershoot, DeterministicRepairs, FrameAssessment, FrameIssue, combine_reports,
};
pub use judgement::{
    CraftDecision, CraftJudge, JudgementOvershoot, JudgementRepairs, TournamentJudge,
};

/// A report plus comparable measurements for findings whose magnitude is observable.
///
/// The core report exposes mix and hook measurements. Pixel-backed frame measurements remain
/// separate from `bay-core`, so callers that ran `check_frames` attach them here rather than
/// discarding them when the finding lists are combined.
#[derive(Debug, Clone, PartialEq)]
pub struct RepairEvaluation {
    pub report: Report,
    magnitudes: BTreeMap<&'static str, f64>,
}

impl RepairEvaluation {
    pub fn from_report_and_frames(report: Report, frames: &FrameAssessment) -> Self {
        let mut evaluation = Self::from(report);
        if let Some(value) = frames.peak_anchor_sqrt_area {
            evaluation.magnitudes.insert("anchor-scale", value);
        }
        if let Some(value) = frames.bottom_alive_share {
            evaluation.magnitudes.insert("bottom-dead", value);
        }
        evaluation
    }

    /// Return the runtime measurement associated with a finding, when its evaluator supplied one.
    pub fn magnitude(&self, code: &str) -> Option<f64> {
        self.magnitudes.get(code).copied()
    }
}

impl From<Report> for RepairEvaluation {
    fn from(report: Report) -> Self {
        let mut magnitudes = BTreeMap::new();
        if let Some(value) = report.stats.mix.gap_bed_lufs {
            magnitudes.insert("bed-too-quiet", value);
        }
        if let Some(value) = report.stats.mix.separation_lu {
            magnitudes.insert("speech-masked", value);
        }
        Self { report, magnitudes }
    }
}

pub trait IntoRepairEvaluation {
    fn into_repair_evaluation(self) -> RepairEvaluation;
}

impl IntoRepairEvaluation for Report {
    fn into_repair_evaluation(self) -> RepairEvaluation {
        self.into()
    }
}

impl IntoRepairEvaluation for RepairEvaluation {
    fn into_repair_evaluation(self) -> RepairEvaluation {
        self
    }
}

/// The repair loop may never run more than this many proposal rounds.
pub const MAX_REPAIR_ROUNDS: usize = 5;

/// Maximum number of distinct repair paths explored before converged projects are judged.
///
/// Each path fixes its first proposal choice and then follows the ordinary bounded structural
/// loop. Three paths are enough to preserve alternatives at the highest-impact seam without
/// multiplying a five-round GPU evaluation into an open-ended search.
pub const MAX_REPAIR_PATHS: usize = 3;

/// The stable part of a finding that a repair receipt needs to retain.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingTarget {
    #[serde(default)]
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at_seconds: Option<f64>,
}

impl From<&Finding> for FindingTarget {
    fn from(finding: &Finding) -> Self {
        Self {
            code: finding.code.to_string(),
            element_id: finding.element_id.clone(),
            track_id: finding.track_id.clone(),
            at_seconds: finding.at_seconds,
        }
    }
}

/// A semantic editorial proposal expressed solely through the existing command vocabulary.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repair {
    #[serde(default)]
    pub target: FindingTarget,
    /// A short explanation suitable for an audit receipt.
    #[serde(default)]
    pub rationale: String,
    /// The human-recognisable editorial outcome, not a numeric gate target.
    #[serde(default)]
    pub intent: String,
    #[serde(default)]
    commands: Vec<Command>,
}

impl Repair {
    pub fn new(
        target: FindingTarget,
        rationale: impl Into<String>,
        intent: impl Into<String>,
        commands: Vec<Command>,
    ) -> Result<Self, String> {
        let rationale = rationale.into();
        let intent = intent.into();
        if target.code.trim().is_empty() {
            return Err("a repair must name the finding code it answers".into());
        }
        if rationale.trim().is_empty() {
            return Err("a repair must explain its rationale".into());
        }
        if intent.trim().is_empty() {
            return Err("a repair must state a semantic editorial intent".into());
        }
        if commands.is_empty() {
            return Err("a repair must lower to at least one existing command".into());
        }
        Ok(Self {
            target,
            rationale,
            intent,
            commands,
        })
    }
}

impl<'de> Deserialize<'de> for Repair {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct WireRepair {
            #[serde(default)]
            target: FindingTarget,
            #[serde(default)]
            rationale: String,
            #[serde(default)]
            intent: String,
            #[serde(default)]
            commands: Vec<Command>,
        }

        let wire = WireRepair::deserialize(deserializer)?;
        Repair::new(wire.target, wire.rationale, wire.intent, wire.commands)
            .map_err(serde::de::Error::custom)
    }
}

/// The only mutation path exposed by a repair.
pub trait LowerToCommands {
    fn lower_to_commands(&self) -> &[Command];
}

impl LowerToCommands for Repair {
    fn lower_to_commands(&self) -> &[Command] {
        &self.commands
    }
}

/// Produces proposals for the current project and report.
pub trait RepairPlanner {
    fn plan(&self, project: &Project, report: &Report) -> Vec<Repair>;
}

impl<F> RepairPlanner for F
where
    F: Fn(&Project, &Report) -> Vec<Repair>,
{
    fn plan(&self, project: &Project, report: &Report) -> Vec<Repair> {
        self(project, report)
    }
}

/// Phase 1's deliberately empty registry.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoRepairs;

impl RepairPlanner for NoRepairs {
    fn plan(&self, _project: &Project, _report: &Report) -> Vec<Repair> {
        Vec::new()
    }
}

/// Semantic margin check run against every mutated candidate before it may be accepted.
///
/// The harness deliberately knows no gate values. Phase 2 strategies must supply a validator
/// that measures whether the proposed editorial result clears its fixture by a meaningful
/// margin. Keeping that measurement behind this hook lets strategy tests know thresholds while
/// preventing production repair code from searching toward them.
pub trait OvershootGuard {
    fn validate(
        &self,
        repair: &Repair,
        before: &Project,
        candidate: &Project,
        evaluation: &RepairEvaluation,
    ) -> Result<(), String>;
}

impl<F> OvershootGuard for F
where
    F: Fn(&Repair, &Project, &Project, &RepairEvaluation) -> Result<(), String>,
{
    fn validate(
        &self,
        repair: &Repair,
        before: &Project,
        candidate: &Project,
        evaluation: &RepairEvaluation,
    ) -> Result<(), String> {
        self(repair, before, candidate, evaluation)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Termination {
    Converged,
    CriticRejected,
    NoRepairs,
    NoProgress,
    CycleDetected,
    IterationLimit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttemptDisposition {
    Accepted,
    RevertedNoMutation,
    RevertedNoProgress,
    RevertedNewCodes,
    RevertedFindingRegression,
    RevertedOvershoot,
    RevertedCritic,
    RevertedCycle,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub round: usize,
    pub repair: Repair,
    pub disposition: AttemptDisposition,
    pub before_errors: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_errors: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub new_codes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub regressed_codes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unrepairable {
    pub target: FindingTarget,
    pub reason: String,
}

/// Honest result of a repair run, including every attempted proposal and all remaining blockers.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    pub project: Project,
    pub report: Report,
    pub termination: Termination,
    pub rounds: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attempts: Vec<Attempt>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unrepairable: Vec<Unrepairable>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remaining_findings: Vec<FindingTarget>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub remaining_error_codes: BTreeMap<String, usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judgement: Option<JudgementReceipt>,
}

/// A globally clean project and the structural path that produced it.
#[derive(Debug, Clone, PartialEq)]
pub struct ConvergedCandidate {
    pub project: Project,
    pub report: Report,
    pub repairs: Vec<Repair>,
    pub rounds: usize,
}

/// Auditable outcome of the convergence-time craft judgement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgementReceipt {
    pub contenders: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner: Option<usize>,
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn blocking_finding_count(report: &Report) -> usize {
    report
        .rollup
        .iter()
        .filter(|(code, _)| is_blocking_code(code))
        .map(|(_, count)| *count)
        .sum()
}

fn is_blocking_code(code: &str) -> bool {
    bay_core::check::severity_of(code) == Severity::Error
        || matches!(
            code,
            "text-collision" | "anchor-scale" | "bottom-dead" | "frozen"
        )
}

/// Apply proposals through [`Editor`], re-check each candidate, and keep only strict progress.
pub fn run_repair_loop<P, G, C, E>(
    project: Project,
    evaluation: E,
    planner: &P,
    overshoot: &G,
    recheck: C,
) -> RepairResult
where
    P: RepairPlanner,
    G: OvershootGuard,
    C: Fn(&Project) -> E,
    E: IntoRepairEvaluation,
{
    run_repair_loop_inner(project, evaluation, planner, overshoot, recheck)
}

/// Explore a bounded set of structural repair paths, then judge only globally clean results.
///
/// Mid-loop candidates are accepted solely by the structural rules in [`run_repair_loop`].
/// Distinct converged projects are ranked by the judge and its winner must pass absolute craft
/// judgement. If judgement fails, the original project is returned with
/// [`Termination::CriticRejected`], so an unjudged clean candidate cannot be mistaken for a
/// shippable result.
pub fn run_judged_repair_loop<P, G, C, E, J>(
    project: Project,
    evaluation: E,
    planner: &P,
    overshoot: &G,
    recheck: C,
    judge: &J,
) -> RepairResult
where
    P: RepairPlanner,
    G: OvershootGuard,
    C: Fn(&Project) -> E,
    E: IntoRepairEvaluation,
    J: CraftJudge,
{
    let evaluation = evaluation.into_repair_evaluation();
    let original_project = project.clone();
    let original_report = evaluation.report.clone();
    let initial_proposals = if blocking_finding_count(&original_report) == 0 {
        0
    } else {
        planner.plan(&project, &original_report).len()
    };
    let path_count = initial_proposals.clamp(1, MAX_REPAIR_PATHS);
    let mut results = Vec::with_capacity(path_count);

    for first_choice in 0..path_count {
        let first_round = std::cell::Cell::new(true);
        let path_planner = |candidate: &Project, report: &Report| {
            let proposals = planner.plan(candidate, report);
            if first_round.replace(false) {
                proposals
                    .into_iter()
                    .nth(first_choice)
                    .into_iter()
                    .collect()
            } else {
                proposals
            }
        };
        results.push(run_repair_loop(
            project.clone(),
            evaluation.clone(),
            &path_planner,
            overshoot,
            |candidate| recheck(candidate).into_repair_evaluation(),
        ));
    }

    let mut converged = Vec::<(ConvergedCandidate, RepairResult)>::new();
    let mut converged_hashes = BTreeSet::new();
    for result in results.iter().filter(|result| {
        result.termination == Termination::Converged && blocking_finding_count(&result.report) == 0
    }) {
        let hash = bay_project::project_hash(&result.project);
        if !converged_hashes.insert(hash) {
            continue;
        }
        let repairs = result
            .attempts
            .iter()
            .filter(|attempt| attempt.disposition == AttemptDisposition::Accepted)
            .map(|attempt| attempt.repair.clone())
            .collect();
        converged.push((
            ConvergedCandidate {
                project: result.project.clone(),
                report: result.report.clone(),
                repairs,
                rounds: result.rounds,
            },
            result.clone(),
        ));
    }

    if converged.is_empty() {
        return results
            .into_iter()
            .min_by_key(|result| blocking_finding_count(&result.report))
            .unwrap_or_else(|| {
                finish(
                    original_project,
                    original_report,
                    Termination::NoRepairs,
                    0,
                    Vec::new(),
                    Vec::new(),
                )
            });
    }

    let candidates: Vec<_> = converged
        .iter()
        .map(|(candidate, _)| candidate.clone())
        .collect();
    match judge.choose(&candidates) {
        Ok(winner) if winner < converged.len() => {
            let mut result = converged.swap_remove(winner).1;
            result.judgement = Some(JudgementReceipt {
                contenders: candidates.len(),
                winner: Some(winner),
                accepted: true,
                reason: None,
            });
            result
        }
        decision => {
            let reason = match decision {
                Ok(winner) => {
                    format!("held-out critic returned winner {winner} outside the survivor set")
                }
                Err(reason) => reason,
            };
            let mut result = finish(
                original_project,
                original_report,
                Termination::CriticRejected,
                converged
                    .iter()
                    .map(|(_, result)| result.rounds)
                    .max()
                    .unwrap_or_default(),
                Vec::new(),
                Vec::new(),
            );
            result.judgement = Some(JudgementReceipt {
                contenders: candidates.len(),
                winner: None,
                accepted: false,
                reason: Some(reason),
            });
            result
        }
    }
}

fn run_repair_loop_inner<P, G, C, E>(
    mut project: Project,
    evaluation: E,
    planner: &P,
    overshoot: &G,
    recheck: C,
) -> RepairResult
where
    P: RepairPlanner,
    G: OvershootGuard,
    C: Fn(&Project) -> E,
    E: IntoRepairEvaluation,
{
    let RepairEvaluation {
        mut report,
        magnitudes: mut finding_magnitudes,
    } = evaluation.into_repair_evaluation();
    if blocking_finding_count(&report) == 0 {
        return finish(
            project,
            report,
            Termination::Converged,
            0,
            Vec::new(),
            Vec::new(),
        );
    }

    let mut seen = BTreeSet::from([bay_project::project_hash(&project)]);
    let mut attempts = Vec::new();
    let mut unrepairable = Vec::new();

    for round in 1..=MAX_REPAIR_ROUNDS {
        let proposals = planner.plan(&project, &report);
        if proposals.is_empty() {
            return finish(
                project,
                report,
                Termination::NoRepairs,
                round - 1,
                attempts,
                unrepairable,
            );
        }

        let mut accepted = false;
        for repair in proposals {
            let before_errors = blocking_finding_count(&report);
            let before_project = project.clone();
            let mut editor = Editor::new(before_project.clone());
            let mut mutated = false;
            for command in repair.lower_to_commands().iter().cloned() {
                mutated = editor.execute(command) || mutated;
            }

            if !mutated {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedNoMutation,
                    before_errors,
                    None,
                    Vec::new(),
                    Vec::new(),
                    "the proposed commands made no project change".into(),
                );
                continue;
            }

            let candidate = editor.project().clone();
            let candidate_hash = bay_project::project_hash(&candidate);
            if seen.contains(&candidate_hash) {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedCycle,
                    before_errors,
                    None,
                    Vec::new(),
                    Vec::new(),
                    "the candidate repeats a project state already visited".into(),
                );
                return finish(
                    project,
                    report,
                    Termination::CycleDetected,
                    round,
                    attempts,
                    unrepairable,
                );
            }

            let candidate_evaluation = recheck(&candidate).into_repair_evaluation();
            if let Err(reason) =
                overshoot.validate(&repair, &before_project, &candidate, &candidate_evaluation)
            {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedOvershoot,
                    before_errors,
                    None,
                    Vec::new(),
                    Vec::new(),
                    reason,
                );
                continue;
            }

            let RepairEvaluation {
                report: candidate_report,
                magnitudes: candidate_magnitudes,
            } = candidate_evaluation;
            let new_codes = added_codes(&report, &candidate_report);
            if !new_codes.is_empty() {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedNewCodes,
                    before_errors,
                    Some(blocking_finding_count(&candidate_report)),
                    new_codes,
                    Vec::new(),
                    "the candidate introduced finding codes absent from the baseline".into(),
                );
                continue;
            }

            let regressed_codes = increased_codes(&report, &candidate_report);
            if !regressed_codes.is_empty() {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedFindingRegression,
                    before_errors,
                    Some(blocking_finding_count(&candidate_report)),
                    Vec::new(),
                    regressed_codes,
                    "the candidate increased one or more existing finding counts".into(),
                );
                continue;
            }

            let regressed_codes = worsened_persisting_magnitudes(
                &report,
                &candidate_report,
                &finding_magnitudes,
                &candidate_magnitudes,
            );
            if !regressed_codes.is_empty() {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedFindingRegression,
                    before_errors,
                    Some(blocking_finding_count(&candidate_report)),
                    Vec::new(),
                    regressed_codes,
                    "the candidate worsened a measured finding that still persists".into(),
                );
                continue;
            }

            let candidate_errors = blocking_finding_count(&candidate_report);
            let before_target_count = report
                .rollup
                .get(repair.target.code.as_str())
                .copied()
                .unwrap_or_default();
            let candidate_target_count = candidate_report
                .rollup
                .get(repair.target.code.as_str())
                .copied()
                .unwrap_or_default();
            if candidate_errors > before_errors || candidate_target_count >= before_target_count {
                reject(
                    &mut attempts,
                    &mut unrepairable,
                    round,
                    repair,
                    AttemptDisposition::RevertedNoProgress,
                    before_errors,
                    Some(candidate_errors),
                    Vec::new(),
                    Vec::new(),
                    "the candidate did not strictly reduce its targeted finding".into(),
                );
                continue;
            }

            attempts.push(Attempt {
                round,
                repair,
                disposition: AttemptDisposition::Accepted,
                before_errors,
                candidate_errors: Some(candidate_errors),
                new_codes: Vec::new(),
                regressed_codes: Vec::new(),
                reason: None,
            });
            seen.insert(candidate_hash);
            project = candidate;
            report = candidate_report;
            finding_magnitudes = candidate_magnitudes;
            accepted = true;
            break;
        }

        if !accepted {
            return finish(
                project,
                report,
                Termination::NoProgress,
                round,
                attempts,
                unrepairable,
            );
        }
        if blocking_finding_count(&report) == 0 {
            return finish(
                project,
                report,
                Termination::Converged,
                round,
                attempts,
                unrepairable,
            );
        }
    }

    finish(
        project,
        report,
        Termination::IterationLimit,
        MAX_REPAIR_ROUNDS,
        attempts,
        unrepairable,
    )
}

fn added_codes(before: &Report, after: &Report) -> Vec<String> {
    let before: BTreeSet<&str> = before.rollup.keys().copied().collect();
    after
        .rollup
        .keys()
        .copied()
        .filter(|code| !before.contains(code))
        .map(str::to_string)
        .collect()
}

fn increased_codes(before: &Report, after: &Report) -> Vec<String> {
    after
        .rollup
        .iter()
        .filter(|(code, count)| **count > before.rollup.get(*code).copied().unwrap_or_default())
        .map(|(code, _)| (*code).to_string())
        .collect()
}

fn worsened_persisting_magnitudes(
    before: &Report,
    after: &Report,
    before_magnitudes: &BTreeMap<&'static str, f64>,
    after_magnitudes: &BTreeMap<&'static str, f64>,
) -> Vec<String> {
    before_magnitudes
        .iter()
        .filter(|(code, before_value)| {
            before.rollup.get(*code).copied().unwrap_or_default() > 0
                && after.rollup.get(*code).copied().unwrap_or_default() > 0
                && after_magnitudes
                    .get(*code)
                    .is_none_or(|after_value| *after_value + f64::EPSILON < **before_value)
        })
        .map(|(code, _)| (*code).to_string())
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn reject(
    attempts: &mut Vec<Attempt>,
    unrepairable: &mut Vec<Unrepairable>,
    round: usize,
    repair: Repair,
    disposition: AttemptDisposition,
    before_errors: usize,
    candidate_errors: Option<usize>,
    new_codes: Vec<String>,
    regressed_codes: Vec<String>,
    reason: String,
) {
    unrepairable.push(Unrepairable {
        target: repair.target.clone(),
        reason: reason.clone(),
    });
    attempts.push(Attempt {
        round,
        repair,
        disposition,
        before_errors,
        candidate_errors,
        new_codes,
        regressed_codes,
        reason: Some(reason),
    });
}

fn finish(
    project: Project,
    report: Report,
    termination: Termination,
    rounds: usize,
    attempts: Vec<Attempt>,
    unrepairable: Vec<Unrepairable>,
) -> RepairResult {
    let remaining_findings = report
        .findings
        .iter()
        .filter(|finding| is_blocking_code(finding.code))
        .map(FindingTarget::from)
        .collect();
    let remaining_error_codes = report
        .rollup
        .iter()
        .filter(|(code, _)| is_blocking_code(code))
        .map(|(code, count)| ((*code).to_string(), *count))
        .collect();
    RepairResult {
        project,
        report,
        termination,
        rounds,
        attempts,
        unrepairable,
        remaining_findings,
        remaining_error_codes,
        judgement: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bay_core::{
        Element, ElementRef, MediaTime, Transform, check,
        project::{ElementSource, ShapeElement, ShapeKind},
    };

    fn shape(id: &str, duration_ticks: i64) -> Element {
        Element::Shape(ShapeElement {
            id: id.into(),
            name: id.into(),
            start: MediaTime::ZERO,
            duration: MediaTime::from_ticks(duration_ticks),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            shape: ShapeKind::default(),
            color: "#ffffff".into(),
            gradient: None,
            stroke: None,
            transform: Transform {
                scale: 0.1,
                scale_x: 0.1,
                scale_y: 0.1,
                ..Transform::default()
            },
            effects: Vec::new(),
            animations: Default::default(),
            blend_mode: Default::default(),
            mask: None,
            source: ElementSource::Author,
            role: Default::default(),
        })
    }

    fn project_with_zero_length_shapes(count: usize) -> Project {
        let mut project = Project::starter();
        let mut elements = vec![shape("baseline", 120_000)];
        elements.extend((0..count).map(|index| {
            let mut element = shape(&format!("shape-{index}"), 0);
            element.set_start(MediaTime::from_ticks((index as i64 + 1) * 120_000));
            element
        }));
        project.active_scene_mut().tracks.main.elements = elements;
        project
    }

    fn target(report: &Report, code: &str) -> FindingTarget {
        report
            .findings
            .iter()
            .find(|finding| finding.code == code)
            .map(FindingTarget::from)
            .expect("fixture should contain the target finding")
    }

    fn duration_repair(report: &Report, element_id: &str, ticks: i64) -> Repair {
        let target = target(report, "zero-length");
        let track_id = target
            .track_id
            .clone()
            .expect("zero-length finding should identify its track");
        Repair::new(
            target,
            "test-only duration mutation proves command lowering",
            "give the fixture visible timeline presence",
            vec![Command::SetElementDuration {
                reference: ElementRef::new(track_id, element_id),
                duration: MediaTime::from_ticks(ticks),
            }],
        )
        .expect("valid test repair")
    }

    fn allow_test_overshoot(
        _: &Repair,
        _: &Project,
        _: &Project,
        _: &RepairEvaluation,
    ) -> Result<(), String> {
        Ok(())
    }

    fn zero_length_report(project: &Project) -> Report {
        let mut report = check(project);
        report
            .findings
            .retain(|finding| finding.code == "zero-length");
        report.rollup.retain(|code, _| *code == "zero-length");
        report.errors = report.findings.len();
        report.warnings = 0;
        report.notes = 0;
        report.total = report.errors;
        report.status = if report.errors == 0 {
            bay_core::check::Status::Clean
        } else {
            bay_core::check::Status::Findings
        };
        report
    }

    #[test]
    fn repair_round_trips_and_lowers_only_to_commands() {
        let project = project_with_zero_length_shapes(1);
        let report = check(&project);
        let repair = duration_repair(&report, "shape-0", 120_000);

        let json = serde_json::to_string(&repair).expect("serialize");
        let decoded: Repair = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(decoded, repair);
        assert!(matches!(
            decoded.lower_to_commands(),
            [Command::SetElementDuration { .. }]
        ));
        let empty_commands = serde_json::json!({
            "target": {"code": "zero-length"},
            "rationale": "invalid fixture",
            "intent": "invalid fixture",
            "commands": []
        });
        assert!(
            serde_json::from_value::<Repair>(empty_commands).is_err(),
            "deserialization must preserve the one-or-more-command invariant"
        );
    }

    #[test]
    fn no_registered_repairs_is_an_honest_immediate_no_op() {
        let project = Project::starter();
        let report = check(&project);
        let original_hash = bay_project::project_hash(&project);

        let result = run_repair_loop(project, report, &NoRepairs, &allow_test_overshoot, check);

        assert_eq!(result.termination, Termination::NoRepairs);
        assert_eq!(result.rounds, 0);
        assert!(result.attempts.is_empty());
        assert!(!result.remaining_findings.is_empty());
        assert_eq!(bay_project::project_hash(&result.project), original_hash);
    }

    #[test]
    fn hard_cap_stops_after_five_strictly_improving_rounds() {
        let project = project_with_zero_length_shapes(6);
        let report = check(&project);
        let planner = |project: &Project, report: &Report| {
            project
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|element| element.duration() == MediaTime::ZERO)
                .map(|element| vec![duration_repair(report, element.id(), 120_000)])
                .unwrap_or_default()
        };

        let result = run_repair_loop(project, report, &planner, &allow_test_overshoot, check);

        assert_eq!(result.termination, Termination::IterationLimit);
        assert_eq!(result.rounds, MAX_REPAIR_ROUNDS);
        assert_eq!(
            result
                .attempts
                .iter()
                .filter(|attempt| attempt.disposition == AttemptDisposition::Accepted)
                .count(),
            MAX_REPAIR_ROUNDS
        );
        assert!(result.report.errors > 0);
        assert!(result.attempts.iter().all(|attempt| {
            attempt
                .candidate_errors
                .is_some_and(|after| after < attempt.before_errors)
        }));
    }

    #[test]
    fn repeated_project_hash_stops_an_oscillation() {
        let project = project_with_zero_length_shapes(2);
        let report = check(&project);
        let report_template = report.clone();
        let initial_zero_length = report
            .rollup
            .get("zero-length")
            .copied()
            .unwrap_or_default();
        let planner = |project: &Project, report: &Report| {
            let first = &project.active_scene().tracks.main.elements[1];
            let ticks = if first.duration() == MediaTime::ZERO {
                120_000
            } else {
                0
            };
            vec![duration_repair(report, first.id(), ticks)]
        };
        let recheck = move |candidate: &Project| {
            let zero_length = candidate
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .filter(|element| element.duration() == MediaTime::ZERO)
                .count();
            let mut candidate_report = report_template.clone();
            candidate_report.rollup.insert("zero-length", zero_length);
            candidate_report.errors = candidate_report.errors - initial_zero_length + zero_length;
            candidate_report.total = candidate_report.total - initial_zero_length + zero_length;
            candidate_report
        };

        let result = run_repair_loop(project, report, &planner, &allow_test_overshoot, recheck);

        assert_eq!(result.termination, Termination::CycleDetected);
        assert_eq!(result.rounds, 2);
        assert_eq!(
            result.attempts.last().map(|attempt| &attempt.disposition),
            Some(&AttemptDisposition::RevertedCycle)
        );
        assert!(!result.unrepairable.is_empty());
    }

    #[test]
    fn introducing_a_new_code_reverts_the_whole_repair() {
        let project = project_with_zero_length_shapes(1);
        let report = check(&project);
        let original_hash = bay_project::project_hash(&project);
        let finding_target = target(&report, "zero-length");
        let track_id = finding_target
            .track_id
            .clone()
            .expect("zero-length finding should identify its track");
        let repair = Repair::new(
            finding_target,
            "test-only compound mutation trades one defect for another",
            "make the fixture visible but deliberately misplace it",
            vec![
                Command::SetElementDuration {
                    reference: ElementRef::new(track_id.clone(), "shape-0"),
                    duration: MediaTime::from_ticks(120_000),
                },
                Command::SetTransform {
                    reference: ElementRef::new(track_id, "shape-0"),
                    transform: Transform {
                        x: 2.0,
                        ..Transform::default()
                    },
                },
            ],
        )
        .expect("valid test repair");
        let planner = move |_: &Project, _: &Report| vec![repair.clone()];

        let result = run_repair_loop(project, report, &planner, &allow_test_overshoot, check);

        assert_eq!(result.termination, Termination::NoProgress);
        assert_eq!(
            result.attempts[0].disposition,
            AttemptDisposition::RevertedNewCodes
        );
        assert!(
            result.attempts[0]
                .new_codes
                .iter()
                .any(|code| code == "off-canvas")
        );
        assert_eq!(bay_project::project_hash(&result.project), original_hash);
        assert_eq!(result.unrepairable[0].target.code, "zero-length");
    }

    #[test]
    fn increasing_an_existing_warning_count_reverts_the_whole_repair() {
        let project = project_with_zero_length_shapes(2);
        let mut report = check(&project);
        let original_hash = bay_project::project_hash(&project);
        report.rollup.insert("off-grid", 1);
        report.warnings += 1;
        report.total += 1;
        let repair = duration_repair(&report, "shape-0", 120_000);
        let planner = move |_: &Project, _: &Report| vec![repair.clone()];
        let candidate_template = report.clone();
        let recheck = move |_: &Project| {
            let mut candidate_report = candidate_template.clone();
            candidate_report.rollup.insert("zero-length", 1);
            candidate_report.errors -= 1;
            candidate_report.total -= 1;
            candidate_report.rollup.insert("off-grid", 2);
            candidate_report.warnings += 1;
            candidate_report.total += 1;
            candidate_report
        };

        let result = run_repair_loop(project, report, &planner, &allow_test_overshoot, recheck);

        assert_eq!(result.termination, Termination::NoProgress);
        assert_eq!(
            result.attempts[0].disposition,
            AttemptDisposition::RevertedFindingRegression
        );
        assert_eq!(result.attempts[0].regressed_codes, ["off-grid"]);
        assert_eq!(bay_project::project_hash(&result.project), original_hash);
    }

    #[test]
    fn worsening_a_persisting_measured_finding_reverts_the_whole_repair() {
        let project = project_with_zero_length_shapes(2);
        let mut report = check(&project);
        let original_hash = bay_project::project_hash(&project);
        report.rollup.insert("bottom-dead", 1);
        report.errors += 1;
        report.total += 1;
        let repair = duration_repair(&report, "shape-0", 120_000);
        let planner = move |_: &Project, _: &Report| vec![repair.clone()];
        let candidate_template = report.clone();
        let evaluation = RepairEvaluation::from_report_and_frames(
            report,
            &FrameAssessment {
                bottom_alive_share: Some(0.20),
                ..FrameAssessment::default()
            },
        );
        let recheck = move |_: &Project| {
            let mut candidate_report = candidate_template.clone();
            candidate_report.rollup.insert("zero-length", 1);
            candidate_report.errors -= 1;
            candidate_report.total -= 1;
            RepairEvaluation::from_report_and_frames(
                candidate_report,
                &FrameAssessment {
                    bottom_alive_share: Some(0.10),
                    ..FrameAssessment::default()
                },
            )
        };

        let result = run_repair_loop(
            project,
            evaluation,
            &planner,
            &allow_test_overshoot,
            recheck,
        );

        assert_eq!(result.termination, Termination::NoProgress);
        assert_eq!(
            result.attempts[0].disposition,
            AttemptDisposition::RevertedFindingRegression
        );
        assert_eq!(result.attempts[0].regressed_codes, ["bottom-dead"]);
        assert_eq!(bay_project::project_hash(&result.project), original_hash);
    }

    #[test]
    fn failed_overshoot_guard_reverts_an_otherwise_improving_candidate() {
        let project = project_with_zero_length_shapes(1);
        let report = check(&project);
        let original_hash = bay_project::project_hash(&project);
        let repair = duration_repair(&report, "shape-0", 120_000);
        let planner = move |_: &Project, _: &Report| vec![repair.clone()];
        let reject_margin = |_: &Repair, _: &Project, _: &Project, _: &RepairEvaluation| {
            Err("fixture landed too close to its acceptance boundary".into())
        };

        let result = run_repair_loop(project, report, &planner, &reject_margin, check);

        assert_eq!(result.termination, Termination::NoProgress);
        assert_eq!(
            result.attempts[0].disposition,
            AttemptDisposition::RevertedOvershoot
        );
        assert_eq!(bay_project::project_hash(&result.project), original_hash);
    }

    #[test]
    fn findings_clean_candidate_that_loses_pairwise_critic_is_rejected() {
        struct RejectingJudge;
        impl CraftJudge for RejectingJudge {
            fn choose(&self, candidates: &[ConvergedCandidate]) -> Result<usize, String> {
                assert_eq!(candidates.len(), 1);
                assert_eq!(candidates[0].report.errors, 0);
                Err("absolute panel evidence is missing or unacceptable".into())
            }
        }

        let project = project_with_zero_length_shapes(1);
        let report = check(&project);
        let original_hash = bay_project::project_hash(&project);
        let repair = duration_repair(&report, "shape-0", 120_000);
        let planner = move |_: &Project, _: &Report| vec![repair.clone()];
        let clean_template = report.clone();
        let recheck = move |_: &Project| {
            let mut clean = clean_template.clone();
            clean.status = bay_core::check::Status::Clean;
            clean.findings.clear();
            clean.rollup.clear();
            clean.errors = 0;
            clean.warnings = 0;
            clean.notes = 0;
            clean.total = 0;
            clean
        };
        let result = run_judged_repair_loop(
            project,
            report,
            &planner,
            &allow_test_overshoot,
            recheck,
            &RejectingJudge,
        );

        assert_eq!(result.termination, Termination::CriticRejected);
        assert_eq!(
            result.judgement,
            Some(JudgementReceipt {
                contenders: 1,
                winner: None,
                accepted: false,
                reason: Some("absolute panel evidence is missing or unacceptable".into()),
            })
        );
        assert_eq!(bay_project::project_hash(&result.project), original_hash);
    }

    #[test]
    fn tournament_is_invoked_only_after_a_path_is_globally_clean() {
        struct CleanOnlyJudge(std::cell::Cell<usize>);
        impl CraftJudge for CleanOnlyJudge {
            fn choose(&self, candidates: &[ConvergedCandidate]) -> Result<usize, String> {
                self.0.set(self.0.get() + 1);
                assert_eq!(candidates.len(), 1);
                assert_eq!(candidates[0].report.errors, 0);
                assert!(candidates[0].report.rollup.is_empty());
                assert_eq!(candidates[0].repairs.len(), 2);
                Ok(0)
            }
        }

        let project = project_with_zero_length_shapes(2);
        let report = zero_length_report(&project);
        let planner = |project: &Project, report: &Report| {
            project
                .active_scene()
                .tracks
                .main
                .elements
                .iter()
                .find(|element| element.duration() == MediaTime::ZERO)
                .map(|element| vec![duration_repair(report, element.id(), 120_000)])
                .unwrap_or_default()
        };
        let judge = CleanOnlyJudge(std::cell::Cell::new(0));

        let result = run_judged_repair_loop(
            project,
            report,
            &planner,
            &allow_test_overshoot,
            zero_length_report,
            &judge,
        );

        assert_eq!(result.termination, Termination::Converged);
        assert_eq!(result.rounds, 2);
        assert_eq!(judge.0.get(), 1, "judge runs once, after convergence");
    }

    #[test]
    fn several_converged_paths_carry_the_ranked_winner_forward() {
        struct LongerHoldWins;
        impl CraftJudge for LongerHoldWins {
            fn choose(&self, candidates: &[ConvergedCandidate]) -> Result<usize, String> {
                assert_eq!(candidates.len(), 2);
                candidates
                    .iter()
                    .position(|candidate| {
                        candidate.project.active_scene().tracks.main.elements[1].duration()
                            == MediaTime::from_ticks(240_000)
                    })
                    .ok_or_else(|| "expected the longer converged hold".into())
            }
        }

        let project = project_with_zero_length_shapes(1);
        let report = zero_length_report(&project);
        let planner = |project: &Project, report: &Report| {
            if project.active_scene().tracks.main.elements[1].duration() != MediaTime::ZERO {
                return Vec::new();
            }
            vec![
                duration_repair(report, "shape-0", 120_000),
                duration_repair(report, "shape-0", 240_000),
            ]
        };

        let result = run_judged_repair_loop(
            project,
            report,
            &planner,
            &allow_test_overshoot,
            zero_length_report,
            &LongerHoldWins,
        );

        assert_eq!(result.termination, Termination::Converged);
        assert_eq!(
            result.project.active_scene().tracks.main.elements[1].duration(),
            MediaTime::from_ticks(240_000)
        );
        assert_eq!(
            result.judgement,
            Some(JudgementReceipt {
                contenders: 2,
                winner: Some(1),
                accepted: true,
                reason: None,
            })
        );
    }

    #[test]
    fn repair_source_cannot_reference_gate_constants() {
        // Deliberate anti-Goodhart boundary: a repair may express an editorial intent, but may
        // not read a gate's numeric floor and search toward it. Extracting every constant name
        // from the diagnosis module makes this test fail if a future contributor imports one,
        // even if that constant is later made public.
        let check_source = include_str!("../../bay-core/src/check.rs");
        let gate_constant_names: Vec<&str> = check_source
            .lines()
            .filter_map(|line| {
                let line = line.trim_start();
                let declaration = line
                    .strip_prefix("const ")
                    .or_else(|| line.strip_prefix("pub const "))?;
                declaration
                    .split(|character: char| character == ':' || character.is_whitespace())
                    .next()
            })
            .collect();
        let source_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut pending = vec![source_dir];
        while let Some(path) = pending.pop() {
            if path.is_dir() {
                pending.extend(
                    std::fs::read_dir(path)
                        .expect("read bay-repair source directory")
                        .map(|entry| entry.expect("read source entry").path()),
                );
                continue;
            }
            if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
                continue;
            }
            let repair_source = std::fs::read_to_string(&path).expect("read bay-repair source");
            let wildcard_import = ["bay_core::check::", "*"].concat();
            assert!(
                !repair_source.contains(&wildcard_import),
                "bay-repair must not wildcard-import the diagnosis module in {}",
                path.display()
            );
            for name in &gate_constant_names {
                assert!(
                    !repair_source.contains(name),
                    "bay-repair must not reference bay-core gate constant {name} in {}",
                    path.display()
                );
            }
        }
    }
}
