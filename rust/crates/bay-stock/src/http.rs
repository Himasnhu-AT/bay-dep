//! The one place this crate touches the network.
//!
//! A trait rather than a bare `ureq` call, so every parsing and safety test below runs against
//! recorded bytes with no network at all. A test suite that needs Wikimedia to be up is a test
//! suite people learn to re-run until it passes.

use std::io::Read;

/// What came back.
pub struct Response {
    pub status: u16,
    pub content_type: String,
    pub body: Box<dyn Read + Send>,
}

#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    #[error("{0}")]
    Transport(String),
    #[error("the server answered {status} for {url}")]
    Status { status: u16, url: String },
}

/// Somewhere bytes come from.
pub trait Transport: Send + Sync {
    fn get(&self, url: &str) -> Result<Response, HttpError>;
}

/// The real one.
pub struct Http {
    agent: ureq::Agent,
}

impl Default for Http {
    fn default() -> Self {
        Self::new()
    }
}

impl Http {
    pub fn new() -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_connect(Some(std::time::Duration::from_secs(20)))
            // Unlike a provisioned download, a stock fetch is interactive — somebody is waiting
            // for it inside a tool call. A stalled connection must become an error the caller can
            // report, not a tool that never returns.
            .timeout_recv_body(Some(std::time::Duration::from_secs(120)))
            // Wikimedia's API policy asks for a descriptive agent and rate-limits anything that
            // looks anonymous. Being identifiable is also just the polite way to use somebody
            // else's archive.
            .user_agent(concat!(
                "bay/",
                env!("CARGO_PKG_VERSION"),
                " (https://freeholt.com; video editor)"
            ))
            .build();
        Self {
            agent: config.into(),
        }
    }
}

impl Transport for Http {
    fn get(&self, url: &str) -> Result<Response, HttpError> {
        let response = self
            .agent
            .get(url)
            .call()
            .map_err(|e| HttpError::Transport(e.to_string()))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(HttpError::Status {
                status,
                url: url.to_string(),
            });
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        Ok(Response {
            status,
            content_type,
            body: Box::new(response.into_body().into_reader()),
        })
    }
}

/// Whether `url` is https and sits on a host the provider is allowed to serve from.
///
/// Suffix-matched against a leading dot so `evil-commons.wikimedia.org.attacker.test` cannot
/// pass by containing an allowed name — the mistake this function exists to not make.
pub fn is_allowed(url: &str, hosts: &[&str]) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    hosts
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOSTS: &[&str] = &["wikimedia.org", "openverse.org"];

    #[test]
    fn https_on_an_allowed_host_passes() {
        assert!(is_allowed("https://upload.wikimedia.org/a/b.jpg", HOSTS));
        assert!(is_allowed("https://wikimedia.org/x", HOSTS));
    }

    #[test]
    fn plain_http_is_refused() {
        assert!(!is_allowed("http://upload.wikimedia.org/a.jpg", HOSTS));
    }

    /// The suffix attack. A host that merely *contains* an allowed name is not that host.
    #[test]
    fn a_lookalike_host_is_refused() {
        assert!(!is_allowed("https://wikimedia.org.attacker.test/a", HOSTS));
        assert!(!is_allowed("https://notwikimedia.org/a", HOSTS));
        assert!(!is_allowed("https://evil.test/wikimedia.org/a", HOSTS));
    }

    /// `https://allowed@evil.test/` reads as the allowed host to a careless parser.
    #[test]
    fn userinfo_does_not_smuggle_a_host_past_the_check() {
        assert!(!is_allowed("https://wikimedia.org@evil.test/a.jpg", HOSTS));
    }

    #[test]
    fn a_port_does_not_break_the_match() {
        assert!(is_allowed("https://upload.wikimedia.org:443/a.jpg", HOSTS));
    }

    #[test]
    fn nonsense_is_refused() {
        assert!(!is_allowed("", HOSTS));
        assert!(!is_allowed("ftp://wikimedia.org/a", HOSTS));
        assert!(!is_allowed("https://", HOSTS));
    }
}
