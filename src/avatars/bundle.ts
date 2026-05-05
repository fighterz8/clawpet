import { avatarStates, type AvatarState } from "../contracts/avatarEvent";

export const AVATAR_BUNDLE_SCHEMA_VERSION = "0.1.0" as const;
export const AVATAR_BUNDLE_FRAME_SCHEMA_VERSION = "0.5.0" as const;

export const avatarAnimations = ["none", "breathe", "bob", "pulse", "bounce", "shake", "slowBlink"] as const;
export type AvatarAnimation = (typeof avatarAnimations)[number];

export type AvatarAssetStateDefinition = {
  asset: string;
  animation: AvatarAnimation;
  messageStyle?: string;
};

export type AvatarFrameStateDefinition = {
  frames: string[];
  fps: number;
  loop: boolean;
  fallbackAsset: string;
  animation?: AvatarAnimation;
  messageStyle?: string;
};

export type AvatarStateDefinition = AvatarAssetStateDefinition | AvatarFrameStateDefinition;

export type AvatarBundleManifest = {
  schemaVersion: typeof AVATAR_BUNDLE_SCHEMA_VERSION | typeof AVATAR_BUNDLE_FRAME_SCHEMA_VERSION;
  name: string;
  version: string;
  description?: string;
  defaultState: AvatarState;
  states: Partial<Record<AvatarState, AvatarStateDefinition>>;
};

export type ResolvedAvatarBundle = {
  manifest: AvatarBundleManifest;
  baseUrl: string;
  resolveAsset: (state: AvatarState) => { src: string; animation: AvatarAnimation };
  resolveFrames: (state: AvatarState) => { src: string; fps: number; loop: boolean; animation: AvatarAnimation }[];
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeBundleRelativePath(value: unknown): value is string {
  return isString(value) && !value.includes("..") && !/^[a-z]+:\/\//i.test(value) && !value.startsWith("/");
}

function isFrameStateDefinition(def: AvatarStateDefinition): def is AvatarFrameStateDefinition {
  return "frames" in def;
}

export function validateAvatarBundleManifest(input: unknown): ValidationResult<AvatarBundleManifest> {
  const errors: string[] = [];

  if (!isRecord(input)) return { ok: false, errors: ["manifest must be an object"] };
  if (input.schemaVersion !== AVATAR_BUNDLE_SCHEMA_VERSION && input.schemaVersion !== AVATAR_BUNDLE_FRAME_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${AVATAR_BUNDLE_SCHEMA_VERSION} or ${AVATAR_BUNDLE_FRAME_SCHEMA_VERSION}`);
  }
  if (!isString(input.name)) errors.push("name is required");
  if (!isString(input.version)) errors.push("version is required");
  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push("description must be a string");
  }
  if (!avatarStates.includes(input.defaultState as AvatarState)) {
    errors.push("defaultState must be a supported avatar state");
  }
  if (!isRecord(input.states)) {
    errors.push("states must be an object");
  } else {
    for (const [stateKey, def] of Object.entries(input.states)) {
      if (!avatarStates.includes(stateKey as AvatarState)) {
        errors.push(`states.${stateKey} is not a supported state`);
        continue;
      }
      if (!isRecord(def)) {
        errors.push(`states.${stateKey} must be an object`);
        continue;
      }
      const hasAsset = "asset" in def;
      const hasFrames = "frames" in def;
      if (!hasAsset && !hasFrames) {
        errors.push(`states.${stateKey} must define asset or frames`);
        continue;
      }
      if (hasAsset && hasFrames) {
        errors.push(`states.${stateKey} must not define both asset and frames`);
        continue;
      }
      if (hasAsset) {
        if (!isSafeBundleRelativePath(def.asset)) errors.push(`states.${stateKey}.asset must be a bundle-relative path`);
        if (!avatarAnimations.includes(def.animation as AvatarAnimation)) {
          errors.push(`states.${stateKey}.animation must be one of ${avatarAnimations.join(", ")}`);
        }
      }
      if (hasFrames) {
        if (!Array.isArray(def.frames) || def.frames.length === 0) {
          errors.push(`states.${stateKey}.frames must be a non-empty array`);
        } else {
          for (const [i, frame] of def.frames.entries()) {
            if (!isSafeBundleRelativePath(frame)) errors.push(`states.${stateKey}.frames[${i}] must be a bundle-relative path`);
          }
        }
        if (typeof def.fps !== "number" || !Number.isFinite(def.fps) || def.fps <= 0) {
          errors.push(`states.${stateKey}.fps must be a positive number`);
        }
        if (typeof def.loop !== "boolean") errors.push(`states.${stateKey}.loop must be a boolean`);
        if (!isSafeBundleRelativePath(def.fallbackAsset)) {
          errors.push(`states.${stateKey}.fallbackAsset must be a bundle-relative path`);
        }
        if (def.animation !== undefined && !avatarAnimations.includes(def.animation as AvatarAnimation)) {
          errors.push(`states.${stateKey}.animation must be one of ${avatarAnimations.join(", ")}`);
        }
      }
      if (def.messageStyle !== undefined && typeof def.messageStyle !== "string") {
        errors.push(`states.${stateKey}.messageStyle must be a string`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as AvatarBundleManifest };
}

export function resolveBundle(manifest: AvatarBundleManifest, baseUrl: string): ResolvedAvatarBundle {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return {
    manifest,
    baseUrl: normalizedBase,
    resolveAsset(state) {
      const def = manifest.states[state] ?? manifest.states[manifest.defaultState];
      if (!def) {
        throw new Error(`avatar bundle is missing default state asset: ${manifest.defaultState}`);
      }
      const asset = isFrameStateDefinition(def) ? def.fallbackAsset : def.asset;
      return { src: `${normalizedBase}${asset}`, animation: def.animation ?? "none" };
    },
    resolveFrames(state) {
      const def = manifest.states[state] ?? manifest.states[manifest.defaultState];
      if (!def) {
        throw new Error(`avatar bundle is missing default state asset: ${manifest.defaultState}`);
      }
      if (isFrameStateDefinition(def)) {
        return def.frames.map((frame) => ({
          src: `${normalizedBase}${frame}`,
          fps: def.fps,
          loop: def.loop,
          animation: def.animation ?? "none",
        }));
      }
      return [{ src: `${normalizedBase}${def.asset}`, fps: 1, loop: true, animation: def.animation }];
    },
  };
}

export async function loadAvatarBundle(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ResolvedAvatarBundle> {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const manifestUrl = `${normalizedBase}avatar.json`;
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(`failed to load avatar bundle manifest at ${manifestUrl}: HTTP ${response.status}`);
  }
  const data = (await response.json()) as unknown;
  const result = validateAvatarBundleManifest(data);
  if (!result.ok) {
    throw new Error(`invalid avatar bundle manifest: ${result.errors.join("; ")}`);
  }
  return resolveBundle(result.value, normalizedBase);
}
