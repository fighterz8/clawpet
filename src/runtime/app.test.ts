import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeApp } from "./app";
import { RuntimeStateStore } from "./stateStore";
import { AvatarBundleStore } from "./avatarBundleStore";
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

  it("persists active states (thinking/focused/alert) until a new event arrives", async () => {
    let nowMs = Date.parse("2026-05-04T19:30:01.000Z");
    const store = new RuntimeStateStore({
      now: () => new Date(nowMs),
      terminalLingerMs: 8000,
      sleepyAfterMs: 60000,
      bubbleTtlMs: 12000,
    });
    const app = createRuntimeApp({ store });

    await app.request("/avatar/state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, state: "focused", sentAt: new Date(nowMs).toISOString() }),
    });
    expect((await (await app.request("/status")).json()).avatar.state).toBe("focused");

    nowMs += 60000; // a minute later, no new event
    expect((await (await app.request("/status")).json()).avatar.state).toBe("focused");
  });

  it("decays terminal happy state through idle then sleepy", async () => {
    let nowMs = Date.parse("2026-05-04T19:30:01.000Z");
    const store = new RuntimeStateStore({
      now: () => new Date(nowMs),
      terminalLingerMs: 8000,
      sleepyAfterMs: 60000,
      bubbleTtlMs: 12000,
    });
    const app = createRuntimeApp({ store });

    await app.request("/avatar/state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, state: "happy", sentAt: new Date(nowMs).toISOString() }),
    });
    expect((await (await app.request("/status")).json()).avatar.state).toBe("happy");

    nowMs += 9000; // past terminalLingerMs
    expect((await (await app.request("/status")).json()).avatar.state).toBe("idle");

    nowMs += 70000; // past sleepyAfterMs
    expect((await (await app.request("/status")).json()).avatar.state).toBe("sleepy");
  });

  it("keeps active bubbles sticky, then replaces terminal bubbles with idle", async () => {
    let nowMs = Date.parse("2026-05-04T19:30:01.000Z");
    const store = new RuntimeStateStore({
      now: () => new Date(nowMs),
      terminalLingerMs: 8000,
      sleepyAfterMs: 60000,
    });
    const app = createRuntimeApp({ store });

    await app.request("/avatar/state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, state: "focused", bubble: "Working…", sentAt: new Date(nowMs).toISOString() }),
    });
    expect((await (await app.request("/status")).json()).avatar.bubble).toBe("Working…");

    // Active focused state persists, so bubble persists too.
    nowMs += 30000;
    expect((await (await app.request("/status")).json()).avatar.bubble).toBe("Working…");

    // Terminal happy keeps its useful completion bubble during the 8s linger.
    await app.request("/avatar/state", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, state: "happy", bubble: "Done!", sentAt: new Date(nowMs).toISOString() }),
    });
    expect((await (await app.request("/status")).json()).avatar.bubble).toBe("Done!");

    // Once happy decays back to idle, replace the stale work caption with "idle".
    nowMs += 9000;
    const afterIdle = (await (await app.request("/status")).json()).avatar;
    expect(afterIdle.state).toBe("idle");
    expect(afterIdle.bubble).toBe("idle");
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

  it("opens pair mode and accepts a valid 6-digit code, rotating the token", async () => {
    let nowMs = 1_000_000;
    let persisted: string | undefined;
    const app = createRuntimeApp({
      authToken: "old-token",
      onTokenRotated: (t) => { persisted = t; },
      now: () => nowMs,
      generatePairCode: () => "472091",
    });

    // Pair mode initially closed.
    let pm = await (await app.request("/pair-mode")).json();
    expect(pm.active).toBe(false);

    // Cannot start without auth (unless loopback; in tests req has no socket so loopback bypass doesn't apply).
    const denied = await app.request("/admin/pair-mode/start", { method: "POST" });
    expect(denied.status).toBe(401);

    const opened = await app.request("/admin/pair-mode/start", {
      method: "POST", headers: { Authorization: "Bearer old-token", "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: 60 }),
    });
    expect(opened.status).toBe(200);
    const openBody = await opened.json();
    expect(openBody.code).toBe("472091");

    pm = await (await app.request("/pair-mode")).json();
    expect(pm.active).toBe(true);
    expect(typeof pm.expiresAt).toBe("number");
    expect(pm.code).toBeUndefined(); // public endpoint never reveals code

    // Wrong code → 401, attempt counted.
    nowMs += 1100;
    const wrong = await app.request("/pair/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(wrong.status).toBe(401);

    // Right code → 200 with new token.
    nowMs += 1100;
    const claim = await app.request("/pair/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "472091" }),
    });
    expect(claim.status).toBe(200);
    const claimBody = await claim.json();
    expect(claimBody.token).toHaveLength(64);
    expect(persisted).toBe(claimBody.token);

    // Pair mode auto-closes on success.
    pm = await (await app.request("/pair-mode")).json();
    expect(pm.active).toBe(false);

    // Old token rejected, new token accepted.
    const oldRejected = await app.request("/status", { headers: { Authorization: "Bearer old-token" } });
    expect(oldRejected.status).toBe(401);
    const newAccepted = await app.request("/status", { headers: { Authorization: `Bearer ${claimBody.token}` } });
    expect(newAccepted.status).toBe(200);
  });

  it("closes pair mode after 3 wrong attempts", async () => {
    let nowMs = 1_000_000;
    const app = createRuntimeApp({
      authToken: "tok",
      now: () => nowMs,
      generatePairCode: () => "111111",
    });
    await app.request("/admin/pair-mode/start", {
      method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    for (let i = 0; i < 3; i++) {
      nowMs += 1100;
      await app.request("/pair/claim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "000000" }),
      });
    }
    const pm = await (await app.request("/pair-mode")).json();
    expect(pm.active).toBe(false);
    // Right code now too late.
    nowMs += 1100;
    const tooLate = await app.request("/pair/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "111111" }),
    });
    expect(tooLate.status).toBe(404);
  });

  it("accepts and serves OpenClaw-pushed avatar bundles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clawpet-bundle-test-"));
    const bundleStore = new AvatarBundleStore(dir);
    const app = createRuntimeApp({ avatarBundleStore: bundleStore });
    const manifest = JSON.parse(readFileSync("public/avatars/dawn-v0/avatar.json", "utf8"));
    const assets: Record<string, string> = {};
    for (const def of Object.values(manifest.states) as Array<{ asset: string }>) {
      assets[def.asset] = readFileSync(join("public/avatars/dawn-v0", def.asset)).toString("base64");
    }

    const pushed = await app.request("/admin/avatar-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, assets }),
    });
    expect(pushed.status).toBe(200);
    expect(await pushed.json()).toMatchObject({ ok: true, avatarId: "Dawn", bundleVersion: "0.4.0", assetCount: 6 });

    const status = await (await app.request("/status")).json();
    expect(status.avatar.avatarId).toBe("Dawn");
    expect(status.avatar.bundleVersion).toBe("0.4.0");

    const servedManifest = await app.request("/avatar-bundle/current/avatar.json");
    expect(servedManifest.status).toBe(200);
    expect(await servedManifest.json()).toMatchObject({ name: "Dawn", version: "0.4.0" });

    const asset = await app.request("/avatar-bundle/current/assets/idle.png");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("image/png");
    const bytes = new Uint8Array(await asset.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
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
