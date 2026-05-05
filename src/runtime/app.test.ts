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

  it("requires bearer token when authToken is set", async () => {
    const app = createRuntimeApp({
      store: new RuntimeStateStore({ now: () => new Date("2026-05-04T19:30:01.000Z") }),
      authToken: "secret-token",
    });

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ authRequired: true });

    const noAuth = await app.request("/avatar/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    expect(noAuth.status).toBe(401);

    const wrong = await app.request("/avatar/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
      body: JSON.stringify(event),
    });
    expect(wrong.status).toBe(401);

    const ok = await app.request("/avatar/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret-token" },
      body: JSON.stringify(event),
    });
    expect(ok.status).toBe(200);

    const status = await app.request("/status", { headers: { Authorization: "Bearer secret-token" } });
    expect(status.status).toBe(200);
  });

  it("decays active state to idle then sleepy on its own", async () => {
    let nowMs = Date.parse("2026-05-04T19:30:01.000Z");
    const store = new RuntimeStateStore({
      now: () => new Date(nowMs),
      idleAfterMs: 8000,
      sleepyAfterMs: 60000,
    });
    const app = createRuntimeApp({ store });

    await app.request("/avatar/state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, state: "happy", sentAt: new Date(nowMs).toISOString() }),
    });
    expect((await (await app.request("/status")).json()).avatar.state).toBe("happy");

    nowMs += 9000; // past idleAfterMs
    expect((await (await app.request("/status")).json()).avatar.state).toBe("idle");

    nowMs += 70000; // well past sleepyAfterMs after going idle
    expect((await (await app.request("/status")).json()).avatar.state).toBe("sleepy");
  });

  it("rotates the auth token via /admin/rotate-token", async () => {
    let persisted: string | undefined;
    const app = createRuntimeApp({ authToken: "old-token", onTokenRotated: (t) => { persisted = t; } });

    const denied = await app.request("/admin/rotate-token", { method: "POST" });
    expect(denied.status).toBe(401);

    const ok = await app.request("/admin/rotate-token", {
      method: "POST", headers: { Authorization: "Bearer old-token" },
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(typeof body.token).toBe("string");
    expect(body.token).toHaveLength(64);
    expect(persisted).toBe(body.token);

    // Old token now rejected.
    const oldRejected = await app.request("/status", { headers: { Authorization: "Bearer old-token" } });
    expect(oldRejected.status).toBe(401);
    // New token accepted.
    const newAccepted = await app.request("/status", { headers: { Authorization: `Bearer ${body.token}` } });
    expect(newAccepted.status).toBe(200);
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
