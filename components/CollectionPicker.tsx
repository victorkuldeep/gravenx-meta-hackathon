"use client";

import { useEffect, useState } from "react";
import type { Collection, CollectionItem, NewCollectionItem } from "@/lib/collection/types";
import Button from "./ui/Button";
import Input from "./ui/Input";

interface CollectionPickerProps {
  /** Null = closed. Non-null = staging this item, ask where it goes. */
  item: NewCollectionItem | null;
  collections: Collection[];
  items: CollectionItem[];
  onConfirm: (collectionId: string) => void;
  onCreateAndConfirm: (name: string) => void;
  onClose: () => void;
}

export function CollectionPicker({
  item,
  collections,
  items,
  onConfirm,
  onCreateAndConfirm,
  onClose,
}: CollectionPickerProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (item) {
      setSelectedId(collections[0]?.id ?? "");
      setNewName("");
      setNameError("");
    }
  }, [item, collections]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;

  const countFor = (id: string) => items.filter((i) => i.collectionId === id).length;

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) {
      setNameError("Give the new collection a name");
      return;
    }
    if (collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setNameError("A collection with this name already exists");
      return;
    }
    onCreateAndConfirm(name);
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-title"
      onClick={onClose}
    >
      <div className="modal-card max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
          <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
            Stage request
          </p>
          <h2 id="picker-title" className="mt-1 text-base font-bold text-ivory-950 truncate" title={item.name}>
            Add “{item.name}” to…
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-ivory-600 truncate" title={item.url}>
            {item.method} · {item.url}
          </p>
        </div>

        <div className="px-6 py-4 space-y-2 max-h-64 overflow-y-auto" role="radiogroup" aria-label="Choose a collection">
          {collections.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                selectedId === c.id
                  ? "border-bronze-500 bg-[var(--color-accent-bg)]"
                  : "border-[var(--color-line)] hover:bg-ivory-200"
              }`}
            >
              <input
                type="radio"
                name="collection-pick"
                checked={selectedId === c.id}
                onChange={() => setSelectedId(c.id)}
                className="h-4 w-4 shrink-0 accent-[#7A5C3A]"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ivory-950">
                {c.name}
              </span>
              <span className="shrink-0 text-[11px] text-ivory-600">
                {countFor(c.id)} staged
              </span>
            </label>
          ))}
          {collections.length === 0 && (
            <p className="text-xs text-ivory-600">No collections yet - create one below.</p>
          )}
        </div>

        <div className="px-6 pb-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="New collection name…"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNameError("");
                }}
                error={nameError}
                aria-label="New collection name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <Button variant="secondary" onClick={handleCreate} className="shrink-0 self-start mt-0">
              Create &amp; add
            </Button>
          </div>
        </div>

        <div className="px-6 py-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => selectedId && onConfirm(selectedId)} disabled={!selectedId}>
            Add to collection
          </Button>
        </div>
      </div>
    </div>
  );
}
