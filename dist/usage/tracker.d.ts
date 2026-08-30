import type { ZedCredentials } from "../auth/types.js";
export interface ZedUsageReport {
    planName: string;
    monthlyCredit: number;
    spentAmount: number;
    remainingCredit: number;
    spentPercentage: number;
    resetDate?: string;
    modelsUsed?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        cost: number;
    }>;
    raw?: unknown;
}
/**
 * Fetches and parses live usage information from Zed's frontend billing API.
 */
export declare function fetchZedUsage(creds: ZedCredentials): Promise<ZedUsageReport | null>;
/**
 * Formats a user-friendly string summary of the usage report for TUI display.
 */
export declare function formatUsageSummary(report: ZedUsageReport | null): string;
//# sourceMappingURL=tracker.d.ts.map