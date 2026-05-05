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
}

#[derive(Deserialize)]
struct PairStartBody { seconds: Option<u64> }
#[derive(Deserialize)]
struct PairClaimBody { code: String }
#[derive(Deserialize)]
struct AvatarEvent { state: String, bubble: Option<String>, message: Option<String> }
#[derive(Deserialize)]
struct AvatarBundleUpload { manifest: serde_json::Value, assets: HashMap<String, String> }

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() }
fn now_iso() -> String { format!("{}", now_ms()) }
fn random_string(n: usize) -> String { rand::thread_rng().sample_iter(&Alphanumeric).take(n).map(char::from).collect() }
fn random_code() -> String { format!("{:06}", rand::thread_rng().gen_range(0..1_000_000)) }

fn token_path() -> Option<PathBuf> {
  let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
  Some(PathBuf::from(home).join(".openclaw").join("clawpet").join("runtime-token"))
}

fn load_or_create_token() -> String {
  if let Some(path) = token_path() {
    if let Ok(token) = fs::read_to_string(&path) {
      let token = token.trim().to_string();
      if token.len() >= 32 { return token; }
    }
    let token = random_string(64);
    if let Some(parent) = path.parent() { let _ = fs::create_dir_all(parent); }
    let _ = fs::write(&path, &token);
    return token;
  }
  random_string(64)
}

fn persist_token(token: &str) {
  if let Some(path) = token_path() {
    if let Some(parent) = path.parent() { let _ = fs::create_dir_all(parent); }
    let _ = fs::write(path, token);
  }
}

const TERMINAL_LINGER_MS: u128 = 8_000;
const ACTIVE_LINGER_MS: u128 = 45_000;
const SLEEPY_AFTER_MS: u128 = 5 * 60 * 1000;

fn effective_avatar(raw_state: &str, raw_bubble: &str, last_event_at_ms: Option<u128>) -> AvatarStatus {
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
      "thinking" | "focused" | "alert" if elapsed >= ACTIVE_LINGER_MS + SLEEPY_AFTER_MS => "sleepy".into(),
      "thinking" | "focused" | "alert" if elapsed >= ACTIVE_LINGER_MS => "idle".into(),
      _ => raw_state.to_string(),
    };
  }
  let bubble = if state == "idle" || state == "sleepy" { "idle".into() } else { raw_bubble.to_string() };
  AvatarStatus { avatar_id: "dawn-v0".into(), state, bundle_version: "0.1.0".into(), bubble }
}

