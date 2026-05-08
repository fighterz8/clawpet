import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { type AvatarState } from "./contracts/avatarEvent";
import { loadAvatarBundle, type ResolvedAvatarBundle } from "./avatars/bundle";
import "./styles.css";
import "./landing.css";

type ScriptedBeat = { state: AvatarState; bubble: string; hold: number };

const GOLEM_DEMO: ScriptedBeat[] = [
  { state: "idle",     bubble: "",                                   hold: 1800 },
  { state: "thinking", bubble: "Reading your message…",              hold: 2400 },
  { state: "focused",  bubble: "Running the test cycle",            hold: 3000 },
  { state: "alert",    bubble: "Heads up — needs your approval",     hold: 2400 },
  { state: "happy",    bubble: "Done!",                              hold: 2400 },
  { state: "sleepy",   bubble: "Quiet hours… 💤",                    hold: 2600 },
];

const PRESET_SHOWCASE = [
  { avatarId: "cobalt-golem-v0", title: "Cobalt Golem", accent: "#3d63b8" },
  { avatarId: "dawn-v2-ember", title: "Dawn Ember", accent: "#ff8a5b" },
  { avatarId: "lantern-moth-v0", title: "Lantern Moth", accent: "#5fc8b5" },
];

const DOWNLOADS = {
  windows: {
    href: "https://github.com/fighterz8/clawpals/releases/latest",
    label: "Download Windows (.msi preferred)",
    artifact: "latest GitHub Release · prefer .msi, use .exe if needed",
  },
  macos: {
    href: "https://github.com/fighterz8/clawpals/releases/latest",
    label: "Download macOS (.dmg)",
    artifact: "latest GitHub Release",
  },
  linux: {
    href: "https://github.com/fighterz8/clawpals/releases/latest",
    label: "Download Linux (.AppImage/.deb/.rpm)",
    artifact: "latest GitHub Release",
  },
} as const;

function useScriptedDemo(beats: ScriptedBeat[]) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setI((n) => (n + 1) % beats.length), beats[i].hold);
    return () => window.clearTimeout(id);
  }, [i, beats]);
  return beats[i];
}

