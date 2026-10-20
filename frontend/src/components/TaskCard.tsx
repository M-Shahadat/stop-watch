"use client";

import { useEffect, useState } from "react";
import { Task, Category, api } from "@/lib/api";
import { cardScale, formatDuration, formatTime } from "@/lib/format";
import CategoryBadge from "./CategoryBadge";
import DurationEditor from "./DurationEditor";

interface Props {
  task: Task;
  categories: Category[];
  viewMode?: "grid" | "list";
  onChange: () => void;
}

function elapsedAt(task: Task, now: number): number {
  if (task.duration_seconds !== null) return task.duration_seconds;
  if (task.status === "running" && task.segment_started_at) {
    return (
      task.accumulated_seconds +
      Math.max(0, Math.floor((now - new Date(task.segment_started_at).getTime()) / 1000))
    );
  }
  return task.accumulated_seconds;
}

export default function TaskCard({ task, categories, viewMode = "grid", onChange }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editCategoryId, setEditCategoryId] = useState(task.category_id ?? "");
  const [editDurationSeconds, setEditDurationSeconds] = useState(task.duration_seconds ?? 0);

  useEffect(() => {
    if (task.status !== "running" || !task.segment_started_at) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const syncTimer = () => {
      if (document.visibilityState === "hidden") {
        if (id) clearInterval(id);
        id = undefined;
        return;
      }
      setNow(Date.now());
      if (!id) id = setInterval(() => setNow(Date.now()), 1000);
    };
    syncTimer();
    document.addEventListener("visibilitychange", syncTimer);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", syncTimer);
    };
  }, [task.status, task.segment_started_at]);

  const elapsed = elapsedAt(task, now);

  async function handle(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    const title = editTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateTask(task.id, {
        title,
        category_id: editCategoryId || null,
        ...(task.status === "completed" ? { duration_seconds: editDurationSeconds } : {}),
      });
      setEditing(false);
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save task");
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    setEditTitle(task.title);
    setEditCategoryId(task.category_id ?? "");
    setEditDurationSeconds(task.duration_seconds ?? 0);
    setEditing(true);
  }

  const scale = cardScale(elapsed);
  const minHeight = Math.round(88 + (scale - 1) * 66);
  const { status } = task;
  const isList = viewMode === "list" && !editing;

  return (
    <div
      className={`task-card task-card--${status}${isList ? " task-card--list" : ""}`}
      style={isList ? undefined : { minHeight }}
    >
      <div className="task-card__header">
        {editing ? (
          <input
            className="task-card__title-input"
            maxLength={255}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
          />
        ) : (
          <span className="task-card__title">{task.title}</span>
        )}
        <div className="task-card__header-right">
          {status === "running" && <span className="task-card__badge task-card__badge--running">Live</span>}
          {status === "paused"  && <span className="task-card__badge task-card__badge--paused">Paused</span>}
          {!editing && (
            <button className="task-card__edit-btn" aria-label={`Edit ${task.title}`} onClick={openEdit} disabled={busy}>✏️</button>
          )}
        </div>
      </div>

      {editing && (
        <select
          className="cat-select cat-select--card"
          value={editCategoryId}
          onChange={(e) => setEditCategoryId(e.target.value)}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {!editing && task.category_name && (
        <div className="task-card__category">
          <CategoryBadge name={task.category_name} color={task.category_color!} small />
        </div>
      )}

      {editing && status === "completed" ? (
        <DurationEditor
          value={editDurationSeconds}
          onChange={setEditDurationSeconds}
          disabled={busy}
        />
      ) : (
        <div className="task-card__duration">{formatDuration(elapsed)}</div>
      )}

      <div className="task-card__meta">
        Started {formatTime(task.started_at)}
        {task.stopped_at && ` · Ended ${formatTime(task.stopped_at)}`}
        {task.accumulated_paused_seconds > 0 && (
          <span className="task-card__paused-time"> · {formatDuration(task.accumulated_paused_seconds)} paused</span>
        )}
      </div>

      <div className="task-card__actions">
        {editing ? (
          <>
            <button className="btn btn--resume" disabled={busy || !editTitle.trim()} onClick={handleSaveEdit}>Save</button>
            <button className="btn" style={{ borderColor: "var(--border)" }} onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            {status === "running" && (
              <button className="btn btn--pause" disabled={busy} onClick={() => handle(() => api.pauseTask(task.id))}>
                ⏸ Pause
              </button>
            )}
            {status === "paused" && (
              <button className="btn btn--resume" disabled={busy} onClick={() => handle(() => api.resumeTask(task.id))}>
                ▶ Resume
              </button>
            )}
            {(status === "running" || status === "paused") && (
              <button className="btn btn--stop" disabled={busy} onClick={() => handle(() => api.stopTask(task.id))}>
                ■ Stop
              </button>
            )}
            <button className="btn btn--delete" aria-label={`Delete ${task.title}`} disabled={busy} onClick={() => handle(() => api.deleteTask(task.id))}>
              🗑
            </button>
          </>
        )}
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  );
}
