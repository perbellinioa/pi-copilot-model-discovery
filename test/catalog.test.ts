import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { convertCatalog } from "../src/catalog.js";
import { reasoningFromCapabilities } from "../src/reasoning.js";
import { apiFromEndpoints, normalizeEndpoint } from "../src/routing.js";
import type { CopilotCatalogModel } from "../src/types.js";

function rawModel(
  id: string,
  endpoints: string[],
  efforts: string[],
  overrides: Partial<CopilotCatalogModel> = {},
): CopilotCatalogModel {
  return {
    id,
    name: id,
    supported_endpoints: endpoints,
    model_picker_enabled: true,
    policy: { state: "enabled" },
    capabilities: {
      type: "chat",
      limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 64_000 },
      supports: { tool_calls: true, reasoning_effort: efforts, vision: true },
    },
    ...overrides,
  };
}

function converted(raw: CopilotCatalogModel): Model<Api> {
  const result = convertCatalog([raw], { baseUrl: "https://copilot.test" });
  assert.deepEqual(result.skipped, []);
  assert.equal(result.models.length, 1);
  return result.models[0]!;
}

test("normalizes websocket endpoint notation", () => {
  assert.equal(normalizeEndpoint("ws:/responses"), "/responses");
});

test("routes exclusively from advertised endpoints", () => {
  assert.equal(apiFromEndpoints(["/v1/messages", "/chat/completions"]), "anthropic-messages");
  assert.equal(apiFromEndpoints(["/responses"]), "openai-responses");
  assert.equal(apiFromEndpoints(["ws:/responses"]), "openai-responses");
  assert.equal(apiFromEndpoints(["/chat/completions"]), "openai-completions");
  assert.equal(apiFromEndpoints(["/unknown"]), undefined);
});

test("maps only reasoning efforts supplied by the provider", () => {
  const metadata = reasoningFromCapabilities(["none", "low", "medium", "high", "xhigh", "max"], false);
  assert.equal(metadata.reasoning, true);
  assert.deepEqual(metadata.thinkingLevelMap, {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  });
});

test("does not invent minimal or off for Claude efforts", () => {
  const metadata = reasoningFromCapabilities(["low", "medium", "high", "xhigh", "max"], true);
  assert.deepEqual(metadata.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  });
});

test("converts Claude Opus and Sonnet without family rules", () => {
  for (const id of ["claude-opus-5", "claude-sonnet-5"]) {
    const model = converted(rawModel(id, ["/v1/messages", "/chat/completions"], ["low", "medium", "high", "xhigh", "max"], {
      capabilities: {
        type: "chat",
        limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 64_000 },
        supports: { adaptive_thinking: true, tool_calls: true, reasoning_effort: ["low", "medium", "high", "xhigh", "max"], vision: true },
      },
    }));
    assert.equal(model.api, "anthropic-messages");
    assert.equal(model.thinkingLevelMap?.max, "max");
    assert.equal(model.thinkingLevelMap?.minimal, null);
    assert.equal((model.compat as { forceAdaptiveThinking?: boolean })?.forceAdaptiveThinking, true);
  }
});

test("converts the GPT-5.6 family directly", () => {
  for (const id of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
    const model = converted(rawModel(id, ["/responses", "ws:/responses"], ["none", "low", "medium", "high", "xhigh", "max"]));
    assert.equal(model.api, "openai-responses");
    assert.equal(model.thinkingLevelMap?.off, "none");
    assert.equal(model.thinkingLevelMap?.max, "max");
  }
});

test("routes Grok and MAI through Responses without model-name branches", () => {
  const fixtures = [
    rawModel("grok-4.5", ["/responses"], ["low", "medium", "high"]),
    rawModel("grok-4.6", ["/responses"], ["low", "medium", "high", "xhigh"]),
    rawModel("mai-code-1-flash-picker", ["/responses"], ["low", "medium", "high"], {
      capabilities: {
        type: "chat",
        limits: { max_context_window_tokens: 256_000, max_output_tokens: 128_000 },
        supports: { tool_calls: true, reasoning_effort: ["low", "medium", "high"] },
      },
    }),
    rawModel("mai-code-1.1-flash", ["/responses"], ["low", "medium", "high"]),
  ];
  const result = convertCatalog(fixtures, { baseUrl: "https://copilot.test" });
  assert.equal(result.models.length, 4);
  assert.ok(result.models.every((model) => model.api === "openai-responses"));
  assert.deepEqual(result.models[0]!.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  });
  assert.deepEqual(result.models[2]!.input, ["text"]);
  assert.deepEqual(result.models[3]!.input, ["text", "image"]);
});

test("skips malformed and disabled models instead of guessing", () => {
  const result = convertCatalog([
    rawModel("unknown-route", ["/mystery"], ["high"]),
    rawModel("disabled", ["/responses"], ["high"], { policy: { state: "disabled" } }),
    rawModel("missing-limits", ["/responses"], ["high"], { capabilities: { type: "chat", supports: { tool_calls: true } } }),
  ], { baseUrl: "https://copilot.test" });
  assert.equal(result.models.length, 0);
  assert.deepEqual(result.skipped.map((entry) => entry.reason), [
    "no supported pi endpoint",
    "policy disabled",
    "missing context-window limit",
  ]);
});
