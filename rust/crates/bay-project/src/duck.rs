//! Ducking a bed under the lines it plays behind: four keyframes per line, on one clip.
//!
//! # Why this is a module and not an argument
//!
//! Every ingredient of a duck already existed — `volume` is keyframable, `sampled_gain` is what
//! both mixers read, and `animate`'s own description says a bed takes `volume` "which is how you
//! duck a music bed under narration instead of splitting it". None of it was used. The project
//! this comes from ducked by **cutting one music file into 13 clips with stepped gains**: 13
//! elements, 13 gain decisions, 12 overlap fudges to hide the seams, 13 `trimStart`
//! computations, and a transition time of **0 ms — a cliff** at every boundary. It also ran
//! backwards; the music-only stretches came out 1.1 dB *louder* than the narration.
//!
//! The reason is not ignorance. It is that keyframing it by hand means computing 24 keyframe
//! times from six line starts and six line ends, in the bed's own local coordinates, and
//! getting the attack/release asymmetry right at each one. **Where the lines are is something
//! bay already knows.** So the agent supplies the three numbers that are a mix decision — depth,
//! attack, release — and this derives the rest.
//!
//! What it replaces, over the same six lines: 24 keyframes on one element for 13 elements, and
//! changing the depth becomes one argument instead of a re-cut.

use crate::element::{AnimationChannel, Easing, Element, Keyframe};
use bay_time::MediaTime;

/// The mix decisions a duck actually has, with the values that make one inaudible.
///
/// Numbers from the mix spec, and each is a floor or a ceiling rather than taste:
/// under 60 ms of attack pumps audibly, over 400 ms masks the first syllable, and a release
/// faster than the attack is a pump rather than a recovery. **The asymmetry lives in the
/// timing, not in the curve shapes** — 150 ms down against 500 ms up — which is one number to
/// specify and one number to check.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DuckParams {
    /// How far the bed drops under a line, in dB. 8 dB takes a bed from −22 to −30 LUFS-S,
    /// which is the state difference that gives a narration-led mix its contour.
    pub depth_db: f32,
    /// How long the drop takes.
    pub attack_ms: f64,
    /// How long the recovery takes. Always longer than the attack.
    pub release_ms: f64,
    /// How far before the first word the drop begins. A duck that starts *on* the word is heard
    /// as a level jump; 250 ms earlier and it is heard as nothing at all.
    pub pre_roll_ms: f64,
    /// How long the bed stays down past the end of the line. Releasing on the final consonant
    /// clips the tail of the sentence.
    pub hold_ms: f64,
    /// Two lines closer together than this are ducked as one. A bed that recovers and re-ducks
    /// inside a second and a half breathes, and it is also how keyframe counts explode.
    pub join_gap_ms: f64,
}

impl Default for DuckParams {
    fn default() -> Self {
        Self {
            depth_db: 8.0,
            attack_ms: 150.0,
            release_ms: 500.0,
            pre_roll_ms: 250.0,
            hold_ms: 150.0,
            join_gap_ms: 1500.0,
        }
    }
}

/// The legal range of each parameter, as a pair of bounds and the reason for them.
const ATTACK_RANGE_MS: (f64, f64) = (60.0, 400.0);
const RELEASE_FLOOR_MS: f64 = 200.0;
const DEPTH_RANGE_DB: (f32, f32) = (3.0, 24.0);
const PRE_ROLL_CEILING_MS: f64 = 2000.0;
const HOLD_CEILING_MS: f64 = 2000.0;

