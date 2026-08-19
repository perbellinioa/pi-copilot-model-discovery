import type {
  Api,
  Credential,
  Model,
  Provider,
  ProviderHeaders,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { convertCatalog } from "./catalog.js";
import { fetchCopilotCatalog, type FetchImplementation } from "./fetch-catalog.js";

export interface DiscoveryState {
  source: "builtin" | "live";
  modelCount: number;
  skippedCount: number;
  lastRefresh?: number;
  error?: string;
}

export interface DiscoveryProvider {
  provider: Provider<Api>;
  state: DiscoveryState;
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
  fetchImplementation: FetchImplementation = globalThis.fetch,
): DiscoveryProvider {
  const builtinModels = [...builtin.getModels()];
  const fallbackHeaders = sharedModelHeaders(builtinModels);
  let currentModels: readonly Model<Api>[] = builtinModels;
  const state: DiscoveryState = {
    source: "builtin",
    modelCount: builtinModels.length,
    skippedCount: 0,
  };

  async function refreshModels(context: RefreshModelsContext): Promise<void> {
    if (!context.allowNetwork || context.signal.aborted) return;
    const token = credentialToken(context.credential);
    if (!token) return;

    try {
      const baseUrl = await resolveBaseUrl(builtin, context.credential, token);
      const catalog = await fetchCopilotCatalog(token, baseUrl, fallbackHeaders, context.signal, fetchImplementation);
      const converted = convertCatalog(catalog.models, { baseUrl, fallbackHeaders, builtinModels });
      if (converted.models.length === 0) {
        throw new Error(`Copilot discovery produced no usable models (${converted.skipped.length} skipped)`);
      }

      await context.publish({
        update: () => {
          currentModels = converted.models;
          state.source = "live";
          state.modelCount = converted.models.length;
          state.skippedCount = converted.skipped.length;
          state.lastRefresh = Date.now();
          state.error = undefined;
        },
      });
    } catch (error) {
      if (context.signal.aborted) return;
      state.error = error instanceof Error ? error.message : String(error);
      state.lastRefresh = Date.now();
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
