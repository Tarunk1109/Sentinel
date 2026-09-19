import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ commerce: null as unknown }));
vi.mock("@/lib/autopilot/runtime", async () => {
  const { AutopilotService } = await import("@/lib/autopilot/service");
  const { InMemoryAutopilotStore } = await import("@/lib/autopilot/store");
  const { FakeCommerce } = await import("./autopilot-helpers");
  const { ProviderError } = await import("@/lib/server/provider-error");
  const commerce = new FakeCommerce(true, undefined, () => new ProviderError("SELECTION_EXPIRED", "This selection expired. Find the product again to continue.", 409));
  state.commerce = commerce;
  return { autopilotService: new AutopilotService(new InMemoryAutopilotStore(), commerce) };
});
import { GET as listPolicies, POST as createPolicy } from "@/app/api/autopilot/policies/route";
import { GET as readPolicy, PATCH as patchPolicy } from "@/app/api/autopilot/policies/[id]/route";
import { POST as activate } from "@/app/api/autopilot/policies/[id]/activate/route";
import { POST as pause } from "@/app/api/autopilot/policies/[id]/pause/route";
import { POST as resume } from "@/app/api/autopilot/policies/[id]/resume/route";
import { POST as evaluate } from "@/app/api/autopilot/policies/[id]/evaluate/route";
import { POST as search } from "@/app/api/autopilot/policies/[id]/search/route";
import { POST as authorize } from "@/app/api/autopilot/policies/[id]/authorize/route";
import { GET as listRuns } from "@/app/api/autopilot/policies/[id]/runs/route";
import { POST as runDue } from "@/app/api/autopilot/run-due/route";
import { POST as seedDemo } from "@/app/api/autopilot/demo/route";
import { autopilotService } from "@/lib/autopilot/runtime";
import type { FakeCommerce } from "./autopilot-helpers";
import { policyInput } from "./autopilot-helpers";

