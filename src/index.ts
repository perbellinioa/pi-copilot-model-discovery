import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCopilotDiscoveryProvider, type DiscoveryProvider } from "./provider.js";

const PROVIDER_ID = "github-copilot";

export default function copilotModelDiscovery(pi: ExtensionAPI): void {
  let discovery: DiscoveryProvider | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (!discovery) {
      const builtin = ctx.modelRegistry.getProvider(PROVIDER_ID);
      if (!builtin) {
        ctx.ui.notify("GitHub Copilot provider is unavailable", "warning");
        return;
      }
      discovery = createCopilotDiscoveryProvider(builtin);
      pi.registerProvider(discovery.provider);
    }
    await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], allowNetwork: true });
  });

  pi.registerCommand("copilot-models-refresh", {
    description: "Refresh GitHub Copilot models from the live provider catalog",
    handler: async (_args, ctx) => {
      await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], allowNetwork: true, force: true });
      const state = discovery?.state;
      if (!state) {
        ctx.ui.notify("GitHub Copilot discovery is not initialized", "error");
        return;
      }
      if (state.error) {
        ctx.ui.notify(`Copilot model refresh failed; retaining ${state.source} catalog: ${state.error}`, "error");
        return;
      }
      ctx.ui.notify(
        `Refreshed ${state.modelCount} Copilot models${state.skippedCount ? ` (${state.skippedCount} skipped)` : ""}`,
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
      const detail = state.error ? ` • error: ${state.error}` : "";
      ctx.ui.notify(
        `Copilot models: ${state.modelCount} from ${state.source} catalog • skipped: ${state.skippedCount} • refreshed: ${refreshed}${detail}`,
        state.error ? "warning" : "info",
      );
    },
  });
}
