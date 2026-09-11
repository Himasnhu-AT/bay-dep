//! Third-party model providers the user has brought a key for.
//!
//! bay ships with none enabled. A provider list that arrives pre-populated with Anthropic,
//! OpenAI and Google reads as "bay already talks to these", which on an app whose whole claim
//! is that nothing leaves the Mac is the worst possible first impression. [`Providers::default`]
//! is empty, and [`Providers::catalog`] is what the pane offers to *add*.
//!
//! No key material is stored here. See [`crate::keys`].

use serde::{Deserialize, Serialize};

use crate::SettingsError;

/// A provider bay knows how to describe, offered in the "add a provider" list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogEntry {
    pub id: &'static str,
    pub name: &'static str,
    /// What it is used for here, in the user's terms.
    pub models: &'static str,
    /// Whether a key is meaningful. Ollama runs on localhost and wants none.
    pub needs_key: bool,
}

pub const CATALOG: [CatalogEntry; 4] = [
    CatalogEntry {
        id: "anthropic",
        name: "Anthropic",
        models: "Claude — planning and edit tools",
        needs_key: true,
    },
    CatalogEntry {
        id: "openai",
        name: "OpenAI",
        models: "GPT · Whisper (hosted transcripts)",
        needs_key: true,
    },
    CatalogEntry {
        id: "google",
        name: "Google",
        models: "Gemini · Veo",
        needs_key: true,
    },
    CatalogEntry {
        id: "ollama",
        name: "Ollama (local)",
        models: "Any pulled model · localhost:11434",
        needs_key: false,
    },
];

pub fn catalog_entry(id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|entry| entry.id == id)
}

/// The redacted form of a key, which is all the settings document ever holds.
///
/// Four characters, because that is what a person uses to tell two keys apart and it is not
/// enough to reconstruct one. A shorter key is masked entirely rather than mostly revealed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyHint {
    /// e.g. "sk-ant-"
    pub prefix: String,
    /// e.g. "4f2a"
    pub last: String,
}

impl KeyHint {
    /// Derive a hint from a real key. The key itself is not retained by this call.
    pub fn of(key: &str) -> Self {
        let key = key.trim();
        // Everything up to the last dash that still falls inside the first eight characters:
        // "sk-ant-api03-…" keeps "sk-ant-", "sk-proj-…" keeps "sk-proj-", a bare "sk-…" keeps
        // "sk-". Providers use that leading segment as a namespace, and it is the half a person
        // reads to tell an Anthropic key from an OpenAI one.
        let namespace_end = key
            .char_indices()
            .take(8)
            .filter(|(_, c)| *c == '-')
            .map(|(index, _)| index)
            .last();
        let prefix: String = namespace_end
            .map(|last| key.chars().take(last + 1).collect())
            .unwrap_or_default();
        let last: String = if key.chars().count() >= 8 {
            key.chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        } else {
            String::new()
        };
        Self { prefix, last }
    }

    /// "sk-ant-••••4f2a" — what the pane draws in the key field.
    pub fn display(&self) -> String {
        if self.last.is_empty() {
            return format!("{}••••", self.prefix);
        }
        format!("{}••••{}", self.prefix, self.last)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    /// One line of what this provider is for.
    pub models: String,
    /// Present once a key has been stored for this provider. Never the key itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_hint: Option<KeyHint>,
    pub enabled: bool,
}

impl Provider {
    /// A provider with no key and switched off — the only state a provider can be created in.
    ///
    /// Enabling on creation would mean adding a row silently starts offering it to the agent.
    pub fn new(id: impl Into<String>, name: impl Into<String>, models: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            models: models.into(),
            key_hint: None,
            enabled: false,
        }
    }

    /// From the catalog, so the pane's "add" button does not restate the descriptions.
    pub fn from_catalog(entry: &CatalogEntry) -> Self {
        Self::new(entry.id, entry.name, entry.models)
    }

    pub fn needs_key(&self) -> bool {
        catalog_entry(&self.id).is_none_or(|entry| entry.needs_key)
    }

