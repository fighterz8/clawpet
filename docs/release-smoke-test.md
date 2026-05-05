# Release smoke test notes

Current local packaging command:

```bash
npm exec tauri build
```

On Linux this produces:

- `src-tauri/target/release/bundle/deb/Clawpet_0.1.0_amd64.deb`
- `src-tauri/target/release/bundle/rpm/Clawpet-0.1.0-1.x86_64.rpm`
- `src-tauri/target/release/bundle/appimage/Clawpet_0.1.0_amd64.AppImage`

Smoke check used on the OpenClaw Linux host:

```bash
timeout 8s xvfb-run -a src-tauri/target/release/bundle/appimage/Clawpet_0.1.0_amd64.AppImage
```

Expected result in headless smoke mode:

- process starts successfully
- internal runtime logs `Clawpet internal runtime listening on 0.0.0.0:8737`
- timeout exits with code `124` because the app stays running
- EGL/DRI warnings under Xvfb are acceptable for this smoke test

Cross-platform notes:

- Linux bundles can be produced on Linux.
- Windows `.exe`/MSI and macOS `.dmg` should be built and smoke-tested on their target OS runners/machines unless a dedicated cross-build workflow is added.
- Signed releases are not configured yet.
