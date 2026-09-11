//! Ceilings on the catalog responses, so they cannot silently regrow.
//!
//! `optimizations.md` §2.2 measured these as the dominant per-session cost: `apply_move{}` and
//! `looks_list{}` each carried the whole move registry through `Move::describe`, so two
//! orientation calls cost more context than the entire 101-tool schema list. They summarise now,
//! and a caller who wants one move's channels and directions asks for that move by name.
//!
//! The ceilings are round numbers a little above the measured size — enough headroom to add a
//! move without a failing test, tight enough that adding a field to every move is noticed.

/// One JSON blob's size on the wire.
fn bytes(value: &serde_json::Value) -> usize {
    serde_json::to_string(value).unwrap().len()
}

fn summaries() -> Vec<serde_json::Value> {
    bay_project::moves::MOVES
        .iter()
        .map(|m| m.summarise())
        .collect()
}

#[test]
fn the_move_catalogue_stays_a_listing() {
    const CEILING: usize = 10_000;
    let listing = bytes(&serde_json::json!({ "moves": summaries() }));
    println!(
        "apply_move{{}} moves: {listing} B for {} moves",
        bay_project::moves::MOVES.len()
    );
    assert!(
        listing < CEILING,
        "the move listing is {listing} B, over its {CEILING} B ceiling — it was 12 KB when it \
         carried describe() for every move, which is what the ceiling exists to prevent"
    );
}

/// The listing must stay a *listing*: dropping to ids alone would save bytes and lose the reason
/// to pick one move over another, which is the whole value of the registry.
#[test]
fn the_listing_still_says_what_each_move_is_for() {
    for move_ in bay_project::moves::MOVES {
        let brief = move_.summarise();
        assert!(
            brief["summary"].as_str().is_some_and(|s| s.len() > 40),
            "{} lost the prose that says when to use it",
            move_.id
        );
        assert!(
            brief["id"].is_string(),
            "a listing entry with no id is unusable"
        );
    }
}

/// Detail is available per move, or the summary above is a loss rather than a trade.
#[test]
fn one_moves_detail_is_far_smaller_than_the_whole_registry() {
    let whole: usize = bytes(&serde_json::json!({
        "moves": bay_project::moves::MOVES.iter().map(|m| m.describe()).collect::<Vec<_>>()
    }));
    let one = bytes(&bay_project::moves::MOVES[0].describe());
    println!("one move {one} B against the whole registry's {whole} B");
    assert!(
        one * 20 < whole,
        "asking for one move is not much cheaper than asking for all"
    );
    // Detail carries what the summary dropped, or there is nothing to ask for.
    let detail = bay_project::moves::MOVES[0].describe();
    assert!(detail["channels"].is_array());
    assert!(detail["directions"].is_array());
    assert!(detail["durationSeconds"].is_number());
}

#[test]
fn looks_list_does_not_ship_the_whole_move_registry() {
    const CEILING: usize = 11_000;
    let looks: Vec<_> = bay_effects::LOOKS
        .iter()
        .map(|l| serde_json::json!({"id": l.id, "name": l.name, "description": l.description}))
        .collect();
    let response = bytes(&serde_json::json!({"looks": looks, "moves": summaries()}));
    println!("looks_list{{}}: {response} B");
    assert!(
        response < CEILING,
        "looks_list is {response} B, over its {CEILING} B ceiling — it used to carry \
         describe() for all 37 moves on top of the looks"
    );
}
