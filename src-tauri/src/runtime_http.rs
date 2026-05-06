use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
struct AvatarStatus {
    #[serde(rename = "avatarId")]
    avatar_id: String,
    state: String,
    #[serde(rename = "bundleVersion")]
    bundle_version: String,
    bubble: String,
}

#[derive(Clone, Serialize)]
struct Status {
    #[serde(rename = "type")]
    kind: String,
    version: String,
    #[serde(rename = "runtimeId")]
    runtime_id: String,
    #[serde(rename = "deviceName")]
    device_name: String,
    mode: String,
    connected: bool,
    avatar: AvatarStatus,
    #[serde(rename = "lastEventAt")]
    last_event_at: Option<String>,
}

#[derive(Clone, Serialize)]
struct EventSource {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "instanceId")]
    instance_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct EventPayload {
    #[serde(rename = "eventId")]
    event_id: String,
    #[serde(rename = "sentAt")]
    sent_at: String,
    state: String,
    message: Option<String>,
    bubble: Option<String>,
    source: EventSource,
}

#[derive(Clone, Serialize)]
struct EventEntry {
    event: EventPayload,
    #[serde(rename = "receivedAt")]
    received_at: String,
    #[serde(rename = "latencyMs")]
    latency_ms: Option<u128>,
}

#[derive(Clone)]
struct PairMode {
    code: String,
    expires_at: u128,
    attempts: u8,
}

struct RuntimeState {
    status: Status,
    token: String,
    pair_mode: Option<PairMode>,
    bundle_manifest: Option<serde_json::Value>,
    bundle_assets: HashMap<String, Vec<u8>>,
    raw_state: String,
    raw_bubble: String,
    last_event_at_ms: Option<u128>,
    events: Vec<EventEntry>,
    reactivity: ReactivityMirror,
}

#[derive(Clone, Serialize, Deserialize)]
struct ReactivityMirror {
    available: bool,
    activity: Option<String>,
    #[serde(rename = "heartbeatReactions")]
    heartbeat_reactions: Option<bool>,
    #[serde(rename = "activityLevels")]
    activity_levels: Vec<String>,
    writable: bool,
    #[serde(rename = "managedBy")]
    managed_by: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct PairStartBody {
    seconds: Option<u64>,
}
#[derive(Deserialize)]
struct PairClaimBody {
    code: String,
}
#[derive(Deserialize)]
struct AvatarEvent {
    state: String,
    bubble: Option<String>,
    message: Option<String>,
}
#[derive(Deserialize)]
struct AvatarBundleUpload {
    manifest: serde_json::Value,
    assets: HashMap<String, String>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
}
fn now_iso() -> String {
    format!("{}", now_ms())
}
fn random_string(n: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(n)
        .map(char::from)
        .collect()
}
fn random_code() -> String {
    format!("{:06}", rand::thread_rng().gen_range(0..1_000_000))
}

fn display_host() -> String {
    std::env::var("CLAWPET_DISPLAY_HOST")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "<display-host>".into())
}

fn token_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(
        PathBuf::from(home)
            .join(".openclaw")
            .join("clawpet")
            .join("runtime-token"),
    )
}

fn runtime_bundle_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(
        PathBuf::from(home)
            .join(".openclaw")
            .join("clawpet")
            .join("runtime-bundles")
            .join("current"),
    )
}

fn reactivity_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(
        PathBuf::from(home)
            .join(".openclaw")
            .join("clawpet")
            .join("runtime-reactivity.json"),
    )
}

