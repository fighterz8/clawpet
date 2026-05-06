import { AVATAR_EVENT_VERSION, resolveBubbleText, type AvatarState, type AvatarStateEvent, type ClawpetStatus } from "../contracts/avatarEvent";

export type RuntimeMode = ClawpetStatus["mode"];
export type RuntimeEventSourceClass = "system signal" | "OpenClaw expression" | "user-requested";
export type RuntimeEventOutcome = "shown" | "replaced" | "suppressed" | "skipped";

export type RuntimeEventLogEntry = {
  event: AvatarStateEvent;
  receivedAt: string;
  latencyMs: number | null;
  sourceClass: RuntimeEventSourceClass;
  outcome: RuntimeEventOutcome;
  reason?: string;
  replacedEventId?: string;
  blockedByEventId?: string;
  lingerMs: number;
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
   * Legacy linger for terminal `happy` state when no explicit class linger is
   * supplied. Default 8s.
   */
  terminalLingerMs?: number;
  /**
   * Legacy linger for ordinary active states when no explicit class linger is
   * supplied. Default 45s.
   */
  activeLingerMs?: number;
  /** ms after going idle before transitioning to sleepy. Default 5min. 0 disables. */
  sleepyAfterMs?: number;
  /** Deprecated and ignored; retained for old fixtures. */
  bubbleTtlMs?: number;
  /** Minimum spacing between shown OpenClaw expressions. */
  expressionCooldownMs?: number;
  /** Duplicate expression suppression window. */
  expressionDuplicateWindowMs?: number;
};

type ForegroundEvent = {
  eventId: string;
  state: AvatarState;
  bubble?: string;
  sourceClass: RuntimeEventSourceClass;
  shownAtMs: number;
  displayUntilMs: number;
};

const SOURCE_PRIORITY: Record<RuntimeEventSourceClass, number> = {
  "system signal": 1,
  "OpenClaw expression": 2,
  "user-requested": 3,
};

