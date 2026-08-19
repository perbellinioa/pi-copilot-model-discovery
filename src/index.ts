import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { FileCatalogCache } from "./cache.js";
import { createCopilotDiscoveryProvider, type DiscoveryProvider } from "./provider.js";

const PROVIDER_ID = "github-copilot";
const CACHE_DIRECTORY = join(getAgentDir(), "cache", "pi-copilot-model-discovery");

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
    if (discovery.state.source === "builtin") {
      await ctx.modelRegistry.refresh({
        providers: [PROVIDER_ID],
        allowNetwork: true,
        signal: backgroundRefresh.signal,
      });
    } else {
      void ctx.modelRegistry.refresh({
        providers: [PROVIDER_ID],
        allowNetwork: true,
        signal: backgroundRefresh.signal,
      });
    }
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
        ctx.ui.notify(`Copilot model refresh failed; retaining ${state.source} catalog: ${state.error}`, "error");
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
      const duration = state.lastDurationMs === undefined ? "n/a" : `${state.lastDurationMs.toFixed(1)}ms`;
      const detail = state.error ? ` • error: ${state.error}` : state.cacheError ? ` • cache warning: ${state.cacheError}` : "";
      ctx.ui.notify(
        `Copilot models: ${state.modelCount} ${state.source} • skipped: ${state.skippedCount} • cache hits: ${state.cacheHits} • network: ${state.networkRequests} • last: ${duration} at ${refreshed}${detail}`,
        state.error || state.cacheError ? "warning" : "info",
      );
    },
  });
}
