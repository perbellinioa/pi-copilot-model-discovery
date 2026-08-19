import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { FileCatalogCache } from "./cache.js";
import { createCopilotDiscoveryProvider, type DiscoveryProvider } from "./provider.js";

const PROVIDER_ID = "github-copilot";
const CACHE_DIRECTORY = join(getAgentDir(), "cache", "pi-copilot-model-discovery");

function formatAge(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "n/a";
  if (milliseconds < 1_000) return "<1s";
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)}s`;
  return `${Math.floor(milliseconds / 60_000)}m`;
}

export default function copilotModelDiscovery(pi: ExtensionAPI): void {
  let discovery: DiscoveryProvider | undefined;
  let backgroundRefresh: AbortController | undefined;

  pi.on("session_start", async (_event, ctx) => {
    backgroundRefresh?.abort();
    backgroundRefresh = new AbortController();

    if (!discovery) {
      const builtin = ctx.modelRegistry.getProvider(PROVIDER_ID);
      if (!builtin) {
        ctx.ui.notify("GitHub Copilot provider is unavailable", "warning");
        return;
      }
      discovery = createCopilotDiscoveryProvider(builtin, {
        cache: new FileCatalogCache(CACHE_DIRECTORY),
      });
      pi.registerProvider(discovery.provider);
    }

    // Restore a namespaced cache synchronously. On first use, wait for one live
    // fetch; after that, startup is cache-first and revalidation is background.
    await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], allowNetwork: false });
    const liveRefresh = ctx.modelRegistry.refresh({
      providers: [PROVIDER_ID],
      allowNetwork: true,
      signal: backgroundRefresh.signal,
    });
    if (discovery.state.source === "builtin") await liveRefresh;
    else void liveRefresh;
  });

  pi.on("session_shutdown", () => {
    backgroundRefresh?.abort();
    backgroundRefresh = undefined;
  });

  pi.registerCommand("copilot-models-refresh", {
    description: "Refresh GitHub Copilot models from the live provider catalog",
    handler: async (_args, ctx) => {
      backgroundRefresh?.abort();
      backgroundRefresh = new AbortController();
      await ctx.modelRegistry.refresh({
        providers: [PROVIDER_ID],
        allowNetwork: true,
        force: true,
        signal: backgroundRefresh.signal,
      });
      const state = discovery?.state;
      if (!state) {
        ctx.ui.notify("GitHub Copilot discovery is not initialized", "error");
        return;
      }
      if (state.error) {
        ctx.ui.notify(
          `Copilot model refresh failed; retaining ${state.source} catalog: ${state.error}`,
          "error",
        );
        return;
      }
      const duration = state.lastDurationMs === undefined ? "cache" : `${state.lastDurationMs.toFixed(0)}ms`;
      ctx.ui.notify(
        `Refreshed ${state.modelCount} Copilot models in ${duration}${state.skippedCount ? ` (${state.skippedCount} skipped)` : ""}`,
        "info",
      );
    },
  });

  pi.registerCommand("copilot-models-status", {
    description: "Show the GitHub Copilot model discovery status",
    handler: async (_args, ctx) => {
      const state = discovery?.state;
      if (!state) {
        ctx.ui.notify("GitHub Copilot discovery is not initialized", "warning");
        return;
      }
      const refreshed = state.lastRefresh ? new Date(state.lastRefresh).toLocaleString() : "not yet";
      const duration = state.lastDurationMs === undefined ? "cache" : `${state.lastDurationMs.toFixed(1)}ms network`;
      const fields = [
        `Copilot models: ${state.modelCount} ${state.source}`,
        `skipped: ${state.skippedCount}`,
        `cache age: ${formatAge(state.cacheAgeMs)}`,
        `hits: ${state.cacheHits}`,
        `requests: ${state.networkRequests}`,
        `last operation: ${duration} at ${refreshed}`,
      ];
      if (state.error) fields.push(`error: ${state.error}`);
      else if (state.cacheError) fields.push(`cache warning: ${state.cacheError}`);
      ctx.ui.notify(fields.join(" • "), state.error || state.cacheError ? "warning" : "info");
    },
  });
}
