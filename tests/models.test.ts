import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_PRICING,
  fetchRemoteZedModels,
  getCachedZedModels,
  getZedModels,
  mapRawModelToConfig,
  saveCachedZedModels,
  ZED_MODELS,
} from "../src/models.js";
import { getOmpAgentDir } from "../src/auth/credential-store.js";
import type { ZedRawModel } from "../src/bridge/types.js";

function cleanCache() {
  try {
    const p = path.join(getOmpAgentDir(), "zed_models_cache.json");
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

describe("Dynamic Models Discovery", () => {
  beforeEach(() => {
    cleanCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanCache();
    vi.restoreAllMocks();
  });

  it("maps raw API model into ProviderModelConfig with reasoning and image support", () => {
    const raw: ZedRawModel = {
      provider: "anthropic",
      id: "claude-sonnet-5",
      display_name: "Claude Sonnet 5",
      max_token_count: 1000000,
      max_output_tokens: 128000,
      supports_images: true,
      supports_thinking: true,
      is_disabled: false,
    };

    const config = mapRawModelToConfig(raw);
    expect(config.id).toBe("claude-sonnet-5");
    expect(config.name).toBe("Claude Sonnet 5 (Zed)");
    expect(config.contextWindow).toBe(1000000);
    expect(config.maxTokens).toBe(128000);
    expect(config.reasoning).toBe(true);
    expect(config.input).toEqual(["text", "image"]);
    expect(config.cost.input).toBe(DEFAULT_MODEL_PRICING["claude-sonnet-5"]!.input);
    expect(config.cost.output).toBe(DEFAULT_MODEL_PRICING["claude-sonnet-5"]!.output);
  });

  it("falls back to default cost when raw model id is not in pricing table", () => {
    const raw: ZedRawModel = {
      provider: "anthropic",
      id: "claude-future-99",
      display_name: "Claude Future 99",
      supports_thinking: false,
      supports_images: false,
      is_disabled: false,
    };

    const config = mapRawModelToConfig(raw);
    expect(config.id).toBe("claude-future-99");
    expect(config.reasoning).toBe(false);
    expect(config.input).toEqual(["text"]);
    expect(config.cost.input).toBe(3.3);
    expect(config.cost.output).toBe(16.5);
  });

  it("fetches remote models and filters out disabled models", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            provider: "anthropic",
            id: "claude-sonnet-5",
            display_name: "Claude Sonnet 5",
            max_token_count: 1000000,
            max_output_tokens: 128000,
            supports_thinking: true,
            is_disabled: false,
          },
          {
            provider: "open_ai",
            id: "gpt-retired-model",
            display_name: "Retired Model",
            is_disabled: true,
          },
        ],
      }),
    } as Response);

    const models = await fetchRemoteZedModels({ accessToken: "fake_token" });
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("claude-sonnet-5");

    // Cache should be updated on disk
    const cached = getCachedZedModels();
    expect(cached).toHaveLength(1);
    expect(cached[0]?.id).toBe("claude-sonnet-5");
  });

  it("returns fallback static models when unauthenticated", async () => {
    const models = await fetchRemoteZedModels(null);
    expect(models).toEqual(ZED_MODELS);
  });

  it("getZedModels returns live models on successful fetch", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            provider: "google",
            id: "gemini-3.5-flash",
            display_name: "Gemini 3.5 Flash",
            max_token_count: 1048576,
            max_output_tokens: 65535,
            supports_thinking: true,
            is_disabled: false,
          },
        ],
      }),
    } as Response);

    const models = await getZedModels({ accessToken: "header.eyJleHAiOjE5OTk5OTk5OTl9.sig" }, true);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("gemini-3.5-flash");
  });

  it("getZedModels falls back to cache or static when remote call fails", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network offline"));

    const models = await getZedModels({ accessToken: "token" }, true);
    expect(models).toEqual(ZED_MODELS);
  });

  it("persists and reloads cached models across sessions", () => {
    saveCachedZedModels([
      {
        id: "custom-cached-model",
        name: "Custom Cached Model (Zed)",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
        contextWindow: 500000,
        maxTokens: 32000,
        cost: { input: 1.0, output: 2.0, cacheRead: 0, cacheWrite: 0 },
      },
    ]);

    const cached = getCachedZedModels();
    expect(cached).toHaveLength(1);
    expect(cached[0]?.id).toBe("custom-cached-model");
  });
});
