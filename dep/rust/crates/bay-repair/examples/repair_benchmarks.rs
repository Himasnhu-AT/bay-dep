use std::{
    cell::RefCell,
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use bay_agent::trust::{
    CriticSubmission, PanelEvidence, apply_critic_submission, record_render, refresh_obligations,
};
use bay_core::{Editor, MediaTime, Project, Report, check};
use bay_preview::{PreviewRenderer, frame_check};
use bay_project::{PlanArtifact, PlanStatus};
use bay_repair::{
    ConvergedCandidate, CraftDecision, DeterministicOvershoot, DeterministicRepairs,
    FrameAssessment, JudgementOvershoot, JudgementRepairs, LowerToCommands, RepairEvaluation,
    RepairPlanner, TournamentJudge, combine_reports, run_judged_repair_loop, run_repair_loop,
};
use serde::Deserialize;
use serde_json::json;

fn evaluated(
    project: &Project,
    renderer: &RefCell<PreviewRenderer>,
) -> (RepairEvaluation, FrameAssessment) {
    let frames = {
        let mut renderer = renderer.borrow_mut();
        renderer.await_decodes(project.active_scene(), &project.media);
        frame_check::check_frames(project, &mut renderer, None)
    };
    let assessment = FrameAssessment::from_json(&frames)
        .unwrap_or_else(|reason| panic!("frame checks must be evaluated: {reason}"));
    let report = combine_reports(check(project), &assessment);
    (
        RepairEvaluation::from_report_and_frames(report, &assessment),
        assessment,
    )
}

fn evaluated_report(project: &Project, renderer: &RefCell<PreviewRenderer>) -> RepairEvaluation {
    evaluated(project, renderer).0
}

fn counts(report: &Report) -> BTreeMap<String, usize> {
    report
        .rollup
        .iter()
        .map(|(code, count)| ((*code).to_owned(), *count))
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmittedPanel {
    panel: usize,
    beat_id: String,
    sample_time_seconds: f64,
    content_hash: String,
    icgs: Vec<u16>,
}

impl From<&SubmittedPanel> for PanelEvidence {
    fn from(panel: &SubmittedPanel) -> Self {
        Self {
            panel: panel.panel,
            beat_id: panel.beat_id.clone(),
            sample_time_seconds: panel.sample_time_seconds,
            content_hash: panel.content_hash.clone(),
            icgs: panel.icgs.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmittedCritic {
    weakest_panel: usize,
    most_alike_pair: (usize, usize),
    thumbnail_panel: usize,
    binaries: [bool; 9],
    rationale: String,
}

impl From<&SubmittedCritic> for CriticSubmission {
    fn from(submission: &SubmittedCritic) -> Self {
        Self {
            weakest_panel: submission.weakest_panel,
            most_alike_pair: submission.most_alike_pair,
            thumbnail_panel: submission.thumbnail_panel,
            binaries: submission.binaries,
            rationale: submission.rationale.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentPanel {
    content_hash: String,
    icgs: Vec<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JudgeEvidence {
    /// Ordered path keys, best first. Every converged contender must appear exactly once.
    ranking: Vec<String>,
    panels: Vec<SubmittedPanel>,
    submission: SubmittedCritic,
    current_panels: BTreeMap<String, CurrentPanel>,
    accept: bool,
    absolute_reason: String,
}

fn evidence_directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("bay-repair lives under the repository rust workspace")
        .join("research/final-acceptance")
}

fn write_contact_sheet(
    project: &Project,
    renderer: &RefCell<PreviewRenderer>,
    path: &Path,
) -> Result<(), String> {
    let report = check(project);
    let starts = &report.stats.beats.starts;
    let end = report.stats.beats.end_seconds;
    let mut times = Vec::new();
    for (index, start) in starts.iter().copied().enumerate() {
        let beat_end = starts.get(index + 1).copied().unwrap_or(end);
        if beat_end > start {
            times.push(start + (beat_end - start) / 3.0);
            times.push(start + (beat_end - start) * 2.0 / 3.0);
        }
    }
    if times.is_empty() {
        return Err("contact sheet has no beat samples".into());
    }
    let columns = 3usize;
    let thumb_height = 240u32;
    let canvas = project.settings.canvas;
    let thumb_width = ((thumb_height as f64 * canvas.width as f64 / canvas.height.max(1) as f64)
        .round() as u32)
        .max(16);
    let rows = times.len().div_ceil(columns);
    let mut sheet = image::RgbaImage::from_pixel(
        thumb_width * columns as u32,
        thumb_height * rows as u32,
        image::Rgba([16, 16, 18, 255]),
    );
    let mut renderer = renderer.borrow_mut();
    renderer.await_decodes(project.active_scene(), &project.media);
    for (index, at) in times.into_iter().enumerate() {
        let playhead = MediaTime::from_seconds_f64(at)
            .ok_or_else(|| format!("contact sheet time {at} is not representable"))?;
        let frame = renderer
            .render(
                project.active_scene(),
                playhead,
                thumb_width,
                thumb_height,
                &project.settings.background,
                &project.media,
            )
            .ok_or_else(|| format!("GPU could not render contact sheet panel at {at:.2}s"))?;
        let mut rgba = frame.bgra;
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        let panel = image::RgbaImage::from_raw(thumb_width, thumb_height, rgba)
            .ok_or_else(|| "contact sheet panel has an invalid byte length".to_string())?;
        let x = (index % columns) as u32 * thumb_width;
        let y = (index / columns) as u32 * thumb_height;
        image::imageops::replace(&mut sheet, &panel, i64::from(x), i64::from(y));
    }
    sheet
        .save(path)
        .map_err(|error| format!("write contact sheet {}: {error}", path.display()))
}

fn path_key(candidate: &ConvergedCandidate) -> String {
    if candidate.repairs.is_empty() {
        return "already-clean".into();
    }
    candidate
        .repairs
        .iter()
        .map(|repair| repair.intent.as_str())
        .collect::<Vec<_>>()
        .join(" -> ")
}

fn evidence_path(source: &str) -> PathBuf {
    let stem = Path::new(source)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("bay-repaired");
    evidence_directory().join(format!("{stem}.judge.json"))
}

fn load_judge_evidence(source: &str) -> Option<JudgeEvidence> {
    let path = evidence_path(source);
    let source = match std::fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => panic!("read submitted craft evidence {}: {error}", path.display()),
    };
    Some(serde_json::from_str(&source).unwrap_or_else(|error| {
        panic!(
            "decode submitted craft evidence {}: {error}",
            path.display()
        )
    }))
}

fn repair_plan(project: &Project) -> PlanArtifact {
    let report = check(project);
    PlanArtifact {
        id: format!(
            "repair-benchmark-{}",
            &bay_project::project_hash(project)[..12]
        ),
        brief: format!("absolute craft judgement for {}", project.metadata.name),
        format: "repair-benchmark".into(),
        target_runtime_seconds: report.stats.beats.end_seconds.max(0.001),
        beats: Vec::new(),
        status: PlanStatus::Committed,
        critic: Default::default(),
        variants: Default::default(),
    }
}

fn record_engine_render(
    candidate: &ConvergedCandidate,
    renderer: &RefCell<PreviewRenderer>,
    plan: &mut PlanArtifact,
    variant_id: &str,
) -> Result<(), String> {
    if candidate.report.errors != 0 {
        return Err("tournament received a converged path with blocking findings".into());
    }
    let model = check(&candidate.project);
    let frames = {
        let mut renderer = renderer.borrow_mut();
        renderer.await_decodes(candidate.project.active_scene(), &candidate.project.media);
        frame_check::check_frames(&candidate.project, &mut renderer, None)
    };
    FrameAssessment::from_json(&frames)?;
    let hash = bay_project::project_hash(&candidate.project);
    let contact_sheet = evidence_directory().join(format!("judge-{hash}.contact-sheet.png"));
    write_contact_sheet(&candidate.project, renderer, &contact_sheet)?;
    record_render(
        plan,
        variant_id,
        contact_sheet
            .to_str()
            .ok_or_else(|| "contact-sheet path is not UTF-8".to_string())?,
        &serde_json::to_value(model).map_err(|error| error.to_string())?,
        &frames,
    )
}

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    assert!(!paths.is_empty(), "pass one or more project JSON paths");
    let phase3 = std::env::var_os("BAY_REPAIR_PHASE3").is_some();

    for path in paths {
        let project_path =
            std::fs::canonicalize(&path).unwrap_or_else(|error| panic!("resolve {path}: {error}"));
        let project = bay_project::library::read_project(&project_path)
            .unwrap_or_else(|error| panic!("read {path}: {error}"));
        let renderer = RefCell::new(
            PreviewRenderer::new().expect("an unsandboxed GPU adapter is required for this run"),
        );
        let (before, before_frames) = evaluated(&project, &renderer);
        if phase3 && std::env::var_os("BAY_REPAIR_TRACE_CANDIDATES").is_some() {
            let trace_code = std::env::var("BAY_REPAIR_TRACE_CODE").ok();
            let trace_intent = std::env::var("BAY_REPAIR_TRACE_INTENT").ok();
            for repair in JudgementRepairs
                .plan(&project, &before.report)
                .into_iter()
                .filter(|repair| {
                    trace_code
                        .as_deref()
                        .is_none_or(|code| repair.target.code == code)
                        && trace_intent
                            .as_deref()
                            .is_none_or(|intent| repair.intent.contains(intent))
                })
            {
                let mut editor = Editor::new(project.clone());
                for command in repair.lower_to_commands().iter().cloned() {
                    editor.execute(command);
                }
                let (candidate_evaluation, candidate_frames) =
                    evaluated(editor.project(), &renderer);
                let report = candidate_evaluation.report;
                eprintln!(
                    "{}",
                    serde_json::to_string(&json!({
                        "candidate": repair.intent,
                        "targetAt": repair.target.at_seconds,
                        "counts": counts(&report),
                        "frameStats": {
                            "frozenWindows": candidate_frames.frozen_windows,
                            "peakAnchorSqrtArea": candidate_frames.peak_anchor_sqrt_area,
                            "bottomAliveShare": candidate_frames.bottom_alive_share,
                        },
                        "brokenContinuity": report.findings.iter().filter(|finding| finding.code == "broken-continuity").map(|finding| json!({
                            "at": finding.at_seconds,
                            "message": finding.message,
                        })).collect::<Vec<_>>(),
                    }))
                    .expect("encode candidate trace")
                );
            }
            if std::env::var_os("BAY_REPAIR_TRACE_ONLY").is_some() {
                continue;
            }
        }
        let (result, judge_plan) = if phase3 {
            if std::env::var_os("BAY_REPAIR_UNJUDGED_DIAGNOSTIC").is_some() {
                (
                    run_repair_loop(
                        project,
                        before.clone(),
                        &JudgementRepairs,
                        &JudgementOvershoot,
                        |candidate| evaluated_report(candidate, &renderer),
                    ),
                    None,
                )
            } else {
                let evidence = load_judge_evidence(&path);
                let plan = repair_plan(&project);
                let compare = |left: &ConvergedCandidate,
                               right: &ConvergedCandidate,
                               plan: &mut PlanArtifact,
                               left_id: &str,
                               right_id: &str| {
                    let evidence = evidence.as_ref().ok_or_else(|| {
                        format!(
                            "no submitted craft evidence at {}",
                            evidence_path(&path).display()
                        )
                    })?;
                    record_engine_render(left, &renderer, plan, left_id)?;
                    record_engine_render(right, &renderer, plan, right_id)?;
                    let left_key = path_key(left);
                    let right_key = path_key(right);
                    let left_rank = evidence
                        .ranking
                        .iter()
                        .position(|entry| entry == &left_key)
                        .ok_or_else(|| {
                            format!(
                                "submitted ranking does not include converged path {left_key:?}"
                            )
                        })?;
                    let right_rank = evidence
                        .ranking
                        .iter()
                        .position(|entry| entry == &right_key)
                        .ok_or_else(|| {
                            format!(
                                "submitted ranking does not include converged path {right_key:?}"
                            )
                        })?;
                    let reason = format!(
                        "submitted craft ranking places {:?} ahead of {:?}",
                        evidence.ranking[left_rank.min(right_rank)],
                        evidence.ranking[left_rank.max(right_rank)]
                    );
                    if right_rank < left_rank {
                        Ok(CraftDecision::CandidateWins { reason })
                    } else {
                        Ok(CraftDecision::IncumbentWins { reason })
                    }
                };
                let assess = |winner: &ConvergedCandidate,
                              plan: &mut PlanArtifact,
                              winner_id: &str| {
                    let evidence = evidence.as_ref().ok_or_else(|| {
                        format!(
                            "no submitted absolute panel evidence at {}",
                            evidence_path(&path).display()
                        )
                    })?;
                    record_engine_render(winner, &renderer, plan, winner_id)?;
                    let winner_key = path_key(winner);
                    if evidence.ranking.first() != Some(&winner_key) {
                        return Err(format!(
                            "pairwise winner {winner_key:?} is not the submitted ranking winner"
                        ));
                    }
                    if evidence.absolute_reason.trim().is_empty() {
                        return Err("absolute craft submission needs a concrete reason".into());
                    }
                    let panels: Vec<PanelEvidence> =
                        evidence.panels.iter().map(PanelEvidence::from).collect();
                    apply_critic_submission(plan, &panels, &(&evidence.submission).into())?;
                    if !evidence.accept || evidence.submission.binaries.iter().any(|value| !value) {
                        return Err(format!(
                            "absolute panel judgement rejected the winner: {}",
                            evidence.absolute_reason
                        ));
                    }
                    let current = evidence
                        .current_panels
                        .iter()
                        .map(|(key, panel)| {
                            (
                                key.clone(),
                                (panel.content_hash.clone(), panel.icgs.clone()),
                            )
                        })
                        .collect();
                    refresh_obligations(plan, &current);
                    Ok(())
                };
                let judge = TournamentJudge::new(plan, compare, assess);
                let result = run_judged_repair_loop(
                    project,
                    before.clone(),
                    &JudgementRepairs,
                    &JudgementOvershoot,
                    |candidate| evaluated_report(candidate, &renderer),
                    &judge,
                );
                (result, Some(judge.into_plan()))
            }
        } else {
            (
                run_repair_loop(
                    project,
                    before.clone(),
                    &DeterministicRepairs,
                    &DeterministicOvershoot,
                    |candidate| evaluated_report(candidate, &renderer),
                ),
                None,
            )
        };
        let stem = Path::new(&path)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("bay-repaired");
        let phase = if phase3 && std::env::var_os("BAY_REPAIR_UNJUDGED_DIAGNOSTIC").is_none() {
            "phase3-judged"
        } else if phase3 {
            "phase3-diagnostic-3"
        } else {
            "phase2-3"
        };
        let output = evidence_directory().join(format!("{stem}.{phase}.project.json"));
        std::fs::write(
            &output,
            serde_json::to_vec_pretty(&result.project).expect("encode repaired project"),
        )
        .expect("write repaired project");
        let contact_sheet = phase3.then(|| {
            let path = evidence_directory().join(format!("{stem}.{phase}.contact-sheet.png"));
            write_contact_sheet(&result.project, &renderer, &path)
                .unwrap_or_else(|error| panic!("{error}"));
            path
        });
        let (_, after_frames) = evaluated(&result.project, &renderer);
        let attempts: Vec<_> = result
            .attempts
            .iter()
            .map(|attempt| {
                json!({
                    "code": attempt.repair.target.code,
                    "disposition": attempt.disposition,
                    "beforeErrors": attempt.before_errors,
                    "candidateErrors": attempt.candidate_errors,
                    "newCodes": attempt.new_codes,
                    "regressedCodes": attempt.regressed_codes,
                    "reason": attempt.reason,
                })
            })
            .collect();
        println!(
            "{}",
            serde_json::to_string(&json!({
                "project": path,
                "output": output,
                "contactSheet": contact_sheet,
                "termination": result.termination,
                "rounds": result.rounds,
                "before": counts(&before.report),
                "after": counts(&result.report),
                "beforeFrameStats": {
                    "frozenWindows": before_frames.frozen_windows,
                    "peakAnchorSqrtArea": before_frames.peak_anchor_sqrt_area,
                    "bottomAliveShare": before_frames.bottom_alive_share,
                },
                "afterFrameStats": {
                    "frozenWindows": after_frames.frozen_windows,
                    "peakAnchorSqrtArea": after_frames.peak_anchor_sqrt_area,
                    "bottomAliveShare": after_frames.bottom_alive_share,
                },
                "gapBedLufs": bay_project::mix::envelope(&result.project).gap_bed_lufs,
                "attempts": attempts,
                "remainingErrors": result.remaining_error_codes,
                "judgement": result.judgement,
                "judgePlan": judge_plan,
            }))
            .expect("encode benchmark result")
        );
    }
}
