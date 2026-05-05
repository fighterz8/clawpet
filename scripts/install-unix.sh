#!/usr/bin/env bash
# Clawpet target install (macOS / Linux)
#
# Usage (run on the machine that should host the desktop avatar):
#   curl -fsSL https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-unix.sh | bash
#
# What it does:
#   1. Clones (or updates) the Clawpet repo into ~/clawpet.
#   2. Installs npm deps.
#   3. Ensures Rustup is available (Tauri needs cargo).
#   4. Generates a runtime auth token if absent.
#   5. Prints the exact `clawpet pair` command to run on the OpenClaw side.
#
# It does NOT auto-start the runtime/desktop; the desktop overlay needs an interactive session.
# On Linux, system-level WebKitGTK packages may also be required (printed at the end).

set -euo pipefail

green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
cyan()  { printf "\033[1;36m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[1;33m%s\033[0m\n" "$*"; }
err()   { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

cyan "==> Clawpet target installer"

command -v git  >/dev/null || err "git is required."
command -v node >/dev/null || err "Node.js (>=20) is required."
command -v npm  >/dev/null || err "npm is required."

if ! command -v cargo >/dev/null; then
  yellow "==> Installing Rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

REPO_DIR="${CLAWPET_REPO_DIR:-$HOME/clawpet}"
if [[ ! -d "$REPO_DIR" ]]; then
  cyan "==> Cloning Clawpet into $REPO_DIR"
  git clone https://github.com/fighterz8/clawpet.git "$REPO_DIR"
else
  cyan "==> Updating existing repo at $REPO_DIR"
  git -C "$REPO_DIR" pull --ff-only
fi

cyan "==> Installing npm deps..."
( cd "$REPO_DIR" && npm install )

TOKEN_DIR="$HOME/.openclaw/clawpet"
TOKEN_FILE="$TOKEN_DIR/runtime-token"
mkdir -p "$TOKEN_DIR"
chmod 700 "$TOKEN_DIR"
if [[ ! -s "$TOKEN_FILE" ]]; then
  head -c 32 /dev/urandom | xxd -p -c 64 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"

# Best-effort hostname for cross-machine pairing.
DISPLAY_HOST="$(hostname)"
if command -v tailscale >/dev/null; then
  TS="$(tailscale status --json 2>/dev/null || true)"
  if [[ -n "$TS" ]]; then
    TS_HOST="$(printf "%s" "$TS" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(j.Self&&j.Self.DNSName)process.stdout.write(j.Self.DNSName.replace(/\.$/,""));}catch{}})' 2>/dev/null || true)"
    if [[ -n "$TS_HOST" ]]; then DISPLAY_HOST="$TS_HOST"; fi
  fi
fi

green "==> Clawpet installed."
echo
cyan "To start the desktop avatar (interactive session):"
echo "  cd $REPO_DIR"
echo "  CLAWPET_RUNTIME_HOST=0.0.0.0 CLAWPET_RUNTIME_PORT=8737 npm run runtime:dev &"
echo "  npm run desktop:dev"
echo
cyan "On the OpenClaw side, pair with:"
yellow "  clawpet pair --url http://$DISPLAY_HOST:8737 --token $TOKEN"
echo
printf "\033[2mToken file (keep secret): %s\033[0m\n" "$TOKEN_FILE"
echo
if [[ "$(uname -s)" == "Linux" ]]; then
  yellow "On Linux, you may also need:"
  echo "  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf"
fi
