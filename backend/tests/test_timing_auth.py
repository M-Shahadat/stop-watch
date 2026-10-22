import os
import sys
import unittest
import uuid
from datetime import date, datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from fastapi import HTTPException, Response  # noqa: E402
from app.auth import LoginRequest, authenticated, login  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import DailyReset, DaySettings, DaySettingsVersion, Task, TaskInterval  # noqa: E402
from app.routers.categories import category_stats  # noqa: E402
from app.routers.tasks import (  # noqa: E402
    daily_total, get_day_settings, reset_daily_total, task_history,
    update_day_settings, update_task,
)
from app.schemas import DaySettingsPayload, TaskUpdate  # noqa: E402
from app.timing import daily_task_breakdowns, daily_total_seconds, elapsed_seconds  # noqa: E402


def moment(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def task(started: str, *, status="completed", accumulated=0, duration=None,
         segment=None, stopped=None, adjustment=0):
    return SimpleNamespace(
        id=uuid.uuid4(),
        started_at=moment(started),
        status=status,
        accumulated_seconds=accumulated,
        duration_seconds=duration,
        segment_started_at=moment(segment) if segment else None,
        stopped_at=moment(stopped) if stopped else None,
        duration_adjustment_seconds=adjustment,
    )


def interval(item, started: str, ended: str):
    start, end = moment(started), moment(ended)
    return SimpleNamespace(
        task_id=item.id,
        started_at=start,
        ended_at=end,
        duration_seconds=int((end - start).total_seconds()),
    )


class TimingTests(unittest.TestCase):
    def test_overnight_schedule_change_does_not_count_overlap_twice(self):
        item = task("2026-10-20T00:00:00+00:00", duration=28800)
        segment = interval(item, "2026-10-20T00:00:00+00:00", "2026-10-20T08:00:00+00:00")
        old = DaySettings(start_time="22:00", end_time="06:00")
        versions = [DaySettingsVersion(
            effective_date=date(2026, 10, 20), start_time="00:00", end_time="00:00"
        )]
        breakdowns = daily_task_breakdowns(
            [item], [segment], moment("2026-10-20T08:00:00+00:00"), "UTC",
            [date(2026, 10, 19), date(2026, 10, 20)], old, versions=versions,
        )
        self.assertEqual([entries[0][1] for _, entries in breakdowns], [21600, 7200])
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-20T02:00:00+00:00"),
                                "UTC", old, versions=versions)[0],
            "2026-10-19",
        )

    def test_day_hours_include_only_selected_window(self):
        item = task("2026-10-18T08:00:00+00:00", duration=14400)
        segment = interval(item, "2026-10-18T08:00:00+00:00", "2026-10-18T12:00:00+00:00")
        settings = DaySettings(start_time="09:00", end_time="11:00")
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-18T12:00:00+00:00"), "UTC", settings),
            ("2026-10-18", 7200),
        )

    def test_overnight_hours_belong_to_start_date(self):
        item = task("2026-10-18T21:00:00+00:00", duration=10800)
        segment = interval(item, "2026-10-18T21:00:00+00:00", "2026-10-19T00:00:00+00:00")
        settings = DaySettings(start_time="22:00", end_time="02:00")
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-19T00:00:00+00:00"), "UTC", settings),
            ("2026-10-18", 7200),
        )

    def test_reset_hides_prior_time_and_counts_new_time(self):
        item = task("2026-10-18T09:00:00+00:00", status="running",
                    accumulated=3600, segment="2026-10-18T11:00:00+00:00")
        segment = interval(item, "2026-10-18T09:00:00+00:00", "2026-10-18T10:00:00+00:00")
        reset = DailyReset(day=date(2026, 10, 18), timezone_name="UTC",
                           reset_at=moment("2026-10-18T11:30:00+00:00"))
        now = moment("2026-10-18T12:00:00+00:00")
        self.assertEqual(daily_total_seconds([item], [segment], now, "UTC", resets=[reset]),
                         ("2026-10-18", 1800))
        self.assertEqual(daily_task_breakdowns([item], [segment], now, "UTC", [date(2026, 10, 18)],
                                               resets=[reset])[0][1][0][1], 1800)

    def test_running_segment_only_counts_time_after_local_midnight(self):
        item = task("2026-10-17T17:50:00+00:00", status="running",
                    segment="2026-10-17T17:50:00+00:00")
        day, total = daily_total_seconds(
            [item], [], moment("2026-10-17T18:10:00+00:00"), "Asia/Dhaka"
        )
        self.assertEqual((day, total), ("2026-10-18", 600))
        self.assertEqual(elapsed_seconds(item, moment("2026-10-17T18:10:00+00:00")), 1200)

    def test_completed_intervals_count_only_their_overlap(self):
        item = task("2026-10-17T17:50:00+00:00", accumulated=600, duration=600)
        segments = [
            interval(item, "2026-10-17T17:50:00+00:00", "2026-10-17T17:55:00+00:00"),
            interval(item, "2026-10-17T18:05:00+00:00", "2026-10-17T18:10:00+00:00"),
        ]
        self.assertEqual(
            daily_total_seconds([item], segments, moment("2026-10-17T18:20:00+00:00"), "Asia/Dhaka"),
            ("2026-10-18", 300),
        )

    def test_legacy_time_remains_visible_on_start_date(self):
        item = task("2026-10-18T08:00:00+00:00", accumulated=1200, duration=1200)
        self.assertEqual(
            daily_total_seconds([item], [], moment("2026-10-18T12:00:00+00:00"), "UTC"),
            ("2026-10-18", 1200),
        )

    def test_daylight_saving_day_uses_timezone_boundary(self):
        item = task("2026-11-01T04:30:00+00:00", duration=10800)
        segment = interval(item, "2026-11-01T04:30:00+00:00", "2026-11-01T07:30:00+00:00")
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-11-01T08:00:00+00:00"), "America/New_York"),
            ("2026-11-01", 10800),
        )

    def test_edited_duration_changes_daily_total(self):
        item = task("2026-10-18T08:00:00+00:00", duration=300,
                    stopped="2026-10-18T08:10:00+00:00", adjustment=-300)
        segment = interval(item, "2026-10-18T08:00:00+00:00", "2026-10-18T08:10:00+00:00")
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-18T09:00:00+00:00"), "UTC"),
            ("2026-10-18", 300),
        )
        item.duration_seconds = 900
        item.duration_adjustment_seconds = 300
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-18T09:00:00+00:00"), "UTC"),
            ("2026-10-18", 900),
        )

    def test_subtraction_cannot_make_daily_total_negative(self):
        item = task("2026-10-17T23:50:00+00:00", duration=100,
                    stopped="2026-10-18T00:10:00+00:00", adjustment=-1100)
        segment = interval(item, "2026-10-17T23:50:00+00:00", "2026-10-18T00:10:00+00:00")
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-18T09:00:00+00:00"), "UTC"),
            ("2026-10-18", 0),
        )
        self.assertEqual(
            daily_total_seconds([item], [segment], moment("2026-10-17T23:55:00+00:00"), "UTC"),
            ("2026-10-17", 100),
        )


