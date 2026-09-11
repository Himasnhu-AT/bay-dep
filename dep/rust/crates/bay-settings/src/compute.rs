//! Where renders and model inference run, and what that costs.
//!
//! The design offers "This machine" and "bay Cloud" as equal choices with a plan picker
//! underneath. Only one of them exists. [`cloud_available`] is the single place that answers
//! whether the other one does, and every setter consults it — so the pane can render the cloud
//! option (it is a real product decision that belongs on screen) without the app ever behaving
//! as though a render was queued somewhere it was not.

use serde::{Deserialize, Serialize};

use crate::SettingsError;

/// Where the work happens.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ComputeMode {
    /// The user's own GPU. The default, and the only mode this build can honour.
    #[default]
    ThisMachine,
    Cloud,
}

/// Whether a cloud backend is wired into this build.
///
/// A function rather than a constant so a build that ships one flips it in a single place, and
/// so every test that asserts on the refusal is asserting against the same source of truth.
/// It reads an environment variable purely to let a future backend announce itself; nothing in
/// this repository sets it, so it is false everywhere bay currently runs.
pub fn cloud_available() -> bool {
    std::env::var("BAY_CLOUD_ENDPOINT")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

/// Why the cloud cannot be chosen, phrased for the pane.
pub fn cloud_unavailable_reason() -> String {
    "bay Cloud is not part of this build — there is no render queue to send work to. \
     Everything runs on this Mac."
        .to_string()
}

/// A cloud tier, as the plan picker draws it.
///
/// Kept as data rather than a live price list: bay has no billing service to ask, and a price
/// fetched from nowhere is a price bay made up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub id: &'static str,
    pub name: &'static str,
    pub price: &'static str,
    pub detail: &'static str,
}

pub const PLANS: [Plan; 3] = [
    Plan {
        id: "starter",
        name: "Starter",
        price: "$12 / mo",
        detail: "300 render minutes · 1 seat",
    },
    Plan {
        id: "studio",
        name: "Studio",
        price: "$39 / mo",
        detail: "1,200 minutes · 3 seats · priority queue",
    },
    Plan {
        id: "team",
        name: "Team",
        price: "$99 / mo",
        detail: "5,000 minutes · 10 seats · SSO",
    },
];

pub fn plan(id: &str) -> Option<&'static Plan> {
    PLANS.iter().find(|plan| plan.id == id)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ComputeSettings {
    pub mode: ComputeMode,
    /// The plan the user picked, if any. `None` on every install with no account, which is all
    /// of them — a default of "studio" would put a subscription on screen nobody bought.
    pub plan: Option<String>,
}

impl Default for ComputeSettings {
    fn default() -> Self {
        Self {
            mode: ComputeMode::ThisMachine,
            plan: None,
        }
    }
}

impl ComputeSettings {
    /// Switch where work runs. Refuses the cloud while there is no cloud.
    pub fn choose(&mut self, mode: ComputeMode) -> Result<(), SettingsError> {
        self.choose_given(mode, cloud_available())
    }

    /// [`choose`], told explicitly whether a cloud exists.
    ///
    /// The gate is tested through this rather than through the environment: a test that reads
    /// `BAY_CLOUD_ENDPOINT` passes or fails according to the shell it was run from, which is
    /// how a real failure gets dismissed as flakiness.
    pub fn choose_given(
        &mut self,
        mode: ComputeMode,
        cloud_available: bool,
    ) -> Result<(), SettingsError> {
        if mode == ComputeMode::Cloud && !cloud_available {
            return Err(SettingsError::Unavailable(cloud_unavailable_reason()));
        }
        self.mode = mode;
        Ok(())
    }

    /// Pick a plan. Also gated: choosing a tier for a service that is not there would show a
    /// "current" badge against a subscription that does not exist.
    pub fn choose_plan(&mut self, id: &str) -> Result<(), SettingsError> {
        self.choose_plan_given(id, cloud_available())
    }

