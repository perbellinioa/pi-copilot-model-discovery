import type { Api, Model } from "@earendil-works/pi-ai";

export type CopilotEndpoint = string;

export interface CopilotModelCapabilities {
  type?: string;
  limits?: {
    max_context_window_tokens?: number;
    max_non_streaming_output_tokens?: number;
    max_output_tokens?: number;
    max_prompt_tokens?: number;
    vision?: {
      max_prompt_image_size?: number;
      max_prompt_images?: number;
      supported_media_types?: string[];
    };
  };
  supports?: {
    adaptive_thinking?: boolean;
    max_thinking_budget?: number;
    min_thinking_budget?: number;
    parallel_tool_calls?: boolean;
    reasoning_effort?: string[];
    streaming?: boolean;
    structured_outputs?: boolean;
    tool_calls?: boolean;
    vision?: boolean;
  };
}

export interface CopilotCatalogModel {
  id: string;
  name?: string;
  capabilities?: CopilotModelCapabilities;
  supported_endpoints?: CopilotEndpoint[];
  model_picker_enabled?: boolean;
  policy?: { state?: "enabled" | "disabled" | "unconfigured" };
}

export interface SkippedModel {
  id: string;
  reason: string;
}

export interface ConvertedCatalog {
  models: Model<Api>[];
  skipped: SkippedModel[];
}

export type FetchCatalogResult =
  | {
      status: "modified";
      models: CopilotCatalogModel[];
      etag?: string;
      lastModified?: number;
    }
  | {
      status: "not-modified";
      etag?: string;
      lastModified?: number;
    };

export interface CatalogValidators {
  etag?: string;
  lastModified?: number;
}
