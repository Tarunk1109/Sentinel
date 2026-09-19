import "server-only";
import { assertLocalRequest, readJson } from "@/lib/server/http";
import { ProviderError } from "@/lib/server/provider-error";

const POLICY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function policyIdFrom(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!POLICY_ID.test(id)) throw new ProviderError("INVALID_REQUEST", "That autopilot id is not valid.", 400);
  return id;
}

/**
 * For POST actions whose body is optional. A declared body must be JSON; an undeclared one
 * must be empty. Next.js hands route handlers an empty stream (not null) for bodiless
 * requests, so emptiness is checked by reading - stopping at the first byte.
 */
export async function readOptionalJson(request: Request, maxBytes = 8192): Promise<unknown> {
  assertLocalRequest(request);
  if (request.headers.get("content-type") !== null) return readJson(request, maxBytes);
  if (!request.body) return {};
  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return {};
      if (value.byteLength > 0) {
        await reader.cancel();
        throw new ProviderError("UNSUPPORTED_MEDIA_TYPE", "Send your request as JSON.", 415);
      }
    }
  } finally { reader.releaseLock(); }
}
