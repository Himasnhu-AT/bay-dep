//! Where each model-backed task runs.
//!
//! The Models pane in the design lists a task ("Speech → text"), the model that does it, and a
//! local/cloud switch. bay already has the first two: they are `bay-provision`'s components,
//! which know their title, their download size and whether they are on disk. This module owns
//! only the part the provisioner does not — the user's choice of *where*.
//!
//! Keyed by component id so it stays a thin overlay: the catalog of what exists is the pinned
//! manifest, and duplicating it here would be a second list to keep in step.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::SettingsError;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunLocation {
    /// On this Mac, using what is installed. The default for everything.
    #[default]
    Local,
    Cloud,
}

/// The user's per-component choice, sparse: absent means [`RunLocation::Local`].
///
/// Sparse rather than dense so adding a component to the manifest does not require touching
/// every settings file that predates it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelRouting {
    pub routing: BTreeMap<String, RunLocation>,
}

impl ModelRouting {
    pub fn location(&self, component_id: &str) -> RunLocation {
        self.routing
            .get(component_id)
            .copied()
            .unwrap_or(RunLocation::Local)
    }

    /// Route a component. Refuses the cloud while there is no cloud, for the same reason
    /// [`crate::compute`] does: a switch that flips and changes nothing is a lie on screen.
    pub fn route(
        &mut self,
        component_id: &str,
        location: RunLocation,
        cloud_available: bool,
    ) -> Result<(), SettingsError> {
        if component_id.trim().is_empty() {
            return Err(SettingsError::Invalid("no component named".into()));
        }
        if location == RunLocation::Cloud && !cloud_available {
            return Err(SettingsError::Unavailable(
                crate::compute::cloud_unavailable_reason(),
            ));
        }
        match location {
            // Local is the default, so recording it explicitly only grows the file.
            RunLocation::Local => {
                self.routing.remove(component_id);
            }
            RunLocation::Cloud => {
                self.routing
                    .insert(component_id.to_string(), RunLocation::Cloud);
            }
        }
        Ok(())
    }

    /// Components the user has pushed off the machine. Empty on every local install.
    pub fn cloud_components(&self) -> Vec<&str> {
        self.routing
            .iter()
            .filter(|(_, location)| **location == RunLocation::Cloud)
            .map(|(id, _)| id.as_str())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_runs_locally_until_told_otherwise() {
        let routing = ModelRouting::default();
        assert_eq!(routing.location("speech"), RunLocation::Local);
        assert_eq!(
            routing.location("a-component-that-does-not-exist"),
            RunLocation::Local
        );
        assert!(routing.cloud_components().is_empty());
    }

    #[test]
    fn routing_to_the_cloud_is_refused_while_there_is_no_cloud() {
        let mut routing = ModelRouting::default();
        let error = routing
            .route("listen", RunLocation::Cloud, false)
            .expect_err("no cloud in this build");
        assert!(matches!(error, SettingsError::Unavailable(_)));
        assert_eq!(
            routing.location("listen"),
            RunLocation::Local,
            "a refused route must not half-apply"
        );
    }

    #[test]
    fn with_a_cloud_the_route_is_recorded_and_reversible() {
        let mut routing = ModelRouting::default();
        routing.route("listen", RunLocation::Cloud, true).unwrap();
        assert_eq!(routing.location("listen"), RunLocation::Cloud);
        assert_eq!(routing.cloud_components(), vec!["listen"]);

        routing.route("listen", RunLocation::Local, true).unwrap();
        assert_eq!(routing.location("listen"), RunLocation::Local);
    }

    /// Local is the default, so choosing it must shrink the file rather than pin a value that
    /// would then survive a change of default.
    #[test]
    fn choosing_local_removes_the_entry_rather_than_recording_it() {
        let mut routing = ModelRouting::default();
        routing.route("speech", RunLocation::Cloud, true).unwrap();
        routing.route("speech", RunLocation::Local, false).unwrap();
        assert!(routing.routing.is_empty());
    }

    #[test]
    fn an_unnamed_component_is_an_error() {
        let mut routing = ModelRouting::default();
        assert!(routing.route("  ", RunLocation::Local, true).is_err());
    }

    #[test]
    fn routing_round_trips_through_json() {
        let mut routing = ModelRouting::default();
        routing.route("vision", RunLocation::Cloud, true).unwrap();
        let text = serde_json::to_string(&routing).unwrap();
        assert_eq!(
            serde_json::from_str::<ModelRouting>(&text).unwrap(),
            routing
        );
    }
}
