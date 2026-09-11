//! Lightweight local speaker clustering fused into bay's transcript utterances.
//!
//! Whisper supplies the words and utterance boundaries. For each utterance this module measures
//! pitch, zero-crossing rate, spectral flux and energy from the original audio, clusters those
//! measurements, and writes the resulting speaker label back onto both utterances and words.

use crate::{ListenError, Transcript};

const SAMPLE_RATE: u32 = 16_000;
const SPECTRAL_BANDS: usize = 12;
const FEATURE_DIMENSIONS: usize = SPECTRAL_BANDS + 4;
type AcousticFeature = [f32; FEATURE_DIMENSIONS];

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizationSummary {
    pub speakers: usize,
    pub labelled_utterances: usize,
    pub method: &'static str,
    /// Mean nearest-vs-next-cluster distance margin in `0..=1`.
    pub confidence: f32,
    /// True when the requested speaker count was not found or cluster separation is weak.
    pub low_confidence: bool,
}

pub fn diarize_file(
    media_path: &str,
    transcript: &mut Transcript,
    speakers: usize,
) -> Result<DiarizationSummary, ListenError> {
    let pcm = bay_audio::decode_pcm(media_path, SAMPLE_RATE)
        .ok_or_else(|| ListenError::Decode(media_path.to_string()))?;
    let channels = usize::from(pcm.channels.max(1));
    let mono = if channels == 1 {
        pcm.samples
    } else {
        pcm.samples
            .chunks_exact(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };
    Ok(diarize_pcm(&mono, transcript, speakers))
}

pub fn diarize_pcm(
    mono: &[f32],
    transcript: &mut Transcript,
    speakers: usize,
) -> DiarizationSummary {
    let count = transcript.utterances.len();
    if count == 0 {
        return DiarizationSummary {
            speakers: 0,
            labelled_utterances: 0,
            method: "word-level-acoustic-clustering",
            confidence: 0.0,
            low_confidence: true,
        };
    }
    let word_count = transcript.words.len();
    if word_count == 0 {
        return DiarizationSummary {
            speakers: 0,
            labelled_utterances: 0,
            method: "word-level-acoustic-clustering",
            confidence: 0.0,
            low_confidence: true,
        };
    }
    let k = speakers.clamp(1, word_count.min(8));
    let mut features = transcript
        .words
        .iter()
        .map(|word| {
            let (start_seconds, end_seconds) =
                padded_word_window(word.start_seconds, word.end_seconds);
            let start = seconds_to_sample(start_seconds, mono.len());
            let end = seconds_to_sample(end_seconds, mono.len()).max(start);
            acoustic_features(mono.get(start..end).unwrap_or_default())
        })
        .collect::<Vec<_>>();
    normalize(&mut features);
    let assignments = smooth_assignments(&features, &cluster(&features, k), &transcript.words, k);

    // Stable human-facing labels: lower normalised pitch is speaker-1. K-means cluster ids are
    // initialization details and must not make persisted labels change between runs.
    let mut ordered = (0..k)
        .map(|cluster_id| {
            let values = assignments
                .iter()
                .enumerate()
                .filter_map(|(index, assigned)| {
                    (*assigned == cluster_id).then_some(features[index][SPECTRAL_BANDS])
                })
                .collect::<Vec<_>>();
            let mean = if values.is_empty() {
                f32::MAX
            } else {
                values.iter().sum::<f32>() / values.len() as f32
            };
            (cluster_id, mean)
        })
        .collect::<Vec<_>>();
    ordered.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut labels = vec![0usize; k];
    for (label, (cluster_id, _)) in ordered.into_iter().enumerate() {
        labels[cluster_id] = label + 1;
    }

    let actual_speakers = {
        let mut present = vec![false; k];
        for cluster_id in &assignments {
            present[*cluster_id] = true;
        }
        present.into_iter().filter(|present| *present).count()
    };
    let confidence = cluster_confidence(&features, &assignments, k);
    let low_confidence = actual_speakers != k || confidence < 0.5;
    if low_confidence {
        // Wrong populated labels are worse than no labels: callers naturally trust a non-empty
        // `speaker` field. Clear stale labels as well, since this transcript may have been
        // diarized by an earlier run that falsely reported the requested cluster count.
        for word in &mut transcript.words {
            word.speaker = None;
        }
        for utterance in &mut transcript.utterances {
            utterance.speaker = None;
        }
        return DiarizationSummary {
            speakers: 0,
            labelled_utterances: 0,
            method: "word-level-acoustic-clustering",
            confidence,
            low_confidence: true,
        };
    }
    for (word, &cluster_id) in transcript.words.iter_mut().zip(&assignments) {
        let speaker = format!("speaker-{}", labels[cluster_id]);
        word.speaker = Some(speaker);
    }
    for utterance in &mut transcript.utterances {
        let mut votes = vec![0usize; k];
        for cluster_id in assignments
            .get(utterance.word_start..utterance.word_end)
            .unwrap_or_default()
        {
            votes[*cluster_id] += 1;
        }
        let cluster_id = votes
            .iter()
            .enumerate()
            .max_by_key(|(_, votes)| *votes)
            .map(|(cluster_id, _)| cluster_id)
            .unwrap_or(0);
        let speaker = format!("speaker-{}", labels[cluster_id]);
        utterance.speaker = Some(speaker);
    }
    DiarizationSummary {
        speakers: actual_speakers,
        labelled_utterances: count,
        method: "word-level-acoustic-clustering",
        confidence,
        low_confidence: false,
    }
}

fn padded_word_window(start: f64, end: f64) -> (f64, f64) {
    const MIN_SECONDS: f64 = 1.5;
    let duration = (end - start).max(0.0);
    if duration >= MIN_SECONDS {
        (start, end)
    } else {
        let middle = (start + end) * 0.5;
        (
            (middle - MIN_SECONDS * 0.5).max(0.0),
            middle + MIN_SECONDS * 0.5,
        )
    }
}

fn seconds_to_sample(seconds: f64, len: usize) -> usize {
    (seconds.max(0.0) * f64::from(SAMPLE_RATE))
        .round()
        .clamp(0.0, len as f64) as usize
}

/// A compact speaker embedding: relative log energy in twelve speech bands, followed by pitch,
/// zero-crossing rate, spectral flux, and log energy.
fn acoustic_features(samples: &[f32]) -> AcousticFeature {
    if samples.len() < 64 {
        return [0.0; FEATURE_DIMENSIONS];
    }
    let mean = samples.iter().sum::<f32>() / samples.len() as f32;
    let centered = samples.iter().map(|value| value - mean).collect::<Vec<_>>();
    let energy = centered.iter().map(|value| value * value).sum::<f32>() / centered.len() as f32;
    let crossings = centered
        .windows(2)
        .filter(|pair| pair[0].is_sign_positive() != pair[1].is_sign_positive())
        .count() as f32
        / centered.len() as f32;
    let flux = centered
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .sum::<f32>()
        / centered.len() as f32;

    let window = &centered[..centered.len().min(SAMPLE_RATE as usize / 10)];
    let mut best_lag = 0usize;
    let mut best_correlation = f32::NEG_INFINITY;
    for lag in 40..=400.min(window.len().saturating_sub(1)) {
        let correlation = window[..window.len() - lag]
            .iter()
            .zip(&window[lag..])
            .map(|(a, b)| a * b)
            .sum::<f32>();
        if correlation > best_correlation {
            best_correlation = correlation;
            best_lag = lag;
        }
    }
    let pitch = if best_lag == 0 {
        0.0
    } else {
        SAMPLE_RATE as f32 / best_lag as f32
    };
    let frequencies = [
        100.0, 150.0, 220.0, 320.0, 470.0, 680.0, 1_000.0, 1_450.0, 2_100.0, 3_000.0, 4_300.0,
        6_000.0,
    ];
    let frame_len = (SAMPLE_RATE as usize * 25 / 1_000).min(centered.len());
    let frame_count = ((centered.len() / frame_len.max(1)).clamp(1, 8)).min(8);
    let mut feature = [0.0; FEATURE_DIMENSIONS];
    for frame_index in 0..frame_count {
        let available = centered.len().saturating_sub(frame_len);
        let start = if frame_count == 1 {
            0
        } else {
            frame_index * available / (frame_count - 1)
        };
        let frame = &centered[start..start + frame_len];
        for (band, frequency) in frequencies.iter().enumerate() {
            feature[band] += goertzel_power(frame, *frequency).max(1e-12).ln();
        }
    }
    for value in &mut feature[..SPECTRAL_BANDS] {
        *value /= frame_count as f32;
    }
    let spectral_mean = feature[..SPECTRAL_BANDS].iter().sum::<f32>() / SPECTRAL_BANDS as f32;
    for value in &mut feature[..SPECTRAL_BANDS] {
        *value -= spectral_mean;
    }
    feature[SPECTRAL_BANDS] = pitch;
    feature[SPECTRAL_BANDS + 1] = crossings;
    feature[SPECTRAL_BANDS + 2] = flux;
    feature[SPECTRAL_BANDS + 3] = (energy + 1e-9).ln();
    feature
}

fn goertzel_power(samples: &[f32], frequency: f32) -> f32 {
    let coefficient = 2.0 * (std::f32::consts::TAU * frequency / SAMPLE_RATE as f32).cos();
    let mut previous = 0.0;
    let mut before_previous = 0.0;
    for (index, sample) in samples.iter().enumerate() {
        let window = if samples.len() <= 1 {
            1.0
        } else {
            0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / (samples.len() - 1) as f32).cos()
        };
        let value = sample * window + coefficient * previous - before_previous;
        before_previous = previous;
        previous = value;
    }
    previous * previous + before_previous * before_previous
        - coefficient * previous * before_previous
}

