import type { ZedCredentials } from "../auth/types.js";
export interface ZedUsageReport {
    planName: string;
    monthlyCredit: number;
    spentAmount: number;
    remainingCredit: number;
    spentPercentage: number;
    resetDate?: string;
    username?: string;
    userId?: string;
    hasDetailedBilling: boolean;
    raw?: unknown;
}
/**
 * Fetches and parses live usage/account info from Zed Cloud using available credentials.
 */
export declare function fetchZedUsage(creds: ZedCredentials): Promise<ZedUsageReport | null>;
/**
 * Formats a user-friendly string summary of the usage report for TUI display.
 */
export declare function formatUsageSummary(report: ZedUsageReport | null): string;
//# sourceMappingURL=tracker.d.ts.map