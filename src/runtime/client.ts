import { randomUUID } from "node:crypto";
import { AVATAR_EVENT_VERSION, avatarStates, type AvatarState, type AvatarStateEvent } from "../contracts/avatarEvent";

export type BuildTestEventOptions = {
  state: AvatarState;
  message?: string;
  runtimeUrl?: string;
  instanceId?: string;
  displayName?: string;
  deviceId?: string;
  avatarId?: string;
  now?: () => Date;
  eventId?: string;
};

export type SendTestEventOptions = BuildTestEventOptions & {
  fetchImpl?: typeof fetch;
};

export function parseAvatarState(value: string | undefined): AvatarState {
  if (!value) return "thinking";
  if (avatarStates.includes(value as AvatarState)) return value as AvatarState;
  throw new Error(`Unsupported state "${value}". Expected one of: ${avatarStates.join(", ")}`);
}

export function buildTestEvent(options: BuildTestEventOptions): AvatarStateEvent {
  const now = options.now ?? (() => new Date());
  return {
    type: "avatar.state",
    version: AVATAR_EVENT_VERSION,
    eventId: options.eventId ?? `evt_${randomUUID()}`,
    sentAt: now().toISOString(),
    source: {
      kind: "openclaw",
      instanceId: options.instanceId ?? "manual-send-test",
      displayName: options.displayName ?? "Manual send-test",
    },
    target: {
      deviceId: options.deviceId ?? "local-runtime",
      avatarId: options.avatarId ?? "dawn-v0",
    },
    state: options.state,
    message: options.message ?? `Manual test: ${options.state}`,
    ttlMs: 8000,
    priority: options.state === "alert" ? "high" : "normal",
  };
}

export async function sendTestEvent(options: SendTestEventOptions) {
  const runtimeUrl = (options.runtimeUrl ?? "http://127.0.0.1:8737").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const event = buildTestEvent(options);

  let response: Response;
  try {
    response = await fetchImpl(`${runtimeUrl}/avatar/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (error) {
    throw new Error(`Could not reach Clawpals runtime at ${runtimeUrl}. Is npm run runtime:dev running? (${String(error)})`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Runtime rejected event (${response.status}): ${JSON.stringify(body)}`);
  }

  return { event, response: body };
}
