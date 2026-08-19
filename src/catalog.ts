import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import { reasoningFromCapabilities } from "./reasoning.js";
import { apiFromEndpoints } from "./routing.js";
import type { ConvertedCatalog, CopilotCatalogModel } from "./types.js";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export interface ConvertCatalogOptions {
  baseUrl: string;
  fallbackHeaders?: ProviderHeaders;
  builtinModels?: readonly Model<Api>[];
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function modelHeaders(headers: ProviderHeaders | undefined): Record<string, string> | undefined {
  const entries = Object.entries(headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function convertModel(
  raw: CopilotCatalogModel,
  options: ConvertCatalogOptions,
  builtinById: ReadonlyMap<string, Model<Api>>,
): { model?: Model<Api>; reason?: string } {
  if (raw.model_picker_enabled === false) return { reason: "model picker disabled" };
  if (raw.policy?.state === "disabled") return { reason: "policy disabled" };
  if (raw.capabilities?.type !== "chat") return { reason: "not a chat model" };
  if (raw.capabilities.supports?.tool_calls === false) return { reason: "tool calls unsupported" };

  const api = apiFromEndpoints(raw.supported_endpoints);
  if (!api) return { reason: "no supported pi endpoint" };

  const limits = raw.capabilities.limits;
  const contextWindow = positiveInteger(limits?.max_context_window_tokens ?? limits?.max_prompt_tokens);
  const maxTokens = positiveInteger(limits?.max_output_tokens);
  if (!contextWindow) return { reason: "missing context-window limit" };
  if (!maxTokens) return { reason: "missing output-token limit" };

  const supports = raw.capabilities.supports;
  const reasoning = reasoningFromCapabilities(
    supports?.reasoning_effort,
    supports?.adaptive_thinking === true || positiveInteger(supports?.max_thinking_budget) !== undefined,
  );
  const builtin = builtinById.get(raw.id);
  const headers = modelHeaders(builtin?.headers ?? options.fallbackHeaders);
  const compat = {
    ...(api === "anthropic-messages"
      ? {
          supportsEagerToolInputStreaming: false,
          ...(supports?.adaptive_thinking === true ? { forceAdaptiveThinking: true } : {}),
        }
      : {}),
    ...(api === "openai-completions"
      ? { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: reasoning.reasoning }
      : {}),
  } as Model<Api>["compat"];

  return {
    model: {
      id: raw.id,
      name: raw.name ?? raw.id,
      api,
      provider: "github-copilot",
      baseUrl: options.baseUrl,
      reasoning: reasoning.reasoning,
      thinkingLevelMap: reasoning.thinkingLevelMap,
      input: supports?.vision === true ? ["text", "image"] : ["text"],
      cost: builtin?.cost ?? { ...ZERO_COST },
      contextWindow,
      maxTokens,
      headers,
      compat: Object.keys(compat ?? {}).length > 0 ? compat : undefined,
    } as Model<Api>,
  };
}

export function convertCatalog(
  rawModels: readonly CopilotCatalogModel[],
  options: ConvertCatalogOptions,
): ConvertedCatalog {
  const builtinModels = options.builtinModels ?? [];
  const builtinById = new Map(builtinModels.map((model) => [model.id, model]));
  const seen = new Set<string>();
  const models: Model<Api>[] = [];
  const skipped: ConvertedCatalog["skipped"] = [];

  for (const raw of rawModels) {
    if (seen.has(raw.id)) {
      skipped.push({ id: raw.id, reason: "duplicate model id" });
      continue;
    }
    seen.add(raw.id);
    const converted = convertModel(raw, options, builtinById);
    if (converted.model) models.push(converted.model);
    else skipped.push({ id: raw.id, reason: converted.reason ?? "invalid model" });
  }

  return { models, skipped };
}
