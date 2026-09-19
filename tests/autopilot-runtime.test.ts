import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const credentials = vi.hoisted(() => ({ agnic: undefined as string | undefined }));
vi.mock("@/lib/server/config", () => ({ getAgnicToken: () => credentials.agnic }));
vi.mock("@/lib/server/services/runtime", () => ({ missionService: { runFromIntent: vi.fn(), getSelection: vi.fn() } }));
import { readOptionalJson } from "@/lib/autopilot/http";
import { OWNER, policyInput } from "./autopilot-helpers";

function emptyStream(): ReadableStream<Uint8Array> { return new ReadableStream({ start(controller) { controller.close(); } }); }
function post(body?: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/autopilot/run-due", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

beforeEach(() => {
  delete (globalThis as { __sentinelAutopilotStore?: unknown }).__sentinelAutopilotStore;
  credentials.agnic = undefined;
  vi.resetModules();
});

describe("Optional JSON bodies (as Next.js actually delivers them)", () => {
  it("treats an empty stream with no content type as an empty body", async () => {
    expect(await readOptionalJson(post(emptyStream()))).toEqual({});
    expect(await readOptionalJson(post())).toEqual({});
  });
  it("rejects undeclared non-empty bodies and still parses declared JSON", async () => {
    await expect(readOptionalJson(post("inventory=all"))).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
    expect(await readOptionalJson(post(JSON.stringify({ inventory: [] }), { "Content-Type": "application/json" }))).toEqual({ inventory: [] });
    await expect(readOptionalJson(post(emptyStream(), { Origin: "https://attacker.example" }))).rejects.toMatchObject({ status: 403 });
  });
});

describe("Autopilot runtime wiring", () => {
  it("survives server-module re-evaluation (what `next dev` does when it compiles a new route)", async () => {
    const first = await import("@/lib/autopilot/runtime");
    const { policy } = await first.autopilotService.create(OWNER, policyInput());
    vi.resetModules();
    const second = await import("@/lib/autopilot/runtime");
    expect(second.autopilotService).not.toBe(first.autopilotService);
    expect((await second.autopilotService.get(OWNER, policy.id)).policy.id).toBe(policy.id);
  });

  it("reports commerce as available only when an Agnic credential is configured", async () => {
    const { autopilotService } = await import("@/lib/autopilot/runtime");
    const { policy } = await autopilotService.create(OWNER, policyInput());
    await autopilotService.activate(OWNER, policy.id);
    expect((await autopilotService.evaluate(OWNER, policy.id)).status).toBe("COMMERCE_UNAVAILABLE");
    credentials.agnic = "agnic_tok_test";
    expect((await autopilotService.evaluate(OWNER, policy.id)).status).toBe("SEARCH_READY");
  });
});
