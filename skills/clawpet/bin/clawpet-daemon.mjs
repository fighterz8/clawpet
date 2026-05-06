#!/usr/bin/env node
// Clawpet daemon — tails the active OpenClaw session JSONL and dispatches
// avatar reactions in real time. Zero LLM-token cost: runs as a sidecar.
//
// Subscribes to: user messages, assistant tool calls, assistant final answers.
// Dispatches: clawpet react <event> --bubble … --quiet
//
// Activity-level gating happens inside `clawpet react` itself, so this daemon
// just fires events; the user's `clawpet activity <level>` decides what lands.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, statSync, existsSync, openSync, readSync, closeSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = join(dirname(__filename), "clawpet.mjs");

const STATE_DIR = join(homedir(), ".openclaw", "clawpet");
const PID_FILE = join(STATE_DIR, "daemon.pid");
const LOG_FILE = join(STATE_DIR, "daemon.log");
const SESSIONS_DIR = process.env.CLAWPET_SESSIONS_DIR ||
  join(homedir(), ".openclaw", "agents", "main", "sessions");

const POLL_MS = 400;       // how often to check for new bytes
const ROTATE_MS = 5000;    // how often to re-scan for newer session file
const AVATAR_RECONCILE_MS = 30_000; // re-assert OpenClaw's desired avatar after runtime restarts

// ---------- Daemon voice dictionary ----------
// Preset, zero-token phrase pools. `lite` keeps one compact phrase; `vivid`
// gives a richer deterministic pool. `silent` suppresses daemon bubbles.

const DAEMON_VOICE_LEVELS = ["silent", "lite", "vivid"];
const DEFAULT_DAEMON_VOICE = "lite";

const DAEMON_EVENTS = {
  exec:            { state: "focused",  lite: ["Running…"], vivid: ["Running a command…", "Checking the machine…", "Trying this locally…", "Testing a path…", "Poking the runtime…"] },
  process:         { state: "thinking", lite: ["Checking…"], vivid: ["Checking command…", "Reading command output…", "Watching the process…", "Waiting on the result…"] },
  read:            { state: "thinking", lite: ["Reading…"], vivid: ["Reading files…", "Inspecting the repo…", "Looking at the code…", "Tracing the logic…", "Skimming the file…"] },
  edit:            { state: "focused",  lite: ["Editing…"], vivid: ["Editing files…", "Making the change…", "Refining the patch…", "Adjusting the UI…", "Tightening this up…"] },
  write:           { state: "focused",  lite: ["Writing…"], vivid: ["Writing files…", "Saving changes…", "Drafting the update…", "Laying this down…"] },
  apply_patch:     { state: "focused",  lite: ["Patching…"], vivid: ["Patching files…", "Applying patch…", "Sewing in the fix…", "Landing the patch…"] },
  web_fetch:       { state: "thinking", lite: ["Fetching…"], vivid: ["Reading web page…", "Fetching docs…", "Pulling the page…", "Checking the docs…"] },
  web_search:      { state: "thinking", lite: ["Searching…"], vivid: ["Searching web…", "Looking it up…", "Hunting for context…", "Checking the web…"] },
  memory_search:   { state: "thinking", lite: ["Recalling…"], vivid: ["Checking memory…", "Looking back…", "Recalling context…", "Searching memory…"] },
  memory_get:      { state: "thinking", lite: ["Recalling…"], vivid: ["Reading memory…", "Pulling context…", "Checking the notes…", "Opening memory…"] },
  image:           { state: "thinking", lite: ["Inspecting…"], vivid: ["Inspecting image…", "Looking at the image…", "Reading the visual…"] },
  image_generate:  { state: "focused",  lite: ["Generating…"], vivid: ["Generating image…", "Rendering the image…", "Composing a visual…"] },
  video_generate:  { state: "focused",  lite: ["Rendering…"], vivid: ["Generating video…", "Rendering the clip…", "Building the video…"] },
  sessions_spawn:  { state: "focused",  lite: ["Delegating…"], vivid: ["Starting helper…", "Spinning up backup…", "Handing this off…"] },
  sessions_send:   { state: "focused",  lite: ["Delegating…"], vivid: ["Delegating task…", "Passing a note…", "Forwarding the task…"] },
  update_plan:     { state: "thinking", lite: ["Planning…"], vivid: ["Updating plan…", "Reworking the plan…", "Charting the next step…"] },
  session_status:  { state: "thinking", lite: ["Status…"], vivid: ["Checking status…", "Reading the gauges…", "Taking a quick status read…"] },
  "user-message": { state: "thinking", lite: ["Reading…"], vivid: ["Reading your prompt…", "Got it — reading…", "Prompt received…", "Taking that in…", "Parsing the ask…"] },
  done:            { state: "happy",    lite: ["Done"], vivid: ["Done", "Finished", "Wrapped up", "All set", "Closed out"] },
  __default__:     { state: "thinking", lite: ["Working…"], vivid: ["Working…", "Turning it over…", "Making progress…"] },
};

