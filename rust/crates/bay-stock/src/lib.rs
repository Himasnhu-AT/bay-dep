//! Searching the open image archives.
//!
//! # This crate sends what you are making to somebody else
//!
//! That is worth stating plainly, in the repository whose manifesto says privacy is a property
//! of the software. A stock search transmits the *content* of the piece — the beat text, the
//! narration line, the subject — to a third-party API. That is a different thing from
//! provisioning, which sends only a URL for a file bay itself pinned before it shipped.
//!
//! So: every function here runs because a tool call asked it to, once, with an explicit query.
//! Nothing in this crate is called on a timer, from a render, or as a side effect of placing an
//! image. `add_image` does not reach the network and must never learn how.
//!
//! # There is no digest, and that changes what safety means
//!
//! [`bay_provision`] can say "these exact bytes or nothing" because someone pinned a SHA-256
//! before shipping. A search result cannot be pinned — it did not exist when bay was built. The
//! guarantee here is weaker and is made of four smaller things instead:
//!
//! 1. **https only**, to a per-provider host allowlist. A provider that returns a download URL
//!    on a host it does not own is a provider that has been compromised or is redirecting to an
//!    ad, and either way bay does not follow it.
//! 2. **A byte ceiling** on every transfer, so a hostile response cannot fill the disk before
//!    anything rejects it.
//! 3. **A content-type check** against the kind that was asked for. An HTML error page saved
//!    under a `.jpg` name is the classic failure, and it fails later, somewhere confusing.
//! 4. **A receipt** written beside every file recording the URL, the licence, the attribution
//!    and the SHA-256 of what actually arrived — so the download is verifiable *after* the fact
//!    even though it could not be verified before.
//!
//! # Licences bay refuses
//!
//! An editor is a machine for making derivative works. Trimming, cropping and cutting a picture
//! into a timeline is exactly what **ND** forbids, so an ND asset is not "restricted", it is
//! unusable and offering it would be a trap. **NC** is refused because bay's users may be
//! commercial and the tool cannot know.
//!
//! **SA** is different, and is the one that took a decision rather than a rule. ShareAlike does
//! not restrict the edit — it obliges the *finished film* to carry the same licence. Refusing it
//! outright made the best material for historical subjects invisible: the German federal
//! archive released its Weimar Republic photographs as CC BY-SA 3.0 de, so a default search for
//! them returns nothing at all. Accepting it silently would have made somebody's film copyleft
//! without telling them. So it is neither: [`Allowed::share_alike`] is off by default, is set
//! per call, and every result carrying it comes back with a warning saying what it costs.
//!
//! The tests in this module enforce all of it over every provider, so a new adapter cannot
//! quietly widen the policy.

use std::path::PathBuf;

mod cache;
mod http;
pub mod mcp;
mod providers;

pub use cache::{Fetched, Receipt, cache_dir, fetch, fetch_previews, receipts};
pub use http::{Http, HttpError, Transport};
pub use providers::{Provider, all_providers, provider_named, search};

/// What went wrong.
#[derive(Debug, thiserror::Error)]
pub enum StockError {
    #[error("no provider called {name:?} — try one of: {}", all_providers().join(", "))]
    UnknownProvider { name: String },

    #[error("{provider} needs an API key, set as {variable} in the environment")]
    NeedsKey {
        provider: &'static str,
        variable: &'static str,
    },

    #[error("{provider} could not be reached: {detail}")]
    Network {
        provider: &'static str,
        detail: String,
    },

    #[error("{provider} answered with something this version cannot read: {detail}")]
    Parse {
        provider: &'static str,
        detail: String,
    },

    #[error(
        "the download URL {url} is not https, or its host is not one {provider} is allowed to \
         serve from — refusing rather than following it"
    )]
    UntrustedUrl { provider: String, url: String },

    #[error("{url} is larger than the {limit} byte ceiling for this fetch")]
    TooLarge { url: String, limit: u64 },

    #[error("{url} came back as {got:?}, which is not {want} — nothing was saved")]
    WrongKind {
        url: String,
        got: String,
        want: &'static str,
    },

    #[error("could not write {path}: {detail}")]
    Io { path: PathBuf, detail: String },

    #[error("bay could not work out where to keep downloaded media on this machine")]
    NoCacheDir,
}

/// Image or footage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Image,
    Video,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Image => "image",
            Kind::Video => "video",
        }
    }

    /// The leading half of the content types this kind may arrive as.
    fn content_prefix(self) -> &'static str {
        match self {
            Kind::Image => "image/",
            Kind::Video => "video/",
        }
    }
}

