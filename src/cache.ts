import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import type { CopilotCatalogModel } from "./types.js";

const CACHE_SCHEMA_VERSION = 1;

export interface CachedCatalog {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  checkedAt: number;
  baseUrl: string;
  etag?: string;
  lastModified?: number;
  models: CopilotCatalogModel[];
}

export interface CatalogCache {
  read(key: string): Promise<CachedCatalog | undefined>;
  write(key: string, value: CachedCatalog): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isCachedCatalog(value: unknown): value is CachedCatalog {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== CACHE_SCHEMA_VERSION) return false;
  if (typeof value.checkedAt !== "number" || !Number.isFinite(value.checkedAt)) return false;
  if (typeof value.baseUrl !== "string" || !Array.isArray(value.models)) return false;
  return value.models.every((model) => isRecord(model) && typeof model.id === "string");
}

/** A stable, non-reversible cache partition. No credential material is stored. */
export function catalogCacheKey(baseUrl: string, credential: Credential): string {
  const secret = credential.type === "oauth" ? credential.refresh : credential.key ?? "ambient";
  return createHash("sha256").update(`${baseUrl}\0${secret}`).digest("hex").slice(0, 32);
}

export class FileCatalogCache implements CatalogCache {
  constructor(private readonly directory: string) {}

  private path(key: string): string {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error("Invalid catalog cache key");
    return join(this.directory, `${key}.json`);
  }

  async read(key: string): Promise<CachedCatalog | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path(key), "utf8")) as unknown;
      return isCachedCatalog(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async write(key: string, value: CachedCatalog): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(key);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }
}

export function createCachedCatalog(input: Omit<CachedCatalog, "schemaVersion">): CachedCatalog {
  return { schemaVersion: CACHE_SCHEMA_VERSION, ...input };
}
