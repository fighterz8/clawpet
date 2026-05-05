import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { validateAvatarBundleManifest, type AvatarBundleManifest } from "../avatars/bundle";

export type UploadedAvatarBundle = {
  manifest: AvatarBundleManifest;
  assets: Record<string, string>; // bundle-relative path -> base64 PNG bytes
};

export type StoredAvatarAsset = {
  bytes: Uint8Array;
  contentType: string;
};

function safeAssetPath(path: string): string | null {
  if (!path || path.includes("..") || path.startsWith("/") || /^[a-z]+:\/\//i.test(path)) return null;
  if (!/^(assets|frames)\/[A-Za-z0-9._-]+\.png$/.test(path)) return null;
  return path;
}

export class AvatarBundleStore {
  private current?: UploadedAvatarBundle;

  constructor(private readonly dir: string) {
    this.loadFromDisk();
  }

  private manifestPath() { return join(this.dir, "current", "avatar.json"); }
  private assetPath(rel: string) { return join(this.dir, "current", rel.startsWith("frames/") ? "frames" : "assets", basename(rel)); }

  private loadFromDisk() {
    try {
      const manifestFile = this.manifestPath();
      if (!existsSync(manifestFile)) return;
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      const result = validateAvatarBundleManifest(manifest);
      if (!result.ok) return;
      const assets: Record<string, string> = {};
      for (const def of Object.values(result.value.states)) {
        if (!def) continue;
        const paths = "frames" in def ? [...def.frames, def.fallbackAsset] : [def.asset];
        for (const path of paths) {
          const rel = safeAssetPath(path);
          if (!rel) continue;
          const file = this.assetPath(rel);
          if (existsSync(file)) assets[rel] = Buffer.from(readFileSync(file)).toString("base64");
        }
      }
      this.current = { manifest: result.value, assets };
    } catch {
      this.current = undefined;
    }
  }

  getManifest(): AvatarBundleManifest | undefined { return this.current?.manifest; }

  getAsset(rel: string): StoredAvatarAsset | undefined {
    const safe = safeAssetPath(rel);
    if (!safe) return undefined;
    const b64 = this.current?.assets[safe];
    if (!b64) return undefined;
    return { bytes: Buffer.from(b64, "base64"), contentType: "image/png" };
  }

  put(input: unknown): { ok: true; manifest: AvatarBundleManifest; assetCount: number } | { ok: false; errors: string[] } {
    if (typeof input !== "object" || input === null) return { ok: false, errors: ["body must be an object"] };
    const body = input as { manifest?: unknown; assets?: unknown };
    const result = validateAvatarBundleManifest(body.manifest);
    if (!result.ok) return { ok: false, errors: result.errors };
    if (typeof body.assets !== "object" || body.assets === null || Array.isArray(body.assets)) {
      return { ok: false, errors: ["assets must be an object mapping bundle-relative PNG paths to base64"] };
    }
    const assetsInput = body.assets as Record<string, unknown>;
    const required = new Set<string>();
    for (const def of Object.values(result.value.states)) {
      if (!def) continue;
      if ("frames" in def) {
        for (const frame of def.frames) required.add(frame);
        required.add(def.fallbackAsset);
      } else {
        required.add(def.asset);
      }
    }
    const assets: Record<string, string> = {};
    const errors: string[] = [];
    for (const rel of required) {
      const safe = safeAssetPath(rel);
      if (!safe) { errors.push(`invalid asset path: ${rel}`); continue; }
      const b64 = assetsInput[rel];
      if (typeof b64 !== "string" || !b64) { errors.push(`missing asset: ${rel}`); continue; }
      let bytes: Buffer;
      try { bytes = Buffer.from(b64, "base64"); } catch { errors.push(`asset is not base64: ${rel}`); continue; }
      if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
        errors.push(`asset is not a PNG: ${rel}`);
        continue;
      }
      if (bytes.length > 2_500_000) {
        errors.push(`asset too large: ${rel}`);
        continue;
      }
      assets[safe] = bytes.toString("base64");
    }
    if (errors.length) return { ok: false, errors };

    mkdirSync(join(this.dir, "current", "assets"), { recursive: true });
    mkdirSync(join(this.dir, "current", "frames"), { recursive: true });
    writeFileSync(this.manifestPath(), JSON.stringify(result.value, null, 2) + "\n", { mode: 0o600 });
    for (const [rel, b64] of Object.entries(assets)) {
      writeFileSync(this.assetPath(rel), Buffer.from(b64, "base64"), { mode: 0o600 });
    }
    this.current = { manifest: result.value, assets };
    return { ok: true, manifest: result.value, assetCount: Object.keys(assets).length };
  }
}
