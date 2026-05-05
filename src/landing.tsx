import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { type AvatarState } from "./contracts/avatarEvent";
import { loadAvatarBundle, type ResolvedAvatarBundle } from "./avatars/bundle";
import "./styles.css";
import "./landing.css";

type ScriptedBeat = { state: AvatarState; bubble: string; hold: number };

const DAWN_DEMO: ScriptedBeat[] = [
  { state: "idle",     bubble: "",                                   hold: 1800 },
  { state: "thinking", bubble: "Reading your message…",              hold: 2400 },
  { state: "focused",  bubble: "Refactoring the runtime middleware", hold: 3000 },
  { state: "alert",    bubble: "Heads up — needs your approval",     hold: 2400 },
  { state: "happy",    bubble: "Done!  🐲",                          hold: 2400 },
  { state: "sleepy",   bubble: "Quiet hours… 💤",                    hold: 2600 },
];

const PRESET_SHOWCASE = [
  { avatarId: "dawn-v2-ember", title: "Dawn Ember", accent: "#ff8a5b" },
  { avatarId: "lantern-moth-v0", title: "Lantern Moth", accent: "#5fc8b5" },
  { avatarId: "dawn-v2-jade", title: "Dawn Jade", accent: "#67d6a3" },
  { avatarId: "dawn-v2-amethyst", title: "Dawn Amethyst", accent: "#b884ff" },
];

