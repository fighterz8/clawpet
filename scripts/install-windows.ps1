# Clawpet target install (Windows / PowerShell)
#
# Usage (run on the machine that should display the desktop avatar):
#   irm https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-windows.ps1 | iex

$ErrorActionPreference = "Stop"

function Need-Cmd($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "Missing required command: $cmd. $hint"
  }
}

Write-Host "==> Clawpet target installer (Windows)" -ForegroundColor Cyan

Need-Cmd "git" "Install Git for Windows from https://git-scm.com/downloads."
Need-Cmd "node" "Install Node.js LTS from https://nodejs.org. Need >= 20."
Need-Cmd "npm" "npm should ship with Node.js."

if (-not (Get-Command "rustc" -ErrorAction SilentlyContinue)) {
  Write-Host "==> Installing Rustup..." -ForegroundColor Yellow
  winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
}

if (-not (where.exe link.exe 2>$null)) {
  Write-Host "==> Installing MSVC C++ Build Tools (required for Tauri)..." -ForegroundColor Yellow
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  Write-Warning "Open a NEW PowerShell window after the build tools finish, then re-run this script."
  exit 0
}

$repoDir = Join-Path $HOME "clawpet"
if (-not (Test-Path $repoDir)) {
  Write-Host "==> Cloning Clawpet into $repoDir" -ForegroundColor Cyan
  git clone https://github.com/fighterz8/clawpet.git $repoDir
} else {
  Write-Host "==> Updating existing repo at $repoDir" -ForegroundColor Cyan
  git -C $repoDir pull --ff-only
}

Push-Location $repoDir
Write-Host "==> Installing npm deps and linking clawpet command..." -ForegroundColor Cyan
npm install
npm link
Pop-Location

$stateDir = Join-Path $HOME ".openclaw\clawpet"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$displayHost = "<desktop-host>.<tailnet>.ts.net"
try {
  $tailnetHost = (tailscale status --json 2>$null | ConvertFrom-Json).Self.DNSName
  if ($tailnetHost) { $displayHost = $tailnetHost.TrimEnd(".") }
} catch { }

Write-Host ""
Write-Host "==> Clawpet installed." -ForegroundColor Green
Write-Host ""
Write-Host "Start the guided display-machine setup:" -ForegroundColor Cyan
Write-Host "  cd $repoDir"
Write-Host "  clawpet wizard display"
Write-Host ""
Write-Host "Or try demo mode first (no OpenClaw pairing required):" -ForegroundColor Cyan
Write-Host "  cd $repoDir"
Write-Host "  Start-Process powershell -ArgumentList '-NoExit','-Command','npm run runtime:demo'"
Write-Host "  npm run desktop:dev"
Write-Host ""
Write-Host "Cross-machine pairing flow:" -ForegroundColor Cyan
Write-Host "  # on this display machine, start the runtime:"
Write-Host "  cd $repoDir"
Write-Host "  Start-Process powershell -ArgumentList '-NoExit','-Command','npm run runtime:tailscale'"
Write-Host "  # then open pair mode on this display machine:"
Write-Host "  clawpet pair-mode"
Write-Host "  # on the OpenClaw machine, claim the shown code:"
Write-Host "  clawpet pair --code <6-digit-code> --host ${displayHost}:8737" -ForegroundColor Yellow
