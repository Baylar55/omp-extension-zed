import { describe, expect, it } from "vitest";
import { formatUsageSummary, type ZedUsageReport } from "../src/usage/tracker.js";

describe("Usage Tracker", () => {
  it("formats usage reports clearly with progress bar", () => {
    const report: ZedUsageReport = {
      planName: "Zed Student Plan",
      monthlyCredit: 10.0,
      spentAmount: 2.5,
      remainingCredit: 7.5,
      spentPercentage: 25,
      resetDate: "2026-09-01T00:00:00Z",
    };

    const formatted = formatUsageSummary(report);
    expect(formatted).toContain("Zed Student Plan");
    expect(formatted).toContain("$2.50 / $10.00");
    expect(formatted).toContain("$7.50");
    expect(formatted).toContain("25%");
  });

  it("handles null reports gracefully", () => {
    const formatted = formatUsageSummary(null);
    expect(formatted).toContain("Could not retrieve live usage");
  });
});
