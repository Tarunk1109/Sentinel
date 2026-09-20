import { formatMinor } from "@/lib/autopilot/money";
import { AUTOPILOT_LIMITS, autopilotPolicyInputSchema, type AutopilotCadence, type AutopilotItem } from "@/lib/autopilot/policy";
import { findMoneyMentions, type MoneyMention } from "./amounts";
import { spokenItem, splitItemList } from "./catalog";
import { CLARIFY_FIELDS, type InterpretContext, type VoiceCommandInput, type VoiceCommandInterpreter, type VoicePolicyRef } from "./commands";
import { findCadences, findDayOfMonth, findDayOfWeek, findTimeOfDay } from "./schedule-phrases";
import { matchingText, normalizeTranscript, tokenize } from "./text";

type ControlKind = "AUTOPILOT_PAUSE" | "AUTOPILOT_RESUME" | "AUTOPILOT_RUN_NOW";
type ClarifyField = (typeof CLARIFY_FIELDS)[number];

const LEAD_IN = /^(?:(?:hey|hi|ok|okay|so|um|uh|yes|yeah|yep|sure|alright)\b[\s,]*)*(?:sentinel\b[\s,]*)?(?:please\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+)?|i want you to\s+|i'd like you to\s+|i would like you to\s+|i want to\s+|i'd like to\s+|i would like to\s+|let's\s+|lets\s+|go ahead and\s+)?(?:please\s+)?/;
const TRAILER = /(?:[\s,]+(?:please|thanks|thank you))?[\s.!?]*$/;

