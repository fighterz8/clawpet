import { serve } from "@hono/node-server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { createRuntimeApp } from "./app";
import { RuntimeStateStore } from "./stateStore";
import { AvatarBundleStore } from "./avatarBundleStore";

const port = Number(process.env.CLAWPET_RUNTIME_PORT ?? 8737);
const hostname = process.env.CLAWPET_RUNTIME_HOST ?? "127.0.0.1";
const avatarId = process.env.CLAWPET_AVATAR_BUNDLE ?? "dawn-v0";
const demoMode = process.env.CLAWPET_DEMO === "1" || process.env.CLAWPET_DEMO?.toLowerCase() === "true";

const isLoopback = hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";

const tokenFile = join(homedir(), ".openclaw", "clawpet", "runtime-token");
const bundleDir = join(homedir(), ".openclaw", "clawpet", "runtime-bundles");

function loadOrCreateToken(): string {
  if (process.env.CLAWPET_RUNTIME_TOKEN) return process.env.CLAWPET_RUNTIME_TOKEN.trim();
  if (existsSync(tokenFile)) {
    const t = readFileSync(tokenFile, "utf8").trim();
    if (t) return t;
  }
  const token = randomBytes(32).toString("hex");
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, token + "\n", { mode: 0o600 });
  return token;
}

// Auth policy:
// - Loopback bind: token optional (set CLAWPET_RUNTIME_TOKEN to enforce; otherwise convenience over network exposure).
// - Non-loopback bind (LAN/Tailscale/0.0.0.0): token REQUIRED. Auto-generated and persisted if absent.
let authToken: string | undefined;
if (!isLoopback) authToken = loadOrCreateToken();
else if (process.env.CLAWPET_RUNTIME_TOKEN) authToken = process.env.CLAWPET_RUNTIME_TOKEN.trim();

const allowCorsOrigin = process.env.CLAWPET_RUNTIME_CORS
  ? process.env.CLAWPET_RUNTIME_CORS.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

const avatarBundleStore = new AvatarBundleStore(bundleDir);
const uploadedManifest = avatarBundleStore.getManifest();
const store = new RuntimeStateStore({ avatarId: uploadedManifest?.name ?? avatarId, bundleVersion: uploadedManifest?.version });

if (demoMode) {
  const demoStates = [
    { state: "idle", bubble: "Idle" },
    { state: "thinking", bubble: "Reading prompt…" },
    { state: "focused", bubble: "Working…" },
    { state: "happy", bubble: "Done" },
    { state: "alert", bubble: "Needs input" },
    { state: "sleepy", bubble: "Quiet" },
  ] as const;
  let i = 0;
  setInterval(() => {
    const next = demoStates[i++ % demoStates.length];
    store.applyEvent({
      type: "avatar.state",
      version: "0.1.0",
      eventId: `demo-${Date.now()}`,
      sentAt: new Date().toISOString(),
      source: { kind: "openclaw", displayName: "Clawpet demo" },
      state: next.state,
      bubble: next.bubble,
    });
  }, 6000);
}

serve({
  fetch: createRuntimeApp({
    store,
    authToken,
    allowCorsOrigin,
    avatarBundleStore,
    onTokenRotated: (newToken) => {
      try {
        mkdirSync(dirname(tokenFile), { recursive: true });
        writeFileSync(tokenFile, newToken + "\n", { mode: 0o600 });
        console.log(`Auth token rotated. New token persisted to ${tokenFile}.`);
      } catch (err) {
        console.error(`Failed to persist rotated token: ${(err as Error).message}`);
      }
    },
  }).fetch,
  port,
  hostname,
});

console.log(`Clawpet runtime listening on http://${hostname}:${port}`);
console.log(`Avatar: ${uploadedManifest ? `${uploadedManifest.name} ${uploadedManifest.version} (uploaded from OpenClaw)` : `${avatarId} (override with CLAWPET_AVATAR_BUNDLE)`}`);
console.log(`Runtime bundle store: ${bundleDir}`);
if (demoMode) console.log("Demo mode: cycling avatar states every 6s (CLAWPET_DEMO=1)");
if (authToken) {
  console.log(`Auth: Bearer token required. Token file: ${tokenFile}`);
  console.log(`To pair from another machine, run on that machine:`);
  console.log(`  clawpet pair --url http://${hostname === "0.0.0.0" ? "<this-host>" : hostname}:${port} --token ${authToken}`);
} else {
  console.log("Auth: disabled (loopback bind). Set CLAWPET_RUNTIME_TOKEN to require a token even on loopback.");
}