    /// Whether this provider could actually be called right now.
    ///
    /// Enabled is a user intent; usable is a fact. A provider switched on with no key cannot
    /// serve a request, and the pane must not draw it as though it can.
    pub fn usable(&self) -> bool {
        self.enabled && (!self.needs_key() || self.key_hint.is_some())
    }

    /// What the key field shows.
    pub fn key_label(&self) -> String {
        match (&self.key_hint, self.needs_key()) {
            (Some(hint), _) => hint.display(),
            (None, false) => "no key needed".to_string(),
            (None, true) => "no key set".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Providers {
    pub list: Vec<Provider>,
}

impl Providers {
    /// Everything in the catalog the user has not added yet.
    pub fn addable(&self) -> Vec<&'static CatalogEntry> {
        CATALOG
            .iter()
            .filter(|entry| !self.list.iter().any(|p| p.id == entry.id))
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<&Provider> {
        self.list.iter().find(|p| p.id == id)
    }

    /// Add, or replace an existing row with the same id. Returns whether it was new.
    pub fn upsert(&mut self, provider: Provider) -> bool {
        match self.list.iter_mut().find(|p| p.id == provider.id) {
            Some(existing) => {
                *existing = provider;
                false
            }
            None => {
                self.list.push(provider);
                true
            }
        }
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.list.len();
        self.list.retain(|p| p.id != id);
        self.list.len() != before
    }

    /// Record that a key was stored, by hint only.
    ///
    /// Storing the key is [`crate::keys`]'s job; this is the half that is safe to persist in
    /// a world-readable document. Setting a key also enables the provider, because a user who
    /// just typed one in has said what they want.
    pub fn set_key_hint(&mut self, id: &str, hint: KeyHint) -> Result<(), SettingsError> {
        let provider = self
            .list
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| SettingsError::Invalid(format!("no provider called {id}")))?;
        provider.key_hint = Some(hint);
        provider.enabled = true;
        Ok(())
    }

    pub fn clear_key(&mut self, id: &str) {
        if let Some(provider) = self.list.iter_mut().find(|p| p.id == id) {
            provider.key_hint = None;
        }
    }

    pub fn toggle(&mut self, id: &str) -> Result<bool, SettingsError> {
        let provider = self
            .list
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| SettingsError::Invalid(format!("no provider called {id}")))?;
        provider.enabled = !provider.enabled;
        Ok(provider.enabled)
    }

    /// Providers the agent may actually be offered, in list order.
    pub fn usable(&self) -> Vec<&Provider> {
        self.list.iter().filter(|p| p.usable()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The first-impression test. bay must not look like it is already wired to three
    /// third-party services before the user has agreed to any of them.
    #[test]
    fn no_provider_is_configured_until_the_user_adds_one() {
        let providers = Providers::default();
        assert!(providers.list.is_empty());
        assert!(providers.usable().is_empty());
        assert_eq!(providers.addable().len(), CATALOG.len());
    }

    #[test]
    fn adding_a_provider_leaves_it_switched_off() {
        let mut providers = Providers::default();
        let entry = catalog_entry("anthropic").unwrap();
        assert!(providers.upsert(Provider::from_catalog(entry)));
        let provider = providers.get("anthropic").unwrap();
        assert!(!provider.enabled, "adding a row must not start using it");
        assert!(providers.usable().is_empty());
        assert!(
            !providers.upsert(Provider::from_catalog(entry)),
            "a second add replaces"
        );
        assert_eq!(providers.list.len(), 1);
    }

    /// Enabled is intent; usable is fact. A key-less Anthropic row cannot serve anything.
    #[test]
    fn a_provider_switched_on_without_a_key_is_not_usable() {
        let mut providers = Providers::default();
        providers.upsert(Provider::from_catalog(catalog_entry("anthropic").unwrap()));
        assert!(providers.toggle("anthropic").unwrap());
        assert!(
            providers.usable().is_empty(),
            "no key, so nothing can be called"
        );

        providers
            .set_key_hint("anthropic", KeyHint::of("sk-ant-api03-abcdefgh4f2a"))
            .unwrap();
        assert_eq!(providers.usable().len(), 1);
    }

    /// Ollama runs on localhost. Demanding a key for it would leave it permanently unusable.
    #[test]
    fn a_local_provider_is_usable_with_no_key() {
        let mut providers = Providers::default();
        providers.upsert(Provider::from_catalog(catalog_entry("ollama").unwrap()));
        providers.toggle("ollama").unwrap();
        assert_eq!(providers.usable().len(), 1);
        assert_eq!(
            providers.get("ollama").unwrap().key_label(),
            "no key needed"
        );
    }

    /// The point of the hint: it identifies a key without carrying one.
    #[test]
    fn a_key_hint_shows_four_characters_and_no_more() {
        let hint = KeyHint::of("sk-ant-api03-SECRETSECRET4f2a");
        assert_eq!(hint.display(), "sk-ant-••••4f2a");
        assert!(
            !hint.display().contains("SECRET"),
            "the hint must not leak the body of the key"
        );
        assert_eq!(hint.last.chars().count(), 4);
        assert_eq!(
            KeyHint::of("sk-proj-aaaabbbb91cd").display(),
            "sk-proj-••••91cd"
        );
        assert_eq!(
            KeyHint::of("0123456789abcdef").display(),
            "••••cdef",
            "a key with no namespace still gets a hint"
        );
    }

    /// A short key would be almost entirely revealed by a four-character tail, so it is not.
    #[test]
    fn a_short_key_is_masked_completely() {
        let hint = KeyHint::of("abc");
        assert_eq!(hint.display(), "••••");
        assert!(hint.last.is_empty());
    }

    #[test]
    fn setting_a_key_enables_the_provider_that_got_it() {
        let mut providers = Providers::default();
        providers.upsert(Provider::from_catalog(catalog_entry("openai").unwrap()));
        providers
            .set_key_hint("openai", KeyHint::of("sk-proj-000091cd"))
            .unwrap();
        let provider = providers.get("openai").unwrap();
        assert!(provider.enabled);
        assert_eq!(provider.key_label(), "sk-proj-••••91cd");
    }

    #[test]
    fn keying_an_unknown_provider_is_an_error_not_a_silent_no_op() {
        let mut providers = Providers::default();
        assert!(providers
            .set_key_hint("nope", KeyHint::of("sk-1234567890"))
            .is_err());
        assert!(providers.toggle("nope").is_err());
    }

    #[test]
    fn removing_a_provider_puts_it_back_on_the_addable_list() {
        let mut providers = Providers::default();
        providers.upsert(Provider::from_catalog(catalog_entry("google").unwrap()));
        assert!(!providers.addable().iter().any(|e| e.id == "google"));
        assert!(providers.remove("google"));
        assert!(providers.addable().iter().any(|e| e.id == "google"));
        assert!(
            !providers.remove("google"),
            "removing twice is not a change"
        );
    }

    #[test]
    fn clearing_a_key_leaves_the_row_but_unusable() {
        let mut providers = Providers::default();
        providers.upsert(Provider::from_catalog(catalog_entry("anthropic").unwrap()));
        providers
            .set_key_hint("anthropic", KeyHint::of("sk-ant-aaaabbbb4f2a"))
            .unwrap();
        providers.clear_key("anthropic");
        let provider = providers.get("anthropic").unwrap();
        assert!(provider.enabled, "clearing a key is not switching it off");
        assert!(!provider.usable());
        assert_eq!(provider.key_label(), "no key set");
    }

    /// Serialising a provider must never put a key in the document, whatever anyone stored.
    #[test]
    fn a_serialised_provider_carries_no_key_material() {
        let mut providers = Providers::default();
        providers.upsert(Provider::from_catalog(catalog_entry("anthropic").unwrap()));
        providers
            .set_key_hint("anthropic", KeyHint::of("sk-ant-api03-DO-NOT-PERSIST-4f2a"))
            .unwrap();
        let text = serde_json::to_string(&providers).unwrap();
        assert!(
            !text.contains("DO-NOT-PERSIST"),
            "key body in settings: {text}"
        );
        assert!(text.contains("4f2a"));
    }

    #[test]
    fn catalog_ids_are_unique() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|e| e.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
    }
}
