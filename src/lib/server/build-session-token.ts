import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSessionPayloadSchema, type BuildSessionPayload } from "@/lib/domain/build";
import { ProviderError } from "./provider-error";

/**
 * Makes the Build analyze -> search flow stateless across separate API route
 * invocations, dev-server module reloads, and (in a real deployment) separate worker
 * processes: `analyze()` signs the validated analysis/constraints into an opaque token;
 * `search()` verifies it instead of reading any shared in-memory session store. See
 * An in-memory `Map` could not be trusted for this.
 *
 * The signing secret itself must be identical across those same boundaries, or
 * verification would fail for the same reason the old session store did. `SENTINEL_
 * BUILD_SESSION_SECRET` is the explicit answer for a real multi-instance deployment (set
 * once, shared config). Without it, a secret is generated once and persisted to disk
 * (same `.sentinel/` directory and atomic-create pattern as the existing AI budget
 * ledger - see `ai-budget.ts`) so it survives dev-server restarts and Fast Refresh module
 * reinitialization, and stays consistent across multiple processes sharing that
 * filesystem. The directory is constructor-injectable for the same reason `AiBudget`'s
 * is: tests get an isolated temp directory instead of the project's real `.sentinel/`.
 */

const TTL_MS = 15 * 60_000;

function isFsError(error: unknown, code: string): boolean {
  return Boolean(error) && typeof error === "object" && "code" in (error as object) && (error as { code?: unknown }).code === code;
}

function invalid(): never {
  throw new ProviderError("BUILD_SESSION_INVALID", "This build session is invalid. Analyze the image again.", 409);
}
function expired(): never {
  throw new ProviderError("BUILD_SESSION_EXPIRED", "This build session has expired or belongs to a different browser session. Analyze the image again.", 409);
}

export class BuildSessionSigner {
  private cachedFileSecret: Buffer | null = null;
  constructor(private readonly directory = join(process.cwd(), ".sentinel")) {}

  private async loadOrCreatePersistedSecret(): Promise<Buffer> {
    const path = join(this.directory, "build-session-secret");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      return Buffer.from((await readFile(path, "utf8")).trim(), "hex");
    } catch (error) {
      if (!isFsError(error, "ENOENT")) throw error;
    }
    const generated = randomBytes(32);
    try {
      const file = await open(path, "wx", 0o600);
      try { await file.writeFile(generated.toString("hex")); } finally { await file.close(); }
      return generated;
    } catch (error) {
      // Another process/request won the race to create it first - read what it wrote
      // rather than each process trusting a different, un-shared secret.
      if (isFsError(error, "EEXIST")) return Buffer.from((await readFile(path, "utf8")).trim(), "hex");
      throw error;
    }
  }

  private async getSigningSecret(): Promise<Buffer> {
    const configured = process.env.SENTINEL_BUILD_SESSION_SECRET?.trim();
    if (configured) return Buffer.from(configured, "utf8");
    if (!this.cachedFileSecret) this.cachedFileSecret = await this.loadOrCreatePersistedSecret();
    return this.cachedFileSecret;
  }

  private async hmac(body: string): Promise<string> {
    return createHmac("sha256", await this.getSigningSecret()).update(body).digest("base64url");
  }

  async sign(payload: BuildSessionPayload): Promise<string> {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${body}.${await this.hmac(body)}`;
  }

  /** Verifies the signature (constant-time), then the owner binding and expiry, before
   * trusting a single field. Throws rather than returning a result the caller might
   * forget to check - there is no partially-trusted payload. */
  async verify(token: string, owner: string): Promise<BuildSessionPayload> {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) invalid();
    const [body, signature] = parts;
    const expectedBuf = Buffer.from(await this.hmac(body), "base64url");
    const actualBuf = Buffer.from(signature, "base64url");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) invalid();

    let raw: unknown;
    try { raw = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { invalid(); }
    const parsed = buildSessionPayloadSchema.safeParse(raw);
    if (!parsed.success) invalid();
    if (parsed.data.owner !== owner) expired();
    if (Date.now() > parsed.data.expiresAt) expired();
    return parsed.data;
  }
}

export function newSessionExpiry(now = Date.now()): { issuedAt: number; expiresAt: number } {
  return { issuedAt: now, expiresAt: now + TTL_MS };
}

export const buildSessionSigner = new BuildSessionSigner();
