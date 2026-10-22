import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import { ApiError, body, colorField, json, noContent, textField, uuidField } from "./http";
import { elapsedSeconds, pausedSeconds } from "./timing";
import type { CategoryRow, TaskRow } from "./types";

export async function handleCategories(method: string, segments: string[], request: Request): Promise<Response> {
  if (method === "GET" && segments.length === 0) {
    const result = await (await db()).query<CategoryRow>("SELECT * FROM categories ORDER BY name");
    return json(result.rows);
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "stats") {
    const database = await db();
    const [tasks, categories] = await Promise.all([
      database.query<TaskRow>("SELECT * FROM tasks"),
      database.query<CategoryRow>("SELECT * FROM categories"),
    ]);
    const categoryById = new Map(categories.rows.map((category) => [category.id, category]));
    const groups = new Map<string | null, { active: number; paused: number; count: number }>();
    const now = new Date();
    for (const task of tasks.rows) {
      const current = groups.get(task.category_id) ?? { active: 0, paused: 0, count: 0 };
      current.active += elapsedSeconds(task, now);
      current.paused += pausedSeconds(task, now);
      current.count += 1;
      groups.set(task.category_id, current);
    }
    const items = [...groups].map(([categoryId, totals]) => {
      const category = categoryId ? categoryById.get(categoryId) : undefined;
      return {
        category_id: categoryId,
        category_name: categoryId ? category?.name ?? "Deleted" : "Uncategorized",
        category_color: categoryId ? category?.color ?? "#737370" : "#737370",
        total_active_seconds: totals.active,
        total_paused_seconds: totals.paused,
        task_count: totals.count,
      };
    }).sort((a, b) => a.category_name.toLowerCase().localeCompare(b.category_name.toLowerCase()));
    return json({
      items,
      grand_total_active_seconds: items.reduce((sum, item) => sum + item.total_active_seconds, 0),
      grand_total_paused_seconds: items.reduce((sum, item) => sum + item.total_paused_seconds, 0),
    });
  }

  if (method === "POST" && segments.length === 0) {
    const payload = await body(request);
    const name = textField(payload.name, "Name", 100).trim();
    if (!name) throw new ApiError(400, "Category name cannot be empty");
    const color = colorField(payload.color ?? "#1a6cff");
    const result = await (await db()).query<CategoryRow>(
      "INSERT INTO categories (id, name, color) VALUES ($1, $2, $3) RETURNING *",
      [randomUUID(), name, color],
    );
    return json(result.rows[0], 201);
  }

  if (segments.length !== 1) throw new ApiError(404, "Not found");
  const id = uuidField(segments[0], "Category ID");
  if (method === "PATCH") {
    const payload = await body(request);
    const updates: string[] = [];
    const values: unknown[] = [];
    if (payload.name !== undefined && payload.name !== null) {
      const name = textField(payload.name, "Name", 100).trim();
      if (!name) throw new ApiError(400, "Category name cannot be empty");
      values.push(name);
      updates.push(`name = $${values.length}`);
    }
    if (payload.color !== undefined && payload.color !== null) {
      values.push(colorField(payload.color));
      updates.push(`color = $${values.length}`);
    }
    const category = await transaction(async (client) => {
      const existing = await client.query<CategoryRow>("SELECT * FROM categories WHERE id = $1 FOR UPDATE", [id]);
      if (!existing.rows[0]) throw new ApiError(404, "Category not found");
      if (!updates.length) return existing.rows[0];
      values.push(id);
      const result = await client.query<CategoryRow>(
        `UPDATE categories SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`, values,
      );
      return result.rows[0];
    });
    return json(category);
  }
  if (method === "DELETE") {
    const result = await (await db()).query("DELETE FROM categories WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) throw new ApiError(404, "Category not found");
    return noContent();
  }
  throw new ApiError(404, "Not found");
}