function useBundle(avatarId: string) {
  const [bundle, setBundle] = useState<ResolvedAvatarBundle | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadAvatarBundle(`/avatars/${avatarId}`).then(b => { if (!cancelled) setBundle(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [avatarId]);
  return bundle;
}

function DemoStage({ avatarId, beats, accent }: { avatarId: string; beats: ScriptedBeat[]; accent: string }) {
  const bundle = useBundle(avatarId);
  const beat = useScriptedDemo(beats);
  const [frameIndex, setFrameIndex] = useState(0);
  const frames = bundle?.resolveFrames(beat.state) ?? [];
  const activeFrame = frames[frameIndex] ?? frames[0] ?? bundle?.resolveAsset(beat.state);

  useEffect(() => {
    setFrameIndex(0);
  }, [avatarId, beat.state]);

  useEffect(() => {
    const frame = frames[frameIndex];
    if (!frame || frames.length <= 1) return;
    const id = window.setTimeout(() => {
      setFrameIndex((current) => {
        const next = current + 1;
        if (next < frames.length) return next;
        return frame.loop ? 0 : current;
      });
    }, (1000 / frame.fps) * 1.5);
    return () => window.clearTimeout(id);
  }, [frameIndex, frames]);

  return (
    <div className="lp-stage" style={{ ["--accent" as never]: accent }}>
      <div className="lp-stage__glow" />
      <div className="lp-stage__floor" />
      {activeFrame && <img src={activeFrame.src} alt={beat.state} className={`lp-stage__sprite lp-stage__sprite--${beat.state}`} />}
      <div className={`lp-stage__bubble ${beat.bubble ? "lp-stage__bubble--show" : ""}`}>{beat.bubble || "·"}</div>
      <div className="lp-stage__chip">{beat.state}</div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="lp-copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      <code>{text}</code>
      <span className="lp-copy__label">{copied ? "copied ✓" : label}</span>
    </button>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <div className="lp-scroll-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />;
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(false);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        const t = window.setTimeout(() => setVisible(true), delay);
        observer.disconnect();
        return () => window.clearTimeout(t);
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay, node, reduced]);

  return <div ref={setNode} className={`lp-reveal ${visible ? "lp-reveal--in" : ""}`}>{children}</div>;
}

function Landing() {
  const year = useMemo(() => new Date().getFullYear(), []);

  return (
    <div className="lp-root">
      <div className="lp-bg" aria-hidden />
      <ScrollProgress />

      <header className="lp-nav">
        <div className="lp-nav__brand">
          <span className="lp-nav__mark">🐲</span>
          <span>Clawpals</span>
        </div>
        <nav>
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href="#avatars">Avatars</a>
          <a href="https://github.com/fighterz8/clawpals" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </header>

      <section className="lp-hero">
        <Reveal>
          <p className="lp-eyebrow">An OpenClaw companion</p>
          <h1 className="lp-headline">
            Bring your agent to life<br/>
            <span className="lp-headline__accent">and watch it work.</span>
          </h1>
          <p className="lp-lede">
            A local-first desktop companion for OpenClaw — animated by what your agent is actually doing:
            thinking, working, blocked, done, or resting. Floats over your desktop, pairs over Tailscale, and now showcases the frame-based Cobalt Golem bundle alongside Dawn Ember and Lantern Moth.
          </p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn--primary" href="#install">Try it in 3 minutes</a>
            <a className="lp-btn lp-btn--ghost" href="https://github.com/fighterz8/clawpals" target="_blank" rel="noreferrer">View on GitHub</a>
          </div>
          <p className="lp-foot-hint">Local-first · Tailscale-first for cross-machine setups · MIT</p>
          <div className="lp-trust-strip" aria-label="Product principles">
            <span><strong>0-token</strong> daemon reactivity</span>
            <span><strong>local</strong> runtime</span>
            <span><strong>user-owned</strong> avatars</span>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <DemoStage avatarId="cobalt-golem-v0" beats={GOLEM_DEMO} accent="#3d63b8" />
        </Reveal>
      </section>

      <section className="lp-section" id="how">
        <Reveal>
          <p className="lp-eyebrow">How it works</p>
          <h2 className="lp-h2">Three small pieces. One visible little familiar.</h2>
        </Reveal>

        <div className="lp-cards">
          <Reveal delay={80}><article className="lp-card">
            <div className="lp-card__num">01</div>
            <h3>Local runtime</h3>
            <p>A tiny Hono server on <code>127.0.0.1:8737</code> holds your Clawpals's state. Bearer auth and loopback trust.</p>
          </article></Reveal>
          <Reveal delay={160}><article className="lp-card">
            <div className="lp-card__num">02</div>
            <h3>Desktop overlay</h3>
            <p>A transparent always-on-top Tauri window polls the runtime and animates a pixel-art sprite. No browser tab to forget.</p>
          </article></Reveal>
          <Reveal delay={240}><article className="lp-card">
            <div className="lp-card__num">03</div>
            <h3>OpenClaw skill + daemon</h3>
            <p>A zero-token daemon tails OpenClaw's live session stream and mirrors real activity over Tailscale. Optional OpenClaw-authored expression is separate, explicit, and off by default.</p>
          </article></Reveal>
        </div>
      </section>

      <section className="lp-section lp-section--dual">
        <Reveal>
          <p className="lp-eyebrow">Reactivity controls</p>
          <h2 className="lp-h2">System signals are free. Personality is opt-in.</h2>
          <p className="lp-body">
            The production path is the daemon: it mirrors OpenClaw activity from local session logs with no model calls.
            <code>daemon-voice</code> controls zero-token system-signal density, <code>expression-level</code> gates optional model-authored bubbles, and heartbeat flashes stay separately opt-in.
          </p>
          <ul className="lp-bullets">
            <li><strong>daemon-voice lite</strong> — useful thinking/focused/done/blocker signals without noise. Default.</li>
            <li><strong>expression-level off</strong> — no model-authored personality bubbles unless requested. Default.</li>
            <li><strong>heartbeat-reactions off</strong> — periodic check flashes stay quiet unless explicitly enabled. Default.</li>
          </ul>
        </Reveal>
        <Reveal delay={120}>
          <div className="lp-codeblock">
            <span className="lp-codeblock__title">Tune anytime</span>
            <pre>{`clawpals daemon enable
clawpals daemon-voice lite
clawpals expression-level off

# optional visible heartbeat flashes:
clawpals heartbeat-reactions on`}</pre>
          </div>
        </Reveal>
      </section>

      <section className="lp-section" id="avatars">
        <Reveal>
          <p className="lp-eyebrow">Avatars</p>
          <h2 className="lp-h2">Ask OpenClaw to redesign your familiar.</h2>
          <p className="lp-body">
            Each avatar bundle includes normalized fallback assets, real per-state frame loops, and an <code>avatar.json</code> manifest. The fun part is personalization: OpenClaw can generate, store, push, and swap bundles conversationally. The landing page previews below use the current animated default bundle set only, keeping the repo lean while still demonstrating distinct character identities.
          </p>
        </Reveal>
        <div className="lp-stages lp-stages--presets">
          {PRESET_SHOWCASE.map((preset, idx) => (
            <Reveal delay={80 + idx * 80} key={preset.avatarId}>
              <div className="lp-stage-wrap">
                <DemoStage avatarId={preset.avatarId} beats={GOLEM_DEMO} accent={preset.accent} />
                <p className="lp-stage-caption">{preset.title}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-section lp-section--install" id="install">
        <Reveal>
          <p className="lp-eyebrow">Get started</p>
          <h2 className="lp-h2">Download Clawpals for your desktop.</h2>
        </Reveal>
        <div className="lp-install-grid">
          <Reveal delay={80}>
            <div className="lp-install-card">
              <h3>1. Pick your package</h3>
              <p className="lp-install-os">Windows</p>
              <a className="lp-btn lp-btn--primary" href={DOWNLOADS.windows.href} target="_blank" rel="noreferrer">{DOWNLOADS.windows.label}</a>
              <p className="lp-install-artifact">{DOWNLOADS.windows.artifact}</p>
              <p className="lp-install-os">macOS</p>
              <a className="lp-btn lp-btn--ghost" href={DOWNLOADS.macos.href} target="_blank" rel="noreferrer">{DOWNLOADS.macos.label}</a>
              <p className="lp-install-artifact">{DOWNLOADS.macos.artifact}</p>
              <p className="lp-install-os">Linux</p>
              <a className="lp-btn lp-btn--ghost" href={DOWNLOADS.linux.href} target="_blank" rel="noreferrer">{DOWNLOADS.linux.label}</a>
              <p className="lp-install-artifact">{DOWNLOADS.linux.artifact}</p>
              <p className="lp-install-note">Download the native Clawpals desktop app for your OS from the latest GitHub Release. On Windows, start with the <strong>.msi</strong> installer first; use the <strong>.exe</strong> only if you specifically want the NSIS build. This is the local app that creates the tray icon, starts the runtime on your display machine, shows the pair code, and gives OpenClaw something real to connect to and control.</p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="lp-install-card">
              <h3>2. Open Clawpals</h3>
              <p className="lp-install-note">Launch the desktop app on the machine where the avatar should appear. The app starts the local runtime, shows connection status, and gives you a pair code if needed.</p>
            </div>
          </Reveal>
          <Reveal delay={240}>
            <div className="lp-install-card">
              <h3>3. Let OpenClaw take over</h3>
              <CopyButton label="OpenClaw" text="clawpals pair --code 472091 --host <tailscale-host>:8737" />
              <CopyButton label="OpenClaw" text='clawpals send happy "It works" --bubble "Hello! 🐲"' />
              <p className="lp-install-note">After pairing, OpenClaw can reconnect, mirror activity through the daemon, tune daemon voice/expression controls, and push frame-based avatar bundles like Cobalt Golem.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="lp-section lp-section--dual">
        <Reveal>
          <p className="lp-eyebrow">Honest cost</p>
          <h2 className="lp-h2">Normal reactivity costs zero model tokens.</h2>
          <p className="lp-body">
            The daemon reads OpenClaw's local session log and updates the pet with zero model calls. Runtime decay is local too: terminal <code>happy</code> falls back to <code>idle</code>, and idle can drift sleepy after quiet time.
            The only model-token cost is optional expression, and that is off by default.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="lp-costs">
            <div><span>daemon mirror</span><strong>0</strong></div>
            <div><span>daemon-voice lite</span><strong>0</strong></div>
            <div><span>daemon-voice vivid</span><strong>0</strong></div>
            <div><span>heartbeat flashes</span><strong>0</strong></div>
            <div><span>expression on</span><strong>opt-in</strong></div>
            <p className="lp-costs__note">Daemon voice changes visibility, not model spend. Expression is the only model-authored path and remains off until enabled.</p>
          </div>
        </Reveal>
      </section>

      <section className="lp-section lp-section--cta-band">
        <Reveal>
          <h2 className="lp-h2">Open source. Local-first. A little weird in the best way.</h2>
          <div className="lp-cta">
            <a className="lp-btn lp-btn--primary" href="https://github.com/fighterz8/clawpals" target="_blank" rel="noreferrer">⭐ Star on GitHub</a>
            <a className="lp-btn lp-btn--ghost" href="#install">Install now</a>
          </div>
        </Reveal>
      </section>

      <footer className="lp-footer">
        <span>© {year} Clawpals · MIT</span>
        <span>Built with OpenClaw 🐲</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Landing /></React.StrictMode>);
