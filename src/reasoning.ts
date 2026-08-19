import type { ModelThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

// Pi may infer defaults for missing keys, so disable every level before applying provider efforts.
const UNSUPPORTED_THINKING_LEVELS: ThinkingLevelMap = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: null,
  xhigh: null,
  max: null,
};

const DIRECT_LEVELS = new Set<ModelThinkingLevel>(["minimal", "low", "medium", "high", "xhigh", "max"]);

export interface ReasoningMetadata {
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
}

/**
 * Translate the provider's explicit effort vocabulary into pi's schema.
 * Unsupported values are null so pi cannot infer or invent them.
 */
export function reasoningFromCapabilities(
  efforts: readonly string[] | undefined,
  hasThinkingCapability: boolean,
): ReasoningMetadata {
  if (!efforts) {
    return { reasoning: hasThinkingCapability };
  }

  const map: ThinkingLevelMap = { ...UNSUPPORTED_THINKING_LEVELS };
  let reasoning = false;

  for (const rawEffort of efforts) {
    const effort = rawEffort.trim().toLowerCase();
    if (effort === "none" || effort === "off") {
      map.off = rawEffort;
      continue;
    }
    if (DIRECT_LEVELS.has(effort as ModelThinkingLevel)) {
      const level = effort as Exclude<ModelThinkingLevel, "off">;
      map[level] = rawEffort;
      reasoning = true;
    }
  }

  return { reasoning: reasoning || hasThinkingCapability, thinkingLevelMap: map };
}
