from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .database import engine
from .auth import authenticated, password, router as auth_router, session_secret
from .models import Base
from .routers import tasks, categories


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("APP_ENV") == "production" and (not password() or not session_secret()):
        raise RuntimeError("APP_PASSWORD and APP_SESSION_SECRET are required in production")
    if password() and not session_secret():
        raise RuntimeError("APP_SESSION_SECRET is required when APP_PASSWORD is set")

    # Create new tables (e.g. categories) if they don't exist yet.
    Base.metadata.create_all(bind=engine)

    # Migrate existing PostgreSQL tables with the columns added since launch.
    if engine.dialect.name == "postgresql":
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
                "category_id UUID REFERENCES categories(id) ON DELETE SET NULL"
            ))
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
                "accumulated_paused_seconds INTEGER NOT NULL DEFAULT 0"
            ))
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
                "pause_started_at TIMESTAMPTZ"
            ))
            conn.execute(text(
                "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "
                "duration_adjustment_seconds INTEGER NOT NULL DEFAULT 0"
            ))
            conn.commit()

    yield


app = FastAPI(
    title="Stopwatch API",
    description="Task time-tracking backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(tasks.router)
app.include_router(categories.router)
app.include_router(auth_router)


@app.middleware("http")
async def protect_api(request: Request, call_next):
    path = request.url.path
    if (path.startswith("/api/tasks") or path.startswith("/api/categories")) and not authenticated(request):
        return JSONResponse({"detail": "Sign in required"}, status_code=401)
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}


static_dir = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "out"))
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
