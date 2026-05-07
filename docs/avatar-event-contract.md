# Avatar Event Contract

## Purpose

The avatar event contract defines the small JSON messages OpenClaw sends to Clawpals. The same contract should work for local mode, remote relay mode, and direct tunnel mode.

Events are UI/status messages only. They must never execute code.

## Core event: `avatar.state`

```json
{
  "type": "avatar.state",
  "version": "0.1.0",
  "eventId": "evt_01h...",
  "sentAt": "2026-05-04T19:30:00.000Z",
  "source": {
    "kind": "openclaw",
    "instanceId": "openclaw-home-server",
    "displayName": "Nick's OpenClaw"
  },
  "target": {
    "deviceId": "nick-main-pc",
    "avatarId": "dawn-v0"
  },
  "state": "thinking",
  "message": "Inspecting the repo...",
  "ttlMs": 8000,
  "priority": "normal"
}
```

## Fields

### Required

- `type`: event type, initially `avatar.state`
- `version`: contract version
- `eventId`: unique event id
- `sentAt`: ISO timestamp
- `source.kind`: usually `openclaw`
- `state`: desired avatar state

### Optional

- `source.instanceId`
- `source.displayName`
- `target.deviceId`
- `target.avatarId`
- `message`
- `ttlMs`
- `priority`
- `correlationId`
- `metadata`

## Supported states

Initial state enum:

- `idle`
- `thinking`
- `focused`
- `happy`
- `alert`
- `sleepy`

Future states may be added, but runtimes must safely fall back to `idle` or `alert` for unknown states.

## Priority

- `low`: quiet/non-urgent update
- `normal`: default status update
- `high`: user attention likely needed
- `critical`: urgent, persistent until acknowledged if supported

## Message rules

- Messages should be short.
- Runtime may truncate long messages.
- Runtime may ignore messages when muted.
- Events must not include secrets, OAuth codes, passwords, private email bodies, or raw tool outputs.

## Runtime status response

A Clawpals runtime should be able to report status:

```json
{
  "type": "clawpals.status",
  "version": "0.1.0",
  "runtimeId": "clawpals-nick-main-pc",
  "deviceName": "Nick Main PC",
  "mode": "local",
  "connected": true,
  "pairedOpenClaw": {
    "instanceId": "openclaw-home-server",
    "displayName": "Nick's OpenClaw"
  },
  "avatar": {
    "avatarId": "dawn-v0",
    "state": "idle",
    "bundleVersion": "0.1.0"
  },
  "lastEventAt": "2026-05-04T19:30:00.000Z",
  "latencyMs": 42
}
```

## Local API sketch

```http
GET /health
GET /status
POST /avatar/state
POST /avatar/reload
POST /diagnostics/ping
```

## Security requirements

- Remote events require authenticated pairing/token.
- Local API should bind to localhost by default.
- If local API is exposed beyond localhost, authentication must be enabled.
- Reject oversized payloads.
- Reject unknown event types unless explicitly supported.
- Treat all fields as untrusted UI data.
- Never execute scripts from event payloads or avatar manifests.

## Latency measurement

For diagnostics, event handlers should track:

- `sentAt`
- `receivedAt`
- `renderedAt` when possible

This enables simple metrics:

- transport latency: `receivedAt - sentAt`
- render latency: `renderedAt - receivedAt`
- total latency: `renderedAt - sentAt`