fn default_reactivity(error: Option<String>) -> ReactivityMirror {
    ReactivityMirror {
        available: false,
        activity: None,
        heartbeat_reactions: None,
        activity_levels: vec!["off", "minimal", "balanced", "expressive", "maximum"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        writable: false,
        managed_by: "openclaw-host".into(),
        error,
    }
}

fn load_reactivity() -> ReactivityMirror {
    let Some(path) = reactivity_path() else {
        return default_reactivity(Some("home directory not available".into()));
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return default_reactivity(Some("waiting for paired OpenClaw host sync".into()));
    };
    serde_json::from_str(&text)
        .unwrap_or_else(|_| default_reactivity(Some("invalid reactivity mirror".into())))
}

fn persist_reactivity(reactivity: &ReactivityMirror) {
    let Some(path) = reactivity_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(reactivity) {
        let _ = fs::write(path, text);
    }
}

fn load_persisted_bundle() -> (Option<serde_json::Value>, HashMap<String, Vec<u8>>) {
    let Some(dir) = runtime_bundle_dir() else {
        return (None, HashMap::new());
    };
    let manifest_path = dir.join("avatar.json");
    let Ok(manifest_text) = fs::read_to_string(manifest_path) else {
        return (None, HashMap::new());
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_text) else {
        return (None, HashMap::new());
    };
    let mut assets = HashMap::new();
    if let Some(states) = manifest.get("states").and_then(|v| v.as_object()) {
        for def in states.values() {
            if let Some(asset) = def.get("asset").and_then(|v| v.as_str()) {
                load_bundle_file(&dir, asset, &mut assets);
            }
            if let Some(fallback) = def.get("fallbackAsset").and_then(|v| v.as_str()) {
                load_bundle_file(&dir, fallback, &mut assets);
            }
            if let Some(frames) = def.get("frames").and_then(|v| v.as_array()) {
                for frame in frames.iter().filter_map(|v| v.as_str()) {
                    load_bundle_file(&dir, frame, &mut assets);
                }
            }
        }
    }
    (Some(manifest), assets)
}

fn valid_bundle_file_path(path: &str) -> bool {
    let Some((folder, name)) = path.split_once('/') else {
        return false;
    };
    (folder == "assets" || folder == "frames")
        && !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !path.contains("..")
        && path.ends_with(".png")
}

fn load_bundle_file(dir: &PathBuf, rel: &str, assets: &mut HashMap<String, Vec<u8>>) {
    if !valid_bundle_file_path(rel) {
        return;
    }
    let Some((folder, name)) = rel.split_once('/') else {
        return;
    };
    if let Ok(bytes) = fs::read(dir.join(folder).join(name)) {
        assets.insert(rel.to_string(), bytes);
    }
}

fn persist_bundle(manifest: &serde_json::Value, assets: &HashMap<String, Vec<u8>>) {
    let Some(dir) = runtime_bundle_dir() else {
        return;
    };
    let _ = fs::create_dir_all(dir.join("assets"));
    let _ = fs::create_dir_all(dir.join("frames"));
    if let Ok(text) = serde_json::to_string_pretty(manifest) {
        let _ = fs::write(dir.join("avatar.json"), text);
    }
    for (asset_path, bytes) in assets {
        if valid_bundle_file_path(asset_path) {
            if let Some((folder, name)) = asset_path.split_once('/') {
                let _ = fs::write(dir.join(folder).join(name), bytes);
            }
        }
    }
}

fn load_or_create_token() -> String {
    if let Some(path) = token_path() {
        if let Ok(token) = fs::read_to_string(&path) {
            let token = token.trim().to_string();
            if token.len() >= 32 {
                return token;
            }
        }
        let token = random_string(64);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, &token);
        return token;
    }
    random_string(64)
}

fn persist_token(token: &str) {
    if let Some(path) = token_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, token);
    }
}

const TERMINAL_LINGER_MS: u128 = 8_000;
const ACTIVE_LINGER_MS: u128 = 45_000;
const SLEEPY_AFTER_MS: u128 = 5 * 60 * 1000;

fn effective_avatar(
    raw_state: &str,
    raw_bubble: &str,
    last_event_at_ms: Option<u128>,
) -> AvatarStatus {
    let mut state = raw_state.to_string();
    if let Some(last) = last_event_at_ms {
        let elapsed = now_ms().saturating_sub(last);
        state = match raw_state {
            "sleepy" => "sleepy".into(),
            "idle" if elapsed >= SLEEPY_AFTER_MS => "sleepy".into(),
            "idle" => "idle".into(),
            "happy" if elapsed >= TERMINAL_LINGER_MS + SLEEPY_AFTER_MS => "sleepy".into(),
            "happy" if elapsed >= TERMINAL_LINGER_MS => "idle".into(),
            "happy" => "happy".into(),
            "thinking" | "focused" | "alert" if elapsed >= ACTIVE_LINGER_MS + SLEEPY_AFTER_MS => {
                "sleepy".into()
            }
            "thinking" | "focused" | "alert" if elapsed >= ACTIVE_LINGER_MS => "idle".into(),
            _ => raw_state.to_string(),
        };
    }
    let bubble = if state == "idle" || state == "sleepy" {
        "idle".into()
    } else {
        raw_bubble.to_string()
    };
    AvatarStatus {
        avatar_id: "dawn-v0".into(),
        state,
        bundle_version: "0.1.0".into(),
        bubble,
    }
}

