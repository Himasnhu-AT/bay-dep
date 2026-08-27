//! `bay-agent` — the door an AI agent's edits come through to reach the live editor.
//!
//! The problem this solves: `bay-mcp` runs the MCP server, and `bay-ui` owns the document. They
//! cannot share an `Editor` — GPUI's `ForegroundExecutor` carries `PhantomData<Rc<()>>` and is
//! explicitly `!Send`, so the UI cannot be handed to a server thread, and an
//! `Arc<Mutex<Editor>>` would let a tool call block `render()`.
//!
//! So nothing is shared. **One writer** — the editor on the main thread — and tool calls cross
//! as owned data:
//!
//! ```text
//!   MCP thread                    channel                  main thread
//!   ──────────                    ───────                  ───────────
//!   tools/call ──▶ AgentRequest ────────────▶ pump drains ──▶ plan() ──▶ Editor::execute
//!        ▲                                                       │
//!        └───────────── AgentResponse ◀──────────────────────────┘
//! ```
//!
//! [`plan`] is the reason this crate exists rather than the UI calling into `bay-mcp`: it turns
//! a tool call plus a *read-only* project into either an answer or a list of [`Command`]s,
//! with no GPU, no editor and no I/O. That makes it unit-testable, and it keeps the dependency
//! arrow pointing one way — `bay-ui` and `bay-mcp` both depend on this, and never on each
//! other.

pub mod deliver;
pub mod illustrate;
pub mod plan;
pub mod registry;
pub mod slow;
pub mod trust;

pub use plan::{
    Planned, all_tool_names, available_tools, editor_tools, machine_tools, plan,
    plan_without_document, planned_tools, server_only_tools, window_tools,
};
pub use registry::Instance;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// One tool call, on its way to the editor.
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

/// What the editor did with a tool call.
#[derive(Debug, Clone)]
pub enum AgentResponse {
    /// A read answered, or a transaction applied. The payload is the tool's JSON result.
    Ok(serde_json::Value),
    /// Refused, with a message the agent can act on.
    Err(String),
}

/// A request in flight, plus the one-shot channel its answer goes back on.
///
/// `claimed` exists so a caller that has given up (timeout, disconnect) and the pump that is
/// about to answer cannot both win: whoever wins the `compare_exchange` owns the reply, so a
/// timed-out call can never land late and surprise the agent with a second answer.
pub struct AgentRequest {
    pub call: ToolCall,
    reply: std::sync::mpsc::SyncSender<AgentResponse>,
    claimed: Arc<AtomicBool>,
}

impl AgentRequest {
    /// Answer this request, if nobody else already has.
    pub fn respond(self, response: AgentResponse) {
        if self
            .claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            // The receiver may be gone (client hung up); that is not an error worth reporting.
            let _ = self.reply.send(response);
        }
    }
}

impl std::fmt::Debug for AgentRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentRequest")
            .field("call", &self.call)
            .finish_non_exhaustive()
    }
}

/// The MCP-thread end of the bridge. `Send`, so it can live on a server thread.
#[derive(Clone)]
pub struct AgentBridge {
    sender: async_channel::Sender<AgentRequest>,
}

/// The UI-thread end. Drained by a foreground task.
pub struct AgentPump {
    receiver: async_channel::Receiver<AgentRequest>,
}

/// Create the two ends of the bridge.
///
/// Bounded rather than unbounded: an agent that floods the editor should feel backpressure on
/// its own thread instead of growing a queue the user cannot see.
pub fn bridge() -> (AgentBridge, AgentPump) {
    let (sender, receiver) = async_channel::bounded(64);
    (AgentBridge { sender }, AgentPump { receiver })
}