    /// [`choose_plan`], told explicitly whether a cloud exists.
    pub fn choose_plan_given(
        &mut self,
        id: &str,
        cloud_available: bool,
    ) -> Result<(), SettingsError> {
        if !cloud_available {
            return Err(SettingsError::Unavailable(cloud_unavailable_reason()));
        }
        if plan(id).is_none() {
            return Err(SettingsError::Invalid(format!("no plan called {id}")));
        }
        self.plan = Some(id.to_string());
        Ok(())
    }

    /// What the local option can truthfully claim, given what is installed.
    ///
    /// Built from the provisioning report by the caller rather than guessed here, so the chips
    /// under "This machine" count models that are actually on disk.
    pub fn local_chips(installed_components: usize, has_gpu: bool) -> Vec<String> {
        let mut chips = Vec::new();
        chips.push(if has_gpu {
            "GPU compositor".to_string()
        } else {
            "no GPU adapter".to_string()
        });
        chips.push(match installed_components {
            0 => "no runtimes installed".to_string(),
            1 => "1 runtime installed".to_string(),
            n => format!("{n} runtimes installed"),
        });
        chips.push("offline capable".to_string());
        chips
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one that matters: with no backend, selecting the cloud must fail and leave the mode
    /// alone. A pane that flips the radio and then silently renders locally is worse than one
    /// that refuses.
    #[test]
    fn the_cloud_cannot_be_selected_while_there_is_no_cloud() {
        let mut compute = ComputeSettings::default();
        let error = compute
            .choose_given(ComputeMode::Cloud, false)
            .expect_err("there is no cloud in this build");
        assert!(matches!(error, SettingsError::Unavailable(_)));
        assert_eq!(
            compute.mode,
            ComputeMode::ThisMachine,
            "a refused change must not half-apply"
        );
        assert!(
            error.to_string().contains("this Mac"),
            "the refusal must say where work does run: {error}"
        );
    }

    #[test]
    fn this_machine_is_always_selectable() {
        let mut compute = ComputeSettings::default();
        assert!(compute
            .choose_given(ComputeMode::ThisMachine, false)
            .is_ok());
        assert_eq!(compute.mode, ComputeMode::ThisMachine);
    }

    #[test]
    fn a_plan_cannot_be_bought_from_a_service_that_is_not_there() {
        let mut compute = ComputeSettings::default();
        assert!(compute.choose_plan_given("studio", false).is_err());
        assert!(
            compute.plan.is_none(),
            "no plan badge without a subscription"
        );
    }

    /// And when a backend does appear, the same code must let the choice through — otherwise
    /// the gate is a permanent "no" wearing a condition's clothes.
    #[test]
    fn with_a_cloud_the_choice_goes_through() {
        let mut compute = ComputeSettings::default();
        compute
            .choose_given(ComputeMode::Cloud, true)
            .expect("a configured cloud is selectable");
        assert_eq!(compute.mode, ComputeMode::Cloud);
        compute.choose_plan_given("studio", true).unwrap();
        assert_eq!(compute.plan.as_deref(), Some("studio"));
        assert!(
            compute.choose_plan_given("enterprise", true).is_err(),
            "an unknown tier is still refused"
        );
    }

    #[test]
    fn every_named_plan_resolves_and_ids_are_unique() {
        for entry in PLANS {
            assert_eq!(plan(entry.id).map(|p| p.name), Some(entry.name));
        }
        let mut ids: Vec<&str> = PLANS.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), PLANS.len());
        assert!(plan("enterprise").is_none());
    }

    /// The chips are the honest half of the local card — they must count what is really there.
    #[test]
    fn local_chips_report_the_machine_not_a_boast() {
        let chips = ComputeSettings::local_chips(0, false);
        assert_eq!(chips[0], "no GPU adapter");
        assert_eq!(chips[1], "no runtimes installed");
        let chips = ComputeSettings::local_chips(2, true);
        assert_eq!(chips[0], "GPU compositor");
        assert_eq!(chips[1], "2 runtimes installed");
        assert_eq!(
            ComputeSettings::local_chips(1, true)[1],
            "1 runtime installed"
        );
    }
}
