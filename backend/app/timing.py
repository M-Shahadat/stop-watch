"""Elapsed time and local-day totals shared by the task endpoints."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .models import Task, TaskInterval


def utc(value: datetime) -> datetime:
    """Treat naive database timestamps as UTC (used by SQLite in local tests)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def elapsed_seconds(task: Task, now: datetime) -> int:
    if task.duration_seconds is not None:
        return task.duration_seconds
    if task.status == "running" and task.segment_started_at:
        return task.accumulated_seconds + max(
            0, int((now - utc(task.segment_started_at)).total_seconds())
        )
    return task.accumulated_seconds


def paused_seconds(task: Task, now: datetime) -> int:
    if task.status == "paused" and task.pause_started_at:
        return (task.accumulated_paused_seconds or 0) + max(
            0, int((now - utc(task.pause_started_at)).total_seconds())
        )
    return task.accumulated_paused_seconds or 0


def overlap_seconds(start: datetime, end: datetime, day_start: datetime, day_end: datetime) -> int:
    return max(0, int((min(utc(end), day_end) - max(utc(start), day_start)).total_seconds()))


def _task_seconds_on_day(
    task: Task, recorded: list[TaskInterval], now: datetime, day: date, zone: ZoneInfo
) -> int:
    day_start_local = datetime.combine(day, time.min, tzinfo=zone)
    day_end_local = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone)
    day_start = day_start_local.astimezone(timezone.utc)
    day_end = day_end_local.astimezone(timezone.utc)

    task_total = sum(
        overlap_seconds(item.started_at, item.ended_at, day_start, day_end)
        for item in recorded
    )
    current_seconds = 0
    if task.status == "running" and task.segment_started_at:
        current_seconds = max(0, int((now - utc(task.segment_started_at)).total_seconds()))
        task_total += overlap_seconds(task.segment_started_at, now, day_start, day_end)

    # Older tasks predate interval recording. Their previous active time can
    # only be assigned to their start date, because pause history is unknown.
    recorded_seconds = sum(item.duration_seconds for item in recorded)
    adjustment = getattr(task, "duration_adjustment_seconds", 0) or 0
    historical_seconds = max(
        0, elapsed_seconds(task, now) - adjustment - recorded_seconds - current_seconds
    )
    if utc(task.started_at).astimezone(zone).date() == day:
        task_total += historical_seconds

    if task.status == "completed" and task.stopped_at and adjustment:
        stopped_day = utc(task.stopped_at).astimezone(zone).date()
        if adjustment > 0 and stopped_day == day:
            task_total += adjustment
        elif adjustment < 0 and day <= stopped_day:
            # Remove time from the latest recorded day first, then carry
            # any remaining subtraction into earlier days.
            later_seconds = sum(
                overlap_seconds(item.started_at, item.ended_at, day_end, utc(task.stopped_at))
                for item in recorded
            )
            task_total = max(0, task_total - max(0, -adjustment - later_seconds))

    return task_total


def daily_task_breakdowns(
    tasks: list[Task], intervals: list[TaskInterval], now: datetime,
    timezone_name: str, days: list[date],
) -> list[tuple[date, list[tuple[Task, int]]]]:
    """Return each task's active seconds for each requested local calendar day."""
    zone = ZoneInfo(timezone_name)
    intervals_by_task: dict[object, list[TaskInterval]] = {}
    for interval in intervals:
        intervals_by_task.setdefault(interval.task_id, []).append(interval)

    result = []
    for day in days:
        entries = []
        for task in tasks:
            seconds = _task_seconds_on_day(
                task, intervals_by_task.get(task.id, []), now, day, zone
            )
            if seconds > 0:
                entries.append((task, seconds))
        result.append((day, entries))
    return result


def daily_total_seconds(
    tasks: list[Task], intervals: list[TaskInterval], now: datetime, timezone_name: str
) -> tuple[str, int]:
    day = now.astimezone(ZoneInfo(timezone_name)).date()
    breakdown = daily_task_breakdowns(tasks, intervals, now, timezone_name, [day])[0][1]
    return day.isoformat(), sum(seconds for _, seconds in breakdown)
