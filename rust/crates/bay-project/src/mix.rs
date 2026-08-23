//! The mix, measured in LUFS rather than in multipliers.
//!
//! # Why a gain is not a level
//!
//! `volume: 2.0` says nothing about how loud a clip will be. The project this comes from ran its
//! bed at `2.0` against a file that integrates to **−35.3 LUFS** and its narration at `1.15`
//! against files at **−25.8**, so a gain *ratio* of 4.3 dB was an audible separation of 13.7 dB.
//! Every check written against the gain number inherited that blindness, and the one that
//! existed — a warning on any clip above unity gain — fired 22 times, 16 of them on levels that
//! were correct, and was satisfiable by scaling every gain down by a constant. That changes no
//! relative level, no contour, and produces a bit-identical file once `loudnorm` re-normalises.
//! It certified the bad mix and pointed away from the real defect, which was **a bed 9 LU too
//! quiet**.
//!
//! So the envelope here is built from two measured things: each asset's own integrated loudness
//! ([`AssetLoudness`], measured once at import) and the gain envelope the project describes.
//! Neither can be changed without changing the other.
//!
//! # What it can and cannot know
//!
//! An asset contributes at its *file* loudness scaled by the gain at that instant. A clip whose
//! first five seconds are quiet reports its file mean for those five seconds. That is the limit
//! of a model-level measurement, and it is stated rather than hidden — what it buys is that the
//! whole thing is pure: no decode, no ffmpeg, no GPU, and a unit test can build a mix and assert
//! its contour.
//!
//! **Deliberately not measured: loudness range.** Measured on the three videos in question, R1
//! is 6.7 LU, the failed video 3.5, and **R2 — the reference we most admire — 2.3**. A ≥6 LU
//! floor condemns R2 by 2.6×. The contour that matters is *positional*: loud where the voice is,
//! quiet between the lines, loudest at the payoff. A range is satisfiable anywhere.
//!
//! # Why the levels are read per hop and compared by median, not over a 3 s window
//!
//! EBU R128's short-term window is the obvious unit for "how loud is this moment", and it is the
//! wrong one here. A 3 s window straddles the boundary between a line and the gap after it, so
//! the level it reports for either state depends on how long that state lasts. Measured on
//! synthetic mixes built to exactly one 6 LU state difference, a windowed statistic reports
//! **1.97 LU for 3 s lines and 5.75 LU for 10 s lines** — a 3× spread produced by nothing but
//! clip lengths. It would condemn a correct mix for speaking in short sentences.
//!
//! The median of the per-hop levels recovers the designed difference to a tenth of a LU at every
//! line length tried (6.17 for a 6 LU design, 8.11 for an 8 LU one), because the median of a
//! two-state signal is the level of its plateau. It is transient-proof for free: a 0.5 s impact
//! inside a 25 s gap moves a median by nothing, so "add loud sound effects" is not a way to
//! pass, and neither is inserting silence.

use std::collections::BTreeMap;

use crate::element::{AudioRole, Element};
use crate::project::Project;
use bay_time::MediaTime;

/// How often the envelope is sampled. EBU R128's own hop for a short-term series.
pub const HOP_SECONDS: f64 = 0.1;

/// How much louder the narration windows have to be than the gaps, in LU.
///
/// Positional, and it is a difference between two measured states rather than a threshold on a
/// number anyone types. Scaling every gain in the project moves both terms equally and changes
/// it by zero — which is precisely what the check it replaces could not say.
pub const MIN_SEPARATION_LU: f64 = 6.0;

/// How quiet the bed may be between the lines before it has stopped being a bed.
///
/// The other side of the bracket. Without it the separation above is satisfiable by deleting the
/// music, which is separation manufactured rather than mixed. −26 LUFS against a −14 LUFS
/// programme is 12 LU down: present, and about as far down as a phone speaker will still carry.
pub const MIN_GAP_BED_LUFS: f64 = -26.0;

