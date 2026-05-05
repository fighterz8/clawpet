#!/usr/bin/env node
// Clawpet daemon — tails the active OpenClaw session JSONL and dispatches
// avatar reactions in real time. Zero LLM-token cost: runs as a sidecar.
//
// Subscribes to: user messages, assistant tool calls, assistant final answers.
// Dispatches: clawpet react <event> --bubble … --quiet
//
// Activity-level gating happens inside `clawpet react` itself, so this daemon
// just fires events; the user's `clawpet activity <level>` decides what lands.

import { spawn } from "node:child_process";
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

// ---------- Tool → reaction mapping ----------
// state/bubble pairs; minLevel is the minimum activity level to fire.
// Copy is intentionally process-accurate over cute/random: the bubble should
// tell the user what OpenClaw is actually doing right now.

const TOOL_REACTIONS = {
  exec:            { state: "focused",  bubble: "Running command…",      minLevel: "balanced" },
  process:         { state: "thinking", bubble: "Checking command…",     minLevel: "balanced" },
  read:            { state: "thinking", bubble: "Reading files…",        minLevel: "balanced" },
  edit:            { state: "focused",  bubble: "Editing files…",        minLevel: "balanced" },
  write:           { state: "focused",  bubble: "Writing files…",        minLevel: "balanced" },
  apply_patch:     { state: "focused",  bubble: "Patching files…",       minLevel: "balanced" },
  web_fetch:       { state: "thinking", bubble: "Reading web page…",     minLevel: "balanced" },
  web_search:      { state: "thinking", bubble: "Searching web…",        minLevel: "balanced" },
  memory_search:   { state: "thinking", bubble: "Checking memory…",      minLevel: "balanced" },
  memory_get:      { state: "thinking", bubble: "Reading memory…",       minLevel: "balanced" },
  image:           { state: "thinking", bubble: "Inspecting image…",     minLevel: "balanced" },
  image_generate:  { state: "focused",  bubble: "Generating image…",     minLevel: "balanced" },
  video_generate:  { state: "focused",  bubble: "Generating video…",     minLevel: "balanced" },
  sessions_spawn:  { state: "focused",  bubble: "Starting helper…",      minLevel: "balanced" },
  sessions_send:   { state: "focused",  bubble: "Delegating task…",      minLevel: "balanced" },
  update_plan:     { state: "thinking", bubble: "Updating plan…",        minLevel: "expressive" },
  session_status:  { state: "thinking", bubble: "Checking status…",      minLevel: "maximum" },
  // default for unknown tools
  __default__:     { state: "thinking", bubble: "Working…",              minLevel: "expressive" },
};

const USER_MSG_BUBBLE = "Reading your prompt…";
const DONE_BUBBLE = "Done";

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
  });
  proc.on("error", () => {}); // swallow
}

function dispatchToolReaction(toolName) {
  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_THROTTLE_MS) return;
  lastDispatchAt = now;
  const cfg = TOOL_REACTIONS[toolName] || TOOL_REACTIONS.__default__;
  const bubble = cfg.bubble;
  // We use `send` directly with state because tool reactions are tool-name
  // specific and don't all map cleanly onto react event keys. Activity gating
  // is enforced by passing through `react thinking`/`react long-task`/`react user-message`
  // when possible; for tool-specific copy we apply our own gate here.
  const activity = readActivity();
  if (!levelAllows(activity, cfg.minLevel)) return;
  callClawpet(["send", cfg.state, bubble, "--bubble", bubble, "--quiet"]);
  log(`tool ${toolName} -> ${cfg.state} "${bubble}"`);
}

function dispatchUserMessage() {
  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_THROTTLE_MS) return;
  lastDispatchAt = now;
  const bubble = USER_MSG_BUBBLE;
  callClawpet(["react", "user-message", "--bubble", bubble, "--quiet"]);
  log(`user message -> ${bubble}`);
}

function dispatchDone() {
  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_THROTTLE_MS) return;
  lastDispatchAt = now;
  const bubble = DONE_BUBBLE;
  callClawpet(["react", "done", "--bubble", bubble, "--quiet"]);
  log(`assistant done -> ${bubble}`);
}

// ---------- Activity gate (mirror of CLI logic, kept simple) ----------
const ACTIVITY_LEVELS = ["off", "minimal", "balanced", "expressive", "maximum"];
function levelRank(l) { return ACTIVITY_LEVELS.indexOf(l); }
function levelAllows(current, minRequired) {
  return current !== "off" && levelRank(current) >= levelRank(minRequired);
}
function readActivity() {
  try {
    const cfg = JSON.parse(readFileSync(join(STATE_DIR, "config.json"), "utf8"));
    const v = process.env.CLAWPET_ACTIVITY || cfg.activity || "balanced";
    return ACTIVITY_LEVELS.includes(v) ? v : "balanced";
  } catch {
    return process.env.CLAWPET_ACTIVITY || "balanced";
  }
}

// ---------- Session JSONL discovery ----------
function findActiveSessionFile() {
  try {
    const entries = readdirSync(SESSIONS_DIR)
      .filter(n => n.endsWith(".jsonl") && !n.includes(".checkpoint."))
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
    dispatchUserMessage();
    return;
  }

  if (role === "assistant") {
    const toolCalls = content.filter(c => c.type === "toolCall");
    if (toolCalls.length > 0) {
      // Fire reaction for the highest-priority tool in this turn.
      // Order: heavy tools (balanced) > thinking tools (expressive) > others.
      const ordered = toolCalls.slice().sort((a, b) => {
        const ra = TOOL_REACTIONS[a.name]?.minLevel || "expressive";
        const rb = TOOL_REACTIONS[b.name]?.minLevel || "expressive";
        return levelRank(ra) - levelRank(rb);
      });
      dispatchToolReaction(ordered[0].name);
      return;
    }
    // No tool calls: assistant produced a final answer.
    const hasText = content.some(c => c.type === "text" && c.text && c.text.trim().length > 0);
    if (hasText) dispatchDone();
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

  setInterval(readNew, POLL_MS);
  setInterval(maybeRotate, ROTATE_MS);
}

main().catch(err => { log(`fatal: ${err.stack || err}`); clearPid(); process.exit(1); });
