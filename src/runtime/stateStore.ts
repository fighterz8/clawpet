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
  /** ms after last active event before reverting to idle. Default 8s. 0 disables. */
  idleAfterMs?: number;
  /** ms after going idle before transitioning to sleepy. Default 5min. 0 disables. */
  sleepyAfterMs?: number;
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
  private readonly idleAfterMs: number;
  private readonly sleepyAfterMs: number;

  constructor(options: RuntimeStateStoreOptions = {}) {
    this.runtimeId = options.runtimeId ?? "clawpet-local-runtime";
    this.deviceName = options.deviceName ?? "Local Clawpet";
    this.mode = options.mode ?? "local";
    this.avatarId = options.avatarId ?? "dawn-v0";
    this.bundleVersion = options.bundleVersion ?? "0.1.0";
    this.maxEvents = options.maxEvents ?? 50;
    this.now = options.now ?? (() => new Date());
    this.idleAfterMs = options.idleAfterMs ?? 8000;
    this.sleepyAfterMs = options.sleepyAfterMs ?? 5 * 60 * 1000;
  }

  applyEvent(event: AvatarStateEvent): RuntimeEventLogEntry {
    const receivedAtDate = this.now();
    const receivedAt = receivedAtDate.toISOString();
    const sentAtMs = Date.parse(event.sentAt);
    const latencyMs = Number.isFinite(sentAtMs) ? Math.max(0, receivedAtDate.getTime() - sentAtMs) : null;

    this.state = event.state;
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
   * Decay the applied state on read. Active states fall back to `idle` after
   * `idleAfterMs`; idle then drifts to `sleepy` after `sleepyAfterMs`.
   * Pure compute on read — no timers, no LLM involvement, no token cost.
   */
  private effectiveState(): AvatarState {
    if (this.lastEventAtMs == null) return this.state;
    const elapsed = this.now().getTime() - this.lastEventAtMs;
    if (this.state === "sleepy") return "sleepy";
    if (this.state === "idle") {
      if (this.sleepyAfterMs > 0 && elapsed >= this.sleepyAfterMs) return "sleepy";
      return "idle";
    }
    if (this.idleAfterMs > 0 && elapsed >= this.idleAfterMs) {
      if (this.sleepyAfterMs > 0 && elapsed >= this.idleAfterMs + this.sleepyAfterMs) return "sleepy";
      return "idle";
    }
    return this.state;
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
      },
      lastEventAt: this.lastEventAt,
      latencyMs: this.lastLatencyMs,
    };
  }

  getEvents(): RuntimeEventLogEntry[] {
    return [...this.events];
  }
}
