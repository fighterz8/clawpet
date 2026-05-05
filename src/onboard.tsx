import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

type PairMode = { active: boolean; code?: string; expiresAt?: number; runtimeUrl?: string };
type ClawpetStatus = { connected?: boolean; lastEventAt?: string | null; avatar?: { state?: string; bubble?: string; avatarId?: string; bundleVersion?: string } };
type BundleManifest = { name?: string; version?: string; states?: Record<string, unknown> };

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(typeof body === "object" && body && "errors" in body ? String((body as { errors: unknown }).errors) : `HTTP ${res.status}`);
  return body;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="ob-copy" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy"}</button>;
}

async function hideSetupWindow() {
  try {
    await getCurrentWindow().hide();
  } catch {
    // Browser/dev fallback: avoid window.close(), which can blank the webview.
    document.body.classList.add("ob-hidden");
  }
}

function OnboardApp() {
  const [health, setHealth] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pair, setPair] = useState<PairMode>({ active: false });
  const [status, setStatus] = useState<ClawpetStatus | null>(null);
  const [bundleManifest, setBundleManifest] = useState<BundleManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    try {
      const h = await fetchJson(`${RUNTIME_URL}/health`) as RuntimeStatus;
      setHealth(h);
      setRuntimeError(null);
      try {
        const p = await fetchJson(`${RUNTIME_URL}/pair-mode`) as PairMode;
        setPair((prev) => ({ ...p, code: p.code ?? (p.active ? prev.code : undefined) }));
      } catch { /* ignore */ }
      try {
        const s = await fetchJson(`${RUNTIME_URL}/status`) as ClawpetStatus;
        setStatus(s);
      } catch { /* ignore */ }
      try {
        const m = await fetchJson(`${RUNTIME_URL}/avatar-bundle/current/avatar.json`) as BundleManifest;
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
      const p = await fetchJson(`${RUNTIME_URL}/admin/pair-mode/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: 120 }),
      }) as { code: string; expiresAt: number };
      setPair({ active: true, code: p.code, expiresAt: p.expiresAt });
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
  const openClawCommand = pair.code ? `clawpet wizard openclaw --code ${pair.code} --host ${hostArg}` : `clawpet wizard openclaw --code <code> --host ${hostArg}`;
  const runtimeOnline = Boolean(health?.ok);
  const appOwnedRuntime = health?.runtime === "tauri-internal" || health?.owner === "clawpet-desktop-app";
  const runtimeOwnerLabel = health?.runtime === "tauri-internal" ? "desktop app runtime" : health?.runtime === "node-dev" ? "external dev runtime" : health?.runtime ?? "unknown runtime";
  const openClawConnected = Boolean(status?.connected);
  const hasOpenClawActivity = Boolean(status?.lastEventAt);
  const openClawReady = openClawConnected || hasOpenClawActivity;
  const expiresIn = useMemo(() => pair.expiresAt ? Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)) : null, [pair.expiresAt, pair.active]);
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

  return (
    <main className="ob-shell">
      <section className="ob-card ob-hero">
        <div className="ob-mark">🐲</div>
        <div>
          <p className="ob-eyebrow">Clawpet setup</p>
          <h1>A tiny desktop pet for OpenClaw.</h1>
          <p className="ob-muted">The app starts the local runtime, shows connection status, gives OpenClaw a pair code when needed, and then gets out of the way.</p>
        </div>
      </section>

      <section className="ob-card">
        <div className="ob-row">
          <div>
            <h2>1. Runtime</h2>
            <p className="ob-muted">The local runtime powers the pet, reconnect, and pairing.</p>
          </div>
          <span className={`ob-pill ${runtimeOnline ? "ob-pill--ok" : "ob-pill--bad"}`}>{runtimeOnline ? "online" : "offline"}</span>
        </div>
        {runtimeOnline && <p className="ob-muted">Owner: <strong>{runtimeOwnerLabel}</strong></p>}
        {!runtimeOnline && <div className="ob-warn">Runtime is not reachable yet. In dev builds the app tries to start it automatically; if this stays offline, run <code>npm run runtime:tailscale</code> as a fallback.</div>}
        {runtimeOnline && !appOwnedRuntime && <div className="ob-warn">A runtime is already using port 8737, but it is not the packaged desktop-app runtime. This is okay for development, but packaged installs should show <strong>desktop app runtime</strong>. Quit stale dev runtimes if setup behaves strangely.</div>}
        {runtimeOnline && <div className={openClawReady ? "ob-ok" : "ob-warn"}>{openClawConnected ? (hasOpenClawActivity ? "OpenClaw is connected and has sent activity. You can close setup and leave the pet running." : "OpenClaw is connected. Waiting for the first avatar activity, but setup is complete if the indicator is green.") : "Runtime is online, but OpenClaw has not connected yet. Show a pair code if the pet is not responding."}</div>}
        {runtimeOnline && (
          <>
            <div className="ob-actions">
              <button className="ob-secondary" disabled={refreshing} onClick={() => void refreshNow()}>{refreshing ? "Refreshing…" : "Refresh avatar / status"}</button>
            </div>
            <div className="ob-diagnostics ob-diagnostics--wide" aria-label="Current avatar diagnostics">
              <div><span>Avatar state</span><strong>{avatarState}</strong></div>
              <div><span>Avatar id</span><strong>{runtimeAvatarId}</strong></div>
              <div><span>Bundle version</span><strong>{runtimeBundleVersion}</strong></div>
              <div><span>Bundle states</span><strong>{runtimeBundleStateCount || "none"}</strong></div>
              <div><span>Bubble</span><strong>{avatarBubble}</strong></div>
              <div><span>Last event</span><strong>{lastEventAge ?? "none yet"}</strong></div>
            </div>
            {!bundleManifest && <div className="ob-warn">No runtime avatar bundle is currently stored on the runtime. If the pet is still showing an old avatar, you are likely seeing a local/dev fallback rather than a successfully pushed bundle.</div>}
          </>
        )}
        {runtimeError && <p className="ob-error">{runtimeError}</p>}
      </section>

      {openClawReady && (
        <section className="ob-card ob-complete">
          <div>
            <h2>Connected — setup complete</h2>
            <p className="ob-muted">The pet is ready. You do not need another pair code — just start chatting with OpenClaw. Closing setup keeps Clawpet running in the tray.</p>
          </div>
          <button className="ob-primary" onClick={() => void hideSetupWindow()}>Close setup</button>
        </section>
      )}

      <section className="ob-card">
        <div className="ob-row">
          <div>
            <h2>2. Pair with OpenClaw</h2>
            <p className="ob-muted">Only use this if the pet is yellow/not responding or this is the first connection. If the indicator is green, setup is complete even if no chat activity has arrived yet.</p>
          </div>
          <div className="ob-button-row">
            <button className="ob-primary ob-primary--pair" disabled={!runtimeOnline || busy} onClick={() => void startPairMode()}>{busy ? "Opening…" : openClawReady ? "Repair connection" : "Show pair code"}</button>
            {pair.active && <button className="ob-secondary" disabled={busy} onClick={() => void cancelPairMode()}>Cancel</button>}
          </div>
        </div>
        {openClawReady && !pair.active && !pair.code && <div className="ob-ok">Already connected — no pair code needed. Use this section only to repair a stale/yellow connection, after clearing tokens, or when avatar sync looks stuck.</div>}
        <div className="ob-codebox">
          <span>Pair code</span>
          <strong>{groupedCode}</strong>
          {expiresIn !== null && <small>{expiresIn}s left</small>}
        </div>
        <div className="ob-command">
          <code>{openClawCommand}</code>
          <CopyButton text={openClawCommand} />
        </div>
        <div className="ob-help">
          <strong>When should I do this?</strong>
          <ul>
            <li>First-time setup on this desktop.</li>
            <li>The indicator is yellow and chat does not move the avatar.</li>
            <li>You rotated/cleared tokens or rebuilt app data.</li>
          </ul>
          <p>If the indicator is green, do not re-pair — just close setup and chat. Last event updates after OpenClaw sends avatar activity.</p>
        </div>
      </section>

      <section className="ob-card">
        <h2>3. What OpenClaw does</h2>
        <ul className="ob-list">
          <li>Claims the pair code from the OpenClaw host.</li>
          <li>Saves the runtime token on both sides so reopening Clawpet reconnects automatically.</li>
          <li>Starts the zero-token daemon.</li>
          <li>Pushes avatar assets/config over the paired connection.</li>
          <li>The setup diagnostics above should show the runtime's current avatar id and bundle version after a successful push.</li>
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><OnboardApp /></React.StrictMode>);
