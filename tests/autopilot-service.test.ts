import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { productIntentSchema, type RequestMission } from "@/lib/domain/commerce";
import { AutopilotService, type AutopilotCommerce } from "@/lib/autopilot/service";
import { InMemoryAutopilotStore } from "@/lib/autopilot/store";
import { ProviderError } from "@/lib/server/provider-error";
import { DispatchJournal } from "@/lib/server/dispatch-journal";
import { AgnicCheckoutProvider } from "@/lib/server/adapters/agnic-checkout";
import { drink, FakeCommerce, MONDAY_9AM_TORONTO, MutableClock, OTHER_OWNER, OWNER, policyInput } from "./autopilot-helpers";

function setup(options: { available?: boolean; catalog?: ReturnType<typeof drink>[] } = {}) {
  const clock = new MutableClock(MONDAY_9AM_TORONTO);
  const commerce = new FakeCommerce(options.available ?? true, options.catalog, () => new ProviderError("SELECTION_EXPIRED", "This selection expired. Find the product again to continue.", 409));
  const service = new AutopilotService(new InMemoryAutopilotStore(clock.now), commerce, clock.now);
  return { clock, commerce, service };
}
async function activePolicy(service: AutopilotService, input = policyInput()) {
  const { policy } = await service.create(OWNER, input);
  return (await service.activate(OWNER, policy.id)).policy;
}
async function rejects(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toMatchObject({ code, status });
}
const signal = () => new AbortController().signal;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Autopilot policy lifecycle", () => {
  it("creates DRAFT policies only, with no schedule until activation", async () => {
    const { service } = setup();
    const view = await service.create(OWNER, policyInput());
    expect(view.policy).toMatchObject({ status: "DRAFT", version: 1, demo: false, fixtureId: null, schedule: { nextRunAt: null } });
    expect(view.due).toBe(false);
    expect(view.budget).toMatchObject({ weeklyAuthorityMinor: 7000, remainingMinor: 7000, committedMinor: 0 });
    await rejects(service.create(OWNER, { ...policyInput(), status: "ACTIVE" }), "INVALID_REQUEST", 400);
  });

  it("#6 pause works and is idempotent; a draft cannot be paused", async () => {
    const { service } = setup();
    const draft = (await service.create(OWNER, policyInput())).policy;
    await rejects(service.pause(OWNER, draft.id), "AUTOPILOT_INVALID_TRANSITION", 409);
    await service.activate(OWNER, draft.id);
    const paused = (await service.pause(OWNER, draft.id)).policy;
    expect(paused).toMatchObject({ status: "PAUSED", schedule: { nextRunAt: null } });
    expect((await service.pause(OWNER, draft.id)).policy.version).toBe(paused.version);
  });

  it("#7 resume works, restarting the schedule from now without back-filling", async () => {
    const { service, clock } = setup();
    const policy = await activePolicy(service);
    expect(policy.schedule.nextRunAt).toBe("2026-09-28T13:00:00.000Z");
    await service.pause(OWNER, policy.id);
    clock.set("2026-10-21T15:00:00Z"); // three weekly slots missed while paused
    const resumed = (await service.resume(OWNER, policy.id)).policy;
    expect(resumed).toMatchObject({ status: "ACTIVE", schedule: { nextRunAt: "2026-10-26T13:00:00.000Z" } });
    const draft = (await service.create(OWNER, policyInput())).policy;
    await rejects(service.resume(OWNER, draft.id), "AUTOPILOT_INVALID_TRANSITION", 409);
    await rejects(service.activate(OWNER, policy.id).then(() => service.pause(OWNER, policy.id)).then(() => service.activate(OWNER, policy.id)), "AUTOPILOT_INVALID_TRANSITION", 409);
  });

  it("only name/goal may change while ACTIVE; mandate edits need a paused policy", async () => {
    const { service } = setup();
    const policy = await activePolicy(service);
    await rejects(service.update(OWNER, policy.id, { budget: { maximumPerWeekMinor: 90000 } }), "AUTOPILOT_POLICY_ACTIVE", 409);
    expect((await service.update(OWNER, policy.id, { name: "Front counter drinks" })).policy).toMatchObject({ name: "Front counter drinks", version: policy.version + 1, status: "ACTIVE" });
    await service.pause(OWNER, policy.id);
    expect((await service.update(OWNER, policy.id, { budget: { maximumPerWeekMinor: 9000 } })).policy.budget).toEqual({ maximumPerWeekMinor: 9000, maximumPerRunMinor: 9000 });
    await rejects(service.update(OWNER, policy.id, { budget: { maximumPerWeekMinor: 0 } }), "INVALID_REQUEST", 400);
    await rejects(service.update(OWNER, policy.id, { status: "ACTIVE" }), "INVALID_REQUEST", 400);
  });

  it("scopes every policy to its owner and caps policies per owner", async () => {
    const { service } = setup();
    const policy = (await service.create(OWNER, policyInput())).policy;
    await rejects(service.get(OTHER_OWNER, policy.id), "AUTOPILOT_POLICY_NOT_FOUND", 404);
    await rejects(service.activate(OTHER_OWNER, policy.id), "AUTOPILOT_POLICY_NOT_FOUND", 404);
    expect(await service.list(OTHER_OWNER)).toEqual([]);
    for (let index = 1; index < 20; index++) await service.create(OWNER, policyInput());
    await rejects(service.create(OWNER, policyInput()), "AUTOPILOT_POLICY_LIMIT", 409);
  });
});

