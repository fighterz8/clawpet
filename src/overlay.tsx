import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type AvatarState } from "./contracts/avatarEvent";
import { loadAvatarBundle, type ResolvedAvatarBundle } from "./avatars/bundle";
import "./styles.css";

const BUILD_TIME_AVATAR = (import.meta as { env?: Record<string, string> }).env?.VITE_CLAWPET_AVATAR_BUNDLE;
const RUNTIME_URL = "http://127.0.0.1:8737";

function BundleAvatar({ state, bundle }: { state: AvatarState; bundle: ResolvedAvatarBundle | null }) {
  if (!bundle) return <div className="bundle-avatar bundle-avatar--loading" />;
  const { src, animation } = bundle.resolveAsset(state);
  return <img src={src} alt={state} className={`bundle-avatar bundle-avatar--anim-${animation}`} draggable={false} />;
}

function OverlayApp() {
  const [state, setState] = useState<AvatarState>("idle");
  const [message, setMessage] = useState<string>("");
  const [online, setOnline] = useState(false);
  const [bundle, setBundle] = useState<ResolvedAvatarBundle | null>(null);

  // Resolve avatar id: build-time env wins, else fetch from /status, else dawn-v0.
  useEffect(() => {
    let cancelled = false;
    async function pickBundle() {
      let avatarId = BUILD_TIME_AVATAR;
      if (!avatarId) {
        try {
          const r = await fetch(`${RUNTIME_URL}/status`);
          if (r.ok) {
            const s = await r.json();
            avatarId = s?.avatar?.avatarId;
          }
        } catch { /* runtime offline; default below */ }
      }
      avatarId = avatarId || "dawn-v0";
      try {
        // Prefer the runtime-served bundle. This lets OpenClaw own avatar
        // appearance/assets and push them to the target runtime over Tailscale.
        const resolved = await loadAvatarBundle(`${RUNTIME_URL}/avatar-bundle/current`);
        if (!cancelled) setBundle(resolved);
        return;
      } catch { /* fall back to bundled static assets below */ }
      try {
        const resolved = await loadAvatarBundle(`/avatars/${avatarId}`);
        if (!cancelled) setBundle(resolved);
      } catch { /* leave null, shows loading shell */ }
    }
    void pickBundle();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    async function refresh() {
      try {
        const s = await fetch(`${RUNTIME_URL}/status`);
        if (!s.ok) throw new Error(String(s.status));
        const status = await s.json();
        setState(status.avatar.state);
        setMessage(status.avatar.bubble ?? "");
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
        {online && message && <div className="overlay-floating__bubble">{message}</div>}
        {!online && <div className="overlay-floating__bubble overlay-floating__bubble--warn">Start runtime: npm run runtime:dev</div>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><OverlayApp /></React.StrictMode>);