fn normalize(features: &mut [AcousticFeature]) {
    for dimension in 0..FEATURE_DIMENSIONS {
        let mean = features
            .iter()
            .map(|feature| feature[dimension])
            .sum::<f32>()
            / features.len() as f32;
        let variance = features
            .iter()
            .map(|feature| (feature[dimension] - mean).powi(2))
            .sum::<f32>()
            / features.len() as f32;
        let deviation = variance.sqrt();
        if deviation < 1e-3 {
            for feature in features.iter_mut() {
                feature[dimension] = 0.0;
            }
            continue;
        }
        for feature in features.iter_mut() {
            feature[dimension] = (feature[dimension] - mean) / deviation;
        }
    }
}

fn cluster(features: &[AcousticFeature], k: usize) -> Vec<usize> {
    if k == 1 {
        return vec![0; features.len()];
    }
    let mut centroid_indices = vec![0usize];
    while centroid_indices.len() < k {
        let next = (0..features.len())
            .filter(|index| !centroid_indices.contains(index))
            .max_by(|left, right| {
                let left_distance = centroid_indices
                    .iter()
                    .map(|centroid| distance(&features[*left], &features[*centroid]))
                    .fold(f32::INFINITY, f32::min);
                let right_distance = centroid_indices
                    .iter()
                    .map(|centroid| distance(&features[*right], &features[*centroid]))
                    .fold(f32::INFINITY, f32::min);
                left_distance.total_cmp(&right_distance)
            })
            .unwrap_or(0);
        centroid_indices.push(next);
    }
    let mut centroids = centroid_indices
        .into_iter()
        .map(|index| features[index])
        .collect::<Vec<_>>();
    let mut assignments = vec![0usize; features.len()];
    for _ in 0..20 {
        for (index, feature) in features.iter().enumerate() {
            assignments[index] = centroids
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| distance(feature, a).total_cmp(&distance(feature, b)))
                .map(|(cluster, _)| cluster)
                .unwrap_or(0);
        }
        let mut empty = Vec::new();
        for (cluster_id, centroid) in centroids.iter_mut().enumerate() {
            let members = features
                .iter()
                .zip(&assignments)
                .filter_map(|(feature, assigned)| (*assigned == cluster_id).then_some(feature))
                .collect::<Vec<_>>();
            if !members.is_empty() {
                for dimension in 0..FEATURE_DIMENSIONS {
                    centroid[dimension] = members
                        .iter()
                        .map(|feature| feature[dimension])
                        .sum::<f32>()
                        / members.len() as f32;
                }
            } else {
                empty.push(cluster_id);
            }
        }
        for cluster_id in empty {
            if let Some((index, _)) =
                features
                    .iter()
                    .enumerate()
                    .max_by(|(left_index, left), (right_index, right)| {
                        distance(left, &centroids[assignments[*left_index]])
                            .total_cmp(&distance(right, &centroids[assignments[*right_index]]))
                    })
            {
                assignments[index] = cluster_id;
                centroids[cluster_id] = features[index];
            }
        }
    }
    assignments
}

