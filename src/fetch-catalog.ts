import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type {
  CatalogValidators,
  CopilotCatalogModel,
  FetchCatalogResult,
} from "./types.js";

export type FetchImplementation = typeof globalThis.fetch;

export interface FetchCatalogOptions {
  token: string;
  baseUrl: string;
  providerHeaders?: ProviderHeaders;
  validators?: CatalogValidators;
  signal: AbortSignal;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const asNumber = (value: unknown): number | undefined => typeof value === "number" ? value : undefined;
const asBoolean = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
const asRecord = (value: unknown): Record<string, unknown> | undefined => isRecord(value) ? value : undefined;
const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

/** Keep only fields consumed by conversion before caching provider data. */
function parseCatalogModel(value: unknown): CopilotCatalogModel | undefined {
  const raw = asRecord(value);
  const id = asString(raw?.id);
  if (!raw || !id) return undefined;
  const capabilities = asRecord(raw.capabilities);
  const limits = asRecord(capabilities?.limits);
  const supports = asRecord(capabilities?.supports);
  const policyState = asString(asRecord(raw.policy)?.state);

  return {
    id,
    name: asString(raw.name),
    model_picker_enabled: asBoolean(raw.model_picker_enabled),
    supported_endpoints: asStringArray(raw.supported_endpoints),
    policy: policyState === "enabled" || policyState === "disabled" || policyState === "unconfigured"
      ? { state: policyState }
      : undefined,
    capabilities: capabilities ? {
      type: asString(capabilities.type),
      limits: limits ? {
        max_context_window_tokens: asNumber(limits.max_context_window_tokens),
        max_output_tokens: asNumber(limits.max_output_tokens),
        max_prompt_tokens: asNumber(limits.max_prompt_tokens),
      } : undefined,
      supports: supports ? {
        adaptive_thinking: asBoolean(supports.adaptive_thinking),
        max_thinking_budget: asNumber(supports.max_thinking_budget),
        reasoning_effort: asStringArray(supports.reasoning_effort),
        tool_calls: asBoolean(supports.tool_calls),
        vision: asBoolean(supports.vision),
      } : undefined,
    } : undefined,
  };
}

function requestHeaders(
  token: string,
  providerHeaders: ProviderHeaders | undefined,
  validators: CatalogValidators | undefined,
): Headers {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
  for (const [name, value] of Object.entries(providerHeaders ?? {})) {
    if (value !== null) headers.set(name, value);
  }
  if (validators?.etag) headers.set("If-None-Match", validators.etag);
  if (validators?.lastModified) headers.set("If-Modified-Since", new Date(validators.lastModified).toUTCString());
  return headers;
}

function responseValidators(response: Response): CatalogValidators {
  const lastModifiedHeader = response.headers.get("last-modified");
  const parsedLastModified = lastModifiedHeader ? Date.parse(lastModifiedHeader) : Number.NaN;
  return {
    etag: response.headers.get("etag") ?? undefined,
    lastModified: Number.isFinite(parsedLastModified) ? parsedLastModified : undefined,
  };
}

export async function fetchCopilotCatalog(options: FetchCatalogOptions): Promise<FetchCatalogResult> {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const response = await fetchImplementation(`${options.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: requestHeaders(options.token, options.providerHeaders, options.validators),
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]),
  });
  const validators = responseValidators(response);

  if (response.status === 304) return { status: "not-modified", ...validators };
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Copilot /models returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json() as unknown;
  const data = isRecord(payload) ? payload.data : undefined;
  if (!Array.isArray(data)) throw new Error("Copilot /models returned an invalid catalog");
  return {
    status: "modified",
    models: data.map(parseCatalogModel).filter((model): model is CopilotCatalogModel => model !== undefined),
    ...validators,
  };
}