/// A licence bay is willing to put on a timeline.
///
/// There is deliberately no `NonCommercial` or `NoDerivatives` variant: a provider adapter that
/// meets one filters the result out, and since it cannot be represented it cannot be returned
/// by accident. `CcBySa` exists but is unreachable unless the caller set [`Allowed::share_alike`].
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Licence {
    /// Public domain, or a dedication equivalent to it. No credit required.
    PublicDomain,
    /// CC0. No credit required.
    Cc0,
    /// CC BY — usable, and the credit must survive to delivery.
    CcBy { version: String },
    /// CC BY-SA — usable **only** when the caller has opted in, because it propagates.
    ///
    /// Never returned unless [`Allowed::share_alike`] was set. The obligation it carries is not
    /// "credit somebody", it is "your finished film is now CC BY-SA too", which is a decision
    /// about the user's own work that bay must never make quietly on their behalf.
    CcBySa { version: String },
    /// A named permissive licence that is none of the above but has been checked by hand.
    Permissive { name: String },
}

/// Which licence classes this call will accept.
///
/// Default-deny. Every field that is off by default is off because turning it on changes an
/// obligation on the *user's* work rather than on bay's.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Allowed {
    /// Accept ShareAlike, and say so in the result.
    ///
    /// The archives that matter for historical subjects are largely SA — the German federal
    /// archive released its photographs of the Weimar Republic under CC BY-SA 3.0 de, and a
    /// search for them under the default policy returns nothing at all. Refusing outright made
    /// the best material invisible; accepting silently would have made someone's film
    /// copyleft without telling them. So: per call, explicit, and loudly reported.
    pub share_alike: bool,
}

impl Allowed {
    /// The default: nothing that propagates, nothing that forbids an edit.
    pub fn permissive() -> Self {
        Self::default()
    }

    /// Also accept ShareAlike.
    pub fn with_share_alike() -> Self {
        Self { share_alike: true }
    }
}

impl Licence {
    /// Whether using this obliges the user to credit somebody.
    pub fn needs_credit(&self) -> bool {
        matches!(
            self,
            Licence::CcBy { .. } | Licence::CcBySa { .. } | Licence::Permissive { .. }
        )
    }

    /// Whether using this makes the finished film carry the same licence.
    pub fn is_copyleft(&self) -> bool {
        matches!(self, Licence::CcBySa { .. })
    }

    pub fn label(&self) -> String {
        match self {
            Licence::PublicDomain => "public domain".into(),
            Licence::Cc0 => "CC0".into(),
            Licence::CcBy { version } => format!("CC BY {version}"),
            Licence::CcBySa { version } => format!("CC BY-SA {version}"),
            Licence::Permissive { name } => name.clone(),
        }
    }

    /// Read a provider's licence string against what this call is willing to accept.
    ///
    /// `None` means "bay will not put this in a timeline". The refusals are listed explicitly
    /// rather than falling out of a default, so that adding a provider forces a decision about
    /// each one.
    pub fn parse_allowed(raw: &str, version: Option<&str>, allowed: Allowed) -> Option<Licence> {
        let lowered = raw.trim().to_ascii_lowercase();

        // Order matters: `by-nc-sa` must be caught by NC and ND before the SA arm, and none of
        // the three may reach the plain `by` arm below.
        if lowered.contains("nd") && !lowered.contains("nodata") {
            return None; // NoDerivatives — an edit is a derivative work.
        }
        if lowered.contains("nc") {
            return None; // NonCommercial — bay cannot know how the film will be used.
        }
        if lowered.contains("sa") && !lowered.contains("sampling") {
            if !allowed.share_alike {
                return None; // ShareAlike propagates; the caller has not opted in.
            }
            // Version lives at the end: "CC BY-SA 3.0 de" -> 3.0.
            let parsed = lowered
                .split_whitespace()
                .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .or(version)
                .unwrap_or("4.0");
            return Some(Licence::CcBySa {
                version: parsed.to_string(),
            });
        }

        match lowered.as_str() {
            "cc0" | "zero" | "cc-zero" => Some(Licence::Cc0),
            "pdm" | "public domain" | "public-domain" | "no restrictions" => {
                Some(Licence::PublicDomain)
            }
            "by" | "cc by" | "cc-by" => Some(Licence::CcBy {
                version: version.unwrap_or("4.0").to_string(),
            }),
            other => {
                // Wikimedia hands back prose like "CC BY 3.0" or "Public domain".
                if other.starts_with("cc by") || other.starts_with("cc-by") {
                    let version = other
                        .split_whitespace()
                        .last()
                        .filter(|v| v.chars().next().is_some_and(|c| c.is_ascii_digit()))
                        .unwrap_or("4.0");
                    return Some(Licence::CcBy {
                        version: version.to_string(),
                    });
                }
                if other.contains("public domain") || other.starts_with("pd-") {
                    return Some(Licence::PublicDomain);
                }
                None
            }
        }
    }

    /// [`Licence::parse_allowed`] under the default policy — nothing that propagates.
    pub fn parse(raw: &str, version: Option<&str>) -> Option<Licence> {
        Self::parse_allowed(raw, version, Allowed::permissive())
    }
}

/// Who to credit, and where the thing came from.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    pub creator: Option<String>,
    pub source: String,
    pub page_url: String,
}

