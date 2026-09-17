import "server-only";

import type { ProductCategory, UnderstoodIntent } from "@/lib/domain/types";
import type { IntentUnderstandingService } from "@/lib/server/services/contracts";

const categories: { category: ProductCategory; expression: RegExp }[] = [
  { category: "monitor", expression: /\b(monitors?|displays?|portable screens?)\b/i },
  { category: "keyboard", expression: /\bkeyboards?\b/i },
  { category: "headphones", expression: /\bheadphones?\b/i },
  { category: "hub", expression: /\b(hubs?|docks?|docking stations?)\b/i },
];

const amount = "(?:US\\s*)?\\$?\\s*(\\d+(?:\\.\\d{1,2})?)";

/** Deliberately narrow, deterministic demo parsing; this is not an AI call. */
export class DemoIntentService implements IntentUnderstandingService {
  async understand(prompt: string): Promise<UnderstoodIntent> {
    const normalized = prompt.replace(/(?<=\d),(?=\d{3}\b)/g, "");
    const matches = categories.filter(({ expression }) => expression.test(prompt));
    const asksForAccessory = /\b(?:monitor|display|keyboard|headphones?|hub)\s+(?:arm|stand|mount|cover|case|cable|adapter|protector|cushions?|ear\s*pads?)\b/i.test(prompt);
    const category = matches.length === 1 && !asksForAccessory ? matches[0].category : null;
    const currency = /(?:\b(?:CAD|EUR|GBP|AUD|INR|JPY|Canadian dollars?|euros?|pounds?|rupees?)\b|[€£₹¥]|[CA]\$)/i.test(prompt)
      ? "unsupported"
      : "USD";
    let budget: UnderstoodIntent["budget"] = null;
    let minimumBudget: number | null = null;
    const range = [...normalized.matchAll(new RegExp(`(?:between\\s+|from\\s+)?${amount}\\s*(?:and|to|-)\\s*${amount}`, "gi"))]
      .find((match) => {
        // Sizes, port versions, and battery life also contain numeric ranges.
        // Treat a range as money only when currency or nearby budget wording says so.
        const before = normalized.slice(0, match.index);
        const after = normalized.slice(match.index + match[0].length);
        return match[0].includes("$")
          || /\b(?:budget|price)(?:\s+(?:range|of|is))?\s*[:=]?\s*$/i.test(before)
          || /^\s*(?:USD|dollars?)\b/i.test(after);
      });
    const exclusive = normalized.match(new RegExp(`(?:under|below|less than)\\s+${amount}`, "i"));
    const inclusive = normalized.match(new RegExp(`(?:up to|at most|no more than|not more than|within|max(?:imum)?(?: budget| price)?(?: of| is)?|budget(?: of| is)?)\\s*[:=]?\\s*${amount}`, "i"));
    const trailing = normalized.match(new RegExp(`${amount}\\s*(?:USD\\s*)?(?:or less|or under|max(?:imum)?|budget)\\b`, "i"));
    const dollarAmounts = [...normalized.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)];

    if (range) {
      minimumBudget = Number(range[1]);
      budget = { amount: Number(range[2]), inclusive: true };
    } else if (exclusive) {
      budget = { amount: Number(exclusive[1]), inclusive: false };
    } else if (inclusive || trailing) {
      budget = { amount: Number((inclusive || trailing)![1]), inclusive: true };
    } else if (dollarAmounts.length === 1) {
      budget = { amount: Number(dollarAmounts[0][1]), inclusive: true };
    }

    const compatibilityTarget = prompt.match(/\b(MacBook(?:\s+(?:Air|Pro))?|Mac mini|iPad(?:\s+Pro)?|Windows(?:\s+(?:PC|laptop))?|Steam Deck|Chromebook)\b/i)?.[0] ?? null;
    const constraints: string[] = [];
    if (category) constraints.push(category === "hub" ? "USB hub / dock" : category[0].toUpperCase() + category.slice(1));
    if (budget) constraints.push(`${budget.inclusive ? "Up to" : "Under"} $${budget.amount.toLocaleString("en-US")} USD`);
    if (minimumBudget !== null) constraints.push(`At least $${minimumBudget.toLocaleString("en-US")} USD`);
    if (compatibilityTarget) constraints.push(`${compatibilityTarget} · compatibility unverified`);
    if (currency === "unsupported") constraints.push("Requested currency is not supported by the USD demo catalog");

    return {
      prompt,
      category,
      budget,
      minimumBudget,
      currency,
      constraints,
      compatibilityTarget,
      unresolvedConstraints: ["Only product category and numeric USD budget are filtered in this demo. Other requirements, specifications, availability, and compatibility are unverified."],
    };
  }
}
