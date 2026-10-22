import assert from "node:assert/strict";
import test from "node:test";
import { currentDay, dailyBreakdowns, elapsedSeconds } from "../src/server/timing";
import type { DayHours, DayVersion, IntervalRow, ResetRow, TaskRow } from "../src/server/types";

function task(start: string, changes: Partial<TaskRow> = {}): TaskRow {
  const started = new Date(start);
  return {
    id: "task-1", title: "Work", category_id: null, status: "completed",
    started_at: started, segment_started_at: null,
    accumulated_seconds: 0, pause_started_at: null, accumulated_paused_seconds: 0,
    stopped_at: null, duration_seconds: 0, duration_adjustment_seconds: 0,
    created_at: started, ...changes,
  };
}

function interval(start: string, end: string): IntervalRow {
  return {
    task_id: "task-1", started_at: new Date(start), ended_at: new Date(end),
    duration_seconds: (Date.parse(end) - Date.parse(start)) / 1000,
  };
}

function secondsFor(
  item: TaskRow, intervals: IntervalRow[], now: string, zone: string, day: string,
  baseline: DayHours = { start_time: "00:00", end_time: "00:00" },
  versions: DayVersion[] = [], resets: ResetRow[] = [],
): number {
  return dailyBreakdowns([item], intervals, new Date(now), zone, [day], baseline, versions, resets)
    [0].entries[0]?.seconds ?? 0;
}

test("running task splits at local midnight but keeps its full timer", () => {
  const item = task("2026-10-17T17:50:00Z", {
    status: "running", segment_started_at: new Date("2026-10-17T17:50:00Z"),
    duration_seconds: null,
  });
  assert.equal(currentDay(new Date("2026-10-17T18:10:00Z"), "Asia/Dhaka",
    { start_time: "00:00", end_time: "00:00" }, []), "2026-10-18");
  assert.equal(secondsFor(item, [], "2026-10-17T18:10:00Z", "Asia/Dhaka", "2026-10-18"), 600);
  assert.equal(elapsedSeconds(item, new Date("2026-10-17T18:10:00Z")), 1200);
});

test("saved hours preserve old days and avoid overlap at an overnight change", () => {
  const old = { start_time: "22:00", end_time: "06:00" };
  const versions = [{ effective_date: "2026-10-20", start_time: "00:00", end_time: "00:00" }];
  const item = task("2026-10-20T00:00:00Z", {
    duration_seconds: 28800, stopped_at: new Date("2026-10-20T08:00:00Z"),
  });
  const intervals = [interval("2026-10-20T00:00:00Z", "2026-10-20T08:00:00Z")];
  assert.equal(secondsFor(item, intervals, "2026-10-20T08:00:00Z", "UTC", "2026-10-19", old, versions), 21600);
  assert.equal(secondsFor(item, intervals, "2026-10-20T08:00:00Z", "UTC", "2026-10-20", old, versions), 7200);
  assert.equal(currentDay(new Date("2026-10-20T02:00:00Z"), "UTC", old, versions), "2026-10-19");
});

test("reset cuts off old time while a timer continues", () => {
  const item = task("2026-10-18T09:00:00Z", {
    status: "running", accumulated_seconds: 3600, duration_seconds: null,
    segment_started_at: new Date("2026-10-18T11:00:00Z"),
  });
  const resets = [{
    day: "2026-10-18", timezone_name: "UTC", reset_at: new Date("2026-10-18T11:30:00Z"),
  }];
  assert.equal(secondsFor(item, [interval("2026-10-18T09:00:00Z", "2026-10-18T10:00:00Z")],
    "2026-10-18T12:00:00Z", "UTC", "2026-10-18", undefined, [], resets), 1800);
});

test("daylight saving boundary counts its actual elapsed hours", () => {
  const item = task("2026-11-01T04:30:00Z", {
    duration_seconds: 10800, stopped_at: new Date("2026-11-01T07:30:00Z"),
  });
  assert.equal(secondsFor(item,
    [interval("2026-11-01T04:30:00Z", "2026-11-01T07:30:00Z")],
    "2026-11-01T08:00:00Z", "America/New_York", "2026-11-01"), 10800);
});

test("completed duration edits carry into daily totals", () => {
  const item = task("2026-10-18T08:00:00Z", {
    duration_seconds: 300, duration_adjustment_seconds: -300,
    stopped_at: new Date("2026-10-18T08:10:00Z"),
  });
  const intervals = [interval("2026-10-18T08:00:00Z", "2026-10-18T08:10:00Z")];
  assert.equal(secondsFor(item, intervals, "2026-10-18T09:00:00Z", "UTC", "2026-10-18"), 300);
  item.duration_seconds = 900;
  item.duration_adjustment_seconds = 300;
  assert.equal(secondsFor(item, intervals, "2026-10-18T09:00:00Z", "UTC", "2026-10-18"), 900);
});
