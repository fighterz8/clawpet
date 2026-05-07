# Clawpals Design Principles

## Local-first

The runtime should work locally without requiring a cloud service. Cloud-hosted docs and previews are fine, but the companion itself should be user-owned and local by default.

## Lightweight

Clawpals should feel smaller than a dashboard. It should use minimal CPU/RAM, avoid heavy animation systems in the MVP, and be easy to hide or quit.

## Non-intrusive

The avatar should stay out of the way:

- click-through mode
- corner docking
- optional messages
- quiet defaults
- user override controls

## Agent-controlled, user-owned

OpenClaw can request state changes, but the user controls whether the avatar is visible, muted, paused, or disabled.

## Useful before cute

The avatar should communicate real state: thinking, blocked, alert, complete, idle, quiet hours, project health. Cuteness is a layer on top of utility.

## Composable assets

Avatar packs should be ordinary folders with manifests and assets. Users should be able to create, edit, share, and version them.

## Hackable and open

The project should be easy for other builders to fork, understand, and extend. Specs and ADRs matter as much as code.

## Honest emotional design

The avatar can be warm and expressive, but should not manipulate the user or pretend to be more autonomous than it is. It represents agent/app state, not a living being with independent needs.
