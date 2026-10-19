"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Task, type Category, type Session, api } from "@/lib/api";
import NewTaskForm from "@/components/NewTaskForm";
import TaskCard from "@/components/TaskCard";
import DailyTotalBanner from "@/components/DailyTotal";
import CategoryManager from "@/components/CategoryManager";
import CategoryStats from "@/components/CategoryStats";

type Tab = "tasks" | "categories";
type ViewMode = "grid" | "list";

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("tasks");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const latestFetch = useRef(0);

  const bump = useCallback(() => setRefreshSignal((n) => n + 1), []);

  useEffect(() => {
    api.getSession().then(setSession).catch((error) => {
      setAuthError(error instanceof Error ? error.message : "Could not connect to the server");
      setSession({ authenticated: false, enabled: true });
    });
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setSession((current) => current && { ...current, authenticated: false });
    window.addEventListener("stopwatch:unauthorized", onUnauthorized);
    return () => window.removeEventListener("stopwatch:unauthorized", onUnauthorized);
  }, []);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setAuthError(null);
    try {
      const nextSession = await api.login(password);
      setPassword("");
      setLoading(true);
      setSession(nextSession);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not sign in");
    } finally {
      setSigningIn(false);
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
      latestFetch.current += 1;
      setTasks([]);
      setCategories([]);
      setSession({ authenticated: false, enabled: true });
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Could not sign out");
    }
  }

  const fetchAll = useCallback(async () => {
    const requestId = ++latestFetch.current;
    try {
      const [taskData, catData] = await Promise.all([
        api.listTasks(),
        api.listCategories(),
      ]);
      if (requestId === latestFetch.current) {
        setTasks(taskData);
        setCategories(catData);
        setDataError(null);
      }
    } catch (e) {
      if (requestId !== latestFetch.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setSession((current) => current && { ...current, authenticated: false });
      } else {
        setDataError(e instanceof Error ? e.message : "Could not load tasks");
      }
    } finally {
      if (requestId === latestFetch.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    const id = window.setTimeout(fetchAll, 0);
    return () => window.clearTimeout(id);
  }, [fetchAll, session?.authenticated]);

  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === "running");
    if (!session?.authenticated || !hasRunning) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchAll();
    }, 30_000);
    return () => clearInterval(id);
  }, [tasks, fetchAll, session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated) return;
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") fetchAll();
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("focus", refreshOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnReturn);
      window.removeEventListener("focus", refreshOnReturn);
    };
  }, [fetchAll, session?.authenticated]);

  function handleChange() {
    fetchAll();
    bump();
  }

  const active    = tasks.filter((t) => t.status === "running" || t.status === "paused");
  const completed = tasks.filter((t) => t.status === "completed");

  if (!session) return <main className="page"><p className="loading">Connecting…</p></main>;

  if (!session.authenticated) {
    return (
      <main className="page login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <h1 className="page-title">Stopwatch</h1>
          <p>Sign in to your time tracker.</p>
          <label htmlFor="password">Password</label>
          <input id="password" className="task-input" type="password" value={password}
            onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          <button className="start-btn" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button>
          {authError && <p className="error-msg" role="alert">{authError}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div className="page-brand">
          <span className="page-eyebrow">Personal time tracker</span>
          <h1 className="page-title">Stopwatch</h1>
          <p className="page-subtitle">Make the time you spend count.</p>
        </div>
        <div className="page-header-right">
          <DailyTotalBanner refreshSignal={refreshSignal} />
          {session.enabled && <button className="sign-out-btn" onClick={handleLogout}>Sign out</button>}
        </div>
        <div className="page-header-controls">
          <div className="tab-bar" role="group" aria-label="Section">
            <button
              className={`tab-btn${tab === "tasks" ? " tab-btn--active" : ""}`}
              aria-pressed={tab === "tasks"}
              onClick={() => setTab("tasks")}
            >
              Tasks
            </button>
            <button
              className={`tab-btn${tab === "categories" ? " tab-btn--active" : ""}`}
              aria-pressed={tab === "categories"}
              onClick={() => { setTab("categories"); bump(); }}
            >
              Categories
            </button>
          </div>
          {tab === "tasks" && <div className="view-toggle" role="group" aria-label="Task layout">
            <button
              className={`view-toggle__btn${viewMode === "grid" ? " view-toggle__btn--active" : ""}`}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="6" height="6" rx="1"/>
                <rect x="8" y="0" width="6" height="6" rx="1"/>
                <rect x="0" y="8" width="6" height="6" rx="1"/>
                <rect x="8" y="8" width="6" height="6" rx="1"/>
              </svg>
            </button>
            <button
              className={`view-toggle__btn${viewMode === "list" ? " view-toggle__btn--active" : ""}`}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="1" width="14" height="2" rx="1"/>
                <rect x="0" y="6" width="14" height="2" rx="1"/>
                <rect x="0" y="11" width="14" height="2" rx="1"/>
              </svg>
            </button>
          </div>}
        </div>
      </header>

      {dataError && <div className="page-error" role="alert">{dataError} <button onClick={fetchAll}>Retry</button></div>}

      {tab === "tasks" && (
        <>
          <section className="new-task-section">
            <div className="new-task-section__intro">
              <h2>Start a task</h2>
              <p>Give it a name or start right away.</p>
            </div>
            <NewTaskForm categories={categories} onCreated={handleChange} />
          </section>

          {loading ? (
            <p className="loading">Loading tasks…</p>
          ) : (
            <>
              {active.length > 0 && (
                <section className="task-section">
                  <h2 className="section-heading">Active <span className="section-count">{active.length}</span></h2>
                  <div className={`task-grid task-grid--${viewMode}`}>
                    {active.map((t) => (
                      <TaskCard key={t.id} task={t} categories={categories} viewMode={viewMode} onChange={handleChange} />
                    ))}
                  </div>
                </section>
              )}

              {completed.length > 0 && (
                <section className="task-section">
                  <h2 className="section-heading">Completed <span className="section-count">{completed.length}</span></h2>
                  <div className={`task-grid task-grid--${viewMode}`}>
                    {completed.map((t) => (
                      <TaskCard key={t.id} task={t} categories={categories} viewMode={viewMode} onChange={handleChange} />
                    ))}
                  </div>
                </section>
              )}

              {tasks.length === 0 && (
                <p className="empty-state">No tasks yet — start your first one above.</p>
              )}
            </>
          )}
        </>
      )}

      {tab === "categories" && (
        <div className="categories-page">
          <section className="cat-section">
            <h2 className="section-heading">Manage Categories</h2>
            <CategoryManager categories={categories} onChange={handleChange} />
          </section>

          <section className="cat-section">
            <h2 className="section-heading">Time by Category</h2>
            <CategoryStats refreshSignal={refreshSignal} />
          </section>
        </div>
      )}
    </main>
  );
}
