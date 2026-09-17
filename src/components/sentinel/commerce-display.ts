import type { CompatibilityStatus, Price } from "@/lib/domain/commerce";

export function displayPrice(price: Price | null | undefined): string {
  if (!price || !Number.isSafeInteger(price.amountMinor) || price.amountMinor < 0) return "Not available";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: price.currency, currencyDisplay: "code" }).format(price.amountMinor / 100);
}

export const compatibilityLabels: Record<CompatibilityStatus, string> = {
  VERIFIED: "Verified from listing evidence",
  LIKELY_COMPATIBLE: "Likely compatible",
  NEEDS_VERIFICATION: "Needs verification",
  INCOMPATIBLE: "Incompatible",
};

export function publicUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
