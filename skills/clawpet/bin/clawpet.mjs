#!/usr/bin/env node
// Clawpet skill CLI — drive a Clawpet desktop runtime from OpenClaw.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import httpModule from "node:http";
import httpsModule from "node:https";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const VERSION = "0.4.0";
const STATES = ["idle", "thinking", "focused", "happy", "alert", "sleepy"];
const ACTIVITY_LEVELS = ["off", "minimal", "balanced", "expressive", "maximum"];
const DEFAULT_ACTIVITY = "balanced";
const DAEMON_VOICE_LEVELS = ["silent", "lite", "vivid"];
const DEFAULT_DAEMON_VOICE = "lite";
const EXPRESSION_LEVELS = ["off", "on"];
const LEGACY_EXPRESSION_ON_LEVELS = ["low", "medium", "high"];
const DEFAULT_EXPRESSION_LEVEL = "off";
const MAX_BUBBLE_LENGTH = 160;

// Map semantic events -> avatar states. Used by `clawpet react <event>`.
// Values: { state, defaultBubble, minLevel } where minLevel is the lowest activity
// level at which this reaction fires. Anything below minLevel is a silent no-op.
const REACTIONS = {
  "user-message":  { state: "thinking", bubble: "Reading your prompt…", expressionBubble: "I’m looking at what you asked and choosing the next move.", minLevel: "balanced" },
  "tool-start":    { state: "focused",  bubble: "Working…",       expressionBubble: "I’m using the tool result to move the actual work forward.", minLevel: "expressive" },
  "tool-error":    { state: "alert",    bubble: "Hit an error",   expressionBubble: "That path tripped; I’m checking the failure instead of pretending it worked.", minLevel: "minimal"    },
  "blocker":       { state: "alert",    bubble: "Need your input", expressionBubble: "I found the decision point that needs your call.", minLevel: "minimal"    },
  "done":          { state: "happy",    bubble: "Done",            expressionBubble: "That piece is landed; I’m checking the next seam now.", minLevel: "minimal"    },
  "long-task":     { state: "focused",  bubble: "Heads down",      expressionBubble: "This is a deeper pass, so I’m staying focused rather than chattering.", minLevel: "balanced"   },
  "thinking":      { state: "thinking", bubble: "Thinking…",       expressionBubble: "I’m weighing the tradeoff before changing anything else.", minLevel: "balanced"   },
  // Heartbeat is gated on a SEPARATE config flag (reactToHeartbeats), not
  // the activity level. Default disabled. Activity 'off' still fully suppresses.
  "heartbeat":     { state: "thinking", bubble: "Heartbeat",        expressionBubble: "Heartbeat check is running.", minLevel: "_heartbeat" },
};

function levelRank(level) { return ACTIVITY_LEVELS.indexOf(level); }
function levelAllows(current, minRequired) {
  return current !== "off" && levelRank(current) >= levelRank(minRequired);
}
const CONFIG_DIR = join(homedir(), ".openclaw", "clawpet");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

