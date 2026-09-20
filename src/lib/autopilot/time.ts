/**
 * Timezone-aware calendar math built only on the platform's Intl API (no date library).
 * Local wall times are resolved to instants per IANA zone, so schedules keep their local
 * time across DST changes. Nonexistent local times (spring-forward gaps) move forward past
 * the gap; ambiguous ones (fall-back overlaps) resolve to the earlier instant.
 */
export interface LocalDate { year: number; month: number; day: number }
export interface ZonedDateTime extends LocalDate { hour: number; minute: number; second: number; isoWeekday: number }

const IANA_SHAPE = /^[A-Za-z]+(?:[/_-][A-Za-z0-9+_-]+)*$/;
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    if (formatters.size >= 64) formatters.clear();
    cached = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, cached);
  }
  return cached;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.length > 64 || !IANA_SHAPE.test(timeZone)) return false;
  try { formatter(timeZone).format(0); return true; } catch { return false; }
}

/** Canonical IANA spelling, e.g. "america/toronto" -> "America/Toronto". */
export function canonicalTimeZone(timeZone: string): string {
  return formatter(timeZone).resolvedOptions().timeZone;
}

export function zonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  const parts = formatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")), month: Number(value("month")), day: Number(value("day")),
    hour: Number(value("hour")), minute: Number(value("minute")), second: Number(value("second")),
    isoWeekday: WEEKDAY[value("weekday")],
  };
}

export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = zonedDateTime(instant, timeZone);
  return { year, month, day };
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Same day-of-month N months later. Callers only pass days 1-28, which exist in every month. */
export function addLocalMonths(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1, day: date.day };
}

/** ISO weekday of a calendar date: Monday = 1 ... Sunday = 7. */
export function isoWeekdayOf(date: LocalDate): number {
  return ((new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7) + 1;
}

function offsetMs(instant: number, timeZone: string): number {
  const z = zonedDateTime(new Date(instant), timeZone);
  return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second) - (instant - (instant % 1000));
}

function matchesWall(instant: number, date: LocalDate, hour: number, minute: number, timeZone: string): boolean {
  const z = zonedDateTime(new Date(instant), timeZone);
  return z.year === date.year && z.month === date.month && z.day === date.day && z.hour === hour && z.minute === minute;
}

export function zonedWallTimeToInstant(date: LocalDate, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  const first = wall - offsetMs(wall, timeZone);
  const second = wall - offsetMs(first, timeZone);
  const valid = [first, second].filter(candidate => matchesWall(candidate, date, hour, minute, timeZone));
  return new Date(valid.length ? Math.min(...valid) : Math.max(first, second));
}

/** The ISO week (Monday 00:00 to the next Monday 00:00, local time) containing `instant`. */
export function isoWeekWindow(instant: Date, timeZone: string): { start: Date; end: Date } {
  const today = localDateOf(instant, timeZone);
  const monday = addLocalDays(today, 1 - isoWeekdayOf(today));
  return { start: zonedWallTimeToInstant(monday, 0, 0, timeZone), end: zonedWallTimeToInstant(addLocalDays(monday, 7), 0, 0, timeZone) };
}
