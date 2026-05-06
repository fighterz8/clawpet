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
  pairedOpenClaw?: {
    instanceId?: string;
    displayName?: string;
  };
};

type BundleManifest = { name?: string; version?: string; states?: Record<string, unknown> };
type AvatarState = "idle" | "thinking" | "focused" | "happy" | "alert" | "sleepy";
type RuntimeEventEntry = {
  event: {
    eventId: string;
    sentAt: string;
    state: AvatarState;
    message?: string;
    bubble?: string;
    source?: { displayName?: string; instanceId?: string };
  };
  receivedAt: string;
  latencyMs: number | null;
};

type ReactivitySettings = {
  available: boolean;
  activityLegacy?: string | null;
  daemonVoice?: string | null;
  daemonVoiceLevels?: string[];
  expressionLevel?: string | null;
  expressionLevels?: string[];
  heartbeatReactions?: boolean | null;
  activityLevels?: string[];
  writable?: boolean;
  managedBy?: string | null;
  error?: string | null;
};

type TabKey = "status" | "pairing" | "activity" | "settings";

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      typeof body === "object" && body && "errors" in body
        ? String((body as { errors: unknown }).errors)
        : `HTTP ${res.status}`,
    );
  }
  return body;
}

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={disabled ? "clp-copy clp-copy--disabled" : "clp-copy"}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function PixelMark() {
  return (
    <svg viewBox="0 0 16 14" shapeRendering="crispEdges" width="100%" height="100%" aria-hidden="true">
      <rect x="4" y="0" width="1" height="2" fill="#7A1F0E" />
      <rect x="11" y="0" width="1" height="2" fill="#7A1F0E" />
      <rect x="3" y="2" width="10" height="1" fill="#E76F51" />
      <rect x="2" y="3" width="12" height="6" fill="#E76F51" />
      <rect x="3" y="9" width="10" height="1" fill="#E76F51" />
      <rect x="4" y="10" width="8" height="1" fill="#E76F51" />
      <rect x="5" y="11" width="6" height="1" fill="#E76F51" />
      <rect x="4" y="3" width="2" height="1" fill="#F4A261" />
      <rect x="10" y="3" width="2" height="1" fill="#F4A261" />
      <rect x="6" y="6" width="4" height="3" fill="#FCE5D6" />
      <rect x="5" y="4" width="1" height="2" fill="#FFFFFF" />
      <rect x="10" y="4" width="1" height="2" fill="#FFFFFF" />
      <rect x="5" y="5" width="1" height="1" fill="#1A0A05" />
      <rect x="10" y="5" width="1" height="1" fill="#1A0A05" />
    </svg>
  );
}

