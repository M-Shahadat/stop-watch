"use client";

import { useEffect, useState } from "react";
import { api, type DaySettings } from "@/lib/api";

interface Props {
  onChange: () => void;
}

export default function DayControls({ onChange }: Props) {
  const [saved, setSaved] = useState<DaySettings | null>(null);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("00:00");
  const [startOn, setStartOn] = useState<"today" | "next_day">("next_day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getDaySettings().then((settings) => {
      if (!active) return;
      setSaved(settings);
      setStartTime(settings.start_time);
      setEndTime(settings.end_time);
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load day settings");
    });
    return () => { active = false; };
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const settings = await api.updateDaySettings({ start_time: startTime, end_time: endTime, start_on: startOn });
      setSaved(settings);
      setMessage(startOn === "today"
        ? "Day hours now apply to today. Earlier days kept their saved hours."
        : `Day hours saved for ${settings.effective_date}. Earlier days stay the same.`);
      setStartOn("next_day");
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save day hours");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm("Reset today's counted time to zero? This also updates Week and Month. Task timers will keep their full time.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.resetDailyTotal();
      setMessage("Today's counted time was reset. New time will count from now.");
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reset today's time");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="day-controls" aria-label="Today settings">
      <div className="day-controls__intro">
        <h2>Today settings</h2>
        <p>Choose which hours count toward Today, Week, and Month. Earlier days keep their saved hours.</p>
      </div>
      {saved && <p className="day-controls__status">
        Current hours: <strong>{saved.active_start_time}–{saved.active_end_time}</strong>
        {saved.effective_date && <> · Scheduled for {saved.effective_date}: <strong>{saved.start_time}–{saved.end_time}</strong></>}
      </p>}
      <form className="day-controls__form" onSubmit={save}>
        <label>Day starts
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required disabled={busy || !saved} />
        </label>
        <label>Day ends
          <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required disabled={busy || !saved} />
        </label>
        <label>Apply from
          <select value={startOn} onChange={(event) => setStartOn(event.target.value as "today" | "next_day")} disabled={busy || !saved}>
            <option value="next_day">Next tracking day</option>
            <option value="today">Today</option>
          </select>
        </label>
        <button className="day-controls__save" type="submit" disabled={busy || !saved}>
          Save hours
        </button>
      </form>
      <p className="day-controls__hint">Times use this device’s time zone. Same start and end means a full 24-hour day; an earlier end counts overnight. “Today” recalculates only the current tracking day.</p>
      <div className="day-controls__footer">
        <button className="day-controls__reset" type="button" onClick={reset} disabled={busy || !saved}>Reset today’s time</button>
        <span>Resets totals and history for today; task timers keep their full time.</span>
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {message && <p className="day-controls__message" role="status">{message}</p>}
    </section>
  );
}
