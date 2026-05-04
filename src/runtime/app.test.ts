import { describe, expect, it } from "vitest";
import { createRuntimeApp } from "./app";
import { RuntimeStateStore } from "./stateStore";
import type { AvatarStateEvent } from "../contracts/avatarEvent";

const event: AvatarStateEvent = {
  type: "avatar.state",
  version: "0.1.0",
  eventId: "evt_runtime_1",
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
  state: "happy",
  message: "Deploy finished.",
  ttlMs: 8000,
  priority: "normal",
};

describe("runtime API", () => {
  it("reports health and initial status", async () => {
    const app = createRuntimeApp({ store: new RuntimeStateStore({ now: () => new Date("2026-05-04T19:30:01.000Z") }) });

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "clawpet-runtime" });

    const status = await app.request("/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      type: "clawpet.status",
      connected: true,
      avatar: { avatarId: "dawn-v0", state: "idle" },
    });
  });

  it("accepts a valid avatar state event and updates status", async () => {
    const app = createRuntimeApp({ store: new RuntimeStateStore({ now: () => new Date("2026-05-04T19:30:01.000Z") }) });

    const response = await app.request("/avatar/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      latencyMs: 1000,
      status: {
        avatar: { state: "happy" },
        pairedOpenClaw: { instanceId: "openclaw-home-server" },
      },
    });

    const events = await app.request("/events");
    expect(await events.json()).toMatchObject({ events: [{ event: { eventId: "evt_runtime_1", state: "happy" } }] });
  });

  it("rejects malformed or unsafe events", async () => {
    const app = createRuntimeApp();
    const response = await app.request("/avatar/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, message: "oauth code=secret", state: "angry" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.errors).toContain("state is not supported");
    expect(body.errors).toContain("message appears to contain a secret or OAuth code");
  });
});
