export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Returns a scale factor (1–3) used to grow the task card
 * the longer the task runs. Uses a log curve so differences
 * stay visually distinguishable without extremes.
 */
export function cardScale(seconds: number): number {
  if (seconds <= 0) return 1;
  // log2(seconds+1) / log2(7201) maps 0s→~0, 2h→1. Clamp to [0,1] then to [1,3].
  const ratio = Math.log2(seconds + 1) / Math.log2(7201);
  const clamped = Math.min(ratio, 1);
  return 1 + clamped * 2; // range [1, 3]
}
