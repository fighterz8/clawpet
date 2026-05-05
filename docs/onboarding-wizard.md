# Onboarding wizard — magic pair by 6-digit code

Status: **in progress** (started 2026-05-04). Future-Dawn / future-Nick: this is
the doc to read first if you're picking this up after a context break.

## Why

Clawpet's setup has two physically separate halves bound by a bearer token:

- **Daily driver** — runtime + Tauri overlay (where the avatar is visible)
- **OpenClaw host** — clawpet skill + clawpet daemon (where events come from)

For a same-machine user these collapse to one box, trivial. For a cross-machine
user (Tailscale, LAN), the bearer token has to be securely transferred from
one machine to the other. Today that's a manual copy-paste from one terminal
to another, which is the single ugliest part of the setup.

The fix: **magic pair by 6-digit code**, like Plex/Spotify Connect/Apple TV.

## End-state UX

### Same machine (simplest)

```
$ clawpet init
✔ Detected: same machine for runtime and OpenClaw host
✔ Runtime started on http://127.0.0.1:8737
✔ Skill installed at ~/.openclaw/workspace/skills/clawpet/
✔ Daemon started
🐲 Dawn is alive. Send a test message to see her react.
```

### Two machines (the real win)

On gladriel (daily driver):

```
$ clawpet init
? Is OpenClaw running on this machine?  No, on a different machine
✔ Runtime started on http://gladriel.taila06843.ts.net:8737
✔ Pair mode open for 90 seconds

   ┌──────────────────────────────────────────┐
   │   Pair code:    4 7 2 0 9 1              │
   │   Expires in:   1m 28s                   │
   └──────────────────────────────────────────┘

  On your OpenClaw machine, run:
    clawpet init --pair gladriel.taila06843.ts.net 472091

⏳  Waiting for OpenClaw to pair…
```

The avatar overlay simultaneously shows the same 6-digit code in its bubble,
so you can read it off whichever surface is closest.

On the Linux/OpenClaw host:

```
$ clawpet init --pair gladriel.taila06843.ts.net 472091
✔ Connected to runtime at http://gladriel.taila06843.ts.net:8737
✔ Code accepted; bearer token saved
✔ Skill installed at ~/.openclaw/workspace/skills/clawpet/
✔ Daemon started (will auto-start on boot via systemd user unit)
🐲 Done. Sending a test wave…
```

Back on gladriel:

```
✔ Paired with openclaw-linux-host
🐲 Dawn waves.
```

## Architecture

### Runtime side (new code)

`src/runtime/pairMode.ts` — in-memory store:

```ts
type PairMode =
  | { active: false }
  | { active: true; code: string; expiresAt: number; attempts: number };
```

