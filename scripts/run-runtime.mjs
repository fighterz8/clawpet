#!/usr/bin/env node
// Cross-platform runtime launcher for npm scripts.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = new Set(process.argv.slice(2));
const env = { ...process.env };

if (args.has("--demo")) env.CLAWPALS_DEMO = "1";
if (args.has("--tailscale") || args.has("--host-all")) {
  env.CLAWPALS_RUNTIME_HOST = env.CLAWPALS_RUNTIME_HOST || "0.0.0.0";
  env.CLAWPALS_RUNTIME_PORT = env.CLAWPALS_RUNTIME_PORT || "8737";
}

const tsxBin = process.platform === "win32"
  ? join(root, "node_modules", ".bin", "tsx.cmd")
  : join(root, "node_modules", ".bin", "tsx");
const command = existsSync(tsxBin) ? tsxBin : "npx";
const commandArgs = existsSync(tsxBin) ? ["src/runtime/server.ts"] : ["tsx", "src/runtime/server.ts"];

const child = spawn(command, commandArgs, {
  cwd: root,
  env,
  stdio: "inherit",
  // Windows Node 24 can throw spawn EINVAL for .cmd shims without a shell.
  shell: process.platform === "win32",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error("Failed to start Clawpals runtime child process.");
  console.error(`command: ${command} ${commandArgs.join(" ")}`);
  console.error(`cwd: ${root}`);
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
