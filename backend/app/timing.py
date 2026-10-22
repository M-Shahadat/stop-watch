"""Elapsed time and local-day totals shared by the task endpoints."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .models import DailyReset, DaySettings, DaySettingsVersion, Task, TaskInterval

DayHours = DaySettings | DaySettingsVersion


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


def settings_for_day(
    day: date, settings: DaySettings | None = None,
    versions: list[DaySettingsVersion] | None = None,
) -> DayHours | None:
    """Use the newest saved hours that were in effect for this day."""
    for version in sorted(versions or [], key=lambda item: item.effective_date, reverse=True):
        if version.effective_date <= day:
            return version
    return settings


def day_window(day: date, zone: ZoneInfo, settings: DayHours | None = None) -> tuple[datetime, datetime]:
    start = time.fromisoformat(settings.start_time) if settings else time.min
    end = time.fromisoformat(settings.end_time) if settings else time.min
    end_day = day + timedelta(days=1) if end <= start else day
    return (
        datetime.combine(day, start, tzinfo=zone).astimezone(timezone.utc),
        datetime.combine(end_day, end, tzinfo=zone).astimezone(timezone.utc),
    )


def scheduled_day_window(
    day: date, zone: ZoneInfo, settings: DaySettings | None = None,
    versions: list[DaySettingsVersion] | None = None,
) -> tuple[datetime, datetime]:
    """Avoid counting an overlap twice when hours change between days."""
    start, end = day_window(day, zone, settings_for_day(day, settings, versions))
    if day > date.min:
        _, previous_end = day_window(
            day - timedelta(days=1), zone,
            settings_for_day(day - timedelta(days=1), settings, versions),
        )
        start = max(start, previous_end)
    return start, end


def day_label(
    now: datetime, zone: ZoneInfo, settings: DaySettings | None = None,
    versions: list[DaySettingsVersion] | None = None,
) -> date:
    """Keep an overnight tracking day active until its saved end time."""
    local_day = utc(now).astimezone(zone).date()
    if local_day > date.min:
        previous = local_day - timedelta(days=1)
        start, end = scheduled_day_window(previous, zone, settings, versions)
        if start <= utc(now) < end:
            return previous
    return local_day


def _task_seconds_on_day(
    task: Task, recorded: list[TaskInterval], now: datetime, day: date, zone: ZoneInfo,
    settings: DaySettings | None = None, reset_at: datetime | None = None,
    window: tuple[datetime, datetime] | None = None,
) -> int:
    window_start, day_end = window or day_window(day, zone, settings)
    day_start = max(window_start, utc(reset_at)) if reset_at else window_start

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
    if window_start <= utc(task.started_at) < day_end and utc(task.started_at) >= day_start:
        task_total += historical_seconds

    if task.status == "completed" and task.stopped_at and adjustment:
        stopped = utc(task.stopped_at)
        if adjustment > 0 and day_start <= stopped < day_end:
            task_total += adjustment
        elif adjustment < 0 and window_start <= stopped and (not reset_at or stopped >= day_start):
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
    timezone_name: str, days: list[date], settings: DaySettings | None = None,
    resets: list[DailyReset] | None = None,
    versions: list[DaySettingsVersion] | None = None,
) -> list[tuple[date, list[tuple[Task, int]]]]:
    """Return each task's active seconds for each configured local day."""
    zone = ZoneInfo(timezone_name)
    reset_by_day = {item.day: item.reset_at for item in resets or [] if item.timezone_name == timezone_name}
    intervals_by_task: dict[object, list[TaskInterval]] = {}
    for interval in intervals:
        intervals_by_task.setdefault(interval.task_id, []).append(interval)

    result = []
    for day in days:
        window = scheduled_day_window(day, zone, settings, versions)
        entries = []
        for task in tasks:
            seconds = _task_seconds_on_day(
                task, intervals_by_task.get(task.id, []), now, day, zone,
                settings, reset_by_day.get(day), window,
            )
            if seconds > 0:
                entries.append((task, seconds))
        result.append((day, entries))
    return result


def daily_total_seconds(
    tasks: list[Task], intervals: list[TaskInterval], now: datetime, timezone_name: str,
    settings: DaySettings | None = None, resets: list[DailyReset] | None = None,
    versions: list[DaySettingsVersion] | None = None,
) -> tuple[str, int]:
    day = day_label(now, ZoneInfo(timezone_name), settings, versions)
    breakdown = daily_task_breakdowns(
        tasks, intervals, now, timezone_name, [day], settings, resets, versions
    )[0][1]
    return day.isoformat(), sum(seconds for _, seconds in breakdown)
