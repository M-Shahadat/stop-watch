import uuid
from datetime import datetime, timezone
from collections import defaultdict
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Task
from ..timing import elapsed_seconds, paused_seconds
from ..schemas import (
    CategoryCreate,
    CategoryUpdate,
    CategoryResponse,
    CategoryStatsItem,
    CategoryStatsResponse,
)

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("/stats", response_model=CategoryStatsResponse)
def category_stats(db: Session = Depends(get_db)):
    tasks = db.query(Task).all()
    categories = {str(c.id): c for c in db.query(Category).all()}
    now = datetime.now(timezone.utc)

    groups: dict[str | None, dict] = defaultdict(
        lambda: {"active": 0, "paused": 0, "count": 0}
    )
    for task in tasks:
        key = str(task.category_id) if task.category_id else None
        groups[key]["active"] += elapsed_seconds(task, now)
        groups[key]["paused"] += paused_seconds(task, now)
        groups[key]["count"] += 1

    items: list[CategoryStatsItem] = []
    for cat_id_str, stats in groups.items():
        if cat_id_str is None:
            items.append(
                CategoryStatsItem(
                    category_id=None,
                    category_name="Uncategorized",
                    category_color="#737370",
                    total_active_seconds=stats["active"],
                    total_paused_seconds=stats["paused"],
                    task_count=stats["count"],
                )
            )
        else:
            cat = categories.get(cat_id_str)
            items.append(
                CategoryStatsItem(
                    category_id=uuid.UUID(cat_id_str),
                    category_name=cat.name if cat else "Deleted",
                    category_color=cat.color if cat else "#737370",
                    total_active_seconds=stats["active"],
                    total_paused_seconds=stats["paused"],
                    task_count=stats["count"],
                )
            )

    items.sort(key=lambda x: x.category_name.lower())
    return CategoryStatsResponse(
        items=items,
        grand_total_active_seconds=sum(i.total_active_seconds for i in items),
        grand_total_paused_seconds=sum(i.total_paused_seconds for i in items),
    )


@router.get("/", response_model=List[CategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.name).all()


@router.post("/", response_model=CategoryResponse, status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name cannot be empty")
    category = Category(name=name, color=payload.color)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: uuid.UUID, payload: CategoryUpdate, db: Session = Depends(get_db)
):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Category name cannot be empty")
        cat.name = name
    if payload.color is not None:
        cat.color = payload.color
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: uuid.UUID, db: Session = Depends(get_db)):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    # Tasks referencing this category will have category_id set to NULL via ON DELETE SET NULL
    db.delete(cat)
    db.commit()