/** Voice never confirms, approves or places a purchase - those stay explicit on-screen actions. */
const PURCHASE_CONFIRMATION = [
  /^(?:buy|purchase|order|get|grab|check ?out)\s+(?:it|this|that|these|those|them|this one|that one|the (?:first|second|third|top|best|cheapest|selected|recommended) (?:one|item|product|option))(?:\s+now)?$/,
  /^(?:buy|purchase|order|pay|check ?out)(?:\s+(?:it|this|that))?\s+now$/,
  /\b(?:confirm|approve|complete|finali[sz]e|place|submit|authori[sz]e|accept)\s+(?:the\s+|my\s+|this\s+|that\s+|our\s+)?(?:purchase|order|checkout|payment|transaction)\b/,
  /^(?:check ?out|pay|pay now|pay for (?:it|this|that))$/,
];
const CONTROL: [RegExp, ControlKind][] = [
  [/^(?:pause|stop|suspend|halt|disable|deactivate|turn off|switch off)\b(.*)$/, "AUTOPILOT_PAUSE"],
  [/^turn (.+) off$/, "AUTOPILOT_PAUSE"],
  [/^(?:resume|unpause|restart|reactivate|re-?enable|enable|continue|turn back on|turn on|switch back on|switch on)\b(.*)$/, "AUTOPILOT_RESUME"],
  [/^turn (.+?) (?:back )?on$/, "AUTOPILOT_RESUME"],
];
const RUN_NOW = /^(?:run|trigger|execute|check)\b(?!\s+out\b)(.*)$/;
const CREATE_SIGNAL = /\bkeep\b.*\b(?:stocked|in stock|on hand|topped up)\b|\bstocked (?:up )?(?:with|on)\b|\b(?:re-?stock|re-?order|replenish)\b|\bnever run out of\b|\balways (?:have|has)\b|\b(?:set up|create|make|start) (?:an? |my |a new )?autopilot\b|\bautopilot (?:for|to)\b/;
const RECURRING_BUY = /^(?:buy|order|purchase|get)\b/;
const REQUEST_START = /^(?:find|search|look|looking|show|get|buy|order|purchase|shop|need|want|i need|i want|i'm looking|im looking|i am looking|we need|recommend|compare|help me find|where can i)\b/;
const ASK_FIRST = /\b(?:ask me|check with me|get my (?:ok|okay|approval|permission)|with my approval|needs? my approval|my approval first|confirm with me|approve (?:it|them|each|every)|ask first|ask before)\b/;

const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const ITEM_PATTERNS = [
  /\bstocked (?:up )?(?:with|on) (.+)/,
  /\bkeep (.+?) (?:stocked|in stock|on hand|topped up)\b/,
  /\bnever run out of (.+)/,
  /\balways (?:have|has) (.+)/,
  /\b(?:re-?stock|re-?order|replenish)(?: on)? (.+)/,
  /\bautopilot (?:for|to (?:buy|order|restock|keep)) (.+)/,
  /^(?:buy|order|purchase|get) (.+)/,
];
const ITEM_BOUNDARY = new RegExp(`[.;!?]|,?\\s*\\b(?:and |then )?(?:check|checking|spend|spending|every|each|once|twice|weekly|daily|monthly|bi-?weekly|fortnightly|under|below|at most|up to|no more than|not more than|less than|within|for (?:at most|up to|under|less than|no more than)|with a (?:budget|limit)|budget|limit|max|maximum|ask|automatically|without|per|a (?:week|day|month)|on (?:${DAYS})s?|at \\d|stocked|in stock|on hand|so that|so we|if|when|from)\\b|\\s\\d+(?:[.,]\\d+)?\\s*(?:dollars?|bucks|cad|canadian|usd)\\b|ca\\$|c\\$|us\\$|\\$|€|£`);

const AUTOPILOT_WORDS = new Set(["autopilot", "autopilots", "policy", "policies", "rule", "rules"]);
const GENERIC_WORDS = new Set(["my", "our", "the", "a", "an", "for", "of", "to", "now", "again", "right", "away", "immediately", "back", "on", "off", "up", "please", "restock", "restocking", "restocks", "order", "orders", "ordering", "auto", "pilot", "its", "all", "current", "demo"]);
const PRONOUNS = new Set(["it", "this", "that", "them", "those", "these", "one"]);

function unknown(reason: string): VoiceCommandInput { return { type: "UNKNOWN", reason }; }
function clarify(about: ControlKind | "AUTOPILOT_CREATE", reason: string, missing: ClarifyField[], candidates: readonly VoicePolicyRef[] = [], understood: { items: string[]; cadence: AutopilotCadence | null; weeklyBudgetMinor: number | null } | null = null): VoiceCommandInput {
  return { type: "NEEDS_CLARIFICATION", about, reason: reason.slice(0, 300), missing, candidates: [...candidates], understood };
}
function singular(word: string): string { return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word; }
function words(text: string): string[] { return text.split(/[^a-z0-9]+/).filter(Boolean); }
function nameWords(name: string): string[] { return words(matchingText(name)).filter(word => !AUTOPILOT_WORDS.has(word) && !GENERIC_WORDS.has(word)).map(singular); }
function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  const shown = labels.length > 3 ? [...labels.slice(0, 3), `${labels.length - 3} more`] : [...labels];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

function reference(rest: string) {
  const raw = words(rest);
  return {
    hasAutopilotWord: raw.some(word => AUTOPILOT_WORDS.has(word)),
    saysNow: raw.includes("now"),
    tokens: raw.filter(word => !AUTOPILOT_WORDS.has(word) && !GENERIC_WORDS.has(word) && !PRONOUNS.has(word)).map(singular),
  };
}

/** Resolves which autopilot a control command means. Never guesses between several. */
function resolveControl(kind: ControlKind, rest: string, context: InterpretContext): VoiceCommandInput {
  const verb = kind === "AUTOPILOT_PAUSE" ? "pause" : kind === "AUTOPILOT_RESUME" ? "resume" : "run";
  const ref = reference(rest);
  // Resuming re-grants standing authority, so only it requires on-screen confirmation.
  const command = (policy: VoicePolicyRef): VoiceCommandInput => kind === "AUTOPILOT_RESUME"
    ? { type: kind, requiresConfirmation: true, policy }
    : kind === "AUTOPILOT_PAUSE" ? { type: kind, requiresConfirmation: false, policy } : { type: kind, requiresConfirmation: false, policy };
  if (ref.tokens.length) {
    const matches = context.policies.filter(policy => { const name = nameWords(policy.name); return ref.tokens.every(token => name.includes(token)); });
    if (matches.length === 1) return command(matches[0]);
    if (matches.length === 0) return clarify(kind, `No autopilot matches "${ref.tokens.join(" ").slice(0, 60)}". Say its name.`, ["policy"], context.policies);
    return clarify(kind, `More than one autopilot matches. Say which one to ${verb}.`, ["policy"], matches);
  }
  if (!ref.hasAutopilotWord) return clarify(kind, `Say which autopilot to ${verb}.`, ["policy"], context.policies);
  if (context.policies.length === 1) return command(context.policies[0]);
  if (context.policies.length === 0) return clarify(kind, "You don't have any autopilots yet.", ["policy"]);
  return clarify(kind, `You have more than one autopilot. Say which one to ${verb}.`, ["policy"], context.policies);
}

function extractItemList(text: string): string | null {
  for (const pattern of ITEM_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1].split(ITEM_BOUNDARY)[0].trim();
  }
  return null;
}