pub fn start_runtime_server() {
  thread::spawn(|| {
    let initial_token = load_or_create_token();
    let state = Arc::new(Mutex::new(RuntimeState {
      status: Status {
        kind: "clawpet.status".into(),
        version: "0.1.0".into(),
        runtime_id: "clawpet-tauri-runtime".into(),
        device_name: "Clawpet Desktop".into(),
        mode: "desktop-app".into(),
        connected: true,
        avatar: AvatarStatus { avatar_id: "dawn-v0".into(), state: "idle".into(), bundle_version: "0.1.0".into(), bubble: "idle".into() },
        last_event_at: None,
      },
      token: initial_token,
      pair_mode: None,
      bundle_manifest: None,
      bundle_assets: HashMap::new(),
      raw_state: "idle".into(),
      raw_bubble: "idle".into(),
      last_event_at_ms: None,
    }));

    let listener = match TcpListener::bind("0.0.0.0:8737") {
      Ok(l) => l,
      Err(e) => { eprintln!("Clawpet internal runtime failed to bind 0.0.0.0:8737: {e}"); return; }
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
  let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
  let req = String::from_utf8_lossy(&buf[..n]);
  let mut parts = req.split("\r\n\r\n");
  let head = parts.next().unwrap_or("");
  let body = parts.next().unwrap_or("");
  let mut lines = head.lines();
  let request_line = lines.next().unwrap_or("");
  let mut request_parts = request_line.split_whitespace();
  let method = request_parts.next().unwrap_or("");
  let path = request_parts.next().unwrap_or("/");
  let headers: HashMap<String, String> = lines.filter_map(|l| {
    let (k, v) = l.split_once(':')?;
    Some((k.trim().to_ascii_lowercase(), v.trim().to_string()))
  }).collect();

  let result = route(method, path, &headers, body, state);
  let _ = stream.write_all(&result);
}

fn route(method: &str, path: &str, headers: &HashMap<String, String>, body: &str, state: Arc<Mutex<RuntimeState>>) -> Vec<u8> {
  if method == "OPTIONS" { return response(204, json!({})); }
  if method == "GET" && path == "/health" {
    return response(200, json!({
      "ok": true,
      "service": "clawpet-runtime",
      "version": "0.1.0",
      "authRequired": true,
      "runtime": "tauri-internal",
      "owner": "clawpet-desktop-app"
    }));
  }
  if method == "GET" && path == "/pair-mode" {
    let mut s = state.lock().unwrap();
    let active = s.pair_mode.as_ref().map(|p| p.expires_at > now_ms()).unwrap_or(false);
    if !active { s.pair_mode = None; return response(200, json!({ "active": false })); }
    let p = s.pair_mode.as_ref().unwrap();
    return response(200, json!({ "active": true, "expiresAt": p.expires_at }));
  }
  if method == "POST" && path == "/admin/pair-mode/start" {
    let seconds = serde_json::from_str::<PairStartBody>(body).ok().and_then(|b| b.seconds).unwrap_or(120).min(300);
    let mut s = state.lock().unwrap();
    let code = random_code();
    let expires_at = now_ms() + (seconds as u128 * 1000);
    s.pair_mode = Some(PairMode { code: code.clone(), expires_at, attempts: 0 });
    return response(200, json!({ "ok": true, "code": code, "expiresAt": expires_at, "durationMs": seconds * 1000 }));
  }
  if method == "POST" && path == "/pair/claim" {
    let claim = match serde_json::from_str::<PairClaimBody>(body) { Ok(c) => c, Err(_) => return response(400, json!({"ok":false,"errors":["code required"]})) };
    let mut s = state.lock().unwrap();
    let now = now_ms();
    let Some(pm) = s.pair_mode.as_mut() else { return response(404, json!({"ok":false,"errors":["not found"]})); };
    if pm.expires_at <= now { s.pair_mode = None; return response(404, json!({"ok":false,"errors":["not found"]})); }
    if pm.code != claim.code {
      pm.attempts += 1;
      if pm.attempts >= 3 { s.pair_mode = None; return response(403, json!({"ok":false,"errors":["too many attempts"]})); }
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

  if method == "GET" && path == "/avatar-bundle/current/avatar.json" {
    let s = state.lock().unwrap();
    if let Some(m) = &s.bundle_manifest { return response(200, m.clone()); }
    return response(404, json!({"ok":false,"errors":["no runtime avatar bundle has been uploaded"]}));
  }

  if method == "GET" && path.starts_with("/avatar-bundle/current/assets/") {
    let name = path.trim_start_matches("/avatar-bundle/current/assets/");
    if name.contains("..") || name.contains('/') || name.contains('\\') {
      return response(400, json!({"ok":false,"errors":["invalid asset path"]}));
    }
    let key = format!("assets/{name}");
    let s = state.lock().unwrap();
    if let Some(bytes) = s.bundle_assets.get(&key) { return binary_response(200, "image/png", bytes); }
    return response(404, json!({"ok":false,"errors":["asset not found"]}));
  }

  if !authorized(headers, &state) { return response(401, json!({"ok":false,"errors":["authentication required"]})); }

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
    let upload = match serde_json::from_str::<AvatarBundleUpload>(body) {
      Ok(u) => u,
      Err(_) => return response(400, json!({"ok":false,"errors":["invalid avatar bundle upload"]})),
    };
    let mut decoded = HashMap::new();
    for (asset_path, b64) in upload.assets.iter() {
      if !asset_path.starts_with("assets/") || asset_path.contains("..") || !asset_path.ends_with(".png") {
        return response(400, json!({"ok":false,"errors":[format!("invalid asset path: {asset_path}")]}));
      }
      let bytes = match STANDARD.decode(b64) {
        Ok(b) => b,
        Err(_) => return response(400, json!({"ok":false,"errors":[format!("invalid base64 asset: {asset_path}")]})),
      };
      if bytes.len() < 8 || &bytes[0..4] != b"\x89PNG" {
        return response(400, json!({"ok":false,"errors":[format!("asset is not PNG: {asset_path}")]}));
      }
      decoded.insert(asset_path.clone(), bytes);
    }
    let avatar_id = upload.manifest.get("name").and_then(|v| v.as_str()).unwrap_or("uploaded").to_string();
    let version = upload.manifest.get("version").and_then(|v| v.as_str()).unwrap_or("uploaded").to_string();
    let mut s = state.lock().unwrap();
    s.bundle_manifest = Some(upload.manifest);
    s.bundle_assets = decoded;
    s.status.avatar.avatar_id = avatar_id.clone();
    s.status.avatar.bundle_version = version.clone();
    s.status.last_event_at = Some(now_iso());
    s.last_event_at_ms = Some(now_ms());
    return response(200, json!({"ok":true,"avatarId":avatar_id,"bundleVersion":version,"assetCount":s.bundle_assets.len(),"status":s.status}));
  }

  if method == "POST" && path == "/avatar/state" {
    let ev = match serde_json::from_str::<AvatarEvent>(body) { Ok(e) => e, Err(_) => return response(400, json!({"ok":false,"errors":["invalid avatar event"]})) };
    let mut s = state.lock().unwrap();
    s.raw_state = ev.state;
    s.raw_bubble = ev.bubble.or(ev.message).unwrap_or_else(|| s.raw_state.clone());
    s.status.avatar.state = s.raw_state.clone();
    s.status.avatar.bubble = s.raw_bubble.clone();
    s.status.last_event_at = Some(now_iso());
    s.last_event_at_ms = Some(now_ms());
    return response(200, json!({ "ok": true, "status": s.status }));
  }

  response(404, json!({"ok":false,"errors":["not found"]}))
}

fn binary_response(status: u16, content_type: &str, bytes: &[u8]) -> Vec<u8> {
  let status_text = match status { 200 => "OK", _ => "Error" };
  let mut head = format!(
    "HTTP/1.1 {status} {status_text}\r\ncontent-type: {content_type}\r\naccess-control-allow-origin: *\r\ncache-control: no-store\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
    bytes.len()
  ).into_bytes();
  head.extend_from_slice(bytes);
  head
}

fn authorized(headers: &HashMap<String, String>, state: &Arc<Mutex<RuntimeState>>) -> bool {
  let Some(auth) = headers.get("authorization") else { return false; };
  let token = state.lock().unwrap().token.clone();
  auth.trim() == format!("Bearer {token}")
}

fn response(status: u16, body: serde_json::Value) -> Vec<u8> {
  let status_text = match status { 200 => "OK", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found", _ => "Error" };
  let body = if status == 204 { String::new() } else { body.to_string() };
  format!(
    "HTTP/1.1 {status} {status_text}\r\ncontent-type: application/json\r\naccess-control-allow-origin: *\r\naccess-control-allow-methods: GET,POST,OPTIONS\r\naccess-control-allow-headers: content-type,authorization\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
    body.len(), body
  ).into_bytes()
}