pub fn start_runtime_server() {
    thread::spawn(|| {
        let initial_token = load_or_create_token();
        let (bundle_manifest, bundle_assets) = load_persisted_bundle();
        let initial_avatar_id = bundle_manifest
            .as_ref()
            .and_then(|m| m.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("dawn-v0")
            .to_string();
        let initial_bundle_version = bundle_manifest
            .as_ref()
            .and_then(|m| m.get("version"))
            .and_then(|v| v.as_str())
            .unwrap_or("0.1.0")
            .to_string();
        let state = Arc::new(Mutex::new(RuntimeState {
            status: Status {
                kind: "clawpet.status".into(),
                version: "0.1.0".into(),
                runtime_id: "clawpet-tauri-runtime".into(),
                device_name: "Clawpet Desktop".into(),
                mode: "desktop-app".into(),
                connected: true,
                avatar: AvatarStatus {
                    avatar_id: initial_avatar_id,
                    state: "idle".into(),
                    bundle_version: initial_bundle_version,
                    bubble: "idle".into(),
                },
                last_event_at: None,
            },
            token: initial_token,
            pair_mode: None,
            bundle_manifest,
            bundle_assets,
            raw_state: "idle".into(),
            raw_bubble: "idle".into(),
            last_event_at_ms: None,
            events: Vec::new(),
            reactivity: load_reactivity(),
        }));

        let listener = match TcpListener::bind("0.0.0.0:8737") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Clawpet internal runtime failed to bind 0.0.0.0:8737: {e}");
                return;
            }
        };
        eprintln!("Clawpet internal runtime listening on 0.0.0.0:8737");
        for stream in listener.incoming().flatten() {
            let state = Arc::clone(&state);
            thread::spawn(move || handle_client(stream, state));
        }
    });
}

fn handle_client(mut stream: TcpStream, state: Arc<Mutex<RuntimeState>>) {
    let mut buf = vec![0u8; 128 * 1024];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let header_end = buf[..n]
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
        .unwrap_or(n);
    let head = String::from_utf8_lossy(&buf[..header_end.saturating_sub(4)]);
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("");
    let raw_path = request_parts.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or(raw_path);
    let headers: HashMap<String, String> = lines
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            Some((k.trim().to_ascii_lowercase(), v.trim().to_string()))
        })
        .collect();

    let content_len = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body_bytes = buf[header_end..n].to_vec();
    while body_bytes.len() < content_len {
        let mut chunk = vec![0u8; (content_len - body_bytes.len()).min(128 * 1024)];
        let read = match stream.read(&mut chunk) {
            Ok(n) => n,
            Err(_) => return,
        };
        if read == 0 {
            break;
        }
        body_bytes.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8_lossy(&body_bytes);

    let result = route(method, path, &headers, &body, state);
    let _ = stream.write_all(&result);
}