/// The loudness the export delivers at, and the scale every absolute number here is on.
///
/// The export chain ends in `loudnorm=I=-14:TP=-1.5:LRA=11`, which shifts the whole programme
/// so its integrated loudness lands here — verified end to end: authored material at or under
/// 11 LU of range passes through within ±0.5 LU while the integrated target lands within 0.1 dB.
/// So the envelope is normalised the same way before any absolute threshold is applied to it.
/// Without that, a project whose assets are all quiet but correctly balanced would be condemned
/// for a level `loudnorm` fixes, and one mastered hot would pass for a level it does not keep.
pub const DELIVERY_LUFS: f64 = -14.0;

/// EBU R128's gates: blocks below this absolutely, and below this much under the ungated mean,
/// are excluded from the integrated measurement. Together they are why a passage of silence
/// cannot drag a programme's loudness down.
const ABSOLUTE_GATE_LUFS: f64 = -70.0;
const RELATIVE_GATE_LU: f64 = 10.0;

/// The window the loudest moment is found over, and how near a `payoff` marker it has to land.
pub const PEAK_WINDOW_SECONDS: f64 = 0.4;
pub const PAYOFF_TOLERANCE_SECONDS: f64 = 1.5;

/// Power so small it is silence. Keeps `log10` away from zero and keeps an unsounded window out
/// of every mean.
const SILENCE_POWER: f64 = 1e-12;

/// One 100 ms hop of the modelled mix.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MixSample {
    pub at_seconds: f64,
    /// Level of everything sounding, in LUFS on the delivered scale.
    pub lufs: f64,
    /// Level of the `bed` clips alone. `None` where no bed sounds.
    pub bed_lufs: Option<f64>,
    /// Whether a speech clip is sounding at this instant.
    pub speaking: bool,
}

/// What the mix measures.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MixEnvelope {
    pub samples: Vec<MixSample>,
    /// Median level over the hops where a line is being spoken — the speech plateau.
    pub narration_lufs: Option<f64>,
    /// Median level over the hops where nothing is being spoken but something is sounding —
    /// the gap trough.
    pub gap_lufs: Option<f64>,
    /// Median level of the bed alone over those same hops.
    pub gap_bed_lufs: Option<f64>,
    /// What the whole programme integrates to *before* normalisation, in LUFS. Every level
    /// above has been shifted so this lands on [`DELIVERY_LUFS`], which is what the export does.
    pub authored_lufs: Option<f64>,
    /// Where the loudest [`PEAK_WINDOW_SECONDS`] of the whole mix falls.
    pub peak_at_seconds: Option<f64>,
    /// The `payoff` marker this project committed to, if it has one.
    pub payoff_at_seconds: Option<f64>,
    /// Assets that are heard but have never been measured. While this is non-empty the levels
    /// above are not comparable and nothing may be concluded from them.
    pub unmeasured: Vec<String>,
    /// Whether any speech clip sounds at all. Without one there are no narration windows and
    /// the separation is not a question about this project.
    pub has_speech: bool,
    pub has_bed: bool,
}

impl MixEnvelope {
    /// How much louder the lines are than the gaps between them, in LU. The number the whole
    /// module exists to produce.
    pub fn separation_lu(&self) -> Option<f64> {
        Some(self.narration_lufs? - self.gap_lufs?)
    }

    /// Whether every asset that will be heard has been measured.
    pub fn is_measurable(&self) -> bool {
        self.unmeasured.is_empty() && !self.samples.is_empty()
    }

    /// Distance from the loudest moment to the `payoff` marker, in seconds. `None` when the
    /// project has not committed to one.
    pub fn peak_to_payoff_seconds(&self) -> Option<f64> {
        Some((self.peak_at_seconds? - self.payoff_at_seconds?).abs())
    }
}

