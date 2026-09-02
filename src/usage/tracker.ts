import * as fs from "node:fs";
import * as path from "node:path";
import type { ZedCredentials } from "../auth/types.js";
import { getOmpAgentDir } from "../auth/credential-store.js";
import { DEFAULT_MODEL_PRICING, type ModelPricingEntry } from "../models.js";

export type ModelPrice = ModelPricingEntry;

export const MODEL_PRICING: Record<string, ModelPrice> = {
  ...DEFAULT_MODEL_PRICING,
  default: { input: 3.3, output: 16.5 },
};

export function normalizePlanName(rawPlan?: string): string {
  if (!rawPlan) return "Zed Pro Plan";
  const lower = rawPlan.toLowerCase();
  if (lower.includes("student")) return "Zed Student Plan";
  if (lower.includes("pro")) return "Zed Pro Plan";
  if (lower.includes("free")) return "Zed Free Plan";
  if (lower.includes("business") || lower.includes("team") || lower.includes("enterprise")) return "Zed Business Plan";
  return `Zed ${rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1)}`;
}

export function calculateModelCost(model: string, inputTokens: number, outputTokens: number): number {
  const clean = model.replace(/^zed\//i, "").toLowerCase();
  const pricing = MODEL_PRICING[clean] || MODEL_PRICING["default"]!;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export function getUsageHistoryPath(): string {
  return path.join(getOmpAgentDir(), "zed_usage_history.json");
}

export interface LocalSpendRecord {
  period: string; // YYYY-MM
  spentAmount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  lastUpdated: number;
}

export function getLocalSpendHistory(): LocalSpendRecord {
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const filePath = getUsageHistoryPath();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as LocalSpendRecord;
      if (parsed.period === currentPeriod) {
        return parsed;
      }
    }
  } catch {}
  return {
    period: currentPeriod,
    spentAmount: 0.0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    requestCount: 0,
    lastUpdated: Date.now(),
  };
}

function saveLocalSpend(record: LocalSpendRecord): void {
  try {
    fs.mkdirSync(getOmpAgentDir(), { recursive: true, mode: 0o700 });
    const p = getUsageHistoryPath();
    fs.writeFileSync(p, JSON.stringify(record, null, 2), { encoding: "utf-8", mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch {}
  } catch {}
}

export function resetLocalSpendHistory(): void {
  saveLocalSpend({ period: new Date().toISOString().slice(0, 7), spentAmount: 0, totalInputTokens: 0, totalOutputTokens: 0, requestCount: 0, lastUpdated: Date.now() });
}

export function setLocalSpendAmount(amount: number): void {
  const current = getLocalSpendHistory();
  current.spentAmount = Math.max(0, Number(amount.toFixed(2)));
  current.lastUpdated = Date.now();
  saveLocalSpend(current);
}

export function recordTokenUsage(model: string, inputTokens: number, outputTokens: number): void {
  const cost = calculateModelCost(model, inputTokens, outputTokens);
  const current = getLocalSpendHistory();
  current.spentAmount = Number((current.spentAmount + cost).toFixed(4));
  current.totalInputTokens += inputTokens;
  current.totalOutputTokens += outputTokens;
  current.requestCount += 1;
  current.lastUpdated = Date.now();
  saveLocalSpend(current);
}

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
 * Fetches live usage from Zed Cloud. Single canonical endpoint only.
 */
export async function fetchZedUsage(creds: ZedCredentials | null | undefined): Promise<ZedUsageReport | null> {
  if (!creds || (!creds.accessToken && !creds.sessionCookie)) return null;

  if (creds.sessionCookie) {
    try {
      const cookieHeader = creds.sessionCookie.startsWith("zed.session=") ? creds.sessionCookie : `zed.session=${creds.sessionCookie}`;
      const res = await fetch("https://cloud.zed.dev/frontend/billing/usage", {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: "https://dashboard.zed.dev/",
          Origin: "https://dashboard.zed.dev",
          Cookie: cookieHeader,
        },
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const currentUsage = (data["current_usage"] as Record<string, unknown>) || {};
        const tokenSpend = (currentUsage["token_spend"] as Record<string, unknown>) || {};
        const editPred = (currentUsage["edit_predictions"] as Record<string, unknown>) || {};
        const planRaw = (data["plan"] as string) || "";
        const planName = normalizePlanName(planRaw);
        const monthlyCredit = typeof tokenSpend["limit_in_cents"] === "number" ? Number((tokenSpend["limit_in_cents"] / 100).toFixed(2)) : planName.toLowerCase().includes("free") ? 0 : 10;
        const spentAmount = typeof tokenSpend["spend_in_cents"] === "number" ? Number((tokenSpend["spend_in_cents"] / 100).toFixed(2)) : 0;
        const remainingCredit = typeof tokenSpend["remaining_in_cents"] === "number" ? Number((tokenSpend["remaining_in_cents"] / 100).toFixed(2)) : Math.max(0, Number((monthlyCredit - spentAmount).toFixed(2)));
        const spentPercentage = monthlyCredit > 0 ? Math.min(100, Math.round((spentAmount / monthlyCredit) * 100)) : 0;
        const resetDate = (data["period_end"] || data["period_end_date"] || data["resets_at"]) as string | undefined;
        return {
          planName, monthlyCredit, spentAmount, remainingCredit, spentPercentage, resetDate,
          editPredictions: { used: typeof editPred["used"] === "number" ? editPred["used"] : 0, limit: editPred["limit"] === null ? "unlimited" : String(editPred["limit"] ?? "unlimited") },
          hasDetailedBilling: true, raw: data,
        };
      }
    } catch {}
  }

  if (creds.accessToken || creds.sessionCookie) {
    const localSpend = getLocalSpendHistory();
    const monthlyCredit = 10;
    const spentAmount = Math.min(monthlyCredit, Number(localSpend.spentAmount.toFixed(2)));
    const remainingCredit = Math.max(0, Number((monthlyCredit - spentAmount).toFixed(2)));
    const spentPercentage = monthlyCredit > 0 ? Math.min(100, Math.round((spentAmount / monthlyCredit) * 100)) : 0;
    return { planName: "Zed Student Plan", monthlyCredit, spentAmount, remainingCredit, spentPercentage, username: creds.githubUsername, userId: creds.userId, hasDetailedBilling: false };
  }
  return null;
}

/**
 * Formats a user-friendly string summary of the usage report for TUI display.
 */
export function formatUsageSummary(report: ZedUsageReport | null): string {
  if (!report) {
    return [
      "No active Zed credentials found.",
      "",
      "To connect your Zed account:",
      "• Run '/zed login' to authenticate via browser",
      "• Or run '/zed set-token <token>' to manually save your token",
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
  } else {
    lines.push(
      `Source:        Local Extension Tracker`,
      ``,
      `💡 Note: Zed's client API only provides plan details, not dollar spend.`,
      `• Auto-sync live spend from browser:   /zed sync`,
      `• Or set your current monthly spend:   /zed set-spend 1.90`,
      `• Or reset session spend count:       /zed reset-usage`,
    );
  }
  return lines.join("\n");
}