async function syncReactivityMirror() {
  const url = resolveRuntimeUrl();
  const token = resolveRuntimeToken();
  if (!url || !token) return { ok: false, skipped: true, reason: "runtime not paired yet" };
  const payload = {
    available: true,
    activityLegacy: resolveActivity(),
    daemonVoice: resolveDaemonVoice(),
    daemonVoiceLevels: DAEMON_VOICE_LEVELS,
    expressionLevel: resolveExpressionLevel(),
    expressionLevels: EXPRESSION_LEVELS,
    heartbeatReactions: resolveHeartbeatReactions(),
    // Compatibility for older runtimes; hidden from the user-facing console.
    activityLevels: ACTIVITY_LEVELS,
    writable: false,
    managedBy: "openclaw-host",
    error: null,
  };
  try {
    const r = await http("POST", `${url}/admin/reactivity`, payload);
    if (!r.ok) return { ok: false, status: r.status, body: r.body };
    return { ok: true, body: r.body };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function resolveRuntimeUrl() {
  if (process.env.CLAWPET_RUNTIME_URL) return process.env.CLAWPET_RUNTIME_URL.replace(/\/$/, "");
  const cfg = loadConfig();
  if (cfg.runtimeUrl) return String(cfg.runtimeUrl).replace(/\/$/, "");
  return "http://127.0.0.1:8737";
}

function resolveRuntimeToken() {
  if (process.env.CLAWPET_RUNTIME_TOKEN) return process.env.CLAWPET_RUNTIME_TOKEN.trim();
  const cfg = loadConfig();
  return cfg.runtimeToken ? String(cfg.runtimeToken) : undefined;
}

function resolveActivity() {
  const env = process.env.CLAWPET_ACTIVITY;
  if (env && ACTIVITY_LEVELS.includes(env)) return env;
  const cfg = loadConfig();
  if (cfg.activity && ACTIVITY_LEVELS.includes(cfg.activity)) return cfg.activity;
  return DEFAULT_ACTIVITY;
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

function mapActivityToExpressionLevel(activity) {
  switch (activity) {
    case "off":
    case "minimal": return "off";
    case "balanced":
    case "expressive":
    case "maximum": return "on";
    default: return DEFAULT_EXPRESSION_LEVEL;
  }
}

function normalizeExpressionLevel(level) {
  if (!level) return undefined;
  const normalized = String(level).toLowerCase();
  if (EXPRESSION_LEVELS.includes(normalized)) return normalized;
  if (LEGACY_EXPRESSION_ON_LEVELS.includes(normalized)) return "on";
  return undefined;
}

function resolveDaemonVoice() {
  const env = process.env.CLAWPET_DAEMON_VOICE;
  if (env && DAEMON_VOICE_LEVELS.includes(env)) return env;
  const cfg = loadConfig();
  if (cfg.daemonVoice && DAEMON_VOICE_LEVELS.includes(cfg.daemonVoice)) return cfg.daemonVoice;
  return mapActivityToDaemonVoice(resolveActivity());
}

function resolveExpressionLevel() {
  const env = normalizeExpressionLevel(process.env.CLAWPET_EXPRESSION_LEVEL);
  if (env) return env;
  const cfg = loadConfig();
  const configured = normalizeExpressionLevel(cfg.expressionLevel);
  if (configured) return configured;
  return mapActivityToExpressionLevel(resolveActivity());
}

function resolveHeartbeatReactions() {
  const env = process.env.CLAWPET_HEARTBEAT_REACTIONS;
  if (env != null) return env === "1" || env.toLowerCase() === "true" || env.toLowerCase() === "on";
  const cfg = loadConfig();
  return Boolean(cfg.heartbeatReactions);
}

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

async function http(method, url, body) {
  const headers = {};
  const encodedBody = body ? JSON.stringify(body) : undefined;
  if (encodedBody) {
    headers["content-type"] = "application/json";
    // The bundled Tauri runtime is a tiny HTTP server that expects a
    // Content-Length body, not chunked transfer encoding.
    headers["content-length"] = String(Buffer.byteLength(encodedBody));
  }
  const token = resolveRuntimeToken();
  if (token) headers["authorization"] = `Bearer ${token}`;

  // Use Node's HTTP client instead of fetch. The Tauri desktop runtime is a
  // tiny hand-rolled HTTP server and currently handles fixed Content-Length
  // requests more reliably than fetch/undici's defaults.
  const u = new URL(url);
  const client = u.protocol === "https:" ? httpsModule : httpModule;
  const { statusCode = 0, text } = await new Promise((resolve, reject) => {
    const req = client.request({
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (encodedBody) req.write(encodedBody);
    req.end();
  });
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: statusCode, ok: statusCode >= 200 && statusCode < 300, body: json };
}

function fail(msg, code = 1) { console.error(`clawpet: ${msg}`); process.exit(code); }

function usage() {
  console.log(`clawpet v${VERSION}

Usage:
  clawpet wizard [display|openclaw] [--code 123456 --host host:8737]
  clawpet doctor
  clawpet ping
  clawpet status
  clawpet send <state> [message] [--bubble TEXT] [--quiet]
  clawpet react <event> [--bubble TEXT] [--quiet]   # event: user-message|tool-start|tool-error|blocker|done|long-task|thinking
  clawpet activity [off|minimal|balanced|expressive|maximum]  # deprecated legacy alias
  clawpet daemon-voice [silent|lite|vivid]
  clawpet expression-level [off|on]
  clawpet heartbeat-reactions [on|off]              # default off
  clawpet pair --url <runtime-url> [--token <bearer-token>]
  clawpet pair --code <6-digit> --host <host[:port]>     # magic-pair: claim a code on a remote runtime
  clawpet pair-mode [--seconds 90]                       # open pair mode on the local runtime; prints code
  clawpet rotate-token
  clawpet avatar push <bundle-dir>                 # upload/select avatar bundle on paired runtime
  clawpet install [--os windows|unix]
  clawpet config
  clawpet daemon <start|stop|status|run|enable|disable> # auto-react sidecar (tails OpenClaw session log)

States: ${STATES.join(" | ")}
Runtime URL: ${resolveRuntimeUrl()}  (override with CLAWPET_RUNTIME_URL or 'clawpet pair')
Auth token: ${resolveRuntimeToken() ? "set" : "not set"}`);
}

async function detectDisplayHost() {
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const j = JSON.parse(out);
    const dns = j?.Self?.DNSName;
    if (dns) return String(dns).replace(/\.$/, "");
  } catch {}
  try {
    const { hostname } = await import("node:os");
    return hostname();
  } catch {
    return "<display-host>";
  }
}

async function cmdWizard(positional, flags) {
  const mode = positional[0] || "display";
  if (!["display", "openclaw", "host"].includes(mode)) {
    fail("wizard: mode must be 'display' or 'openclaw'");
  }

  if (mode === "display") {
    const host = await detectDisplayHost();
    console.log("Clawpet display-machine wizard\n");
    console.log("Run this on the machine where the avatar window should appear. Keep terminals open while testing.\n");
    console.log("1) Try the standalone demo:");
    console.log("   npm run runtime:demo");
    console.log("   # second terminal:");
    console.log("   npm run desktop:dev");
    console.log("\n2) When the demo works, stop the demo runtime and start pairable runtime:");
    console.log("   npm run runtime:tailscale");
    console.log("\n3) In another terminal, open pair mode:");
    console.log("   clawpet pair-mode");
    console.log("\n4) Send the 6-digit code to your OpenClaw assistant. Suggested host:");
    console.log(`   ${host}:8737`);
    console.log("\nIf something fails, run:");
    console.log("   clawpet doctor");
    return;
  }

  const code = flags.code;
  const host = flags.host || positional[1];
  if (!code || !host) {
    console.log("Clawpet OpenClaw-host wizard\n");
    console.log("Run this on the OpenClaw machine after the display machine shows a pair code.\n");
    console.log("Usage:");
    console.log("  clawpet wizard openclaw --code <6-digit-code> --host <display-host>:8737");
    console.log("\nThis will pair, sync daemon/expression settings, disable heartbeat flashes, start the daemon, and send a test bubble.");
    return;
  }

  console.log("Clawpet OpenClaw-host wizard\n");
  await cmdPair({ code, host });
  cmdActivity(["balanced"], {});
  cmdHeartbeats(["off"], {});
  await cmdDaemon(["stop"], {});
  await cmdDaemon(["start"], {});
  await cmdSend(["happy", "Clawpet paired from OpenClaw"], { bubble: "Connected" });
  console.log("\n✓ Paired and live. Ask the user to confirm the pet changed to Connected/Happy.");
}

async function cmdDoctor() {
  const url = resolveRuntimeUrl();
  const rows = [];
  rows.push(["node", process.version]);
  rows.push(["config", existsSync(CONFIG_PATH) ? CONFIG_PATH : "not created yet"]);
  rows.push(["runtimeUrl", url]);
  rows.push(["token", resolveRuntimeToken() ? "set" : "not set"]);
  try {
    const r = await http("GET", `${url}/health`);
    rows.push(["runtime", r.ok ? "reachable" : `HTTP ${r.status}`]);
  } catch (e) {
    rows.push(["runtime", `unreachable (${e.message})`]);
  }
  console.log("Clawpet doctor\n");
  for (const [k, v] of rows) console.log(`${k.padEnd(12)} ${v}`);
  console.log("\nDisplay-machine quick test:");
  console.log("  npm run runtime:demo");
  console.log("  npm run desktop:dev");
  console.log("\nCross-machine pairing:");
  console.log("  Display machine: npm run runtime:tailscale");
  console.log("  Display machine: clawpet pair-mode");
  console.log("  OpenClaw host:    clawpet pair --code <code> --host <display-host>:8737");
}

async function cmdPing() {
  const url = resolveRuntimeUrl();
  try {
    const r = await http("GET", `${url}/health`);
    console.log(JSON.stringify({ url, ...r }, null, 2));
    process.exit(r.ok ? 0 : 2);
  } catch (e) { fail(`runtime unreachable at ${url}: ${e.message}`, 2); }
}

async function cmdStatus() {
  const url = resolveRuntimeUrl();
  try {
    const r = await http("GET", `${url}/status`);
    const body = r.body && typeof r.body === "object" ? { ...r.body } : r.body;
    if (r.ok && body && typeof body === "object" && resolveRuntimeToken()) {
      try {
        const auth = await http("GET", `${url}/auth/check`);
        body.openClawAuth = auth.ok ? "ready" : "invalid-token";
      } catch {
        body.openClawAuth = "unknown";
      }
    }
    console.log(JSON.stringify(body, null, 2));
    process.exit(r.ok ? 0 : 2);
  } catch (e) { fail(`runtime unreachable at ${url}: ${e.message}`, 2); }
}

function resolveEmitSource(mode = "send") {
  const source = (process.env.CLAWPET_EMIT_SOURCE || "manual").toLowerCase();
  if (source === "daemon") {
    return {
      kind: "openclaw",
      displayName: "daemon voice",
      instanceId: "clawpet-daemon-voice",
    };
  }
  if (source === "expression" || mode === "react") {
    return {
      kind: "openclaw",
      displayName: "OpenClaw expression",
      instanceId: "clawpet-openclaw-expression",
    };
  }
  return {
    kind: "openclaw",
    // Direct CLI sends are usually setup/test/plumbing. Only explicitly
    // requested routines should surface as user-requested, via
    // CLAWPET_EMIT_SOURCE=user-requested.
    displayName: source === "user-requested" ? "user-requested" : "system signal",
    instanceId: source === "user-requested" ? "clawpet-user-requested" : "clawpet-system-signal-direct",
  };
}

async function cmdSend(positional, flags) {
  const [state, ...rest] = positional;
  if (!state) fail("send: <state> required");
  if (!STATES.includes(state)) fail(`send: invalid state '${state}'. Use: ${STATES.join(", ")}`);
  const message = rest.join(" ").trim() || undefined;
  const bubble = typeof flags.bubble === "string" ? flags.bubble : undefined;
  const quiet = Boolean(flags.quiet);
  if (bubble && bubble.length > MAX_BUBBLE_LENGTH) fail(`send: --bubble must be <= ${MAX_BUBBLE_LENGTH} chars`);
  if (message && message.length > 280) fail("send: message must be <= 280 chars");

  // Direct sends are setup/test/plumbing by default; explicit user-requested
  // routines can mark CLAWPET_EMIT_SOURCE=user-requested.
  const activity = resolveActivity();
  if (activity === "off") {
    if (!quiet) console.log(JSON.stringify({ ok: true, suppressed: true, reason: "activity is 'off'" }));
    process.exit(0);
  }

  const source = resolveEmitSource("send");
  const sourceClass = source.instanceId === "clawpet-user-requested" ? "user-requested" : "system signal";
  const event = {
    type: "avatar.state",
    version: "0.1.0",
    eventId: randomUUID(),
    sentAt: new Date().toISOString(),
    source,
    state,
    ...(message ? { message } : {}),
    ...(bubble ? { bubble } : {}),
    metadata: {
      sourceClass,
      lingerMs: sourceClass === "user-requested" ? 14000 : 2000,
    },
  };

  const url = resolveRuntimeUrl();
  try {
    const r = await http("POST", `${url}/avatar/state`, event);
    if (!r.ok) {
      console.error(`clawpet: send failed (HTTP ${r.status})`);
      console.error(JSON.stringify(r.body, null, 2));
      process.exit(2);
    }
    if (!quiet) {
      console.log(JSON.stringify({ ok: true, sent: { state, bubble, message }, eventId: event.eventId }, null, 2));
    }
  } catch (e) { fail(`runtime unreachable at ${url}: ${e.message}`, 2); }
}

async function cmdReact(positional, flags) {
  const [eventName] = positional;
  if (!eventName) fail("react: <event> required (e.g. user-message, tool-start, tool-error, blocker, done)");
  const def = REACTIONS[eventName];
  if (!def) fail(`react: unknown event '${eventName}'. Known: ${Object.keys(REACTIONS).join(", ")}`);

  const activity = resolveActivity();
  // Activity 'off' kills everything, including heartbeats.
  if (activity === "off") {
    if (!flags.quiet) console.log(JSON.stringify({ ok: true, suppressed: true, reason: "activity is 'off'" }));
    process.exit(0);
  }
  // Heartbeat reactions are gated on a separate flag (default off).
  if (def.minLevel === "_heartbeat") {
    if (!resolveHeartbeatReactions()) {
      if (!flags.quiet) console.log(JSON.stringify({ ok: true, suppressed: true, reason: "heartbeat reactions disabled" }));
      process.exit(0);
    }
  } else if (!levelAllows(activity, def.minLevel)) {
    // User-controlled gate: silently no-op if current activity level forbids this reaction.
    if (!flags.quiet) console.log(JSON.stringify({ ok: true, suppressed: true, reason: `activity '${activity}' < required '${def.minLevel}'` }));
    process.exit(0);
  }

  const source = resolveEmitSource("react");
  const isDaemonEmit = source.instanceId === "clawpet-daemon-voice";
  let bubble = typeof flags.bubble === "string" ? flags.bubble : def.bubble;

  if (!isDaemonEmit) {
    const expressionLevel = resolveExpressionLevel();
    if (expressionLevel === "off") {
      if (!flags.quiet) console.log(JSON.stringify({ ok: true, suppressed: true, reason: "expression level is 'off'" }));
      process.exit(0);
    }

    const hasCustomBubble = typeof flags.bubble === "string" && flags.bubble.trim().length > 0;

    // Routine prompt-start and routine completion should belong to system signal
    // unless OpenClaw was given an explicitly interpretive/custom line.
    if ((eventName === "user-message" || eventName === "done") && !hasCustomBubble) {
      if (!flags.quiet) console.log(JSON.stringify({ ok: true, suppressed: true, reason: `${eventName} expression requires custom contextual text` }));
      process.exit(0);
    }

    // OpenClaw expression is now a simple on/off gate. When on, callers may
    // provide contextual text; otherwise use the distinct preset so expression
    // complements system signal instead of duplicating it.
    if (!bubble || bubble === def.bubble) bubble = def.expressionBubble;
  }

  // Reuse cmdSend by faking argv; but simpler: inline the POST.
  const sourceClass = isDaemonEmit ? "system signal" : "OpenClaw expression";
  const event = {
    type: "avatar.state",
    version: "0.1.0",
    eventId: randomUUID(),
    sentAt: new Date().toISOString(),
    source,
    state: def.state,
    ...(bubble !== undefined ? { bubble: bubble.slice(0, MAX_BUBBLE_LENGTH) } : {}),
    metadata: {
      sourceClass,
      lingerMs: isDaemonEmit ? 2000 : 10000,
    },
  };
  const url = resolveRuntimeUrl();
  try {
    const r = await http("POST", `${url}/avatar/state`, event);
    if (!r.ok) {
      console.error(`clawpet: react failed (HTTP ${r.status})`);
      console.error(JSON.stringify(r.body, null, 2));
      process.exit(2);
    }
    if (!flags.quiet) console.log(JSON.stringify({ ok: true, reacted: { event: eventName, state: def.state, bubble: event.bubble }, eventId: event.eventId }));
  } catch (e) { fail(`runtime unreachable at ${url}: ${e.message}`, 2); }
}

async function cmdHeartbeats(positional, _flags) {
  const [arg] = positional;
  if (!arg) {
    console.log(JSON.stringify({ heartbeatReactions: resolveHeartbeatReactions(), configPath: CONFIG_PATH }, null, 2));
    return;
  }
  const v = arg.toLowerCase();
  if (!["on","off","true","false","1","0","enable","disable"].includes(v)) {
    fail("heartbeat-reactions: argument must be 'on' or 'off'");
  }
  const enabled = ["on","true","1","enable"].includes(v);
  const cfg = loadConfig();
  cfg.heartbeatReactions = enabled;
  saveConfig(cfg);
  const mirror = await syncReactivityMirror();
  console.log(JSON.stringify({ ok: true, heartbeatReactions: enabled, configPath: CONFIG_PATH }, null, 2));
  if (!mirror.ok && !mirror.skipped) console.error(`clawpet: warning: failed syncing reactivity mirror (${mirror.status ?? mirror.error ?? "unknown error"})`);
}

async function cmdActivity(positional, _flags) {
  const [level] = positional;
  if (!level) {
    console.log(JSON.stringify({ activity: resolveActivity(), levels: ACTIVITY_LEVELS, configPath: CONFIG_PATH }, null, 2));
    return;
  }
  if (!ACTIVITY_LEVELS.includes(level)) fail(`activity: invalid level '${level}'. Must be one of: ${ACTIVITY_LEVELS.join(", ")}`);
  const cfg = loadConfig();
  const previous = cfg.activity || DEFAULT_ACTIVITY;
  cfg.activity = level;
  if (!cfg.daemonVoice) cfg.daemonVoice = mapActivityToDaemonVoice(level);
  if (!cfg.expressionLevel) cfg.expressionLevel = mapActivityToExpressionLevel(level);
  saveConfig(cfg);
  const mirror = await syncReactivityMirror();
  console.log(JSON.stringify({ ok: true, previous, current: level, daemonVoice: resolveDaemonVoice(), expressionLevel: resolveExpressionLevel(), configPath: CONFIG_PATH }, null, 2));
  if (!mirror.ok && !mirror.skipped) console.error(`clawpet: warning: failed syncing reactivity mirror (${mirror.status ?? mirror.error ?? "unknown error"})`);
}

async function cmdDaemonVoice(positional, _flags) {
  const [level] = positional;
  if (!level) {
    console.log(JSON.stringify({ daemonVoice: resolveDaemonVoice(), levels: DAEMON_VOICE_LEVELS, configPath: CONFIG_PATH }, null, 2));
    return;
  }
  if (!DAEMON_VOICE_LEVELS.includes(level)) fail(`daemon-voice: invalid level '${level}'. Must be one of: ${DAEMON_VOICE_LEVELS.join(", ")}`);
  const cfg = loadConfig();
  const previous = resolveDaemonVoice();
  cfg.daemonVoice = level;
  saveConfig(cfg);
  const mirror = await syncReactivityMirror();
  console.log(JSON.stringify({ ok: true, previous, current: level, configPath: CONFIG_PATH }, null, 2));
  if (!mirror.ok && !mirror.skipped) console.error(`clawpet: warning: failed syncing reactivity mirror (${mirror.status ?? mirror.error ?? "unknown error"})`);
}

async function cmdExpressionLevel(positional, _flags) {
  const [level] = positional;
  if (!level) {
    console.log(JSON.stringify({ expressionLevel: resolveExpressionLevel(), levels: EXPRESSION_LEVELS, configPath: CONFIG_PATH }, null, 2));
    return;
  }
  const normalizedLevel = normalizeExpressionLevel(level);
  if (!normalizedLevel) fail(`expression-level: invalid level '${level}'. Must be one of: ${EXPRESSION_LEVELS.join(", ")}`);
  const cfg = loadConfig();
  const previous = resolveExpressionLevel();
  cfg.expressionLevel = normalizedLevel;
  saveConfig(cfg);
  const mirror = await syncReactivityMirror();
  console.log(JSON.stringify({ ok: true, previous, current: normalizedLevel, configPath: CONFIG_PATH }, null, 2));
  if (!mirror.ok && !mirror.skipped) console.error(`clawpet: warning: failed syncing reactivity mirror (${mirror.status ?? mirror.error ?? "unknown error"})`);
}

async function cmdRotateToken() {
  const url = resolveRuntimeUrl();
  try {
    const r = await http("POST", `${url}/admin/rotate-token`);
    if (!r.ok || !r.body || typeof r.body.token !== "string") {
      console.error(`clawpet: rotate-token failed (HTTP ${r.status})`);
      console.error(JSON.stringify(r.body, null, 2));
      process.exit(2);
    }
    const cfg = loadConfig();
    cfg.runtimeUrl = cfg.runtimeUrl ?? url;
    cfg.runtimeToken = r.body.token;
    saveConfig(cfg);
    console.log(JSON.stringify({ ok: true, runtimeUrl: cfg.runtimeUrl, tokenSet: true, tokenLength: r.body.token.length }, null, 2));
  } catch (e) { fail(`runtime unreachable at ${url}: ${e.message}`, 2); }
}

async function cmdPair(flags) {
  // Magic-pair flow: --code 472091 --host <desktop-host>.<tailnet>.ts.net:8737
  // Calls POST /pair/claim on the remote runtime, saves the returned token.
  if (typeof flags.code === "string" && flags.code) {
    if (!/^\d{6}$/.test(flags.code)) fail("pair: --code must be a 6-digit string");
    let host = flags.host || flags.url;
    if (!host) fail("pair: --host <hostname[:port]> or --url required when using --code");
    let url = host.includes("://") ? host : `http://${host}`;
    if (!/:\d+$/.test(url) && !/^https?:\/\/[^/]+:\d+/.test(url)) {
      // No port → default 8737
      url = `${url.replace(/\/$/, "")}:8737`;
    }
    url = url.replace(/\/$/, "");
    try { new URL(url); } catch { fail(`pair: invalid URL '${url}'`); }
    try {
      const r = await http("POST", `${url}/pair/claim`, { code: flags.code });
      if (!r.ok || !r.body?.token) {
        const err = r.body?.errors?.join(", ") || `HTTP ${r.status}`;
        fail(`pair: claim failed (${err})`, 2);
      }
      const cfg = loadConfig();
      cfg.runtimeUrl = url;
      cfg.runtimeToken = r.body.token;
      saveConfig(cfg);
      await syncReactivityMirror();
      console.log(JSON.stringify({
        ok: true,
        configPath: CONFIG_PATH,
        runtimeUrl: url,
        tokenSet: true,
        tokenLength: r.body.token.length,
        message: "Paired. Token saved.",
      }, null, 2));
      return;
    } catch (e) {
      fail(`pair: runtime unreachable at ${url}: ${e.message}`, 2);
    }
  }

  // Legacy direct-token flow.
  const url = flags.url;
  if (!url || typeof url !== "string") fail("pair: provide --code <code> --host <host>, or --url <runtime-url>");
  try { new URL(url); } catch { fail(`pair: invalid URL '${url}'`); }
  const cfg = loadConfig();
  cfg.runtimeUrl = url.replace(/\/$/, "");
  if (typeof flags.token === "string" && flags.token) cfg.runtimeToken = flags.token;
  if (flags["clear-token"]) delete cfg.runtimeToken;
  saveConfig(cfg);
  await syncReactivityMirror();
  console.log(JSON.stringify({
    ok: true,
    configPath: CONFIG_PATH,
    runtimeUrl: cfg.runtimeUrl,
    tokenSet: Boolean(cfg.runtimeToken),
  }, null, 2));
}

async function cmdPairMode(_positional, flags) {
  // Daily-driver side: open pair mode on the local runtime, print the code,
  // poll until pair mode closes (success or expiry).
  const url = resolveRuntimeUrl();
  const seconds = Number(flags.seconds) > 0 ? Number(flags.seconds) : 90;
  const startRes = await http("POST", `${url}/admin/pair-mode/start`, { seconds });
  if (!startRes.ok || !startRes.body?.code) {
    fail(`pair-mode: failed to start (HTTP ${startRes.status})`, 2);
  }
  const code = startRes.body.code;
  const expiresAt = startRes.body.expiresAt;
  const groups = `${code.slice(0, 3)} · ${code.slice(3)}`;
  const banner = [
    "",
    "  ┌──────────────────────────────────────────────┐",
    `  │   Pair code:    ${groups.padEnd(28)}│`,
    `  │   Runtime:      ${url.padEnd(28)}│`,
    `  │   Expires in:   ${String(seconds).padEnd(28)}s│`,
    "  └──────────────────────────────────────────────┘",
    "",
    "  On your OpenClaw machine, run:",
    `    clawpet pair --code ${code} --host <this-machine-hostname>:8737`,
    "",
    "  Waiting for OpenClaw to claim the code… (Ctrl+C to cancel)",
  ].join("\n");
  console.log(banner);

  // Poll /pair-mode every 2s. Closes when claimed or expired.
  const start = Date.now();
  while (Date.now() - start < seconds * 1000 + 5000) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const pm = await http("GET", `${url}/pair-mode`);
      if (pm.ok && pm.body?.active === false) {
        console.log("\n  ✓ Pair mode closed. If a remote machine claimed the code, the token has been rotated.");
        return;
      }
    } catch { /* keep polling */ }
  }
  // Best-effort cancel if we time out.
  try { await http("POST", `${url}/admin/pair-mode/cancel`); } catch { /* ignore */ }
  console.log("\n  ✗ Pair mode timed out without a claim.");
}

async function cmdAvatar(positional, _flags) {
  const [subcmd, bundleDir] = positional;
  if (subcmd !== "push") fail("avatar: only supported command is 'push <bundle-dir>'");
  if (!bundleDir) fail("avatar push: <bundle-dir> required (folder containing avatar.json + assets/*.png)");
  const manifestPath = join(bundleDir, "avatar.json");
  if (!existsSync(manifestPath)) fail(`avatar push: missing ${manifestPath}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { fail(`avatar push: invalid avatar.json: ${e.message}`); }
  if (!manifest.states || typeof manifest.states !== "object") fail("avatar push: avatar.json must contain states");
  const assets = {};
  const addAsset = (rel) => {
    if (typeof rel !== "string" || !rel) return;
    if (rel.includes("..") || rel.startsWith("/") || !(rel.startsWith("assets/") || rel.startsWith("frames/"))) {
      fail(`avatar push: unsafe asset/frame path ${rel}`);
    }
    const p = join(bundleDir, rel);
    if (!existsSync(p)) fail(`avatar push: missing asset/frame ${p}`);
    assets[rel] = readFileSync(p).toString("base64");
  };
  for (const def of Object.values(manifest.states)) {
    if (!def || typeof def !== "object") continue;
    addAsset(def.asset);
    addAsset(def.fallbackAsset);
    if (Array.isArray(def.frames)) for (const frame of def.frames) addAsset(frame);
  }
  const url = resolveRuntimeUrl();
  try {
    const r = await http("POST", `${url}/admin/avatar-bundle`, { manifest, assets });
    if (!r.ok) {
      console.error(`clawpet: avatar push failed (HTTP ${r.status})`);
      console.error(JSON.stringify(r.body, null, 2));
      process.exit(2);
    }
    const cfg = loadConfig();
    cfg.lastAvatarBundleDir = bundleDir;
    cfg.lastAvatarId = r.body.avatarId;
    cfg.lastBundleVersion = r.body.bundleVersion;
    cfg.lastAvatarPushedAt = new Date().toISOString();
    saveConfig(cfg);
    console.log(JSON.stringify({
      ok: true,
      runtimeUrl: url,
      avatarId: r.body.avatarId,
      bundleVersion: r.body.bundleVersion,
      assetCount: r.body.assetCount,
      savedAsLastAvatar: true,
      message: "Avatar bundle uploaded to runtime and saved as OpenClaw's desired avatar. Restart overlay if it does not refresh automatically.",
    }, null, 2));
  } catch (e) { fail(`runtime unreachable at ${url}: ${e.message}`, 2); }
}

function cmdInstall(flags) {
  const os = (flags.os || "").toLowerCase();
  const repo = "https://raw.githubusercontent.com/fighterz8/clawpet/main";
  const win = `irm ${repo}/scripts/install-windows.ps1 | iex`;
  const unix = `curl -fsSL ${repo}/scripts/install-unix.sh | bash`;
  if (os === "windows") { console.log(win); return; }
  if (os === "unix" || os === "linux" || os === "macos" || os === "mac") { console.log(unix); return; }
  console.log("Run ONE of these on the target machine (the one that will display the avatar):\n");
  console.log("Windows (PowerShell):\n  " + win + "\n");
  console.log("macOS / Linux (bash):\n  " + unix + "\n");
  console.log("After starting the runtime on the target, run 'clawpet pair-mode' there.");
  console.log("Then run 'clawpet pair --code <6-digit> --host <target-tailnet-hostname>:8737' on the OpenClaw side.");
  console.log("Tailscale is the recommended cross-machine transport for the current release.");
}

function cmdConfig() {
  console.log(JSON.stringify({
    runtimeUrl: resolveRuntimeUrl(),
    runtimeTokenSet: Boolean(resolveRuntimeToken()),
    activityLegacy: resolveActivity(),
    daemonVoice: resolveDaemonVoice(),
    expressionLevel: resolveExpressionLevel(),
    heartbeatReactions: resolveHeartbeatReactions(),
    configPath: CONFIG_PATH,
    configExists: existsSync(CONFIG_PATH),
    envUrlOverride: Boolean(process.env.CLAWPET_RUNTIME_URL),
    envTokenOverride: Boolean(process.env.CLAWPET_RUNTIME_TOKEN),
    envActivityOverride: Boolean(process.env.CLAWPET_ACTIVITY),
    envDaemonVoiceOverride: Boolean(process.env.CLAWPET_DAEMON_VOICE),
    envExpressionLevelOverride: Boolean(process.env.CLAWPET_EXPRESSION_LEVEL),
    states: STATES,
    daemonVoiceLevels: DAEMON_VOICE_LEVELS,
    expressionLevels: EXPRESSION_LEVELS,
  }, null, 2));
}

async function cmdDaemon(positional, _flags) {
  const { spawn, execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const daemonScript = join(here, "clawpet-daemon.mjs");
  const PID_FILE = join(CONFIG_DIR, "daemon.pid");
  const LOG_FILE = join(CONFIG_DIR, "daemon.log");
  const SERVICE_NAME = "openclaw-clawpet-daemon";
  const SERVICE_FILE = join(homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
  const sub = positional[0] || "status";


  function systemdAvailable() {
    if (process.platform !== "linux") return false;
    try { execFileSync("systemctl", ["--user", "--version"], { stdio: "ignore" }); return true; } catch { return false; }
  }
  function writeSystemdService() {
    mkdirSync(dirname(SERVICE_FILE), { recursive: true });
    const node = process.execPath;
    const content = `[Unit]
Description=Clawpet OpenClaw activity daemon
After=default.target

[Service]
Type=simple
ExecStart=${node} ${daemonScript}
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
    writeFileSync(SERVICE_FILE, content, { mode: 0o600 });
    return SERVICE_FILE;
  }

  function readPid() {
    try { return parseInt(readFileSync(PID_FILE, "utf8").trim(), 10); } catch { return null; }
  }
  function pidAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  if (sub === "start") {
    const existing = readPid();
    if (pidAlive(existing)) { console.log(`clawpet daemon already running (pid ${existing})`); return; }
    const out = (await import("node:fs")).openSync(LOG_FILE, "a");
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    child.unref();
    console.log(`clawpet daemon started (pid ${child.pid})`);
    console.log(`log: ${LOG_FILE}`);
  } else if (sub === "stop") {
    const pid = readPid();
    if (!pidAlive(pid)) { console.log("clawpet daemon not running"); return; }
    try { process.kill(pid, "SIGTERM"); console.log(`clawpet daemon stopped (pid ${pid})`); } catch (e) { fail(`could not stop pid ${pid}: ${e.message}`); }
  } else if (sub === "status") {
    const pid = readPid();
    if (pidAlive(pid)) console.log(`clawpet daemon running (pid ${pid}) — log: ${LOG_FILE}`);
    else console.log("clawpet daemon not running");
  } else if (sub === "run") {
    // Foreground run for debugging
    const child = spawn(process.execPath, [daemonScript], { stdio: "inherit", env: process.env });
    child.on("exit", code => process.exit(code ?? 0));
  } else if (sub === "enable") {
    if (!systemdAvailable()) {
      fail("daemon enable currently supports systemd user services on Linux. Use daemon start for this session.", 2);
    }
    const file = writeSystemdService();
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "--now", SERVICE_NAME], { stdio: "inherit" });
    console.log(`clawpet daemon enabled as systemd user service: ${file}`);
  } else if (sub === "disable") {
    if (!systemdAvailable()) {
      fail("daemon disable currently supports systemd user services on Linux.", 2);
    }
    try { execFileSync("systemctl", ["--user", "disable", "--now", SERVICE_NAME], { stdio: "inherit" }); } catch {}
    console.log("clawpet daemon disabled");
  } else {
    fail(`unknown daemon subcommand: ${sub}. Try start|stop|status|run|enable|disable`);
  }
}

