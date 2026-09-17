import "server-only";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProviderError } from "./provider-error";

export const AI_LIMIT_CAD = 5;
export const AI_RATES = { "gpt-5.6-luna": { input: 0.2, output: 1.2 }, "gpt-6-astra": { input: 10, output: 50 } } as const;
export type ReasoningModel = keyof typeof AI_RATES;
// Conservative accounting factor, not an exchange-rate quote. Includes headroom.
export function costCad(model: ReasoningModel, input: number, output: number): number {
  return (input * AI_RATES[model].input + output * AI_RATES[model].output) / 1_000_000 * 2;
}
const ledgerSchema = z.object({ spentCad: z.number().nonnegative(), reservations: z.record(z.string(), z.number().nonnegative()) });
export class AiBudget {
  constructor(private readonly directory = join(process.cwd(), ".sentinel")) {}
  private async update<T>(action: (ledger: z.infer<typeof ledgerSchema>) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = join(this.directory, "ai-usage.lock");
    const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new ProviderError("AI_BUDGET_BUSY", "The AI budget ledger is busy or needs review. No new model call was started.", 409); });
    try {
      const path = join(this.directory, "ai-usage.json");
      let ledger: z.infer<typeof ledgerSchema>;
      try { ledger = ledgerSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") ledger = { spentCad: 0, reservations: {} };
        else throw new ProviderError("AI_BUDGET_UNAVAILABLE", "The local AI budget ledger needs review. Paid calls are disabled until it is repaired.", 503);
      }
      const result = action(ledger);
      const temp = join(this.directory, `usage-${randomUUID()}.tmp`);
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(ledger)); await file.sync(); } finally { await file.close(); }
      await rename(temp, path);
      return result;
    } finally { await lock.close(); await unlink(lockPath); }
  }
  async reserve(model: ReasoningModel, maxInputTokens: number, maxOutputTokens: number): Promise<string> {
    const amount = costCad(model, maxInputTokens, maxOutputTokens);
    return this.update(ledger => {
      const total = ledger.spentCad + Object.values(ledger.reservations).reduce((a, b) => a + b, 0);
      if (amount > 0.75 || total + amount > AI_LIMIT_CAD) throw new ProviderError("AI_BUDGET_LIMIT", "SENTINEL’s C$5 AI budget cap has been reached, or this call would exceed its C$0.75 limit. No model call was started.", 402);
      const id = randomUUID(); ledger.reservations[id] = amount; return id;
    });
  }
  async settle(id: string, model: ReasoningModel, input: number, output: number): Promise<void> {
    await this.update(ledger => {
      if (!(id in ledger.reservations)) throw new ProviderError("AI_BUDGET_UNAVAILABLE", "The AI usage reservation could not be reconciled.", 503);
      ledger.spentCad += costCad(model, input, output); delete ledger.reservations[id];
    });
  }
  // Unknown outcomes retain their entire reservation. Never retry a billed request.
  async status(): Promise<{ spentCad: number; limitCad: number }> {
    return this.update(ledger => ({ spentCad: ledger.spentCad + Object.values(ledger.reservations).reduce((a, b) => a + b, 0), limitCad: AI_LIMIT_CAD }));
  }
}
export const aiBudget = new AiBudget();
export const getBudgetStatus = () => aiBudget.status();
