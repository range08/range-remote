import { describe, expect, it } from "vitest";
import { consentPage, interactionSubmitGuardScript, usagePage } from "./html.js";

describe("authorization UI safeguards", () => {
  it("loads the same-origin submit guard on authorization pages", () => {
    const html = consentPage("uid-1", "csrf-1", "Client", ["remote:use"]);
    expect(html).toContain('<script src="/auth/ui.js" defer></script>');
  });

  it("prevents duplicate form submissions without disabling submitter values", () => {
    expect(interactionSubmitGuardScript).toContain('form.dataset.rrSubmitting === "1"');
    expect(interactionSubmitGuardScript).toContain("event.preventDefault()");
    expect(interactionSubmitGuardScript).toContain('pointerEvents = "none"');
    expect(interactionSubmitGuardScript).not.toContain(".disabled = true");
  });
});


describe("usage dashboard", () => {
  it("renders monthly usage without exposing a fake quota", () => {
    const html = usagePage("range", "csrf", {
      period: { timezone: "UTC", monthStart: "2026-09-01T00:00:00.000Z", generatedAt: "2026-09-19T12:00:00.000Z" },
      trackingSince: "2026-09-19T10:00:00.000Z",
      thisMonth: { calls: 1234, successes: 1200, failures: 34, successRate: 1200 / 1234, avgDurationMs: 250 },
      todayCalls: 56,
      totalCalls: 1234,
      activeDays: 1,
      topTools: [{ name: "read_file", calls: 500, successRate: 0.99, avgDurationMs: 100 }],
      daily: [{ date: "2026-09-19", calls: 56, failures: 2 }],
      recent: [{ at: "2026-09-19T11:00:00.000Z", toolName: "read_file", deviceId: "d1", deviceName: "vnic", durationMs: 100, success: true }]
    });
    expect(html).toContain("1,234");
    expect(html).toContain("Unlimited");
    expect(html).toContain("read_file");
    expect(html).toContain("vnic");
    expect(html).not.toContain("10,000");
  });
});
