import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { Pool, PoolClient } from "pg";
import { db, transaction } from "./db";
import { ApiError, body, json, noContent, textField, timeField, timeZone, uuidField } from "./http";
import {
  DEFAULT_HOURS, addDays, currentDay, dailyBreakdowns, elapsedSeconds, settingsForDay,
} from "./timing";
import type { DayHours, DayVersion, IntervalRow, ResetRow, TaskRow } from "./types";

const TASK_SELECT = `
  SELECT t.*, c.name AS category_name, c.color AS category_color
  FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
`;

function serialized(task: TaskRow) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    started_at: task.started_at,
    segment_started_at: task.segment_started_at,
    accumulated_seconds: task.accumulated_seconds,
    accumulated_paused_seconds: task.accumulated_paused_seconds,
    stopped_at: task.stopped_at,
    duration_seconds: task.duration_seconds,
    created_at: task.created_at,
    is_running: task.status === "running",
    category_id: task.category_id,
    category_name: task.category_name ?? null,
    category_color: task.category_color ?? null,
  };
}

async function taskById(client: Pool | PoolClient, id: string, lock = false): Promise<TaskRow> {
  const result = await client.query<TaskRow>(
    `${TASK_SELECT} WHERE t.id = $1 ${lock ? "FOR UPDATE OF t" : ""}`, [id],
  );
  if (!result.rows[0]) throw new ApiError(404, "Task not found");
  return result.rows[0];
}

async function categoryExists(client: Pool | PoolClient, id: string | null): Promise<void> {
  if (!id) return;
  const result = await client.query("SELECT 1 FROM categories WHERE id = $1", [id]);
  if (!result.rowCount) throw new ApiError(404, "Category not found");
}

async function dayState(client: Pool | PoolClient): Promise<{ baseline: DayHours; versions: DayVersion[] }> {
  const [current, versions] = await Promise.all([
    client.query<DayHours>("SELECT start_time, end_time FROM day_settings WHERE id = 1"),
    client.query<DayVersion>(
      "SELECT effective_date::text AS effective_date, start_time, end_time FROM day_settings_versions ORDER BY effective_date",
    ),
  ]);
  return { baseline: current.rows[0] ?? DEFAULT_HOURS, versions: versions.rows };
}

async function timeData(client: Pool | PoolClient) {
  const [tasks, intervals] = await Promise.all([
    client.query<TaskRow>(TASK_SELECT),
    client.query<IntervalRow>("SELECT task_id, started_at, ended_at, duration_seconds FROM task_intervals"),
  ]);
  return { tasks: tasks.rows, intervals: intervals.rows };
}

async function resetsFor(client: Pool | PoolClient, zone: string): Promise<ResetRow[]> {
  const result = await client.query<ResetRow>(
    "SELECT day::text AS day, timezone_name, reset_at FROM daily_resets WHERE timezone_name = $1",
    [zone],
  );
  return result.rows;
}

async function settingsResponse(zone: string) {
  const state = await dayState(await db());
  const today = currentDay(new Date(), zone, state.baseline, state.versions);
  const active = settingsForDay(today, state.baseline, state.versions);
  const pending = state.versions.find((version) => version.effective_date > today);
  const shown = pending ?? active;
  return {
    start_time: shown.start_time,
    end_time: shown.end_time,
    active_start_time: active.start_time,
    active_end_time: active.end_time,
    effective_date: pending?.effective_date ?? null,
  };
}

async function saveSettings(request: Request): Promise<Response> {
  const zone = timeZone(request);
  const payload = await body(request);
  const start = timeField(payload.start_time, "Start time");
  const end = timeField(payload.end_time, "End time");
  const startOn = payload.start_on ?? "next_day";
  if (startOn !== "today" && startOn !== "next_day") {
    throw new ApiError(422, "Apply from must be today or next_day");
  }
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stopwatch_day_settings'))");
    const { baseline, versions } = await dayState(client);
    const today = currentDay(new Date(), zone, baseline, versions);
    const effective = startOn === "today" ? today : addDays(today, 1);
    if (!versions.length) {
      await client.query(
        "INSERT INTO day_settings_versions (effective_date, start_time, end_time) VALUES ($1, $2, $3)",
        ["0001-01-01", baseline.start_time, baseline.end_time],
      );
    }
    await client.query("DELETE FROM day_settings_versions WHERE effective_date >= $1", [effective]);
    await client.query(
      "INSERT INTO day_settings_versions (effective_date, start_time, end_time) VALUES ($1, $2, $3)",
      [effective, start, end],
    );
    await client.query(`
      INSERT INTO day_settings (id, start_time, end_time) VALUES (1, $1, $2)
      ON CONFLICT (id) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
    `, [start, end]);
  });
  return json(await settingsResponse(zone));
}

