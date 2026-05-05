import { AVATAR_EVENT_VERSION, type AvatarState, type AvatarStateEvent, type ClawpetStatus } from "../contracts/avatarEvent";

export type RuntimeMode = ClawpetStatus["mode"];

export type RuntimeEventLogEntry = {
  event: AvatarStateEvent;
  receivedAt: string;
  latencyMs: number | null;
};

export type RuntimeStateStoreOptions = {
  runtimeId?: string;
  deviceName?: string;
  mode?: RuntimeMode;
  avatarId?: string;
  bundleVersion?: string;
  maxEvents?: number;
  now?: () => Date;
  /**
   * ms a terminal `happy` state lingers before reverting to idle.
   * Active states (thinking/focused/alert) NEVER auto-decay — they persist
   * until a new event arrives. Default 8s for happy. 0 disables.
   */
  terminalLingerMs?: number;
  /** ms after going idle before transitioning to sleepy. Default 5min. 0 disables. */
  sleepyAfterMs?: number;
  /**
   * Deprecated. Bubbles are sticky now — they only change when a new event sets
   * a new bubble. The option is retained for backward compatibility but is
   * ignored by the store. Kept only so existing test fixtures still type-check.
   */
  bubbleTtlMs?: number;
};

export class RuntimeStateStore {
  private readonly runtimeId: string;
  private readonly deviceName: string;
  private readonly mode: RuntimeMode;
  private readonly avatarId: string;
  private readonly bundleVersion?: string;
  private readonly maxEvents: number;
  private readonly now: () => Date;
  private state: AvatarState = "idle";
  private connected = true;
  private lastEventAt?: string;
  private lastEventAtMs?: number;
  private lastLatencyMs?: number;
  private pairedOpenClaw?: ClawpetStatus["pairedOpenClaw"];
  private events: RuntimeEventLogEntry[] = [];
  private readonly terminalLingerMs: number;
  private readonly sleepyAfterMs: number;
  private lastBubble?: string;

  constructor(options: RuntimeStateStoreOptions = {}) {
    this.runtimeId = options.runtimeId ?? "clawpet-local-runtime";
    this.deviceName = options.deviceName ?? "Local Clawpet";
    this.mode = options.mode ?? "local";
    this.avatarId = options.avatarId ?? "dawn-v0";
    this.bundleVersion = options.bundleVersion ?? "0.1.0";
    this.maxEvents = options.maxEvents ?? 50;
    this.now = options.now ?? (() => new Date());
    this.terminalLingerMs = options.terminalLingerMs ?? 8000;
    this.sleepyAfterMs = options.sleepyAfterMs ?? 5 * 60 * 1000;
  }

  applyEvent(event: AvatarStateEvent): RuntimeEventLogEntry {
    const receivedAtDate = this.now();
    const receivedAt = receivedAtDate.toISOString();
    const sentAtMs = Date.parse(event.sentAt);
    const latencyMs = Number.isFinite(sentAtMs) ? Math.max(0, receivedAtDate.getTime() - sentAtMs) : null;

    this.state = event.state;
    this.lastBubble = event.bubble || event.message;
    this.lastEventAt = receivedAt;
    this.lastEventAtMs = receivedAtDate.getTime();
    this.lastLatencyMs = latencyMs ?? undefined;
    this.pairedOpenClaw = {
      instanceId: event.source.instanceId,
      displayName: event.source.displayName,
    };

    const entry = { event, receivedAt, latencyMs };
    this.events.unshift(entry);
    this.events = this.events.slice(0, this.maxEvents);
    return entry;
  }

  /**
   * Decay rules (pure compute, zero timers, zero LLM cost):
   *
   * - Active states (`thinking`, `focused`, `alert`) PERSIST until a new event
   *   arrives. They never fall back to idle on their own. The avatar reflects
   *   what OpenClaw is currently doing.
   * - Terminal state (`happy`) lingers `terminalLingerMs` then reverts to idle.
   * - `idle` drifts to `sleepy` after `sleepyAfterMs`.
   * - `sleepy` stays.
   */
  private effectiveState(): AvatarState {
    if (this.lastEventAtMs == null) return this.state;
    const elapsed = this.now().getTime() - this.lastEventAtMs;
    if (this.state === "sleepy") return "sleepy";
    if (this.state === "idle") {
      if (this.sleepyAfterMs > 0 && elapsed >= this.sleepyAfterMs) return "sleepy";
      return "idle";
    }
    if (this.state === "happy") {
      if (this.terminalLingerMs > 0 && elapsed >= this.terminalLingerMs) {
        const idleElapsed = elapsed - this.terminalLingerMs;
        if (this.sleepyAfterMs > 0 && idleElapsed >= this.sleepyAfterMs) return "sleepy";
        return "idle";
      }
      return "happy";
    }
    // thinking | focused | alert — persist forever until next event.
    return this.state;
  }

  /**
   * Bubble caption is sticky: once set, it stays under the avatar until a new
   * event sets a new bubble. It does not auto-clear on TTL or on idle.
   * The caption represents the latest meaningful thing OpenClaw was doing,
   * which is still useful even when the avatar has gone idle.
   */
  private effectiveBubble(): string | undefined {
    return this.lastBubble || undefined;
  }

  getStatus(): ClawpetStatus {
    return {
      type: "clawpet.status",
      version: AVATAR_EVENT_VERSION,
      runtimeId: this.runtimeId,
      deviceName: this.deviceName,
      mode: this.mode,
      connected: this.connected,
      pairedOpenClaw: this.pairedOpenClaw,
      avatar: {
        avatarId: this.avatarId,
        state: this.effectiveState(),
        bundleVersion: this.bundleVersion,
        bubble: this.effectiveBubble(),
      },
      lastEventAt: this.lastEventAt,
      latencyMs: this.lastLatencyMs,
    };
  }

  getEvents(): RuntimeEventLogEntry[] {
    return [...this.events];
  }
}
