import { describe, expect, it } from "vitest";
import { formatUsageSummary, type ZedUsageReport } from "../src/usage/tracker.js";

describe("Usage Tracker", () => {
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
      hasDetailedBilling: false,
    };

    const formatted = formatUsageSummary(report);
    expect(formatted).toContain("Zed Pro (Student)");
    expect(formatted).toContain("Baylar55");
    expect(formatted).toContain("Active");
  });

  it("handles null reports gracefully", () => {
    const formatted = formatUsageSummary(null);
    expect(formatted).toContain("No active Zed credentials found");
  });
});
