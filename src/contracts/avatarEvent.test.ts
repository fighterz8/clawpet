import { describe, expect, it } from "vitest";
import { fallbackAvatarState, validateAvatarStateEvent, type AvatarStateEvent } from "./avatarEvent";

const validEvent: AvatarStateEvent = {
  type: "avatar.state",
  version: "0.1.0",
  eventId: "evt_test_1",
  sentAt: "2026-05-04T19:30:00.000Z",
  source: {
    kind: "openclaw",
    instanceId: "openclaw-home-server",
    displayName: "Nick's OpenClaw",
  },
  target: {
    deviceId: "nick-main-pc",
    avatarId: "dawn-v0",
  },
  state: "thinking",
  message: "Inspecting the repo...",
  ttlMs: 8000,
  priority: "normal",
};

describe("avatar event contract", () => {
  it("accepts a valid avatar.state event", () => {
    const result = validateAvatarStateEvent(validEvent);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("thinking");
  });

  it("rejects unsupported event types and states", () => {
    const result = validateAvatarStateEvent({ ...validEvent, type: "shell.exec", state: "angry" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("type must be avatar.state");
      expect(result.errors).toContain("state is not supported");
    }
  });

  it("rejects secret-like messages", () => {
    const result = validateAvatarStateEvent({
      ...validEvent,
      message: "OAuth callback failed: http://127.0.0.1/callback?code=abc123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("message appears to contain a secret or OAuth code");
  });

  it("accepts optional runtime-arbitration metadata conventions", () => {
    const result = validateAvatarStateEvent({
      ...validEvent,
      metadata: {
        sourceClass: "OpenClaw expression",
        lingerMs: 8000,
        sessionKey: "agent:main:discord:direct:172471885806829569",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects oversized ttl and metadata objects", () => {
    const result = validateAvatarStateEvent({
      ...validEvent,
      ttlMs: 99_999_999,
      metadata: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("ttlMs must be a number between 0 and 3600000");
      expect(result.errors).toContain("metadata must have <= 20 keys");
    }
  });

  it("falls unknown runtime states back to idle", () => {
    expect(fallbackAvatarState("happy")).toBe("happy");
    expect(fallbackAvatarState("confused")).toBe("idle");
  });
});
