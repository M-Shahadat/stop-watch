"use client";

import { useEffect, useState } from "react";
import { api, DailyTotal } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface Props {
  refreshSignal: number; // bump to trigger a refresh
}

export default function DailyTotalBanner({ refreshSignal }: Props) {
  const [data, setData] = useState<DailyTotal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      api.getDailyTotal()
        .then((total) => { if (active) { setData(total); setError(null); } })
        .catch((error) => {
          if (active) setError(error instanceof Error ? error.message : "Could not load total");
        });
    };
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => { active = false; clearInterval(id); };
  }, [refreshSignal]);

  if (!data) return error ? <span className="error-msg" role="alert">{error}</span> : null;

  return (
    <div className="daily-total">
      <span className="daily-total__label">Today</span>
      <span className="daily-total__value">
        {formatDuration(data.total_seconds)}
      </span>
    </div>
  );
}
