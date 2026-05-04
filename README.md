# Clawpet

Clawpet is a local-first avatar runtime and design system for giving OpenClaw an ambient desktop presence.

The long-term idea: OpenClaw should be able to design, load, and control a lightweight companion avatar that reflects agent state, project health, emotions, and useful workplace signals.

## MVP direction

This repo starts with a web-based design/demo shell deployable on Vercel, plus docs that define the eventual local desktop overlay runtime.

The production/runtime target is still local-first:

- desktop overlay
- transparent always-on-top window
- avatar bundle manifests
- local API bridge for same-machine OpenClaw
- remote pairing/relay path for OpenClaw hosts running on another machine
- lightweight animations and emotions

The Vercel app is for public documentation, design preview, and sharing progress while the local runtime is built.

## Current status

Phase 0: design pipeline and public demo shell.

## Docs

- [Product brief](docs/product-brief.md)
- [Design principles](docs/design-principles.md)
- [Requirements](docs/requirements.md)
- [UX spec](docs/ux-spec.md)
- [Avatar bundle spec](docs/avatar-bundle-spec.md)
- [Avatar event contract](docs/avatar-event-contract.md)
- [Runtime-first MVP plan](docs/runtime-first-mvp-plan.md)
- [Architecture decision records](docs/adr/)
- [ADR 0004: Support remote OpenClaw hosts](docs/adr/0004-support-remote-openclaw-hosts.md)

## Development

```bash
npm install
npm run dev
npm run build
npm test
```

### Local runtime API

Start the local runtime skeleton:

```bash
npm run runtime:dev
```

Default URL:

```txt
http://127.0.0.1:8737
```

Send a test avatar event:

```bash
npm run send-test -- thinking "Working on Clawpet..."
```

## License

TBD.