impl AgentBridge {
    /// Send a tool call to the editor and wait for its answer.
    ///
    /// Blocks the calling thread — which is correct, because that thread serves exactly one MCP
    /// connection and has nothing else to do. It never blocks the accept loop (thread per
    /// connection) and never blocks the UI (the pump's work per request is a plan plus an
    /// `execute_batch`).
    pub fn call(&self, call: ToolCall, timeout: std::time::Duration) -> AgentResponse {
        let name = call.name.clone();
        let (reply, answers) = std::sync::mpsc::sync_channel(1);
        let claimed = Arc::new(AtomicBool::new(false));
        let request = AgentRequest {
            call,
            reply,
            claimed: Arc::clone(&claimed),
        };
        if self.sender.send_blocking(request).is_err() {
            return AgentResponse::Err("the editor is no longer accepting edits".into());
        }
        match answers.recv_timeout(timeout) {
            Ok(response) => response,
            // A dropped sender is NOT a timeout. `drain_agent_calls` drops the request when the
            // window has closed, and shutdown drops every request in flight — reporting those as
            // "did not answer in time, and its result will still be applied" told the caller to
            // wait for an edit that was never going to land.
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => AgentResponse::Err(format!(
                "the editor stopped handling {name} — the window was closed before it finished"
            )),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Claim the slot so the pump's answer is dropped rather than delivered late.
                if claimed
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    // Names the tool and the actual budget. The old text asserted a modal
                    // dialog, which it cannot know and which was usually wrong: the common case
                    // was a render that simply took longer than the budget it was given.
                    //
                    // It also says plainly that the work is still running. It is — the timeout
                    // only claims this reply slot; nothing is cancelled, and the result will
                    // still be applied to the document.
                    AgentResponse::Err(format!(
                        "{name} did not answer within {}s. The editor may be blocked on a \
                         dialog, or the work may simply be taking longer — it has NOT been \
                         cancelled, and its result will still be applied.",
                        timeout.as_secs(),
                    ))
                } else {
                    // The pump won the race after all; its answer is already on the way.
                    answers
                        .recv()
                        .unwrap_or_else(|_| AgentResponse::Err("the editor went away".into()))
                }
            }
        }
    }

    /// Whether the editor end is still listening.
    pub fn is_live(&self) -> bool {
        !self.sender.is_closed()
    }
}

impl AgentPump {
    /// Wait for the next tool call. `None` once every bridge has been dropped.
    pub async fn next(&self) -> Option<AgentRequest> {
        self.receiver.recv().await.ok()
    }

    /// Take a call without waiting, for a caller that drains on a tick.
    pub fn try_next(&self) -> Option<AgentRequest> {
        self.receiver.try_recv().ok()
    }
}

#[cfg(test)]
impl AgentPump {
    /// Blocking receive, for tests that drive the pump from a plain thread.
    fn try_next_blocking(&self) -> AgentRequest {
        self.receiver
            .recv_blocking()
            .expect("a request should arrive")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_call_gets_the_answer_the_pump_sends() {
        let (bridge, pump) = bridge();
        std::thread::spawn(move || {
            let request = pump.try_next_blocking();
            request.respond(AgentResponse::Ok(serde_json::json!({ "ok": true })));
        });
        let response = bridge.call(
            ToolCall {
                name: "timeline".into(),
                arguments: serde_json::json!({}),
            },
            Duration::from_secs(5),
        );
        match response {
            AgentResponse::Ok(value) => assert_eq!(value["ok"], true),
            AgentResponse::Err(e) => panic!("unexpected error: {e}"),
        }
    }

    #[test]
    fn a_dropped_pump_is_reported_rather_than_hanging() {
        let (bridge, pump) = bridge();
        drop(pump);
        let response = bridge.call(
            ToolCall {
                name: "timeline".into(),
                arguments: serde_json::json!({}),
            },
            Duration::from_millis(200),
        );
        match response {
            AgentResponse::Err(message) => assert!(message.contains("no longer accepting")),
            AgentResponse::Ok(_) => panic!("a closed bridge must not succeed"),
        }
    }

    /// A timed-out call must not receive a late answer. Without the claim flag the pump's
    /// response would arrive after the agent had already been told the call failed, and the
    /// agent would see one edit reported twice.
    #[test]
    fn an_answer_that_arrives_after_the_timeout_is_dropped() {
        let (bridge, pump) = bridge();
        let handle = std::thread::spawn(move || {
            let request = pump.try_next_blocking();
            std::thread::sleep(Duration::from_millis(300));
            request.respond(AgentResponse::Ok(serde_json::json!({ "late": true })));
        });
        let response = bridge.call(
            ToolCall {
                name: "timeline".into(),
                arguments: serde_json::json!({}),
            },
            Duration::from_millis(50),
        );
        match response {
            AgentResponse::Err(message) => {
                // The message has to be actionable. It used to assert a modal dialog, which it
                // cannot know, and say nothing about the work still running — so an agent read
                // "failed" and retried, while the first call was still going and about to apply
                // its edit.
                assert!(
                    message.contains("timeline"),
                    "should name the tool that timed out: {message}"
                );
                assert!(
                    message.contains("NOT been cancelled"),
                    "should say the work is still running: {message}"
                );
            }
            AgentResponse::Ok(value) => panic!("a late answer leaked through: {value}"),
        }
        handle.join().expect("the pump thread should finish");
    }
}
