import type { ModelThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

const PI_LEVELS: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

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

  const map: ThinkingLevelMap = Object.fromEntries(PI_LEVELS.map((level) => [level, null]));
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
