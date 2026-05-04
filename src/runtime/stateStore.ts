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
  private lastLatencyMs?: number;
  private pairedOpenClaw?: ClawpetStatus["pairedOpenClaw"];
  private events: RuntimeEventLogEntry[] = [];

  constructor(options: RuntimeStateStoreOptions = {}) {
    this.runtimeId = options.runtimeId ?? "clawpet-local-runtime";
    this.deviceName = options.deviceName ?? "Local Clawpet";
    this.mode = options.mode ?? "local";
    this.avatarId = options.avatarId ?? "dawn-v0";
    this.bundleVersion = options.bundleVersion ?? "0.1.0";
    this.maxEvents = options.maxEvents ?? 50;
    this.now = options.now ?? (() => new Date());
  }

  applyEvent(event: AvatarStateEvent): RuntimeEventLogEntry {
    const receivedAtDate = this.now();
    const receivedAt = receivedAtDate.toISOString();
    const sentAtMs = Date.parse(event.sentAt);
    const latencyMs = Number.isFinite(sentAtMs) ? Math.max(0, receivedAtDate.getTime() - sentAtMs) : null;

    this.state = event.state;
    this.lastEventAt = receivedAt;
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
        state: this.state,
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
