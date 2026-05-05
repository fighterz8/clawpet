import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomBytes } from "node:crypto";
import { validateAvatarStateEvent } from "../contracts/avatarEvent";
import { RuntimeStateStore } from "./stateStore";
import { AvatarBundleStore } from "./avatarBundleStore";

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://clawpet.vercel.app",
];

export type CreateRuntimeAppOptions = {
  store?: RuntimeStateStore;
  allowCorsOrigin?: string | string[];
  /** When set, all routes except /health and active /pair* require Authorization: Bearer <token>. */
  authToken?: string;
  /** Called when /admin/rotate-token or /pair/claim issues a new token. Should persist the new value. */
  onTokenRotated?: (newToken: string) => void;
  /** Override clock for tests. */
  now?: () => number;
  /** Override code generator for deterministic tests. */
  generatePairCode?: () => string;
  /** Optional persisted avatar bundle store for OpenClaw-pushed assets. */
  avatarBundleStore?: AvatarBundleStore;
};

type PairMode =
  | { active: false }
  | { active: true; code: string; expiresAt: number; attempts: number; lastAttemptAt: number };

function defaultPairCode(): string {
  // 6-digit numeric, zero-padded.
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

const PAIR_MODE_DEFAULT_MS = 90_000;
const PAIR_MODE_MAX_MS = 5 * 60_000;
const PAIR_MAX_ATTEMPTS = 3;
const PAIR_RATE_LIMIT_MS = 1000;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function createRuntimeApp(options: CreateRuntimeAppOptions = {}) {
  const store = options.store ?? new RuntimeStateStore();
  const app = new Hono();
  const bundleStore = options.avatarBundleStore;
  const now = options.now ?? (() => Date.now());
  const genCode = options.generatePairCode ?? defaultPairCode;
  // Held in a closure so /admin/rotate-token can swap it in-place without restart.
  let authToken = options.authToken;
  let pairMode: PairMode = { active: false };

  function pairExpired(): boolean {
    return pairMode.active && now() >= pairMode.expiresAt;
  }

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
    c.json({
      ok: true,
      service: "clawpet-runtime",
      version: "0.1.0",
      authRequired: Boolean(authToken),
      runtime: "node-dev",
      owner: "external-node-process",
    }),
  );

  // Public, no-auth pair-mode discovery: tells callers whether pair mode is
  // open without revealing the code. Used by overlays/CLIs to wait.
  app.get("/pair-mode", (c) => {
    if (!pairMode.active || pairExpired()) {
      pairMode = { active: false };
      return c.json({ active: false });
    }
    return c.json({ active: true, expiresAt: pairMode.expiresAt });
  });

  // Public, no-auth code-claim. Only effective while pair mode is active;
  // returns 404 otherwise (not 401) so external scanners can't fingerprint
  // pair-mode-active state via response code differences.
  app.post("/pair/claim", async (c) => {
    if (!pairMode.active || pairExpired()) {
      pairMode = { active: false };
      return c.json({ ok: false, errors: ["not found"] }, 404);
    }
    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ ok: false, errors: ["body must be valid JSON"] }, 400);
    }
    const code = (body as { code?: unknown })?.code;
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return c.json({ ok: false, errors: ["code must be a 6-digit string"] }, 400);
    }
    if (now() - pairMode.lastAttemptAt < PAIR_RATE_LIMIT_MS) {
      return c.json({ ok: false, errors: ["rate limited"] }, 429);
    }
    pairMode.lastAttemptAt = now();
    if (!timingSafeEqual(code, pairMode.code)) {
      pairMode.attempts++;
      if (pairMode.attempts >= PAIR_MAX_ATTEMPTS) {
        pairMode = { active: false };
        return c.json({ ok: false, errors: ["too many attempts; pair mode closed"] }, 403);
      }
      return c.json({ ok: false, errors: ["invalid code"], remainingAttempts: PAIR_MAX_ATTEMPTS - pairMode.attempts }, 401);
    }
    // Success: rotate bearer token, close pair mode.
    const newToken = randomBytes(32).toString("hex");
    authToken = newToken;
    options.onTokenRotated?.(newToken);
    pairMode = { active: false };
    return c.json({ ok: true, token: newToken });
  });

  // Auth middleware for everything else.
  // Loopback connections (same machine) are always trusted so the local
  // desktop overlay can poll without knowing the token.
  if (authToken) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/health") return next();
      if (c.req.path === "/pair-mode") return next();
      if (c.req.path === "/pair/claim") return next();

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

  // Avatar bundle currently selected by/pushed from the OpenClaw host. The
  // desktop overlay prefers this runtime-served bundle so the user can ask
  // OpenClaw to change appearance without editing target-machine files.
  app.get("/avatar-bundle/current/avatar.json", (c) => {
    const manifest = bundleStore?.getManifest();
    if (!manifest) return c.json({ ok: false, errors: ["no runtime avatar bundle has been uploaded"] }, 404);
    return c.json(manifest);
  });

  app.get("/avatar-bundle/current/assets/:file", (c) => {
    const file = c.req.param("file");
    const asset = bundleStore?.getAsset(`assets/${file}`);
    if (!asset) return c.json({ ok: false, errors: ["asset not found"] }, 404);
    return new Response(Buffer.from(asset.bytes), { headers: { "content-type": asset.contentType, "cache-control": "no-store" } });
  });

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

  app.post("/admin/avatar-bundle", async (c) => {
    if (!bundleStore) return c.json({ ok: false, errors: ["avatar bundle store is not configured"] }, 501);
    let payload: unknown;
    try { payload = await c.req.json(); } catch {
      return c.json({ ok: false, errors: ["body must be valid JSON"] }, 400);
    }
    const result = bundleStore.put(payload);
    if (!result.ok) return c.json({ ok: false, errors: result.errors }, 400);
    store.setAvatarBundle(result.manifest.name, result.manifest.version);
    return c.json({ ok: true, avatarId: result.manifest.name, bundleVersion: result.manifest.version, assetCount: result.assetCount, status: store.getStatus() });
  });

  app.post("/admin/rotate-token", async (c) => {
    const newToken = randomBytes(32).toString("hex");
    authToken = newToken;
    options.onTokenRotated?.(newToken);
    return c.json({ ok: true, token: newToken });
  });

  app.get("/auth/check", (c) => c.json({ ok: true, authenticated: true }));

  app.post("/admin/pair-mode/start", async (c) => {
    let durationMs = PAIR_MODE_DEFAULT_MS;
    try {
      const body = await c.req.json().catch(() => ({}));
      const requested = (body as { seconds?: unknown })?.seconds;
      if (typeof requested === "number" && requested > 0) {
        durationMs = Math.min(Math.floor(requested * 1000), PAIR_MODE_MAX_MS);
      }
    } catch { /* ignore */ }
    const code = genCode();
    pairMode = { active: true, code, expiresAt: now() + durationMs, attempts: 0, lastAttemptAt: 0 };
    return c.json({ ok: true, code, expiresAt: pairMode.expiresAt, durationMs });
  });

  app.post("/admin/pair-mode/cancel", async (c) => {
    pairMode = { active: false };
    return c.json({ ok: true });
  });

  app.post("/diagnostics/ping", async (c) => {
    const startedAt = Date.now();
    return c.json({ ok: true, pong: true, runtimeTime: new Date().toISOString(), serverProcessingMs: Date.now() - startedAt });
  });

  return app;
}
