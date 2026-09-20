import type { AutopilotCadence } from "@/lib/autopilot/policy";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_PATTERN = DAYS.join("|");

const CADENCE_PATTERNS: [RegExp, AutopilotCadence][] = [
  [new RegExp(`\\b(?:every|each|once a|once per|per|a) week\\b|\\bweekly\\b|\\b(?:every|on) (?:${DAY_PATTERN})s?\\b`, "g"), "WEEKLY"],
  [/\b(?:every|each|once a|once per|per|a) day\b|\bdaily\b|\bevery (?:morning|evening|night)\b/g, "DAILY"],
  [/\b(?:every|each|once a|once per|per|a) month\b|\bmonthly\b/g, "MONTHLY"],
];
/** Recurrences Autopilot can't represent yet. Never approximated to a supported cadence. */
const UNSUPPORTED_CADENCE = /\bevery (?:other|two|2|three|3|four|4|few|couple of) (?:days?|weeks?|months?)\b|\bbi-?weekly\b|\bfortnight(?:ly)?\b|\b(?:twice|three times) (?:a|per) (?:day|week|month)\b|\bhourly\b|\bevery hour\b|\byearly\b|\bannually\b|\bevery year\b|\bquarterly\b/;

export interface CadencePhrases { cadences: AutopilotCadence[]; unsupported: boolean }

/** Cadence mentions outside `excluded` spans (budget periods like "70 dollars a week"). */
export function findCadences(text: string, excluded: readonly [number, number][]): CadencePhrases {
  const found = new Set<AutopilotCadence>();
  for (const [pattern, cadence] of CADENCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const start = match.index;
      if (!excluded.some(([from, to]) => start >= from && start < to)) found.add(cadence);
    }
  }
  return { cadences: [...found], unsupported: UNSUPPORTED_CADENCE.test(text) };
}

export function findDayOfWeek(text: string): number | null {
  const match = new RegExp(`\\b(?:every|on) (${DAY_PATTERN})s?\\b`).exec(text);
  return match ? DAYS.indexOf(match[1]) + 1 : null;
}

/** "on the 15th" -> 15. Days over 28 are returned as-is so validation can reject them clearly. */
export function findDayOfMonth(text: string): number | null {
  const match = /\bon the (\d{1,2})(?:st|nd|rd|th)?\b|\b(?:the )?(first) of (?:the|every|each) month\b/.exec(text);
  if (!match) return null;
  return match[2] ? 1 : Number(match[1]);
}

/** "at 9am" / "at 5:30 pm" / "at 17:30" / "at noon". A bare "at 50" is a price, not a time. */
export function findTimeOfDay(text: string): string | null {
  if (/\bat noon\b/.test(text)) return "12:00";
  if (/\bat midnight\b/.test(text)) return "00:00";
  const match = /\bat (\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)(?=\s|$|[,.!?])|\bat (\d{1,2}):(\d{2})\b/.exec(text);
  if (!match) return null;
  let hour = Number(match[1] ?? match[4]);
  const minute = Number(match[2] ?? match[5] ?? "0");
  const meridiem = match[3]?.replace(/\./g, "");
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
