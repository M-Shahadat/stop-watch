const API_BASE = "/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Session {
  authenticated: boolean;
  enabled: boolean;
}

export type TaskStatus = "running" | "paused" | "completed";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  started_at: string;
  segment_started_at: string | null;
  accumulated_seconds: number;
  accumulated_paused_seconds: number;
  stopped_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  is_running: boolean;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface CategoryStatsItem {
  category_id: string | null;
  category_name: string;
  category_color: string;
  total_active_seconds: number;
  total_paused_seconds: number;
  task_count: number;
}

export interface CategoryStats {
  items: CategoryStatsItem[];
  grand_total_active_seconds: number;
  grand_total_paused_seconds: number;
}

export interface DailyTotal {
  date: string;
  total_seconds: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401 && path !== "/auth/login") {
      window.dispatchEvent(new Event("stopwatch:unauthorized"));
    }
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new ApiError(res.status, detail ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getSession: () => request<Session>("/auth/session"),
  login: (password: string) => request<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  }),
  logout: () => request<Session>("/auth/logout", { method: "POST" }),
  // Tasks
  createTask: (title?: string, category_id?: string | null) =>
    request<Task>("/tasks/", {
      method: "POST",
      body: JSON.stringify({ title: title ?? null, category_id: category_id ?? null }),
    }),

  pauseTask:  (id: string) => request<Task>(`/tasks/${id}/pause`,  { method: "PATCH" }),
  resumeTask: (id: string) => request<Task>(`/tasks/${id}/resume`, { method: "PATCH" }),
  stopTask:   (id: string) => request<Task>(`/tasks/${id}/stop`,   { method: "PATCH" }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`,        { method: "DELETE" }),

  updateTask: (id: string, data: { title?: string; category_id?: string | null }) =>
    request<Task>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listTasks:     () => request<Task[]>("/tasks/"),
  getDailyTotal: () => request<DailyTotal>(
    `/tasks/daily-total?timezone_name=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`
  ),

  // Categories
  listCategories:   () => request<Category[]>("/categories/"),
  createCategory:   (name: string, color: string) =>
    request<Category>("/categories/", {
      method: "POST",
      body: JSON.stringify({ name, color }),
    }),
  updateCategory:   (id: string, data: { name?: string; color?: string }) =>
    request<Category>(`/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteCategory:   (id: string) => request<void>(`/categories/${id}`, { method: "DELETE" }),
  getCategoryStats: () => request<CategoryStats>("/categories/stats"),
};
