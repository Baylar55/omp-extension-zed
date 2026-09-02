import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import type { ZedCredentials } from "./auth/types.js";
import type { ZedRawModel } from "./bridge/types.js";
export interface ModelPricingEntry {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}
/**
 * Fallback per-model pricing (USD per 1M tokens).
 * Used when Zed Cloud /models doesn't expose pricing and for offline cache.
 * Values mirror Zed dashboard pricing as of 2026-09-02; verify against
 * https://zed.dev/pricing when updating.
 */
export declare const DEFAULT_MODEL_PRICING: Record<string, ModelPricingEntry>;
/**
 * Static baseline list of Zed models (used as zero-latency offline fallback).
 */
export declare const ZED_MODELS: ProviderModelConfig[];
export declare function mapRawModelToConfig(raw: ZedRawModel): ProviderModelConfig;
export declare function loadCachedZedModels(): ProviderModelConfig[] | null;
export declare function saveCachedZedModels(models: ProviderModelConfig[]): void;
export declare function getCachedZedModels(): ProviderModelConfig[];
export declare function fetchRemoteZedModels(creds?: ZedCredentials | null): Promise<ProviderModelConfig[]>;
export declare function getZedModels(creds?: ZedCredentials | null, forceRefresh?: boolean): Promise<ProviderModelConfig[]>;
//# sourceMappingURL=models.d.ts.map