impl DuckParams {
    /// Refuse a shape that is not a duck. Each of these is a sound somebody will hear go wrong,
    /// and refusing is cheaper than a warning nobody reads: a 20 ms attack pumps, a release
    /// shorter than the attack is the pump the asymmetry exists to avoid, and a 1 dB duck is
    /// automation that does nothing.
    pub fn validate(&self) -> Result<(), String> {
        if !self.depth_db.is_finite()
            || self.depth_db < DEPTH_RANGE_DB.0
            || self.depth_db > DEPTH_RANGE_DB.1
        {
            return Err(format!(
                "depthDb must be between {} and {} — {} is not a duck, it is either automation \
                 nobody can hear or the bed disappearing",
                DEPTH_RANGE_DB.0, DEPTH_RANGE_DB.1, self.depth_db
            ));
        }
        if !self.attack_ms.is_finite()
            || self.attack_ms < ATTACK_RANGE_MS.0
            || self.attack_ms > ATTACK_RANGE_MS.1
        {
            return Err(format!(
                "attackMs must be between {} and {} — under {} the drop pumps audibly, over {} \
                 it masks the first syllable",
                ATTACK_RANGE_MS.0, ATTACK_RANGE_MS.1, ATTACK_RANGE_MS.0, ATTACK_RANGE_MS.1
            ));
        }
        if !self.release_ms.is_finite() || self.release_ms < RELEASE_FLOOR_MS {
            return Err(format!(
                "releaseMs must be at least {RELEASE_FLOOR_MS} — a faster recovery is heard as \
                 the music surging back"
            ));
        }
        if self.release_ms <= self.attack_ms {
            return Err(format!(
                "releaseMs ({}) must be longer than attackMs ({}) — the asymmetry is the whole \
                 mechanism, and a duck that recovers as fast as it drops is a pump",
                self.release_ms, self.attack_ms
            ));
        }
        if !self.pre_roll_ms.is_finite() || !(0.0..=PRE_ROLL_CEILING_MS).contains(&self.pre_roll_ms)
        {
            return Err(format!(
                "preRollMs must be between 0 and {PRE_ROLL_CEILING_MS}"
            ));
        }
        if !self.hold_ms.is_finite() || !(0.0..=HOLD_CEILING_MS).contains(&self.hold_ms) {
            return Err(format!("holdMs must be between 0 and {HOLD_CEILING_MS}"));
        }
        if !self.join_gap_ms.is_finite() || self.join_gap_ms < 0.0 {
            return Err("joinGapMs must not be negative".into());
        }
        Ok(())
    }

    /// The gap below which two lines are ducked as one.
    ///
    /// Never shorter than the time it physically takes to come up and go back down, whatever
    /// was asked for: a shorter gap would emit a recovery that the next duck's pre-roll starts
    /// before, which is two keys at the same instant and a level that jumps.
    fn effective_join_gap_ms(&self) -> f64 {
        self.join_gap_ms
            .max(self.release_ms + self.pre_roll_ms + self.attack_ms)
    }
}

/// One key of the emitted curve, in the bed's own local time. Echoed back to the caller so the
/// duck it asked for is a thing it can read and adjust rather than a black box.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DuckKey {
    pub time: MediaTime,
    pub value: f32,
    pub easing: Easing,
}

/// What a duck turned into.
#[derive(Debug, Clone, PartialEq)]
pub struct Duck {
    pub channel: AnimationChannel,
    pub keys: Vec<DuckKey>,
    /// The merged line spans the curve was derived from, in timeline seconds — so a caller can
    /// see which lines got joined without re-deriving the rule.
    pub spans: Vec<(f64, f64)>,
    /// The level the bed sits at when nothing is over it, and where it goes under a line.
    pub base_gain: f32,
    pub ducked_gain: f32,
}

