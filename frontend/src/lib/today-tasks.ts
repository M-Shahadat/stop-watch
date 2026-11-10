import type { Task } from "./api";

function calendarDate(instant: Date, formatter: Intl.DateTimeFormat): string {
  let year = "";
  let month = "";
  let day = "";
  for (const part of formatter.formatToParts(instant)) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

export function selectTodayTasks(
  tasks: readonly Task[],
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): { active: Task[]; completed: Task[] } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = calendarDate(now, formatter);
  const active: Task[] = [];
  const completed: Task[] = [];

  for (const task of tasks) {
    if (task.status === "running" || task.status === "paused") {
      active.push(task);
    } else if (task.stopped_at && calendarDate(new Date(task.stopped_at), formatter) === today) {
      completed.push(task);
    }
  }

  return { active, completed };
}
