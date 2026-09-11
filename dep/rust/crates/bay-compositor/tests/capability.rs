//! T-002 — print what this machine can actually do before the gated tests decide to skip.
//!
//! `cargo test` swallows stdout on success, so read it with
//! `cargo test -p bay-compositor capability_report -- --nocapture`. That is the first thing to
//! run when a GPU test skipped and you cannot tell whether the adapter or ffmpeg was missing.

#[test]
fn capability_report() {
    println!("{}", bay_test_support::capability_report());
}
