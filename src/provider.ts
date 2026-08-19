import { performance } from "node:perf_hooks";
import type {
  Api,
  Credential,
  Model,
  Provider,
  ProviderHeaders,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import {
  catalogCacheKey,
  createCachedCatalog,
  type CachedCatalog,
  type CatalogCache,
} from "./cache.js";
import { convertCatalog } from "./catalog.js";
import { fetchCopilotCatalog, type FetchImplementation } from "./fetch-catalog.js";

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;

export interface DiscoveryState {
  source: "builtin" | "cache" | "live";
  modelCount: number;
  skippedCount: number;
  cacheHits: number;
  networkRequests: number;
  lastRefresh?: number;
  lastDurationMs?: number;
  cacheAgeMs?: number;
  error?: string;
  cacheError?: string;
}

export interface DiscoveryProvider {
  provider: Provider<Api>;
  state: DiscoveryState;
}

export interface CreateDiscoveryProviderOptions {
  fetchImplementation?: FetchImplementation;
  cache?: CatalogCache;
  cacheTtlMs?: number;
  now?: () => number;
}

function credentialToken(credential: Credential | undefined): string | undefined {
  if (credential?.type === "oauth") return credential.access;
  return credential?.key;
}

function baseUrlFromToken(token: string): string | undefined {
  const proxyHost = token.match(/(?:^|;)proxy-ep=([^;]+)/)?.[1];
  return proxyHost ? `https://${proxyHost.replace(/^proxy\./, "api.")}` : undefined;
}

async function resolveBaseUrl(
  builtin: Provider<Api>,
  credential: Credential | undefined,
  token: string,
): Promise<string> {
  if (credential?.type === "oauth" && builtin.auth.oauth) {
    const auth = await builtin.auth.oauth.toAuth(credential);
    if (auth.baseUrl) return auth.baseUrl;
  }
  const baseUrl = baseUrlFromToken(token) ?? builtin.baseUrl;
  if (!baseUrl) throw new Error("GitHub Copilot provider has no base URL");
  return baseUrl;
}

function sharedModelHeaders(models: readonly Model<Api>[]): ProviderHeaders | undefined {
  return models.find((model) => model.headers && Object.keys(model.headers).length > 0)?.headers;
}

export function createCopilotDiscoveryProvider(
  builtin: Provider<Api>,
  options: CreateDiscoveryProviderOptions = {},
): DiscoveryProvider {
  const builtinModels = [...builtin.getModels()];
  const fallbackHeaders = sharedModelHeaders(builtinModels);
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  let currentModels: readonly Model<Api>[] = builtinModels;
  let activeCacheKey: string | undefined;
  let cachedCatalog: CachedCatalog | undefined;
  const state: DiscoveryState = {
    source: "builtin",
    modelCount: builtinModels.length,
    skippedCount: 0,
    cacheHits: 0,
    networkRequests: 0,
  };

  async function publishModels(
    context: RefreshModelsContext,
    models: readonly Model<Api>[],
    source: DiscoveryState["source"],
    skippedCount: number,
  ): Promise<boolean> {
    return context.publish({
      update: () => {
        currentModels = models;
        state.source = source;
        state.modelCount = models.length;
        state.skippedCount = skippedCount;
      },
    });
  }

  async function loadCache(
    context: RefreshModelsContext,
    key: string,
    baseUrl: string,
  ): Promise<void> {
    if (!options.cache || cachedCatalog || state.source !== "builtin") return;
    cachedCatalog = await options.cache.read(key);
    if (!cachedCatalog || cachedCatalog.baseUrl !== baseUrl) {
      cachedCatalog = undefined;
      return;
    }
    const converted = convertCatalog(cachedCatalog.models, { baseUrl, fallbackHeaders, builtinModels });
    if (converted.models.length === 0) {
      cachedCatalog = undefined;
      return;
    }
    if (await publishModels(context, converted.models, "cache", converted.skipped.length)) {
      state.cacheHits += 1;
      state.cacheAgeMs = Math.max(0, now() - cachedCatalog.checkedAt);
      state.error = undefined;
    }
  }

  async function writeCache(key: string, catalog: CachedCatalog): Promise<void> {
    if (!options.cache) return;
    try {
      await options.cache.write(key, catalog);
      state.cacheError = undefined;
    } catch (error) {
      state.cacheError = error instanceof Error ? error.message : String(error);
    }
  }

  async function refreshModels(context: RefreshModelsContext): Promise<void> {
    if (context.signal.aborted) return;
    const credential = context.credential;
    const token = credentialToken(credential);
    if (!token || !credential) return;

    try {
      const baseUrl = await resolveBaseUrl(builtin, credential, token);
      const key = catalogCacheKey(baseUrl, credential);
      if (activeCacheKey !== key) {
        activeCacheKey = key;
        cachedCatalog = undefined;
        if (state.source !== "builtin") {
          await publishModels(context, builtinModels, "builtin", 0);
        }
      }
      await loadCache(context, key, baseUrl);
      if (!context.allowNetwork) return;

      const cacheAge = cachedCatalog ? Math.max(0, now() - cachedCatalog.checkedAt) : undefined;
      state.cacheAgeMs = cacheAge;
      if (!context.force && cacheAge !== undefined && cacheAge < cacheTtlMs) {
        state.error = undefined;
        return;
      }

      const started = performance.now();
      state.networkRequests += 1;
      try {
        const result = await fetchCopilotCatalog({
          token,
          baseUrl,
          providerHeaders: fallbackHeaders,
          validators: cachedCatalog,
          signal: context.signal,
          fetchImplementation: options.fetchImplementation,
        });
        const checkedAt = now();

        if (result.status === "not-modified") {
          if (!cachedCatalog) throw new Error("Copilot returned 304 without a cached catalog");
          cachedCatalog = createCachedCatalog({
            ...cachedCatalog,
            checkedAt,
            etag: result.etag ?? cachedCatalog.etag,
            lastModified: result.lastModified ?? cachedCatalog.lastModified,
          });
          await writeCache(key, cachedCatalog);
          state.cacheAgeMs = 0;
          state.lastRefresh = checkedAt;
          state.error = undefined;
          return;
        }

        const converted = convertCatalog(result.models, { baseUrl, fallbackHeaders, builtinModels });
        if (converted.models.length === 0) {
          throw new Error(`Copilot discovery produced no usable models (${converted.skipped.length} skipped)`);
        }
        const nextCache = createCachedCatalog({
          checkedAt,
          baseUrl,
          etag: result.etag,
          lastModified: result.lastModified,
          models: result.models,
        });
        if (await publishModels(context, converted.models, "live", converted.skipped.length)) {
          cachedCatalog = nextCache;
          state.cacheAgeMs = 0;
          state.lastRefresh = checkedAt;
          state.error = undefined;
          await writeCache(key, nextCache);
        }
      } finally {
        state.lastDurationMs = performance.now() - started;
      }
    } catch (error) {
      if (context.signal.aborted) return;
      state.error = error instanceof Error ? error.message : String(error);
      state.lastRefresh = now();
    }
  }

  const provider = {
    ...builtin,
    getModels: () => currentModels,
    refreshModels,
    // The live endpoint has already applied picker and policy availability.
    // Avoid filtering it through the built-in static model ID list.
    filterModels: (models: readonly Model<Api>[]) => models,
  } as Provider<Api>;

  return { provider, state };
}