/// Decode the cluster sequence globally instead of accepting independent word decisions.
///
/// A voice does not change for one word and immediately change back. The transition cost removes
/// those populated-looking single-word flips while still permitting a real turn as soon as
/// sustained acoustic evidence outweighs it. Pauses reduce the cost because they are natural turn
/// boundaries.
fn smooth_assignments(
    features: &[AcousticFeature],
    initial: &[usize],
    words: &[crate::TranscriptWord],
    k: usize,
) -> Vec<usize> {
    if features.is_empty() || k <= 1 {
        return initial.to_vec();
    }
    let centroids = centroids(features, initial, k);
    let mut costs = vec![vec![f32::INFINITY; k]; features.len()];
    let mut previous = vec![vec![0usize; k]; features.len()];
    for cluster_id in 0..k {
        costs[0][cluster_id] = distance(&features[0], &centroids[cluster_id]);
    }
    for index in 1..features.len() {
        let gap = (words[index].start_seconds - words[index - 1].end_seconds).max(0.0);
        let transition_cost = if gap >= 0.5 {
            20.0
        } else if gap >= 0.2 {
            50.0
        } else {
            100.0
        };
        for cluster_id in 0..k {
            let emission = distance(&features[index], &centroids[cluster_id]);
            let (best_previous, best_cost) = (0..k)
                .map(|previous_id| {
                    (
                        previous_id,
                        costs[index - 1][previous_id]
                            + if previous_id == cluster_id {
                                0.0
                            } else {
                                transition_cost
                            },
                    )
                })
                .min_by(|(_, left), (_, right)| left.total_cmp(right))
                .unwrap_or((0, 0.0));
            costs[index][cluster_id] = best_cost + emission;
            previous[index][cluster_id] = best_previous;
        }
    }
    let mut assignments = vec![0usize; features.len()];
    assignments[features.len() - 1] = costs[features.len() - 1]
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| left.total_cmp(right))
        .map(|(cluster_id, _)| cluster_id)
        .unwrap_or(0);
    for index in (1..features.len()).rev() {
        assignments[index - 1] = previous[index][assignments[index]];
    }
    assignments
}