/// One search result, before anything has been downloaded.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockAsset {
    /// `provider:id`, the handle `stock_fetch` takes.
    pub stock_id: String,
    pub provider: String,
    pub title: String,
    pub kind: Kind,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub licence: Licence,
    pub credit: Credit,
    /// Full-size original.
    pub url: String,
    /// A smaller rendering, used for ranking so a re-rank does not pull 40 originals.
    pub preview_url: String,
}

/// What a caller asks for.
#[derive(Debug, Clone)]
pub struct Query {
    pub text: String,
    pub kind: Kind,
    pub limit: usize,
    pub min_width: Option<u32>,
    /// Which licence classes this search will accept. Default-deny.
    pub allowed: Allowed,
}

impl Query {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            kind: Kind::Image,
            limit: 12,
            min_width: None,
            allowed: Allowed::permissive(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rule the crate exists to hold, under the default policy: nothing an editor cannot
    /// legally cut, and nothing that propagates onto the user's own film.
    #[test]
    fn refuses_a_licence_no_editor_can_honour() {
        for refused in [
            "by-nd",
            "by-nc",
            "by-nc-sa",
            "by-nc-nd",
            "by-sa",
            "CC BY-SA 3.0",
            "CC BY-NC 2.0",
            "CC BY-ND 4.0",
        ] {
            assert!(
                Licence::parse(refused, None).is_none(),
                "{refused} must be refused: an edit is a derivative work, \
                 and bay cannot know how the film will be used"
            );
        }
    }

    /// ShareAlike is refused by default and accepted only on the explicit opt-in. The pair is
    /// tested together because the whole value of the feature is that the two answers differ.
    #[test]
    fn sharealike_is_refused_by_default_and_accepted_only_on_request() {
        for raw in ["by-sa", "CC BY-SA 3.0", "CC BY-SA 3.0 de", "cc-by-sa"] {
            assert!(
                Licence::parse_allowed(raw, None, Allowed::permissive()).is_none(),
                "{raw} must be refused by default — it propagates onto the user's own film"
            );
            let opted = Licence::parse_allowed(raw, None, Allowed::with_share_alike());
            assert!(
                matches!(opted, Some(Licence::CcBySa { .. })),
                "{raw} must be accepted once the caller has opted in, got {opted:?}"
            );
        }
    }

    /// The opt-in must widen exactly one class and nothing else. NC and ND stay refused however
    /// they are combined with SA — `by-nc-sa` is still NonCommercial.
    #[test]
    fn the_sharealike_opt_in_does_not_also_admit_nc_or_nd() {
        for raw in ["by-nc-sa", "by-nc-nd", "by-nd", "by-nc", "CC BY-NC-SA 4.0"] {
            assert!(
                Licence::parse_allowed(raw, None, Allowed::with_share_alike()).is_none(),
                "{raw} must stay refused even with the ShareAlike opt-in"
            );
        }
    }

    /// A copyleft result must be identifiable as such, because the caller has to be told.
    #[test]
    fn only_sharealike_is_copyleft_and_it_also_needs_credit() {
        let sa = Licence::parse_allowed("CC BY-SA 3.0 de", None, Allowed::with_share_alike())
            .expect("opted in");
        assert!(sa.is_copyleft());
        assert!(sa.needs_credit());
        assert_eq!(sa.label(), "CC BY-SA 3.0");
        assert!(!Licence::Cc0.is_copyleft());
        assert!(
            !Licence::CcBy {
                version: "4.0".into()
            }
            .is_copyleft(),
            "plain CC BY asks for a credit, it does not propagate"
        );
    }

    #[test]
    fn accepts_the_licences_an_editor_can_honour() {
        assert_eq!(Licence::parse("cc0", None), Some(Licence::Cc0));
        assert_eq!(
            Licence::parse("Public domain", None),
            Some(Licence::PublicDomain)
        );
        assert_eq!(
            Licence::parse("pdm", None),
            Some(Licence::PublicDomain),
            "Openverse spells the public-domain mark pdm"
        );
        assert_eq!(
            Licence::parse("by", Some("2.0")),
            Some(Licence::CcBy {
                version: "2.0".into()
            })
        );
        assert_eq!(
            Licence::parse("CC BY 4.0", None),
            Some(Licence::CcBy {
                version: "4.0".into()
            })
        );
    }

    #[test]
    fn only_the_attribution_licences_ask_for_credit() {
        assert!(!Licence::Cc0.needs_credit());
        assert!(!Licence::PublicDomain.needs_credit());
        assert!(
            Licence::CcBy {
                version: "4.0".into()
            }
            .needs_credit()
        );
    }

    /// An unrecognised string is refused rather than waved through. A provider that invents a new
    /// licence name should surface as a missing result, not as an unlicensed file in someone's
    /// finished video.
    #[test]
    fn an_unknown_licence_is_refused_rather_than_assumed_permissive() {
        assert!(Licence::parse("all rights reserved", None).is_none());
        assert!(Licence::parse("", None).is_none());
        assert!(Licence::parse("proprietary", None).is_none());
    }
}
