import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./onboard.css";

const RUNTIME_URL = "http://127.0.0.1:8737";

type RuntimeStatus = {
  ok: boolean;
  service?: string;
  authRequired?: boolean;
  runtime?: string;
  owner?: string;
  displayHost?: string;
};

type PairMode = {
  active: boolean;
  code?: string;
  expiresAt?: number;
  runtimeUrl?: string;
};
type ClawpetStatus = {
  connected?: boolean;
  lastEventAt?: string | null;
  avatar?: {
    state?: string;
    bubble?: string;
    avatarId?: string;
    bundleVersion?: string;
  };
};
type BundleManifest = { name?: string; version?: string; states?: Record<string, unknown> };
type TabKey = "home" | "pair" | "details";

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok)
    throw new Error(
      typeof body === "object" && body && "errors" in body
        ? String((body as { errors: unknown }).errors)
        : `HTTP ${res.status}`,
    );
  return body;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ob-copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ob-mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OnboardApp() {
  const [health, setHealth] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pair, setPair] = useState<PairMode>({ active: false });
  const [status, setStatus] = useState<ClawpetStatus | null>(null);
  const [bundleManifest, setBundleManifest] = useState<BundleManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("home");

  async function refresh() {
    try {
      const h = (await fetchJson(`${RUNTIME_URL}/health`)) as RuntimeStatus;
      setHealth(h);
      setRuntimeError(null);
      try {
        const p = (await fetchJson(`${RUNTIME_URL}/pair-mode`)) as PairMode;
        setPair((prev) => ({ ...p, code: p.code ?? (p.active ? prev.code : undefined) }));
      } catch {
        // ignore
      }
      try {
        const s = (await fetchJson(`${RUNTIME_URL}/status`)) as ClawpetStatus;
        setStatus(s);
      } catch {
        // ignore
      }
      try {
        const m = (await fetchJson(
          `${RUNTIME_URL}/avatar-bundle/current/avatar.json`,
        )) as BundleManifest;
        setBundleManifest(m);
      } catch {
        setBundleManifest(null);
      }
    } catch (e) {
      setHealth(null);
      setStatus(null);
      setRuntimeError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(id);
  }, []);

  async function startPairMode() {
    setBusy(true);
    try {
      const p = (await fetchJson(`${RUNTIME_URL}/admin/pair-mode/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: 120 }),
      })) as { code: string; expiresAt: number };
      setPair({ active: true, code: p.code, expiresAt: p.expiresAt });
      setTab("pair");
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      window.setTimeout(() => setRefreshing(false), 250);
    }
  }

  async function cancelPairMode() {
    setBusy(true);
    try {
      await fetchJson(`${RUNTIME_URL}/admin/pair-mode/cancel`, { method: "POST" });
      setPair({ active: false });
      await refresh();
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const groupedCode = pair.code ? `${pair.code.slice(0, 3)} · ${pair.code.slice(3)}` : "—";
  const displayHost = health?.displayHost || "<display-host>";
  const hostArg = displayHost.includes(":") ? displayHost : `${displayHost}:8737`;
  const openClawCommand = pair.code
    ? `clawpet wizard openclaw --code ${pair.code} --host ${hostArg}`
    : `clawpet wizard openclaw --code <code> --host ${hostArg}`;
  const runtimeOnline = Boolean(health?.ok);
  const appOwnedRuntime =
    health?.runtime === "tauri-internal" || health?.owner === "clawpet-desktop-app";
  const runtimeOwnerLabel =
    health?.runtime === "tauri-internal"
      ? "desktop app runtime"
      : health?.runtime === "node-dev"
        ? "external dev runtime"
        : health?.runtime ?? "unknown runtime";
  const openClawConnected = Boolean(status?.connected);
  const hasOpenClawActivity = Boolean(status?.lastEventAt);
  const openClawReady = openClawConnected || hasOpenClawActivity;
  const expiresIn = useMemo(
    () =>
      pair.expiresAt
        ? Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000))
        : null,
    [pair.expiresAt, pair.active],
  );
  const lastEventAge = useMemo(() => {
    if (!status?.lastEventAt) return null;
    const n = Number(status.lastEventAt);
    const ms = Number.isFinite(n) ? Date.now() - n : Date.now() - Date.parse(status.lastEventAt);
    if (!Number.isFinite(ms) || ms < 0) return null;
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
    if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / (60 * 60_000))}h ago`;
  }, [status?.lastEventAt]);
  const avatarState = status?.avatar?.state ?? "unknown";
  const avatarBubble = status?.avatar?.bubble ?? "—";
  const runtimeAvatarId = status?.avatar?.avatarId ?? bundleManifest?.name ?? "unknown";
  const runtimeBundleVersion = status?.avatar?.bundleVersion ?? bundleManifest?.version ?? "—";
  const runtimeBundleStateCount = bundleManifest?.states ? Object.keys(bundleManifest.states).length : 0;

  const statusTone = runtimeOnline ? (openClawReady ? "ob-pill--ok" : "ob-pill--warn") : "ob-pill--bad";
  const statusLabel = !runtimeOnline
    ? "offline"
    : openClawReady
      ? "connected"
      : "waiting";

  return (
    <main className="ob-shell">
      <section className="ob-frame">
        <header className="ob-topbar">
          <div>
            <p className="ob-eyebrow">Desktop companion</p>
            <h1 className="ob-logo-word">CLAWPET</h1>
            <p className="ob-tagline">Compact control panel for pairing, health, and avatar checks.</p>
          </div>
          <div className="ob-topbar-side">
            <span className={`ob-pill ${statusTone}`}>{statusLabel}</span>
            <button className="ob-secondary" disabled={refreshing} onClick={() => void refreshNow()}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <section className="ob-hero-panel">
          <div className="ob-hero-icon">🐲</div>
          <div className="ob-hero-copy">
            <strong>
              {openClawReady
                ? "Clawpet is linked and ready."
                : runtimeOnline
                  ? "Runtime is up. Pair only if the pet stays yellow or silent."
                  : "Runtime is offline right now."}
            </strong>
            <span>
              {openClawConnected
                ? hasOpenClawActivity
                  ? "OpenClaw has already sent live activity."
                  : "Connection is established; first activity should arrive soon."
                : runtimeOnline
                  ? "Use the pair tab only when needed."
                  : "In dev, run npm run runtime:tailscale if it does not come up."}
            </span>
          </div>
        </section>

        <section className="ob-summary-grid">
          <MiniStat label="Runtime" value={runtimeOwnerLabel} />
          <MiniStat label="Avatar" value={runtimeAvatarId} />
          <MiniStat label="State" value={avatarState} />
          <MiniStat label="Last event" value={lastEventAge ?? "none yet"} />
        </section>

        <nav className="ob-tabs" aria-label="Clawpet sections">
          <button className={tab === "home" ? "ob-tab ob-tab--active" : "ob-tab"} onClick={() => setTab("home")}>
            Home
          </button>
          <button className={tab === "pair" ? "ob-tab ob-tab--active" : "ob-tab"} onClick={() => setTab("pair")}>
            Pair
          </button>
          <button className={tab === "details" ? "ob-tab ob-tab--active" : "ob-tab"} onClick={() => setTab("details")}>
            Details
          </button>
        </nav>

        <section className="ob-panel">
          {tab === "home" && (
            <div className="ob-tab-panel">
              <div className="ob-panel-grid ob-panel-grid--home">
                <div className="ob-card ob-card--tight">
                  <div className="ob-card-head">
                    <h2>Connection</h2>
                    <span className={`ob-pill ${statusTone}`}>{statusLabel}</span>
                  </div>
                  {!runtimeOnline && (
                    <div className="ob-warn">Runtime is not reachable. If this persists in dev, run <code>npm run runtime:tailscale</code>.</div>
                  )}
                  {runtimeOnline && !appOwnedRuntime && (
                    <div className="ob-warn">Port 8737 is occupied by a non-packaged runtime. Fine for dev, but odd for a packaged install.</div>
                  )}
                  {runtimeOnline && (
                    <div className={openClawReady ? "ob-ok" : "ob-warn"}>
                      {openClawConnected
                        ? hasOpenClawActivity
                          ? "OpenClaw is connected and activity is flowing."
                          : "OpenClaw is connected. Waiting for first visible activity."
                        : "Runtime is online, but OpenClaw has not connected yet."}
                    </div>
                  )}
                </div>

                <div className="ob-card ob-card--tight">
                  <div className="ob-card-head">
                    <h2>Quick actions</h2>
                  </div>
                  <div className="ob-actions ob-actions--stacked">
                    <button className="ob-primary ob-primary--pair" disabled={!runtimeOnline || busy} onClick={() => void startPairMode()}>
                      {busy ? "Opening…" : openClawReady ? "Repair connection" : "Show pair code"}
                    </button>
                    {pair.active && (
                      <button className="ob-secondary" disabled={busy} onClick={() => void cancelPairMode()}>
                        Cancel pair code
                      </button>
                    )}
                  </div>
                  <p className="ob-muted ob-muted--small">
                    Close the window anytime. Clawpet stays alive in the tray.
                  </p>
                </div>
              </div>
            </div>
          )}

          {tab === "pair" && (
            <div className="ob-tab-panel">
              <div className="ob-card ob-card--tight">
                <div className="ob-card-head">
                  <h2>Pair with OpenClaw</h2>
                  {pair.active && expiresIn !== null ? <span className="ob-timer">{expiresIn}s</span> : null}
                </div>
                {openClawReady && !pair.active && !pair.code && (
                  <div className="ob-ok">Already connected. Re-pair only if the pet is yellow, silent, or token state was reset.</div>
                )}
                <div className="ob-codebox">
                  <span>Pair code</span>
                  <strong>{groupedCode}</strong>
                  <small>{pair.active ? "Use this on the OpenClaw host" : "Generate only when needed"}</small>
                </div>
                <div className="ob-command">
                  <code>{openClawCommand}</code>
                  <CopyButton text={openClawCommand} />
                </div>
                <div className="ob-help ob-help--compact">
                  <strong>Use pairing when:</strong>
                  <ul>
                    <li>this is first-time setup,</li>
                    <li>the pet is yellow and not reacting,</li>
                    <li>you cleared or rotated tokens.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {tab === "details" && (
            <div className="ob-tab-panel">
              <div className="ob-diagnostics ob-diagnostics--compact" aria-label="Current avatar diagnostics">
                <MiniStat label="Avatar id" value={runtimeAvatarId} />
                <MiniStat label="Bundle version" value={runtimeBundleVersion} />
                <MiniStat label="Bundle states" value={runtimeBundleStateCount || "none"} />
                <MiniStat label="Bubble" value={avatarBubble} />
                <MiniStat label="Display host" value={displayHost} />
                <MiniStat label="Last event" value={lastEventAge ?? "none yet"} />
              </div>
              {!bundleManifest && (
                <div className="ob-warn">
                  No runtime avatar bundle is stored yet. If the pet still shows an old avatar, you may be seeing a local fallback instead of a pushed bundle.
                </div>
              )}
              <div className="ob-card ob-card--tight ob-checklist">
                <h2>What OpenClaw handles</h2>
                <ul className="ob-list">
                  <li>Claims the pair code from the OpenClaw host.</li>
                  <li>Saves the runtime token on both sides.</li>
                  <li>Starts the zero-token daemon.</li>
                  <li>Pushes avatar assets and config to the runtime.</li>
                </ul>
              </div>
            </div>
          )}

          {runtimeError && <p className="ob-error">{runtimeError}</p>}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OnboardApp />
  </React.StrictMode>,
);
