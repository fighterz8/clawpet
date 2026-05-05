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
};

type PairMode = { active: boolean; code?: string; expiresAt?: number; runtimeUrl?: string };
type ClawpetStatus = { connected?: boolean; lastEventAt?: string | null; avatar?: { state?: string; bubble?: string; avatarId?: string; bundleVersion?: string } };

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
  const [busy, setBusy] = useState(false);

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

  const groupedCode = pair.code ? `${pair.code.slice(0, 3)} · ${pair.code.slice(3)}` : "—";
  const openClawCommand = pair.code ? `clawpet wizard openclaw --code ${pair.code} --host <this-display-machine>:8737` : "clawpet wizard openclaw --code <code> --host <display-host>:8737";
  const runtimeOnline = Boolean(health?.ok);
  const appOwnedRuntime = health?.runtime === "tauri-internal" || health?.owner === "clawpet-desktop-app";
  const runtimeOwnerLabel = health?.runtime === "tauri-internal" ? "desktop app runtime" : health?.runtime === "node-dev" ? "external dev runtime" : health?.runtime ?? "unknown runtime";
  const openClawReady = Boolean(status?.lastEventAt);
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
        {runtimeOnline && <div className={openClawReady ? "ob-ok" : "ob-warn"}>{openClawReady ? "OpenClaw has authenticated with this runtime. You can close setup and leave the pet running." : "Runtime is online, but OpenClaw has not authenticated yet. Show a pair code if the pet is not responding."}</div>}
        {runtimeOnline && (
          <div className="ob-diagnostics" aria-label="Current avatar diagnostics">
            <div><span>Avatar</span><strong>{avatarState}</strong></div>
            <div><span>Bubble</span><strong>{avatarBubble}</strong></div>
            <div><span>Last event</span><strong>{lastEventAge ?? "none yet"}</strong></div>
          </div>
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
            <p className="ob-muted">Only use this if the pet is yellow/not responding or this is the first connection. If you have paired before, start chatting first — OpenClaw should reconnect automatically.</p>
          </div>
          <button className="ob-primary" disabled={!runtimeOnline || busy} onClick={() => void startPairMode()}>{busy ? "Opening…" : "Show pair code"}</button>
        </div>
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
          <p>If the indicator is green and Last event is recent, do not re-pair — just close setup and chat.</p>
        </div>
      </section>

      <section className="ob-card">
        <h2>3. What OpenClaw does</h2>
        <ul className="ob-list">
          <li>Claims the pair code from the OpenClaw host.</li>
          <li>Saves the runtime token on both sides so reopening Clawpet reconnects automatically.</li>
          <li>Starts the zero-token daemon.</li>
          <li>Pushes avatar assets/config over the paired connection.</li>
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><OnboardApp /></React.StrictMode>);
