import * as fs from "node:fs";
import * as path from "node:path";
import { getOmpAgentDir, loadCredentials } from "./auth/credential-store.js";
import { ZedCloudClient } from "./bridge/client.js";
/**
 * Fallback per-model pricing (USD per 1M tokens).
 * Used when Zed Cloud /models doesn't expose pricing and for offline cache.
 * Values mirror Zed dashboard pricing as of 2026-09-02; verify against
 * https://zed.dev/pricing when updating.
 */
export const DEFAULT_MODEL_PRICING = {
    // Anthropic — differentiated: Sonnet 5 cheaper tier vs 4.6/4.5
    "claude-sonnet-5": { input: 2.2, output: 11.0, cacheRead: 0.22, cacheWrite: 2.75 },
    "claude-sonnet-4-6": { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 },
    "claude-sonnet-4-5": { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 },
    "claude-haiku-4-5": { input: 1.1, output: 5.5, cacheRead: 0.11, cacheWrite: 1.375 },
    // OpenAI — tiered: Sol (full) > Terra (mid) > Luna (light)
    "gpt-5.6-sol": { input: 5.5, output: 33.0, cacheRead: 0.55, cacheWrite: 6.875 },
    "gpt-5.6-terra": { input: 2.75, output: 16.5, cacheRead: 0.275, cacheWrite: 3.4375 },
    "gpt-5.6-luna": { input: 1.1, output: 6.6, cacheRead: 0.11, cacheWrite: 1.375 },
    "gpt-5.5": { input: 5.5, output: 33.0, cacheRead: 0.55 },
    "gpt-5.4": { input: 2.75, output: 16.5, cacheRead: 0.0275 },
    "gpt-5.3-codex": { input: 1.925, output: 15.4, cacheRead: 0.1925 },
    "gpt-5.2": { input: 1.925, output: 15.4, cacheRead: 0.1925 },
    "gpt-5.2-codex": { input: 1.925, output: 15.4, cacheRead: 0.1925 },
    "gpt-5-mini": { input: 0.275, output: 2.2, cacheRead: 0.0275 },
    "gpt-5-nano": { input: 0.055, output: 0.44, cacheRead: 0.0055 },
    // Google
    "gemini-3.1-pro-preview": { input: 2.2, output: 13.2 },
    "gemini-3.5-flash": { input: 1.65, output: 9.9 },
    "gemini-3-flash": { input: 0.55, output: 3.3 },
};
function m(id, name, contextWindow, maxTokens, cost, reasoning = true) {
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
 * Static baseline list of Zed models (used as zero-latency offline fallback).
 */
export const ZED_MODELS = [
    // --- Anthropic Claude Series ---
    m("claude-sonnet-5", "Claude Sonnet 5", 1000000, 128000, DEFAULT_MODEL_PRICING["claude-sonnet-5"]),
    m("claude-sonnet-4-6", "Claude Sonnet 4.6", 1000000, 64000, DEFAULT_MODEL_PRICING["claude-sonnet-4-6"]),
    m("claude-sonnet-4-5", "Claude Sonnet 4.5", 200000, 8192, DEFAULT_MODEL_PRICING["claude-sonnet-4-5"]),
    m("claude-haiku-4-5", "Claude Haiku 4.5", 200000, 64000, DEFAULT_MODEL_PRICING["claude-haiku-4-5"], false),
    // --- OpenAI GPT Series ---
    m("gpt-5.6-sol", "GPT-5.6 Sol", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.6-sol"]),
    m("gpt-5.6-terra", "GPT-5.6 Terra", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.6-terra"]),
    m("gpt-5.6-luna", "GPT-5.6 Luna", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.6-luna"]),
    m("gpt-5.5", "GPT-5.5", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.5"]),
    m("gpt-5.4", "GPT-5.4", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.4"]),
    m("gpt-5.3-codex", "GPT-5.3 Codex", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.3-codex"]),
    m("gpt-5.2", "GPT-5.2", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5.2"], false),
    m("gpt-5-mini", "GPT-5 Mini", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5-mini"], false),
    m("gpt-5-nano", "GPT-5 Nano", 400000, 128000, DEFAULT_MODEL_PRICING["gpt-5-nano"], false),
    // --- Google Gemini Series ---
    m("gemini-3.1-pro-preview", "Gemini 3.1 Pro", 200000, 65535, DEFAULT_MODEL_PRICING["gemini-3.1-pro-preview"]),
    m("gemini-3.5-flash", "Gemini 3.5 Flash", 1048576, 65535, DEFAULT_MODEL_PRICING["gemini-3.5-flash"]),
    m("gemini-3-flash", "Gemini 3 Flash", 1048576, 65535, DEFAULT_MODEL_PRICING["gemini-3-flash"]),
];
const FALLBACK_PRICING = DEFAULT_MODEL_PRICING["claude-sonnet-4-6"];
export function mapRawModelToConfig(raw) {
    const cost = DEFAULT_MODEL_PRICING[raw.id] || FALLBACK_PRICING;
    return {
        id: raw.id,
        name: `${raw.display_name} (Zed)`,
        api: "openai-completions",
        reasoning: Boolean(raw.supports_thinking),
        input: raw.supports_images ? ["text", "image"] : ["text"],
        contextWindow: raw.max_token_count || 200000,
        maxTokens: raw.max_output_tokens || 16384,
        cost: {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cacheRead ?? 0,
            cacheWrite: cost.cacheWrite ?? 0,
        },
    };
}
export function loadCachedZedModels() {
    const p = path.join(getOmpAgentDir(), "zed_models_cache.json");
    try {
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, "utf-8"));
            if (Array.isArray(data.models) && data.models.length > 0) {
                return data.models;
            }
        }
    }
    catch {
        // Corrupt cache — delete so next fetch can rebuild; fallback to static below
        try {
            fs.unlinkSync(p);
        }
        catch { }
    }
    return null;
}
export function saveCachedZedModels(models) {
    try {
        const dir = getOmpAgentDir();
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const p = path.join(dir, "zed_models_cache.json");
        fs.writeFileSync(p, JSON.stringify({ models, timestamp: Date.now() }, null, 2), { encoding: "utf-8", mode: 0o600 });
    }
    catch { }
}
export function getCachedZedModels() {
    return loadCachedZedModels() || ZED_MODELS;
}
export async function fetchRemoteZedModels(creds) {
    const effectiveCreds = creds !== undefined ? creds : loadCredentials();
    if (!effectiveCreds || (!effectiveCreds.accessToken && !effectiveCreds.sessionCookie)) {
        return getCachedZedModels();
    }
    const client = new ZedCloudClient();
    const rawModels = await client.fetchModels(effectiveCreds);
    const activeModels = rawModels.filter((m) => !m.is_disabled);
    if (activeModels.length === 0) {
        return getCachedZedModels();
    }
    const mapped = activeModels.map(mapRawModelToConfig);
    saveCachedZedModels(mapped);
    return mapped;
}
export async function getZedModels(creds, forceRefresh = false) {
    if (!forceRefresh) {
        const cached = loadCachedZedModels();
        if (cached && cached.length > 0)
            return cached;
    }
    try {
        return await fetchRemoteZedModels(creds);
    }
    catch {
        return getCachedZedModels();
    }
}
//# sourceMappingURL=models.js.map