async function dailyTotal(request: Request): Promise<Response> {
  const zone = timeZone(request);
  const database = await db();
  const [{ baseline, versions }, { tasks, intervals }, resets] = await Promise.all([
    dayState(database), timeData(database), resetsFor(database, zone),
  ]);
  const now = new Date();
  const day = currentDay(now, zone, baseline, versions);
  const entries = dailyBreakdowns(tasks, intervals, now, zone, [day], baseline, versions, resets)[0].entries;
  return json({ date: day, total_seconds: entries.reduce((sum, item) => sum + item.seconds, 0) });
}

async function resetDailyTotal(request: Request): Promise<Response> {
  const zone = timeZone(request);
  const database = await db();
  const { baseline, versions } = await dayState(database);
  const now = new Date();
  const day = currentDay(now, zone, baseline, versions);
  await database.query(`
    INSERT INTO daily_resets (id, day, timezone_name, reset_at) VALUES ($1, $2, $3, $4)
    ON CONFLICT (day, timezone_name) DO UPDATE SET reset_at = EXCLUDED.reset_at
  `, [randomUUID(), day, zone, now]);
  return json({ date: day, total_seconds: 0 });
}

async function history(request: Request): Promise<Response> {
  const zone = timeZone(request);
  const params = new URL(request.url).searchParams;
  const period = params.get("period");
  if (period !== "week" && period !== "month") throw new ApiError(422, "Period must be week or month");
  const database = await db();
  const [{ baseline, versions }, { tasks, intervals }, resets] = await Promise.all([
    dayState(database), timeData(database), resetsFor(database, zone),
  ]);
  const now = new Date();
  const today = currentDay(now, zone, baseline, versions);
  const anchorText = params.get("anchor_date") ?? today;
  let anchor: Temporal.PlainDate;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorText)) throw new RangeError();
    anchor = Temporal.PlainDate.from(anchorText);
  } catch {
    throw new ApiError(422, "Invalid anchor date");
  }
  const start = period === "week"
    ? anchor.subtract({ days: anchor.dayOfWeek - 1 })
    : anchor.with({ day: 1 });
  const end = period === "week"
    ? start.add({ days: 6 })
    : start.with({ day: start.daysInMonth });
  const days: string[] = [];
  for (let day = start.toString(); day <= end.toString() && day <= today; day = addDays(day, 1)) {
    days.push(day);
  }
  const breakdowns = dailyBreakdowns(tasks, intervals, now, zone, days, baseline, versions, resets);
  const responseDays = breakdowns.map(({ day, entries }) => {
    const hours = settingsForDay(day, baseline, versions);
    const items = entries.map(({ task, seconds }) => ({
      task_id: task.id,
      title: task.title,
      category_name: task.category_name ?? null,
      category_color: task.category_color ?? null,
      seconds,
    })).sort((a, b) => b.seconds - a.seconds);
    return {
      date: day,
      total_seconds: items.reduce((sum, item) => sum + item.seconds, 0),
      start_time: hours.start_time,
      end_time: hours.end_time,
      tasks: items,
    };
  });
  return json({
    period,
    start_date: start.toString(),
    end_date: end.toString(),
    total_seconds: responseDays.reduce((sum, day) => sum + day.total_seconds, 0),
    days: responseDays,
  });
}

async function createTask(request: Request): Promise<Response> {
  const payload = await body(request);
  const title = payload.title === null || payload.title === undefined
    ? "Untitled task" : textField(payload.title, "Title", 255).trim() || "Untitled task";
  const categoryId = payload.category_id === null || payload.category_id === undefined
    ? null : uuidField(payload.category_id, "Category ID");
  const database = await db();
  await categoryExists(database, categoryId);
  const now = new Date();
  const id = randomUUID();
  await database.query(`
    INSERT INTO tasks (id, title, category_id, status, started_at, segment_started_at)
    VALUES ($1, $2, $3, 'running', $4, $4)
  `, [id, title, categoryId, now]);
  return json(serialized(await taskById(database, id)), 201);
}

