import { serve } from "@hono/node-server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { createRuntimeApp } from "./app";
import { RuntimeStateStore } from "./stateStore";

const port = Number(process.env.CLAWPET_RUNTIME_PORT ?? 8737);
const hostname = process.env.CLAWPET_RUNTIME_HOST ?? "127.0.0.1";
const avatarId = process.env.CLAWPET_AVATAR_BUNDLE ?? "dawn-v0";

const isLoopback = hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";

const tokenFile = join(homedir(), ".openclaw", "clawpet", "runtime-token");

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

const store = new RuntimeStateStore({ avatarId });

serve({
  fetch: createRuntimeApp({
    store,
    authToken,
    allowCorsOrigin,
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
console.log(`Avatar: ${avatarId} (override with CLAWPET_AVATAR_BUNDLE)`);
if (authToken) {
  console.log(`Auth: Bearer token required. Token file: ${tokenFile}`);
  console.log(`To pair from another machine, run on that machine:`);
  console.log(`  clawpet pair --url http://${hostname === "0.0.0.0" ? "<this-host>" : hostname}:${port} --token ${authToken}`);
} else {
  console.log("Auth: disabled (loopback bind). Set CLAWPET_RUNTIME_TOKEN to require a token even on loopback.");
}
