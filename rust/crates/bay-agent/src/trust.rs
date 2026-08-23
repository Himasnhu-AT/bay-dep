//! Plan, critic, and pairwise-selection rules shared by both MCP transports.
//!
//! This module never grades a caller's claim. Project hashes come from serialized projects,
//! render validity comes from the engine's gates, and critic obligations close only when a
//! freshly rendered ICGS differs at the same timestamp.

use std::collections::{BTreeMap, BTreeSet};

pub use bay_project::{
    AssetSlot, BeatPlan, CriticObligation, CriticState, FormatPlaybook, PairwiseDecision,
    PlanArtifact, PlanStatus, VariantCandidate, VariantState,
};
use bay_project::{MediaTime, Project};

#[derive(Debug, Clone, PartialEq)]
pub struct PlanDraft {
    pub brief: String,
    pub format: String,
    pub target_runtime_seconds: f64,
    pub beats: Vec<BeatPlan>,
}

pub fn format_registry() -> &'static [FormatPlaybook] {
    bay_project::FORMAT_REGISTRY
}

pub fn create_plan(draft: PlanDraft) -> Result<PlanArtifact, String> {
    if draft.brief.trim().is_empty() {
        return Err("brief must say what the video should accomplish".into());
    }
    if bay_project::format(&draft.format).is_none() {
        return Err(format!(
            "unknown format {:?}; choose one of {}",
            draft.format,
            format_registry()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !draft.target_runtime_seconds.is_finite() || draft.target_runtime_seconds <= 0.0 {
        return Err("targetRuntimeSeconds must be a finite number greater than zero".into());
    }
    if draft.beats.is_empty() {
        return Err("a plan needs at least one beat".into());
    }

    let mut ids = BTreeSet::new();
    let mut previous = -1.0;
    for beat in &draft.beats {
        if beat.id.trim().is_empty() || !ids.insert(beat.id.as_str()) {
            return Err(format!(
                "beat ids must be non-empty and unique (got {:?})",
                beat.id
            ));
        }
        if beat.intent.trim().is_empty() {
            return Err(format!("beat {:?} needs an editorial intent", beat.id));
        }
        if !beat.marker_seconds.is_finite()
            || beat.marker_seconds < 0.0
            || beat.marker_seconds >= draft.target_runtime_seconds
        {
            return Err(format!(
                "beat {:?} at {:.3}s is outside the target runtime 0..{:.3}s",
                beat.id, beat.marker_seconds, draft.target_runtime_seconds
            ));
        }
        if beat.marker_seconds <= previous {
            return Err("beat markers must be strictly increasing".into());
        }
        previous = beat.marker_seconds;

        let mut slots = BTreeSet::new();
        for slot in &beat.asset_slots {
            if slot.id.trim().is_empty() || !slots.insert(slot.id.as_str()) {
                return Err(format!(
                    "asset slot ids in beat {:?} must be non-empty and unique",
                    beat.id
                ));
            }
            if slot.purpose.trim().is_empty() {
                return Err(format!("asset slot {:?} needs a purpose", slot.id));
            }
        }
    }

    let fingerprint = serde_json::json!({
        "brief": draft.brief,
        "format": draft.format,
        "targetRuntimeSeconds": draft.target_runtime_seconds,
        "beats": draft.beats,
    });
    Ok(PlanArtifact {
        id: format!(
            "plan-{}",
            stable_hash(&serde_json::to_vec(&fingerprint).unwrap_or_default())
        ),
        brief: fingerprint["brief"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        format: fingerprint["format"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        target_runtime_seconds: draft.target_runtime_seconds,
        beats: draft.beats,
        status: PlanStatus::Draft,
        critic: CriticState::default(),
        variants: VariantState::default(),
    })
}

pub fn commit_plan(mut plan: PlanArtifact) -> PlanArtifact {
    plan.status = PlanStatus::Committed;
    plan
}

pub fn marker_commands(plan: &PlanArtifact) -> Result<Vec<bay_core::Command>, String> {
    if plan.status != PlanStatus::Committed {
        return Err("approve the plan before committing its beat markers".into());
    }
    plan.beats
        .iter()
        .map(|beat| {
            let time = MediaTime::from_seconds_f64(beat.marker_seconds)
                .ok_or_else(|| format!("beat {:?} has an unrepresentable time", beat.id))?;
            Ok(bay_core::Command::AddMarker {
                id: format!("plan-{}", beat.id),
                time,
                label: format!("{}: {}", beat.role, beat.intent),
            })
        })
        .collect()
}

pub fn project_hash(project: &Project) -> String {
    bay_project::project_hash(project)
}

pub fn register_variant(
    plan: &mut PlanArtifact,
    project: &Project,
    parent_project_id: &str,
    label: &str,
) -> Result<VariantCandidate, String> {
    if label.trim().is_empty() {
        return Err("variant label must not be empty".into());
    }
    let candidate = VariantCandidate {
        project_id: project.metadata.id.clone(),
        parent_project_id: parent_project_id.to_string(),
        label: label.trim().to_string(),
        project_hash: project_hash(project),
        render_path: None,
        valid_render: false,
    };
    if plan
        .variants
        .candidates
        .iter()
        .any(|entry| entry.project_id == candidate.project_id)
    {
        return Err(format!(
            "project {:?} is already registered as a variant",
            candidate.project_id
        ));
    }
    if plan.variants.incumbent_project_id.is_none() {
        plan.variants.incumbent_project_id = Some(parent_project_id.to_string());
    }
    plan.variants.candidates.push(candidate.clone());
    Ok(candidate)
}

/// Stamp validity only from a report produced by bay's own model and frame gates.
pub fn record_render(
    plan: &mut PlanArtifact,
    project_id: &str,
    path: &str,
    model_report: &serde_json::Value,
    frame_report: &serde_json::Value,
) -> Result<(), String> {
    let model_clean = model_report.get("status").and_then(|v| v.as_str()) != Some("unevaluated")
        && model_report
            .get("findings")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .all(|finding| {
                !finding
                    .get("severity")
                    .and_then(|value| value.as_str())
                    .is_some_and(|severity| severity.eq_ignore_ascii_case("error"))
            });
    let frames_clean = frame_report.get("status").and_then(|v| v.as_str()) == Some("clean");
    let candidate = plan
        .variants
        .candidates
        .iter_mut()
        .find(|entry| entry.project_id == project_id)
        .ok_or_else(|| format!("project {project_id:?} is not a registered variant"))?;
    candidate.render_path = Some(path.to_string());
    candidate.valid_render = model_clean && frames_clean;
    if !candidate.valid_render {
        return Err(format!(
            "variant {project_id:?} is invalid: model status {:?}, frame status {:?}",
            model_report.get("status"),
            frame_report.get("status")
        ));
    }
    Ok(())
}

pub fn pairwise_decide(
    plan: &mut PlanArtifact,
    left: &str,
    right: &str,
    winner: &str,
    reason: &str,
) -> Result<String, String> {
    if left == right || (winner != left && winner != right) {
        return Err(
            "pairwise comparison needs two different projects and one of them as winner".into(),
        );
    }
    if reason.trim().is_empty() {
        return Err("pairwise comparison needs a concrete preference reason".into());
    }
    let valid = |id: &str| {
        plan.variants
            .candidates
            .iter()
            .find(|entry| entry.project_id == id)
            .is_some_and(|entry| entry.valid_render)
    };
    if !valid(left) || !valid(right) {
        return Err(
            "both variants must have clean engine-verified renders before comparison".into(),
        );
    }
    let incumbent = plan
        .variants
        .incumbent_project_id
        .as_deref()
        .ok_or_else(|| "the tournament has no incumbent".to_string())?;
    if incumbent != left && incumbent != right {
        return Err(format!(
            "Forced Optimization requires every comparison to include incumbent {incumbent:?}"
        ));
    }
    let loser = if winner == left { right } else { left };
    plan.variants.comparisons.push(PairwiseDecision {
        left_project_id: left.to_string(),
        right_project_id: right.to_string(),
        winner_project_id: winner.to_string(),
        loser_project_id: loser.to_string(),
        reason: reason.trim().to_string(),
    });
    if winner != incumbent {
        plan.variants.incumbent_project_id = Some(winner.to_string());
    }
    Ok(plan
        .variants
        .incumbent_project_id
        .as_deref()
        .expect("set above")
        .to_string())
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanelEvidence {
    pub panel: usize,
    pub beat_id: String,
    pub sample_time_seconds: f64,
    pub content_hash: String,
    pub icgs: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CriticSubmission {
    pub weakest_panel: usize,
    pub most_alike_pair: (usize, usize),
    pub thumbnail_panel: usize,
    pub binaries: [bool; 9],
    pub rationale: String,
}

pub fn apply_critic_submission(
    plan: &mut PlanArtifact,
    panels: &[PanelEvidence],
    submission: &CriticSubmission,
) -> Result<Vec<CriticObligation>, String> {
    if plan.critic.rounds_completed >= 2 {
        return Err("the critic loop is bounded at two rounds".into());
    }
    if submission.rationale.trim().is_empty() {
        return Err("the critic must explain its forced choices".into());
    }
    let by_panel: BTreeMap<usize, &PanelEvidence> =
        panels.iter().map(|panel| (panel.panel, panel)).collect();
    let selected = [
        (
            submission.weakest_panel,
            "fresh critic chose this as the weakest panel",
        ),
        (
            submission.most_alike_pair.0,
            "fresh critic chose this in the most-alike pair",
        ),
        (
            submission.thumbnail_panel,
            "fresh critic chose this as the thumbnail",
        ),
    ];
    if submission.most_alike_pair.0 == submission.most_alike_pair.1 {
        return Err("mostAlikePair must name two different panels".into());
    }
    if !by_panel.contains_key(&submission.most_alike_pair.1) {
        return Err("mostAlikePair names a panel outside the engine contact sheet".into());
    }

    let round = plan.critic.rounds_completed + 1;
    let mut obligations = Vec::new();
    for (choice_index, (choice, reason)) in selected.into_iter().enumerate() {
        let panel = by_panel
            .get(&choice)
            .ok_or_else(|| format!("forced choice names unknown panel {choice}"))?;
        let id = format!(
            "critic-r{round}-c{choice_index}-{}-{}",
            panel.beat_id,
            stable_hash(
                format!(
                    "{}:{:.6}:{}",
                    panel.beat_id, panel.sample_time_seconds, panel.content_hash
                )
                .as_bytes()
            )
        );
        obligations.push(CriticObligation {
            id,
            beat_id: panel.beat_id.clone(),
            sample_time_seconds: panel.sample_time_seconds,
            content_hash: panel.content_hash.clone(),
            baseline_icgs: panel.icgs.clone(),
            reason: format!("{reason}: {}", submission.rationale.trim()),
            closed: false,
        });
    }
    plan.critic.rounds_completed = round;
    plan.critic.obligations.extend(obligations.clone());
    Ok(obligations)
}

pub fn refresh_obligations(
    plan: &mut PlanArtifact,
    current_panels: &BTreeMap<String, (String, Vec<u16>)>,
) -> usize {
    let mut closed = 0;
    for obligation in &mut plan.critic.obligations {
        if obligation.closed {
            continue;
        }
        let key = format!(
            "{}@{:.6}",
            obligation.beat_id, obligation.sample_time_seconds
        );
        if current_panels
            .get(&key)
            .is_some_and(|(content_hash, signature)| {
                content_hash != &obligation.content_hash && signature != &obligation.baseline_icgs
            })
        {
            obligation.closed = true;
            closed += 1;
        }
    }
    closed
}

pub fn require_trust_ready(plan: Option<&PlanArtifact>) -> Result<(), String> {
    // A project predating Phase 2 remains renderable. Once a plan exists, however, the trust
    // loop is active and cannot be bypassed by deleting individual findings.
    let Some(plan) = plan else {
        return Ok(());
    };
    if plan.status != PlanStatus::Committed {
        return Err("render refused: the plan is still a draft".into());
    }
    let open = plan
        .critic
        .obligations
        .iter()
        .filter(|obligation| !obligation.closed)
        .count();
    if open > 0 {
        return Err(format!(
            "render refused: {open} critic obligation(s) remain open; revise the named beats"
        ));
    }
    Ok(())
}

fn stable_hash(bytes: &[u8]) -> String {
    // FNV-1a is intentionally tiny and deterministic across processes/platforms. This is an
    // identity fingerprint, not an authentication primitive.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
