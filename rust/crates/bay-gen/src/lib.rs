//! Consent-gated generative media for bay.
//!
//! Providers make media; bay decides whether that media is safe to request and good enough to
//! use. Cloud requests are deliberately two-step: [`Generator::preview`] returns the exact
//! outbound payload and provider estimate, then [`Generator::generate`] requires a matching
//! preview id and explicit consent. A changed request therefore needs fresh consent.
//!
//! Generated files are never accepted on a provider's claim. [`quality::SigLipGate`] opens the
//! artifact and embeds its pixels with the provisioned `bay-vision` encoder. The resulting
//! provenance receipt keeps generated media identifiable after import and export.

mod adapters;
mod cache;
mod generation;
pub mod mcp;
pub mod quality;

pub use adapters::{FalProvider, GeminiProvider, LocalProvider};
pub use generation::{
    BeatGrid, CloudConsent, CostEstimate, GenError, GenProvider, GeneratedAsset, GenerationKind,
    GenerationPreview, GenerationRequest, Generator, OutboundDisclosure, Provenance,
    ProviderOutput,
};
pub use quality::{ArtifactGate, QualityFinding, QualityReport, SigLipGate};

/// Recover provenance only when a local receipt still matches the imported file's measured bytes.
///
/// `media_import` uses this rather than trusting provenance supplied by its caller.
pub fn verify_provenance(
    request_hash: &str,
    path: &std::path::Path,
) -> Result<Provenance, GenError> {
    cache::verify_provenance(request_hash, path)
}
