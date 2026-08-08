//! T-002 — print what this machine can actually do before the gated tests decide to skip.
//! See `cargo test -p bay-audio capability_report -- --nocapture`.

#[test]
fn capability_report() {
    println!("{}", bay_test_support::capability_report());
}
