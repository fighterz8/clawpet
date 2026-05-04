#!/usr/bin/env tsx
import { avatarStates } from "../contracts/avatarEvent";
import { parseAvatarState, sendTestEvent } from "./client";

function help() {
  console.log(`Usage:
  npm run send-test -- [state] [message]

Examples:
  npm run send-test -- thinking "Working on Clawpet..."
  npm run send-test -- happy "Deploy finished."
  CLAWPET_RUNTIME_URL=http://127.0.0.1:8737 npm run send-test -- alert "OAuth approval needed."

States: ${avatarStates.join(", ")}`);
}

const [, , stateArg, ...messageParts] = process.argv;

if (stateArg === "--help" || stateArg === "-h") {
  help();
  process.exit(0);
}

try {
  const state = parseAvatarState(stateArg);
  const message = messageParts.join(" ").trim() || undefined;
  const runtimeUrl = process.env.CLAWPET_RUNTIME_URL;
  const result = await sendTestEvent({ state, message, runtimeUrl });
  console.log(JSON.stringify({ ok: true, eventId: result.event.eventId, state, response: result.response }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
