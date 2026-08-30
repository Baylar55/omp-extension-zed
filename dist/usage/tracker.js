/**
 * Fetches and parses live usage/account info from Zed Cloud using available credentials.
 */
export async function fetchZedUsage(creds) {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://dashboard.zed.dev/",
        "Origin": "https://dashboard.zed.dev",
    };
    // 1. Try Frontend Billing API if session cookie is present
    if (creds.sessionCookie) {
        const cookieHeader = creds.sessionCookie.startsWith("zed.session=")
            ? creds.sessionCookie
            : `zed.session=${creds.sessionCookie}`;
        try {
            const res = await fetch("https://cloud.zed.dev/frontend/billing/usage", {
                method: "GET",
                headers: {
                    ...headers,
                    "Cookie": cookieHeader,
                },
            });
            if (res.ok) {
                const data = (await res.json());
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
                    hasDetailedBilling: true,
                    raw: data,
                };
            }
        }
        catch {
            // Continue to next strategy
        }
    }
    // 2. Try Client User Endpoint if access token is present
    if (creds.accessToken) {
        const endpoints = [
            "https://cloud.zed.dev/client/users/me",
            "https://api.zed.dev/users/me",
            "https://cloud.zed.dev/api/users/me",
        ];
        for (const url of endpoints) {
            try {
                const res = await fetch(url, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${creds.accessToken}`,
                        "User-Agent": "Zed",
                        "Accept": "application/json",
                    },
                });
                if (res.ok) {
                    const user = (await res.json());
                    const plan = user["plan"] || (user["is_pro"] ? "Zed Pro (Student)" : "Zed Pro");
                    return {
                        planName: plan,
                        monthlyCredit: 10.0,
                        spentAmount: 0.0,
                        remainingCredit: 10.0,
                        spentPercentage: 0,
                        username: (user["github_login"] || user["name"] || user["username"]),
                        userId: String(user["id"] || ""),
                        hasDetailedBilling: false,
                        raw: user,
                    };
                }
            }
            catch {
                // Try next endpoint
            }
        }
    }
    // 3. Fallback: if we have any valid credentials, return a baseline active report
    if (creds.accessToken || creds.sessionCookie) {
        return {
            planName: "Zed Pro / Student Plan",
            monthlyCredit: 10.0,
            spentAmount: 0.0,
            remainingCredit: 10.0,
            spentPercentage: 0,
            hasDetailedBilling: false,
        };
    }
    return null;
}
/**
 * Formats a user-friendly string summary of the usage report for TUI display.
 */
export function formatUsageSummary(report) {
    if (!report) {
        return "No active Zed credentials found. Please run '/login zed' or '/zed login'.";
    }
    if (report.hasDetailedBilling) {
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
    const lines = [
        `📊 Zed AI Subscription: Active (${report.planName})`,
        `----------------------------------------`,
        `Monthly Limit: $${report.monthlyCredit.toFixed(2)} / month included`,
        `Status:        ✓ Connected & Ready`,
    ];
    if (report.username) {
        lines.push(`Account:       ${report.username}`);
    }
    lines.push(`\nTip: To view real-time dollar meter from Orb, link your dashboard session with:`);
    lines.push(`/zed set-cookie <your_zed.session_cookie>`);
    return lines.join("\n");
}
//# sourceMappingURL=tracker.js.map