#!/usr/bin/env bash
# Clawpals target install (macOS / Linux)
#
# Usage (run on the machine that should display the desktop avatar):
#   curl -fsSL https://raw.githubusercontent.com/fighterz8/clawpals/main/scripts/install-unix.sh | bash

set -euo pipefail

green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
cyan()  { printf "\033[1;36m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[1;33m%s\033[0m\n" "$*"; }
err()   { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

cyan "==> Clawpals target installer"

command -v git  >/dev/null || err "git is required."
command -v node >/dev/null || err "Node.js (>=20) is required."
command -v npm  >/dev/null || err "npm is required."

if ! command -v cargo >/dev/null; then
  yellow "==> Installing Rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

REPO_DIR="${CLAWPALS_REPO_DIR:-$HOME/clawpals}"
if [[ ! -d "$REPO_DIR" ]]; then
  cyan "==> Cloning Clawpals into $REPO_DIR"
  git clone https://github.com/fighterz8/clawpals.git "$REPO_DIR"
else
  cyan "==> Updating existing repo at $REPO_DIR"
  git -C "$REPO_DIR" fetch origin main
  if [[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
    git -C "$REPO_DIR" reset --hard origin/main
  else
    git -C "$REPO_DIR" pull --ff-only || err "Existing Clawpals repo has local changes or diverged history. Commit/stash changes or set CLAWPALS_REPO_DIR to a fresh install path."
  fi
fi

cyan "==> Installing npm deps and linking clawpals command..."
( cd "$REPO_DIR" && npm install && npm link )

# Ensure runtime state directory exists; the runtime owns token creation.
mkdir -p "$HOME/.openclaw/clawpals"
chmod 700 "$HOME/.openclaw/clawpals"

DISPLAY_HOST="<desktop-host>.<tailnet>.ts.net"
if command -v tailscale >/dev/null; then
  TS="$(tailscale status --json 2>/dev/null || true)"
  if [[ -n "$TS" ]]; then
    TS_HOST="$(printf "%s" "$TS" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(j.Self&&j.Self.DNSName)process.stdout.write(j.Self.DNSName.replace(/\.$/,""));}catch{}})' 2>/dev/null || true)"
    if [[ -n "$TS_HOST" ]]; then DISPLAY_HOST="$TS_HOST"; fi
  fi
fi

green "==> Clawpals installed."
echo
cyan "Start the guided display-machine setup:"
echo "  cd $REPO_DIR"
echo "  clawpals wizard display"
echo
cyan "Run the desktop app from source:"
echo "  cd $REPO_DIR"
echo "  npm run desktop:dev"
echo
cyan "Cross-machine pairing flow:"
echo "  # on this display machine, open the app and click Show pair code when needed:"
echo "  cd $REPO_DIR && npm run desktop:dev"
echo "  # on the OpenClaw machine, claim the shown code:"
yellow "  clawpals pair --code <6-digit-code> --host $DISPLAY_HOST:8737"
echo
yellow "Note: use npm run desktop:dev, not 'clawpals run desktop:dev'."
echo
if [[ "$(uname -s)" == "Linux" ]]; then
  yellow "On Linux, you may also need:"
  echo "  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf"
fi