/// Derive the volume channel that gets `bed` out of the way of `under`.
///
/// `under` are the clips the bed has to make room for, in any order; overlapping and
/// close-together ones are merged first, so six narration clips with breaths between them
/// become however many ducks the join rule says, not six.
///
/// Errors rather than emitting nothing when there is nothing to duck under: an agent that asked
/// for a duck and got a silent success would believe it had one.
pub fn duck(bed: &Element, under: &[&Element], params: &DuckParams) -> Result<Duck, String> {
    let Element::Audio(audio) = bed else {
        return Err(format!(
            "{:?} is a {}, not an audio clip — only a sound can be ducked",
            bed.id(),
            bed.kind().label().to_lowercase()
        ));
    };
    params.validate()?;
    let bed_duration = bed.duration().to_seconds_f64();
    if bed_duration <= 0.0 {
        return Err(format!("{:?} has no duration", bed.id()));
    }

    let base = audio.volume;
    if !base.is_finite() || base <= 0.0 {
        return Err(format!(
            "{:?} plays at {base} — set a level with audio_set before ducking it, or the duck \
             has nothing to come back up to",
            bed.id()
        ));
    }
    let ducked = base * 10.0_f32.powf(-params.depth_db / 20.0);

    let spans = merged_spans(bed, under, params)?;
    if spans.is_empty() {
        return Err(format!(
            "none of those clips overlap {:?} — a duck is a bed getting out of the way of \
             something that is actually playing over it",
            bed.id()
        ));
    }

    let start = bed.start().to_seconds_f64();
    let mut keys: Vec<DuckKey> = Vec::new();
    for (from, to) in &spans {
        // Local time, because keyframes are measured from the element's own head.
        let drop_at = from - start - params.pre_roll_ms / 1000.0;
        let bottom_at = drop_at + params.attack_ms / 1000.0;
        let leave_at = to - start + params.hold_ms / 1000.0;
        let up_at = leave_at + params.release_ms / 1000.0;
        for (at, value, easing) in [
            (drop_at, base, Easing::EaseInOut),
            (bottom_at, ducked, Easing::Hold),
            (leave_at, ducked, Easing::SineInOut),
            (up_at, base, Easing::Hold),
        ] {
            // A duck running off either end of the bed is clamped rather than dropped: the bed
            // still has to be down while the line plays, even if the pre-roll would start
            // before the music does.
            let clamped = at.clamp(0.0, bed_duration);
            push_key(&mut keys, clamped, value, easing);
        }
    }
    // Every key before this holds `base`, which is where the clip already was; without it a bed
    // whose first duck starts at 18 s would be at its ducked level for the first 18 seconds,
    // because a channel clamps to its first key going backwards.
    if keys
        .first()
        .is_some_and(|first| first.time > MediaTime::ZERO)
    {
        keys.insert(
            0,
            DuckKey {
                time: MediaTime::ZERO,
                value: base,
                easing: Easing::Hold,
            },
        );
    }

    let mut channel = AnimationChannel {
        keys: Vec::new(),
        // Every segment carries its own curve, so the channel default is only what an
        // unlabelled key would travel on.
        easing: Easing::Linear,
    };
    for key in &keys {
        channel
            .keys
            .push(Keyframe::eased(key.time, key.value, key.easing));
    }

    Ok(Duck {
        channel,
        keys,
        spans,
        base_gain: base,
        ducked_gain: ducked,
    })
}

/// Add a key, dropping one that lands on a time already taken.
///
/// Two keys at one instant is a level that depends on sort order. It happens at the ends: a
/// pre-roll clamped to 0 and the previous release also clamped to 0 are the same moment, and the
/// one that has to survive is the one written first — the earlier line's recovery cannot undo a
/// drop that has already been decided for the later one.
fn push_key(keys: &mut Vec<DuckKey>, seconds: f64, value: f32, easing: Easing) {
    let Some(time) = MediaTime::from_seconds_f64(seconds) else {
        return;
    };
    if keys.last().is_some_and(|last| last.time >= time) {
        return;
    }
    keys.push(DuckKey {
        time,
        value,
        easing,
    });
}

