export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  created_at: Date;
}

export interface TaskRow {
  id: string;
  title: string;
  category_id: string | null;
  status: "running" | "paused" | "completed";
  started_at: Date;
  segment_started_at: Date | null;
  accumulated_seconds: number;
  pause_started_at: Date | null;
  accumulated_paused_seconds: number;
  stopped_at: Date | null;
  duration_seconds: number | null;
  duration_adjustment_seconds: number;
  created_at: Date;
  category_name?: string | null;
  category_color?: string | null;
}

export interface IntervalRow {
  task_id: string;
  started_at: Date;
  ended_at: Date;
  duration_seconds: number;
}

export interface DayHours {
  start_time: string;
  end_time: string;
}

export interface DayVersion extends DayHours {
  effective_date: string;
}

export interface ResetRow {
  day: string;
  timezone_name: string;
  reset_at: Date;
}