let sessionCounter = 0;
function newSession(): string { sessionCounter++; return `aaaaaaaa-0000-4000-8000-${String(sessionCounter).padStart(12, "0")}`; }
function request(path: string, init: { method?: string; body?: unknown; raw?: string; session?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...(init.session ? { Cookie: `sentinel_session=${init.session}` } : {}), ...init.headers };
  const hasBody = init.body !== undefined || init.raw !== undefined;
  if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost${path}`, { method: init.method ?? (hasBody ? "POST" : "GET"), headers, body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function json(response: Response) { return { status: response.status, body: await response.json() }; }
async function createActive(session: string) {
  const created = await json(await createPolicy(request("/api/autopilot/policies", { body: policyInput(), session })));
  const id = created.body.autopilot.policy.id as string;
  await activate(request(`/api/autopilot/policies/${id}/activate`, { body: { confirm: true }, session }), params(id));
  return id;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Autopilot policy routes", () => {
  it("creates a DRAFT, lists it, and reads it back for the same session only", async () => {
    const session = newSession();
    const created = await json(await createPolicy(request("/api/autopilot/policies", { body: policyInput(), session })));
    expect(created.status).toBe(201);
    expect(created.body.autopilot.policy).toMatchObject({ status: "DRAFT", currency: "CAD", demo: false });
    const id = created.body.autopilot.policy.id;
    const listed = await json(await listPolicies(request("/api/autopilot/policies", { session })));
    expect(listed.body.autopilots.map((view: { policy: { id: string } }) => view.policy.id)).toEqual([id]);
    expect((await json(await readPolicy(request(`/api/autopilot/policies/${id}`, { session }), params(id)))).body.autopilot.budget.remainingMinor).toBe(7000);
    expect((await readPolicy(request(`/api/autopilot/policies/${id}`, { session: newSession() }), params(id))).status).toBe(404);
  });

  it("sets no-store and a session cookie for a new visitor", async () => {
    const response = await listPolicies(request("/api/autopilot/policies"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toMatch(/^sentinel_session=[0-9a-f-]{36}; HttpOnly; SameSite=Strict/);
  });

  it("updates safe fields and rejects status changes through PATCH", async () => {
    const session = newSession();
    const id = await createActive(session);
    const renamed = await json(await patchPolicy(request(`/api/autopilot/policies/${id}`, { method: "PATCH", body: { name: "Counter drinks" }, session }), params(id)));
    expect(renamed.body.autopilot.policy.name).toBe("Counter drinks");
    expect((await json(await patchPolicy(request(`/api/autopilot/policies/${id}`, { method: "PATCH", body: { budget: { maximumPerWeekMinor: 9000 } }, session }), params(id)))).body.error.code).toBe("AUTOPILOT_POLICY_ACTIVE");
    expect((await patchPolicy(request(`/api/autopilot/policies/${id}`, { method: "PATCH", body: { status: "PAUSED" }, session }), params(id))).status).toBe(400);
  });

  it("activation and resume require explicit confirmation; pause does not", async () => {
    const session = newSession();
    const created = await json(await createPolicy(request("/api/autopilot/policies", { body: policyInput(), session })));
    const id = created.body.autopilot.policy.id;
    const unconfirmed = await json(await activate(request(`/api/autopilot/policies/${id}/activate`, { body: {}, session }), params(id)));
    expect(unconfirmed).toMatchObject({ status: 400, body: { error: { code: "AUTOPILOT_CONFIRMATION_REQUIRED" } } });
    expect((await activate(request(`/api/autopilot/policies/${id}/activate`, { body: { confirm: "yes" }, session }), params(id))).status).toBe(400);
    expect((await json(await activate(request(`/api/autopilot/policies/${id}/activate`, { body: { confirm: true }, session }), params(id)))).body.autopilot.policy.status).toBe("ACTIVE");
    const paused = await json(await pause(request(`/api/autopilot/policies/${id}/pause`, { method: "POST", session }), params(id)));
    expect(paused.body.autopilot.policy.status).toBe("PAUSED");
    expect((await resume(request(`/api/autopilot/policies/${id}/resume`, { body: { confirm: false }, session }), params(id))).status).toBe(400);
    expect((await json(await resume(request(`/api/autopilot/policies/${id}/resume`, { body: { confirm: true }, session }), params(id)))).body.autopilot.policy.status).toBe("ACTIVE");
  });

  it("evaluate -> search -> authorize returns an auditable run and never a purchase", async () => {
    const session = newSession();
    const id = await createActive(session);
    const evaluated = await json(await evaluate(request(`/api/autopilot/policies/${id}/evaluate`, { method: "POST", session }), params(id)));
    expect(evaluated.body.run).toMatchObject({ status: "SEARCH_READY", purchaseExecuted: false });
    const runId = evaluated.body.run.id;
    const searched = await json(await search(request(`/api/autopilot/policies/${id}/search`, { body: { runId, itemId: "cola" }, session }), params(id)));
    expect(searched.status).toBe(200);
    expect(searched.body.mission.products[0].id).toBe("coke-12");
    const decided = await json(await authorize(request(`/api/autopilot/policies/${id}/authorize`, { body: { runId, selections: [{ itemId: "cola", missionId: searched.body.mission.id, productId: "coke-12" }] }, session }), params(id)));
    expect(decided.body.run).toMatchObject({ status: "AUTO_AUTHORIZED", purchaseExecuted: false, decision: { proposedTotalMinor: 1049 } });
    const runs = await json(await listRuns(request(`/api/autopilot/policies/${id}/runs`, { session }), params(id)));
    expect(runs.body.runs[0].id).toBe(runId);
    expect((state.commerce as FakeCommerce).searches.length).toBeGreaterThan(0);
  });

  it("run-due evaluates due policies once, and the demo is dev/test only", async () => {
    const session = newSession();
    const demo = await json(await seedDemo(request("/api/autopilot/demo", { body: { timezone: "America/Toronto" }, session })));
    expect(demo.body.autopilot).toMatchObject({ due: true, policy: { demo: true, fixtureId: "cafe-drinks-restock", status: "ACTIVE" } });
    const first = await json(await runDue(request("/api/autopilot/run-due", { method: "POST", session })));
    expect(first.body.runs).toHaveLength(1);
    expect(first.body.runs[0]).toMatchObject({ demo: true, trigger: "SCHEDULE" });
    expect((await json(await runDue(request("/api/autopilot/run-due", { method: "POST", session })))).body.runs).toEqual([]);
    vi.stubEnv("NODE_ENV", "production");
    expect((await json(await seedDemo(request("/api/autopilot/demo", { method: "POST", session: newSession() })))).body.error.code).toBe("AUTOPILOT_DEMO_DISABLED");
  });

  it("rejects invalid ids, malformed bodies, oversized input, bad budgets and unsupported currencies", async () => {
    const session = newSession();
    expect((await readPolicy(request("/api/autopilot/policies/not-a-uuid", { session }), params("not-a-uuid"))).status).toBe(400);
    const unknownId = "99999999-9999-4999-8999-999999999999";
    expect((await json(await readPolicy(request(`/api/autopilot/policies/${unknownId}`, { session }), params(unknownId)))).body.error.code).toBe("AUTOPILOT_POLICY_NOT_FOUND");
    expect((await json(await createPolicy(request("/api/autopilot/policies", { raw: "{not json", session })))).body.error.code).toBe("INVALID_JSON");
    expect((await createPolicy(request("/api/autopilot/policies", { raw: JSON.stringify(policyInput()), headers: { "Content-Type": "text/plain" }, session }))).status).toBe(415);
    expect((await createPolicy(request("/api/autopilot/policies", { body: policyInput(), headers: { "Content-Length": String(1_000_000) }, session }))).status).toBe(413);
    const zero = await json(await createPolicy(request("/api/autopilot/policies", { body: policyInput({ budget: { maximumPerWeekMinor: 0 } }), session })));
    expect(zero).toMatchObject({ status: 400, body: { error: { code: "INVALID_REQUEST", message: "Weekly maximum must be greater than zero." } } });
    const usd = await json(await createPolicy(request("/api/autopilot/policies", { body: { ...policyInput(), currency: "USD" }, session })));
    expect(usd.body.error.message).toBe("Autopilot supports CAD only in this phase.");
    const id = await createActive(session);
    expect((await evaluate(request(`/api/autopilot/policies/${id}/evaluate`, { body: { inventory: "lots" }, session }), params(id))).status).toBe(400);
    expect((await pause(request(`/api/autopilot/policies/${id}/pause`, { body: { force: true }, session }), params(id))).status).toBe(400);
  });

  it("rejects cross-site calls on every autopilot route", async () => {
    const crossSite = { Origin: "https://attacker.example" };
    const id = "99999999-9999-4999-8999-999999999999";
    expect((await listPolicies(request("/api/autopilot/policies", { headers: crossSite }))).status).toBe(403);
    expect((await createPolicy(request("/api/autopilot/policies", { body: policyInput(), headers: crossSite }))).status).toBe(403);
    expect((await pause(request(`/api/autopilot/policies/${id}/pause`, { method: "POST", headers: crossSite }), params(id))).status).toBe(403);
    expect((await runDue(request("/api/autopilot/run-due", { method: "POST", headers: crossSite }))).status).toBe(403);
    expect((await seedDemo(request("/api/autopilot/demo", { method: "POST", headers: crossSite }))).status).toBe(403);
  });

  it("never leaks internal error details or stack traces", async () => {
    vi.spyOn(autopilotService, "list").mockRejectedValue(new Error("secret-internal-path /Users/x/.env at Object.<anonymous>"));
    const response = await listPolicies(request("/api/autopilot/policies"));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: { code: "REQUEST_FAILED", message: "The request could not be completed. No order was placed. Please try again." } });
    expect(text).not.toContain("secret-internal");
  });
});
