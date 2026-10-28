"use client";

import { useRef, useState } from "react";
import { Category, api } from "@/lib/api";

interface Props {
  categories: Category[];
  onCreated: () => void;
}

export default function NewTaskForm({ categories, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const starting = useRef(false);

  async function handleStart(category?: Category) {
    if (starting.current) return;
    starting.current = true;
    setLoading(true);
    setError(null);
    try {
      await api.createTask(category ? category.name : title.trim() || undefined, category ? category.id : categoryId || null);
      setTitle("");
      setCategoryId("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      starting.current = false;
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleStart();
  }

  return (
    <section>
      <h2>Start tracking</h2>
      <p>Click a category to start its stopwatch.</p>
      <div className="quick-start-categories">
        {categories.map((category) => (
          <button key={category.id} className="quick-start-category" disabled={loading}
            onClick={() => handleStart(category)} aria-label={`Start ${category.name} stopwatch`}>
            <span style={{ color: category.color }} aria-hidden="true">●</span>
            <span>{category.name}</span><span aria-hidden="true">▶</span>
          </button>
        ))}
      </div>
      <details open={categories.length === 0}>
        <summary>Custom task / no category</summary>
    <div className="new-task-form">
      <input
        className="task-input"
        type="text"
        maxLength={255}
        placeholder="Task name (optional)"
        aria-label="Task name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
      />
      {categories.length > 0 && (
        <select
          className="cat-select"
          aria-label="Task category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={loading}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      <button
        className="start-btn"
        onClick={() => handleStart()}
        disabled={loading}
      >
        {loading ? "Starting…" : "▶ Start"}
      </button>
      {error && <p className="error-msg">{error}</p>}
    </div>
      </details>
    </section>
  );
}
