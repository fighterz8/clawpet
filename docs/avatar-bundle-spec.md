# Avatar Bundle Spec

## Goal

An avatar bundle should be a portable folder that describes a character, its visual states, and the animations the runtime can apply.

The bundle should be simple enough for OpenClaw to create or modify quickly.

## Example structure

```txt
avatars/dawn-v0/
  avatar.json
  assets/
    idle.svg
    thinking.svg
    happy.svg
    alert.svg
    sleepy.svg
```

## Example manifest

```json
{
  "schemaVersion": "0.1.0",
  "name": "Dawn",
  "version": "0.1.0",
  "description": "Baby AGI dragon familiar for OpenClaw.",
  "defaultState": "idle",
  "states": {
    "idle": {
      "asset": "assets/idle.svg",
      "animation": "breathe",
      "messageStyle": "quiet"
    },
    "thinking": {
      "asset": "assets/thinking.svg",
      "animation": "pulse",
      "messageStyle": "status"
    },
    "happy": {
      "asset": "assets/happy.svg",
      "animation": "bounce",
      "messageStyle": "celebrate"
    },
    "alert": {
      "asset": "assets/alert.svg",
      "animation": "shake",
      "messageStyle": "attention"
    },
    "sleepy": {
      "asset": "assets/sleepy.svg",
      "animation": "slowBlink",
      "messageStyle": "quiet"
    }
  }
}
```

## Required fields

- `schemaVersion`
- `name`
- `version`
- `defaultState`
- `states`

Each state requires:

- `asset`
- `animation`

## MVP asset formats

Supported first:

- SVG
- PNG
- WebP

Future possibilities:

- layered SVG
- spritesheets
- Lottie
- rigged/skeletal formats

## MVP animation presets

Animations are runtime-defined, not asset-defined:

- `none`
- `breathe`
- `bob`
- `pulse`
- `bounce`
- `shake`
- `slowBlink`

## Safety and privacy

Avatar bundles must not contain:

- API keys
- OAuth tokens
- private user data
- executable scripts in MVP

The runtime should treat bundles as data, not trusted code.
