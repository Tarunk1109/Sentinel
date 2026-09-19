import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/autopilot/runtime", async () => {
  const { AutopilotService } = await import("@/lib/autopilot/service");
  const { InMemoryAutopilotStore } = await import("@/lib/autopilot/store");
  const { FakeCommerce } = await import("./autopilot-helpers");
  return { autopilotService: new AutopilotService(new InMemoryAutopilotStore(), new FakeCommerce()) };
});
import { POST as interpret } from "@/app/api/voice/interpret/route";
import { autopilotService } from "@/lib/autopilot/runtime";
import { policyInput } from "./autopilot-helpers";

const SESSION = "bbbbbbbb-0000-4000-8000-000000000001";
function request(body: unknown, headers: Record<string, string> = {}, raw?: string): Request {
  return new Request("http://localhost/api/voice/interpret", { method: "POST", headers: { "Content-Type": "application/json", Cookie: `sentinel_session=${SESSION}`, ...headers }, body: raw ?? JSON.stringify(body) });
}
async function json(response: Response) { return { status: response.status, body: await response.json() }; }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("POST /api/voice/interpret", () => {
  it("returns an AUTOPILOT_CREATE draft for the café sentence without creating or activating anything", async () => {
    const before = await autopilotService.list(SESSION);
    const create = vi.spyOn(autopilotService, "create");
    const activate = vi.spyOn(autopilotService, "activate");
    const result = await json(await interpret(request({ transcript: "Keep Coke, Sprite and Fanta stocked every week and spend at most 70 Canadian dollars.", timezone: "america/toronto" })));
    expect(result.status).toBe(200);
    expect(result.body.command).toMatchObject({ type: "AUTOPILOT_CREATE", requiresConfirmation: true, draft: { status: "DRAFT", currency: "CAD", budget: { maximumPerWeekMinor: 7000 }, schedule: { cadence: "WEEKLY", timezone: "America/Toronto" } } });
    expect(create).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(await autopilotService.list(SESSION)).toEqual(before);
  });

  it("resolves control commands against this session's own autopilots only", async () => {
    const { policy } = await autopilotService.create(SESSION, policyInput({ name: "Office Snacks" , allowedCategories: ["SNACKS"], items: [{ id: "chips", label: "Chips", category: "SNACKS", searchQuery: "chips", productType: "chips" }] }));
    const own = await json(await interpret(request({ transcript: "Pause my office snacks autopilot" })));
    expect(own.body.command).toEqual({ type: "AUTOPILOT_PAUSE", requiresConfirmation: false, policy: { id: policy.id, name: "Office Snacks", status: "DRAFT" } });
    const stranger = await json(await interpret(request({ transcript: "Pause my office snacks autopilot" }, { Cookie: "sentinel_session=cccccccc-0000-4000-8000-000000000001" })));
    expect(stranger.body.command.type).toBe("NEEDS_CLARIFICATION");
    expect(JSON.stringify(stranger.body)).not.toContain(policy.id);
  });

  it("#19 rejects an empty transcript", async () => {
    for (const transcript of ["", "    "]) {
      expect(await json(await interpret(request({ transcript })))).toMatchObject({ status: 400, body: { error: { code: "INVALID_REQUEST", message: "The transcript is empty. Say or type something first." } } });
    }
    expect((await interpret(request({}))).status).toBe(400);
    expect((await interpret(request({ transcript: 42 }))).status).toBe(400);
  });

  it("#20 rejects a giant transcript and oversized bodies", async () => {
    expect(await json(await interpret(request({ transcript: "a".repeat(1001) })))).toMatchObject({ status: 400, body: { error: { message: "Keep voice commands to 1000 characters or fewer." } } });
    expect((await interpret(request({ transcript: "x".repeat(20_000) }))).status).toBe(413);
  });

  it("rejects malformed JSON, audio uploads, unknown fields, bad timezones and cross-site calls", async () => {
    expect((await json(await interpret(request(null, {}, "{\"transcript\":")))).body.error.code).toBe("INVALID_JSON");
    expect((await interpret(request(null, { "Content-Type": "audio/webm" }, "RIFF....WAVEfmt"))).status).toBe(415);
    expect((await interpret(request({ transcript: "Find me a hub", audioBase64: "AAAA" }))).status).toBe(400);
    expect((await interpret(request({ transcript: "Find me a hub", timezone: "Nowhere/Land" }))).status).toBe(400);
    expect((await interpret(request({ transcript: "Find me a hub" }, { Origin: "https://attacker.example" }))).status).toBe(403);
  });

  it("forwards shopping requests as REQUEST text and refuses purchase confirmations", async () => {
    expect((await json(await interpret(request({ transcript: "Find me a USB-C charger under fifty dollars." })))).body.command).toEqual({ type: "REQUEST", text: "Find me a USB-C charger under fifty dollars." });
    expect((await json(await interpret(request({ transcript: "Buy it now" })))).body.command.type).toBe("UNKNOWN");
  });

  it("#24 makes zero model or network calls", async () => {
    const network = vi.fn(() => { throw new Error("no network in tests"); });
    vi.stubGlobal("fetch", network);
    await interpret(request({ transcript: "Keep Coke stocked every week under 70 dollars" }));
    await interpret(request({ transcript: "Find me a laptop stand" }));
    expect(network).not.toHaveBeenCalled();
  });
});