function formatClock(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatAge(value?: string | null) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / (60 * 60_000))}h`;
}

function summarizeEvent(entry: RuntimeEventEntry) {
  const bubble = entry.event.bubble?.trim();
  const message = entry.event.message?.trim();
  if (bubble) return bubble;
  if (message) return message;
  return `state → ${entry.event.state}`;
}

function eventOrigin(entry: RuntimeEventEntry) {
  const display = entry.event.source?.displayName?.toLowerCase() ?? "";
  const instance = entry.event.source?.instanceId?.toLowerCase() ?? "";
  const source = `${display} ${instance}`;

  // Activity log taxonomy:
  // - system signal: zero-token local/daemon plumbing and work telemetry.
  // - OpenClaw expression: optional autonomous/contextual expression layer.
  // - user-requested: explicit routines or one-off manual emits requested by Nick.
  // Only the new explicit routine marker counts as user-requested. Older
  // direct/manual/test metadata such as `clawpet-user-requested-manual` was
  // too broad and should display as system signal.
  if (instance === "clawpet-user-requested" || display === "user-requested") return "user-requested";
  if (source.includes("daemon") || source.includes("jsonl") || source.includes("manual") || source.includes("direct")) return "system signal";
  if (source.includes("expression")) return "OpenClaw expression";
  if (source.includes("openclaw")) return "OpenClaw expression";
  return "system signal";
}

function eventMeta(entry: RuntimeEventEntry) {
  const state = entry.event.state;
  return `${state} · ${eventOrigin(entry)}`;
}

function App() {
  const [health, setHealth] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pair, setPair] = useState<PairMode>({ active: false });
  const [status, setStatus] = useState<ClawpetStatus | null>(null);
  const [events, setEvents] = useState<RuntimeEventEntry[]>([]);
  const [bundleManifest, setBundleManifest] = useState<BundleManifest | null>(null);
  const [reactivity, setReactivity] = useState<ReactivitySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("status");

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
        const e = (await fetchJson(`${RUNTIME_URL}/events`)) as { events: RuntimeEventEntry[] };
        setEvents(Array.isArray(e.events) ? e.events.slice(0, 8) : []);
      } catch {
        setEvents([]);
      }
      try {
        const m = (await fetchJson(`${RUNTIME_URL}/avatar-bundle/current/avatar.json`)) as BundleManifest;
        setBundleManifest(m);
      } catch {
        setBundleManifest(null);
      }
      try {
        const r = (await fetchJson(`${RUNTIME_URL}/reactivity`)) as ReactivitySettings;
        setReactivity(r);
      } catch (e) {
        setReactivity({
          available: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (e) {
      setHealth(null);
      setStatus(null);
      setEvents([]);
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
      setTab("pairing");
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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

  async function refreshNow() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      window.setTimeout(() => setRefreshing(false), 250);
    }
  }

  const runtimeOnline = Boolean(health?.ok);
  const openClawConnected = Boolean(status?.connected);
  const hasOpenClawActivity = Boolean(status?.lastEventAt);
  const openClawReady = hasOpenClawActivity;
  const displayHost = health?.displayHost || "display-host";
  const hostArg = displayHost.includes(":") ? displayHost : `${displayHost}:8737`;
  const avatarId = status?.avatar?.avatarId ?? bundleManifest?.name ?? "unknown";
  const avatarState = (status?.avatar?.state as AvatarState | undefined) ?? "idle";
  const bundleVersion = status?.avatar?.bundleVersion ?? bundleManifest?.version ?? "—";
  const runtimeLabel =
    health?.runtime === "tauri-internal"
      ? "desktop"
      : health?.runtime === "node-dev"
        ? "dev runtime"
        : health?.runtime ?? "runtime";
  const groupedCode = pair.code ? `${pair.code.slice(0, 3)}   ${pair.code.slice(3)}` : "— — —   — — —";
  const openClawCommand = pair.code
    ? `clawpet wizard openclaw --code ${pair.code} --host ${hostArg}`
    : `clawpet wizard openclaw --code <code> --host ${hostArg}`;
  const expiresIn = pair.expiresAt ? Math.max(0, Math.round((pair.expiresAt - Date.now()) / 1000)) : null;
  const lastEventAge = formatAge(status?.lastEventAt ?? null);
  const chipLabel = openClawReady
    ? `ACTIVE · ${lastEventAge?.toUpperCase() ?? "LIVE"}`
    : openClawConnected
      ? "PAIRED · WAITING"
      : runtimeOnline
        ? "WAITING"
        : "OFFLINE";
  const heartbeatModeClass = openClawReady ? "clp-ekg clp-ekg--live" : "clp-ekg clp-ekg--flat";
  const activityBadge = "source labels are user-facing truth";

  return (
    <main className="clp-shell">
      <section className="clp">
        <div className="clp-h">
          <div className="clp-mark">
            <PixelMark />
          </div>
          <div>
            <div className="clp-brand">
              <span className="clp-name">clawpet</span>
              <span className="clp-ver">v0.2.0</span>
            </div>
            <div className="clp-sub">VALIDATION CONSOLE FOR OPENCLAW</div>
          </div>
          <div className={openClawReady ? "clp-chip" : "clp-chip clp-chip--warn"}>
            <span className="clp-pulse" />
            <span>{chipLabel}</span>
          </div>
          <button className="clp-icon" disabled={refreshing} onClick={() => void refreshNow()} aria-label="Refresh">
            ↻
          </button>
        </div>

        <div className="clp-tabs">
          <button className={tab === "status" ? "clp-tab active" : "clp-tab"} onClick={() => setTab("status")}>
            Status
          </button>
          <button className={tab === "pairing" ? "clp-tab active" : "clp-tab"} onClick={() => setTab("pairing")}>
            Pairing
          </button>
          <button className={tab === "activity" ? "clp-tab active" : "clp-tab"} onClick={() => setTab("activity")}>
            Activity Log
          </button>
          <button className={tab === "settings" ? "clp-tab active" : "clp-tab"} onClick={() => setTab("settings")}>
            Settings
          </button>
        </div>

        <div className="clp-body2">
          {tab === "status" && (
            <>
              <div className="clp-tele">
                <div className="clp-tcell">
                  <div className="clp-tl">Avatar</div>
                  <div className="clp-tv">{avatarId}</div>
                  <div className="clp-tx">bundle · {bundleVersion}</div>
                </div>
                <div className="clp-tcell s">
                  <div className="clp-tl">State</div>
                  <div className="clp-tv"><span className="clp-sdot" />{avatarState}</div>
                  <div className="clp-tx">updated {formatClock(status?.lastEventAt ?? null)}</div>
                </div>
                <div className="clp-tcell">
                  <div className="clp-tl">Display host</div>
                  <div className="clp-tv">{displayHost}</div>
                  <div className="clp-tx">pair target · trusted</div>
                </div>
                <div className="clp-tcell">
                  <div className="clp-tl">Runtime</div>
                  <div className="clp-tv">{runtimeLabel}</div>
                  <div className="clp-tx">{events.length} recent events buffered</div>
                </div>
              </div>

              <div className="clp-grid clp-grid--status">
                <div className="clp-card clp-card--summary">
                  <div className="clp-cardh">
                    <span>Health summary</span>
                    <span className="clp-cardm">reactivity wired</span>
                  </div>
                  <div className="clp-summary-list">
                    <div className="clp-summary-row">
                      <span className="clp-summary-k">Runtime</span>
                      <strong className={runtimeOnline ? "clp-summary-v ok" : "clp-summary-v warn"}>{runtimeOnline ? "online" : "offline"}</strong>
                    </div>
                    <div className="clp-summary-row">
                      <span className="clp-summary-k">OpenClaw</span>
                      <strong className={openClawReady ? "clp-summary-v ok" : "clp-summary-v warn"}>{openClawReady ? "linked" : "waiting"}</strong>
                    </div>
                    <div className="clp-summary-row">
                      <span className="clp-summary-k">Last event</span>
                      <strong className={lastEventAge ? "clp-summary-v ok" : "clp-summary-v muted"}>{lastEventAge ?? "none"}</strong>
                    </div>
                    <div className="clp-summary-row">
                      <span className="clp-summary-k">Pairing</span>
                      <strong className={pair.active ? "clp-summary-v ok" : "clp-summary-v muted"}>{pair.active && expiresIn !== null ? `window open · ${expiresIn}s` : "available in Pairing tab"}</strong>
                    </div>
                  </div>
                  <div className="clp-mini-note">Live avatar remains the only preview for now.</div>
                  {runtimeError && <div className="clp-error-inline">{runtimeError}</div>}
                </div>
              </div>
            </>
          )}

          {tab === "pairing" && (
            <div className="clp-card clp-card--pairing-page">
              <div className="clp-cardh">
                <span>Pairing</span>
                <span className="clp-cardm">OpenClaw host authorization</span>
              </div>
              <div className="clp-pair-display">
                <div className="clp-pair-left">
                  <div className={pair.active ? "clp-pair-digits clp-pair-digits--live" : "clp-pair-digits"}>{groupedCode}</div>
                  <div className="clp-pair-help">
                    {pair.active
                      ? "Pair window is open now. Run the command below on the OpenClaw host."
                      : "No active pair window. "}
                    {!pair.active && <b>Generate</b>} {!pair.active ? "to authorize a new OpenClaw machine." : null}
                  </div>
                </div>
                <div className="clp-pair-actions">
                  <button className="clp-gen-btn" disabled={busy} onClick={() => void startPairMode()}>
                    {busy ? "Opening…" : pair.active ? "Regenerate" : "Generate"}
                  </button>
                  {pair.active && (
                    <button className="clp-copy clp-copy--ghost" disabled={busy} onClick={() => void cancelPairMode()}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              <div className="clp-summary-list clp-summary-list--pairing">
                <div className="clp-summary-row">
                  <span className="clp-summary-k">Display host</span>
                  <strong className="clp-summary-v">{displayHost}</strong>
                </div>
                <div className="clp-summary-row">
                  <span className="clp-summary-k">Host argument</span>
                  <strong className="clp-summary-v">{hostArg}</strong>
                </div>
              </div>
              <div className="clp-cmd-row clp-cmd-row--stack">
                <div className="clp-cmd">$ clawpet wizard openclaw --code {pair.code ?? "<code>"} --host {hostArg}</div>
                <CopyButton text={openClawCommand} disabled={!pair.code} />
              </div>
              <div className="clp-cmd-help">Sends the bearer token back over the same connection. Pair window auto-closes on success.</div>
            </div>
          )}

          {tab === "activity" && (
            <div className="clp-card clp-card--activity-page">
              <div className="clp-cardh">
                <span>Activity log</span>
                <span className="clp-cardm"><span className="clp-cardm-d" />{activityBadge}</span>
              </div>
              <div className="clp-feed clp-feed--log clp-feed--page">
                {events.length > 0 ? (
                  events.map((entry) => (
                    <div className="clp-ev" key={entry.event.eventId}>
                      <span className={`clp-edot s-${entry.event.state}`} />
                      <span className="clp-et">{formatClock(entry.receivedAt)}</span>
                      <span className="clp-em">{summarizeEvent(entry)}</span>
                      <span className="clp-ed">{eventMeta(entry)}</span>
                    </div>
                  ))
                ) : (
                  <div className="clp-empty-log">No events yet. By default this log shows system signal. OpenClaw expression appears only when expression level is enabled; user-requested appears only for routines or emits Nick explicitly asked for.</div>
                )}
              </div>
              <div className="clp-source-legend" aria-label="Activity log source definitions">
                <div><strong>system signal</strong><span>Default zero-token OpenClaw/Clawpet work telemetry. Replaces daemon/runtime labels in the visible log.</span></div>
                <div><strong>OpenClaw expression</strong><span>Optional autonomous/contextual avatar remarks controlled by expression level.</span></div>
                <div><strong>user-requested</strong><span>Explicit manual emits or routines Nick asked Dawn to perform.</span></div>
                <div><strong>rule of thumb</strong><span>The log should mostly be system signal unless expression is enabled or Nick explicitly asks for a routine.</span></div>
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div className="clp-card clp-card--settings-page">
              <div className="clp-cardh">
                <span>Settings</span>
                <span className="clp-cardm">OpenClaw-managed</span>
              </div>
              <div className="clp-summary-list clp-summary-list--settings">
                <div className="clp-summary-row">
                  <span className="clp-summary-k">Daemon voice</span>
                  <strong className={reactivity?.available ? "clp-summary-v ok" : "clp-summary-v muted"}>{reactivity?.available ? reactivity.daemonVoice ?? "lite" : "waiting"}</strong>
                </div>
                <div className="clp-summary-row">
                  <span className="clp-summary-k">Expression</span>
                  <strong className={reactivity?.expressionLevel === "off" ? "clp-summary-v muted" : "clp-summary-v ok"}>{reactivity?.available ? reactivity.expressionLevel ?? "off" : "waiting"}</strong>
                </div>
              </div>
              <div className="clp-reactivity-panel clp-reactivity-panel--page">
                <span className="clp-reactivity-k">Daemon voice</span>
                <div className="clp-react-track">
                  {(reactivity?.daemonVoiceLevels?.length ? reactivity.daemonVoiceLevels : ["silent", "lite", "vivid"]).map((level) => (
                    <div
                      key={level}
                      className={reactivity?.daemonVoice === level ? "clp-rstep active" : "clp-rstep"}
                      aria-disabled="true"
                      title="Managed by the paired OpenClaw host"
                    >
                      {level}
                    </div>
                  ))}
                </div>
                <span className="clp-reactivity-k">Expression level</span>
                <div className="clp-react-track clp-react-track--expression">
                  {(reactivity?.expressionLevels?.length ? reactivity.expressionLevels : ["off", "low", "medium", "high"]).map((level) => (
                    <div
                      key={level}
                      className={reactivity?.expressionLevel === level ? "clp-rstep active" : "clp-rstep"}
                      aria-disabled="true"
                      title="Managed by the paired OpenClaw host"
                    >
                      {level}
                    </div>
                  ))}
                </div>
                <div className="clp-rrow">
                  <span>expression behavior</span>
                  <span className="clp-rrow-x">
                    {reactivity?.expressionLevel === "off"
                      ? "silent"
                      : reactivity?.expressionLevel === "low"
                        ? "state only"
                        : reactivity?.expressionLevel === "medium"
                          ? "distinct preset"
                          : "contextual"}
                  </span>
                </div>
                <div className="clp-rrow">
                  <span className={reactivity?.heartbeatReactions ? "clp-tg on" : "clp-tg"}><span className="clp-tg-p" /></span>
                  <span>heartbeat reactions</span>
                  <span className="clp-rrow-x">{reactivity?.heartbeatReactions ? "on" : "off"}</span>
                </div>
                <div className="clp-reactivity-note">
                  Managed by paired OpenClaw host{reactivity?.managedBy ? ` · ${reactivity.managedBy}` : ""}. Legacy activity is hidden; system signal + expression level are the source of truth.
                </div>
                {reactivity?.error ? <div className="clp-error-inline">{reactivity.error}</div> : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
