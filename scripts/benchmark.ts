import { performance } from "node:perf_hooks";
import { convertCatalog } from "../src/catalog.js";
import type { CopilotCatalogModel } from "../src/types.js";

const MODEL_COUNT = 250;
const ITERATIONS = 2_000;
const fixtures: CopilotCatalogModel[] = Array.from({ length: MODEL_COUNT }, (_, index) => ({
  id: `benchmark-model-${index}`,
  name: `Benchmark Model ${index}`,
  model_picker_enabled: true,
  policy: { state: "enabled" },
  supported_endpoints: index % 3 === 0 ? ["/v1/messages"] : index % 3 === 1 ? ["/responses"] : ["/chat/completions"],
  capabilities: {
    type: "chat",
    limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 64_000 },
    supports: {
      adaptive_thinking: index % 3 === 0,
      tool_calls: true,
      vision: index % 2 === 0,
      reasoning_effort: ["low", "medium", "high", "xhigh", "max"],
    },
  },
}));

for (let index = 0; index < 100; index++) convertCatalog(fixtures, { baseUrl: "https://benchmark.test" });
const samples: number[] = [];
for (let index = 0; index < ITERATIONS; index++) {
  const started = performance.now();
  convertCatalog(fixtures, { baseUrl: "https://benchmark.test" });
  samples.push(performance.now() - started);
}
samples.sort((a, b) => a - b);
const percentile = (value: number) => samples[Math.floor((samples.length - 1) * value)]!;
const total = samples.reduce((sum, sample) => sum + sample, 0);
console.log(JSON.stringify({
  modelsPerCatalog: MODEL_COUNT,
  iterations: ITERATIONS,
  meanMs: Number((total / samples.length).toFixed(4)),
  p50Ms: Number(percentile(0.5).toFixed(4)),
  p95Ms: Number(percentile(0.95).toFixed(4)),
  p99Ms: Number(percentile(0.99).toFixed(4)),
  modelsPerSecond: Math.round((MODEL_COUNT * ITERATIONS) / (total / 1_000)),
}, null, 2));
