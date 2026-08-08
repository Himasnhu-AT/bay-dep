//! Deciding whether an ffmpeg bay did not install is one bay can trust.
//!
//! This exists because of a specific way a release goes wrong. bay is tested against one exact
//! ffmpeg — pinned by digest, so what the developer tested is byte-for-byte what a provisioned
//! user runs. But a user who already has ffmpeg gets *theirs*, and theirs is whatever their
//! package manager felt like: a 2019 build, a distribution patch, a git master snapshot. The
//! feature that worked everywhere in testing then fails on their machine only, with an error
//! from deep inside a decode.
//!
//! So a system copy has to earn its place: it must report a version at or above the floor in
//! the manifest. Below the floor, or unreadable, and bay treats video as *not installed* and
//! offers the build it was tested with. That is deliberately stricter than "it exists" —
//! silently running an untested decoder is the failure this whole crate is meant to prevent.
//!
//! Above the floor is accepted but still reported, so `runtime_status` can say "you are on
//! 8.1.2; bay was tested with 9.0" rather than implying they are the same thing.

use std::path::Path;
use std::process::{Command, Stdio};

/// A parsed `major.minor.patch`, comparable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub u32, pub u32, pub u32);

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

impl Version {
    /// Parse a dotted version, tolerating a missing minor or patch.
    pub fn parse(text: &str) -> Option<Version> {
        let mut parts = text.split('.').map(|part| {
            let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<u32>().ok()
        });
        let major = parts.next().flatten()?;
        Some(Version(
            major,
            parts.next().flatten().unwrap_or(0),
            parts.next().flatten().unwrap_or(0),
        ))
    }
}

/// What an ffmpeg banner says its version is.
///
/// The three shapes that actually turn up, all covered by tests below:
///
/// - `ffmpeg version 8.1.2 Copyright …` — Homebrew, a plain release
/// - `ffmpeg version 9.0-https://www.martin-riedl.de Copyright …` — a release with a build tag
/// - `ffmpeg version N-125990-g5c395992f9 Copyright …` — a git master snapshot
///
/// The third returns `None`, and that is the answer, not a failure to parse: an untagged master
/// build has no version to compare against a floor, so bay cannot claim it is good enough. It
/// gets treated exactly like an ffmpeg that is too old.
pub fn version_from_banner(banner: &str) -> Option<Version> {
    let after = banner.split("version ").nth(1)?;
    let token = after.split_whitespace().next()?;
    // Strip a build tag: `9.0-https://…` and `n7.1.1-12-g1fdb…` both carry one.
    let numeric = token.trim_start_matches('n').split('-').next()?;
    if !numeric.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    Version::parse(numeric)
}

/// Ask a binary what version it is.
///
/// Costs a process start (~20 ms), so callers cache it. A tool that cannot be run at all is
/// `None`, which is treated the same as a version that is too old.
pub fn probe_version(binary: &Path) -> Option<Version> {
    let output = Command::new(binary)
        .arg("-version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    version_from_banner(&String::from_utf8_lossy(&output.stdout))
}

/// Whether a resolved ffmpeg is good enough to use, and what to say about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Judgement {
    /// bay installed this one. Exactly what was tested.
    Tested,
    /// Not bay's copy, but new enough to trust.
    Acceptable { found: Version },
    /// Too old, or refusing to say. bay should offer the build it was tested with.
    Unusable { found: Option<Version> },
}

impl Judgement {
    pub fn is_usable(&self) -> bool {
        !matches!(self, Judgement::Unusable { .. })
    }
}

/// Judge a system ffmpeg against the floor.
pub fn judge(found: Option<Version>, minimum: Version) -> Judgement {
    match found {
        Some(version) if version >= minimum => Judgement::Acceptable { found: version },
        other => Judgement::Unusable { found: other },
    }
}

