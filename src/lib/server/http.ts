import "server-only";
import { randomUUID } from "node:crypto";
import { ProviderError, publicError } from "./provider-error";

export function assertLocalRequest(request: Request): void {
  // Next's standalone request URL can use localhost even when the browser used
  // 127.0.0.1. Compare Origin to the actual HTTP Host, never a forwarded header.
  const requestUrl = new URL(request.url);
  const authority = new URL(`${requestUrl.protocol}//${request.headers.get('host') ?? requestUrl.host}`);
  const origin = request.headers.get('origin');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname) || authority.username || authority.password || (origin && origin !== authority.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ProviderError('ORIGIN_REJECTED', 'Cross-site requests are not accepted.', 403);
}
export async function readJson(request: Request): Promise<unknown> {
  assertLocalRequest(request);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ProviderError('UNSUPPORTED_MEDIA_TYPE', 'Send your request as JSON.', 415);
  if (Number(request.headers.get('content-length')) > 8192) throw new ProviderError('BODY_TOO_LARGE', 'The request is too large.', 413);
  if (!request.body) throw new ProviderError('INVALID_JSON', 'The request body must contain valid JSON.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new ProviderError('BODY_TOO_LARGE', 'The request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ProviderError('INVALID_JSON', 'The request body must contain valid JSON.', 400); }
}
export function session(request: Request): { owner: string; headers: Record<string, string> } {
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)sentinel_session=([0-9a-f-]{36})(?:;|$)/)?.[1];
  const owner = cookie && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cookie) ? cookie : randomUUID();
  return { owner, headers: { 'Cache-Control': 'no-store', ...(cookie === owner ? {} : { 'Set-Cookie': `sentinel_session=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` }) } };
}
export function errorResponse(error: unknown): Response {
  return Response.json({ error: publicError(error) }, { status: error instanceof ProviderError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
