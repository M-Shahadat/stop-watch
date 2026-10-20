import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..database import get_db
from ..models import Category, Task, TaskInterval
from ..schemas import DailyTotalResponse, TaskCreate, TaskResponse, TaskUpdate
from ..timing import daily_total_seconds, elapsed_seconds, utc

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _serialize(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        title=task.title,
        status=task.status,
        started_at=task.started_at,
        segment_started_at=task.segment_started_at,
        accumulated_seconds=task.accumulated_seconds,
        accumulated_paused_seconds=task.accumulated_paused_seconds or 0,
        stopped_at=task.stopped_at,
        duration_seconds=task.duration_seconds,
        created_at=task.created_at,
        is_running=task.status == "running",
        category_id=task.category_id,
        category_name=task.category.name if task.category else None,
        category_color=task.category.color if task.category else None,
    )


def _check_category(db: Session, category_id: uuid.UUID | None) -> None:
    if category_id and not db.get(Category, category_id):
        raise HTTPException(status_code=404, detail="Category not found")


@router.post("/", response_model=TaskResponse, status_code=201)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    _check_category(db, payload.category_id)
    now = datetime.now(timezone.utc)
    task = Task(
        title=(payload.title or "").strip() or "Untitled task",
        status="running",
        started_at=now,
        segment_started_at=now,
        accumulated_seconds=0,
        accumulated_paused_seconds=0,
        category_id=payload.category_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _serialize(task)


@router.patch("/{task_id}/pause", response_model=TaskResponse)
def pause_task(task_id: uuid.UUID, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "running":
        raise HTTPException(status_code=400, detail=f"Cannot pause a task that is {task.status}")

    now = datetime.now(timezone.utc)
    segment_seconds = max(0, int((now - utc(task.segment_started_at)).total_seconds()))
    db.add(TaskInterval(
        task_id=task.id,
        started_at=task.segment_started_at,
        ended_at=now,
        duration_seconds=segment_seconds,
    ))
    task.accumulated_seconds += segment_seconds
    task.segment_started_at = None
    task.pause_started_at = now
    task.status = "paused"
    db.commit()
    db.refresh(task)
    return _serialize(task)


@router.patch("/{task_id}/resume", response_model=TaskResponse)
def resume_task(task_id: uuid.UUID, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume a task that is {task.status}")

    now = datetime.now(timezone.utc)
    if task.pause_started_at:
        task.accumulated_paused_seconds = (task.accumulated_paused_seconds or 0) + int(
            (now - utc(task.pause_started_at)).total_seconds()
        )
    task.pause_started_at = None
    task.segment_started_at = now
    task.status = "running"
    db.commit()
    db.refresh(task)
    return _serialize(task)


@router.patch("/{task_id}/stop", response_model=TaskResponse)
def stop_task(task_id: uuid.UUID, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "completed":
        raise HTTPException(status_code=400, detail="Task is already completed")

    now = datetime.now(timezone.utc)
    if task.status == "paused" and task.pause_started_at:
        task.accumulated_paused_seconds = (task.accumulated_paused_seconds or 0) + int(
            (now - utc(task.pause_started_at)).total_seconds()
        )
        task.pause_started_at = None

    task.duration_seconds = elapsed_seconds(task, now)
    if task.status == "running" and task.segment_started_at:
        db.add(TaskInterval(
            task_id=task.id,
            started_at=task.segment_started_at,
            ended_at=now,
            duration_seconds=max(0, int((now - utc(task.segment_started_at)).total_seconds())),
        ))
    task.stopped_at = now
    task.segment_started_at = None
    task.status = "completed"
    db.commit()
    db.refresh(task)
    return _serialize(task)


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: uuid.UUID, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if "title" in payload.model_fields_set and payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Task title cannot be empty")
        task.title = title

    if "category_id" in payload.model_fields_set:
        _check_category(db, payload.category_id)
        task.category_id = payload.category_id  # None clears the category

    if "duration_seconds" in payload.model_fields_set:
        if task.status != "completed":
            raise HTTPException(status_code=400, detail="Only completed tasks can have their time edited")
        if payload.duration_seconds is None:
            raise HTTPException(status_code=400, detail="Duration must be a number of seconds")
        previous_duration = task.duration_seconds or 0
        task.duration_adjustment_seconds = (
            (task.duration_adjustment_seconds or 0) + payload.duration_seconds - previous_duration
        )
        task.duration_seconds = payload.duration_seconds

    db.commit()
    db.refresh(task)
    return _serialize(task)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()


@router.get("/daily-total", response_model=DailyTotalResponse)
def daily_total(timezone_name: str = "UTC", db: Session = Depends(get_db)):
    try:
        ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid time zone") from None
    now = datetime.now(timezone.utc)
    day, total = daily_total_seconds(
        db.query(Task).all(), db.query(TaskInterval).all(), now, timezone_name
    )
    return DailyTotalResponse(date=day, total_seconds=total)


@router.get("/", response_model=List[TaskResponse])
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.started_at.desc()).all()
    return [_serialize(t) for t in tasks]