describe("Autopilot evaluation and ProductIntent generation", () => {
  it("#17 a draft (inactive) policy cannot run", async () => {
    const { service } = setup();
    const draft = (await service.create(OWNER, policyInput())).policy;
    await rejects(service.evaluate(OWNER, draft.id), "AUTOPILOT_POLICY_NOT_ACTIVE", 409);
  });

  it("#18 a paused policy cannot run, manually or on schedule", async () => {
    const { service, clock } = setup();
    const policy = await activePolicy(service);
    await service.pause(OWNER, policy.id);
    await rejects(service.evaluate(OWNER, policy.id), "AUTOPILOT_POLICY_NOT_ACTIVE", 409);
    clock.set("2026-12-01T00:00:00Z");
    expect(await service.runDue(OWNER)).toEqual([]);
  });

  it("generates the SAME ProductIntent contract, tagged with source AUTOPILOT, and searches nothing", async () => {
    const { service, commerce } = setup();
    const policy = await activePolicy(service);
    const run = await service.evaluate(OWNER, policy.id);
    expect(run).toMatchObject({ status: "SEARCH_READY", trigger: "MANUAL", scheduledFor: null, demo: false, purchaseExecuted: false, decision: null });
    expect(run.intents.map(intent => [intent.source, intent.itemId, intent.category])).toEqual([["AUTOPILOT", "cola", "BEVERAGES"], ["AUTOPILOT", "lemon-lime", "BEVERAGES"], ["AUTOPILOT", "orange", "BEVERAGES"]]);
    for (const { intent } of run.intents) expect(productIntentSchema.safeParse(intent).success).toBe(true);
    expect(run.intents[0].intent).toMatchObject({ searchQuery: "Coca-Cola soft drink", productType: "cola soft drink", quantity: 1, budget: { maxAmount: 70, currency: "CAD" }, country: "CA", brandPreferences: ["Coca-Cola"], requiredFeatures: [] });
    expect(run.events.map(event => event.type)).toEqual(["POLICY_EVALUATED", "TRIGGER_MATCHED", "INTENT_GENERATED", "INTENT_GENERATED", "INTENT_GENERATED", "COMMERCE_SEARCH_READY"]);
    expect(run.triggerReason).toBe("A run was requested manually.");
    expect(commerce.searches).toHaveLength(0);
  });

  it("reports COMMERCE_UNAVAILABLE honestly and refuses to search without calling commerce", async () => {
    const { service, commerce } = setup({ available: false });
    const policy = await activePolicy(service);
    const run = await service.evaluate(OWNER, policy.id);
    expect(run.status).toBe("COMMERCE_UNAVAILABLE");
    expect(run.events.at(-1)?.message).toContain("Nothing was searched or purchased.");
    await rejects(service.search(OWNER, policy.id, { runId: run.id, itemId: "cola" }, signal()), "AUTOPILOT_RUN_NOT_SEARCHABLE", 409);
    expect(commerce.searches).toHaveLength(0);
  });

  it("supports INVENTORY_BELOW deterministically from caller-supplied counts", async () => {
    const { service } = setup();
    const policy = await activePolicy(service, policyInput({ trigger: { type: "INVENTORY_BELOW", thresholds: [{ itemId: "cola", minimumUnits: 12 }, { itemId: "orange", minimumUnits: 6 }] } }));
    expect((await service.evaluate(OWNER, policy.id)).status).toBe("ACTION_REQUIRED");
    const stocked = await service.evaluate(OWNER, policy.id, { inventory: [{ itemId: "cola", units: 20 }, { itemId: "orange", units: 6 }] });
    expect(stocked).toMatchObject({ status: "NO_ACTION", intents: [] });
    const low = await service.evaluate(OWNER, policy.id, { inventory: [{ itemId: "cola", units: 3 }] });
    expect(low.status).toBe("SEARCH_READY");
    expect(low.intents.map(intent => intent.itemId)).toEqual(["cola"]);
    expect(low.triggerReason).toBe("Below minimum stock: Coca-Cola or cola. 1 item had no count and was not restocked.");
    await rejects(service.evaluate(OWNER, policy.id, { inventory: [{ itemId: "cola", units: -1 }] }), "INVALID_REQUEST", 400);
  });
});

