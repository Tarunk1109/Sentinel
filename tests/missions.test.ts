import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DemoMissionService } from "@/lib/server/services/mission";

describe("demo discovery constraints", () => {
  const service = new DemoMissionService();

  it.each([
    ["portable monitor", "monitor"],
    ["a keyboard", "keyboard"],
    ["wireless headphones", "headphones"],
    ["a USB-C hub", "hub"],
  ])("matches only the requested category for %s", async (prompt, category) => {
    const mission = await service.run(prompt);
    expect(mission.products.length).toBeGreaterThan(0);
    expect(mission.products.every((product) => product.category === category)).toBe(true);
    expect(mission.products.filter((product) => product.recommended)).toHaveLength(1);
  });

  it.each([
    ["monitor under $179", [149]],
    ["monitor up to $179", [179, 149]],
    ["monitor budget: $150", [149]],
    ["monitor $150 or less", [149]],
    ["monitor between $160 and $190", [179]],
    ["monitor with a budget between 160 and 190", [179]],
    ["monitor with a price range 160-190", [179]],
    ["monitor between 160 and 190 USD", [179]],
    ["monitor under $1,000", [179, 149, 199]],
    ["monitor maximum price 150", [149]],
    ["monitor under $100", []],
    ["monitor max $0", []],
    ["monitor between $200 and $100", []],
  ])("filters the numeric budget in %s", async (prompt, expectedAmounts) => {
    const mission = await service.run(prompt);
    expect(mission.products.map((product) => product.price.amount)).toEqual(expectedAmounts);
    expect(mission.status).toBe(expectedAmounts.length ? "ready" : "no-results");
  });

  it.each([
    ["I need a 15-16 inch portable monitor under $200 for my MacBook.", [179, 149, 199]],
    ["I need a USB-C hub with USB 3.0 and 4K HDMI under $80.", [69, 39]],
    ["I need headphones with 2-3 days of battery life under $200.", [129, 79, 189]],
  ])("does not mistake specifications for a budget range: %s", async (prompt, expectedAmounts) => {
    const mission = await service.run(prompt);
    expect(mission.products.map((product) => product.price.amount)).toEqual(expectedAmounts);
    expect(mission.constraints.some((constraint) => constraint.startsWith("At least"))).toBe(false);
  });

  it.each(["monitor under 200 CAD", "monitor under €200", "keyboard for £100"])(
    "does not pretend to convert unsupported currency: %s", async (prompt) => {
      const mission = await service.run(prompt);
      expect(mission.products).toEqual([]);
      expect(mission.summary).toContain("USD only");
    },
  );

  it("does not silently choose one category from a multi-item request", async () => {
    const mission = await service.run("I need a monitor and a keyboard");
    expect(mission.status).toBe("no-results");
    expect(mission.products).toEqual([]);
    expect(mission.summary).toContain("one category");
  });

  it.each(["a monitor arm", "a keyboard cover", "a headphone cable", "earbuds"])(
    "does not return the wrong product for unsupported requests: %s", async (prompt) => {
      const mission = await service.run(prompt);
      expect(mission.status).toBe("no-results");
      expect(mission.products).toEqual([]);
    },
  );

  it("does not claim to verify advanced constraints", async () => {
    const mission = await service.run("a 4K OLED monitor under $200 for a MacBook Pro");
    expect(mission.summary).toContain("Other requirements and compatibility remain unverified");
    expect(mission.products.every((product) => product.compatibility.status === "unverified")).toBe(true);
  });

  it("isolates catalog objects between missions", async () => {
    const first = await service.run("monitor");
    first.products[0].highlights.push("must not leak");
    first.products[0].price.amount = 0;
    const next = await service.run("monitor");
    expect(next.id).not.toBe(first.id);
    expect(next.products[0].price.amount).toBe(179);
    expect(next.products[0].highlights).not.toContain("must not leak");
  });
});
