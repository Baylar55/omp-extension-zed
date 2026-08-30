import type { ZedCredentials } from "../auth/types.js";
export interface ModelPrice {
    input: number;
    output: number;
}
export declare const MODEL_PRICING: Record<string, ModelPrice>;
export declare function normalizePlanName(rawPlan?: string): string;
export declare function calculateModelCost(model: string, inputTokens: number, outputTokens: number): number;
export declare function getUsageHistoryPath(): string;
export interface LocalSpendRecord {
    period: string;
    spentAmount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
    lastUpdated: number;
}
export declare function getLocalSpendHistory(): LocalSpendRecord;
export declare function recordTokenUsage(model: string, inputTokens: number, outputTokens: number): void;
export interface ZedUsageReport {
    planName: string;
    monthlyCredit: number;
    spentAmount: number;
    remainingCredit: number;
    spentPercentage: number;
    resetDate?: string;
    username?: string;
    userId?: string;
    modelRequests?: {
        used: number;
        limit: string | number;
    };
    editPredictions?: {
        used: number;
        limit: string | number;
    };
    hasDetailedBilling: boolean;
    raw?: unknown;
}
/**
 * Fetches and parses live usage/account info from Zed Cloud using available credentials.
 */
export declare function fetchZedUsage(creds: ZedCredentials | null | undefined): Promise<ZedUsageReport | null>;
/**
 * Formats a user-friendly string summary of the usage report for TUI display.
 */
export declare function formatUsageSummary(report: ZedUsageReport | null): string;
//# sourceMappingURL=tracker.d.ts.map