function metadataString(event: AvatarStateEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataNumber(event: AvatarStateEvent, key: string): number | undefined {
  const value = event.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function inferSourceClass(event: AvatarStateEvent): RuntimeEventSourceClass {
  const explicit = metadataString(event, "sourceClass");
  if (explicit === "system signal" || explicit === "OpenClaw expression" || explicit === "user-requested") return explicit;

  const display = event.source.displayName?.toLowerCase() ?? "";
  const instance = event.source.instanceId?.toLowerCase() ?? "";
  const joined = `${display} ${instance}`;

  if (instance === "clawpet-user-requested" || display === "user-requested") return "user-requested";
  if (joined.includes("expression") || joined.includes("openclaw")) return "OpenClaw expression";
  return "system signal";
}

function clampLingerMs(value: number): number {
  return Math.max(0, Math.min(value, 60 * 60 * 1000));
}

export class RuntimeStateStore {
  private readonly runtimeId: string;
  private readonly deviceName: string;
  private readonly mode: RuntimeMode;
  private avatarId: string;
  private bundleVersion?: string;
  private readonly maxEvents: number;
  private readonly now: () => Date;
  private connected = true;
  private lastEventAt?: string;
  private lastEventAtMs?: number;
  private lastLatencyMs?: number;
  private pairedOpenClaw?: ClawpetStatus["pairedOpenClaw"];
  private events: RuntimeEventLogEntry[] = [];
  private readonly terminalLingerMs: number;
  private readonly activeLingerMs: number;
  private readonly sleepyAfterMs: number;
  private readonly expressionCooldownMs: number;
  private readonly expressionDuplicateWindowMs: number;
  private foreground?: ForegroundEvent;
  private idleSinceMs?: number;
  private lastShownExpressionAtMs?: number;
  private lastExpressionFingerprint?: string;
  private lastExpressionFingerprintAtMs?: number;

  constructor(options: RuntimeStateStoreOptions = {}) {
    this.runtimeId = options.runtimeId ?? "clawpet-local-runtime";
    this.deviceName = options.deviceName ?? "Local Clawpet";
    this.mode = options.mode ?? "local";
    this.avatarId = options.avatarId ?? "dawn-v0";
    this.bundleVersion = options.bundleVersion ?? "0.1.0";
    this.maxEvents = options.maxEvents ?? 50;
    this.now = options.now ?? (() => new Date());
    this.terminalLingerMs = options.terminalLingerMs ?? 8000;
    this.activeLingerMs = options.activeLingerMs ?? 45 * 1000;
    this.sleepyAfterMs = options.sleepyAfterMs ?? 5 * 60 * 1000;
    this.expressionCooldownMs = options.expressionCooldownMs ?? 6000;
    this.expressionDuplicateWindowMs = options.expressionDuplicateWindowMs ?? 20_000;
    this.idleSinceMs = this.now().getTime();
  }

  private currentMs(): number {
    return this.now().getTime();
  }

  private activeForeground(nowMs = this.currentMs()): ForegroundEvent | undefined {
    const fg = this.foreground;
    if (!fg) return undefined;
    if (nowMs < fg.displayUntilMs) return fg;
    if (this.idleSinceMs == null || this.idleSinceMs < fg.displayUntilMs) this.idleSinceMs = fg.displayUntilMs;
    this.foreground = undefined;
    return undefined;
  }

  private defaultLingerFor(event: AvatarStateEvent, sourceClass: RuntimeEventSourceClass): number {
    const explicit = metadataNumber(event, "lingerMs");
    if (explicit !== undefined) return clampLingerMs(explicit);
    if (typeof event.ttlMs === "number" && Number.isFinite(event.ttlMs)) return clampLingerMs(event.ttlMs);
    if (sourceClass === "user-requested") return 14_000;
    if (sourceClass === "OpenClaw expression") return 10_000;
    if (event.state === "happy") return this.terminalLingerMs;
    return Math.min(this.activeLingerMs, 2_000);
  }

  private expressionFingerprint(event: AvatarStateEvent): string {
    const bubble = resolveBubbleText(event).toLowerCase();
    const message = (event.message ?? "").trim().toLowerCase();
    return `${event.state}|${bubble}|${message}`;
  }

  applyEvent(event: AvatarStateEvent): RuntimeEventLogEntry {
    const receivedAtDate = this.now();
    const nowMs = receivedAtDate.getTime();
    const receivedAt = receivedAtDate.toISOString();
    const sentAtMs = Date.parse(event.sentAt);
    const latencyMs = Number.isFinite(sentAtMs) ? Math.max(0, nowMs - sentAtMs) : null;
    const sourceClass = inferSourceClass(event);
    const lingerMs = this.defaultLingerFor(event, sourceClass);
    const bubble = resolveBubbleText(event) || undefined;

    this.pairedOpenClaw = {
      instanceId: event.source.instanceId,
      displayName: event.source.displayName,
    };

    const active = this.activeForeground(nowMs);

    let outcome: RuntimeEventOutcome = "shown";
    let reason: string | undefined;
    let replacedEventId: string | undefined;
    let blockedByEventId: string | undefined;

    if (sourceClass === "OpenClaw expression") {
      const fingerprint = this.expressionFingerprint(event);
      if (
        this.lastExpressionFingerprint === fingerprint &&
        this.lastExpressionFingerprintAtMs != null &&
        nowMs - this.lastExpressionFingerprintAtMs < this.expressionDuplicateWindowMs
      ) {
        outcome = "skipped";
        reason = "duplicate expression";
      } else if (
        this.lastShownExpressionAtMs != null &&
        nowMs - this.lastShownExpressionAtMs < this.expressionCooldownMs
      ) {
        outcome = "skipped";
        reason = "cooldown";
      }

      this.lastExpressionFingerprint = fingerprint;
      this.lastExpressionFingerprintAtMs = nowMs;
    }

    if (outcome === "shown" && active) {
      const incomingPriority = SOURCE_PRIORITY[sourceClass];
      const activePriority = SOURCE_PRIORITY[active.sourceClass];
      if (incomingPriority < activePriority) {
        outcome = "suppressed";
        blockedByEventId = active.eventId;
        reason = active.sourceClass === "OpenClaw expression"
          ? "active OpenClaw expression"
          : active.sourceClass === "user-requested"
            ? "active user-requested emit"
            : "active system signal";
      } else if (incomingPriority === activePriority && sourceClass === "OpenClaw expression") {
        outcome = "replaced";
        replacedEventId = active.eventId;
        reason = "newer OpenClaw expression";
      } else if (incomingPriority === activePriority && sourceClass === "system signal") {
        outcome = "replaced";
        replacedEventId = active.eventId;
        reason = "newer system signal";
      } else if (incomingPriority === activePriority && sourceClass === "user-requested") {
        outcome = "replaced";
        replacedEventId = active.eventId;
        reason = "newer user-requested emit";
      } else if (incomingPriority > activePriority) {
        outcome = "replaced";
        replacedEventId = active.eventId;
        reason = sourceClass === "user-requested" ? "user-requested override" : `replaced ${active.sourceClass}`;
      }
    }

    if (outcome === "shown" || outcome === "replaced") {
      this.foreground = {
        eventId: event.eventId,
        state: event.state,
        bubble,
        sourceClass,
        shownAtMs: nowMs,
        displayUntilMs: nowMs + lingerMs,
      };
      this.idleSinceMs = undefined;
      this.lastEventAt = receivedAt;
      this.lastEventAtMs = nowMs;
      this.lastLatencyMs = latencyMs ?? undefined;
      if (sourceClass === "OpenClaw expression") this.lastShownExpressionAtMs = nowMs;
    }

    const entry: RuntimeEventLogEntry = {
      event,
      receivedAt,
      latencyMs,
      sourceClass,
      outcome,
      ...(reason ? { reason } : {}),
      ...(replacedEventId ? { replacedEventId } : {}),
      ...(blockedByEventId ? { blockedByEventId } : {}),
      lingerMs,
    };

    this.events.unshift(entry);
    this.events = this.events.slice(0, this.maxEvents);
    return entry;
  }

  private effectiveState(): AvatarState {
    const fg = this.activeForeground();
    if (fg) return fg.state;
    if (this.idleSinceMs == null) return "idle";
    if (this.sleepyAfterMs > 0 && this.currentMs() - this.idleSinceMs >= this.sleepyAfterMs) return "sleepy";
    return "idle";
  }

  private effectiveBubble(): string | undefined {
    const fg = this.activeForeground();
    if (fg) return fg.bubble || undefined;
    return this.effectiveState() === "sleepy" ? "idle" : "idle";
  }

  setAvatarBundle(avatarId: string, bundleVersion?: string) {
    this.avatarId = avatarId;
    this.bundleVersion = bundleVersion;
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
