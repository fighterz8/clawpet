import { avatarStates, type AvatarState } from "../contracts/avatarEvent";

export const AVATAR_BUNDLE_SCHEMA_VERSION = "0.1.0" as const;

export const avatarAnimations = ["none", "breathe", "bob", "pulse", "bounce", "shake", "slowBlink"] as const;
export type AvatarAnimation = (typeof avatarAnimations)[number];

export type AvatarStateDefinition = {
  asset: string;
  animation: AvatarAnimation;
  messageStyle?: string;
};

export type AvatarBundleManifest = {
  schemaVersion: typeof AVATAR_BUNDLE_SCHEMA_VERSION;
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

export function validateAvatarBundleManifest(input: unknown): ValidationResult<AvatarBundleManifest> {
  const errors: string[] = [];

  if (!isRecord(input)) return { ok: false, errors: ["manifest must be an object"] };
  if (input.schemaVersion !== AVATAR_BUNDLE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${AVATAR_BUNDLE_SCHEMA_VERSION}`);
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
      if (!isString(def.asset)) errors.push(`states.${stateKey}.asset is required`);
      if (def.asset && typeof def.asset === "string") {
        if (def.asset.includes("..") || /^[a-z]+:\/\//i.test(def.asset) || def.asset.startsWith("/")) {
          errors.push(`states.${stateKey}.asset must be a bundle-relative path`);
        }
      }
      if (!avatarAnimations.includes(def.animation as AvatarAnimation)) {
        errors.push(`states.${stateKey}.animation must be one of ${avatarAnimations.join(", ")}`);
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
      return {
        src: `${normalizedBase}${def.asset}`,
        animation: def.animation,
      };
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
