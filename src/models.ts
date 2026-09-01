import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

function m(
  id: string,
  name: string,
  contextWindow: number,
  maxTokens: number,
  cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
  reasoning = true,
): ProviderModelConfig {
  return {
    id,
    name: `${name} (Zed)`,
    api: "openai-completions",
    reasoning,
    input: ["text", "image"],
    contextWindow,
    maxTokens,
    cost: {
      input: cost.input,
      output: cost.output,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
    },
  };
}

/**
 * List of all 16 models available in Zed (Claude, GPT, Gemini series).
 */
export const ZED_MODELS: ProviderModelConfig[] = [
  // --- Anthropic Claude Series ---
  m("claude-sonnet-5", "Claude Sonnet 5", 1000000, 16384, { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 }),
  m("claude-sonnet-4-6", "Claude Sonnet 4.6", 1000000, 8192, { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 }),
  m("claude-sonnet-4-5", "Claude Sonnet 4.5", 200000, 8192, { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 }),
  m("claude-haiku-4-5", "Claude Haiku 4.5", 200000, 8192, { input: 1.1, output: 5.5, cacheRead: 0.11, cacheWrite: 1.375 }, false),

  // --- OpenAI GPT Series ---
  m("gpt-5.6-sol", "GPT-5.6 Sol", 400000, 16384, { input: 5.5, output: 33.0, cacheRead: 0.55 }),
  m("gpt-5.6-terra", "GPT-5.6 Terra", 400000, 16384, { input: 5.5, output: 33.0, cacheRead: 0.55 }),
  m("gpt-5.6-luna", "GPT-5.6 Luna", 400000, 16384, { input: 5.5, output: 33.0, cacheRead: 0.55 }),
  m("gpt-5.5", "GPT-5.5", 400000, 16384, { input: 5.5, output: 33.0, cacheRead: 0.55 }),
  m("gpt-5.4", "GPT-5.4", 400000, 16384, { input: 2.75, output: 16.5, cacheRead: 0.0275 }),
  m("gpt-5.3-codex", "GPT-5.3 Codex", 400000, 16384, { input: 1.925, output: 15.4, cacheRead: 0.1925 }),
  m("gpt-5.2", "GPT-5.2", 400000, 16384, { input: 1.925, output: 15.4, cacheRead: 0.1925 }),
  m("gpt-5-mini", "GPT-5 Mini", 400000, 16384, { input: 0.275, output: 2.2, cacheRead: 0.0275 }),
  m("gpt-5-nano", "GPT-5 Nano", 400000, 16384, { input: 0.055, output: 0.44, cacheRead: 0.0055 }),

  // --- Google Gemini Series ---
  m("gemini-3.1-pro-preview", "Gemini 3.1 Pro", 200000, 65535, { input: 2.2, output: 13.2 }),
  m("gemini-3.5-flash", "Gemini 3.5 Flash", 1048576, 65535, { input: 1.65, output: 9.9 }),
  m("gemini-3-flash", "Gemini 3 Flash", 1048576, 65535, { input: 0.55, output: 3.3 }),
];