Endpoints (new):

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/admin/pair-mode/start` | bearer-or-loopback | Opens pair mode for 90s, generates 6-digit code, returns `{ code, expiresAt }`. |
| `POST` | `/admin/pair-mode/cancel` | bearer-or-loopback | Closes pair mode immediately. |
| `GET`  | `/pair-mode` | public | Returns `{ active: bool, expiresAt? }` (no code). Used by overlay to render the bubble countdown without needing auth. |
| `POST` | `/pair/claim` | public | Body `{ code, clientName? }`. Validates code; on success returns `{ token, expiresAt }`, generates fresh bearer token, replaces existing one, closes pair mode. On failure: increments attempts; 3 failures = pair mode closed. Rate-limited to 1 attempt/second. |

Pair mode integration with the existing token system:
- When pair mode succeeds, the runtime calls the same `onTokenRotated` callback
  used by `/admin/rotate-token`. This persists the new token to
  `~/.openclaw/clawpet/runtime-token` and prints a one-time confirmation.
- All previously-paired CLIs are immediately invalidated. Acceptable: pair
  mode is intended for first-time setup, not casual re-pairing.

Runtime state store extension (overlay UX):
- Status payload gains `avatar.pairCode?: string` while pair mode is active.
- Overlay reads this and renders a special "pair" bubble that overrides the
  normal bubble. State suggested: `thinking` with a 6-digit-code caption.
- Once pair mode closes, status goes back to whatever the daemon last set.

### CLI side (new code in `skills/clawpet/bin/clawpet.mjs`)

Existing `pair` subcommand stays for power users. New entry points:

- `clawpet pair-mode [--seconds 90]`
  - POSTs to `/admin/pair-mode/start` (loopback, no auth needed locally).
  - Prints the code in a big banner.
  - Polls `/status` every 2s; exits when pair mode closes (success or expiry).
- `clawpet pair --code 472091 --host gladriel.taila06843.ts.net:8737`
  - POSTs `/pair/claim` to the remote runtime.
  - On success: persists URL + bearer token to `~/.openclaw/clawpet/config.json`.
  - Validates by following with `clawpet ping`.
- `clawpet init` — interactive wrapper:
  - Prompts: "Is OpenClaw running on this machine?"
  - If yes (same machine): start runtime, install skill, start daemon, fire test event.
  - If no, this machine is the daily driver: start runtime, enter pair mode,
    print code + the exact `clawpet init --pair …` to run on the other machine,
    wait. On success, print confirmation and start daemon-here-or-not based on
    a follow-up prompt.
  - If the other machine is the OpenClaw host:
    `clawpet init --pair <host> <code>` does the OpenClaw-host install
    (skill + daemon + systemd unit) after pairing.

### Skill installation on the OpenClaw host

The OpenClaw-host install path needs to:

1. Copy `skills/clawpet/` (the SKILL.md + `bin/clawpet.mjs` + `bin/clawpet-daemon.mjs`)
   into `~/.openclaw/workspace/skills/clawpet/`.
2. Drop a systemd user unit / launchd plist / Windows scheduled task that runs
   `clawpet daemon start` on login.
3. Run `clawpet pair --code … --host …` to write config.
4. Run `clawpet daemon start` immediately so the user sees Dawn react before
   the wizard exits.

Skill source for the install lives in this repo at `skills/clawpet/` (mirror
of `~/.openclaw/workspace/skills/clawpet/` during development) so users can
install via `git clone` + the wizard, or via a future ClawHub registry entry.

> TODO: decide whether to mirror the skill into this repo or pull from
> ClawHub at install time. Mirroring is faster to ship; ClawHub is the
> long-term home.

## Security model

- Pair mode is **opt-in** and **time-bound** (default 90s, max 5 min).
- Pair codes are 6 digits = 1,000,000 keyspace. Combined with rate limiting
  (1 attempt/sec) and lockout (3 wrong attempts), brute-force window is
  90 attempts max → ~0.009% per pair window. Acceptable for a non-public
  endpoint that's only listening for ~90s on a Tailscale tunnel.
- The unauthenticated `/pair/claim` endpoint is **only mounted when pair
  mode is active**. Outside pair mode it returns 404, not 401, to prevent
  pair-mode-active discovery via timing.
- Successful pairing rotates the bearer token, so even if someone snooped
  an old token they're immediately locked out.
- Pair mode cannot be opened over a non-loopback connection without an
  existing bearer token (i.e., you can't bootstrap pair mode remotely;
  you need physical access to the daily-driver machine).

## Implementation phases

### Phase 1 — runtime endpoints (this turn)
- [x] Decay rule redesign (active states persist; happy lingers; bubble TTL).
- [ ] `pairMode.ts` store with code generation + expiry + attempt limits.
- [ ] Endpoints: `/admin/pair-mode/start`, `/admin/pair-mode/cancel`,
  `/pair-mode`, `/pair/claim`.
- [ ] Status payload extension for `avatar.pairCode`.
- [ ] Tests for happy path, expiry, wrong code, attempt limit.

### Phase 2 — CLI commands (this turn)
- [ ] `clawpet pair-mode` (loopback, prints banner, polls).
- [ ] `clawpet pair --code … --host …` (POST claim, save token).
- [ ] Wire both into existing CLI dispatch.

### Phase 3 — `clawpet init` interactive wizard (next session if not done)
- [ ] Inquirer-style prompts in plain Node (no extra deps if possible).
- [ ] Same-machine path: start runtime, install skill, start daemon.
- [ ] Two-machine paths (daily-driver and openclaw-host).
- [ ] Test full flow on both Linux and Windows.

### Phase 4 — Install scripts integration (next session)
- [ ] `scripts/install-{windows,unix}.sh` accept `--mode daily-driver|openclaw-host`.
- [ ] systemd user unit / launchd plist / Windows Task Scheduler entries
  for daemon auto-start.
- [ ] Mirror `skills/clawpet/` into this repo (or wire ClawHub).

### Phase 5 — Overlay pair-bubble UX (next session)
- [ ] Overlay renders pair code as a special bubble when pair mode active.
- [ ] Optional: distinct "pair-mode" sprite or animation.

### Phase 6 — Landing page + README (after wizard ships)
- [ ] Replace existing 3-step install with the magic-pair flow.
- [ ] Demo GIF of the two-machine flow.

## Pickup notes

If you're resuming this work:

1. Check `git log --oneline -20` in `repos/clawpet` for the latest commits
   tagged `feat(pair-mode)` or `feat(init-wizard)`.
2. Tests for the pair-mode endpoint live in `src/runtime/app.test.ts` next
   to the existing `/admin/rotate-token` tests.
3. The CLI is a single file: `skills/clawpet/bin/clawpet.mjs`. Keep it
   single-file for now — no transpile, no build step.
4. The daemon is `skills/clawpet/bin/clawpet-daemon.mjs` and is unaffected
   by this work; it just consumes whatever bearer token is in
   `~/.openclaw/clawpet/config.json`.
5. The user is on `expressive` activity by default and `maximum` while
   debugging this. Daemon throttle is 250ms; if you see strobing, raise it.

## Current status (2026-05-04 20:00 PDT)

- Decay rules: ✅ done, tested, committed (next commit).
- Pair-mode store + endpoints: ⏳ in this commit (or next).
- CLI commands: ⏳ in this commit (or next).
- Interactive wizard: ⏳ next session.
- Install scripts: ⏳ next session.
- Overlay UX: ⏳ next session.
