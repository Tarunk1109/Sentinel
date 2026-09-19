import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Structural guarantees that hold regardless of runtime behaviour. */
function files(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const featureFiles = [...files("src/lib/autopilot"), ...files("src/lib/voice"), ...files("src/app/api/autopilot"), ...files("src/app/api/voice")];
const serverFiles = [...files("src/app/api"), ...files("src/lib/server"), ...files("src/lib/autopilot"), ...files("src/lib/voice").filter(path => !path.endsWith("browser-speech.ts"))];

describe("Autopilot and Voice boundaries", () => {
  it("covers every new feature file", () => {
    expect(featureFiles.length).toBeGreaterThanOrEqual(30);
  });

  it("#16/#20 no Autopilot or Voice module can reach checkout, quoting, dispatch or the purchase lock", () => {
    const forbidden = /services\/checkout|dispatch-journal|DispatchJournal|agnic-checkout|AgnicCheckoutProvider|checkout-route|dispatchSandbox|placeOrder|previewOrder|assertRealPurchasesEnabled|REAL_PURCHASE_EXECUTION|SENTINEL_REAL_PURCHASES_ENABLED|sandbox\//;
    for (const path of featureFiles) expect(code(path), path).not.toMatch(forbidden);
  });

  it("no feature module writes environment variables, and the voice interpreter never reads them", () => {
    for (const path of featureFiles) expect(code(path), path).not.toMatch(/process\.env(?:\.[A-Z_]+|\[[^\]]+\])\s*=(?!=)/);
    for (const path of files("src/lib/voice")) expect(code(path), path).not.toContain("process.env");
  });

  it("the browser speech adapter is never imported by server code", () => {
    for (const path of serverFiles) expect(code(path), path).not.toMatch(/browser-speech/);
  });

  it("server modules are marked server-only; pure domain modules stay framework-free", () => {
    for (const path of [...files("src/app/api/autopilot"), ...files("src/app/api/voice"), "src/lib/autopilot/store.ts", "src/lib/autopilot/service.ts", "src/lib/autopilot/runtime.ts", "src/lib/autopilot/demo.ts", "src/lib/autopilot/http.ts"]) {
      expect(code(path), path).toMatch(/^import "server-only";/);
    }
    for (const path of ["money", "time", "policy", "schedule", "ledger", "intent", "trigger", "decision", "run", "requests"].map(name => `src/lib/autopilot/${name}.ts`)) {
      expect(code(path), path).not.toMatch(/server-only|next\/|react|@\/lib\/server/);
    }
  });

  it("no model client is used by Autopilot or Voice", () => {
    for (const path of featureFiles) expect(code(path), path).not.toMatch(/adapters\/openai|OpenAIReasoner|createReasoner|ai-provider|api\.openai\.com|anthropic/i);
  });
});
