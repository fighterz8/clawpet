import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type PetState = "idle" | "thinking" | "focused" | "happy" | "alert" | "sleepy";

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

const states = Object.keys(stateCopy) as PetState[];

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

function App() {
  const [state, setState] = useState<PetState>("idle");
  const current = stateCopy[state];

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
            <a href="https://github.com/fighterz8/clawpet/blob/main/docs/product-brief.md">Product brief</a>
            <a href="https://github.com/fighterz8/clawpet/blob/main/docs/avatar-bundle-spec.md">Bundle spec</a>
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
