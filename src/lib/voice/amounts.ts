import type { Token } from "./text";

const UNITS = new Map<string, number>([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19],
]);
const TENS = new Map<string, number>([["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90]]);

export function isNumberWord(word: string): boolean {
  return UNITS.has(word) || TENS.has(word) || word === "hundred" || word === "thousand";
}

/** Whole numbers only: "seventy" -> 70, "one hundred and twenty five" -> 125, "a hundred" -> 100. */
export function parseNumberWords(words: readonly string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === "and" && seen) continue;
    if (word === "a" && !seen && (words[index + 1] === "hundred" || words[index + 1] === "thousand")) continue;
    if (UNITS.has(word)) current += UNITS.get(word)!;
    else if (TENS.has(word)) current += TENS.get(word)!;
    else if (word === "hundred") current = (current || 1) * 100;
    else if (word === "thousand") { total += (current || 1) * 1000; current = 0; }
    else return null;
    seen = true;
  }
  const value = total + current;
  return seen && value < 1_000_000 ? value : null;
}

/** "70" -> 7000, "1,200.5" -> 120050. Exact string arithmetic, never float math. */
export function parseDigitsToMinor(text: string): number | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const minor = Number(match[1].replace(/,/g, "")) * 100 + (match[2] ? Number(match[2].padEnd(2, "0")) : 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

export type SpokenCurrency = "CAD" | "USD" | "EUR" | "GBP";
export type BudgetPeriod = "RUN" | "DAY" | "WEEK" | "MONTH";
export interface MoneyMention {
  amountMinor: number;
  currency: SpokenCurrency;
  period: BudgetPeriod | null;
  /** Character span of the trailing period phrase ("a week"), if any, so it isn't read as a cadence. */
  periodSpan: [number, number] | null;
}

const SYMBOLS = new Map<string, SpokenCurrency>([["c$", "CAD"], ["ca$", "CAD"], ["$", "CAD"], ["us$", "USD"], ["€", "EUR"], ["£", "GBP"]]);
/** Bare "dollars"/"bucks"/"$" default to CAD, the same CA/CAD default Request Mode uses. */
const DEFAULT_MARKERS = new Set(["$", "dollars", "dollar", "bucks", "buck"]);
const CURRENCY_PHRASES: [string[], SpokenCurrency][] = [
  [["canadian", "dollars"], "CAD"], [["canadian", "dollar"], "CAD"], [["cdn", "dollars"], "CAD"],
  [["us", "dollars"], "USD"], [["us", "dollar"], "USD"], [["u", "s", "dollars"], "USD"], [["american", "dollars"], "USD"],
  [["cad"], "CAD"], [["cdn"], "CAD"], [["canadian"], "CAD"], [["usd"], "USD"],
  [["dollars"], "CAD"], [["dollar"], "CAD"], [["bucks"], "CAD"], [["buck"], "CAD"],
  [["euros"], "EUR"], [["euro"], "EUR"], [["eur"], "EUR"], [["pounds"], "GBP"], [["pound"], "GBP"], [["gbp"], "GBP"], [["quid"], "GBP"],
];
const CUES: string[][] = [
  ["at", "most"], ["up", "to"], ["no", "more", "than"], ["not", "more", "than"], ["less", "than"], ["under"], ["below"],
  ["max"], ["maximum"], ["maximum", "of"], ["budget"], ["budget", "of"], ["limit"], ["limit", "of"], ["cap", "of"], ["capped", "at"],
  ["spend"], ["spending"], ["within"],
];
const PERIODS: [string[], BudgetPeriod][] = [
  [["a", "week"], "WEEK"], [["per", "week"], "WEEK"], [["each", "week"], "WEEK"], [["every", "week"], "WEEK"], [["weekly"], "WEEK"],
  [["a", "month"], "MONTH"], [["per", "month"], "MONTH"], [["each", "month"], "MONTH"], [["every", "month"], "MONTH"], [["monthly"], "MONTH"],
  [["a", "day"], "DAY"], [["per", "day"], "DAY"], [["each", "day"], "DAY"], [["every", "day"], "DAY"], [["daily"], "DAY"],
  [["each", "time"], "RUN"], [["every", "time"], "RUN"], [["per", "run"], "RUN"], [["each", "run"], "RUN"], [["per", "order"], "RUN"], [["each", "order"], "RUN"], [["per", "delivery"], "RUN"],
];
const LEADING_PERIOD = new Map<string, BudgetPeriod>([["weekly", "WEEK"], ["monthly", "MONTH"], ["daily", "DAY"]]);

function phraseAt<T>(tokens: readonly Token[], index: number, phrases: readonly [string[], T][]): { value: T; words: string[] } | null {
  for (const [words, value] of phrases) {
    if (words.every((word, offset) => tokens[index + offset]?.text === word)) return { value, words };
  }
  return null;
}
function endsWith(tokens: readonly Token[], before: number, words: readonly string[]): boolean {
  return words.every((word, offset) => tokens[before - words.length + offset]?.text === word);
}

/**
 * Money mentions in spoken order. A bare number only counts as money when it carries a
 * currency symbol/word or follows a spending cue ("under 70", "at most seventy"); "keep 12
 * cans stocked" is a quantity, not a budget.
 */
export function findMoneyMentions(tokens: readonly Token[]): MoneyMention[] {
  const mentions: MoneyMention[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const word = tokens[index].text;
    let amountMinor: number | null = null;
    let last = index;
    if (/^\d/.test(word)) {
      amountMinor = parseDigitsToMinor(word);
    } else if (isNumberWord(word) || (word === "a" && isNumberWord(tokens[index + 1]?.text ?? ""))) {
      const words: string[] = [];
      let cursor = index;
      while (cursor < tokens.length) {
        const current = tokens[cursor].text;
        const joins = (current === "and" || (current === "a" && cursor === index)) && isNumberWord(tokens[cursor + 1]?.text ?? "");
        if (!isNumberWord(current) && !joins) break;
        words.push(current);
        cursor++;
      }
      const major = parseNumberWords(words);
      if (major !== null) { amountMinor = major * 100; last = cursor - 1; }
    }
    if (amountMinor === null) continue;
    const symbolText = tokens[index - 1]?.text ?? "";
    const symbol = SYMBOLS.get(symbolText);
    const suffix = phraseAt(tokens, last + 1, CURRENCY_PHRASES);
    const cueEnd = symbol ? index - 1 : index;
    const cued = CUES.some(cue => endsWith(tokens, cueEnd, cue));
    if (!symbol && !suffix && !cued) { index = last; continue; }
    const suffixExplicit = suffix && !DEFAULT_MARKERS.has(suffix.words.join(" ")) ? suffix.value : null;
    const symbolExplicit = symbol && !DEFAULT_MARKERS.has(symbolText) ? symbol : null;
    const periodIndex = last + 1 + (suffix?.words.length ?? 0);
    const trailing = phraseAt(tokens, periodIndex, PERIODS);
    const leading = tokens.slice(Math.max(0, cueEnd - 3), cueEnd).map(token => LEADING_PERIOD.get(token.text)).find(Boolean) ?? null;
    mentions.push({
      amountMinor,
      currency: suffixExplicit ?? symbolExplicit ?? "CAD",
      period: trailing?.value ?? leading,
      periodSpan: trailing ? [tokens[periodIndex].start, tokens[periodIndex + trailing.words.length - 1].end] : null,
    });
    index = periodIndex + (trailing?.words.length ?? 0) - 1;
  }
  return mentions;
}
