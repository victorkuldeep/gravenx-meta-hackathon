"use client";

import { useEffect, useState } from "react";
import type { Collection, CollectionItem, CollectionMethod } from "@/lib/collection/types";
import {
  buildPostmanCollection,
  collectionFileName,
  downloadTextFile,
} from "@/lib/collection/postman";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Badge from "./ui/Badge";

interface CollectionDrawerProps {
  open: boolean;
  collections: Collection[];
  activeCollectionId: string | null;
  items: CollectionItem[];
  onClose: () => void;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRemove: (id: string) => void;
  onRenameItem: (id: string, name: string) => void;
  onClearActive: () => void;
}

const METHOD_STYLES: Record<CollectionMethod, string> = {
  POST: "bg-green-100 text-green-800 border-green-300",
  PATCH: "bg-amber-100 text-amber-800 border-amber-300",
  GET: "bg-blue-100 text-blue-800 border-blue-300",
  DELETE: "bg-red-100 text-red-700 border-red-300",
};

const KIND_LABEL: Record<CollectionItem["kind"], string> = {
  rest: "REST",
  composite: "Composite",
  graphql: "GraphQL",
};

export function CollectionDrawer({
  open,
  collections,
  activeCollectionId,
  items,
  onClose,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onRemove,
  onRenameItem,
  onClearActive,
}: CollectionDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [itemRenameValue, setItemRenameValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setConfirmClear(false);
    setConfirmDelete(false);
    setShowNew(false);
    setRenaming(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = collections.find((c) => c.id === activeCollectionId) ?? null;
  const activeItems = active ? items.filter((i) => i.collectionId === active.id) : [];
  const total = items.length;

  const doc = buildPostmanCollection(active?.name ?? "Salesforce sObject Payloads", activeItems);
  const json = JSON.stringify(doc, null, 2);

  const nameTaken = (name: string, exceptId?: string) =>
    collections.some(
      (c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase()
    );

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) {
      setNewError("Name is required");
      return;
    }
    if (nameTaken(name)) {
      setNewError("A collection with this name already exists");
      return;
    }
    onCreate(name);
    setNewName("");
    setNewError("");
    setShowNew(false);
  };

  const handleRename = () => {
    if (!active) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError("Name is required");
      return;
    }
    if (nameTaken(name, active.id)) {
      setRenameError("A collection with this name already exists");
      return;
    }
    onRename(active.id, name);
    setRenaming(false);
    setRenameError("");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collection-title"
      onClick={onClose}
    >
      <div
        className="modal-card max-w-3xl flex flex-col"
        style={{ maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                Staged requests · {total} total
              </p>
              <h2 id="collection-title" className="mt-1 text-lg font-bold text-ivory-950">
                Request Collections
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close collections"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {/* Switcher + manage */}
          <div className="flex flex-wrap items-center gap-2">
            {renaming && active ? (
              <div className="flex flex-1 min-w-[220px] gap-2">
                <div className="flex-1">
                  <Input
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                      setRenameError("");
                    }}
                    error={renameError}
                    aria-label="Rename collection"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                    }}
                  />
                </div>
                <Button size="sm" onClick={handleRename}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
              </div>
            ) : (
              <>
                <select
                  value={active?.id ?? ""}
                  onChange={(e) => e.target.value && onSwitch(e.target.value)}
                  aria-label="Active collection"
                  className="min-w-[200px] flex-1 sm:flex-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-ivory-950 focus:outline-none focus:border-bronze-500 cursor-pointer"
                >
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({items.filter((i) => i.collectionId === c.id).length})
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="secondary" onClick={() => setShowNew((s) => !s)}>
                  + New
                </Button>
                {active && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenameValue(active.name);
                        setRenameError("");
                        setRenaming(true);
                      }}
                    >
                      Rename
                    </Button>
                    {confirmDelete ? (
                      <span className="flex items-center gap-2 text-xs text-ivory-700">
                        Delete “{active.name}” + {activeItems.length}?
                        <button type="button" onClick={() => { onDelete(active.id); setConfirmDelete(false); }} className="font-semibold text-red-700 underline cursor-pointer">
                          Yes
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(false)} className="underline cursor-pointer">
                          Keep
                        </button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(true)}
                        disabled={collections.length <= 1}
                        title={collections.length <= 1 ? "Keep at least one collection" : "Delete this collection and its staged requests"}
                      >
                        Delete
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {showNew && !renaming && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="New collection name… e.g. Account regression"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setNewError("");
                  }}
                  error={newError}
                  aria-label="New collection name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                />
              </div>
              <Button size="sm" onClick={handleCreate}>Create</Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeItems.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-ivory-950">
                {active ? `“${active.name}” is empty` : "No collection selected"}
              </p>
              <p className="mt-1 mx-auto max-w-sm text-xs leading-relaxed text-ivory-600">
                Generate a payload, run a composite batch or a GraphQL query, then hit
                “+ Collection” and pick where it goes. Stage as many as you like and export once.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {activeItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5"
                >
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold ${METHOD_STYLES[item.method]}`}
                  >
                    {item.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    {renamingItemId === item.id ? (
                      <span className="flex items-center gap-1.5">
                        <input
                          value={itemRenameValue}
                          onChange={(e) => setItemRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const name = itemRenameValue.trim();
                              if (name) {
                                onRenameItem(item.id, name);
                                setRenamingItemId(null);
                              }
                            }
                            if (e.key === "Escape") setRenamingItemId(null);
                          }}
                          autoFocus
                          aria-label={`Rename ${item.name}`}
                          className="w-full min-w-0 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-xs text-ivory-950 focus:outline-none focus:border-bronze-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const name = itemRenameValue.trim();
                            if (name) {
                              onRenameItem(item.id, name);
                              setRenamingItemId(null);
                            }
                          }}
                          aria-label="Save name"
                          className="shrink-0 rounded-md p-1 text-green-700 hover:bg-green-500/10 cursor-pointer"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </span>
                    ) : (
                      <p className="truncate text-xs font-semibold text-ivory-950">
                        {item.name}{" "}
                        <span className="font-normal text-ivory-600">· {KIND_LABEL[item.kind]}</span>
                      </p>
                    )}
                    <p className="truncate font-mono text-[11px] text-ivory-600" title={item.url}>
                      {item.url}
                    </p>
                  </div>
                  <span className="hidden sm:inline shrink-0 text-[10px] text-ivory-500">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingItemId(item.id);
                      setItemRenameValue(item.name);
                    }}
                    aria-label={`Rename ${item.name}`}
                    title="Rename request"
                    className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.name} from collection`}
                    className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {activeItems.length > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-ivory-600">
              Export uses <Badge variant="default">{"{{baseUrl}}"}</Badge> and{" "}
              <Badge variant="default">{"{{accessToken}}"}</Badge> variables - no secrets land in
              the file. Collections persist in this browser via IndexedDB.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
          <div className="flex-1">
            {activeItems.length > 0 &&
              (confirmClear ? (
                <span className="flex items-center gap-2 text-xs text-ivory-700">
                  Clear {activeItems.length} from “{active?.name}”?
                  <button type="button" onClick={() => { onClearActive(); setConfirmClear(false); }} className="font-semibold text-red-700 underline cursor-pointer">
                    Yes, clear
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="underline cursor-pointer">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-xs text-ivory-600 hover:text-red-700 underline cursor-pointer"
                >
                  Clear this collection
                </button>
              ))}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="secondary" onClick={handleCopy} disabled={activeItems.length === 0}>
              {copied ? "Copied!" : "Copy JSON"}
            </Button>
            <Button
              onClick={() => downloadTextFile(collectionFileName(), json)}
              disabled={activeItems.length === 0}
            >
              Download Postman collection
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
