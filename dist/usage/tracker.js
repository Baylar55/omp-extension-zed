/**
 * Fetches and parses live usage information from Zed's frontend billing API.
 */
export async function fetchZedUsage(creds) {
    const url = "https://cloud.zed.dev/frontend/billing/usage";
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://dashboard.zed.dev/",
        "Origin": "https://dashboard.zed.dev",
    };
    if (creds.sessionCookie) {
        headers["Cookie"] = creds.sessionCookie.startsWith("zed.session=")
            ? creds.sessionCookie
            : `zed.session=${creds.sessionCookie}`;
    }
    else if (creds.accessToken) {
        headers["Authorization"] = `Bearer ${creds.accessToken}`;
    }
    else {
        return null;
    }
    try {
        const res = await fetch(url, { method: "GET", headers });
        if (!res.ok) {
            return null;
        }
        const data = (await res.json());
        // Parse usage data from Orb response shape
        const monthlyCredit = typeof data["credit_limit"] === "number" ? data["credit_limit"] : 10.0;
        const spentAmount = typeof data["current_spend"] === "number" ? data["current_spend"] : 0.0;
        const remainingCredit = Math.max(0, monthlyCredit - spentAmount);
        const spentPercentage = Math.min(100, Math.round((spentAmount / monthlyCredit) * 100));
        const resetDate = typeof data["period_end"] === "string" ? data["period_end"] : undefined;
        return {
            planName: data["plan"] || "Zed Student / Pro",
            monthlyCredit,
            spentAmount,
            remainingCredit,
            spentPercentage,
            resetDate,
            raw: data,
        };
    }
    catch {
        return null;
    }
}
/**
 * Formats a user-friendly string summary of the usage report for TUI display.
 */
export function formatUsageSummary(report) {
    if (!report) {
        return "Could not retrieve live usage from Zed Cloud. Please verify your login credentials.";
    }
    const progressBarLength = 20;
    const filledBars = Math.round((report.spentPercentage / 100) * progressBarLength);
    const emptyBars = progressBarLength - filledBars;
    const progressBar = `[${"█".repeat(filledBars)}${"░".repeat(emptyBars)}] ${report.spentPercentage}%`;
    const lines = [
        `📊 Zed AI Monthly Usage (${report.planName})`,
        `----------------------------------------`,
        `Credit Spend:  $${report.spentAmount.toFixed(2)} / $${report.monthlyCredit.toFixed(2)}`,
        `Remaining:     $${report.remainingCredit.toFixed(2)}`,
        `Usage Bar:     ${progressBar}`,
    ];
    if (report.resetDate) {
        lines.push(`Period Resets: ${new Date(report.resetDate).toLocaleDateString()}`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=tracker.js.map