type Budget = { perWeek: number; perRun: number } | { problem: string };
function budgetFor(cadence: AutopilotCadence, mention: MoneyMention): Budget {
  const amount = mention.amountMinor;
  const cadenceName = cadence.toLowerCase();
  switch (mention.period) {
    case null: return cadence === "DAILY" ? { problem: `Is ${formatMinor(amount)} the limit per day or per week?` } : { perWeek: amount, perRun: amount };
    case "RUN": return cadence === "DAILY" ? { perRun: amount, perWeek: amount * 7 } : { perRun: amount, perWeek: amount };
    case "DAY": return cadence === "DAILY" ? { perRun: amount, perWeek: amount * 7 } : { problem: `A daily limit doesn't fit a ${cadenceName} schedule. Say a limit per week or per run.` };
    case "WEEK": return { perRun: amount, perWeek: amount };
    case "MONTH": return cadence === "MONTHLY" ? { perRun: amount, perWeek: amount } : { problem: `A monthly limit doesn't fit a ${cadenceName} schedule. Say a limit per week or per run.` };
  }
}

function interpretCreate(text: string, context: InterpretContext): VoiceCommandInput {
  const phrases = splitItemList(extractItemList(text) ?? "");
  const items: AutopilotItem[] = [];
  const unclear: string[] = [];
  for (const phrase of phrases.slice(0, AUTOPILOT_LIMITS.maxItems + 1)) {
    const mapped = spokenItem(phrase);
    if (!mapped.ok) unclear.push(mapped.phrase);
    else if (!items.some(item => item.id === mapped.item.id)) items.push(mapped.item);
  }
  const mentions = findMoneyMentions(tokenize(text));
  const amounts = [...new Set(mentions.map(mention => `${mention.amountMinor}:${mention.currency}`))];
  const phrasesFound = findCadences(text, mentions.flatMap(mention => (mention.periodSpan ? [mention.periodSpan] : [])));
  const mention = mentions[0] ?? null;
  const derived: Partial<Record<NonNullable<MoneyMention["period"]>, AutopilotCadence>> = { WEEK: "WEEKLY", MONTH: "MONTHLY", DAY: "DAILY" };
  const cadence = phrasesFound.cadences.length === 1 ? phrasesFound.cadences[0] : phrasesFound.cadences.length === 0 && mention?.period ? derived[mention.period] ?? null : null;
  const budget = cadence && mention && amounts.length === 1 && mention.currency === "CAD" ? budgetFor(cadence, mention) : null;
  const understood = { items: items.map(item => item.label), cadence, weeklyBudgetMinor: budget && "perWeek" in budget ? budget.perWeek : null };
  const ask = (reason: string, missing: ClarifyField[]) => clarify("AUTOPILOT_CREATE", reason, missing, [], understood);

  if (phrasesFound.unsupported) return ask("Autopilot can check daily, weekly or monthly. Which should it be?", ["cadence"]);
  if (phrases.length === 0) return ask("Which items should SENTINEL keep stocked?", ["items"]);
  if (phrases.length > AUTOPILOT_LIMITS.maxItems) return ask(`An autopilot can track up to ${AUTOPILOT_LIMITS.maxItems} items.`, ["items"]);
  if (unclear.length) return ask(`I couldn't tell what kind of product "${unclear[0].slice(0, 60)}" is. Try naming it more specifically.`, ["items"]);
  if (mentions.length === 0) return ask("What's the most SENTINEL may spend? For example: up to 70 dollars a week.", ["budget"]);
  if (amounts.length > 1) return ask("I heard more than one amount. Say a single spending limit.", ["budget"]);
  if (mention!.currency !== "CAD") return ask("Autopilot supports Canadian dollars (CAD) only right now.", ["currency"]);
  if (phrasesFound.cadences.length > 1) return ask("I heard more than one schedule. Say daily, weekly or monthly.", ["cadence"]);
  if (!cadence) return ask("How often should SENTINEL check: daily, weekly or monthly?", ["cadence"]);
  if (!budget || "problem" in budget) return ask(budget && "problem" in budget ? budget.problem : "Say a single spending limit.", ["budget"]);

  const labels = items.map(item => item.label);
  const fullName = `${listLabels(labels)} restock`;
  const name = fullName.length <= AUTOPILOT_LIMITS.maxNameLength ? fullName : `${labels[0].slice(0, 50)} + ${labels.length - 1} more restock`;
  const autoAuthorize = !ASK_FIRST.test(text);
  const parsed = autopilotPolicyInputSchema.safeParse({
    status: "DRAFT",
    name,
    goal: `Keep ${listLabels(labels)} stocked.`,
    currency: "CAD",
    budget: { maximumPerWeekMinor: budget.perWeek, maximumPerRunMinor: budget.perRun },
    schedule: {
      cadence,
      timezone: context.timezone,
      timeOfDay: findTimeOfDay(text) ?? "09:00",
      ...(cadence === "WEEKLY" ? { dayOfWeek: findDayOfWeek(text) ?? 1 } : {}),
      ...(cadence === "MONTHLY" ? { dayOfMonth: findDayOfMonth(text) ?? 1 } : {}),
    },
    trigger: { type: "SCHEDULED" },
    allowedCategories: [...new Set(items.map(item => item.category))],
    items,
    authorization: { autoAuthorizeWithinMandate: autoAuthorize, requireApprovalAboveMinor: null, overMandate: "REQUIRE_APPROVAL" },
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return ask(issue?.message ?? "That autopilot isn't valid yet.", issue?.path[0] === "budget" ? ["budget"] : issue?.path[0] === "items" ? ["items"] : []);
  }
  const perRun = budget.perRun < budget.perWeek ? ` and ${formatMinor(budget.perRun)} per run` : "";
  const summary = `Draft: keep ${listLabels(labels)} stocked, checked ${cadence.toLowerCase()}, up to ${formatMinor(budget.perWeek)} per week${perRun}. ${autoAuthorize ? "Once you activate it, purchases inside this limit can be auto-authorized; anything above needs your approval." : "Every purchase will need your approval."}`;
  return { type: "AUTOPILOT_CREATE", requiresConfirmation: true, summary: summary.slice(0, 400), draft: parsed.data };
}

/**
 * Deterministic, zero-model-call interpretation of a speech transcript. The transcript is
 * treated purely as data: it can only select one of the fixed command shapes, each of which
 * still requires an explicit on-screen action to take effect.
 */
export function interpretTranscript(transcript: string, context: InterpretContext): VoiceCommandInput {
  const display = normalizeTranscript(transcript);
  const core = matchingText(display).replace(LEAD_IN, "").replace(TRAILER, "").trim();
  if (!core) return unknown("Nothing was heard. Try again or type instead.");
  if (PURCHASE_CONFIRMATION.some(pattern => pattern.test(core))) return unknown("Voice can't confirm, approve or place purchases. Use the checkout controls on screen.");
  for (const [pattern, kind] of CONTROL) {
    const match = pattern.exec(core);
    if (match) return resolveControl(kind, match[1] ?? "", context);
  }
  const cadence = findCadences(core, []);
  if (CREATE_SIGNAL.test(core) || (RECURRING_BUY.test(core) && (cadence.cadences.length > 0 || cadence.unsupported))) return interpretCreate(core, context);
  const run = RUN_NOW.exec(core);
  if (run) {
    const ref = reference(run[1]);
    const namesAPolicy = ref.tokens.length > 0 && context.policies.some(policy => { const name = nameWords(policy.name); return ref.tokens.every(token => name.includes(token)); });
    if (ref.hasAutopilotWord || ref.saysNow || namesAPolicy) return resolveControl("AUTOPILOT_RUN_NOW", run[1], context);
  }
  if (REQUEST_START.test(core)) return display.length >= 3 ? { type: "REQUEST", text: display } : unknown("That request is too short.");
  return unknown("Try \"Find me ...\" to search for a product, or \"Keep ... stocked every week under 70 dollars\" to draft an autopilot.");
}

export const deterministicInterpreter: VoiceCommandInterpreter = { interpret: interpretTranscript };
