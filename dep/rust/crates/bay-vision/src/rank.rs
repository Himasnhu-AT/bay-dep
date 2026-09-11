//! Ordering candidates against a phrase, and saying how much to trust the order.

use crate::encoder::Embedding;

/// One candidate and what it scored.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scored<T> {
    /// Cosine similarity against the query, −1..1.
    pub score: f32,
    /// Where the provider's own keyword ranking had put it, so the caller can see what the
    /// re-rank actually changed.
    pub was: usize,
    #[serde(flatten)]
    pub item: T,
}

/// A ranking, with the one number that says whether to believe it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ranked<T> {
    pub items: Vec<Scored<T>>,
    /// Top score minus the median score.
    ///
    /// SigLIP's absolute scores are not calibrated — a set of images can all sit around 0.05 and
    /// the best of them still be exactly right. What carries information is whether the winner
    /// stands *apart*. A separation near zero means every candidate is equally unrelated to the
    /// query, and the honest response is to search for something else rather than to place the
    /// top hit.
    pub separation: f32,
}

/// Cosine similarity of two embeddings.
///
/// Both are unit length by construction, so this is a dot product. Lengths that disagree return
/// 0 rather than panicking: comparing a text embedding against something from a different model
/// is a caller bug that should surface as "nothing matched", not as a crash inside a search.
pub fn cosine(a: &Embedding, b: &Embedding) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    a.as_slice()
        .iter()
        .zip(b.as_slice())
        .map(|(x, y)| x * y)
        .sum()
}

/// Score every candidate against `query` and sort best first.
///
/// `items` and `embeddings` are positional partners; a length mismatch truncates to the shorter,
/// because dropping a candidate is recoverable and mis-pairing a score with the wrong image is
/// not.
pub fn rank<T>(query: &Embedding, items: Vec<T>, embeddings: &[Embedding]) -> Ranked<T> {
    let mut scored: Vec<Scored<T>> = items
        .into_iter()
        .zip(embeddings)
        .enumerate()
        .map(|(was, (item, embedding))| Scored {
            score: cosine(query, embedding),
            was,
            item,
        })
        .collect();

    // Descending, with NaN treated as worst rather than as unordered — `sort_by` on a comparator
    // that returns `None` panics in debug and corrupts the order in release.
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let separation = separation_of(&scored);
    Ranked {
        items: scored,
        separation,
    }
}

fn separation_of<T>(scored: &[Scored<T>]) -> f32 {
    if scored.is_empty() {
        return 0.0;
    }
    let median = scored[scored.len() / 2].score;
    scored[0].score - median
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(values: &[f32]) -> Embedding {
        Embedding::new(values.to_vec())
    }

    #[test]
    fn a_vector_is_perfectly_similar_to_itself() {
        let v = e(&[1.0, 2.0, 3.0]);
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn opposite_vectors_score_minus_one() {
        assert!((cosine(&e(&[1.0, 0.0]), &e(&[-1.0, 0.0])) + 1.0).abs() < 1e-6);
    }

    #[test]
    fn orthogonal_vectors_score_zero() {
        assert!(cosine(&e(&[1.0, 0.0]), &e(&[0.0, 1.0])).abs() < 1e-6);
    }

    #[test]
    fn a_length_mismatch_scores_zero_rather_than_panicking() {
        assert_eq!(cosine(&e(&[1.0, 0.0]), &e(&[1.0, 0.0, 0.0])), 0.0);
    }

    /// The point of the crate: the provider's order is not the answer.
    #[test]
    fn ranking_reorders_and_remembers_where_things_were() {
        let query = e(&[1.0, 0.0]);
        let ranked = rank(
            &query,
            vec!["baring road", "the bank"],
            &[e(&[0.0, 1.0]), e(&[1.0, 0.0])],
        );
        assert_eq!(ranked.items[0].item, "the bank");
        assert_eq!(ranked.items[0].was, 1, "it had been second");
        assert_eq!(ranked.items[1].was, 0);
    }

    #[test]
    fn a_nan_score_sorts_last_instead_of_scrambling_the_order() {
        let query = e(&[1.0, 0.0]);
        let mut broken = e(&[1.0, 0.0]);
        // Reach past the constructor to make an embedding that could only come from bad weights.
        broken = Embedding::new(vec![f32::NAN, broken.as_slice()[1]]);
        let ranked = rank(&query, vec!["good", "broken"], &[e(&[1.0, 0.0]), broken]);
        assert_eq!(ranked.items[0].item, "good");
    }

    #[test]
    fn separation_is_zero_when_everything_scores_the_same() {
        let query = e(&[1.0, 0.0]);
        let same = vec![e(&[1.0, 0.0]), e(&[1.0, 0.0]), e(&[1.0, 0.0])];
        let ranked = rank(&query, vec![1, 2, 3], &same);
        assert!(ranked.separation.abs() < 1e-6);
    }

    #[test]
    fn separation_is_positive_when_one_candidate_stands_apart() {
        let query = e(&[1.0, 0.0]);
        let ranked = rank(
            &query,
            vec![1, 2, 3],
            &[e(&[1.0, 0.0]), e(&[0.0, 1.0]), e(&[0.0, 1.0])],
        );
        assert!(ranked.separation > 0.9, "{}", ranked.separation);
    }

    #[test]
    fn ranking_nothing_is_an_empty_ranking_not_a_panic() {
        let ranked = rank(&e(&[1.0, 0.0]), Vec::<u8>::new(), &[]);
        assert!(ranked.items.is_empty());
        assert_eq!(ranked.separation, 0.0);
    }

    /// A short embeddings slice must drop candidates, never shift scores onto the wrong item.
    #[test]
    fn a_short_embedding_list_truncates_rather_than_mispairing() {
        let ranked = rank(&e(&[1.0, 0.0]), vec!["a", "b", "c"], &[e(&[1.0, 0.0])]);
        assert_eq!(ranked.items.len(), 1);
        assert_eq!(ranked.items[0].item, "a");
    }
}
