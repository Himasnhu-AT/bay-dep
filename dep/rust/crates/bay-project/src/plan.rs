//! Inspectable intent and review state stored with a project.
//!
//! A plan is deliberately smaller than the timeline. It records the editorial promise before
//! the author can defend the implementation, and its beat markers become the stable addresses
//! used by checks and the critic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanArtifact {
    pub id: String,
    pub brief: String,
    pub format: String,
    pub target_runtime_seconds: f64,
    pub beats: Vec<BeatPlan>,
    #[serde(default)]
    pub status: PlanStatus,
    #[serde(default)]
    pub critic: CriticState,
    #[serde(default)]
    pub variants: VariantState,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanStatus {
    #[default]
    Draft,
    Committed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatPlan {
    pub id: String,
    pub role: String,
    pub marker_seconds: f64,
    pub intent: String,
    #[serde(default)]
    pub asset_slots: Vec<AssetSlot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSlot {
    pub id: String,
    pub purpose: String,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticState {
    #[serde(default)]
    pub rounds_completed: u8,
    #[serde(default)]
    pub obligations: Vec<CriticObligation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticObligation {
    pub id: String,
    pub beat_id: String,
    pub sample_time_seconds: f64,
    pub content_hash: String,
    /// ICGS at the exact sample time when the critic made the forced choice.
    pub baseline_icgs: Vec<u16>,
    pub reason: String,
    #[serde(default)]
    pub closed: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantState {
    pub incumbent_project_id: Option<String>,
    #[serde(default)]
    pub candidates: Vec<VariantCandidate>,
    #[serde(default)]
    pub comparisons: Vec<PairwiseDecision>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantCandidate {
    pub project_id: String,
    pub parent_project_id: String,
    pub label: String,
    /// Hash of the saved project model. This is computed by bay, never supplied by a caller.
    pub project_hash: String,
    pub render_path: Option<String>,
    #[serde(default)]
    pub valid_render: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairwiseDecision {
    pub left_project_id: String,
    pub right_project_id: String,
    pub winner_project_id: String,
    pub loser_project_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatPlaybook {
    pub id: &'static str,
    pub hook: &'static str,
    pub average_shot_seconds: (f32, f32),
    pub caption_convention: &'static str,
    pub sound_convention: &'static str,
    pub structure: &'static str,
    pub failure_modes: &'static [&'static str],
}

/// Genre constraints are data, not prose hidden in an agent prompt.
pub static FORMAT_REGISTRY: &[FormatPlaybook] = &[
    FormatPlaybook {
        id: "short-form-social",
        hook: "scroll-stop in 0.5-1.5s; value before branding",
        average_shot_seconds: (1.5, 3.0),
        caption_convention: "burned-in karaoke captions; 22-28 characters/second",
        sound_convention: "music-forward; cuts may follow a verified beat grid",
        structure: "hook, escalation, payoff, loop; verbal and text CTA in final 2s",
        failure_modes: &[
            "cold-open logo",
            "uniform shot lengths",
            "caption beyond safe zone",
        ],
    },
    FormatPlaybook {
        id: "youtube-explainer",
        hook: "pattern interrupt by 5s, promise by 15s, commitment by 30s",
        average_shot_seconds: (4.0, 8.0),
        caption_convention: "keywords only, not full subtitles",
        sound_convention: "voice-led; bed materially below speech",
        structure: "re-engage near 25% and 65%; CTA after first payoff",
        failure_modes: &[
            "cold-open CTA",
            "flat energy contour",
            "full-word over-captioning",
        ],
    },
    FormatPlaybook {
        id: "product-demo",
        hook: "product visibly moving by 1.5s; problem framing follows",
        average_shot_seconds: (2.0, 4.0),
        caption_convention: "short high-contrast feature labels with 300-500ms entrances",
        sound_convention: "clean voice, restrained music, UI foley",
        structure: "problem, product, three proof beats, single CTA",
        failure_modes: &[
            "feature list before product",
            "multiple CTAs",
            "unreadable UI",
        ],
    },
    FormatPlaybook {
        id: "ugc-ad",
        hook: "face and direct address in frame one",
        average_shot_seconds: (2.0, 5.0),
        caption_convention: "auto-caption look; slight imperfection is intentional",
        sound_convention: "camera-mic realism; minimal music",
        structure: "skepticism, trial, result, spoken CTA",
        failure_modes: &[
            "over-polished motion graphics",
            "graphic-only CTA",
            "no human face",
        ],
    },
    FormatPlaybook {
        id: "podcast-clip",
        hook: "open mid-sentence on the strongest self-contained claim",
        average_shot_seconds: (3.0, 6.0),
        caption_convention: "full verbatim captions are mandatory",
        sound_convention: "J/L cuts on turns; microphone loudness remains consistent",
        structure: "one self-contained argument; weak CTA or none",
        failure_modes: &[
            "contextless fragment",
            "missing captions",
            "hard audio cuts",
        ],
    },
    FormatPlaybook {
        id: "archival-mini-doc",
        hook: "cold-open on the most arresting artifact",
        average_shot_seconds: (5.0, 12.0),
        caption_convention: "lower thirds plus date and source cards",
        sound_convention: "ambience-led, sparse score, continuous room tone",
        structure: "question, evidence, turn, resolution; no CTA",
        failure_modes: &["missing provenance", "wall-to-wall score", "forced CTA"],
    },
    FormatPlaybook {
        id: "motion-graphics-explainer",
        hook: "visual metaphor appears by 2s",
        average_shot_seconds: (3.0, 6.0),
        caption_convention: "text is visual; one idea per screen",
        sound_convention: "effects synchronize with meaningful motion",
        structure: "sequential build; each graphic inherits the last; final-card CTA",
        failure_modes: &["carousel resets", "empty container", "opacity-only motion"],
    },
    FormatPlaybook {
        id: "photo-memories",
        hook: "best photo first with motion already underway",
        average_shot_seconds: (2.5, 4.0),
        caption_convention: "minimal dates and names",
        sound_convention: "music leads; cuts follow phrase boundaries",
        structure: "chronological or emotional arc; no CTA",
        failure_modes: &[
            "uniform Ken Burns",
            "text-heavy cards",
            "arbitrary chronology",
        ],
    },
    FormatPlaybook {
        id: "screen-tutorial",
        hook: "state outcome and show finished result within 5s",
        average_shot_seconds: (6.0, 12.0),
        caption_convention: "step numbers and keystroke overlays",
        sound_convention: "voice only during instruction",
        structure: "numbered steps, recap, next-tutorial CTA",
        failure_modes: &[
            "cursor too small",
            "music masking instruction",
            "missing outcome preview",
        ],
    },
    FormatPlaybook {
        id: "music-montage",
        hook: "first verified beat drop within 3s",
        average_shot_seconds: (1.0, 4.0),
        caption_convention: "sparse or none",
        sound_convention: "music is the timeline; cuts require a measured grid",
        structure: "energy curve follows track sections",
        failure_modes: &[
            "invented beat grid",
            "flat cut rate",
            "lyrics obscured by captions",
        ],
    },
    FormatPlaybook {
        id: "talking-head-broll",
        hook: "strongest sentence first with B-roll off the top",
        average_shot_seconds: (4.0, 9.0),
        caption_convention: "full captions only for social cut-downs",
        sound_convention: "J-cuts into B-roll and L-cuts out",
        structure: "claim, evidence, claim; CTA at natural close",
        failure_modes: &["unrelated B-roll", "visible jump cuts", "caption over face"],
    },
];

pub fn format(id: &str) -> Option<&'static FormatPlaybook> {
    FORMAT_REGISTRY.iter().find(|entry| entry.id == id)
}
