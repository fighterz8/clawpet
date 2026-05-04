export const AVATAR_EVENT_VERSION = "0.1.0" as const;

export const avatarStates = ["idle", "thinking", "focused", "happy", "alert", "sleepy"] as const;
export type AvatarState = (typeof avatarStates)[number];

export const avatarPriorities = ["low", "normal", "high", "critical"] as const;
export type AvatarPriority = (typeof avatarPriorities)[number];

export type AvatarStateEvent = {
  type: "avatar.state";
  version: typeof AVATAR_EVENT_VERSION;
  eventId: string;
  sentAt: string;
  source: {
    kind: "openclaw";
    instanceId?: string;
    displayName?: string;
  };
  target?: {
    deviceId?: string;
    avatarId?: string;
  };
  state: AvatarState;
  message?: string;
  ttlMs?: number;
  priority?: AvatarPriority;
  correlationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ClawpetStatus = {
  type: "clawpet.status";
  version: typeof AVATAR_EVENT_VERSION;
  runtimeId: string;
  deviceName: string;
  mode: "local" | "remote-relay" | "direct-tunnel" | "offline";
  connected: boolean;
  pairedOpenClaw?: {
    instanceId?: string;
    displayName?: string;
  };
  avatar: {
    avatarId: string;
    state: AvatarState;
    bundleVersion?: string;
  };
  lastEventAt?: string;
  latencyMs?: number;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const MAX_MESSAGE_LENGTH = 280;
const MAX_TTL_MS = 60 * 60 * 1000;
const MAX_METADATA_KEYS = 20;
const MAX_EVENT_BYTES = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isIsoDate(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function approxByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function rejectSecretLikeMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("oauth") && lower.includes("code=")
    || lower.includes("refresh_token")
    || lower.includes("access_token")
    || lower.includes("password=")
    || lower.includes("api_key");
}

export function validateAvatarStateEvent(input: unknown): ValidationResult<AvatarStateEvent> {
  const errors: string[] = [];

  if (approxByteLength(input) > MAX_EVENT_BYTES) {
    return { ok: false, errors: [`event exceeds ${MAX_EVENT_BYTES} byte limit`] };
  }

  if (!isRecord(input)) return { ok: false, errors: ["event must be an object"] };

  if (input.type !== "avatar.state") errors.push("type must be avatar.state");
  if (input.version !== AVATAR_EVENT_VERSION) errors.push(`version must be ${AVATAR_EVENT_VERSION}`);
  if (!isString(input.eventId) || input.eventId.trim() === "") errors.push("eventId is required");
  if (!isString(input.sentAt) || !isIsoDate(input.sentAt)) errors.push("sentAt must be an ISO timestamp");
  if (!avatarStates.includes(input.state as AvatarState)) errors.push("state is not supported");

  if (!isRecord(input.source)) {
    errors.push("source is required");
  } else {
    if (input.source.kind !== "openclaw") errors.push("source.kind must be openclaw");
    if (input.source.instanceId !== undefined && !isString(input.source.instanceId)) errors.push("source.instanceId must be a string");
    if (input.source.displayName !== undefined && !isString(input.source.displayName)) errors.push("source.displayName must be a string");
  }

  if (input.target !== undefined) {
    if (!isRecord(input.target)) {
      errors.push("target must be an object");
    } else {
      if (input.target.deviceId !== undefined && !isString(input.target.deviceId)) errors.push("target.deviceId must be a string");
      if (input.target.avatarId !== undefined && !isString(input.target.avatarId)) errors.push("target.avatarId must be a string");
    }
  }

  if (input.message !== undefined) {
    if (!isString(input.message)) {
      errors.push("message must be a string");
    } else {
      if (input.message.length > MAX_MESSAGE_LENGTH) errors.push(`message must be <= ${MAX_MESSAGE_LENGTH} characters`);
      if (rejectSecretLikeMessage(input.message)) errors.push("message appears to contain a secret or OAuth code");
    }
  }

  if (input.ttlMs !== undefined) {
    if (typeof input.ttlMs !== "number" || !Number.isFinite(input.ttlMs) || input.ttlMs < 0 || input.ttlMs > MAX_TTL_MS) {
      errors.push(`ttlMs must be a number between 0 and ${MAX_TTL_MS}`);
    }
  }

  if (input.priority !== undefined && !avatarPriorities.includes(input.priority as AvatarPriority)) {
    errors.push("priority is not supported");
  }

  if (input.correlationId !== undefined && !isString(input.correlationId)) errors.push("correlationId must be a string");

  if (input.metadata !== undefined) {
    if (!isRecord(input.metadata)) {
      errors.push("metadata must be an object");
    } else if (Object.keys(input.metadata).length > MAX_METADATA_KEYS) {
      errors.push(`metadata must have <= ${MAX_METADATA_KEYS} keys`);
    } else {
      for (const [key, value] of Object.entries(input.metadata)) {
        const valid = value === null || ["string", "number", "boolean"].includes(typeof value);
        if (!valid) errors.push(`metadata.${key} must be a primitive value`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as AvatarStateEvent };
}

export function fallbackAvatarState(state: unknown): AvatarState {
  return avatarStates.includes(state as AvatarState) ? (state as AvatarState) : "idle";
}
