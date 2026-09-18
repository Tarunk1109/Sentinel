import "server-only";
import { MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES, type SupportedImageType } from "@/lib/domain/inspection";
import { ProviderError } from "./provider-error";

/** Detects real image content from magic bytes; a client-claimed MIME type is never trusted alone. */
function sniff(bytes: Uint8Array): SupportedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export interface ValidatedImage { bytes: Uint8Array; type: SupportedImageType; dataUrl: string }

/** Decodes and validates an uploaded image. Throws a safe, user-facing ProviderError on any failure. */
export function decodeAndValidateImage(imageBase64: string): ValidatedImage {
  const commaIndex = imageBase64.indexOf(",");
  const raw = imageBase64.startsWith("data:") && commaIndex !== -1 ? imageBase64.slice(commaIndex + 1) : imageBase64;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length === 0) throw new ProviderError("INVALID_IMAGE", "The uploaded file is not a valid image.", 400);
  // Reject the encoded length before allocating, so an oversized payload never reaches Buffer.from.
  if (Math.ceil((raw.length * 3) / 4) > MAX_IMAGE_BYTES + 4096) throw new ProviderError("IMAGE_TOO_LARGE", "Images must be 10 MB or smaller.", 413);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(Buffer.from(raw, "base64")); }
  catch { throw new ProviderError("INVALID_IMAGE", "The uploaded file is not a valid image.", 400); }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new ProviderError("IMAGE_TOO_LARGE", "Images must be 10 MB or smaller.", 413);
  const type = sniff(bytes);
  if (!type || !SUPPORTED_IMAGE_TYPES.includes(type)) throw new ProviderError("UNSUPPORTED_IMAGE_TYPE", "Only JPG, PNG, and WEBP images are supported.", 415);
  return { bytes, type, dataUrl: `data:${type};base64,${raw}` };
}
