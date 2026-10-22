import { Temporal } from "@js-temporal/polyfill";
import type { DayHours, DayVersion, IntervalRow, ResetRow, TaskRow } from "./types";

export const DEFAULT_HOURS: DayHours = { start_time: "00:00", end_time: "00:00" };

export function addDays(day: string, days: number): string {
  return Temporal.PlainDate.from(day).add({ days }).toString();
}

export function localDateAt(instant: Date, zone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(zone).toPlainDate().toString();
}

export function settingsForDay(day: string, baseline: DayHours, versions: DayVersion[]): DayHours {
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    if (versions[index].effective_date <= day) return versions[index];
  }
  return baseline;
}

function rawWindow(day: string, zone: string, hours: DayHours): [number, number] {
  const start = Temporal.PlainDate.from(day);
  const [startHour, startMinute] = hours.start_time.split(":").map(Number);
  const [endHour, endMinute] = hours.end_time.split(":").map(Number);
  const end = hours.end_time <= hours.start_time ? start.add({ days: 1 }) : start;
  const zoned = (date: Temporal.PlainDate, hour: number, minute: number) =>
    Temporal.ZonedDateTime.from({
      timeZone: zone, year: date.year, month: date.month, day: date.day, hour, minute,
    }).epochMilliseconds;
  return [zoned(start, startHour, startMinute), zoned(end, endHour, endMinute)];
}

export function dayWindow(
  day: string, zone: string, baseline: DayHours, versions: DayVersion[],
): [number, number] {
  const [start, end] = rawWindow(day, zone, settingsForDay(day, baseline, versions));
  const previous = addDays(day, -1);
  const [, previousEnd] = rawWindow(previous, zone, settingsForDay(previous, baseline, versions));
  return [Math.max(start, previousEnd), end];
}

export function currentDay(now: Date, zone: string, baseline: DayHours, versions: DayVersion[]): string {
  const localDay = localDateAt(now, zone);
  const previous = addDays(localDay, -1);
  const [start, end] = dayWindow(previous, zone, baseline, versions);
  return start <= now.getTime() && now.getTime() < end ? previous : localDay;
}

export function elapsedSeconds(task: TaskRow, now: Date): number {
  if (task.duration_seconds !== null) return task.duration_seconds;
  if (task.status === "running" && task.segment_started_at) {
    return task.accumulated_seconds + Math.max(0, Math.floor(
      (now.getTime() - task.segment_started_at.getTime()) / 1000,
    ));
  }
  return task.accumulated_seconds;
}

export function pausedSeconds(task: TaskRow, now: Date): number {
  if (task.status === "paused" && task.pause_started_at) {
    return task.accumulated_paused_seconds + Math.max(0, Math.floor(
      (now.getTime() - task.pause_started_at.getTime()) / 1000,
    ));
  }
  return task.accumulated_paused_seconds;
}

function overlap(start: number, end: number, windowStart: number, windowEnd: number): number {
  return Math.max(0, Math.floor((Math.min(end, windowEnd) - Math.max(start, windowStart)) / 1000));
}

function taskSecondsOnDay(
  task: TaskRow, intervals: IntervalRow[], now: Date,
  window: [number, number], resetAt?: Date,
): number {
  const [windowStart, dayEnd] = window;
  const dayStart = Math.max(windowStart, resetAt?.getTime() ?? windowStart);
  let total = intervals.reduce((sum, item) => sum + overlap(
    item.started_at.getTime(), item.ended_at.getTime(), dayStart, dayEnd,
  ), 0);

  let currentSeconds = 0;
  if (task.status === "running" && task.segment_started_at) {
    currentSeconds = Math.max(0, Math.floor(
      (now.getTime() - task.segment_started_at.getTime()) / 1000,
    ));
    total += overlap(task.segment_started_at.getTime(), now.getTime(), dayStart, dayEnd);
  }

  // Intervals did not exist for the earliest tasks. Assign their unknown time
  // to the tracking day containing the task's start, matching the old API.
  const recordedSeconds = intervals.reduce((sum, item) => sum + item.duration_seconds, 0);
  const adjustment = task.duration_adjustment_seconds || 0;
  const historical = Math.max(0, elapsedSeconds(task, now) - adjustment - recordedSeconds - currentSeconds);
  const taskStart = task.started_at.getTime();
  if (dayStart <= taskStart && taskStart < dayEnd) total += historical;

  if (task.status === "completed" && task.stopped_at && adjustment !== 0) {
    const stopped = task.stopped_at.getTime();
    if (adjustment > 0 && dayStart <= stopped && stopped < dayEnd) {
      total += adjustment;
    } else if (adjustment < 0 && windowStart <= stopped && (!resetAt || stopped >= dayStart)) {
      const laterSeconds = intervals.reduce((sum, item) => sum + overlap(
        item.started_at.getTime(), item.ended_at.getTime(), dayEnd, stopped,
      ), 0);
      total = Math.max(0, total - Math.max(0, -adjustment - laterSeconds));
    }
  }
  return total;
}

export interface DayBreakdown {
  day: string;
  entries: Array<{ task: TaskRow; seconds: number }>;
}

export function dailyBreakdowns(
  tasks: TaskRow[], intervals: IntervalRow[], now: Date, zone: string,
  days: string[], baseline: DayHours, versions: DayVersion[], resets: ResetRow[],
): DayBreakdown[] {
  const intervalsByTask = new Map<string, IntervalRow[]>();
  for (const item of intervals) {
    const list = intervalsByTask.get(item.task_id) ?? [];
    list.push(item);
    intervalsByTask.set(item.task_id, list);
  }
  const resetsByDay = new Map(resets.filter((item) => item.timezone_name === zone)
    .map((item) => [item.day, item.reset_at]));
  return days.map((day) => {
    const window = dayWindow(day, zone, baseline, versions);
    const entries = tasks.map((task) => ({
      task,
      seconds: taskSecondsOnDay(task, intervalsByTask.get(task.id) ?? [], now, window, resetsByDay.get(day)),
    })).filter((item) => item.seconds > 0);
    return { day, entries };
  });
}
