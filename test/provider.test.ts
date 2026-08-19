import assert from "node:assert/strict";
import test from "node:test";
import type {
  Api,
  Credential,
  Model,
  ModelsPublication,
  Provider,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import type { CachedCatalog, CatalogCache } from "../src/cache.js";
import { createCopilotDiscoveryProvider } from "../src/provider.js";

class MemoryCache implements CatalogCache {
  value?: CachedCatalog;
  reads = 0;
  writes = 0;
  async read(): Promise<CachedCatalog | undefined> {
    this.reads += 1;
    return this.value;
  }
  async write(_key: string, value: CachedCatalog): Promise<void> {
    this.writes += 1;
    this.value = value;
  }
}

const builtinModel: Model<Api> = {
  id: "static-model",
  name: "Static Model",
  api: "openai-responses",
  provider: "github-copilot",
  baseUrl: "https://copilot.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_000,
  headers: { "User-Agent": "native-header" },
};

function builtinProvider(): Provider<Api> {
  return {
    id: "github-copilot",
    name: "GitHub Copilot",
    baseUrl: "https://copilot.test",
    auth: {
      apiKey: {
        name: "test",
        async resolve() { return undefined; },
      },
    },
    getModels: () => [builtinModel],
    stream() { throw new Error("not used"); },
    streamSimple() { throw new Error("not used"); },
  };
}

const credential: Credential = { type: "api_key", key: "copilot-token" };

function context(options: { allowNetwork: boolean; force?: boolean }): RefreshModelsContext {
  return {
    credential,
    allowNetwork: options.allowNetwork,
    force: options.force,
    signal: new AbortController().signal,
    async publish(publication: ModelsPublication) {
      publication.update?.();
      return true;
    },
  };
}

const liveCatalog = {
  data: [{
    id: "live-model",
    name: "Live Model",
    model_picker_enabled: true,
    supported_endpoints: ["/responses"],
    capabilities: {
      type: "chat",
      limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 64_000 },
      supports: { tool_calls: true, reasoning_effort: ["low", "medium", "high", "max"] },
    },
  }],
};

test("uses built-in fallback, writes live data, restores cache, and revalidates with 304", async () => {
  const cache = new MemoryCache();
  let now = 1_000;
  let requests = 0;
  const liveFetch: typeof globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify(liveCatalog), { status: 200, headers: { etag: '"one"' } });
  };
  const first = createCopilotDiscoveryProvider(builtinProvider(), {
    cache,
    now: () => now,
    fetchImplementation: liveFetch,
  });

  assert.equal(first.state.source, "builtin");
  await first.provider.refreshModels?.(context({ allowNetwork: false }));
  assert.equal(first.state.source, "builtin");
  await first.provider.refreshModels?.(context({ allowNetwork: true }));
  assert.equal(first.state.source, "live");
  assert.equal(first.provider.getModels()[0]?.id, "live-model");
  assert.equal(first.provider.getModels()[0]?.thinkingLevelMap?.minimal, null);
  assert.equal(first.provider.getModels()[0]?.thinkingLevelMap?.max, "max");
  assert.equal(requests, 1);
  assert.equal(cache.writes, 1);
  assert.equal(typeof first.state.lastDurationMs, "number");

  let revalidationHeaders: Headers | undefined;
  const notModifiedFetch: typeof globalThis.fetch = async (_input, init) => {
    requests += 1;
    revalidationHeaders = new Headers(init?.headers);
    return new Response(null, { status: 304, headers: { etag: '"one"' } });
  };
  const second = createCopilotDiscoveryProvider(builtinProvider(), {
    cache,
    now: () => now,
    fetchImplementation: notModifiedFetch,
  });
  await second.provider.refreshModels?.(context({ allowNetwork: false }));
  assert.equal(second.state.source, "cache");
  assert.equal(second.state.lastDurationMs, undefined);
  assert.equal(second.provider.getModels()[0]?.id, "live-model");
  assert.equal(second.state.cacheHits, 1);

  await second.provider.refreshModels?.(context({ allowNetwork: true }));
  assert.equal(requests, 1, "fresh cache must avoid the network");
  assert.equal(second.state.lastDurationMs, undefined, "cache fast path must not report stale network timing");
  assert.equal(second.state.cacheAgeMs, 0);

  now += 10 * 60_000;
  await second.provider.refreshModels?.(context({ allowNetwork: true }));
  assert.equal(requests, 2);
  assert.equal(revalidationHeaders?.get("if-none-match"), '"one"');
  assert.equal(second.provider.getModels()[0]?.id, "live-model");
  assert.equal(second.state.error, undefined);
  assert.equal(typeof second.state.lastDurationMs, "number");
  assert.equal(second.state.cacheAgeMs, 0);
});

test("retains cached models when network revalidation fails", async () => {
  const cache = new MemoryCache();
  const seed = createCopilotDiscoveryProvider(builtinProvider(), {
    cache,
    now: () => 0,
    fetchImplementation: async () => new Response(JSON.stringify(liveCatalog), { status: 200 }),
  });
  await seed.provider.refreshModels?.(context({ allowNetwork: true }));

  const failing = createCopilotDiscoveryProvider(builtinProvider(), {
    cache,
    cacheTtlMs: 0,
    now: () => 1,
    fetchImplementation: async () => { throw new Error("network down"); },
  });
  await failing.provider.refreshModels?.(context({ allowNetwork: true }));
  assert.equal(failing.state.source, "cache");
  assert.equal(failing.provider.getModels()[0]?.id, "live-model");
  assert.match(failing.state.error ?? "", /network down/);
});
