"use client";

import { useState } from "react";
import { Category, api } from "@/lib/api";

const COLOR_PRESETS = [
  "#e53935", "#f4511e", "#f6bf26", "#33b679",
  "#039be5", "#3f51b5", "#8e24aa", "#616161",
];

interface Props {
  categories: Category[];
  onChange: () => void;
}

interface EditState {
  id: string;
  name: string;
  color: string;
}

export default function CategoryManager({ categories, onChange }: Props) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy("add");
    setError(null);
    try {
      await api.createCategory(name, newColor);
      setNewName("");
      setNewColor(COLOR_PRESETS[0]);
      setAdding(false);
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add category");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveEdit() {
    if (!edit) return;
    const name = edit.name.trim();
    if (!name) return;
    setBusy(edit.id);
    setError(null);
    try {
      await api.updateCategory(edit.id, { name, color: edit.color });
      setEdit(null);
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save category");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.deleteCategory(id);
      onChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not delete category");
    } finally {
      setBusy(null);
    }
  }

  function startEdit(cat: Category) {
    setEdit({ id: cat.id, name: cat.name, color: cat.color });
  }

  return (
    <div className="cat-manager">
      <div className="cat-manager__list">
        {categories.map((cat) =>
          edit?.id === cat.id ? (
            <div key={cat.id} className="cat-manager__row cat-manager__row--editing">
              <div className="cat-manager__color-row">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    className={`cat-color-swatch${edit.color === c ? " cat-color-swatch--active" : ""}`}
                    style={{ background: c }}
                    onClick={() => setEdit({ ...edit, color: c })}
                  />
                ))}
              </div>
              <div className="cat-manager__edit-row">
                <input
                  className="cat-manager__input"
                  maxLength={100}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEdit(null); }}
                  autoFocus
                />
                <button className="btn btn--resume cat-manager__btn" onClick={handleSaveEdit} disabled={busy === cat.id}>Save</button>
                <button className="btn cat-manager__btn" style={{ borderColor: "var(--border)" }} onClick={() => setEdit(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={cat.id} className="cat-manager__row">
              <span className="cat-manager__dot" style={{ background: cat.color }} />
              <span className="cat-manager__name">{cat.name}</span>
              <button className="cat-manager__icon-btn" title="Edit" onClick={() => startEdit(cat)}>✏️</button>
              <button
                className="cat-manager__icon-btn cat-manager__icon-btn--delete"
                title="Delete"
                disabled={busy === cat.id}
                onClick={() => handleDelete(cat.id)}
              >🗑</button>
            </div>
          )
        )}

        {adding ? (
          <div className="cat-manager__row cat-manager__row--editing">
            <div className="cat-manager__color-row">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  className={`cat-color-swatch${newColor === c ? " cat-color-swatch--active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>
            <div className="cat-manager__edit-row">
              <input
                className="cat-manager__input"
                maxLength={100}
                placeholder="Category name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
                autoFocus
              />
              <button className="btn btn--resume cat-manager__btn" onClick={handleAdd} disabled={busy === "add" || !newName.trim()}>Add</button>
              <button className="btn cat-manager__btn" style={{ borderColor: "var(--border)" }} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="cat-manager__add-btn" onClick={() => setAdding(true)}>
            + Add category
          </button>
        )}
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
    </div>
  );
}
