import os
import sys
import unittest
import uuid
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from fastapi import HTTPException, Response  # noqa: E402
from app.auth import LoginRequest, authenticated, login  # noqa: E402
from app.timing import daily_total_seconds, elapsed_seconds  # noqa: E402


def moment(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def task(started: str, *, status="completed", accumulated=0, duration=None, segment=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        started_at=moment(started),
        status=status,
        accumulated_seconds=accumulated,
        duration_seconds=duration,
        segment_started_at=moment(segment) if segment else None,
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
