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

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

/** Keep only documented model-catalog fields before caching provider data. */
function parseCatalogModel(value: unknown): CopilotCatalogModel | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return undefined;
  const capabilities = isRecord(value.capabilities) ? value.capabilities : undefined;
  const limits = capabilities && isRecord(capabilities.limits) ? capabilities.limits : undefined;
  const vision = limits && isRecord(limits.vision) ? limits.vision : undefined;
  const supports = capabilities && isRecord(capabilities.supports) ? capabilities.supports : undefined;
  const policy = isRecord(value.policy) ? value.policy : undefined;
  const policyState = policy?.state;

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : undefined,
    model_picker_enabled: typeof value.model_picker_enabled === "boolean" ? value.model_picker_enabled : undefined,
    supported_endpoints: stringArray(value.supported_endpoints),
    policy: policyState === "enabled" || policyState === "disabled" || policyState === "unconfigured"
      ? { state: policyState }
      : undefined,
    capabilities: capabilities ? {
      type: typeof capabilities.type === "string" ? capabilities.type : undefined,
      limits: limits ? {
        max_context_window_tokens: typeof limits.max_context_window_tokens === "number" ? limits.max_context_window_tokens : undefined,
        max_non_streaming_output_tokens: typeof limits.max_non_streaming_output_tokens === "number" ? limits.max_non_streaming_output_tokens : undefined,
        max_output_tokens: typeof limits.max_output_tokens === "number" ? limits.max_output_tokens : undefined,
        max_prompt_tokens: typeof limits.max_prompt_tokens === "number" ? limits.max_prompt_tokens : undefined,
        vision: vision ? {
          max_prompt_image_size: typeof vision.max_prompt_image_size === "number" ? vision.max_prompt_image_size : undefined,
          max_prompt_images: typeof vision.max_prompt_images === "number" ? vision.max_prompt_images : undefined,
          supported_media_types: stringArray(vision.supported_media_types),
        } : undefined,
      } : undefined,
      supports: supports ? {
        adaptive_thinking: typeof supports.adaptive_thinking === "boolean" ? supports.adaptive_thinking : undefined,
        max_thinking_budget: typeof supports.max_thinking_budget === "number" ? supports.max_thinking_budget : undefined,
        min_thinking_budget: typeof supports.min_thinking_budget === "number" ? supports.min_thinking_budget : undefined,
        parallel_tool_calls: typeof supports.parallel_tool_calls === "boolean" ? supports.parallel_tool_calls : undefined,
        reasoning_effort: stringArray(supports.reasoning_effort),
        streaming: typeof supports.streaming === "boolean" ? supports.streaming : undefined,
        structured_outputs: typeof supports.structured_outputs === "boolean" ? supports.structured_outputs : undefined,
        tool_calls: typeof supports.tool_calls === "boolean" ? supports.tool_calls : undefined,
        vision: typeof supports.vision === "boolean" ? supports.vision : undefined,
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
