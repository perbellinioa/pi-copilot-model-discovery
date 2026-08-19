import type { Api } from "@earendil-works/pi-ai";

export function normalizeEndpoint(endpoint: string): string {
  let value = endpoint.trim();
  if (value.startsWith("ws:")) value = value.slice(3);
  if (value && !value.startsWith("/")) value = `/${value}`;
  return value.replace(/\/+$/, "") || "/";
}

/**
 * Choose the most native protocol explicitly advertised by Copilot. No model
 * names or families participate in routing.
 */
export function apiFromEndpoints(endpoints: readonly string[] | undefined): Api | undefined {
  const available = new Set((endpoints ?? []).map(normalizeEndpoint));
  if (available.has("/v1/messages")) return "anthropic-messages";
  if (available.has("/responses")) return "openai-responses";
  if (available.has("/chat/completions")) return "openai-completions";
  return undefined;
}
