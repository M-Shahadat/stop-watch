"use client";

import { useEffect, useState } from "react";
import CategoryBadge from "./CategoryBadge";
import { api, type HistoryPeriod, type TaskHistory } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface Props {
  period: HistoryPeriod;
  refreshSignal: number;
}

function localDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftPeriod(value: string, period: HistoryPeriod, direction: number): string {
  const date = localDate(value);
  if (period === "week") {
    date.setDate(date.getDate() + direction * 7);
  } else {
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
  }
  return localDateString(date);
}

function dayLabel(value: string): string {
  return localDate(value).toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
}

function periodLabel(history: TaskHistory): string {
  if (history.period === "month") {
    return localDate(history.start_date).toLocaleDateString(undefined, {
      month: "long", year: "numeric",
    });
  }
  const start = localDate(history.start_date).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
  const end = localDate(history.end_date).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  return `${start} – ${end}`;
}

export default function HistoryView({ period, refreshSignal }: Props) {
  const [anchorDate, setAnchorDate] = useState(() => localDateString(new Date()));
  const [expandedDate, setExpandedDate] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return localDateString(yesterday);
  });
  const [data, setData] = useState<TaskHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      api.getTaskHistory(period, anchorDate)
        .then((history) => {
          if (active) { setData(history); setError(null); setLoading(false); }
        })
        .catch((failure) => {
          if (active) {
            setError(failure instanceof Error ? failure.message : "Could not load history");
            setLoading(false);
          }
        });
    };
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(id); };
  }, [period, anchorDate, refreshSignal, retryKey]);

  const navigate = (direction: number) => {
    setData(null);
    setLoading(true);
    setError(null);
    setAnchorDate((current) => shiftPeriod(current, period, direction));
  };

  const showYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = localDateString(yesterday);
    setExpandedDate(date);
    if (anchorDate !== date) {
      setData(null);
      setLoading(true);
      setError(null);
      setAnchorDate(date);
    }
  };

  const today = localDateString(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = localDateString(yesterday);

  return (
    <section className="history-view" aria-label={`${period === "week" ? "Weekly" : "Monthly"} history`}>
      <div className="history-heading">
        <div>
          <h2>{period === "week" ? "Weekly history" : "Monthly history"}</h2>
          <p>Time spent running, grouped by your local day.</p>
        </div>
        <button className="history-yesterday" type="button" onClick={showYesterday}>View yesterday</button>
      </div>

      <div className="history-navigation">
        <button type="button" onClick={() => navigate(-1)} aria-label={`Previous ${period}`}>
          ←
        </button>
        <span className="history-navigation__label">{data ? periodLabel(data) : "Loading…"}</span>
        <button type="button" onClick={() => navigate(1)} disabled={!data || data.end_date >= today}
          aria-label={`Next ${period}`}>
          →
        </button>
      </div>

      {error && <p className="error-msg" role="alert">
        {error} <button className="history-retry" type="button" onClick={() => {
          setLoading(true);
          setError(null);
          setRetryKey((current) => current + 1);
        }}>Retry</button>
      </p>}
      {loading && !data && <p className="loading">Loading history…</p>}
      {data && <>
        <div className="history-summary">
          <span>{period === "week" ? "Week total" : "Month total"}</span>
          <strong>{formatDuration(data.total_seconds)}</strong>
        </div>
        <div className="history-days">
          {[...data.days].filter((day) => day.date <= today).reverse().map((day) => {
            const expanded = expandedDate === day.date;
            const relative = day.date === today ? "Today" : day.date === yesterdayDate ? "Yesterday" : null;
            return (
              <article className={`history-day${day.total_seconds === 0 ? " history-day--empty" : ""}`} key={day.date}>
                <button className="history-day__toggle" type="button" aria-expanded={expanded}
                  onClick={() => setExpandedDate(expanded ? "" : day.date)}>
                  <span className="history-day__date">
                    <span>{dayLabel(day.date)}</span>
                    {relative && <small>{relative}</small>}
                  </span>
                  <span className="history-day__total">{formatDuration(day.total_seconds)}</span>
                  <span className="history-day__chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
                </button>
                {expanded && <div className="history-day__content">
                  {day.tasks.length === 0 ? <p>No tracked time this day.</p> : (
                    <ul className="history-task-list">
                      {day.tasks.map((task) => <li className="history-task" key={task.task_id}>
                        <span className="history-task__name">
                          <span>{task.title}</span>
                          {task.category_name && task.category_color &&
                            <CategoryBadge name={task.category_name} color={task.category_color} small />}
                        </span>
                        <strong>{formatDuration(task.seconds)}</strong>
                      </li>)}
                    </ul>
                  )}
                </div>}
              </article>
            );
          })}
        </div>
      </>}
    </section>
  );
}