fn centroids(
    features: &[AcousticFeature],
    assignments: &[usize],
    k: usize,
) -> Vec<AcousticFeature> {
    let mut centroids = vec![[0.0; FEATURE_DIMENSIONS]; k];
    let mut counts = vec![0usize; k];
    for (feature, cluster_id) in features.iter().zip(assignments) {
        counts[*cluster_id] += 1;
        for (value, sample) in centroids[*cluster_id].iter_mut().zip(feature) {
            *value += sample;
        }
    }
    for (centroid, count) in centroids.iter_mut().zip(counts) {
        if count > 0 {
            for value in centroid {
                *value /= count as f32;
            }
        }
    }
    centroids
}

fn cluster_confidence(features: &[AcousticFeature], assignments: &[usize], k: usize) -> f32 {
    if k <= 1 {
        return 1.0;
    }
    let centroids = centroids(features, assignments, k);
    features
        .iter()
        .zip(assignments)
        .map(|(feature, own)| {
            let own_distance = distance(feature, &centroids[*own]);
            let next_distance = centroids
                .iter()
                .enumerate()
                .filter_map(|(cluster_id, centroid)| {
                    (cluster_id != *own).then_some(distance(feature, centroid))
                })
                .fold(f32::INFINITY, f32::min);
            ((next_distance - own_distance) / next_distance.max(1e-6)).clamp(0.0, 1.0)
        })
        .sum::<f32>()
        / features.len() as f32
}

