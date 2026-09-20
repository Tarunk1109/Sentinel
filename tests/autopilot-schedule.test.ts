import { describe, expect, it } from "vitest";
import { calculateNextRunAt, isPolicyDue, nextRunAfterScheduledRun } from "@/lib/autopilot/schedule";
import { isoWeekWindow, zonedWallTimeToInstant } from "@/lib/autopilot/time";

const weeklyMonday9 = { cadence: "WEEKLY" as const, dayOfWeek: 1, timeOfDay: "09:00", timezone: "America/Toronto" };
const next = (schedule: Parameters<typeof calculateNextRunAt>[0], after: string) => calculateNextRunAt(schedule, new Date(after)).toISOString();

describe("Autopilot scheduling", () => {
  it("#8 weekly: next run is the configured local weekday and time", () => {
    // Wednesday 2026-09-16 -> Monday 2026-09-21 09:00 EDT (13:00Z)
    expect(next(weeklyMonday9, "2026-09-16T16:00:00Z")).toBe("2026-09-21T13:00:00.000Z");
    // Monday before 09:00 local -> that same Monday
    expect(next(weeklyMonday9, "2026-09-21T12:59:00Z")).toBe("2026-09-21T13:00:00.000Z");
    // Exactly at the slot or after it -> the following Monday (strictly after)
    expect(next(weeklyMonday9, "2026-09-21T13:00:00Z")).toBe("2026-09-28T13:00:00.000Z");
  });

  it("#8 keeps the local time across DST changes and year boundaries", () => {
    // Fall back on 2026-11-01: Monday 2026-11-02 09:00 is EST (14:00Z), not 13:00Z.
    expect(next(weeklyMonday9, "2026-10-28T12:00:00Z")).toBe("2026-11-02T14:00:00.000Z");
    // Spring forward on 2026-03-08: Monday 2026-03-09 09:00 is EDT (13:00Z).
    expect(next(weeklyMonday9, "2026-03-04T12:00:00Z")).toBe("2026-03-09T13:00:00.000Z");
    // Across a year end.
    expect(next(weeklyMonday9, "2026-12-30T12:00:00Z")).toBe("2027-01-04T14:00:00.000Z");
  });

  it("#8 daily and monthly cadences", () => {
    const daily = { cadence: "DAILY" as const, timeOfDay: "07:30", timezone: "America/Vancouver" };
    expect(next(daily, "2026-09-21T10:00:00Z")).toBe("2026-09-21T14:30:00.000Z");
    expect(next(daily, "2026-09-21T15:00:00Z")).toBe("2026-09-22T14:30:00.000Z");
    const monthly = { cadence: "MONTHLY" as const, dayOfMonth: 15, timeOfDay: "09:00", timezone: "America/Toronto" };
    expect(next(monthly, "2026-12-20T12:00:00Z")).toBe("2027-01-15T14:00:00.000Z");
    expect(next(monthly, "2026-02-01T12:00:00Z")).toBe("2026-02-15T14:00:00.000Z");
  });

  it("#8 a nonexistent local time (spring-forward gap) moves forward, never backward", () => {
    expect(zonedWallTimeToInstant({ year: 2026, month: 3, day: 8 }, 2, 30, "America/Toronto").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("#9 due detection: only ACTIVE policies whose slot has arrived", () => {
    const now = new Date("2026-09-21T13:00:00Z");
    const schedule = { ...weeklyMonday9, nextRunAt: "2026-09-21T13:00:00.000Z" };
    expect(isPolicyDue({ status: "ACTIVE", schedule }, now)).toBe(true);
    expect(isPolicyDue({ status: "ACTIVE", schedule }, new Date("2026-09-21T12:59:59Z"))).toBe(false);
    expect(isPolicyDue({ status: "PAUSED", schedule }, now)).toBe(false);
    expect(isPolicyDue({ status: "DRAFT", schedule }, now)).toBe(false);
    expect(isPolicyDue({ status: "ACTIVE", schedule: { ...schedule, nextRunAt: null } }, now)).toBe(false);
  });

  it("never back-fills missed slots after downtime (no catch-up purchase bursts)", () => {
    const missedSlot = new Date("2026-08-31T13:00:00Z");
    const now = new Date("2026-09-23T15:00:00Z");
    expect(nextRunAfterScheduledRun(weeklyMonday9, missedSlot, now).toISOString()).toBe("2026-09-28T13:00:00.000Z");
    expect(nextRunAfterScheduledRun(weeklyMonday9, new Date("2026-09-21T13:00:00Z"), new Date("2026-09-21T13:00:05Z")).toISOString()).toBe("2026-09-28T13:00:00.000Z");
  });

  it("budget weeks are ISO weeks in the policy's own timezone", () => {
    const window = isoWeekWindow(new Date("2026-09-19T15:00:00Z"), "America/Toronto");
    expect(window.start.toISOString()).toBe("2026-09-14T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-09-21T04:00:00.000Z");
    const fallBackWeek = isoWeekWindow(new Date("2026-10-28T12:00:00Z"), "America/Toronto");
    expect((fallBackWeek.end.getTime() - fallBackWeek.start.getTime()) / 3_600_000).toBe(169);
  });
});
