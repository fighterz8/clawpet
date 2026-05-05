#!/usr/bin/env node
// Cross-platform runtime launcher for npm scripts.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = new Set(process.argv.slice(2));
const env = { ...process.env };

if (args.has("--demo")) env.CLAWPET_DEMO = "1";
if (args.has("--tailscale") || args.has("--host-all")) {
  env.CLAWPET_RUNTIME_HOST = env.CLAWPET_RUNTIME_HOST || "0.0.0.0";
  env.CLAWPET_RUNTIME_PORT = env.CLAWPET_RUNTIME_PORT || "8737";
}

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "src/runtime/server.ts"], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