describe("Autopilot search and mandate authorization", () => {
  it("searches with the run's own intent, then authorizes using the server-side price", async () => {
    const { service, commerce } = setup();
    const policy = await activePolicy(service);
    const run = await service.evaluate(OWNER, policy.id);
    const { run: searched, mission } = await service.search(OWNER, policy.id, { runId: run.id, itemId: "cola" }, signal());
    expect(commerce.searches).toEqual([run.intents[0].intent]);
    expect(searched.searches).toEqual([expect.objectContaining({ itemId: "cola", missionId: mission.id, candidateCount: 1 })]);
    const authorized = await service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "cola", missionId: mission.id, productId: "coke-12" }] });
    expect(authorized).toMatchObject({ status: "AUTO_AUTHORIZED", purchaseExecuted: false, decision: { decision: "AUTO_AUTHORIZED", proposedTotalMinor: 1049, remainingBudgetBeforeMinor: 7000, remainingBudgetAfterMinor: 5951 } });
    expect(authorized.selections[0]).toMatchObject({ productName: "Coca-Cola 12 x 355 mL", unitPrice: { amountMinor: 1049, currency: "CAD" }, lineTotalMinor: 1049 });
    expect(authorized.budget).toMatchObject({ heldMinor: 1049, spentMinor: 0, remainingMinor: 5951 });
    expect(authorized.events.at(-1)?.message).toBe("Auto-authorized by the standing mandate. No purchase was placed; checkout remains a separate, explicit step.");
  });

  it("never accepts a client-supplied price and rejects selections from another search", async () => {
    const { service } = setup();
    const policy = await activePolicy(service);
    const run = await service.evaluate(OWNER, policy.id);
    const { mission } = await service.search(OWNER, policy.id, { runId: run.id, itemId: "cola" }, signal());
    await rejects(service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "cola", missionId: mission.id, productId: "coke-12", priceMinor: 1 }] }), "INVALID_REQUEST", 400);
    // The Coke search result offered as the Sprite item: bound to the wrong intent.
    await rejects(service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "lemon-lime", missionId: mission.id, productId: "coke-12" }] }), "AUTOPILOT_SELECTION_MISMATCH", 409);
    await rejects(service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "cola", missionId: "00000000-0000-4000-8000-999999999999", productId: "coke-12" }] }), "SELECTION_EXPIRED", 409);
    await rejects(service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "ghost", missionId: mission.id, productId: "coke-12" }] }), "AUTOPILOT_SELECTION_INVALID", 400);
    await rejects(service.authorize(OTHER_OWNER, policy.id, { runId: run.id, selections: [{ itemId: "cola", missionId: mission.id, productId: "coke-12" }] }), "AUTOPILOT_POLICY_NOT_FOUND", 404);
  });

  it("holds authority per run: re-authorizing replaces the hold, a later run sees less authority", async () => {
    const { service, commerce } = setup();
    commerce.catalog = [drink("coke-case", "Coca-Cola 24 pack", 4000)];
    const policy = await activePolicy(service);
    const first = await service.evaluate(OWNER, policy.id);
    const { mission } = await service.search(OWNER, policy.id, { runId: first.id, itemId: "cola" }, signal());
    const select = { runId: first.id, selections: [{ itemId: "cola", missionId: mission.id, productId: "coke-case" }] };
    expect((await service.authorize(OWNER, policy.id, select)).status).toBe("AUTO_AUTHORIZED");
    expect((await service.authorize(OWNER, policy.id, select)).budget.heldMinor).toBe(4000); // not 8000
    const second = await service.evaluate(OWNER, policy.id);
    const again = await service.search(OWNER, policy.id, { runId: second.id, itemId: "cola" }, signal());
    const decided = await service.authorize(OWNER, policy.id, { runId: second.id, selections: [{ itemId: "cola", missionId: again.mission.id, productId: "coke-case" }] });
    expect(decided.decision).toMatchObject({ decision: "NEEDS_APPROVAL", reasons: ["C$40.00 exceeds the remaining C$30.00 weekly authority."] });
    expect(decided.budget.heldMinor).toBe(4000);
  });

  it("concurrent authorizations cannot jointly exceed the weekly mandate", async () => {
    const { service, commerce } = setup();
    commerce.catalog = [drink("coke-case", "Coca-Cola 24 pack", 5000)];
    const policy = await activePolicy(service);
    const runs = [await service.evaluate(OWNER, policy.id), await service.evaluate(OWNER, policy.id)];
    const missions: RequestMission[] = [];
    for (const run of runs) missions.push((await service.search(OWNER, policy.id, { runId: run.id, itemId: "cola" }, signal())).mission);
    const results = await Promise.all(runs.map((run, index) => service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "cola", missionId: missions[index].id, productId: "coke-case" }] })));
    expect(results.map(run => run.status).sort()).toEqual(["AUTO_AUTHORIZED", "NEEDS_APPROVAL"]);
    expect((await service.get(OWNER, policy.id)).budget.heldMinor).toBe(5000);
  });

  it("a run goes stale when its policy changes, so old results can't be authorized under a new mandate", async () => {
    const { service } = setup();
    const policy = await activePolicy(service);
    const run = await service.evaluate(OWNER, policy.id);
    const { mission } = await service.search(OWNER, policy.id, { runId: run.id, itemId: "cola" }, signal());
    await service.update(OWNER, policy.id, { name: "Renamed" });
    await rejects(service.authorize(OWNER, policy.id, { runId: run.id, selections: [{ itemId: "cola", missionId: mission.id, productId: "coke-12" }] }), "AUTOPILOT_RUN_STALE", 409);
  });
});

