import assert from "node:assert/strict";
import test from "node:test";
import { selectTodayTasks } from "../src/lib/today-tasks";
import type { Task } from "../src/lib/api";

function task(status: Task["status"], stoppedAt: string | null): Task {
  return {
    id: crypto.randomUUID(), title: "Work", status, stopped_at: stoppedAt,
    started_at: "2026-11-10T09:00:00Z", segment_started_at: null,
    accumulated_seconds: 0, accumulated_paused_seconds: 0, duration_seconds: null,
    created_at: "2026-11-10T09:00:00Z", is_running: status === "running",
    category_id: null, category_name: null, category_color: null,
  };
}

test("shows active tasks and only tasks stopped in the current local day", () => {
  const { active, completed } = selectTodayTasks([
    task("running", null),
    task("paused", null),
    task("completed", "2026-11-10T08:00:00Z"),
    task("completed", "2026-11-09T23:00:00Z"),
  ], new Date("2026-11-10T12:00:00Z"), "UTC");

  assert.equal(active.length, 2);
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.stopped_at, "2026-11-10T08:00:00Z");
});

test("uses the device time zone for the Today boundary", () => {
  const { completed } = selectTodayTasks([
    task("completed", "2026-11-10T03:30:00Z"),
    task("completed", "2026-11-10T05:30:00Z"),
  ], new Date("2026-11-10T12:00:00Z"), "America/New_York");

  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.stopped_at, "2026-11-10T05:30:00Z");
});