/// Measure a project's mix.
///
/// Pure: everything comes from the project model and the loudness cached on its assets.
pub fn envelope(project: &Project) -> MixEnvelope {
    let scene = project.active_scene();
    let loudness: BTreeMap<&str, f64> = project
        .media
        .iter()
        .filter_map(|asset| {
            // Every asset that has been *measured*, including the ones R128 could only report a
            // floor for — a 45 ms tick peaking at −1.1 dBFS has been measured, and calling that
            // unmeasurable made three real projects unjudgeable.
            let measured = asset.loudness.as_ref()?;
            Some((asset.id.as_str(), f64::from(measured.level_lufs())))
        })
        .collect();

    let audible: Vec<&Element> = scene
        .tracks
        .audio
        .iter()
        .filter(|track| !track.muted && !track.hidden)
        .flat_map(|track| track.elements.iter())
        .filter(|element| matches!(element, Element::Audio(_)))
        .filter(|element| element.duration() > MediaTime::ZERO)
        .filter(|element| element.gain_points().iter().any(|(_, gain)| *gain > 0.0))
        .collect();

    let mut out = MixEnvelope {
        has_speech: audible
            .iter()
            .any(|element| element.audio_role() == Some(AudioRole::Speech)),
        has_bed: audible
            .iter()
            .any(|element| element.audio_role() == Some(AudioRole::Bed)),
        ..MixEnvelope::default()
    };
    // Named once each, in timeline order, so the reason a mix could not be measured names the
    // files rather than a count.
    let mut unmeasured: Vec<String> = Vec::new();
    for element in &audible {
        if let Some(media_id) = element.media_id()
            && !loudness.contains_key(media_id)
            && !unmeasured.iter().any(|id| id == media_id)
        {
            unmeasured.push(media_id.to_string());
        }
    }
    out.unmeasured = unmeasured;

    let end = audible
        .iter()
        .map(|element| element.end())
        .max()
        .unwrap_or(MediaTime::ZERO)
        .to_seconds_f64();
    if end <= 0.0 || !out.unmeasured.is_empty() {
        return out;
    }

    // Instantaneous power per hop, split by what is making it.
    let hops = (end / HOP_SECONDS).ceil() as usize;
    let mut total = vec![0.0_f64; hops];
    let mut bed = vec![0.0_f64; hops];
    let mut speaking = vec![false; hops];
    for element in &audible {
        let Some(media_id) = element.media_id() else {
            continue;
        };
        let Some(file_lufs) = loudness.get(media_id).copied() else {
            continue;
        };
        // A clip reading past the end of its own file plays nothing there. Modelling that is
        // what makes the measurement agree with what would actually be encoded: the project
        // this comes from has two narration clips whose files were later truncated to a third
        // of their length, and taking them at face value reported 6.6 LU more separation than
        // the file has. `past-source-end` reports the same two clips as an error of its own.
        let source_end = element.source_start().and_then(|trim| {
            let asset = project.media.iter().find(|asset| asset.id == media_id)?;
            Some(asset.source_duration()?.to_seconds_f64() - trim.to_seconds_f64())
        });
        let role = element.audio_role().unwrap_or_default();
        let start = element.start().to_seconds_f64();
        let finish = element.end().to_seconds_f64();
        let first = (start / HOP_SECONDS).floor().max(0.0) as usize;
        let last = ((finish / HOP_SECONDS).ceil() as usize).min(hops);
        for index in first..last {
            let at = index as f64 * HOP_SECONDS;
            if at < start || at >= finish {
                continue;
            }
            if source_end.is_some_and(|available| at - start >= available) {
                continue;
            }
            let Some(local) = MediaTime::from_seconds_f64(at - start) else {
                continue;
            };
            let Some(gain) = element.sampled_gain(local) else {
                continue;
            };
            if gain <= 0.0 {
                continue;
            }
            let level = file_lufs + 20.0 * f64::from(gain).log10();
            let power = 10.0_f64.powf(level / 10.0);
            total[index] += power;
            match role {
                AudioRole::Speech => speaking[index] = true,
                AudioRole::Bed => bed[index] += power,
                AudioRole::Sfx => {}
            }
        }
    }

    // Normalise to the level the file will be delivered at, because that is the scale an
    // absolute threshold means anything on. `loudnorm` shifts the whole programme by one
    // constant, so this changes every level and no difference between two of them.
    let authored = integrated(&total);
    let lift = authored.map(|level| DELIVERY_LUFS - level).unwrap_or(0.0);
    out.authored_lufs = authored;

    out.samples = (0..hops)
        .map(|index| MixSample {
            at_seconds: index as f64 * HOP_SECONDS,
            lufs: to_lufs(total[index]) + lift,
            bed_lufs: (bed[index] > SILENCE_POWER).then(|| to_lufs(bed[index]) + lift),
            speaking: speaking[index],
        })
        .collect();

    out.narration_lufs = median(
        out.samples
            .iter()
            .filter(|sample| sample.speaking)
            .map(|sample| sample.lufs)
            .collect(),
    );
    let floor = to_lufs(SILENCE_POWER) + lift;
    let gaps: Vec<&MixSample> = out
        .samples
        .iter()
        .filter(|sample| !sample.speaking && sample.lufs > floor)
        .collect();
    out.gap_lufs = median(gaps.iter().map(|sample| sample.lufs).collect());
    out.gap_bed_lufs = median(gaps.iter().filter_map(|sample| sample.bed_lufs).collect());

    out.peak_at_seconds = peak_window(&total);
    out.payoff_at_seconds = scene
        .markers
        .iter()
        .find(|marker| marker.label.trim().to_ascii_lowercase().contains("payoff"))
        .map(|marker| marker.time.to_seconds_f64());
    out
}

