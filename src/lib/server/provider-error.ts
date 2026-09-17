import "server-only";
import type { PublicError } from "@/lib/domain/commerce";

export class ProviderError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) { super(message); this.name = "ProviderError"; }
}
export function publicError(error: unknown): PublicError {
  // Provider bodies and exception messages may contain keys or personal profile data.
  if (error instanceof ProviderError) return { code: error.code, message: error.message };
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return { code: "TIMEOUT", message: "The request timed out or was cancelled. No order was placed." };
  return { code: "REQUEST_FAILED", message: "The request could not be completed. No order was placed. Please try again." };
}