const DOWNLOADS = {
  windows: {
    href: "https://github.com/fighterz8/clawpet/actions/workflows/desktop-build.yml",
    label: "Download Windows (.exe/.msi)",
    artifact: "artifact: clawpet-windows",
  },
  macos: {
    href: "https://github.com/fighterz8/clawpet/actions/workflows/desktop-build.yml",
    label: "Download macOS (.dmg)",
    artifact: "artifact: clawpet-macos",
  },
  linux: {
    href: "https://github.com/fighterz8/clawpet/actions/workflows/desktop-build.yml",
    label: "Download Linux (.AppImage/.deb/.rpm)",
    artifact: "artifact: clawpet-linux",
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
  const asset = bundle?.resolveAsset(beat.state);
  return (
    <div className="lp-stage" style={{ ["--accent" as never]: accent }}>
      <div className="lp-stage__glow" />
      <div className="lp-stage__floor" />
      {asset && <img key={beat.state + beat.bubble} src={asset.src} alt={beat.state} className={`lp-stage__sprite lp-stage__sprite--${beat.state}`} />}
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

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  return <div className={`lp-reveal ${visible ? "lp-reveal--in" : ""}`}>{children}</div>;
}

function Landing() {
  const year = useMemo(() => new Date().getFullYear(), []);

  return (
    <div className="lp-root">
      <div className="lp-bg" aria-hidden />

      <header className="lp-nav">
        <div className="lp-nav__brand">
          <span className="lp-nav__mark">🐲</span>
          <span>Clawpet</span>
        </div>
        <nav>
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href="#avatars">Avatars</a>
          <a href="https://github.com/fighterz8/clawpet" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </header>

      <section className="lp-hero">
        <Reveal>
          <p className="lp-eyebrow">An OpenClaw companion</p>
          <h1 className="lp-headline">
            Give your AI assistant<br/>
            <span className="lp-headline__accent">a tiny living face.</span>
          </h1>
          <p className="lp-lede">
            A pixel-art desktop pet generated from your OpenClaw's name, soul, and personality — then animated by what it's actually doing:
            thinking, working, blocked, done. Floats over your desktop. Reacts in real time over Tailscale. Ships with animated Dawn presets plus a fully different lantern-moth showcase companion.
          </p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn--primary" href="#install">Try it in 3 minutes</a>
            <a className="lp-btn lp-btn--ghost" href="https://github.com/fighterz8/clawpet" target="_blank" rel="noreferrer">View on GitHub</a>
          </div>
          <p className="lp-foot-hint">Local-first · Tailscale-first for cross-machine setups · MIT</p>
        </Reveal>

        <Reveal delay={200}>
          <DemoStage avatarId="dawn-v2-ember" beats={DAWN_DEMO} accent="#ff8a5b" />
        </Reveal>
      </section>

      <section className="lp-section" id="how">
        <Reveal>
          <p className="lp-eyebrow">How it works</p>
          <h2 className="lp-h2">Three small pieces. One personalized little familiar.</h2>
        </Reveal>

        <div className="lp-cards">
          <Reveal delay={80}><article className="lp-card">
            <div className="lp-card__num">01</div>
            <h3>Local runtime</h3>
            <p>A tiny Hono server on <code>127.0.0.1:8737</code> holds your Clawpet's state. Bearer auth and loopback trust.</p>
          </article></Reveal>
          <Reveal delay={160}><article className="lp-card">
            <div className="lp-card__num">02</div>
            <h3>Desktop overlay</h3>
            <p>A transparent always-on-top Tauri window polls the runtime and animates a pixel-art sprite. No browser tab to forget.</p>
          </article></Reveal>
          <Reveal delay={240}><article className="lp-card">
            <div className="lp-card__num">03</div>
            <h3>OpenClaw skill + daemon</h3>
            <p>A sidecar tails OpenClaw's live session stream and mirrors real activity over Tailscale. Semantic reactions add optional flavor, gated by <em>your</em> activity setting.</p>
          </article></Reveal>
        </div>
      </section>

      <section className="lp-section lp-section--dual">
        <Reveal>
          <p className="lp-eyebrow">Activity, your call</p>
          <h2 className="lp-h2">You decide how chatty your Clawpet is.</h2>
          <p className="lp-body">
            Five levels — <code>off</code>, <code>minimal</code>, <code>balanced</code>, <code>expressive</code>, <code>maximum</code> — set with one CLI command and persisted on disk.
            The skill itself enforces the gate, so the model can't accidentally spam emits past the level you chose.
          </p>
          <ul className="lp-bullets">
            <li><strong>balanced</strong> — long tasks + completions + blockers. Default.</li>
            <li><strong>expressive</strong> — also reacts when you message and when tools start.</li>
            <li><strong>off</strong> — total silence; pet still idles + decays cosmetically.</li>
          </ul>
        </Reveal>
        <Reveal delay={120}>
          <div className="lp-codeblock">
            <span className="lp-codeblock__title">Tune anytime</span>
            <pre>{`clawpet activity expressive
clawpet heartbeat-reactions on

# don't like it? dial back:
clawpet activity balanced`}</pre>
          </div>
        </Reveal>
      </section>

      <section className="lp-section" id="avatars">
        <Reveal>
          <p className="lp-eyebrow">Avatars</p>
          <h2 className="lp-h2">Ask OpenClaw to redesign your familiar.</h2>
          <p className="lp-body">
            Each avatar bundle includes normalized fallback assets, optional per-state frame loops, and an <code>avatar.json</code> manifest. The fun part is personalization: OpenClaw can generate, store, push, and swap bundles conversationally. We now ship animated Dawn v2 presets plus a genuinely different lantern-moth showcase pet, so you can demo both palette variation and full character variation before testing live runtime switching.
          </p>
        </Reveal>
        <div className="lp-stages lp-stages--presets">
          {PRESET_SHOWCASE.map((preset, idx) => (
            <Reveal delay={80 + idx * 80} key={preset.avatarId}>
              <div className="lp-stage-wrap">
                <DemoStage avatarId={preset.avatarId} beats={DAWN_DEMO} accent={preset.accent} />
                <p className="lp-stage-caption">{preset.title}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-section lp-section--install" id="install">
        <Reveal>
          <p className="lp-eyebrow">Get started</p>
          <h2 className="lp-h2">Download Clawpet for your desktop.</h2>
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
              <p className="lp-install-note">Current downloads come from the latest GitHub Actions desktop build until dedicated release-package URLs are wired into the site.</p>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="lp-install-card">
              <h3>2. Open Clawpet</h3>
              <p className="lp-install-note">Launch the desktop app on the machine where the avatar should appear. The app starts the local runtime, shows connection status, and gives you a pair code if needed.</p>
            </div>
          </Reveal>
          <Reveal delay={240}>
            <div className="lp-install-card">
              <h3>3. Let OpenClaw take over</h3>
              <CopyButton label="OpenClaw" text="clawpet pair --code 472091 --host <tailscale-host>:8737" />
              <CopyButton label="OpenClaw" text='clawpet send happy "It works" --bubble "Hello! 🐲"' />
              <p className="lp-install-note">After pairing, OpenClaw can reconnect, react, change activity level, and push avatar bundles.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="lp-section lp-section--dual">
        <Reveal>
          <p className="lp-eyebrow">Honest cost</p>
          <h2 className="lp-h2">Designed not to drain your token budget.</h2>
          <p className="lp-body">
            The daemon reads OpenClaw's local session log and updates the pet with zero model calls. Runtime decay is also local: active states persist, terminal <code>happy</code> falls back to <code>idle</code> after 8s, and idle drifts sleepy after 5min.
            Only optional semantic emits cost tokens, and only when your activity level allows them.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="lp-costs">
            <div><span>off</span><strong>0</strong></div>
            <div><span>minimal</span><strong>0–80</strong></div>
            <div><span>balanced</span><strong>0–200</strong></div>
            <div><span>expressive</span><strong>100–400</strong></div>
            <div><span>maximum</span><strong>200–600</strong></div>
            <p className="lp-costs__note">Approx extra tokens per active turn (with <code>--quiet</code>).</p>
          </div>
        </Reveal>
      </section>

      <section className="lp-section lp-section--cta-band">
        <Reveal>
          <h2 className="lp-h2">Open source. Local-first. A little weird in the best way.</h2>
          <div className="lp-cta">
            <a className="lp-btn lp-btn--primary" href="https://github.com/fighterz8/clawpet" target="_blank" rel="noreferrer">⭐ Star on GitHub</a>
            <a className="lp-btn lp-btn--ghost" href="#install">Install now</a>
          </div>
        </Reveal>
      </section>

      <footer className="lp-footer">
        <span>© {year} Clawpet · MIT</span>
        <span>Built with OpenClaw 🐲</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Landing /></React.StrictMode>);
