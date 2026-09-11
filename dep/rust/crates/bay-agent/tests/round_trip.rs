//! The bridge end to end: a "server thread" calls, a "UI thread" plans and applies.
//!
//! No GPUI here — the point is to prove the protocol and the planning are right without a
//! window, so a regression in either shows up in CI rather than only when someone runs the app.

use std::time::Duration;

use bay_agent::{AgentResponse, Planned, ToolCall, bridge, plan};
use bay_core::Editor;
use bay_project::{
    CanvasSize, Fps, Project, ProjectMetadata, ProjectSettings, Scene, Track, TrackKind, Tracks,
};

fn empty_project() -> Project {
    Project {
        metadata: ProjectMetadata {
            id: "p".into(),
            name: "Live".into(),
            shelf: Default::default(),
        },
        settings: ProjectSettings {
            fps: Fps {
                numerator: 30,
                denominator: 1,
            },
            canvas: CanvasSize {
                width: 1080,
                height: 1920,
            },
            background: Default::default(),
            kit: bay_project::builtin_kit("swiss").cloned(),
            plan: None,
            format: None,
        },
        scenes: vec![Scene {
            id: "scene-main".into(),
            name: "Main".into(),
            is_main: true,
            tracks: Tracks {
                overlay: Vec::new(),
                main: Track::new("track-main", "Main", TrackKind::Video),
                audio: Vec::new(),
            },
            markers: Vec::new(),
            groups: Default::default(),
        }],
        current_scene_id: "scene-main".into(),
        media: Vec::new(),
    }
}

/// Stand-in for `EditorView::apply_agent_call` — the same logic, minus GPUI.
fn apply(editor: &mut Editor, call: &ToolCall) -> AgentResponse {
    match plan(&call.name, &call.arguments, editor.project()) {
        Err(message) => AgentResponse::Err(message),
        Ok(Planned::Read(value)) => AgentResponse::Ok(value),
        Ok(Planned::Tx {
            label,
            commands,
            scene_id,
            new_ids,
        }) => {
            if scene_id != editor.active_scene_id() {
                return AgentResponse::Err("scene changed".into());
            }
            let applied = commands
                .into_iter()
                .map(|command| editor.execute(command))
                .filter(|ok| *ok)
                .count();
            AgentResponse::Ok(serde_json::json!({
                "applied": applied, "tool": label, "ids": new_ids,
            }))
        }
    }
}