const [, , cmd, ...rest] = process.argv;
const { positional, flags } = parseFlags(rest);

switch (cmd) {
  case "wizard": await cmdWizard(positional, flags); break;
  case "doctor": await cmdDoctor(); break;
  case "ping": await cmdPing(); break;
  case "status": await cmdStatus(); break;
  case "send": await cmdSend(positional, flags); break;
  case "react": await cmdReact(positional, flags); break;
  case "activity": await cmdActivity(positional, flags); break;
  case "daemon-voice": await cmdDaemonVoice(positional, flags); break;
  case "expression-level": await cmdExpressionLevel(positional, flags); break;
  case "heartbeat-reactions": case "heartbeats": await cmdHeartbeats(positional, flags); break;
  case "pair": await cmdPair(flags); break;
  case "pair-mode": await cmdPairMode(positional, flags); break;
  case "rotate-token": case "rotate": await cmdRotateToken(); break;
  case "avatar": await cmdAvatar(positional, flags); break;
  case "install": cmdInstall(flags); break;
  case "config": cmdConfig(); break;
  case "daemon": await cmdDaemon(positional, flags); break;
  case "-h": case "--help": case "help": case undefined: usage(); break;
  default: fail(`unknown command '${cmd}'. Run 'clawpet help'.`);
}
