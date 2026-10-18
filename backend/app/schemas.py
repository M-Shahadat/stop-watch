import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str = Field(max_length=100)
    color: str = Field(default="#1a6cff", pattern=r"^#[0-9a-fA-F]{6}$")


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class CategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CategoryStatsItem(BaseModel):
    category_id: Optional[uuid.UUID]
    category_name: str
    category_color: str
    total_active_seconds: int
    total_paused_seconds: int
    task_count: int


class CategoryStatsResponse(BaseModel):
    items: list[CategoryStatsItem]
    grand_total_active_seconds: int
    grand_total_paused_seconds: int


class TaskCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    category_id: Optional[uuid.UUID] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    category_id: Optional[uuid.UUID] = None


class TaskResponse(BaseModel):
    id: uuid.UUID
    title: str
    status: str                               # "running" | "paused" | "completed"
    started_at: datetime
    segment_started_at: Optional[datetime]
    accumulated_seconds: int
    accumulated_paused_seconds: int
    stopped_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    created_at: datetime
    is_running: bool
    category_id: Optional[uuid.UUID] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None

    model_config = {"from_attributes": True}


class DailyTotalResponse(BaseModel):
    date: str
    total_seconds: int
