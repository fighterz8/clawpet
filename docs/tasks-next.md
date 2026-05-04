# Clawpet — Next Tasks

Tracking what's next after the runtime-first MVP shipped (transparent draggable overlay).

## Confirmed user requirements (2026-05-04)

### Tray icon (not taskbar)
- The Clawpet desktop app must live in the **system tray / notification area** (the expandable tray), not the taskbar.
- Window itself = `skipTaskbar: true`.
- Tray icon should expose at least: Show/Hide, Quit, and (later) Status.

### Truly background-less floating avatar
- The overlay window is already transparent.
- The avatar itself must have **no surrounding background, glow, gradient, or card** — only the avatar character is visible. Whatever is behind the window on the user's desktop should show through completely around the avatar.
- This is part of **Option B (avatar bundle redesign)**: replace the CSS div avatar with a single transparent SVG/PNG asset rendered as the only visible element.

### Style lock (mandatory for all Clawpets)
- See `docs/clawpet-style-guide.md` (v1).
- Pixel-art platformer/roguelike style, Terraria-ish but slightly higher resolution.
- 128×128 logical canvas, exported at 512×512 PNG with transparent background.
- Limited palette, hard 1-pixel outline, cel-shaded, no gradients/glow baked in.
- 6 mandatory state variants: idle, thinking, focused, happy, alert, sleepy.
- Mandatory prompt template in §7 of the style guide must be used by OpenClaw skill and any image generator.

## Roadmap order

1. **Tray icon + skipTaskbar** — done immediately, minimal change.
2. **Avatar bundle loader (Option B mechanism)**
   - Define `avatar.json` schema (already drafted in `docs/avatar-bundle-spec.md`).
   - Replace the CSS-only avatar with a bundle renderer: one image per state, transparent PNG/SVG.
   - Drop the conic-gradient/card/glow entirely — only the asset is visible.
3. **Generate the Dawn avatar pack**
   - Use `image_generate` with a locked prompt template (consistent style, transparent backgrounds, per-state).
   - States: idle, thinking, focused, happy, alert, sleepy.
4. **Remote install + projection (`clawpet` OpenClaw skill)**
   - Skill commands: `install --target`, `pair --target`, `status`, `send`.
   - Default network path: **Tailscale** (no inbound firewall changes).
   - Fallback: OpenClaw-hosted relay (target connects out).
   - One-command UX: user provides target IP/hostname; OpenClaw downloads the Clawpet binary, installs it on the target, pairs runtime, and projects the avatar.
5. **Polish / final visual coherency pass.**
