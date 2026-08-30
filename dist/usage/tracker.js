import * as fs from "node:fs";
import * as path from "node:path";
import { findBrowserSessionCookie, getOmpAgentDir, saveCredentials } from "../auth/credential-store.js";
export const MODEL_PRICING = {
    "claude-sonnet-5": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
    "claude-haiku-4-5": { input: 0.8, output: 4.0 },
    "gpt-5.6-sol": { input: 2.5, output: 10.0 },
    "gpt-5.6-terra": { input: 2.5, output: 10.0 },
    "gpt-5.6-luna": { input: 2.5, output: 10.0 },
    "gpt-5.5": { input: 2.5, output: 10.0 },
    "gpt-5.4": { input: 2.5, output: 10.0 },
    "gpt-5.3-codex": { input: 2.5, output: 10.0 },
    "gpt-5.2": { input: 2.5, output: 10.0 },
    "gpt-5-mini": { input: 0.15, output: 0.6 },
    "gpt-5-nano": { input: 0.15, output: 0.6 },
    "gemini-3.5-flash": { input: 0.075, output: 0.3 },
    "gemini-3-flash": { input: 0.075, output: 0.3 },
    "gemini-3.1-pro-preview": { input: 1.25, output: 5.0 },
    "default": { input: 3.0, output: 15.0 },
};
export function normalizePlanName(rawPlan) {
    if (!rawPlan)
        return "Zed Pro Plan";
    const lower = rawPlan.toLowerCase().replace(/[_-]/g, " ");
    if (lower.includes("student")) {
        return "Zed Student Plan";
    }
    if (lower.includes("pro")) {
        return "Zed Pro Plan";
    }
    if (lower.includes("free")) {
        return "Zed Free Plan";
    }
    if (lower.includes("business") || lower.includes("team") || lower.includes("enterprise")) {
        return "Zed Business Plan";
    }
    return `Zed ${rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1)}`;
}
export function calculateModelCost(model, inputTokens, outputTokens) {
    const cleanModel = model.replace(/^zed\//i, "").toLowerCase();
    const pricing = MODEL_PRICING[cleanModel] || MODEL_PRICING["default"];
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
}
export function getUsageHistoryPath() {
    return path.join(getOmpAgentDir(), "zed_usage_history.json");
}
export function getLocalSpendHistory() {
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const filePath = getUsageHistoryPath();
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed.period === currentPeriod) {
                return parsed;
            }
        }
    }
    catch {
        // Ignore
    }
    return {
        period: currentPeriod,
        spentAmount: 0.0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        requestCount: 0,
        lastUpdated: Date.now(),
    };
}
export function resetLocalSpendHistory() {
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const emptyRecord = {
        period: currentPeriod,
        spentAmount: 0.0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        requestCount: 0,
        lastUpdated: Date.now(),
    };
    try {
        const dir = getOmpAgentDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(getUsageHistoryPath(), JSON.stringify(emptyRecord, null, 2), "utf-8");
    }
    catch { }
}
export function setLocalSpendAmount(amount) {
    const current = getLocalSpendHistory();
    current.spentAmount = Math.max(0, Number(amount.toFixed(2)));
    current.lastUpdated = Date.now();
    try {
        const dir = getOmpAgentDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(getUsageHistoryPath(), JSON.stringify(current, null, 2), "utf-8");
    }
    catch { }
}
export function recordTokenUsage(model, inputTokens, outputTokens) {
    const cost = calculateModelCost(model, inputTokens, outputTokens);
    const current = getLocalSpendHistory();
    current.spentAmount = Number((current.spentAmount + cost).toFixed(4));
    current.totalInputTokens += inputTokens;
    current.totalOutputTokens += outputTokens;
    current.requestCount += 1;
    current.lastUpdated = Date.now();
    try {
        const dir = getOmpAgentDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(getUsageHistoryPath(), JSON.stringify(current, null, 2), "utf-8");
    }
    catch {
        // Ignore save errors
    }
}
/**
 * Fetches and parses live usage/account info from Zed Cloud using available credentials.
 */
