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
import type { CopilotCatalogModel } from "./types.js";

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

interface RefreshTarget {
  baseUrl: string;
  cacheKey: string;
}

function credentialToken(credential: Credential): string | undefined {
  if (credential.type === "oauth") return credential.access;
  return credential.key;
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
    cacheKey: string,
    baseUrl: string,
  ): Promise<void> {
    if (!options.cache || cachedCatalog || state.source !== "builtin") return;
    cachedCatalog = await options.cache.read(cacheKey);
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

  async function writeCache(cacheKey: string, catalog: CachedCatalog): Promise<void> {
    if (!options.cache) return;
    try {
      await options.cache.write(cacheKey, catalog);
      state.cacheError = undefined;
    } catch (error) {
      state.cacheError = error instanceof Error ? error.message : String(error);
    }
  }

  async function prepareTarget(
    context: RefreshModelsContext,
    credential: Credential,
    token: string,
  ): Promise<RefreshTarget> {
    const baseUrl = await resolveBaseUrl(builtin, credential, token);
    const cacheKey = catalogCacheKey(baseUrl, credential);
    if (activeCacheKey !== cacheKey) {
      activeCacheKey = cacheKey;
      cachedCatalog = undefined;
      if (state.source !== "builtin") await publishModels(context, builtinModels, "builtin", 0);
    }
    await loadCache(context, cacheKey, baseUrl);
    return { baseUrl, cacheKey };
  }

  async function applyNotModified(
    cacheKey: string,
    result: { etag?: string; lastModified?: number },
    checkedAt: number,
  ): Promise<void> {
    if (!cachedCatalog) throw new Error("Copilot returned 304 without a cached catalog");
    cachedCatalog = createCachedCatalog({
      ...cachedCatalog,
      checkedAt,
      etag: result.etag ?? cachedCatalog.etag,
      lastModified: result.lastModified ?? cachedCatalog.lastModified,
    });
    state.cacheAgeMs = 0;
    state.lastRefresh = checkedAt;
    state.error = undefined;
    await writeCache(cacheKey, cachedCatalog);
  }

  async function applyModified(
    context: RefreshModelsContext,
    target: RefreshTarget,
    result: {
      models: CopilotCatalogModel[];
      etag?: string;
      lastModified?: number;
    },
    checkedAt: number,
  ): Promise<void> {
    const converted = convertCatalog(result.models, {
      baseUrl: target.baseUrl,
      fallbackHeaders,
      builtinModels,
    });
    if (converted.models.length === 0) {
      throw new Error(`Copilot discovery produced no usable models (${converted.skipped.length} skipped)`);
    }
    const nextCache = createCachedCatalog({
      checkedAt,
      baseUrl: target.baseUrl,
      etag: result.etag,
      lastModified: result.lastModified,
      models: result.models,
    });
    if (await publishModels(context, converted.models, "live", converted.skipped.length)) {
      cachedCatalog = nextCache;
      state.cacheAgeMs = 0;
      state.lastRefresh = checkedAt;
      state.error = undefined;
      await writeCache(target.cacheKey, nextCache);
    }
  }

  async function revalidate(
    context: RefreshModelsContext,
    token: string,
    target: RefreshTarget,
  ): Promise<void> {
    const started = performance.now();
    state.networkRequests += 1;
    try {
      const result = await fetchCopilotCatalog({
        token,
        baseUrl: target.baseUrl,
        providerHeaders: fallbackHeaders,
        validators: cachedCatalog,
        signal: context.signal,
        fetchImplementation: options.fetchImplementation,
      });
      const checkedAt = now();
      if (result.status === "not-modified") {
        await applyNotModified(target.cacheKey, result, checkedAt);
      } else {
        await applyModified(context, target, result, checkedAt);
      }
    } finally {
      state.lastDurationMs = performance.now() - started;
    }
  }

  async function refreshModels(context: RefreshModelsContext): Promise<void> {
    if (context.signal.aborted) return;
    state.lastDurationMs = undefined;
    const credential = context.credential;
    if (!credential) return;
    const token = credentialToken(credential);
    if (!token) return;

    try {
      const target = await prepareTarget(context, credential, token);
      if (!context.allowNetwork) return;

      const cacheAge = cachedCatalog ? Math.max(0, now() - cachedCatalog.checkedAt) : undefined;
      state.cacheAgeMs = cacheAge;
      if (!context.force && cacheAge !== undefined && cacheAge < cacheTtlMs) {
        state.error = undefined;
        return;
      }
      await revalidate(context, token, target);
    } catch (error) {
      if (context.signal.aborted) return;
      state.error = error instanceof Error ? error.message : String(error);
      state.lastRefresh = now();
    }
  }

  const provider: Provider<Api> = {
    id: builtin.id,
    name: builtin.name,
    baseUrl: builtin.baseUrl,
    headers: builtin.headers,
    auth: builtin.auth,
    getModels: () => currentModels,
    refreshModels,
    // The authenticated live catalog is authoritative. Reapplying the built-in
    // static ID filter would hide newly discovered tenant models.
    filterModels: (models) => models,
    stream: (model, context, streamOptions) => builtin.stream(model, context, streamOptions),
    streamSimple: (model, context, streamOptions) => builtin.streamSimple(model, context, streamOptions),
    fetchDeferred: builtin.fetchDeferred
      ? (model, handle, fetchOptions) => builtin.fetchDeferred!(model, handle, fetchOptions)
      : undefined,
    cancelDeferred: builtin.cancelDeferred
      ? (model, handle, cancelOptions) => builtin.cancelDeferred!(model, handle, cancelOptions)
      : undefined,
  };

  return { provider, state };
}