function stableIndex(seed, length) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return length > 0 ? hash % length : 0;
}

function pickPhrase(list, seed, lastPhrase) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  let index = stableIndex(seed, list.length);
  if (lastPhrase && list.length > 1 && list[index] === lastPhrase) {
    index = (index + 1) % list.length;
  }
  return list[index];
}

function log(line) {
  const stamp = new Date().toISOString();
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `[${stamp}] ${line}\n`);
  } catch {}
}

// ---------- Dispatch ----------
let lastDispatchAt = 0;
const DISPATCH_THROTTLE_MS = 100; // snappy first-prompt/tool reaction without spam

function callClawpet(args) {
  // Fire-and-forget; keep stdout/stderr quiet. clawpet CLI has --quiet.
  const proc = spawn(process.execPath, [CLI, ...args], {
    detached: false,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, CLAWPET_EMIT_SOURCE: "daemon" },
  });
  proc.on("error", () => {}); // swallow
}

function readConfig() {
  try { return JSON.parse(readFileSync(join(STATE_DIR, "config.json"), "utf8")); }
  catch { return {}; }
}

function readActivity() {
  try {
    const cfg = readConfig();
    const v = process.env.CLAWPET_ACTIVITY || cfg.activity || "balanced";
    return ["off", "minimal", "balanced", "expressive", "maximum"].includes(v) ? v : "balanced";
  } catch {
    return process.env.CLAWPET_ACTIVITY || "balanced";
  }
}

function mapActivityToDaemonVoice(activity) {
  switch (activity) {
    case "off": return "silent";
    case "minimal":
    case "balanced": return "lite";
    case "expressive":
    case "maximum": return "vivid";
    default: return DEFAULT_DAEMON_VOICE;
  }
}

function readDaemonVoice() {
  const cfg = readConfig();
  const env = process.env.CLAWPET_DAEMON_VOICE;
  if (env && DAEMON_VOICE_LEVELS.includes(env)) return env;
  if (cfg.daemonVoice && DAEMON_VOICE_LEVELS.includes(cfg.daemonVoice)) return cfg.daemonVoice;
  return mapActivityToDaemonVoice(readActivity());
}

let lastAvatarReconcileAt = 0;
function reconcileDesiredAvatar(force = false) {
  const now = Date.now();
  if (!force && now - lastAvatarReconcileAt < AVATAR_RECONCILE_MS) return;
  lastAvatarReconcileAt = now;
  const cfg = readConfig();
  const dir = cfg.lastAvatarBundleDir;
  if (!dir || !existsSync(dir)) return;
  const status = spawnSync(process.execPath, [CLI, "status"], { encoding: "utf8", timeout: 5000 });
  if (status.status !== 0 || !status.stdout) return;
  let body;
  try { body = JSON.parse(status.stdout); } catch { return; }
  const currentId = body?.avatar?.avatarId;
  const currentVersion = body?.avatar?.bundleVersion;
  if (currentId === cfg.lastAvatarId && currentVersion === cfg.lastBundleVersion) return;
  log(`avatar reconcile: runtime has ${currentId || "unknown"} ${currentVersion || "unknown"}; pushing desired ${cfg.lastAvatarId || "unknown"} ${cfg.lastBundleVersion || "unknown"}`);
  callClawpet(["avatar", "push", dir]);
}

let lastBubbleByEvent = new Map();

function dispatchDaemonEvent(eventName, seedSuffix = "") {
  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_THROTTLE_MS) return;
  lastDispatchAt = now;
  const daemonVoice = readDaemonVoice();
  if (daemonVoice === "silent") return;
  const cfg = DAEMON_EVENTS[eventName] || DAEMON_EVENTS.__default__;
  const pool = cfg[daemonVoice] || cfg.vivid || cfg.lite;
  const lastPhrase = lastBubbleByEvent.get(eventName);
  const bubble = pickPhrase(pool, `${eventName}:${seedSuffix || now}`, lastPhrase);
  if (!bubble) return;
  lastBubbleByEvent.set(eventName, bubble);
  callClawpet(["send", cfg.state, bubble, "--bubble", bubble, "--quiet"]);
  log(`${eventName} -> ${cfg.state} "${bubble}" (${daemonVoice})`);
}