/// The sentence a user or an agent reads about it.
pub fn describe(judgement: &Judgement, verified: &str, minimum: Version) -> String {
    match judgement {
        Judgement::Tested => {
            format!("ffmpeg {verified}, installed and verified by bay")
        }
        Judgement::Acceptable { found } => format!(
            "using ffmpeg {found} already on this machine. bay is tested against {verified}; \
             {found} is new enough, but if something misbehaves, installing bay's own build \
             rules it out."
        ),
        Judgement::Unusable { found: Some(found) } => format!(
            "ffmpeg {found} on this machine is older than the {minimum} bay needs. bay can \
             install the {verified} it was tested with — nothing else has to be installed first."
        ),
        Judgement::Unusable { found: None } => format!(
            "the ffmpeg on this machine does not report a version bay can check (a development \
             snapshot, usually). bay cannot tell whether it behaves like the {verified} it was \
             tested against, so it will install its own rather than guess."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three banners that actually occur. Written from real output, not invented.
    #[test]
    fn every_real_banner_shape_is_understood() {
        assert_eq!(
            version_from_banner(
                "ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers"
            ),
            Some(Version(8, 1, 2)),
            "Homebrew's plain release"
        );
        assert_eq!(
            version_from_banner(
                "ffmpeg version 9.0-https://www.martin-riedl.de Copyright (c) 2000-2026"
            ),
            Some(Version(9, 0, 0)),
            "the build bay pins carries a URL as its build tag"
        );
        assert_eq!(
            version_from_banner("ffmpeg version 6.0 Copyright (c) 2000-2023"),
            Some(Version(6, 0, 0))
        );
        assert_eq!(
            version_from_banner("ffprobe version n7.1.1-12-g1fdbca85aa Copyright (c) 2000-2025"),
            Some(Version(7, 1, 1)),
            "BtbN tags releases with a leading n and a commit suffix"
        );
    }

    /// A git master build has no comparable version. Refusing to guess is the point: claiming
    /// `N-125990` is "new enough" would be inventing a fact about an untested binary.
    #[test]
    fn a_master_snapshot_reports_no_version_rather_than_a_wrong_one() {
        assert_eq!(
            version_from_banner("ffmpeg version N-125990-g5c395992f9 Copyright (c) 2000-2026"),
            None
        );
        assert_eq!(version_from_banner("something else entirely"), None);
        assert_eq!(version_from_banner(""), None);
    }

    /// The scenario this module exists for: a user's older ffmpeg must not be silently used.
    #[test]
    fn an_ffmpeg_older_than_the_floor_is_refused() {
        let minimum = Version(7, 0, 0);
        assert_eq!(
            judge(Some(Version(6, 0, 0)), minimum),
            Judgement::Unusable {
                found: Some(Version(6, 0, 0))
            }
        );
        assert!(!judge(Some(Version(6, 0, 0)), minimum).is_usable());
        assert!(!judge(None, minimum).is_usable());
    }

    #[test]
    fn an_ffmpeg_at_or_above_the_floor_is_accepted() {
        let minimum = Version(7, 0, 0);
        for found in [Version(7, 0, 0), Version(8, 1, 2), Version(9, 0, 0)] {
            assert_eq!(judge(Some(found), minimum), Judgement::Acceptable { found });
            assert!(judge(Some(found), minimum).is_usable());
        }
    }

    #[test]
    fn versions_order_by_component_not_lexically() {
        assert!(Version::parse("10.0").unwrap() > Version::parse("9.9.9").unwrap());
        assert!(Version::parse("8.1.2").unwrap() > Version::parse("8.1").unwrap());
        assert_eq!(Version::parse("8").unwrap(), Version(8, 0, 0));
        assert_eq!(
            Version::parse("").unwrap_or(Version(0, 0, 0)),
            Version(0, 0, 0)
        );
    }

    /// Each message has to tell the reader what to do. A status line that says only "wrong
    /// version" leaves someone with a broken render and no next step.
    #[test]
    fn every_verdict_explains_itself_and_names_the_tested_build() {
        let minimum = Version(7, 0, 0);
        for judgement in [
            Judgement::Tested,
            Judgement::Acceptable {
                found: Version(8, 1, 2),
            },
            Judgement::Unusable {
                found: Some(Version(6, 0, 0)),
            },
            Judgement::Unusable { found: None },
        ] {
            let text = describe(&judgement, "9.0", minimum);
            assert!(text.contains("9.0"), "{text}");
            assert!(!text.is_empty());
        }
        assert!(
            describe(&Judgement::Unusable { found: None }, "9.0", minimum).contains("install"),
            "an unusable ffmpeg must point at the fix"
        );
    }
}