fn distance(a: &AcousticFeature, b: &AcousticFeature) -> f32 {
    a.iter()
        .zip(b)
        .map(|(left, right)| (left - right).powi(2))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TranscriptUtterance, TranscriptWord};

    #[test]
    fn two_distinct_voices_label_utterances_and_their_words() {
        let mut pcm = Vec::new();
        for index in 0..(SAMPLE_RATE * 4) {
            let frequency = if index < SAMPLE_RATE * 2 {
                110.0
            } else {
                230.0
            };
            pcm.push(
                (std::f32::consts::TAU * frequency * index as f32 / SAMPLE_RATE as f32).sin() * 0.3,
            );
        }
        let mut transcript = Transcript {
            language: "en".into(),
            model: "test".into(),
            duration_seconds: 4.0,
            words: vec![
                TranscriptWord {
                    text: "low".into(),
                    start_seconds: 0.0,
                    end_seconds: 1.0,
                    confidence: 1.0,
                    speaker: None,
                },
                TranscriptWord {
                    text: "high".into(),
                    start_seconds: 2.0,
                    end_seconds: 3.0,
                    confidence: 1.0,
                    speaker: None,
                },
            ],
            utterances: vec![
                TranscriptUtterance {
                    text: "low".into(),
                    start_seconds: 0.0,
                    end_seconds: 1.0,
                    speaker: None,
                    word_start: 0,
                    word_end: 1,
                },
                TranscriptUtterance {
                    text: "high".into(),
                    start_seconds: 2.0,
                    end_seconds: 3.0,
                    speaker: None,
                    word_start: 1,
                    word_end: 2,
                },
            ],
        };
        let summary = diarize_pcm(&pcm, &mut transcript, 2);
        assert_eq!(summary.speakers, 2);
        assert_ne!(
            transcript.utterances[0].speaker,
            transcript.utterances[1].speaker
        );
        assert_eq!(
            transcript.words[0].speaker,
            transcript.utterances[0].speaker
        );
        assert_eq!(
            transcript.words[1].speaker,
            transcript.utterances[1].speaker
        );
    }

    #[test]
    fn a_speaker_change_inside_one_whisper_utterance_is_kept_at_word_level() {
        let mut pcm = Vec::new();
        for index in 0..(SAMPLE_RATE * 4) {
            let frequency = if index < SAMPLE_RATE * 2 {
                110.0
            } else {
                230.0
            };
            pcm.push(
                (std::f32::consts::TAU * frequency * index as f32 / SAMPLE_RATE as f32).sin() * 0.3,
            );
        }
        let mut transcript = Transcript {
            language: "en".into(),
            model: "test".into(),
            duration_seconds: 4.0,
            words: vec![
                TranscriptWord {
                    text: "question".into(),
                    start_seconds: 0.2,
                    end_seconds: 1.8,
                    confidence: 1.0,
                    speaker: None,
                },
                TranscriptWord {
                    text: "answer".into(),
                    start_seconds: 2.2,
                    end_seconds: 3.8,
                    confidence: 1.0,
                    speaker: None,
                },
            ],
            utterances: vec![TranscriptUtterance {
                text: "question answer".into(),
                start_seconds: 0.2,
                end_seconds: 3.8,
                speaker: None,
                word_start: 0,
                word_end: 2,
            }],
        };

        let summary = diarize_pcm(&pcm, &mut transcript, 2);

        assert_eq!(summary.speakers, 2);
        assert_ne!(transcript.words[0].speaker, transcript.words[1].speaker);
        assert!(transcript.utterances[0].speaker.is_some());
    }

    #[test]
    fn one_voice_requested_as_two_is_reported_as_low_confidence_without_labels() {
        let pcm = (0..(SAMPLE_RATE * 4))
            .map(|index| {
                (std::f32::consts::TAU * 140.0 * index as f32 / SAMPLE_RATE as f32).sin() * 0.3
            })
            .collect::<Vec<_>>();
        let mut transcript = Transcript {
            language: "en".into(),
            model: "test".into(),
            duration_seconds: 4.0,
            words: vec![
                TranscriptWord {
                    text: "same".into(),
                    start_seconds: 0.2,
                    end_seconds: 1.8,
                    confidence: 1.0,
                    speaker: Some("stale-label".into()),
                },
                TranscriptWord {
                    text: "voice".into(),
                    start_seconds: 2.2,
                    end_seconds: 3.8,
                    confidence: 1.0,
                    speaker: Some("stale-label".into()),
                },
            ],
            utterances: vec![
                TranscriptUtterance {
                    text: "same".into(),
                    start_seconds: 0.2,
                    end_seconds: 1.8,
                    speaker: Some("stale-label".into()),
                    word_start: 0,
                    word_end: 1,
                },
                TranscriptUtterance {
                    text: "voice".into(),
                    start_seconds: 2.2,
                    end_seconds: 3.8,
                    speaker: Some("stale-label".into()),
                    word_start: 1,
                    word_end: 2,
                },
            ],
        };

        let summary = diarize_pcm(&pcm, &mut transcript, 2);

        assert!(summary.low_confidence, "{summary:?}");
        assert_eq!(summary.speakers, 0);
        assert_eq!(summary.labelled_utterances, 0);
        assert!(transcript.words.iter().all(|word| word.speaker.is_none()));
        assert!(
            transcript
                .utterances
                .iter()
                .all(|utterance| utterance.speaker.is_none())
        );
    }
}
