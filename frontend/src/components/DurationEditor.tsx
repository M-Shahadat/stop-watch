"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/format";

const MAX_DURATION_SECONDS = 2_147_483_647;

interface Props {
  value: number;
  onChange: (seconds: number) => void;
  disabled: boolean;
}

export default function DurationEditor({ value, onChange, disabled }: Props) {
  const [adjustMinutes, setAdjustMinutes] = useState("5");
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  const step = Number(adjustMinutes);
  const validStep = Number.isSafeInteger(step) && step > 0;

  function changePart(part: "hours" | "minutes" | "seconds", raw: string) {
    const next = Number(raw);
    if (!Number.isSafeInteger(next) || next < 0) return;
    const parts = { hours, minutes, seconds, [part]: next };
    if (parts.minutes > 59 || parts.seconds > 59) return;
    const duration = parts.hours * 3600 + parts.minutes * 60 + parts.seconds;
    if (duration <= MAX_DURATION_SECONDS) onChange(duration);
  }

  function adjust(sign: 1 | -1) {
    if (!validStep) return;
    onChange(Math.max(0, value + sign * step * 60));
  }

  return (
    <div className="duration-editor">
      <span className="duration-editor__heading">Recorded time</span>
      <div className="duration-editor__fields" role="group" aria-label="Recorded time">
        <label>
          <span>Hours</span>
          <input type="number" min="0" inputMode="numeric" value={hours}
            onFocus={(event) => event.target.select()}
            onChange={(event) => changePart("hours", event.target.value)} disabled={disabled} />
        </label>
        <label>
          <span>Minutes</span>
          <input type="number" min="0" max="59" inputMode="numeric" value={minutes}
            onFocus={(event) => event.target.select()}
            onChange={(event) => changePart("minutes", event.target.value)} disabled={disabled} />
        </label>
        <label>
          <span>Seconds</span>
          <input type="number" min="0" max="59" inputMode="numeric" value={seconds}
            onFocus={(event) => event.target.select()}
            onChange={(event) => changePart("seconds", event.target.value)} disabled={disabled} />
        </label>
      </div>
      <div className="duration-editor__adjust">
        <label>
          <span>Adjust by</span>
          <span className="duration-editor__step">
            <input type="number" min="1" max={Math.floor(MAX_DURATION_SECONDS / 60)}
              step="1" inputMode="numeric" value={adjustMinutes}
              onChange={(event) => setAdjustMinutes(event.target.value)} disabled={disabled} />
            <span>min</span>
          </span>
        </label>
        <div className="duration-editor__buttons">
          <button type="button" className="btn" onClick={() => adjust(-1)}
            disabled={disabled || !validStep || value === 0}>− Subtract</button>
          <button type="button" className="btn btn--resume" onClick={() => adjust(1)}
            disabled={disabled || !validStep || value + step * 60 > MAX_DURATION_SECONDS}>+ Add</button>
        </div>
      </div>
      <span className="duration-editor__result">New total: {formatDuration(value)}</span>
    </div>
  );
}
