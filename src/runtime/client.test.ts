import { describe, expect, it, vi } from "vitest";
import { buildTestEvent, parseAvatarState, sendTestEvent } from "./client";

describe("runtime client", () => {
  it("parses supported states and rejects unknown states", () => {
    expect(parseAvatarState(undefined)).toBe("thinking");
    expect(parseAvatarState("happy")).toBe("happy");
    expect(() => parseAvatarState("angry")).toThrow(/Unsupported state/);
  });

  it("builds a valid test event", () => {
    const event = buildTestEvent({
      state: "alert",
      message: "Approval needed.",
      now: () => new Date("2026-05-04T20:20:00.000Z"),
      eventId: "evt_test",
    });

    expect(event).toMatchObject({
      type: "avatar.state",
      version: "0.1.0",
      eventId: "evt_test",
      sentAt: "2026-05-04T20:20:00.000Z",
      state: "alert",
      message: "Approval needed.",
      priority: "high",
    });
  });

  it("posts event to runtime", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, latencyMs: 12 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await sendTestEvent({
      state: "thinking",
      message: "Working...",
      runtimeUrl: "http://runtime.test/",
      now: () => new Date("2026-05-04T20:20:00.000Z"),
      eventId: "evt_post",
      fetchImpl,
    });

    expect(result.event.eventId).toBe("evt_post");
    expect(result.response).toEqual({ ok: true, latencyMs: 12 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://runtime.test/avatar/state",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces runtime rejection", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, errors: ["bad event"] }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(sendTestEvent({ state: "idle", fetchImpl })).rejects.toThrow(/Runtime rejected event/);
  });
});
