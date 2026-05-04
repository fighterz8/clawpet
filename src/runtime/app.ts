import { Hono } from "hono";
import { cors } from "hono/cors";
import { validateAvatarStateEvent } from "../contracts/avatarEvent";
import { RuntimeStateStore } from "./stateStore";

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://clawpet.vercel.app",
];

export type CreateRuntimeAppOptions = {
  store?: RuntimeStateStore;
  allowCorsOrigin?: string | string[];
};

export function createRuntimeApp(options: CreateRuntimeAppOptions = {}) {
  const store = options.store ?? new RuntimeStateStore();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: options.allowCorsOrigin ?? defaultAllowedOrigins,
      allowMethods: ["GET", "POST"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, service: "clawpet-runtime", version: "0.1.0" }));

  app.get("/status", (c) => c.json(store.getStatus()));

  app.get("/events", (c) => c.json({ events: store.getEvents() }));

  app.post("/avatar/state", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, errors: ["body must be valid JSON"] }, 400);
    }

    const result = validateAvatarStateEvent(payload);
    if (!result.ok) return c.json({ ok: false, errors: result.errors }, 400);

    const entry = store.applyEvent(result.value);
    return c.json({ ok: true, status: store.getStatus(), receivedAt: entry.receivedAt, latencyMs: entry.latencyMs });
  });

  app.post("/diagnostics/ping", async (c) => {
    const startedAt = Date.now();
    return c.json({ ok: true, pong: true, runtimeTime: new Date().toISOString(), serverProcessingMs: Date.now() - startedAt });
  });

  return app;
}
