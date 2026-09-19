import { describe, expect, it } from "vitest";
import { consentPage, interactionSubmitGuardScript } from "./html.js";

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
