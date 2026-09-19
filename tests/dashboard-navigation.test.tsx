// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dashboard } from "@/components/sentinel/dashboard";
import type { RuntimeStatus } from "@/lib/domain/commerce";

// Regression coverage for the mobile-nav bug report: "tapping Inspect does not
// switch the active mode." The suspected root cause was a CSS stacking/overlap
// issue at a narrow viewport (see globals.css .test-banner), which jsdom cannot
// exercise - it has no layout engine, so element overlap and hit-testing aren't
// observable here. What this DOES cover, with a real React synthetic click
// (fireEvent.click, not a synthetic pointer event replay): that ModeCards'
// onSelect wiring actually flips Dashboard's active view. It guards against a
// regression in that wiring; it is not a substitute for an on-device retest of
// the CSS fix itself.

const status: RuntimeStatus = {
  aiCredential: "detected", agnicCredential: "detected", aiEnabled: true,
  model: "gpt-6-astra", realPurchasesEnabled: false, developmentMode: true,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(status), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function modeNav() { return screen.getByRole("navigation", { name: /sentinel modes/i }); }

describe("Dashboard: mode nav switches the active view", () => {
  it("starts on Request", () => {
    render(<Dashboard />);
    expect(document.getElementById("request")).toBeTruthy();
    expect(document.getElementById("inspect-upload")).toBeNull();
    expect(document.getElementById("build-upload")).toBeNull();
  });

  it("tapping Inspect switches to the Inspect panel", () => {
    render(<Dashboard />);
    fireEvent.click(within(modeNav()).getByRole("button", { name: /inspect/i }));
    expect(document.getElementById("inspect-upload")).toBeTruthy();
    expect(document.getElementById("request")).toBeNull();
    expect(within(modeNav()).getByRole("button", { name: /inspect/i }).getAttribute("aria-current")).toBe("page");
  });

  it("tapping Build switches to the Build panel", () => {
    render(<Dashboard />);
    fireEvent.click(within(modeNav()).getByRole("button", { name: /build/i }));
    expect(document.getElementById("build-upload")).toBeTruthy();
    expect(document.getElementById("request")).toBeNull();
    expect(within(modeNav()).getByRole("button", { name: /build/i }).getAttribute("aria-current")).toBe("page");
  });

  it("tapping back to Request restores the Request panel", () => {
    render(<Dashboard />);
    fireEvent.click(within(modeNav()).getByRole("button", { name: /inspect/i }));
    fireEvent.click(within(modeNav()).getByRole("button", { name: /request/i }));
    expect(document.getElementById("request")).toBeTruthy();
    expect(document.getElementById("inspect-upload")).toBeNull();
  });
});
