const API_BASE = "/api";
const GET_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
  const canRetry = !init?.method || init.method.toUpperCase() === "GET";
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...init,
      });
    } catch (error) {
      if (canRetry && attempt < GET_RETRY_DELAYS_MS.length && !init?.signal?.aborted) {
        await wait(GET_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw error;
    }

    if (canRetry && [502, 503, 504].includes(res.status) && attempt < GET_RETRY_DELAYS_MS.length) {
      await wait(GET_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 401 && path !== "/auth/login") {
        window.dispatchEvent(new Event("stopwatch:unauthorized"));
      }
      const detail = typeof body?.detail === "string" ? body.detail : null;
      const temporary = [502, 503, 504].includes(res.status);
      throw new ApiError(res.status, detail ?? (temporary
        ? "Server temporarily unavailable. Please try again shortly."
        : `Request failed (${res.status})`));
    }
    if (res.status === 204) return undefined as T;
    if (!res.headers.get("content-type")?.includes("json")) {
      if (canRetry && attempt < GET_RETRY_DELAYS_MS.length) {
        await wait(GET_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new ApiError(503, "Server is waking up. Please try again shortly.");
    }
    return res.json() as Promise<T>;
  }
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

  updateTask: (id: string, data: { title?: string; category_id?: string | null; duration_seconds?: number }) =>
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
