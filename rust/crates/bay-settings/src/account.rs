//! Who is signed in, and the seam where signing in would happen.
//!
//! The design this implements has a sign-in screen that hands off to a browser at
//! `bay.video/login`. No such service exists in this repository, and inventing a successful
//! round trip would mean the app claims a session it does not have — the exact class of untrue
//! status the workspace forbids. So the flow is real up to the seam and honest past it:
//! [`AccountService`] describes the hand-off, [`Unconfigured`] is the only implementation
//! compiled in, and it says so.
//!
//! **Signing in never gates the editor.** [`Session::Offline`] is the default and every part of
//! bay works from it; the account screen is where you would connect a service, not a door you
//! must pass through to cut video. A local video editor that refuses to open a local file until
//! it has spoken to a server is the thin client the manifesto rules out.

use serde::{Deserialize, Serialize};

/// Whether this install is associated with an account.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Session {
    /// The normal state: bay is running on this Mac for whoever is at the keyboard.
    #[default]
    Offline,
    /// A service confirmed an identity. Unreachable in a build with no account service, and
    /// modelled anyway so the screen has something real to render when one exists.
    SignedIn { account: Account },
}

impl Session {
    pub fn account(&self) -> Option<&Account> {
        match self {
            Session::Offline => None,
            Session::SignedIn { account } => Some(account),
        }
    }

    pub fn is_signed_in(&self) -> bool {
        matches!(self, Session::SignedIn { .. })
    }
}

/// An identity a service vouched for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub email: String,
    /// What the service calls this account's tier, verbatim. bay does not interpret it.
    pub plan: String,
}

impl Account {
    /// The first character of the name, for the avatar circle. Empty names get a dash rather
    /// than an empty circle, because an empty circle reads as a rendering bug.
    pub fn initial(&self) -> String {
        self.name
            .chars()
            .find(|c| !c.is_whitespace())
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "—".to_string())
    }
}

/// What the machine can say about itself with no account: enough to fill the Account pane.
///
/// Not a fake account — there is no name, email or plan, because nobody supplied one. It is the
/// honest answer to "who is this?" on a local install: this Mac, this user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalIdentity {
    /// The OS user name, when the environment reports one.
    pub user: Option<String>,
    pub host: Option<String>,
}

impl LocalIdentity {
    pub fn detect() -> Self {
        Self::from_env(|key| std::env::var(key).ok())
    }

    /// Pure, so the "no environment at all" case is a unit test rather than a machine someone
    /// has to reproduce.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Self {
        let user = get("USER")
            .or_else(|| get("LOGNAME"))
            .or_else(|| get("USERNAME"))
            .filter(|value| !value.trim().is_empty());
        let host = get("HOSTNAME")
            .or_else(|| get("COMPUTERNAME"))
            .filter(|value| !value.trim().is_empty());
        Self { user, host }
    }

    pub fn display_name(&self) -> String {
        self.user.clone().unwrap_or_else(|| "This Mac".to_string())
    }

    pub fn initial(&self) -> String {
        self.user
            .as_deref()
            .and_then(|user| user.chars().find(|c| !c.is_whitespace()))
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_else(|| "·".to_string())
    }
}

/// Why a sign-in did not happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountError {
    /// This build has no account service wired up. The only variant [`Unconfigured`] returns.
    NotConfigured(String),
    /// A service exists and refused, or could not be reached.
    Refused(String),
}

impl std::fmt::Display for AccountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AccountError::NotConfigured(why) | AccountError::Refused(why) => f.write_str(why),
        }
    }
}

impl std::error::Error for AccountError {}

/// A browser hand-off in progress: the URL to open, and the ticket to poll with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInHandoff {
    pub url: String,
    pub ticket: String,
}

