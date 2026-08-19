import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Credential } from "@earendil-works/pi-ai";
import { catalogCacheKey, createCachedCatalog, FileCatalogCache } from "../src/cache.js";

const credential = (refresh: string): Credential => ({
  type: "oauth",
  refresh,
  access: "short-lived-access-token",
  expires: Date.now() + 60_000,
});

test("partitions cache by a non-reversible stable credential fingerprint", () => {
  const first = catalogCacheKey("https://copilot.test", credential("secret-refresh-token"));
  const same = catalogCacheKey("https://copilot.test", credential("secret-refresh-token"));
  const other = catalogCacheKey("https://copilot.test", credential("another-token"));
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(first.includes("secret"), false);
});

test("writes and restores an atomic versioned cache without credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-copilot-cache-"));
  try {
    const cache = new FileCatalogCache(directory);
    const value = createCachedCatalog({
      checkedAt: 123,
      baseUrl: "https://copilot.test",
      etag: '"etag"',
      models: [{ id: "model-a" }],
    });
    await cache.write("account", value);
    assert.deepEqual(await cache.read("account"), value);
    const raw = await readFile(join(directory, "account.json"), "utf8");
    assert.equal(raw.includes("token"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects cache-key path traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-copilot-cache-"));
  try {
    const cache = new FileCatalogCache(directory);
    const value = createCachedCatalog({ checkedAt: 1, baseUrl: "https://copilot.test", models: [] });
    await assert.rejects(cache.write("../escape", value), /Invalid catalog cache key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ignores corrupt or incompatible cache files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-copilot-cache-"));
  try {
    const cache = new FileCatalogCache(directory);
    assert.equal(await cache.read("missing"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