/// The programme's integrated loudness, gated the way R128 gates it: an absolute floor, then a
/// second pass excluding everything more than [`RELATIVE_GATE_LU`] under the ungated mean.
///
/// The gating is what makes a passage of silence free. Two mixes identical but for 2.8 s versus
/// 1.0 s of digital silence measure the same, which is why the silence a piece needs and the
/// level it delivers at are independent of each other.
fn integrated(power: &[f64]) -> Option<f64> {
    let absolute = 10.0_f64.powf(ABSOLUTE_GATE_LUFS / 10.0);
    let mean = |values: &[f64]| {
        let kept: Vec<f64> = values.iter().copied().filter(|p| *p > absolute).collect();
        (!kept.is_empty()).then(|| kept.iter().sum::<f64>() / kept.len() as f64)
    };
    let ungated = mean(power)?;
    let gate = ungated * 10.0_f64.powf(-RELATIVE_GATE_LU / 10.0);
    let gated: Vec<f64> = power.iter().copied().filter(|p| *p > gate).collect();
    let level = if gated.is_empty() {
        ungated
    } else {
        gated.iter().sum::<f64>() / gated.len() as f64
    };
    Some(to_lufs(level))
}

/// The middle value of a set of levels — the plateau of whichever state they describe.
fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    Some(values[values.len() / 2])
}

/// Where the loudest [`PEAK_WINDOW_SECONDS`] of the mix starts.
///
/// On the instantaneous series, not the short-term one: the question is where the biggest single
/// moment is, and a 3 s window would put the answer up to a second and a half away from it.
fn peak_window(power: &[f64]) -> Option<f64> {
    let width = ((PEAK_WINDOW_SECONDS / HOP_SECONDS).round() as usize).max(1);
    if power.len() < width {
        return None;
    }
    let mut best: Option<(usize, f64)> = None;
    for index in 0..=power.len() - width {
        let sum: f64 = power[index..index + width].iter().sum();
        if best.is_none_or(|(_, value)| sum > value) {
            best = Some((index, sum));
        }
    }
    best.filter(|(_, sum)| *sum > SILENCE_POWER)
        .map(|(index, _)| index as f64 * HOP_SECONDS)
}

