mod runtime_http;

use std::{fs, path::PathBuf, process::Child, sync::Mutex};

#[cfg(debug_assertions)]
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager,
};

struct RuntimeChild(Mutex<Option<Child>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReactivitySettings {
    available: bool,
    activity: Option<String>,
    heartbeat_reactions: Option<bool>,
    activity_levels: Vec<&'static str>,
    error: Option<String>,
}

fn clawpet_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".openclaw").join("clawpet").join("config.json"))
}

fn read_clawpet_config_json() -> Result<Value, String> {
    let path = clawpet_config_path().ok_or_else(|| "home directory not available".to_string())?;
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("failed reading {}: {e}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("failed parsing {}: {e}", path.display()))
}

fn write_clawpet_config_json(value: &Value) -> Result<(), String> {
    let path = clawpet_config_path().ok_or_else(|| "home directory not available".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating {}: {e}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("failed serializing config: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("failed writing {}: {e}", path.display()))
}

#[tauri::command(rename_all = "camelCase")]
fn get_reactivity_settings() -> ReactivitySettings {
    let levels = vec!["off", "minimal", "balanced", "expressive", "maximum"];
    match read_clawpet_config_json() {
        Ok(value) => ReactivitySettings {
            available: true,
            activity: value
                .get("activity")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            heartbeat_reactions: value.get("heartbeatReactions").and_then(|v| v.as_bool()),
            activity_levels: levels,
            error: None,
        },
        Err(error) => ReactivitySettings {
            available: false,
            activity: None,
            heartbeat_reactions: None,
            activity_levels: levels,
            error: Some(error),
        },
    }
}

#[tauri::command(rename_all = "camelCase")]
fn set_reactivity_settings(activity: Option<String>, heartbeat_reactions: Option<bool>) -> Result<ReactivitySettings, String> {
    let allowed = ["off", "minimal", "balanced", "expressive", "maximum"];
    if let Some(ref level) = activity {
        if !allowed.contains(&level.as_str()) {
            return Err(format!("unsupported activity level: {level}"));
        }
    }

    let mut value = match read_clawpet_config_json() {
        Ok(v) => v,
        Err(_) => json!({}),
    };

    let obj = value
        .as_object_mut()
        .ok_or_else(|| "config root is not an object".to_string())?;

    if let Some(level) = activity {
        obj.insert("activity".to_string(), Value::String(level));
    }
    if let Some(enabled) = heartbeat_reactions {
        obj.insert("heartbeatReactions".to_string(), Value::Bool(enabled));
    }

    write_clawpet_config_json(&value)?;
    Ok(get_reactivity_settings())
}

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
        .invoke_handler(tauri::generate_handler![get_reactivity_settings, set_reactivity_settings])
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
                // Closing a window should tuck Clawpet back into the tray rather than
                // quitting the whole app. The setup/control surface (`main`) was
                // mistakenly being re-shown immediately, which made it feel impossible
                // to close. Hide both windows here; tray quit remains the true exit.
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
