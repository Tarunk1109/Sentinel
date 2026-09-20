import type { AutopilotPolicy, AutopilotSchedule } from "./policy";
import { addLocalDays, addLocalMonths, isoWeekdayOf, localDateOf, zonedWallTimeToInstant, type LocalDate } from "./time";

type ScheduleRule = Omit<AutopilotSchedule, "nextRunAt">;

/**
 * The first scheduled slot strictly after `after`, at the policy's local time of day in its
 * own timezone. Pure and deterministic; the same function serves a manual "run now", a
 * future cron/Vercel Cron/Cloud Scheduler caller, and tests.
 */
export function calculateNextRunAt(schedule: ScheduleRule, after: Date): Date {
  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
  const today = localDateOf(after, schedule.timezone);
  const slotOn = (date: LocalDate) => zonedWallTimeToInstant(date, hour, minute, schedule.timezone);
  const candidates: LocalDate[] = [];
  if (schedule.cadence === "DAILY") {
    for (let i = 0; i < 3; i++) candidates.push(addLocalDays(today, i));
  } else if (schedule.cadence === "WEEKLY") {
    if (schedule.dayOfWeek === undefined) throw new Error("A weekly schedule needs dayOfWeek.");
    const ahead = (schedule.dayOfWeek - isoWeekdayOf(today) + 7) % 7;
    for (let i = 0; i < 3; i++) candidates.push(addLocalDays(today, ahead + 7 * i));
  } else {
    if (schedule.dayOfMonth === undefined) throw new Error("A monthly schedule needs dayOfMonth.");
    for (let i = 0; i < 3; i++) candidates.push(addLocalMonths({ year: today.year, month: today.month, day: schedule.dayOfMonth }, i));
  }
  for (const date of candidates) {
    const slot = slotOn(date);
    if (slot.getTime() > after.getTime()) return slot;
  }
  throw new Error("Could not compute the next scheduled run.");
}

/** Due means: ACTIVE, has a scheduled slot, and that slot is not in the future. */
export function isPolicyDue(policy: Pick<AutopilotPolicy, "status" | "schedule">, now: Date): boolean {
  return policy.status === "ACTIVE" && policy.schedule.nextRunAt !== null && Date.parse(policy.schedule.nextRunAt) <= now.getTime();
}

/**
 * After a scheduled run for `slot`, the next slot. Missed slots are never back-filled: if the
 * evaluation ran late (e.g. after downtime), scheduling resumes from `now`, so an outage can
 * never produce a burst of catch-up purchase runs.
 */
export function nextRunAfterScheduledRun(schedule: ScheduleRule, slot: Date, now: Date): Date {
  return calculateNextRunAt(schedule, slot.getTime() > now.getTime() ? slot : now);
}

export const CADENCE_LABEL: Readonly<Record<AutopilotSchedule["cadence"], string>> = Object.freeze({ DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" });
