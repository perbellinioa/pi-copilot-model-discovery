import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { CopilotCatalogModel, FetchCatalogResult } from "./types.js";

export type FetchImplementation = typeof globalThis.fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isCatalogModel(value: unknown): value is CopilotCatalogModel {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function requestHeaders(token: string, providerHeaders: ProviderHeaders | undefined): Headers {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
  for (const [name, value] of Object.entries(providerHeaders ?? {})) {
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export async function fetchCopilotCatalog(
  token: string,
  baseUrl: string,
  providerHeaders: ProviderHeaders | undefined,
  signal: AbortSignal,
  fetchImplementation: FetchImplementation = globalThis.fetch,
): Promise<FetchCatalogResult> {
  const response = await fetchImplementation(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: requestHeaders(token, providerHeaders),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Copilot /models returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json() as unknown;
  const data = isRecord(payload) ? payload.data : undefined;
  if (!Array.isArray(data)) throw new Error("Copilot /models returned an invalid catalog");

  const lastModifiedHeader = response.headers.get("last-modified");
  const parsedLastModified = lastModifiedHeader ? Date.parse(lastModifiedHeader) : Number.NaN;
  return {
    models: data.filter(isCatalogModel),
    etag: response.headers.get("etag") ?? undefined,
    lastModified: Number.isFinite(parsedLastModified) ? parsedLastModified : undefined,
  };
}
