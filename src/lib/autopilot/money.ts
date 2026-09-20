/** Autopilot money is always an integer number of minor units (cents). No float arithmetic. */
export const AUTOPILOT_CURRENCY = "CAD" as const;
export type AutopilotCurrency = typeof AUTOPILOT_CURRENCY;

const SYMBOL: Record<AutopilotCurrency, string> = { CAD: "C$" };

function assertMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Money must be a safe integer number of minor units.");
}

/** Exact formatting from integer cents: 3148 -> "C$31.48", 700000 -> "C$7,000.00". */
export function formatMinor(amountMinor: number, currency: AutopilotCurrency = AUTOPILOT_CURRENCY): string {
  assertMinor(amountMinor);
  const abs = Math.abs(amountMinor);
  const cents = abs % 100;
  const major = String((abs - cents) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amountMinor < 0 ? "-" : ""}${SYMBOL[currency]}${major}.${String(cents).padStart(2, "0")}`;
}

export function multiplyMinor(unitMinor: number, quantity: number): number {
  assertMinor(unitMinor);
  if (!Number.isSafeInteger(quantity)) throw new RangeError("Quantity must be an integer.");
  const total = unitMinor * quantity;
  assertMinor(total);
  return total;
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) { assertMinor(value); total += value; assertMinor(total); }
  return total;
}

/** ProductIntent budgets are major units by existing contract; cents divide exactly by 100. */
export function minorToMajor(amountMinor: number): number {
  assertMinor(amountMinor);
  return amountMinor / 100;
}