fn route(
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &str,
    state: Arc<Mutex<RuntimeState>>,
) -> Vec<u8> {
    if method == "OPTIONS" {
        return response(204, json!({}));
    }
    if method == "GET" && path == "/health" {
        return response(
            200,
            json!({
              "ok": true,
              "service": "clawpet-runtime",
              "version": "0.1.0",
              "authRequired": true,
              "runtime": "tauri-internal",
              "owner": "clawpet-desktop-app",
              "displayHost": display_host()
            }),
        );
    }
    if method == "GET" && path == "/pair-mode" {
        let mut s = state.lock().unwrap();
        let active = s
            .pair_mode
            .as_ref()
            .map(|p| p.expires_at > now_ms())
            .unwrap_or(false);
        if !active {
            s.pair_mode = None;
            return response(200, json!({ "active": false }));
        }
        let p = s.pair_mode.as_ref().unwrap();
        return response(200, json!({ "active": true, "expiresAt": p.expires_at }));
    }
    if method == "POST" && path == "/admin/pair-mode/start" {
        let seconds = serde_json::from_str::<PairStartBody>(body)
            .ok()
            .and_then(|b| b.seconds)
            .unwrap_or(120)
            .min(300);
        let mut s = state.lock().unwrap();
        let code = random_code();
        let expires_at = now_ms() + (seconds as u128 * 1000);
        s.pair_mode = Some(PairMode {
            code: code.clone(),
            expires_at,
            attempts: 0,
        });
        return response(
            200,
            json!({ "ok": true, "code": code, "expiresAt": expires_at, "durationMs": seconds * 1000 }),
        );
    }
    if method == "POST" && path == "/pair/claim" {
        let claim = match serde_json::from_str::<PairClaimBody>(body) {
            Ok(c) => c,
            Err(_) => return response(400, json!({"ok":false,"errors":["code required"]})),
        };
        let mut s = state.lock().unwrap();
        let now = now_ms();
        let Some(pm) = s.pair_mode.as_mut() else {
            return response(404, json!({"ok":false,"errors":["not found"]}));
        };
        if pm.expires_at <= now {
            s.pair_mode = None;
            return response(404, json!({"ok":false,"errors":["not found"]}));
        }
        if pm.code != claim.code {
            pm.attempts += 1;
            if pm.attempts >= 3 {
                s.pair_mode = None;
                return response(403, json!({"ok":false,"errors":["too many attempts"]}));
            }
            return response(401, json!({"ok":false,"errors":["invalid code"]}));
        }
        s.token = random_string(64);
        persist_token(&s.token);
        s.pair_mode = None;
        return response(200, json!({ "ok": true, "token": s.token }));
    }

    if method == "GET" && path == "/status" {
        let mut s = state.lock().unwrap();
        let mut avatar = effective_avatar(&s.raw_state, &s.raw_bubble, s.last_event_at_ms);
        avatar.avatar_id = s.status.avatar.avatar_id.clone();
        avatar.bundle_version = s.status.avatar.bundle_version.clone();
        s.status.avatar = avatar;
        return response(200, serde_json::to_value(&s.status).unwrap());
    }

    if method == "GET" && path == "/events" {
        let s = state.lock().unwrap();
        return response(200, json!({ "events": s.events }));
    }

    if method == "GET" && path == "/reactivity" {
        let s = state.lock().unwrap();
        return response(200, serde_json::to_value(&s.reactivity).unwrap());
    }

    if method == "GET" && path == "/avatar-bundle/current/avatar.json" {
        let s = state.lock().unwrap();
        if let Some(m) = &s.bundle_manifest {
            return response(200, m.clone());
        }
        return response(
            404,
            json!({"ok":false,"errors":["no runtime avatar bundle has been uploaded"]}),
        );
    }

    if method == "GET" && path.starts_with("/avatar-bundle/current/assets/") {
        let name = path.trim_start_matches("/avatar-bundle/current/assets/");
        if name.contains("..") || name.contains('/') || name.contains('\\') {
            return response(400, json!({"ok":false,"errors":["invalid asset path"]}));
        }
        let key = format!("assets/{name}");
        let s = state.lock().unwrap();
        if let Some(bytes) = s.bundle_assets.get(&key) {
            return binary_response(200, "image/png", bytes);
        }
        return response(404, json!({"ok":false,"errors":["asset not found"]}));
    }

    if method == "GET" && path.starts_with("/avatar-bundle/current/frames/") {
        let name = path.trim_start_matches("/avatar-bundle/current/frames/");
        if name.contains("..") || name.contains('/') || name.contains('\\') {
            return response(400, json!({"ok":false,"errors":["invalid frame path"]}));
        }
        let key = format!("frames/{name}");
        let s = state.lock().unwrap();
        if let Some(bytes) = s.bundle_assets.get(&key) {
            return binary_response(200, "image/png", bytes);
        }
        return response(404, json!({"ok":false,"errors":["frame not found"]}));
    }

    if !authorized(headers, &state) {
        return response(
            401,
            json!({"ok":false,"errors":["authentication required"]}),
        );
    }

    if method == "GET" && path == "/auth/check" {
        return response(200, json!({ "ok": true, "authenticated": true }));
    }

    if method == "POST" && path == "/admin/rotate-token" {
        let mut s = state.lock().unwrap();
        s.token = random_string(64);
        persist_token(&s.token);
        return response(200, json!({ "ok": true, "token": s.token }));
    }

    if method == "POST" && path == "/admin/avatar-bundle" {
        if !authorized(headers, &state) {
            return response(401, json!({"ok":false,"errors":["authentication required"]}));
        }
        let upload = match serde_json::from_str::<AvatarBundleUpload>(body) {
            Ok(u) => u,
            Err(_) => {
                return response(
                    400,
                    json!({"ok":false,"errors":["invalid avatar bundle upload"]}),
                )
            }
        };
        let mut decoded = HashMap::new();
        for (asset_path, b64) in upload.assets.iter() {
            if !valid_bundle_file_path(asset_path) {
                return response(
                    400,
                    json!({"ok":false,"errors":[format!("invalid asset path: {asset_path}")]}),
                );
            }
            let bytes = match STANDARD.decode(b64) {
                Ok(b) => b,
                Err(_) => {
                    return response(
                        400,
                        json!({"ok":false,"errors":[format!("invalid base64 asset: {asset_path}")]}),
                    )
                }
            };
            if bytes.len() < 8 || &bytes[0..4] != b"\x89PNG" {
                return response(
                    400,
                    json!({"ok":false,"errors":[format!("asset is not PNG: {asset_path}")]}),
                );
            }
            decoded.insert(asset_path.clone(), bytes);
        }
        let avatar_id = upload
            .manifest
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("uploaded")
            .to_string();
        let version = upload
            .manifest
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("uploaded")
            .to_string();
        let mut s = state.lock().unwrap();
        persist_bundle(&upload.manifest, &decoded);
        s.bundle_manifest = Some(upload.manifest);
        s.bundle_assets = decoded;
        s.status.avatar.avatar_id = avatar_id.clone();
        s.status.avatar.bundle_version = version.clone();
        s.status.last_event_at = Some(now_iso());
        s.last_event_at_ms = Some(now_ms());
        return response(
            200,
            json!({"ok":true,"avatarId":avatar_id,"bundleVersion":version,"assetCount":s.bundle_assets.len(),"status":s.status}),
        );
    }

    if method == "POST" && path == "/avatar/state" {
        if !authorized(headers, &state) {
            return response(401, json!({"ok":false,"errors":["authentication required"]}));
        }
        let ev = match serde_json::from_str::<AvatarEvent>(body) {
            Ok(e) => e,
            Err(_) => return response(400, json!({"ok":false,"errors":["invalid avatar event"]})),
        };
        let mut s = state.lock().unwrap();
        let received_at = now_iso();
        let event_id = format!("evt_{}", now_ms());
        s.raw_state = ev.state;
        let bubble = ev.bubble;
        let message = ev.message;
        s.raw_bubble = bubble
            .clone()
            .or(message.clone())
            .unwrap_or_else(|| s.raw_state.clone());
        s.status.avatar.state = s.raw_state.clone();
        s.status.avatar.bubble = s.raw_bubble.clone();
        s.status.last_event_at = Some(received_at.clone());
        s.last_event_at_ms = Some(now_ms());
        let state_name = s.raw_state.clone();
        s.events.insert(
            0,
            EventEntry {
                event: EventPayload {
                    event_id,
                    sent_at: received_at.clone(),
                    state: state_name,
                    message,
                    bubble,
                    source: EventSource {
                        display_name: Some("OpenClaw".into()),
                        instance_id: None,
                    },
                },
                received_at,
                latency_ms: Some(0),
            },
        );
        if s.events.len() > 50 {
            s.events.truncate(50);
        }
        return response(200, json!({ "ok": true, "status": s.status }));
    }

    if method == "POST" && path == "/admin/reactivity" {
        if !authorized(headers, &state) {
            return response(401, json!({"ok":false,"errors":["authentication required"]}));
        }
        let incoming = match serde_json::from_str::<ReactivityMirror>(body) {
            Ok(value) => value,
            Err(_) => return response(400, json!({"ok":false,"errors":["invalid reactivity payload"]})),
        };
        let mut s = state.lock().unwrap();
        s.reactivity = ReactivityMirror {
            available: incoming.available,
            activity: incoming.activity,
            heartbeat_reactions: incoming.heartbeat_reactions,
            activity_levels: if incoming.activity_levels.is_empty() {
                default_reactivity(None).activity_levels
            } else {
                incoming.activity_levels
            },
            writable: false,
            managed_by: "openclaw-host".into(),
            error: incoming.error,
        };
        persist_reactivity(&s.reactivity);
        return response(200, serde_json::to_value(&s.reactivity).unwrap());
    }

    response(404, json!({"ok":false,"errors":["not found"]}))
}

fn binary_response(status: u16, content_type: &str, bytes: &[u8]) -> Vec<u8> {
    let status_text = match status {
        200 => "OK",
        _ => "Error",
    };
    let mut head = format!(
    "HTTP/1.1 {status} {status_text}\r\ncontent-type: {content_type}\r\naccess-control-allow-origin: *\r\ncache-control: no-store\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
    bytes.len()
  ).into_bytes();
    head.extend_from_slice(bytes);
    head
}

fn authorized(headers: &HashMap<String, String>, state: &Arc<Mutex<RuntimeState>>) -> bool {
    let Some(auth) = headers.get("authorization") else {
        return false;
    };
    let token = state.lock().unwrap().token.clone();
    auth.trim() == format!("Bearer {token}")
}

fn response(status: u16, body: serde_json::Value) -> Vec<u8> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    let body = if status == 204 {
        String::new()
    } else {
        body.to_string()
    };
    format!(
    "HTTP/1.1 {status} {status_text}\r\ncontent-type: application/json\r\naccess-control-allow-origin: *\r\naccess-control-allow-methods: GET,POST,OPTIONS\r\naccess-control-allow-headers: content-type,authorization\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
    body.len(), body
  ).into_bytes()
}