describe("Scheduled runs and the café DEMO fixture", () => {
  it("#19 one scheduled slot produces exactly one run, even under concurrent run-due calls", async () => {
    const { service, clock } = setup();
    const demo = (await service.seedDemo(OWNER, "America/Toronto")).policy;
    expect(demo).toMatchObject({ status: "ACTIVE", demo: true, fixtureId: "cafe-drinks-restock" });
    expect((await service.get(OWNER, demo.id)).due).toBe(true);
    const [first, second] = await Promise.all([service.runDue(OWNER), service.runDue(OWNER)]);
    const runIds = new Set([...first, ...second].map(run => run.id));
    expect(runIds.size).toBe(1);
    expect((await service.runs(OWNER, demo.id)).filter(run => run.trigger === "SCHEDULE")).toHaveLength(1);
    const [run] = [...first, ...second];
    expect(run).toMatchObject({ trigger: "SCHEDULE", scheduledFor: MONDAY_9AM_TORONTO, triggerReason: "The weekly schedule is due." });
    expect((await service.get(OWNER, demo.id)).policy.schedule.nextRunAt).toBe("2026-09-28T13:00:00.000Z");
    expect(await service.runDue(OWNER)).toEqual([]);
    clock.set("2026-09-28T13:00:00Z");
    expect(await service.runDue(OWNER)).toHaveLength(1);
  });

  it("#16 the DEMO fixture is dev/test only, clearly marked, and its runs carry demo: true", async () => {
    const { service } = setup();
    const view = await service.seedDemo(OWNER, "UTC");
    expect(view.policy.name).toBe("Café Drinks Restock (DEMO)");
    expect(view.budget).toMatchObject({ weeklyAuthorityMinor: 7000, committedMinor: 0 });
    expect((await service.seedDemo(OWNER, "UTC")).policy.id).toBe(view.policy.id); // idempotent, no duplicates
    const run = await service.evaluate(OWNER, view.policy.id);
    expect(run).toMatchObject({ demo: true, purchaseExecuted: false });
    vi.stubEnv("NODE_ENV", "production");
    await rejects(setup().service.seedDemo(OWNER, "UTC"), "AUTOPILOT_DEMO_DISABLED", 503);
  });

  it("#16/#20 a full demo flow touches only search + read-back: no checkout, quote or dispatch capability exists", async () => {
    const claim = vi.spyOn(DispatchJournal.prototype, "claim");
    const record = vi.spyOn(DispatchJournal.prototype, "record");
    const dispatch = vi.spyOn(AgnicCheckoutProvider.prototype, "dispatchSandbox");
    const placeOrder = vi.spyOn(AgnicCheckoutProvider.prototype, "placeOrder");
    const preview = vi.spyOn(AgnicCheckoutProvider.prototype, "previewOrder");
    const network = vi.fn(() => { throw new Error("network is not allowed in tests"); });
    vi.stubGlobal("fetch", network);
    const clock = new MutableClock(MONDAY_9AM_TORONTO);
    const fake = new FakeCommerce(true, undefined, () => new ProviderError("SELECTION_EXPIRED", "expired", 409));
    const touched = new Set<PropertyKey>();
    // Any capability beyond the three declared methods would be caught here.
    const commerce = new Proxy(fake, { get(target, key, receiver) { touched.add(key); return Reflect.get(target, key, receiver); } }) as unknown as AutopilotCommerce;
    const service = new AutopilotService(new InMemoryAutopilotStore(clock.now), commerce, clock.now);
    const demo = (await service.seedDemo(OWNER, "America/Toronto")).policy;
    const [run] = await service.runDue(OWNER);
    const { mission } = await service.search(OWNER, demo.id, { runId: run.id, itemId: "cola" }, signal());
    const authorized = await service.authorize(OWNER, demo.id, { runId: run.id, selections: [{ itemId: "cola", missionId: mission.id, productId: "coke-12" }] });
    expect(authorized).toMatchObject({ status: "AUTO_AUTHORIZED", demo: true, purchaseExecuted: false });
    expect([...touched].filter(key => typeof key === "string").sort()).toEqual(["getSelection", "isAvailable", "search"]);
    for (const spy of [claim, record, dispatch, placeOrder, preview, network]) expect(spy).not.toHaveBeenCalled();
  });
});
