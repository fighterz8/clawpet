# Clawpet target install (Windows / PowerShell)
#
# Usage (run on the machine that should host the desktop avatar):
#   irm https://raw.githubusercontent.com/fighterz8/clawpet/main/scripts/install-windows.ps1 | iex
#
# Or, if you already cloned the repo:
#   pwsh -File scripts\install-windows.ps1
#
# What it does:
#   1. Clones (or updates) the Clawpet repo into %USERPROFILE%\clawpet.
#   2. Installs npm deps.
#   3. Ensures Rustup + MSVC C++ Build Tools (for Tauri).
#   4. Generates a runtime auth token if absent.
#   5. Prints the exact `clawpet pair` command to run on the OpenClaw side.
#
# It does NOT auto-start the runtime/desktop; that should be a deliberate user action
# (the desktop overlay needs an interactive session).

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

# Verify MSVC linker
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
Write-Host "==> Installing npm deps..." -ForegroundColor Cyan
npm install
Pop-Location

# Generate token if not already present
$tokenDir = Join-Path $HOME ".openclaw\clawpet"
$tokenFile = Join-Path $tokenDir "runtime-token"
if (-not (Test-Path $tokenFile)) {
  New-Item -ItemType Directory -Force -Path $tokenDir | Out-Null
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object ToString x2) -join "" | Set-Content -NoNewline $tokenFile
}
$token = Get-Content $tokenFile -Raw
$token = $token.Trim()

# Best-effort hostname for cross-machine pairing (Tailscale MagicDNS preferred).
$tailnetHost = $null
try {
  $tailnetHost = (tailscale status --json 2>$null | ConvertFrom-Json).Self.DNSName
  if ($tailnetHost) { $tailnetHost = $tailnetHost.TrimEnd(".") }
} catch { }
$displayHost = if ($tailnetHost) { $tailnetHost } else { $env:COMPUTERNAME }

Write-Host ""
Write-Host "==> Clawpet installed." -ForegroundColor Green
Write-Host ""
Write-Host "To start the desktop avatar (interactive session):" -ForegroundColor Cyan
Write-Host "  cd $repoDir"
Write-Host "  `$env:CLAWPET_RUNTIME_HOST = '0.0.0.0'"
Write-Host "  `$env:CLAWPET_RUNTIME_PORT = '8737'"
Write-Host "  Start-Process powershell -ArgumentList '-NoExit','-Command','npm run runtime:dev'"
Write-Host "  npm run desktop:dev"
Write-Host ""
Write-Host "On the OpenClaw side, pair with:" -ForegroundColor Cyan
Write-Host "  clawpet pair --url http://${displayHost}:8737 --token $token" -ForegroundColor Yellow
Write-Host ""
Write-Host "Token file (keep secret): $tokenFile" -ForegroundColor DarkGray
