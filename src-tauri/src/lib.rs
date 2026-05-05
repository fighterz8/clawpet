mod runtime_http;

use std::{process::Child, sync::Mutex};

#[cfg(debug_assertions)]
use std::process::{Command, Stdio};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager,
};

struct RuntimeChild(Mutex<Option<Child>>);

#[cfg(debug_assertions)]
fn spawn_dev_runtime() -> Option<Child> {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", "npm", "run", "runtime:tailscale"]);
        c
    } else {
        let mut c = Command::new("npm");
        c.args(["run", "runtime:tailscale"]);
        c
    };

    cmd.current_dir(repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .ok()
}

#[cfg(not(debug_assertions))]
fn spawn_dev_runtime() -> Option<Child> {
    // Packaged builds should use a bundled runtime sidecar or native runtime.
    // That is the next v0.5 step; do not shell out to npm in production.
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeChild(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            runtime_http::start_runtime_server();

            if std::env::var("CLAWPET_USE_NODE_RUNTIME").ok().as_deref() == Some("1") {
                if let Some(child) = spawn_dev_runtime() {
                    if let Some(state) = app.try_state::<RuntimeChild>() {
                        if let Ok(mut slot) = state.0.lock() {
                            *slot = Some(child);
                        }
                    }
                }
            }

            let show_hide =
                MenuItem::with_id(app, "show_hide", "Show / Hide Pet", true, None::<&str>)?;
            let setup = MenuItem::with_id(app, "setup", "Show Setup", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Clawpet", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_hide, &setup, &quit])?;

            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show_hide" => toggle_pet(app),
                    "setup" => show_setup(app),
                    _ => {}
                });
                tray.on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_pet(tray.app_handle());
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing setup should not strand an always-on-top pet with no control
                // surface. Keep both windows/tray alive; Quit Clawpet performs the real
                // app shutdown.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_pet<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let visible = app
        .get_webview_window("pet")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if let Some(window) = app.get_webview_window("pet") {
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn show_setup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
