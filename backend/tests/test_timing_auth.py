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
from app.models import Task, TaskInterval  # noqa: E402
from app.routers.categories import category_stats  # noqa: E402
from app.routers.tasks import task_history, update_task  # noqa: E402
from app.schemas import TaskUpdate  # noqa: E402
from app.timing import daily_total_seconds, elapsed_seconds  # noqa: E402


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