function dispatchToolReaction(toolName, seedSuffix = "") {
  dispatchDaemonEvent(toolName, seedSuffix || toolName);
}

function dispatchUserMessage(seedSuffix = "user") {
  dispatchDaemonEvent("user-message", seedSuffix);
}

function dispatchDone(seedSuffix = "done") {
  dispatchDaemonEvent("done", seedSuffix);
}

// ---------- Session JSONL discovery ----------
function findActiveSessionFile() {
  try {
    const entries = readdirSync(SESSIONS_DIR)
      .filter(n => n.endsWith(".jsonl") && !n.includes(".checkpoint.") && !n.includes(".trajectory"))
      .map(n => {
        const p = join(SESSIONS_DIR, n);
        try { return { p, mtime: statSync(p).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return entries[0]?.p ?? null;
  } catch {
    return null;
  }
}

// ---------- Event classification ----------
function classifyLine(line) {
  let evt;
  try { evt = JSON.parse(line); } catch { return; }
  if (!evt || evt.type !== "message" || !evt.message) return;
  const role = evt.message.role;
  const content = Array.isArray(evt.message.content) ? evt.message.content : [];

  if (role === "user") {
    // Start tailing at EOF, so a role=user line seen by the daemon is a live
    // prompt, not replayed bootstrap context. Dispatch immediately so the pet
    // reacts before the model finishes thinking or starts tools.
    const hasToolResult = content.some(c => c.type === "tool_result");
    if (hasToolResult) return; // tool result, not a user prompt
    dispatchUserMessage(String(evt.message?.id || evt.timestamp || Date.now()));
    return;
  }

  if (role === "assistant") {
    const toolCalls = content.filter(c => c.type === "toolCall");
    if (toolCalls.length > 0) {
      // Fire one deterministic daemon reaction for the first tool in this
      // assistant turn. Phase 1 split removed legacy activity-priority
      // metadata from the daemon; phrase/state selection now lives entirely in
      // DAEMON_EVENTS so daemon voice stays separate from OpenClaw expression.
      const selected = toolCalls[0];
      const seed = toolCalls.map(c => `${c.name}:${c.id || ""}`).join("|");
      dispatchToolReaction(selected.name, seed);
      return;
    }
    // No tool calls: assistant produced a final answer.
    const hasText = content.some(c => c.type === "text" && c.text && c.text.trim().length > 0);
    if (hasText) dispatchDone(String(evt.message?.id || evt.timestamp || Date.now()));
  }
}

// ---------- Tail loop ----------
let currentFile = null;
let currentOffset = 0;
let buffer = "";

function openTail(file) {
  if (!file || !existsSync(file)) return false;
  const sz = statSync(file).size;
  currentFile = file;
  currentOffset = sz; // start at EOF; don't replay history
  buffer = "";
  log(`tailing ${file} from offset ${sz}`);
  return true;
}

function readNew() {
  if (!currentFile || !existsSync(currentFile)) return;
  let st;
  try { st = statSync(currentFile); } catch { return; }
  if (st.size < currentOffset) {
    // file truncated/replaced → re-anchor at end
    currentOffset = st.size;
    return;
  }
  if (st.size === currentOffset) return;
  const fd = openSync(currentFile, "r");
  const len = st.size - currentOffset;
  const buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, currentOffset);
  closeSync(fd);
  currentOffset = st.size;
  buffer += buf.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim()) classifyLine(line);
  }
}

function maybeRotate() {
  const latest = findActiveSessionFile();
  if (latest && latest !== currentFile) {
    log(`rotating to ${latest}`);
    openTail(latest);
  }
}

// ---------- PID management ----------
function writePid() {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 });
}
function clearPid() {
  try { unlinkSync(PID_FILE); } catch {}
}

// ---------- Main ----------
async function main() {
  writePid();
  log(`daemon start pid=${process.pid} sessionsDir=${SESSIONS_DIR}`);
  process.on("SIGTERM", () => { log("SIGTERM"); clearPid(); process.exit(0); });
  process.on("SIGINT",  () => { log("SIGINT");  clearPid(); process.exit(0); });

  const initial = findActiveSessionFile();
  if (initial) openTail(initial);
  else log("no active session file yet; will retry");

  reconcileDesiredAvatar(true);
  setInterval(readNew, POLL_MS);
  setInterval(maybeRotate, ROTATE_MS);
  setInterval(() => reconcileDesiredAvatar(false), AVATAR_RECONCILE_MS);
}

main().catch(err => { log(`fatal: ${err.stack || err}`); clearPid(); process.exit(1); });
