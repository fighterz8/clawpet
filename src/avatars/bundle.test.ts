import { describe, expect, it, vi } from "vitest";
import {
  AVATAR_BUNDLE_FRAME_SCHEMA_VERSION,
  AVATAR_BUNDLE_SCHEMA_VERSION,
  loadAvatarBundle,
  resolveBundle,
  validateAvatarBundleManifest,
} from "./bundle";

const validManifest = {
  schemaVersion: AVATAR_BUNDLE_SCHEMA_VERSION,
  name: "Dawn",
  version: "0.1.0",
  defaultState: "idle",
  states: {
    idle: { asset: "assets/idle.svg", animation: "breathe" },
    happy: { asset: "assets/happy.svg", animation: "bounce" },
  },
};

const validFrameManifest = {
  schemaVersion: AVATAR_BUNDLE_FRAME_SCHEMA_VERSION,
  name: "Dawn",
  version: "0.5.0",
  defaultState: "idle",
  states: {
    idle: { frames: ["frames/idle-0.png", "frames/idle-1.png"], fps: 4, loop: true, fallbackAsset: "assets/idle.png" },
    focused: { frames: ["frames/focused-0.png"], fps: 1, loop: false, fallbackAsset: "assets/focused.png" },
  },
};

describe("validateAvatarBundleManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validateAvatarBundleManifest(validManifest);
    expect(result.ok).toBe(true);
  });

  it("accepts v0.5 frame manifests with variable frame counts", () => {
    const result = validateAvatarBundleManifest(validFrameManifest);
    expect(result.ok).toBe(true);
  });

  it("rejects empty frame lists", () => {
    const bad = { ...validFrameManifest, states: { idle: { frames: [], fps: 4, loop: true, fallbackAsset: "assets/idle.png" } } };
    const result = validateAvatarBundleManifest(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects unknown state keys", () => {
    const bad = { ...validManifest, states: { ...validManifest.states, dancing: { asset: "x.svg", animation: "bob" } } };
    const result = validateAvatarBundleManifest(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects unknown animation", () => {
    const bad = { ...validManifest, states: { idle: { asset: "x.svg", animation: "explode" } } };
    const result = validateAvatarBundleManifest(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects path-traversal or absolute asset paths", () => {
    const bad = { ...validManifest, states: { idle: { asset: "../etc/passwd", animation: "breathe" } } };
    const result = validateAvatarBundleManifest(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects external asset URLs", () => {
    const bad = { ...validManifest, states: { idle: { asset: "https://evil.example/x.svg", animation: "breathe" } } };
    const result = validateAvatarBundleManifest(bad);
    expect(result.ok).toBe(false);
  });

  it("rejects unsafe frame paths", () => {
    const bad = { ...validFrameManifest, states: { idle: { frames: ["https://evil.example/x.png"], fps: 4, loop: true, fallbackAsset: "assets/idle.png" } } };
    const result = validateAvatarBundleManifest(bad);
    expect(result.ok).toBe(false);
  });
});

describe("resolveBundle", () => {
  it("resolves asset URLs and falls back to default state", () => {
    const bundle = resolveBundle(validManifest as never, "/avatars/dawn-v0/");
    expect(bundle.resolveAsset("idle")).toEqual({ src: "/avatars/dawn-v0/assets/idle.svg", animation: "breathe" });
    expect(bundle.resolveAsset("alert")).toEqual({ src: "/avatars/dawn-v0/assets/idle.svg", animation: "breathe" });
  });

  it("resolves frame URLs and single-asset manifests as one-frame loops", () => {
    const frameBundle = resolveBundle(validFrameManifest as never, "/avatars/dawn-v1/");
    expect(frameBundle.resolveAsset("idle")).toEqual({ src: "/avatars/dawn-v1/assets/idle.png", animation: "none" });
    expect(frameBundle.resolveFrames("idle")).toEqual([
      { src: "/avatars/dawn-v1/frames/idle-0.png", fps: 4, loop: true, animation: "none" },
      { src: "/avatars/dawn-v1/frames/idle-1.png", fps: 4, loop: true, animation: "none" },
    ]);

    const assetBundle = resolveBundle(validManifest as never, "/avatars/dawn-v0/");
    expect(assetBundle.resolveFrames("happy")).toEqual([
      { src: "/avatars/dawn-v0/assets/happy.svg", fps: 1, loop: true, animation: "bounce" },
    ]);
  });
});

describe("loadAvatarBundle", () => {
  it("fetches and validates the manifest", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(validManifest), { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof fetch;
    const bundle = await loadAvatarBundle("/avatars/dawn-v0", fetchImpl);
    expect(bundle.manifest.name).toBe("Dawn");
    expect(bundle.resolveAsset("happy").src).toBe("/avatars/dawn-v0/assets/happy.svg");
  });

  it("throws on invalid manifest", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ schemaVersion: "0.0.0" }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(loadAvatarBundle("/avatars/dawn-v0", fetchImpl)).rejects.toThrow(/invalid avatar bundle/);
  });
});