class TaskEditTests(unittest.TestCase):
    def test_applying_hours_today_changes_only_current_and_later_days(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add(DaySettings(id=1, start_time="09:00", end_time="17:00"))
            item = Task(title="Evening work", status="completed",
                        started_at=moment("2026-10-19T18:00:00+00:00"),
                        segment_started_at=None,
                        stopped_at=moment("2026-10-20T19:00:00+00:00"),
                        accumulated_seconds=7200, duration_seconds=7200)
            db.add(item)
            db.flush()
            for day in (19, 20):
                db.add(TaskInterval(
                    task_id=item.id,
                    started_at=moment(f"2026-10-{day}T18:00:00+00:00"),
                    ended_at=moment(f"2026-10-{day}T19:00:00+00:00"),
                    duration_seconds=3600,
                ))
            db.commit()

            with patch("app.routers.tasks.datetime") as clock:
                clock.now.return_value = moment("2026-10-20T12:00:00+00:00")
                update_day_settings(DaySettingsPayload(
                    start_time="08:00", end_time="20:00", start_on="today"
                ), db)
                clock.now.return_value = moment("2026-10-21T12:00:00+00:00")
                week = task_history("week", "UTC", date(2026, 10, 20), db)
                totals = {day.date: day.total_seconds for day in week.days}
                self.assertEqual((totals["2026-10-19"], totals["2026-10-20"]), (0, 3600))
                self.assertEqual([(day.start_time, day.end_time) for day in week.days
                                  if day.date in ("2026-10-19", "2026-10-20")],
                                 [("09:00", "17:00"), ("08:00", "20:00")])

    def test_dated_hours_keep_earlier_history_and_replace_pending_change(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add(DaySettings(id=1, start_time="09:00", end_time="17:00"))
            item = Task(title="Split work", status="completed",
                        started_at=moment("2026-10-19T10:00:00+00:00"),
                        segment_started_at=None,
                        stopped_at=moment("2026-10-21T19:00:00+00:00"),
                        accumulated_seconds=14400, duration_seconds=14400)
            db.add(item)
            db.flush()
            for start, end in [
                ("2026-10-19T10:00:00+00:00", "2026-10-19T11:00:00+00:00"),
                ("2026-10-19T18:00:00+00:00", "2026-10-19T19:00:00+00:00"),
                ("2026-10-20T18:00:00+00:00", "2026-10-20T19:00:00+00:00"),
                ("2026-10-21T18:00:00+00:00", "2026-10-21T19:00:00+00:00"),
            ]:
                db.add(TaskInterval(task_id=item.id, started_at=moment(start),
                                    ended_at=moment(end), duration_seconds=3600))
            db.commit()

            with patch("app.routers.tasks.datetime") as clock:
                clock.now.return_value = moment("2026-10-20T12:00:00+00:00")
                scheduled = update_day_settings(
                    DaySettingsPayload(start_time="08:00", end_time="20:00"), db
                )
                self.assertEqual(scheduled.effective_date, "2026-10-21")
                self.assertEqual((scheduled.active_start_time, scheduled.active_end_time),
                                 ("09:00", "17:00"))
                self.assertEqual(db.query(DaySettingsVersion).count(), 2)
                self.assertEqual(db.get(DaySettingsVersion, date.min).start_time, "09:00")

                replacement = update_day_settings(
                    DaySettingsPayload(start_time="08:00", end_time="19:30"), db
                )
                self.assertEqual(replacement.end_time, "19:30")
                self.assertEqual(db.query(DaySettingsVersion).count(), 2)

                clock.now.return_value = moment("2026-10-22T12:00:00+00:00")
                week = task_history("week", "UTC", date(2026, 10, 21), db)
                totals = {day.date: day.total_seconds for day in week.days}
                self.assertEqual([totals[f"2026-10-{day}"] for day in (19, 20, 21)],
                                 [3600, 0, 3600])
                self.assertEqual([(day.start_time, day.end_time) for day in week.days
                                  if day.date in ("2026-10-20", "2026-10-21")],
                                 [("09:00", "17:00"), ("08:00", "19:30")])

    def test_day_settings_and_reset_persist_across_requests(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            update_day_settings(DaySettingsPayload(start_time="08:00", end_time="20:00"), db)
            self.assertEqual(get_day_settings(db).start_time, "08:00")
            item = Task(title="Morning work", status="completed",
                        started_at=moment("2026-10-18T09:00:00+00:00"),
                        segment_started_at=None,
                        stopped_at=moment("2026-10-18T09:30:00+00:00"),
                        accumulated_seconds=1800, duration_seconds=1800)
            db.add(item)
            db.flush()
            db.add(TaskInterval(task_id=item.id,
                                started_at=moment("2026-10-18T09:00:00+00:00"),
                                ended_at=moment("2026-10-18T09:30:00+00:00"),
                                duration_seconds=1800))
            db.commit()
            with patch("app.routers.tasks.datetime") as clock:
                clock.now.return_value = moment("2026-10-18T10:00:00+00:00")
                self.assertEqual(daily_total("UTC", db).total_seconds, 1800)
                reset_daily_total("UTC", db)
                first = db.query(DailyReset).one()
                self.assertEqual(first.day, date(2026, 10, 18))
                clock.now.return_value = moment("2026-10-18T11:00:00+00:00")
                reset_daily_total("UTC", db)
                self.assertEqual(db.query(DailyReset).count(), 1)
                self.assertEqual(daily_total("UTC", db).total_seconds, 0)

    def test_week_and_month_history_show_overnight_work_and_edits(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            item = Task(
                title="Night review", status="completed",
                started_at=moment("2026-10-17T17:50:00+00:00"),
                segment_started_at=None,
                stopped_at=moment("2026-10-17T18:10:00+00:00"),
                accumulated_seconds=1200,
                duration_seconds=1500,
                duration_adjustment_seconds=300,
            )
            db.add(item)
            db.flush()
            db.add(TaskInterval(
                task_id=item.id,
                started_at=moment("2026-10-17T17:50:00+00:00"),
                ended_at=moment("2026-10-17T18:10:00+00:00"),
                duration_seconds=1200,
            ))
            db.commit()

            week = task_history("week", "Asia/Dhaka", date(2026, 10, 18), db)
            days = {day.date: day for day in week.days}
            self.assertEqual((week.start_date, week.end_date), ("2026-10-12", "2026-10-18"))
            self.assertEqual((days["2026-10-17"].total_seconds,
                              days["2026-10-18"].total_seconds), (600, 900))
            self.assertEqual(days["2026-10-18"].tasks[0].title, "Night review")
            self.assertEqual(week.total_seconds, 1500)

            month = task_history("month", "Asia/Dhaka", date(2026, 10, 18), db)
            self.assertEqual((month.start_date, month.end_date), ("2026-10-01", "2026-10-31"))
            self.assertEqual(month.total_seconds, 1500)

            item.duration_seconds = 300
            item.duration_adjustment_seconds = -900
            db.commit()
            edited = task_history("week", "Asia/Dhaka", date(2026, 10, 18), db)
            edited_days = {day.date: day.total_seconds for day in edited.days}
            self.assertEqual((edited_days["2026-10-17"], edited_days["2026-10-18"]), (300, 0))
            self.assertEqual(edited.total_seconds, 300)

    def test_completed_duration_can_be_added_to_and_subtracted_from(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            item = Task(title="Review", status="completed",
                        started_at=moment("2026-10-18T08:00:00+00:00"),
                        segment_started_at=None,
                        stopped_at=moment("2026-10-18T08:10:00+00:00"),
                        accumulated_seconds=600, duration_seconds=600)
            db.add(item)
            db.commit()
            db.refresh(item)

            update_task(item.id, TaskUpdate(duration_seconds=900), db)
            self.assertEqual((item.duration_seconds, item.duration_adjustment_seconds), (900, 300))
            update_task(item.id, TaskUpdate(duration_seconds=240), db)
            self.assertEqual((item.duration_seconds, item.duration_adjustment_seconds), (240, -360))
            self.assertEqual(category_stats(db).grand_total_active_seconds, 240)

    def test_running_duration_cannot_be_edited(self):
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            item = Task(title="Review", status="running",
                        started_at=moment("2026-10-18T08:00:00+00:00"),
                        segment_started_at=moment("2026-10-18T08:00:00+00:00"),
                        accumulated_seconds=0)
            db.add(item)
            db.commit()
            db.refresh(item)
            with self.assertRaises(HTTPException) as result:
                update_task(item.id, TaskUpdate(duration_seconds=60), db)
            self.assertEqual(result.exception.status_code, 400)


class AuthTests(unittest.TestCase):
    @patch.dict(os.environ, {"APP_PASSWORD": "a-long-test-password", "APP_SESSION_SECRET": "test-secret"})
    def test_valid_login_creates_verifiable_cookie(self):
        response = Response()
        login(LoginRequest(password="a-long-test-password"), response)
        cookie = SimpleCookie()
        cookie.load(response.headers["set-cookie"])
        token = cookie["stopwatch_session"].value
        self.assertTrue(authenticated(SimpleNamespace(cookies={"stopwatch_session": token})))
        self.assertFalse(authenticated(SimpleNamespace(cookies={"stopwatch_session": token + "bad"})))

    @patch.dict(os.environ, {"APP_PASSWORD": "a-long-test-password", "APP_SESSION_SECRET": "test-secret"})
    def test_wrong_password_is_rejected(self):
        with self.assertRaises(HTTPException) as result:
            login(LoginRequest(password="wrong"), Response())
        self.assertEqual(result.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
