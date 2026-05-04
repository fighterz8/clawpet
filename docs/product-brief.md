# Clawpet Product Brief

## Working name

**Clawpet**

## One-sentence pitch

Clawpet is a local-first avatar runtime that gives OpenClaw an ambient desktop presence through state-driven emotions, lightweight animation, and user-owned avatar bundles.

## Problem

AI assistants usually live as chat windows, logs, or background processes. That makes them powerful but invisible. Users do not always know when the assistant is working, blocked, alerting, idle, or waiting for input.

Traditional dashboards are useful, but they are often heavy and interruptive. Clawpet explores a lighter pattern: an ambient companion that makes agent state visible without demanding attention.

## Solution

Clawpet renders a small desktop avatar controlled by local OpenClaw events. The avatar can show states like idle, thinking, happy, alert, sleepy, or focused, and can display short optional messages.

The avatar is not hardcoded. It is loaded from a local avatar bundle: assets plus a manifest describing states, animation presets, and behavior.

## Target users

- OpenClaw users who want a more visible assistant presence
- AI power users who run local automation
- Developers building local-first AI tools
- Workplace/productivity users who want ambient project or agent status
- Builders interested in expressive, hackable desktop companions

## MVP promise

A lightweight demo and spec for a local avatar companion that can:

- load a file-based avatar bundle
- preview avatar states and emotions
- demonstrate how OpenClaw would control state/messages
- document the path toward a desktop overlay runtime

## Long-term product thesis

AI assistants should not only answer messages. They should have a lightweight, user-controlled presence that reflects what they are doing, what needs attention, and how healthy the surrounding work system is.