/// Drain one request, waiting for it to arrive.
fn pump_once(pump: &bay_agent::AgentPump, editor: &mut Editor) {
    let request = loop {
        if let Some(request) = pump.try_next() {
            break request;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let response = apply(editor, &request.call);
    request.respond(response);
}

/// The demo, in miniature: an agent asks for a title card, the editor gains it, and undo
/// removes it — because the agent's edit went through the same reversible history a human's
/// does.
#[test]
fn an_agent_edit_lands_in_the_editor_and_undoes() {
    let (bridge, pump) = bridge();
    let mut editor = Editor::new(empty_project());

    // The "server thread".
    let caller = std::thread::spawn(move || {
        let added = bridge.call(
            ToolCall {
                name: "add_text".into(),
                arguments: serde_json::json!({
                    "role": "headline", "start": 0, "duration": 3, "content": "Hook",
                    "tone": "accent"
                }),
            },
            Duration::from_secs(5),
        );
        let seen = bridge.call(
            ToolCall {
                name: "timeline".into(),
                arguments: serde_json::json!({}),
            },
            Duration::from_secs(5),
        );
        (added, seen)
    });

    // The "UI thread".
    pump_once(&pump, &mut editor);
    pump_once(&pump, &mut editor);

    let (added, seen) = caller.join().expect("the caller thread should finish");

    match added {
        AgentResponse::Ok(value) => {
            assert_eq!(value["applied"], 1);
            assert_eq!(value["ids"][0], "text-1");
        }
        AgentResponse::Err(message) => panic!("add_text failed: {message}"),
    }
    match seen {
        AgentResponse::Ok(value) => {
            let content = &value["layers"][0]["elements"][0]["content"];
            assert_eq!(
                content, "Hook",
                "the agent should see its own edit: {value}"
            );
        }
        AgentResponse::Err(message) => panic!("timeline failed: {message}"),
    }

    // The whole point of routing through Command: undo works on the agent's edit.
    assert!(editor.can_undo(), "an agent edit must be undoable");
    assert!(editor.undo());
    assert!(
        editor.active_scene().tracks.main.elements.is_empty(),
        "undo should remove the agent's element"
    );
}

/// An agent edit must never move the user's selection. Background work that steals the
/// highlight is exactly the "hindering my work" the design is trying to avoid.
#[test]
fn an_agent_edit_leaves_the_selection_alone() {
    let (bridge, pump) = bridge();
    let mut editor = Editor::new(empty_project());

    let caller = std::thread::spawn(move || {
        bridge.call(
            ToolCall {
                name: "add_text".into(),
                arguments: serde_json::json!({ "role": "headline", "start": 0, "duration": 1, "content": "a" }),
            },
            Duration::from_secs(5),
        )
    });
    pump_once(&pump, &mut editor);
    caller.join().expect("caller finishes");

    assert!(
        editor.selection().is_empty(),
        "the agent's add must not select anything: {:?}",
        editor.selection()
    );
}

/// A plan is made against one scene; `ProjectPatch` applies to whichever scene is *active*,
/// and `ElementRef` carries no scene. So the scene the plan was made for has to travel with
/// it, or an edit silently lands in a timeline the agent never looked at.
#[test]
fn a_plan_carries_the_scene_it_was_made_for() {
    let mut editor = Editor::new(empty_project());
    let planned = plan(
        "add_text",
        &serde_json::json!({ "role": "headline", "start": 0, "duration": 1, "content": "x" }),
        editor.project(),
    )
    .expect("should plan");
    let Planned::Tx { scene_id, .. } = &planned else {
        panic!("expected a transaction");
    };
    assert_eq!(scene_id, "scene-main");

    // The user switches scenes between plan and apply.
    editor.execute(bay_core::Command::AddScene {
        id: "scene-two".into(),
        name: "Two".into(),
    });
    editor.switch_scene("scene-two");
    assert_ne!(
        editor.active_scene_id(),
        scene_id.as_str(),
        "the guard must have a real mismatch to catch"
    );

    // Applying now must be refused rather than silently editing scene-two.
    let response = apply_planned(&mut editor, planned);
    match response {
        AgentResponse::Err(message) => assert!(message.contains("scene"), "{message}"),
        AgentResponse::Ok(value) => panic!("a stale-scene plan must not apply: {value}"),
    }
}

fn apply_planned(editor: &mut Editor, planned: Planned) -> AgentResponse {
    match planned {
        Planned::Read(value) => AgentResponse::Ok(value),
        Planned::Tx {
            scene_id, commands, ..
        } => {
            if scene_id != editor.active_scene_id() {
                return AgentResponse::Err(format!("scene changed (planned for {scene_id})"));
            }
            let applied = commands
                .into_iter()
                .map(|c| editor.execute(c))
                .filter(|ok| *ok)
                .count();
            AgentResponse::Ok(serde_json::json!({ "applied": applied }))
        }
    }
}

/// With the editor gone the agent must be told, not left hanging.
#[test]
fn a_closed_bridge_reports_rather_than_hanging() {
    let (bridge, pump) = bridge();
    drop(pump);
    match bridge.call(
        ToolCall {
            name: "timeline".into(),
            arguments: serde_json::json!({}),
        },
        Duration::from_millis(500),
    ) {
        AgentResponse::Err(message) => assert!(message.contains("no longer accepting")),
        AgentResponse::Ok(value) => panic!("expected a refusal, got {value}"),
    }
}
