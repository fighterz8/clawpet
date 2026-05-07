# Release smoke test notes

Current local packaging commands:

```bash
npm run desktop:build   # release app binary, no bundle
npm exec tauri build    # full Linux bundle build
```

On Linux this produces:

- `src-tauri/target/release/bundle/deb/Clawpals_0.2.0_amd64.deb`
- `src-tauri/target/release/bundle/rpm/Clawpals-0.2.0-1.x86_64.rpm`
- `src-tauri/target/release/bundle/appimage/Clawpals_0.2.0_amd64.AppImage`

Smoke checks used on the OpenClaw Linux host:

```bash
timeout 8s xvfb-run -a src-tauri/target/release/app
timeout 8s xvfb-run -a src-tauri/target/release/bundle/appimage/Clawpals_0.2.0_amd64.AppImage
```

Latest smoke after runtime-ownership/reconnect/status-dot work: 2026-05-05.

Expected result in headless smoke mode:

- process starts successfully
- internal runtime logs `Clawpals internal runtime listening on 0.0.0.0:8737`
- timeout exits with code `124` because the app stays running
- EGL/DRI warnings under Xvfb are acceptable for this smoke test
- setup/overlay bundle includes the current reconnect diagnostics and green/yellow/red status-dot semantics

Cross-platform notes:

- Linux bundles can be produced and smoke-tested on Linux.
- `.github/workflows/desktop-build.yml` builds Linux, Windows, and macOS desktop artifacts on native GitHub-hosted runners for pushes, PRs, tags, and manual dispatch.
- Windows `.exe`/MSI and macOS `.dmg` should still be opened/smoke-tested on their target OSes before calling a release ready.
- Signed releases are not configured yet.
