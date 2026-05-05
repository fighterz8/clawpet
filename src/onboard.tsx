import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./onboard.css";

const RUNTIME_URL = "http://127.0.0.1:8737";

type RuntimeStatus = {
  ok: boolean;
  service?: string;
  authRequired?: boolean;
};

type PairMode = { active: boolean; code?: string; expiresAt?: number; runtimeUrl?: string };

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

function OnboardApp() {
  const [health, setHealth] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pair, setPair] = useState<PairMode>({ active: false });
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
    } catch (e) {
      setHealth(null);
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
  const expiresIn = useMemo(() => pair.expiresAt ? Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)) : null, [pair.expiresAt, pair.active]);

  return (
    <main className="ob-shell">
      <section className="ob-card ob-hero">
        <div className="ob-mark">🐲</div>
        <div>
          <p className="ob-eyebrow">Clawpet setup</p>
          <h1>A tiny desktop pet for OpenClaw.</h1>
          <p className="ob-muted">The app is becoming the installer: it starts the local runtime, shows connection status, gives OpenClaw a pair code, and keeps the command-line pieces out of the normal user path.</p>
        </div>
      </section>

      <section className="ob-card">
        <div className="ob-row">
          <div>
            <h2>1. Runtime</h2>
            <p className="ob-muted">The local runtime powers the pet and pairing.</p>
          </div>
          <span className={`ob-pill ${runtimeOnline ? "ob-pill--ok" : "ob-pill--bad"}`}>{runtimeOnline ? "online" : "offline"}</span>
        </div>
        {!runtimeOnline && <div className="ob-warn">Runtime is not reachable yet. In dev builds the app tries to start it automatically; if this stays offline, run <code>npm run runtime:tailscale</code> as a fallback.</div>}
        {runtimeError && <p className="ob-error">{runtimeError}</p>}
      </section>

      <section className="ob-card">
        <div className="ob-row">
          <div>
            <h2>2. Pair with OpenClaw</h2>
            <p className="ob-muted">Open pair mode, then send the code to your OpenClaw assistant.</p>
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
