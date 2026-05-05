#!/usr/bin/env bash
# Clawpet target install (macOS / Linux)
#
# Usage (run on the machine that should display the desktop avatar):
#   curl -fsSL https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-unix.sh | bash

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

cyan "==> Installing npm deps and linking clawpet command..."
( cd "$REPO_DIR" && npm install && npm link )

# Ensure runtime state directory exists; the runtime owns token creation.
mkdir -p "$HOME/.openclaw/clawpet"
chmod 700 "$HOME/.openclaw/clawpet"

DISPLAY_HOST="<desktop-host>.<tailnet>.ts.net"
if command -v tailscale >/dev/null; then
  TS="$(tailscale status --json 2>/dev/null || true)"
  if [[ -n "$TS" ]]; then
    TS_HOST="$(printf "%s" "$TS" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(j.Self&&j.Self.DNSName)process.stdout.write(j.Self.DNSName.replace(/\.$/,""));}catch{}})' 2>/dev/null || true)"
    if [[ -n "$TS_HOST" ]]; then DISPLAY_HOST="$TS_HOST"; fi
  fi
fi

green "==> Clawpet installed."
echo
cyan "Try demo mode first (no OpenClaw pairing required):"
echo "  cd $REPO_DIR"
echo "  npm run runtime:demo"
echo "  # in a second terminal:"
echo "  cd $REPO_DIR && npm run desktop:dev"
echo
cyan "Cross-machine pairing flow:"
echo "  # on this display machine, start the runtime:"
echo "  cd $REPO_DIR && CLAWPET_RUNTIME_HOST=0.0.0.0 CLAWPET_RUNTIME_PORT=8737 npm run runtime:dev"
echo "  # in another terminal on this display machine:"
echo "  cd $REPO_DIR && clawpet pair-mode"
echo "  # on the OpenClaw machine, claim the shown code:"
yellow "  clawpet pair --code <6-digit-code> --host $DISPLAY_HOST:8737"
echo
if [[ "$(uname -s)" == "Linux" ]]; then
  yellow "On Linux, you may also need:"
  echo "  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf"
fi
