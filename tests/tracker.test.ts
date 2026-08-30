import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateModelCost, fetchZedUsage, formatUsageSummary, getLocalSpendHistory, recordTokenUsage, resetLocalSpendHistory, setLocalSpendAmount, type ZedUsageReport } from "../src/usage/tracker.js";
describe("Usage Tracker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats detailed billing reports clearly with progress bar", () => {
    const report: ZedUsageReport = {
      planName: "Zed Student Plan",
      monthlyCredit: 10.0,
      spentAmount: 2.5,
      remainingCredit: 7.5,
      spentPercentage: 25,
      resetDate: "2026-09-01T00:00:00Z",
      hasDetailedBilling: true,
    };

    const formatted = formatUsageSummary(report);
    expect(formatted).toContain("Zed Student Plan");
    expect(formatted).toContain("$2.50 / $10.00");
    expect(formatted).toContain("$7.50");
    expect(formatted).toContain("25%");
  });

  it("handles standard token report without detailed billing", () => {
    const report: ZedUsageReport = {
      planName: "Zed Pro (Student)",
      monthlyCredit: 10.0,
      spentAmount: 0.0,
      remainingCredit: 10.0,
      spentPercentage: 0,
      username: "Baylar55",
      resetDate: "2026-09-30T00:00:00.000Z",
      editPredictions: { used: 0, limit: "unlimited" },
      hasDetailedBilling: false,
    };

    const formatted = formatUsageSummary(report);
    expect(formatted).toContain("Zed Pro (Student)");
    expect(formatted).toContain("Baylar55");
    expect(formatted).toContain("Credit Spend:  $0.00 / $10.00");
    expect(formatted).toContain("Remaining:     $10.00");
    expect(formatted).toContain("unlimited");
    expect(formatted).toContain("/zed sync");
    expect(formatted).toContain("/zed set-spend");
  });

  it("handles null reports gracefully with setup instructions", () => {
    const formatted = formatUsageSummary(null);
    expect(formatted).toContain("No active Zed credentials found");
    expect(formatted).toContain("/zed login");
  });

  it("fetches user plan from client/users/me endpoint correctly", async () => {
    const mockResponse = {
      user: {
        id: 733208,
        username: "Baylar55",
        github_login: "Baylar55",
      },
      plans_by_organization: {
        org_123: "zed_student",
      },
      plan: {
        plan_v3: "zed_student",
        subscription_period: {
          started_at: "2026-08-30T00:00:00.000Z",
          ended_at: "2026-09-30T00:00:00.000Z",
        },
        usage: {
          model_requests: { used: 5, limit: { limited: 100 } },
          edit_predictions: { used: 12, limit: "unlimited" },
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const report = await fetchZedUsage({
      userId: "733208",
      accessToken: "sample_token",
    });

    expect(report).not.toBeNull();
    expect(report?.planName).toBe("Zed Student Plan");
    expect(report?.username).toBe("Baylar55");
    expect(report?.userId).toBe("733208");
    expect(report?.editPredictions?.limit).toBe("unlimited");
    expect(report?.modelRequests?.used).toBe(5);
  });

  it("falls back to active baseline report if network fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network offline"));

    const report = await fetchZedUsage({
      accessToken: "sample_token",
      githubUsername: "Baylar55",
    });

    expect(report).not.toBeNull();
    expect(report?.planName).toBe("Zed Student Plan");
    expect(report?.username).toBe("Baylar55");
    expect(report?.hasDetailedBilling).toBe(false);
  });

  it("returns null when no credentials provided", async () => {
    const report = await fetchZedUsage({});
    expect(report).toBeNull();
  });

  it("calculates model cost accurately", () => {
    // claude-sonnet: $3/1M in, $15/1M out -> 100k in = 0.30, 20k out = 0.30 -> total 0.60
    const cost = calculateModelCost("zed/claude-sonnet-4-6", 100_000, 20_000);
    expect(cost).toBeCloseTo(0.60, 2);
  });

  it("records token usage and updates local spend history", () => {
    const before = getLocalSpendHistory();
    recordTokenUsage("zed/claude-sonnet-4-6", 50_000, 10_000);
    const after = getLocalSpendHistory();
    expect(after.totalInputTokens).toBe(before.totalInputTokens + 50_000);
    expect(after.totalOutputTokens).toBe(before.totalOutputTokens + 10_000);
    expect(after.spentAmount).toBeGreaterThanOrEqual(before.spentAmount);
  });

  it("parses live frontend/billing/usage token_spend and edit_predictions", async () => {
    const mockBillingResponse = {
      plan: "zed_student",
      is_account_too_young: false,
      current_usage: {
        token_spend: {
          spend_in_cents: 53,
          limit_in_cents: 500,
          remaining_in_cents: 447,
        },
        edit_predictions: {
          used: 0,
          limit: null,
          remaining: null,
        },
      },
      portal_url: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBillingResponse,
    } as Response);

    const report = await fetchZedUsage({
      sessionCookie: "test_cookie",
    });

    expect(report).not.toBeNull();
    expect(report?.planName).toBe("Zed Student Plan");
    expect(report?.spentAmount).toBe(0.53);
    expect(report?.monthlyCredit).toBe(5.0);
    expect(report?.remainingCredit).toBe(4.47);
    expect(report?.hasDetailedBilling).toBe(true);
    expect(report?.editPredictions?.limit).toBe("unlimited");
  });

  it("sets and resets local spend amount", () => {
    setLocalSpendAmount(0.53);
    let hist = getLocalSpendHistory();
    expect(hist.spentAmount).toBe(0.53);

    resetLocalSpendHistory();
    hist = getLocalSpendHistory();
    expect(hist.spentAmount).toBe(0.0);
  });

  it("includes /zed sync and note about Zed client API in usage summary", () => {
    const report: ZedUsageReport = {
      planName: "Zed Student Plan",
      monthlyCredit: 5.0,
      spentAmount: 1.90,
      remainingCredit: 3.10,
      spentPercentage: 38,
      username: "Baylar55",
      hasDetailedBilling: false,
    };

    const formatted = formatUsageSummary(report);
    expect(formatted).toContain("Local Extension Tracker");
    expect(formatted).toContain("/zed sync");
    expect(formatted).toContain("/zed set-spend");
  });
});
