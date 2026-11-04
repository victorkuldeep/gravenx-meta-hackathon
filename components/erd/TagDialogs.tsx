"use client";

import { useState } from "react";
import { ERD_TAG_COLORS, cleanTagName, type ErdTag } from "@/lib/erd/tags";

/** Inline new-tag composer: free-text name + one of the 8 fixed colors. */
export function TagCreator({ onCreate, idPrefix }: { onCreate: (name: string, color: string) => void; idPrefix: string }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(ERD_TAG_COLORS[0]);
  const valid = cleanTagName(name) !== null;
  const submit = () => {
    if (!valid) return;
    onCreate(name, color);
    setName("");
  };
  return (
    <div>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`${idPrefix}-new-tag`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
          }}
          placeholder="New tag name…"
          aria-label="New tag name"
          maxLength={24}
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="h-7 shrink-0 cursor-pointer rounded-lg border border-ivory-950 bg-ivory-950 px-2.5 text-[11px] font-semibold text-ivory-100 transition-colors hover:bg-ivory-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5" role="group" aria-label="Tag color">
        {ERD_TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-pressed={color === c}
            title={c}
            aria-label={`Tag color ${c}`}
            style={{ backgroundColor: c }}
            className={`h-4 w-4 cursor-pointer rounded-full transition-transform hover:scale-110 ${
              color === c ? "ring-2 ring-ivory-950 ring-offset-2 ring-offset-[var(--color-surface)]" : ""
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/** Confirm modal for header-X removal: non-destructive, metadata stays cached. */
export function ConfirmRemoveDialog({ apiName, onConfirm, onClose }: { apiName: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Remove ${apiName}`} onClick={onClose}>
      <div className="modal-card max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3">
          <p className="text-sm font-bold text-ivory-950">Remove {apiName}?</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ivory-700">
            The table leaves the canvas and links redraw. Metadata stays cached - re-add it
            anytime from the explorer. Nothing is deleted on the org.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line-soft)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-ivory-700 transition-colors hover:text-ivory-950 hover:bg-ivory-200"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="cursor-pointer rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/** Per-node tag picker: tick tags on/off, create-and-assign inline. */
export function TagPickerDialog({
  apiName,
  registry,
  assignedIds,
  onToggle,
  onCreate,
  onManage,
  onClose,
}: {
  apiName: string;
  registry: ErdTag[];
  assignedIds: string[];
  onToggle: (api: string, id: string) => void;
  onCreate: (name: string, color: string) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Tags for ${apiName}`} onClick={onClose}>
      <div className="modal-card max-w-xs" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--color-line-soft)] px-4 pt-3.5 pb-2.5">
          <p className="text-xs font-bold text-ivory-950">
            Tags · <span className="font-mono">{apiName}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-ivory-500">Tick to tag - first tag tints the border. T reopens this.</p>
        </div>
        <div className="max-h-56 overflow-y-auto px-4 py-2.5">
          {registry.length === 0 ? (
            <p className="py-1 text-[11px] text-ivory-600">No tags yet - name one below, it lands on {apiName}.</p>
          ) : (
            <ul className="space-y-1">
              {registry.map((t) => {
                const on = assignedIds.includes(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onToggle(apiName, t.id)}
                      aria-pressed={on}
                      title={on ? `Untag ${apiName} as ${t.name}` : `Tag ${apiName} as ${t.name}`}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                        on
                          ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                          : "border-[var(--color-line-soft)] text-ivory-800 hover:border-[var(--color-accent)]"
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      {on && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" className="shrink-0">
                          <path d="m4 12.5 5 5L20 6.5" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2.5 border-t border-[var(--color-line-soft)] pt-2.5">
            <TagCreator onCreate={onCreate} idPrefix="tag-picker" />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--color-line-soft)] px-4 py-2.5">
          <button
            type="button"
            onClick={onManage}
            className="cursor-pointer text-[11px] font-semibold text-bronze-700 underline decoration-bronze-300 underline-offset-2 hover:text-bronze-800"
          >
            Manage tags…
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 transition-colors hover:bg-ivory-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function TagRow({
  tag,
  count,
  onRename,
  onRecolor,
  onDelete,
}: {
  tag: ErdTag;
  count: number;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(tag.name);
  const commit = () => {
    if (cleanTagName(draft) && draft.trim() !== tag.name) onRename(tag.id, draft);
    else setDraft(tag.name);
  };
  return (
    <li className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-2 py-1.5">
      <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={`Color for ${tag.name}`}>
        {ERD_TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onRecolor(tag.id, c)}
            title={`${tag.name} → ${c}`}
            aria-label={`Set ${tag.name} color to ${c}`}
            aria-pressed={tag.color.toUpperCase() === c.toUpperCase()}
            style={{ backgroundColor: c }}
            className={`h-3.5 w-3.5 cursor-pointer rounded-full transition-transform hover:scale-125 ${
              tag.color.toUpperCase() === c.toUpperCase() ? "ring-2 ring-ivory-950 ring-offset-1 ring-offset-[var(--color-surface)]" : "opacity-40"
            }`}
          />
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        aria-label={`Rename ${tag.name}`}
        maxLength={24}
        spellCheck={false}
        autoComplete="off"
        className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs font-medium text-ivory-950 hover:border-[var(--color-line-soft)] focus:border-bronze-500 focus:outline-none"
      />
      <span className="shrink-0 text-[10px] text-ivory-500" title={`${count} node${count === 1 ? "" : "s"} tagged`}>
        {count > 0 ? `×${count}` : "unused"}
      </span>
      <button
        type="button"
        onClick={() => onDelete(tag.id)}
        title={count > 0 ? `Delete ${tag.name} - strips it from ${count} node${count === 1 ? "" : "s"}` : `Delete ${tag.name}`}
        aria-label={`Delete ${tag.name}`}
        className="shrink-0 cursor-pointer rounded p-1 text-ivory-400 transition-colors hover:text-red-600 hover:bg-red-50"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </li>
  );
}

/** Registry manager: rename, recolor, delete, create. Reference-not-copy safe. */
export function TagManagerDialog({
  registry,
  counts,
  onRename,
  onRecolor,
  onDelete,
  onCreate,
  onClose,
}: {
  registry: ErdTag[];
  counts: Record<string, number>;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onCreate: (name: string, color: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Manage canvas tags" onClick={onClose}>
      <div className="modal-card max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--color-line-soft)] px-4 pt-3.5 pb-2.5">
          <p className="text-xs font-bold text-ivory-950">Canvas tags</p>
          <p className="mt-0.5 text-[10px] text-ivory-500">
            Fixed 8-color palette, free-text names - persisted on this canvas project. Deleting a tag strips it everywhere.
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto px-4 py-2.5">
          {registry.length === 0 ? (
            <p className="py-1 text-[11px] text-ivory-600">No tags yet - create the first one below, then T-tag nodes from the canvas.</p>
          ) : (
            <ul className="space-y-1.5">
              {registry.map((t) => (
                <TagRow key={t.id} tag={t} count={counts[t.id] ?? 0} onRename={onRename} onRecolor={onRecolor} onDelete={onDelete} />
              ))}
            </ul>
          )}
          <div className="mt-2.5 border-t border-[var(--color-line-soft)] pt-2.5">
            <TagCreator onCreate={onCreate} idPrefix="tag-manager" />
          </div>
        </div>
        <div className="flex items-center justify-end border-t border-[var(--color-line-soft)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 transition-colors hover:bg-ivory-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
