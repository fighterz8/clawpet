import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomBytes } from "node:crypto";
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
  /** When set, all routes except /health require Authorization: Bearer <token>. */
  authToken?: string;
  /** Called when /admin/rotate-token issues a new token. Should persist the new value. */
  onTokenRotated?: (newToken: string) => void;
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function createRuntimeApp(options: CreateRuntimeAppOptions = {}) {
  const store = options.store ?? new RuntimeStateStore();
  const app = new Hono();
  // Held in a closure so /admin/rotate-token can swap it in-place without restart.
  let authToken = options.authToken;

  app.use(
    "*",
    cors({
      origin: options.allowCorsOrigin ?? defaultAllowedOrigins,
      allowMethods: ["GET", "POST"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Health is always public so liveness probes work without a token.
  app.get("/health", (c) =>
    c.json({ ok: true, service: "clawpet-runtime", version: "0.1.0", authRequired: Boolean(authToken) }),
  );

  // Auth middleware for everything else.
  // Loopback connections (same machine) are always trusted so the local
  // desktop overlay can poll without knowing the token.
  if (authToken) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/health") return next();

      const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
        ?.incoming?.socket?.remoteAddress ?? "";
      const isLoopback =
        remote === "127.0.0.1" ||
        remote === "::1" ||
        remote === "::ffff:127.0.0.1" ||
        remote.startsWith("127.");
      if (isLoopback) return next();

      const current = authToken;
      if (!current) return next();
      const header = c.req.header("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
      const provided = match?.[1] ?? "";
      if (!provided || !timingSafeEqual(provided, current)) {
        return c.json({ ok: false, errors: ["authentication required"] }, 401);
      }
      return next();
    });
  }

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

  app.post("/admin/rotate-token", async (c) => {
    const newToken = randomBytes(32).toString("hex");
    authToken = newToken;
    options.onTokenRotated?.(newToken);
    return c.json({ ok: true, token: newToken });
  });

  app.post("/diagnostics/ping", async (c) => {
    const startedAt = Date.now();
    return c.json({ ok: true, pong: true, runtimeTime: new Date().toISOString(), serverProcessingMs: Date.now() - startedAt });
  });

  return app;
}
