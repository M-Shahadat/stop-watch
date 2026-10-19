"use client";

import { useEffect, useState } from "react";
import { type CategoryStats, api } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface Props {
  refreshSignal: number;
}

export default function CategoryStats({ refreshSignal }: Props) {
  const [data, setData] = useState<CategoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      api.getCategoryStats()
        .then((stats) => { if (active) { setData(stats); setError(null); } })
        .catch((error) => {
          if (active) setError(error instanceof Error ? error.message : "Could not load stats");
        })
        .finally(() => { if (active) setLoading(false); });
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [refreshSignal]);

  if (loading) return <p className="loading">Loading stats…</p>;
  if (error) return <p className="error-msg" role="alert">{error}</p>;
  if (!data || data.items.length === 0) {
    return <p className="empty-state">No tasks yet — start your first one on the Tasks tab.</p>;
  }

  return (
    <div className="cat-stats">
      <table className="cat-stats__table">
        <thead>
          <tr>
            <th className="cat-stats__th">Category</th>
            <th className="cat-stats__th cat-stats__th--num">Active time</th>
            <th className="cat-stats__th cat-stats__th--num">Paused time</th>
            <th className="cat-stats__th cat-stats__th--num">Tasks</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.category_id ?? "uncategorized"} className="cat-stats__row">
              <td className="cat-stats__td" data-label="Category">
                <span className="cat-stats__dot" style={{ background: item.category_color }} />
                <span className="cat-stats__name">{item.category_name}</span>
              </td>
              <td className="cat-stats__td cat-stats__td--num" data-label="Active time">
                {formatDuration(item.total_active_seconds)}
              </td>
              <td className="cat-stats__td cat-stats__td--num cat-stats__td--paused" data-label="Paused time">
                {formatDuration(item.total_paused_seconds)}
              </td>
              <td className="cat-stats__td cat-stats__td--num" data-label="Tasks">{item.task_count}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="cat-stats__total-row">
            <td className="cat-stats__td cat-stats__td--total" data-label="Category">Total</td>
            <td className="cat-stats__td cat-stats__td--num cat-stats__td--total" data-label="Active time">
              {formatDuration(data.grand_total_active_seconds)}
            </td>
            <td className="cat-stats__td cat-stats__td--num cat-stats__td--total cat-stats__td--paused" data-label="Paused time">
              {formatDuration(data.grand_total_paused_seconds)}
            </td>
            <td className="cat-stats__td cat-stats__td--num cat-stats__td--total" data-label="Tasks">
              {data.items.reduce((s, i) => s + i.task_count, 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