async function changeTask(id: string, action: "pause" | "resume" | "stop"): Promise<Response> {
  const updated = await transaction(async (client) => {
    const task = await taskById(client, id, true);
    const now = new Date();
    if (action === "pause") {
      if (task.status !== "running") throw new ApiError(400, `Cannot pause a task that is ${task.status}`);
      if (!task.segment_started_at) throw new ApiError(400, "Task has no active segment");
      const seconds = Math.max(0, Math.floor((now.getTime() - task.segment_started_at.getTime()) / 1000));
      await client.query(`
        INSERT INTO task_intervals (id, task_id, started_at, ended_at, duration_seconds)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), id, task.segment_started_at, now, seconds]);
      await client.query(`
        UPDATE tasks SET accumulated_seconds = accumulated_seconds + $1,
          segment_started_at = NULL, pause_started_at = $2, status = 'paused' WHERE id = $3
      `, [seconds, now, id]);
    } else if (action === "resume") {
      if (task.status !== "paused") throw new ApiError(400, `Cannot resume a task that is ${task.status}`);
      const paused = task.pause_started_at
        ? Math.max(0, Math.floor((now.getTime() - task.pause_started_at.getTime()) / 1000)) : 0;
      await client.query(`
        UPDATE tasks SET accumulated_paused_seconds = accumulated_paused_seconds + $1,
          pause_started_at = NULL, segment_started_at = $2, status = 'running' WHERE id = $3
      `, [paused, now, id]);
    } else {
      if (task.status === "completed") throw new ApiError(400, "Task is already completed");
      const duration = elapsedSeconds(task, now);
      if (task.status === "running" && task.segment_started_at) {
        const seconds = Math.max(0, Math.floor((now.getTime() - task.segment_started_at.getTime()) / 1000));
        await client.query(`
          INSERT INTO task_intervals (id, task_id, started_at, ended_at, duration_seconds)
          VALUES ($1, $2, $3, $4, $5)
        `, [randomUUID(), id, task.segment_started_at, now, seconds]);
      }
      const paused = task.status === "paused" && task.pause_started_at
        ? Math.max(0, Math.floor((now.getTime() - task.pause_started_at.getTime()) / 1000)) : 0;
      await client.query(`
        UPDATE tasks SET duration_seconds = $1, stopped_at = $2,
          segment_started_at = NULL, pause_started_at = NULL,
          accumulated_paused_seconds = accumulated_paused_seconds + $3,
          status = 'completed' WHERE id = $4
      `, [duration, now, paused, id]);
    }
    return taskById(client, id);
  });
  return json(serialized(updated));
}

async function updateTask(id: string, request: Request): Promise<Response> {
  const payload = await body(request);
  const updated = await transaction(async (client) => {
    const task = await taskById(client, id, true);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.title !== undefined && payload.title !== null) {
      const title = textField(payload.title, "Title", 255).trim();
      if (!title) throw new ApiError(400, "Task title cannot be empty");
      values.push(title);
      updates.push(`title = $${values.length}`);
    }
    if (Object.hasOwn(payload, "category_id")) {
      const categoryId = payload.category_id === null ? null : uuidField(payload.category_id, "Category ID");
      await categoryExists(client, categoryId);
      values.push(categoryId);
      updates.push(`category_id = $${values.length}`);
    }
    if (Object.hasOwn(payload, "duration_seconds")) {
      if (task.status !== "completed") throw new ApiError(400, "Only completed tasks can have their time edited");
      const duration = payload.duration_seconds;
      if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 0 || duration > 2_147_483_647) {
        throw new ApiError(422, "Duration must be a nonnegative whole number of seconds");
      }
      values.push(duration);
      updates.push(`duration_seconds = $${values.length}`);
      values.push(task.duration_adjustment_seconds + duration - (task.duration_seconds ?? 0));
      updates.push(`duration_adjustment_seconds = $${values.length}`);
    }
    if (!updates.length) return task;
    values.push(id);
    await client.query(`UPDATE tasks SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
    return taskById(client, id);
  });
  return json(serialized(updated));
}

export async function handleTasks(method: string, segments: string[], request: Request): Promise<Response> {
  const [first, second] = segments;
  if (method === "GET" && segments.length === 0) {
    const result = await (await db()).query<TaskRow>(`${TASK_SELECT} ORDER BY t.started_at DESC`);
    return json(result.rows.map(serialized));
  }
  if (method === "POST" && segments.length === 0) return createTask(request);
  if (method === "GET" && first === "daily-total" && segments.length === 1) return dailyTotal(request);
  if (method === "POST" && first === "daily-total" && second === "reset" && segments.length === 2) {
    return resetDailyTotal(request);
  }
  if (method === "GET" && first === "day-settings" && segments.length === 1) {
    return json(await settingsResponse(timeZone(request)));
  }
  if (method === "PUT" && first === "day-settings" && segments.length === 1) return saveSettings(request);
  if (method === "GET" && first === "history" && segments.length === 1) return history(request);
  if (segments.length < 1 || segments.length > 2) throw new ApiError(404, "Not found");
  const id = uuidField(first, "Task ID");
  if (method === "PATCH" && segments.length === 2 && ["pause", "resume", "stop"].includes(second)) {
    return changeTask(id, second as "pause" | "resume" | "stop");
  }
  if (method === "PATCH" && segments.length === 1) return updateTask(id, request);
  if (method === "DELETE" && segments.length === 1) {
    const result = await (await db()).query("DELETE FROM tasks WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) throw new ApiError(404, "Task not found");
    return noContent();
  }
  throw new ApiError(404, "Not found");
}