fn to_lufs(power: f64) -> f64 {
    10.0 * power.max(SILENCE_POWER).log10()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{AnimationChannel, AudioElement, ElementSource};
    use crate::project::{AssetLoudness, MediaAsset};
    use crate::track::{Track, TrackKind};

    fn secs(n: f64) -> MediaTime {
        MediaTime::from_seconds_f64(n).expect("representable")
    }

    fn clip(
        id: &str,
        media: &str,
        start: f64,
        duration: f64,
        volume: f32,
        role: AudioRole,
    ) -> Element {
        Element::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: secs(start),
            duration: secs(duration),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: media.into(),
            muted: false,
            volume,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: ElementSource::Author,
            role,
        })
    }

    fn measured(id: &str, lufs: f32) -> MediaAsset {
        let mut asset = MediaAsset::new(id, format!("{id}.wav"), format!("/tmp/{id}.wav"));
        asset.loudness = Some(AssetLoudness {
            peak_db: -3.0,
            rms_db: lufs - 6.0,
            lufs,
            accent_seconds: Vec::new(),
        });
        asset
    }

    fn project_of(elements: Vec<Element>, media: Vec<MediaAsset>) -> Project {
        let mut project = Project::starter();
        project.media = media;
        let scene = project.active_scene_mut();
        scene.tracks.audio = vec![Track::new("track-audio", "Audio", TrackKind::Audio)];
        scene.tracks.audio[0].elements = elements;
        project
    }

    /// Three lines over a bed that never moves. Both states measure the same, which is the mix
    /// the whole module was written to be able to say something about.
    fn flat_project() -> Project {
        let mut elements = vec![clip("bed", "bed", 0.0, 30.0, 1.0, AudioRole::Bed)];
        for index in 0..3 {
            elements.push(clip(
                &format!("line-{index}"),
                "voice",
                2.0 + index as f64 * 10.0,
                5.0,
                1.0,
                AudioRole::Speech,
            ));
        }
        project_of(
            elements,
            vec![measured("bed", -20.0), measured("voice", -20.0)],
        )
    }

    #[test]
    fn a_bed_that_never_moves_has_no_separation() {
        let envelope = envelope(&flat_project());
        assert!(envelope.is_measurable());
        let separation = envelope.separation_lu().expect("both states occur");
        assert!(
            separation < MIN_SEPARATION_LU,
            "a bed at one level under and between the lines separates by {separation:.2} LU"
        );
    }

    /// A duck, and a bed sitting where the spec puts it — the voice at −15 LUFS-S and the bed
    /// between lines at −21.
    ///
    /// **The separation is not a measurement of automation.** A bed that ducks 8 dB but sits at
    /// the voice's own level between the lines still measures nothing, because the gap windows
    /// are as loud as the spoken ones — which is precisely the mix that shipped. What clears the
    /// floor is the two *states* differing, and the duck is how the quiet one gets to exist
    /// without the words landing inside the music.
    #[test]
    fn a_bed_that_ducks_and_sits_under_the_voice_separates() {
        let mut project = flat_project();
        {
            let bed = project.active_scene_mut().tracks.audio[0]
                .elements
                .iter_mut()
                .find(|element| element.id() == "bed")
                .expect("the bed");
            if let Element::Audio(audio) = bed {
                // 6 LU under the voice between lines…
                audio.volume = 0.5;
            }
            let mut channel = AnimationChannel::default();
            for index in 0..3 {
                let start = 2.0 + index as f64 * 10.0;
                channel.upsert(secs(start - 0.25), 0.5);
                // …and 8 dB further down under them.
                channel.upsert(secs(start - 0.1), 0.2);
                channel.upsert(secs(start + 5.15), 0.2);
                channel.upsert(secs(start + 5.65), 0.5);
            }
            bed.animations_mut()
                .expect("audio animates")
                .insert("volume".into(), channel);
        }
        let measured = envelope(&project);
        let separation = measured.separation_lu().expect("both states occur");
        assert!(
            separation >= MIN_SEPARATION_LU,
            "the spec's own levels should clear {MIN_SEPARATION_LU} LU, measured {separation:.2}"
        );
        // …and the bed is still audible between the lines, which is the other half of the
        // bracket. Both have to hold at once or the pair is satisfiable by deleting the music.
        let gap_bed = measured.gap_bed_lufs.expect("a bed in the gaps");
        assert!(
            gap_bed >= MIN_GAP_BED_LUFS,
            "the bed reads {gap_bed:.1} LUFS between lines, under the {MIN_GAP_BED_LUFS} floor"
        );
    }

    /// The normalisation the export applies. Two projects identical but for a constant on every
    /// asset's measured loudness deliver the same file, so they must measure the same — the
    /// absolute floor is on the delivered scale, not the authored one.
    #[test]
    fn a_quiet_master_is_not_a_quiet_mix() {
        let loud = envelope(&flat_project());
        let mut project = flat_project();
        for asset in &mut project.media {
            if let Some(loudness) = &mut asset.loudness {
                loudness.lufs -= 12.0;
            }
        }
        let quiet = envelope(&project);
        assert!(
            (loud.gap_lufs.expect("gaps") - quiet.gap_lufs.expect("gaps")).abs() < 0.01,
            "12 LU quieter everywhere is the same mix: {:?} vs {:?}",
            loud.gap_lufs,
            quiet.gap_lufs
        );
        assert!(
            (quiet.authored_lufs.expect("authored") - loud.authored_lufs.expect("authored") + 12.0)
                .abs()
                < 0.01,
            "…and the authored level says how far it had to be lifted"
        );
    }

    /// The gaming move the pair exists to bracket: delete the bed and the lines are infinitely
    /// louder than the silence between them. Separation passes; the floor does not.
    #[test]
    fn deleting_the_bed_buys_separation_and_fails_the_floor() {
        let mut project = flat_project();
        {
            let audio = &mut project.active_scene_mut().tracks.audio[0].elements;
            audio.retain(|element| element.id() != "bed");
            // Something has to remain in the gaps or there are no gap windows at all — a tick
            // 30 LU down is the cheapest possible "there is a bed here".
            audio.push(clip("tick", "tick", 8.0, 1.0, 0.02, AudioRole::Sfx));
        }
        project.media.push(measured("tick", -20.0));
        let envelope = envelope(&project);
        assert!(
            envelope.separation_lu().expect("both states") >= MIN_SEPARATION_LU,
            "deleting the bed does buy separation — that is why the floor exists"
        );
        assert!(
            envelope.gap_bed_lufs.is_none(),
            "there is no bed left to measure"
        );
    }

    /// An unmeasured asset is not a zero. Concluding anything from a mix containing one would be
    /// comparing a LUFS value against a bare multiplier.
    #[test]
    fn an_unprobed_asset_makes_the_mix_unmeasurable() {
        let mut project = flat_project();
        project.media.retain(|asset| asset.id != "bed");
        project
            .media
            .push(MediaAsset::new("bed", "bed.wav", "/tmp/bed.wav"));
        let envelope = envelope(&project);
        assert!(!envelope.is_measurable());
        assert_eq!(envelope.unmeasured, vec!["bed".to_string()]);
        assert!(envelope.separation_lu().is_none());
    }

    /// The file's own loudness is half the answer, and the half no gain number carries. Two
    /// projects with identical `volume` on every clip, differing only in what the bed file
    /// measures, are different mixes — and the quieter bed is the one whose lines stand out.
    #[test]
    fn the_files_own_loudness_moves_the_measurement() {
        let level = |lufs: f32| {
            let mut project = flat_project();
            for asset in &mut project.media {
                if asset.id == "bed"
                    && let Some(loudness) = &mut asset.loudness
                {
                    loudness.lufs = lufs;
                }
            }
            envelope(&project)
        };
        let loud = level(-20.0);
        let quiet = level(-35.0);
        // Not one gain changed between them.
        let separation = |envelope: &MixEnvelope| envelope.separation_lu().expect("both states");
        assert!(
            separation(&quiet) - separation(&loud) > 10.0,
            "a bed 15 LU quieter separates far further (measured 3.0 against 15.1): {:.2} vs \
             {:.2}",
            separation(&loud),
            separation(&quiet)
        );
        // …and the quiet one is the mix whose bed has stopped being audible between the lines,
        // which is the defect a gain of 2.0 on a -35 LUFS file was a rational response to.
        assert!(quiet.gap_bed_lufs.expect("a bed") < MIN_GAP_BED_LUFS);
        assert!(loud.gap_bed_lufs.expect("a bed") > MIN_GAP_BED_LUFS);
    }

    /// The argmax, which is the un-fakeable half: a table of levels makes everything equal, and
    /// this asks for exactly one thing to be unequal.
    #[test]
    fn the_loudest_moment_is_found_where_it_is() {
        let mut project = flat_project();
        project.active_scene_mut().tracks.audio[0]
            .elements
            .push(clip("hit", "hit", 24.0, 0.5, 1.0, AudioRole::Sfx));
        project.media.push(measured("hit", -4.0));
        let envelope = envelope(&project);
        let peak = envelope.peak_at_seconds.expect("something is loudest");
        assert!(
            (peak - 24.0).abs() <= 0.5,
            "the loudest 400 ms is at the impact, got {peak}"
        );
    }

    #[test]
    fn a_payoff_marker_is_read_off_the_timeline() {
        let mut project = flat_project();
        project
            .active_scene_mut()
            .markers
            .push(crate::scene::Marker {
                id: "m1".into(),
                time: secs(24.0),
                label: "Payoff".into(),
            });
        project.active_scene_mut().tracks.audio[0]
            .elements
            .push(clip("hit", "hit", 24.0, 0.5, 1.0, AudioRole::Sfx));
        project.media.push(measured("hit", -4.0));
        let envelope = envelope(&project);
        assert_eq!(envelope.payoff_at_seconds, Some(24.0));
        assert!(
            envelope
                .peak_to_payoff_seconds()
                .is_some_and(|apart| apart <= PAYOFF_TOLERANCE_SECONDS),
            "the loudest moment is at the payoff"
        );
    }

    /// Scaling every gain in the project by a constant is the move that satisfied the check
    /// this replaces. It must move the separation by nothing at all.
    #[test]
    fn scaling_every_gain_changes_nothing() {
        let before = envelope(&flat_project()).separation_lu().expect("states");
        let mut project = flat_project();
        for element in &mut project.active_scene_mut().tracks.audio[0].elements {
            if let Element::Audio(audio) = element {
                audio.volume *= 0.5;
            }
        }
        let after = envelope(&project).separation_lu().expect("states");
        assert!(
            (before - after).abs() < 1e-9,
            "{before} vs {after}: a constant on every gain is not a mix decision"
        );
    }

    /// A project with no speech has no narration windows, so there is nothing to separate and
    /// the envelope says so instead of reporting a difference against an empty set.
    #[test]
    fn music_with_no_voice_has_nothing_to_separate() {
        let project = project_of(
            vec![clip("bed", "bed", 0.0, 30.0, 1.0, AudioRole::Bed)],
            vec![measured("bed", -20.0)],
        );
        let envelope = envelope(&project);
        assert!(!envelope.has_speech);
        assert!(envelope.narration_lufs.is_none());
        assert!(envelope.separation_lu().is_none());
    }
}