/// Where signing in would talk to a service.
///
/// A trait rather than a function so a build that does have a backend can supply one without
/// this crate — or the view above it — learning anything about HTTP.
pub trait AccountService: Send + Sync {
    /// Start a hand-off. The caller opens `url` in the user's browser.
    fn begin_sign_in(&self) -> Result<SignInHandoff, AccountError>;
    /// Ask whether the hand-off has been approved. `Ok(None)` means "still waiting".
    fn poll(&self, handoff: &SignInHandoff) -> Result<Option<Account>, AccountError>;
    /// One line the sign-in screen shows under the button. What is true right now.
    fn describe(&self) -> String;
}

/// The only account service compiled into this build.
///
/// It refuses, and the refusal names the reason. This is deliberate: the alternative — a
/// `sleep` and a hardcoded "Ava Mehta" — would put a session in the title bar that nothing
/// backs, and every screen downstream would be reporting an identity bay invented.
#[derive(Debug, Clone, Copy, Default)]
pub struct Unconfigured;

const NOT_CONFIGURED: &str =
    "bay accounts are not configured in this build — there is no sign-in service to hand off to. \
     Everything works offline; this pane is where an account would connect.";

impl AccountService for Unconfigured {
    fn begin_sign_in(&self) -> Result<SignInHandoff, AccountError> {
        Err(AccountError::NotConfigured(NOT_CONFIGURED.to_string()))
    }

    fn poll(&self, _handoff: &SignInHandoff) -> Result<Option<Account>, AccountError> {
        Err(AccountError::NotConfigured(NOT_CONFIGURED.to_string()))
    }

    fn describe(&self) -> String {
        NOT_CONFIGURED.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The load-bearing test for the whole account question. If this ever passes an `Ok`, bay
    /// has started claiming a session that nothing granted.
    #[test]
    fn signing_in_is_refused_and_says_why() {
        let error = Unconfigured.begin_sign_in().expect_err("must refuse");
        assert!(
            matches!(error, AccountError::NotConfigured(_)),
            "the refusal must be the configuration one, not a network failure: {error:?}"
        );
        let message = error.to_string();
        assert!(
            message.contains("offline"),
            "the message must tell the user bay still works: {message}"
        );
    }

    #[test]
    fn polling_an_unconfigured_service_never_yields_an_account() {
        let handoff = SignInHandoff {
            url: "https://bay.video/login".into(),
            ticket: "t".into(),
        };
        assert!(Unconfigured.poll(&handoff).is_err());
    }

    #[test]
    fn the_default_session_is_offline_and_has_no_account() {
        let session = Session::default();
        assert!(!session.is_signed_in());
        assert!(session.account().is_none());
    }

    #[test]
    fn an_avatar_initial_is_upper_case_and_skips_leading_space() {
        let account = Account {
            name: "  ava mehta".into(),
            email: "ava@studio.co".into(),
            plan: "Studio".into(),
        };
        assert_eq!(account.initial(), "A");
    }

    /// An empty circle reads as a broken avatar, so a nameless account still draws something.
    #[test]
    fn a_nameless_account_still_draws_an_avatar() {
        let account = Account {
            name: "   ".into(),
            email: "x@y.z".into(),
            plan: String::new(),
        };
        assert_eq!(account.initial(), "—");
    }

    #[test]
    fn local_identity_prefers_user_then_logname() {
        let identity = LocalIdentity::from_env(|key| match key {
            "LOGNAME" => Some("himanshu".into()),
            _ => None,
        });
        assert_eq!(identity.display_name(), "himanshu");
        assert_eq!(identity.initial(), "H");
    }

    /// A container with no environment at all must still render a pane.
    #[test]
    fn local_identity_falls_back_when_the_environment_is_empty() {
        let identity = LocalIdentity::from_env(|_| None);
        assert_eq!(identity.display_name(), "This Mac");
        assert_eq!(identity.initial(), "·");
        assert!(identity.host.is_none());
    }

    /// A blank `USER=` is not a name. Treating it as one puts an empty string in the pane.
    #[test]
    fn a_blank_user_variable_is_not_a_name() {
        let identity = LocalIdentity::from_env(|key| (key == "USER").then(|| "   ".to_string()));
        assert_eq!(identity.display_name(), "This Mac");
    }
}
