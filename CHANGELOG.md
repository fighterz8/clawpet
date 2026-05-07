# Changelog

## v0.2.0 - 2026-05-06

Clawpals moves from a basic paired desktop companion toward a clearer, more legible OpenClaw-side control surface.

### Added
- Split reactivity into distinct **daemon voice** and **OpenClaw expression** controls.
- Added runtime `/reactivity` mirroring for daemon voice, expression level, and heartbeat reactions.
- Added a dedicated **Activity Log** taxonomy with user-facing source labels.
- Added a dedicated **Pairing** tab in the validation console.
- Added richer zero-token **system signal** phrase pools for daemon/system activity.

### Changed
- Promoted the validation console into a 4-tab layout: **Status**, **Pairing**, **Activity Log**, **Settings**.
- Grouped runtime and daemon plumbing under visible **system signal** labeling instead of presenting them as separate avatar voices.
- Removed legacy **activity** as a primary user-facing setting; retained it only as a compatibility alias behind daemon voice / expression level.
- Fixed display-host resolution to use the real host name when env vars are missing, especially on macOS/Tauri runs.
- Improved status/readiness wording so paired-but-idle runtime states no longer look falsely active.
- Increased overlay expression bubble support and sharpened expression gating behavior across `off | low | medium | high`.

### Fixed
- macOS overlay transparency and drag behavior.
- Validation-console clipping/clutter by moving pairing into its own tab.
- Activity-log labeling so user-requested emits are only shown when explicitly requested.
- False-positive linked/active runtime states before real pair/activity events exist.

### Notes
- This release is intended as a **minor** bump because it changes the visible console UX, the reactivity model, and the user-facing event taxonomy.
- Existing installs should continue working through compatibility handling for legacy `activity` payloads.
