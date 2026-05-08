import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type AvatarState } from "./contracts/avatarEvent";
import { loadAvatarBundle, type ResolvedAvatarBundle } from "./avatars/bundle";
import "./styles.css";

const BUILD_TIME_AVATAR = (import.meta as { env?: Record<string, string> }).env?.VITE_CLAWPALS_AVATAR_BUNDLE;
const RUNTIME_URL = "http://127.0.0.1:8737";

function BundleAvatar({ state, bundle }: { state: AvatarState; bundle: ResolvedAvatarBundle | null }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [state, bundle]);

  const frames = bundle?.resolveFrames(state) ?? [];
  const activeFrame = frames[frameIndex] ?? frames[0];

  useEffect(() => {
    if (!activeFrame || frames.length <= 1) return;
    const ms = 1000 / activeFrame.fps;
    const id = window.setTimeout(() => {
      setFrameIndex((i) => {
        const next = i + 1;
        if (next < frames.length) return next;
        return activeFrame.loop ? 0 : i;
      });
    }, ms);
    return () => window.clearTimeout(id);
  }, [activeFrame, frames.length]);

  if (!bundle) return <div className="bundle-avatar bundle-avatar--loading" />;
  const { src, animation } = activeFrame ?? bundle.resolveAsset(state);
  return <img src={src} alt={state} className={`bundle-avatar bundle-avatar--anim-${animation}`} draggable={false} />;
}

function OverlayApp() {
  const [state, setState] = useState<AvatarState>("idle");
  const [message, setMessage] = useState<string>("");
  const [online, setOnline] = useState(false);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ResolvedAvatarBundle | null>(null);

  async function refreshBundle(avatarId?: string, bundleVersion?: string) {
    const cacheKey = encodeURIComponent(bundleVersion || avatarId || String(Date.now()));
    const fallbackAvatar = BUILD_TIME_AVATAR || avatarId || "dawn-v2-ember";

    if (BUILD_TIME_AVATAR) {
      try {
        const resolved = await loadAvatarBundle(`/avatars/${fallbackAvatar}`);
        setBundle(resolved);
        return;
      } catch { /* if local preview bundle is unavailable, try runtime-served bundle below */ }
    }

    try {
      // Prefer the runtime-served bundle unless a build-time avatar override is explicitly set.
      const resolved = await loadAvatarBundle(`${RUNTIME_URL}/avatar-bundle/current`);
      const withCacheBust: ResolvedAvatarBundle = {
        ...resolved,
        resolveAsset(nextState) {
          const asset = resolved.resolveAsset(nextState);
          return { ...asset, src: `${asset.src}?v=${cacheKey}` };
        },
        resolveFrames(nextState) {
          return resolved.resolveFrames(nextState).map((frame) => ({ ...frame, src: `${frame.src}?v=${cacheKey}` }));
        },
      };
      setBundle(withCacheBust);
      return;
    } catch { /* fall back to bundled static assets below */ }

    try {
      const resolved = await loadAvatarBundle(`/avatars/${fallbackAvatar}`);
      setBundle(resolved);
    } catch { /* leave null, shows loading shell */ }
  }

  // Load an initial bundle immediately; status polling below keeps it current.
  useEffect(() => {
    document.documentElement.classList.add("clawpals-overlay");
    document.body.classList.add("clawpals-overlay");
    void refreshBundle();
    return () => {
      document.documentElement.classList.remove("clawpals-overlay");
      document.body.classList.remove("clawpals-overlay");
    };
  }, []);

  async function startWindowDrag(event: React.PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-no-window-drag]")) return;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Browser preview / non-Tauri contexts do not expose native dragging.
    }
  }

  useEffect(() => {
    async function refresh() {
      try {
        const s = await fetch(`${RUNTIME_URL}/status`);
        if (!s.ok) throw new Error(String(s.status));
        const status = await s.json();
        setState(status.avatar.state);
        setMessage(status.avatar.bubble ?? "");
        setRuntimeConnected(Boolean(status.connected));
        setLastEventAt(status.lastEventAt ?? null);
        setOnline(true);
        const statusAvatarId = status.avatar.avatarId;
        const statusBundleVersion = status.avatar.bundleVersion;
        const loadedAvatarId = bundle?.manifest.name;
        const loadedBundleVersion = bundle?.manifest.version;
        if (statusAvatarId && statusBundleVersion && (statusAvatarId !== loadedAvatarId || statusBundleVersion !== loadedBundleVersion)) {
          void refreshBundle(statusAvatarId, statusBundleVersion);
        }
      } catch {
        setOnline(false);
        setRuntimeConnected(false);
        setLastEventAt(null);
      }
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, [bundle?.manifest.name, bundle?.manifest.version]);

  const linkState = !online ? "offline" : runtimeConnected ? "ready" : "waiting";
  const linkLabel = linkState === "ready"
    ? lastEventAt
      ? "Runtime connected — OpenClaw activity received"
      : "Runtime connected — waiting for first OpenClaw activity"
    : linkState === "waiting"
      ? "Runtime online — waiting for connection readiness"
      : "Runtime offline";

  return (
    <main className="overlay-shell" data-tauri-drag-region onPointerDown={(event) => void startWindowDrag(event)}>
      <div className={`overlay-floating overlay-floating--${linkState}`} data-tauri-drag-region>
        <div className={`overlay-link-dot overlay-link-dot--${linkState}`} title={linkLabel} aria-label={linkLabel} data-no-window-drag />
        <BundleAvatar state={state} bundle={bundle} />
        {online && message && <div className="overlay-floating__bubble">{message}</div>}
        {!online && <div className="overlay-floating__bubble overlay-floating__bubble--warn">Start runtime: npm run runtime:dev</div>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><OverlayApp /></React.StrictMode>);