export async function fetchZedUsage(creds) {
    if (!creds || (!creds.accessToken && !creds.sessionCookie)) {
        return null;
    }
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://dashboard.zed.dev/",
        "Origin": "https://dashboard.zed.dev",
    };
    // 1. Try Frontend Billing API if session cookie is present or auto-discoverable from browser
    let cookieToTry = creds.sessionCookie;
    let isAutoDiscovered = false;
    if (!cookieToTry) {
        const discovered = findBrowserSessionCookie();
        if (discovered) {
            cookieToTry = discovered;
            isAutoDiscovered = true;
        }
    }
    const tryBillingWithCookie = async (rawCookie) => {
        const cookieHeader = rawCookie.startsWith("zed.session=") ? rawCookie : `zed.session=${rawCookie}`;
        const billingEndpoints = [
            "https://cloud.zed.dev/frontend/billing/usage",
            "https://cloud.zed.dev/frontend/billing",
            "https://cloud.zed.dev/frontend/usage",
        ];
        for (const url of billingEndpoints) {
            try {
                const res = await fetch(url, {
                    method: "GET",
                    headers: {
                        ...headers,
                        "Cookie": cookieHeader,
                    },
                });
                if (res.ok) {
                    const data = (await res.json());
                    const currentUsage = data["current_usage"] || {};
                    const tokenSpend = currentUsage["token_spend"] || {};
                    const editPred = currentUsage["edit_predictions"] || {};
                    const planRaw = data["plan"] || "";
                    const planName = normalizePlanName(planRaw);
                    const isFree = planName.toLowerCase().includes("free") || planRaw.toLowerCase().includes("free");
                    let monthlyCredit = isFree ? 0.0 : 10.0;
                    if (typeof tokenSpend["limit_in_cents"] === "number") {
                        monthlyCredit = Number((tokenSpend["limit_in_cents"] / 100).toFixed(2));
                    }
                    else if (typeof data["credit_limit"] === "number") {
                        monthlyCredit =
                            typeof data["credit_limit"] === "number" && data["credit_limit"] > 100
                                ? Number((data["credit_limit"] / 100).toFixed(2))
                                : Number(data["credit_limit"].toFixed(2));
                    }
                    let spentAmount = 0.0;
                    if (typeof tokenSpend["spend_in_cents"] === "number") {
                        spentAmount = Number((tokenSpend["spend_in_cents"] / 100).toFixed(2));
                    }
                    else if (typeof data["token_spend_cents"] === "number") {
                        spentAmount = Number((data["token_spend_cents"] / 100).toFixed(2));
                    }
                    else if (typeof data["current_spend_cents"] === "number") {
                        spentAmount = Number((data["current_spend_cents"] / 100).toFixed(2));
                    }
                    else if (typeof data["current_spend"] === "number") {
                        spentAmount =
                            data["current_spend"] > 100 && monthlyCredit <= 100
                                ? Number((data["current_spend"] / 100).toFixed(2))
                                : Number(data["current_spend"].toFixed(2));
                    }
                    else if (typeof data["spent"] === "number") {
                        spentAmount =
                            data["spent"] > 100 && monthlyCredit <= 100
                                ? Number((data["spent"] / 100).toFixed(2))
                                : Number(data["spent"].toFixed(2));
                    }
                    else if (typeof data["spend"] === "number") {
                        spentAmount = Number(data["spend"].toFixed(2));
                    }
                    let remainingCredit = Math.max(0, Number((monthlyCredit - spentAmount).toFixed(2)));
                    if (typeof tokenSpend["remaining_in_cents"] === "number") {
                        remainingCredit = Number((tokenSpend["remaining_in_cents"] / 100).toFixed(2));
                    }
                    const spentPercentage = monthlyCredit > 0 ? Math.min(100, Math.round((spentAmount / monthlyCredit) * 100)) : 0;
                    const resetDate = (data["period_end"] || data["period_end_date"] || data["resets_at"]);
                    return {
                        planName,
                        monthlyCredit,
                        spentAmount,
                        remainingCredit,
                        spentPercentage,
                        resetDate,
                        editPredictions: editPred
                            ? {
                                used: typeof editPred["used"] === "number" ? editPred["used"] : 0,
                                limit: editPred["limit"] === null ? "unlimited" : String(editPred["limit"] ?? "unlimited"),
                            }
                            : undefined,
                        hasDetailedBilling: true,
                        raw: data,
                    };
                }
            }
            catch {
                // Try next endpoint
            }
        }
        return null;
    };
    if (cookieToTry) {
        const billingReport = await tryBillingWithCookie(cookieToTry);
        if (billingReport) {
            if (isAutoDiscovered) {
                saveCredentials({ sessionCookie: cookieToTry });
            }
            return billingReport;
        }
        // If initial cookie was stored but failed (expired), try a fresh browser scan
        if (!isAutoDiscovered) {
            const freshDiscovered = findBrowserSessionCookie();
            if (freshDiscovered && freshDiscovered !== cookieToTry) {
                const retryReport = await tryBillingWithCookie(freshDiscovered);
                if (retryReport) {
                    saveCredentials({ sessionCookie: freshDiscovered });
                    return retryReport;
                }
            }
        }
    }
    // 2. Try Client User Endpoint if access token is present
    if (creds.accessToken) {
        let userId = creds.userId;
        const token = creds.accessToken;
        if (token.startsWith("{")) {
            try {
                const parsed = JSON.parse(token);
                if (parsed["legacy_user_id"] || parsed["user_id"]) {
                    userId = userId || String(parsed["legacy_user_id"] || parsed["user_id"]);
                }
            }
            catch {
                // Ignore JSON parse errors
            }
        }
        const authCandidates = [];
        if (userId) {
            authCandidates.push(`${userId} ${token}`);
        }
        authCandidates.push(`Bearer ${token}`);
        authCandidates.push(token);
        const endpoints = [
            "https://cloud.zed.dev/client/users/me",
            "https://cloud.zed.dev/api/users/me",
            "https://api.zed.dev/users/me",
        ];
        for (const endpoint of endpoints) {
            for (const authHeader of authCandidates) {
                try {
                    const res = await fetch(endpoint, {
                        method: "GET",
                        headers: {
                            "Authorization": authHeader,
                            "User-Agent": "Zed",
                            "Accept": "application/json",
                        },
                    });
                    if (res.ok) {
                        const data = (await res.json());
                        const user = data["user"] || data;
                        const planObj = data["plan"] || {};
                        const plansByOrg = data["plans_by_organization"] || {};
                        const orgPlan = Object.values(plansByOrg)[0];
                        // Format clean plan name
                        const rawPlan = (planObj["plan_v3"] || orgPlan || planObj["plan_v2"] || planObj["plan"] || user["plan"]);
                        const planName = normalizePlanName(rawPlan || (user["is_pro"] ? "pro" : undefined));
                        const isFree = planName.toLowerCase().includes("free") || (rawPlan && rawPlan.toLowerCase().includes("free"));
                        const monthlyCredit = isFree ? 0.0 : 10.0;
                        const username = (user["github_login"] || user["username"] || user["name"] || creds.githubUsername);
                        const subPeriod = planObj["subscription_period"];
                        const resetDate = (subPeriod?.["ended_at"] || data["period_end"]);
                        const usageObj = planObj["usage"];
                        const modelReq = usageObj?.["model_requests"];
                        const editPred = usageObj?.["edit_predictions"];
                        const localSpend = getLocalSpendHistory();
                        const spentAmount = localSpend.spentAmount > monthlyCredit && monthlyCredit > 0 ? monthlyCredit : Number(localSpend.spentAmount.toFixed(2));
                        const remainingCredit = Math.max(0, Number((monthlyCredit - spentAmount).toFixed(2)));
                        const spentPercentage = monthlyCredit > 0 ? Math.min(100, Math.round((spentAmount / monthlyCredit) * 100)) : 0;
                        return {
                            planName,
                            monthlyCredit,
                            spentAmount,
                            remainingCredit,
                            spentPercentage,
                            resetDate,
                            username,
                            userId: String(user["id"] || userId || ""),
                            modelRequests: modelReq ? { used: modelReq.used, limit: typeof modelReq.limit === "object" ? String(modelReq.limit?.["limited"] ?? 0) : String(modelReq.limit ?? "") } : undefined,
                            editPredictions: editPred ? { used: editPred.used, limit: String(editPred.limit ?? "unlimited") } : undefined,
                            hasDetailedBilling: false,
                            raw: data,
                        };
                    }
                }
                catch {
                    // Try next header / endpoint
                }
            }
        }
    }
    // 3. Fallback: if we have any valid credentials, return a baseline active report
    if (creds.accessToken || creds.sessionCookie) {
        const localSpend = getLocalSpendHistory();
        const monthlyCredit = 10.0;
        const spentAmount = Math.min(monthlyCredit, Number(localSpend.spentAmount.toFixed(2)));
        const remainingCredit = Math.max(0, Number((monthlyCredit - spentAmount).toFixed(2)));
        const spentPercentage = monthlyCredit > 0 ? Math.min(100, Math.round((spentAmount / monthlyCredit) * 100)) : 0;
        return {
            planName: "Zed Student Plan",
            monthlyCredit,
            spentAmount,
            remainingCredit,
            spentPercentage,
            username: creds.githubUsername,
            userId: creds.userId,
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
        return [
            "No active Zed credentials found.",
            "",
            "To connect your Zed account:",
            "• Run '/zed login' to authenticate via browser",
            "• Or run '/zed set-token <token>' to manually save your token",
            "• Or log into Zed editor on your machine (auto-detected)",
        ].join("\n");
    }
    const progressBarLength = 20;
    const spentPct = Math.max(0, Math.min(100, report.spentPercentage));
    const filledBars = Math.round((spentPct / 100) * progressBarLength);
    const emptyBars = progressBarLength - filledBars;
    const progressBar = `[${"█".repeat(filledBars)}${"░".repeat(emptyBars)}] ${spentPct}%`;
    const lines = [
        `📊 Zed AI Monthly Usage (${report.planName})`,
        `----------------------------------------`,
        `Credit Spend:  $${report.spentAmount.toFixed(2)} / $${report.monthlyCredit.toFixed(2)}`,
        `Remaining:     $${report.remainingCredit.toFixed(2)}`,
        `Usage Bar:     ${progressBar}`,
    ];
    if (report.username) {
        lines.push(`Account:       ${report.username}`);
    }
    if (report.resetDate) {
        const d = new Date(report.resetDate);
        const dateStr = isNaN(d.getTime()) ? report.resetDate : d.toLocaleDateString();
        lines.push(`Period Resets: ${dateStr}`);
    }
    if (report.editPredictions) {
        lines.push(`Edit Edits:    ${report.editPredictions.limit}`);
    }
    if (report.hasDetailedBilling) {
        lines.push(`Source:        ✓ Live Dashboard Sync (dashboard.zed.dev)`);
    }
    else {
        lines.push(`Source:        Local Extension Tracker`, ``, `💡 Note: Zed's client API only provides plan details, not dollar spend.`, `• Auto-sync live spend from browser:   /zed sync`, `• Or set your current monthly spend:   /zed set-spend 1.90`, `• Or reset session spend count:       /zed reset-usage`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=tracker.js.map