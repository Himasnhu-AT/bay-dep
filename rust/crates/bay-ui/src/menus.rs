//! The macOS menu bar, and the application lifecycle that hangs off it.
//!
//! **Without this, bay had no menu bar at all.** GPUI calls AppKit's `setMainMenu:` from exactly
//! one place — inside `App::set_menus` — so an app that never calls it leaves `NSApp.mainMenu`
//! nil. The visible symptom was Cmd+Q doing nothing, but the actual loss is larger: no Cmd+W, no
//! Cmd+H, no Cmd+M, no Services, and no OS-level Edit menu, which is what gives text fields their
//! standard Cut/Copy/Paste/Undo behaviour. None of that is a framework limitation; it is one
//! unwritten call, and it is why the answer to "should we adopt Tauri for the native feel" was
//! no — Tauri's menus are the same AppKit underneath.
//!
//! **Edit uses [`MenuItem::os_action`] deliberately.** That hands AppKit the real selector
//! (`undo:`, `copy:`, `paste:`…) as well as bay's own action, so the standard editing keystrokes
//! work in a focused text field the way they do in every other Mac app, rather than only where
//! bay happens to have bound them.
//!
//! Everything here dispatches actions the editor already defines. A menu that duplicated the
//! logic behind the shortcuts would be a second implementation to keep in step, and the two would
//! drift the first time a keystroke changed.

use gpui::{App, Menu, MenuItem, OsAction, SystemMenuType};

use crate::editor_view::{
    CopyClip, DeleteSelected, PasteClip, Redo, SeekBackward, SeekForward, ShowAudio, ShowColor,
    ShowCut, ShowDeliver, ShowMedia, ShowMotion, SplitClip, TogglePlay, Undo,
};

gpui::actions!(
    bay_app,
    [
        /// Quit the application. Bound by the OS to Cmd+Q once the menu exists.
        Quit,
        /// Close the front window. On a single-window app this also ends the process, via the
        /// window-closed hook below.
        CloseWindow,
        /// Minimise the front window — Cmd+M, which users expect to exist everywhere.
        Minimize,
        /// Save the open project now.
        SaveProject,
        /// Open the documentation in a browser.
        ShowDocs,
    ]
);

/// Where Help points. The repository docs rather than a marketing page: the questions someone
/// opens Help for — which tools exist, why a render failed — are answered there.
const DOCS_URL: &str = "https://github.com/Himasnhu-AT/bay#readme";

/// The menu bar.
///
/// Named `bay` for the application menu because macOS shows the *first* menu's name in bold as
/// the app name, and it must match the bundle. A mismatch there reads as a different app.
pub fn menus() -> Vec<Menu> {
    vec![
        Menu {
            name: "bay".into(),
            items: vec![
                MenuItem::os_submenu("Services", SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action("Quit bay", Quit),
            ],
        },
        Menu {
            name: "File".into(),
            items: vec![
                MenuItem::action("Save", SaveProject),
                MenuItem::separator(),
                MenuItem::action("Close Window", CloseWindow),
            ],
        },
        Menu {
            name: "Edit".into(),
            items: vec![
                // os_action, not action: this is what makes Undo/Copy/Paste behave correctly
                // inside a focused text field, where AppKit — not bay — owns the editing.
                MenuItem::os_action("Undo", Undo, OsAction::Undo),
                MenuItem::os_action("Redo", Redo, OsAction::Redo),
                MenuItem::separator(),
                MenuItem::os_action("Cut", CopyClip, OsAction::Cut),
                MenuItem::os_action("Copy", CopyClip, OsAction::Copy),
                MenuItem::os_action("Paste", PasteClip, OsAction::Paste),
            ],
        },
        // The only place the page shortcuts are written down. bay hides every other shortcut
        // from the UI, so without this menu Shift+2..7 exist and nobody finds them.
        Menu {
            name: "View".into(),
            items: vec![
                MenuItem::action("Media", ShowMedia),
                MenuItem::action("Cut", ShowCut),
                MenuItem::action("Motion", ShowMotion),
                MenuItem::action("Color", ShowColor),
                MenuItem::action("Audio", ShowAudio),
                MenuItem::action("Deliver", ShowDeliver),
            ],
        },
        Menu {
            name: "Timeline".into(),
            items: vec![
                MenuItem::action("Play / Pause", TogglePlay),
                MenuItem::separator(),
                MenuItem::action("Split Clip", SplitClip),
                MenuItem::action("Delete Selected", DeleteSelected),
                MenuItem::separator(),
                MenuItem::action("Step Forward", SeekForward),
                MenuItem::action("Step Back", SeekBackward),
            ],
        },
        Menu {
            name: "Window".into(),
            items: vec![MenuItem::action("Minimize", Minimize)],
        },
        Menu {
            name: "Help".into(),
            items: vec![MenuItem::action("bay Documentation", ShowDocs)],
        },
    ]
}

/// Keystrokes for the menu-only actions.
///
/// **A menu item shows — and responds to — a shortcut only if the action is bound in the
/// keymap.** GPUI derives the AppKit key equivalent from the binding, so `MenuItem::action` on
/// its own gives an item that looks right and does nothing. The first cut of this had a Quit
/// item and no `cmd-q` binding: the menu bar appeared, and Cmd+Q still did not quit.
///
/// Bound with no context, unlike the editor's keymap, so they work from the project list as well
/// as the timeline — Cmd+Q that depends on which view has focus is worse than no Cmd+Q.
pub fn key_bindings() -> Vec<gpui::KeyBinding> {
    vec![
        gpui::KeyBinding::new("cmd-q", Quit, None),
        gpui::KeyBinding::new("cmd-w", CloseWindow, None),
        gpui::KeyBinding::new("cmd-m", Minimize, None),
        gpui::KeyBinding::new("cmd-s", SaveProject, None),
    ]
}

/// Register the handlers for the menu-only actions.
///
/// The editor's own actions (undo, split, seek…) are already handled on the focused element, so
/// they are deliberately absent here — registering them again at app level would give one
/// keystroke two handlers.
pub fn register_actions(cx: &mut App) {
    cx.on_action(|_: &Quit, cx: &mut App| cx.quit());
    cx.on_action(|_: &ShowDocs, cx: &mut App| cx.open_url(DOCS_URL));
    // CloseWindow, Minimize and SaveProject are deliberately NOT registered here — they need
    // the window, and an app-level handler cannot reach the window that is mid-update
    // dispatching the keystroke. They are handled on `BayApp`'s root element instead.
}

/// Quit when the last window closes.
///
/// A Mac app with no windows and no Dock presence is a process the user has no way to see or
/// stop — bay left one running after its window was closed, which is how you end up with three
/// invisible editors holding the agent port.
///
/// Deliberately only wired for the editor. `bay --mcp` never reaches this code, and must not:
/// a headless server has no windows by definition and would quit the instant it started.
pub fn quit_when_last_window_closes(cx: &mut App) {
    cx.on_window_closed(|cx| {
        if cx.windows().is_empty() {
            cx.quit();
        }
    })
    .detach();
}
