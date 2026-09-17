import "server-only";
import type { RuntimeStatus } from "@/lib/domain/commerce";

export function getAgnicToken(): string | undefined {
  // Reuse existing names; do not create or log copies of credentials.
  const token = process.env.AGNIC_API_KEY?.trim() || process.env.AGNIC_TOKEN?.trim();
  return token?.startsWith("agnic_tok_") ? token : undefined;
}
export function getRuntimeStatus(): RuntimeStatus {
  return {
    aiCredential: process.env.OPENAI_API_KEY?.trim() ? "detected" : "missing",
    agnicCredential: getAgnicToken() ? "detected" : "missing",
    aiEnabled: process.env.SENTINEL_ALLOW_PAID_AI === "true",
    model: "gpt-6-astra",
    realPurchasesEnabled: false,
    developmentMode: true,
    aiProvider: 'openai',
  };
}