/// The line spans, clipped to the bed and merged by the join rule.
fn merged_spans(
    bed: &Element,
    under: &[&Element],
    params: &DuckParams,
) -> Result<Vec<(f64, f64)>, String> {
    let (bed_start, bed_end) = (bed.start().to_seconds_f64(), bed.end().to_seconds_f64());
    let mut spans: Vec<(f64, f64)> = Vec::new();
    for element in under {
        if element.id() == bed.id() {
            return Err(format!(
                "{:?} cannot duck under itself — underIds are the clips it makes room for",
                bed.id()
            ));
        }
        let (from, to) = (
            element.start().to_seconds_f64().max(bed_start),
            element.end().to_seconds_f64().min(bed_end),
        );
        if to > from {
            spans.push((from, to));
        }
    }
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));

    let join = params.effective_join_gap_ms() / 1000.0;
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (from, to) in spans {
        match merged.last_mut() {
            Some(last) if from - last.1 < join => last.1 = last.1.max(to),
            _ => merged.push((from, to)),
        }
    }
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{AudioElement, AudioRole, ElementSource};

    fn secs(n: f64) -> MediaTime {
        MediaTime::from_seconds_f64(n).expect("representable")
    }

    fn clip(id: &str, start: f64, duration: f64, volume: f32, role: AudioRole) -> Element {
        Element::Audio(AudioElement {
            id: id.into(),
            name: id.into(),
            start: secs(start),
            duration: secs(duration),
            fade_in: MediaTime::ZERO,
            fade_out: MediaTime::ZERO,
            media_id: "m".into(),
            muted: false,
            volume,
            pan: 0.0,
            speed: 1.0,
            prosody: None,
            dialogue_chain: None,
            animations: Default::default(),
            trim_start: MediaTime::ZERO,
            source: ElementSource::Author,
            role,
        })
    }

    fn bed(duration: f64, volume: f32) -> Element {
        clip("bed", 0.0, duration, volume, AudioRole::Bed)
    }

    fn line(id: &str, start: f64, duration: f64) -> Element {
        clip(id, start, duration, 1.0, AudioRole::Speech)
    }

    /// The worked example, to the digit: `bay-narration-5` starts at 18.80 s and runs 10.30 s
    /// over a bed at 0.85, with gaps of 4.43 s and 4.70 s either side — so it ducks alone.
    #[test]
    fn one_line_is_four_keyframes_at_the_tabled_times() {
        let bed = bed(61.0, 0.85);
        let line = line("bay-narration-5", 18.80, 10.30);
        let ducked = duck(&bed, &[&line], &DuckParams::default()).expect("a duck");

        // The leading hold at t=0 plus four.
        let times: Vec<f64> = ducked
            .keys
            .iter()
            .map(|k| (k.time.to_seconds_f64() * 100.0).round() / 100.0)
            .collect();
        assert_eq!(times, vec![0.0, 18.55, 18.70, 29.25, 29.75], "{times:?}");
        assert!(
            (ducked.ducked_gain - 0.338).abs() < 0.001,
            "0.85 at 8 dB down is 0.338, got {}",
            ducked.ducked_gain
        );
        let easings: Vec<Easing> = ducked.keys.iter().skip(1).map(|k| k.easing).collect();
        assert_eq!(
            easings,
            vec![
                Easing::EaseInOut,
                Easing::Hold,
                Easing::SineInOut,
                Easing::Hold
            ],
            "both moving segments are corner-free at both ends"
        );
    }

    /// Six lines, one element. This is the whole point: what it replaces is 13 clips, 13 gains
    /// and 12 overlap fudges.
    #[test]
    fn six_lines_are_one_element_and_twenty_five_keys() {
        let bed = bed(61.0, 0.85);
        let lines: Vec<Element> = (0..6)
            .map(|index| line(&format!("line-{index}"), 2.0 + index as f64 * 10.0, 5.0))
            .collect();
        let refs: Vec<&Element> = lines.iter().collect();
        let ducked = duck(&bed, &refs, &DuckParams::default()).expect("a duck");
        assert_eq!(ducked.spans.len(), 6, "5 s gaps stay separate");
        assert_eq!(ducked.keys.len(), 25, "four per line plus the leading hold");
    }

    /// The join rule. Two lines a second apart are one duck, because a bed that recovers and
    /// re-ducks inside a second and a half breathes.
    #[test]
    fn lines_closer_than_the_join_gap_duck_as_one() {
        let bed = bed(30.0, 1.0);
        let (a, b) = (line("a", 2.0, 4.0), line("b", 7.0, 4.0));
        let ducked = duck(&bed, &[&a, &b], &DuckParams::default()).expect("a duck");
        assert_eq!(ducked.spans, vec![(2.0, 11.0)]);
        assert_eq!(ducked.keys.len(), 5, "one duck, not two: {:?}", ducked.keys);
    }

    /// …and far enough apart they do not. The rule is a threshold on the gap, not on the count.
    #[test]
    fn lines_further_apart_than_the_join_gap_duck_separately() {
        let bed = bed(30.0, 1.0);
        let (a, b) = (line("a", 2.0, 4.0), line("b", 12.0, 4.0));
        let ducked = duck(&bed, &[&a, &b], &DuckParams::default()).expect("a duck");
        assert_eq!(ducked.spans.len(), 2);
        assert_eq!(ducked.keys.len(), 9);
    }

    /// The emitted curve is what the mixers read, so it has to measure right through
    /// `sampled_gain` — the function the preview and the export both go through.
    #[test]
    fn the_curve_measures_the_asked_for_depth_through_the_mixer() {
        let mut bed = bed(30.0, 0.8);
        let line = line("a", 10.0, 6.0);
        let ducked = duck(&bed, &[&line], &DuckParams::default()).expect("a duck");
        bed.animations_mut()
            .expect("audio animates")
            .insert("volume".into(), ducked.channel);

        let under = bed.sampled_gain(secs(13.0)).expect("audio has a level");
        let between = bed.sampled_gain(secs(2.0)).expect("audio has a level");
        let separation = 20.0 * (between / under).log10();
        assert!(
            (separation - 8.0).abs() < 0.1,
            "8 dB was asked for, {separation:.2} dB came out"
        );
    }

    /// Timing asymmetry is the mechanism: 150 ms down against 500 ms up. Measured on the curve
    /// rather than on the arguments, because that is where a mistake would land.
    #[test]
    fn the_recovery_is_slower_than_the_drop() {
        let bed = bed(30.0, 1.0);
        let line = line("a", 10.0, 6.0);
        let ducked = duck(&bed, &[&line], &DuckParams::default()).expect("a duck");
        let t: Vec<f64> = ducked
            .keys
            .iter()
            .map(|k| k.time.to_seconds_f64())
            .collect();
        let attack = t[2] - t[1];
        let release = t[4] - t[3];
        assert!((attack - 0.15).abs() < 1e-6, "attack {attack}");
        assert!((release - 0.5).abs() < 1e-6, "release {release}");
        assert!(release > attack);
    }

    /// A bed whose first duck is 18 s in must play at its own level for those 18 seconds. A
    /// channel clamps to its first key going backwards, so without a leading hold the whole
    /// opening would be ducked under nothing.
    #[test]
    fn the_bed_plays_at_its_own_level_before_the_first_line() {
        let mut bed = bed(61.0, 0.85);
        let line = line("a", 18.8, 10.3);
        let ducked = duck(&bed, &[&line], &DuckParams::default()).expect("a duck");
        bed.animations_mut()
            .expect("audio animates")
            .insert("volume".into(), ducked.channel);
        assert_eq!(bed.sampled_gain(secs(1.0)), Some(0.85));
        assert_eq!(bed.sampled_gain(secs(45.0)), Some(0.85));
    }

    /// Six ducks is 24 eased keys, which the export's expression budget could not carry before
    /// it learned to decimate. Asserted here in keys so the model half of that contract has its
    /// own test.
    #[test]
    fn a_full_length_duck_stays_inside_a_readable_number_of_keys() {
        let bed = bed(61.0, 0.85);
        let lines: Vec<Element> = (0..6)
            .map(|index| line(&format!("l{index}"), 2.0 + index as f64 * 10.0, 5.0))
            .collect();
        let refs: Vec<&Element> = lines.iter().collect();
        let ducked = duck(&bed, &refs, &DuckParams::default()).expect("a duck");
        assert!(ducked.keys.len() <= 25, "{}", ducked.keys.len());
    }

    #[test]
    fn a_pump_is_refused_by_name() {
        let bed = bed(30.0, 1.0);
        let line = line("a", 10.0, 6.0);
        let fast = DuckParams {
            attack_ms: 300.0,
            release_ms: 250.0,
            ..DuckParams::default()
        };
        let error = duck(&bed, &[&line], &fast).expect_err("a release under the attack pumps");
        assert!(error.contains("releaseMs"), "{error}");

        let clicky = DuckParams {
            attack_ms: 20.0,
            ..DuckParams::default()
        };
        let error = duck(&bed, &[&line], &clicky).expect_err("20 ms pumps");
        assert!(error.contains("attackMs"), "{error}");
    }

    #[test]
    fn a_line_that_never_plays_over_the_bed_is_an_error_not_an_empty_curve() {
        let bed = clip("bed", 0.0, 10.0, 1.0, AudioRole::Bed);
        let line = line("a", 40.0, 5.0);
        let error = duck(&bed, &[&line], &DuckParams::default()).expect_err("no overlap");
        assert!(error.contains("overlap"), "{error}");
    }

    /// A line running to the very end of the bed still gets a drop, with its recovery clamped
    /// to the end of the clip rather than written past it.
    #[test]
    fn a_duck_running_off_the_end_is_clamped_not_dropped() {
        let bed = bed(20.0, 1.0);
        let line = line("a", 15.0, 5.0);
        let ducked = duck(&bed, &[&line], &DuckParams::default()).expect("a duck");
        let last = ducked.keys.last().expect("keys");
        assert!(
            last.time.to_seconds_f64() <= 20.0,
            "{:?}",
            last.time.to_seconds_f64()
        );
        assert!(
            ducked.keys.iter().any(|k| k.value < 0.5),
            "the bed still gets out of the way: {:?}",
            ducked.keys
        );
    }
}
