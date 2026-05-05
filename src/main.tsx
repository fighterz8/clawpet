import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Make the html/body transparent immediately when running as the desktop overlay,
// so the Tauri window can show through before React paints anything.
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("overlay") === "1") {
  document.documentElement.classList.add("clawpet-overlay");
  document.body.classList.add("clawpet-overlay");
}

import { AVATAR_EVENT_VERSION, avatarStates, resolveBubbleText, type AvatarState, type AvatarStateEvent, type ClawpetStatus } from "./contracts/avatarEvent";
import { loadAvatarBundle, type ResolvedAvatarBundle } from "./avatars/bundle";

const DEFAULT_AVATAR_BUNDLE_URL = "/avatars/dawn-v0";

function BundleAvatar({ state, bundle }: { state: AvatarState; bundle: ResolvedAvatarBundle | null }) {
  if (!bundle) {
    return <div className="bundle-avatar bundle-avatar--loading" aria-label="Loading avatar" />;
  }
  const { src, animation } = bundle.resolveAsset(state);
  return (
    <img
      src={src}
      alt={`Clawpet ${state}`}
      className={`bundle-avatar bundle-avatar--anim-${animation}`}
      draggable={false}
    />
  );
}

function useAvatarBundle(url: string = DEFAULT_AVATAR_BUNDLE_URL) {
  const [bundle, setBundle] = useState<ResolvedAvatarBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadAvatarBundle(url)
      .then((resolved) => { if (!cancelled) setBundle(resolved); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [url]);
  return { bundle, error };
}

type PetState = AvatarState;

type RuntimeEventLogEntry = {
  event: AvatarStateEvent;
  receivedAt: string;
  latencyMs: number | null;
};

const RUNTIME_URL = "http://127.0.0.1:8737";

const stateCopy: Record<PetState, { label: string; message: string; api: string }> = {
  idle: {
    label: "Idle",
    message: "OpenClaw is available.",
    api: '{ "state": "idle", "message": "OpenClaw is available." }',
  },
  thinking: {
    label: "Thinking",
    message: "Dawn is working through a task…",
    api: '{ "state": "thinking", "message": "Inspecting the repo…" }',
  },
  focused: {
    label: "Focused",
    message: "Long-running work is in progress.",
    api: '{ "state": "focused", "message": "Building the demo packet." }',
  },
  happy: {
    label: "Happy",
    message: "Task completed successfully.",
    api: '{ "state": "happy", "message": "Deploy finished." }',
  },
  alert: {
    label: "Alert",
    message: "Something needs attention.",
    api: '{ "state": "alert", "message": "OAuth approval needed." }',
  },
  sleepy: {
    label: "Sleepy",
    message: "Quiet hours / low activity.",
    api: '{ "state": "sleepy", "message": "Quiet mode." }',
  },
};

const states = [...avatarStates];

function ClawpetAvatar({ state }: { state: PetState }) {
  const face = useMemo(() => {
    if (state === "happy") return "ᵔᴥᵔ";
    if (state === "alert") return "•̀ᴥ•́";
    if (state === "sleepy") return "-ᴥ-";
    if (state === "focused") return "•ᴥ•";
    if (state === "thinking") return "◔ᴥ◔";
    return "•ᴥ•";
  }, [state]);

  return (
    <div className={`avatar avatar--${state}`} aria-label={`Clawpet avatar state: ${state}`}>
      <div className="avatar__glow" />
      <div className="avatar__body">
        <div className="avatar__horn avatar__horn--left" />
        <div className="avatar__horn avatar__horn--right" />
        <div className="avatar__ears" />
        <div className="avatar__face">{face}</div>
        <div className="avatar__spark">✦</div>
      </div>
      <div className="avatar__tail" />
    </div>
  );
}

function buildBrowserEvent(state: PetState, message: string): AvatarStateEvent {
  return {
    type: "avatar.state",
    version: AVATAR_EVENT_VERSION,
    eventId: `evt_browser_${crypto.randomUUID()}`,
    sentAt: new Date().toISOString(),
    source: {
      kind: "openclaw",
      instanceId: "browser-console",
      displayName: "Clawpet local console",
    },
    target: {
      deviceId: "local-runtime",
      avatarId: "dawn-v0",
    },
    state,
    message,
    ttlMs: 8000,
    priority: state === "alert" ? "high" : "normal",
  };
}

function RuntimeConsole({ onPreviewState }: { onPreviewState: (state: PetState) => void }) {
  const [status, setStatus] = useState<ClawpetStatus | null>(null);
  const [events, setEvents] = useState<RuntimeEventLogEntry[]>([]);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [statusResponse, eventsResponse] = await Promise.all([
        fetch(`${RUNTIME_URL}/status`),
        fetch(`${RUNTIME_URL}/events`),
      ]);
      if (!statusResponse.ok) throw new Error(`status returned ${statusResponse.status}`);
      const nextStatus = await statusResponse.json() as ClawpetStatus;
      const eventBody = await eventsResponse.json() as { events?: RuntimeEventLogEntry[] };
      setStatus(nextStatus);
      setEvents(eventBody.events ?? []);
      setOnline(true);
      setLastError(null);
      onPreviewState(nextStatus.avatar.state);
    } catch (error) {
      setOnline(false);
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendState(nextState: PetState) {
    setLoading(true);
    setLastError(null);
    const message = stateCopy[nextState].message;
    try {
      const response = await fetch(`${RUNTIME_URL}/avatar/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBrowserEvent(nextState, message)),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(JSON.stringify(body));
      onPreviewState(nextState);
      await refresh();
    } catch (error) {
      setOnline(false);
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="console" id="console">
      <div className="console__header">
        <div>
          <p className="eyebrow">Local runtime console</p>
          <h2>Validate the avatar connection from your browser.</h2>
          <p>
            This panel talks to the local Clawpet runtime at <code>{RUNTIME_URL}</code>. Start it with <code>npm run runtime:dev</code>.
          </p>
        </div>
        <div className={`status-pill ${online ? "status-pill--online" : "status-pill--offline"}`}>
          {online ? "Runtime online" : "Runtime offline"}
        </div>
      </div>

      <div className="console__grid">
        <article className="console-card">
          <h3>Runtime status</h3>
          {status ? (
            <dl className="status-list">
              <div><dt>Mode</dt><dd>{status.mode}</dd></div>
              <div><dt>State</dt><dd>{status.avatar.state}</dd></div>
              <div><dt>Avatar</dt><dd>{status.avatar.avatarId}</dd></div>
              <div><dt>Source</dt><dd>{status.pairedOpenClaw?.displayName ?? "Not paired yet"}</dd></div>
              <div><dt>Latency</dt><dd>{status.latencyMs == null ? "—" : `${status.latencyMs}ms`}</dd></div>
            </dl>
          ) : (
            <p className="muted">No runtime status yet.</p>
          )}
          {lastError && <p className="error">{lastError}</p>}
        </article>

        <article className="console-card">
          <h3>Send test state</h3>
          <div className="state-grid state-grid--console">
            {states.map((s) => (
              <button key={s} disabled={loading} onClick={() => void sendState(s)}>
                {stateCopy[s].label}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={() => void refresh()}>Refresh status</button>
        </article>

        <article className="console-card console-card--events">
          <h3>Recent events</h3>
          {events.length === 0 ? (
            <p className="muted">No events yet. Send a test state to populate the log.</p>
          ) : (
            <ul className="event-log">
              {events.slice(0, 5).map((entry) => (
                <li key={entry.event.eventId}>
                  <strong>{entry.event.state}</strong>
                  <span>{entry.event.message}</span>
                  <small>{entry.latencyMs == null ? "latency —" : `${entry.latencyMs}ms`} · {new Date(entry.receivedAt).toLocaleTimeString()}</small>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

function OverlayApp() {
  const [state, setState] = useState<PetState>("idle");
  const [message, setMessage] = useState(stateCopy.idle.message);
  const [online, setOnline] = useState(false);
  const { bundle } = useAvatarBundle();

  useEffect(() => {
    async function refresh() {
      try {
        const [statusResponse, eventsResponse] = await Promise.all([
          fetch(`${RUNTIME_URL}/status`),
          fetch(`${RUNTIME_URL}/events`),
        ]);
        if (!statusResponse.ok) throw new Error(`status returned ${statusResponse.status}`);
        const nextStatus = await statusResponse.json() as ClawpetStatus;
        const eventBody = await eventsResponse.json().catch(() => ({ events: [] })) as { events?: RuntimeEventLogEntry[] };
        const latestEvent = eventBody.events?.[0]?.event;
        const bubbleText = latestEvent
          ? resolveBubbleText(latestEvent)
          : resolveBubbleText({ message: stateCopy[nextStatus.avatar.state].message });
        setState(nextStatus.avatar.state);
        setMessage(bubbleText);
        setOnline(true);
      } catch {
        setOnline(false);
      }
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main className="overlay-shell" data-tauri-drag-region>
      <div className={`overlay-floating ${online ? "overlay-floating--online" : "overlay-floating--offline"}`} data-tauri-drag-region>
        <BundleAvatar state={state} bundle={bundle} />
        {online && message && (
          <div className="overlay-floating__bubble">{message}</div>
        )}
        {!online && (
          <div className="overlay-floating__bubble overlay-floating__bubble--warn">Start npm run runtime:dev</div>
        )}
      </div>
    </main>
  );
}

function App() {
  const [state, setState] = useState<PetState>("idle");
  const current = stateCopy[state];
  const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";

  if (isOverlay) return <OverlayApp />;

  return (
    <main>
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">OpenClaw ambient avatar runtime</p>
          <h1>Clawpet gives your local AI assistant a visible presence.</h1>
          <p className="lede">
            A local-first companion overlay concept for OpenClaw: avatar bundles, state-driven emotions,
            lightweight animations, and short useful status messages.
          </p>
          <div className="hero__actions">
            <a href="#console">Local console</a>
            <a href="https://github.com/fighterz8/clawpet/blob/main/docs/avatar-event-contract.md">Event contract</a>
            <a href="https://github.com/fighterz8/clawpet">GitHub</a>
          </div>
        </div>
        <div className="pet-card">
          <div className="bubble">{current.message}</div>
          <ClawpetAvatar state={state} />
          <div className="state-grid">
            {states.map((s) => (
              <button key={s} className={s === state ? "active" : ""} onClick={() => setState(s)}>
                {stateCopy[s].label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <RuntimeConsole onPreviewState={setState} />

      <section className="panel-grid">
        <article className="panel">
          <h2>Why it exists</h2>
          <p>
            AI agents often run invisibly in chats, logs, and background jobs. Clawpet explores a lighter
            status layer: a small companion that shows when the agent is idle, working, blocked, or done.
          </p>
        </article>
        <article className="panel">
          <h2>How OpenClaw controls it</h2>
          <p>
            Local mode uses a localhost API. Remote mode pairs the desktop avatar with an OpenClaw host running on
            another machine through an authenticated connection.
          </p>
          <pre>{`POST /avatar/state\n${current.api}`}</pre>
        </article>
        <article className="panel">
          <h2>Avatar bundles</h2>
          <p>
            Characters are file-based bundles: assets plus an <code>avatar.json</code> manifest that maps states to
            images and animation presets.
          </p>
        </article>
      </section>

      <section className="architecture">
        <div>
          <p className="eyebrow">Remote-first architecture</p>
          <h2>Clawpet should live on the machine you actually use.</h2>
          <p>
            Many OpenClaw users host their assistant on a server or spare machine. Clawpet is designed so the
            desktop avatar can run on your main computer while OpenClaw runs somewhere else.
          </p>
        </div>
        <div className="flow" aria-label="Remote connection diagram">
          <div className="flow__node">OpenClaw host</div>
          <div className="flow__edge">HTTPS / WebSocket</div>
          <div className="flow__node flow__node--relay">Clawpet relay or direct tunnel</div>
          <div className="flow__edge">paired outbound connection</div>
          <div className="flow__node">Desktop avatar</div>
        </div>
      </section>

      <section className="roadmap">
        <h2>Runtime-first MVP path</h2>
        <ol>
          <li>Design docs and Vercel preview</li>
          <li>Avatar event contract and validation tests</li>
          <li>Local desktop overlay with avatar state rendering</li>
          <li>OpenClaw skill: install, pair, status, send-test, diagnose</li>
          <li>Remote pairing for OpenClaw hosts running on another machine</li>
          <li>Local dashboard for diagnostics and manual avatar adjustments</li>
          <li>Dawn avatar pack and public demo video</li>
        </ol>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
