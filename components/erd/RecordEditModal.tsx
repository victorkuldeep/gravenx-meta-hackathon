"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import { FieldInput, formatCellValue, type RecordFieldMeta } from "./RecordPopover";
import { LookupPickerModal, type LookupHit } from "./LookupPickerModal";
import { serializeDraftValue, targetApiForId } from "@/lib/erd/recordWalk";
import type { ObjectLayout } from "@/lib/salesforce/layouts";

export interface EditModalData {
  apiName: string;
  objectLabel: string;
  recordId: string;
  recordName: string;
  rawFields: Record<string, unknown>;
  metas: RecordFieldMeta[];
  layouts: ObjectLayout[];
  layoutsLoading: boolean;
  layoutsError: string | null;
  /** Object labels for picker tabs, e.g. User -> "User". */
  objectLabelOf: (apiName: string) => string;
  /** Search target records for the lookup picker. */
  onLookupSearch: (apiName: string, query: string) => Promise<LookupHit[]>;
  /** Resolve one lookup Id to its human label; null = show raw Id. */
  onResolveLookup: (apiName: string, id: string) => Promise<string | null>;
}

type Draft = Record<string, string | boolean>;

const rawStr = (v: unknown): string | boolean => (typeof v === "boolean" ? v : String(v ?? ""));

/** Diff the draft against server truth - the review list and the PATCH body. */
export function computeChanges(
  metas: RecordFieldMeta[],
  rawFields: Record<string, unknown>,
  draft: Draft,
): { field: string; label: string; from: string; to: string; body: Record<string, unknown> }[] {
  const out: { field: string; label: string; from: string; to: string; body: Record<string, unknown> }[] = [];
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (k === "Id") continue;
    const meta = metas.find((m) => m.name === k);
    if (!meta?.updateable) continue;
    const original = rawFields[k];
    const orig = rawStr(original);
    if (v === orig || (v === "" && (original === null || original === undefined || original === ""))) continue;
    const serialized = serializeDraftValue(meta.type, v);
    if (serialized === undefined) continue;
    body[k] = serialized;
    out.push({ field: k, label: meta.label || k, from: typeof orig === "boolean" ? String(orig) : orig === "" ? "—" : orig, to: typeof v === "boolean" ? String(v) : v === "" ? "—" : v, body });
  }
  return out;
}

const isEditable = (meta: RecordFieldMeta | undefined, layoutEditable = true): boolean =>
  !!meta && meta.updateable && meta.name !== "Id" && layoutEditable;

function LookupSearchButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Search records for ${label} - or type the Id by hand`}
      aria-label={`Search records for ${label}`}
      className="shrink-0 rounded-md border border-[var(--color-line)] bg-white p-1.5 text-ivory-500 hover:text-bronze-600 hover:border-bronze-400 transition-colors cursor-pointer"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    </button>
  );
}

/**
 * Resolved human label under a raw reference Id ("Acme" under an
 * AccountId). Read-only text; falls back to the target type ("User").
 * Renders nothing when there is no Id, no target, or no label.
 */
function ReferenceCaption({
  targetApi,
  targetId,
  resolve,
  right,
}: {
  targetApi: string | null;
  targetId: string | null;
  resolve: (apiName: string, id: string) => Promise<string | null>;
  right?: boolean;
}) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!targetApi || !targetId) {
      setLabel(null);
      return;
    }
    let live = true;
    setLabel(null);
    void resolve(targetApi, targetId).then((name) => {
      if (live) setLabel(name);
    });
    return () => {
      live = false;
    };
  }, [targetApi, targetId, resolve]);
  if (!targetId || !targetApi) return null;
  return (
    <p className={`mt-0.5 truncate text-[11px] text-[var(--color-muted)]${right ? " text-right" : ""}`} title={label ?? undefined}>
      {label ?? targetApi}
    </p>
  );
}

function FieldRow({
  meta,
  apiName,
  value,
  draftValue,
  onDraft,
  onLookupPicker,
  lookupTarget,
  lookupId,
  resolveLookup,
}: {
  meta: RecordFieldMeta | undefined;
  apiName: string;
  value: unknown;
  draftValue: string | boolean | undefined;
  onDraft: (v: string | boolean) => void;
  onLookupPicker: ((meta: RecordFieldMeta) => void) | null;
  /** Polymorphic target + current Id for reference captions (null when n/a). */
  lookupTarget: string | null;
  lookupId: string | null;
  resolveLookup: (apiName: string, id: string) => Promise<string | null>;
}) {
  const editable = isEditable(meta);
  const targets = meta?.type === "reference" ? (meta.refs ?? []) : [];
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1.5 hover:border-[var(--color-line-soft)]">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-ivory-950" title={meta?.label ?? apiName}>
          {meta?.label ?? apiName}
          {meta?.required && <span className="ml-0.5 text-red-600" title="Required">*</span>}
        </span>
        <span className="block truncate font-mono text-[10px] text-ivory-500" title={apiName}>
          {apiName}{meta && !meta.updateable ? " · read-only" : ""}
        </span>
      </span>
      <span className="w-[220px] shrink-0">
        {editable ? (
          <span className="block">
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1">
                <FieldInput meta={meta} value={draftValue ?? (typeof value === "boolean" ? value : String(value ?? ""))} onChange={onDraft} />
              </span>
              {onLookupPicker && meta && targets.length > 0 && (
                <LookupSearchButton label={meta.label} onOpen={() => onLookupPicker(meta)} />
              )}
            </span>
            {targets.length > 0 && (
              <ReferenceCaption targetApi={lookupTarget} targetId={lookupId} resolve={resolveLookup} right />
            )}
          </span>
        ) : (
          <span className="block">
            <span className="block break-all text-right font-mono text-[11px] text-ivory-400" title={formatCellValue(value)}>
              {formatCellValue(value)}
            </span>
            {meta?.type === "reference" && (
              <ReferenceCaption targetApi={lookupTarget} targetId={lookupId} resolve={resolveLookup} right />
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Premium aligned cell for the All-fields tab: fixed 220px input column so
 * every control lines up across the 2-col grid, no matter the label length.
 * Edited cells get a bronze wash so progress is visible while scrolling.
 */
function FieldCell({
  meta,
  apiName,
  value,
  draftValue,
  edited,
  onDraft,
  onLookupPicker,
  lookupTarget,
  lookupId,
  resolveLookup,
}: {
  meta: RecordFieldMeta | undefined;
  apiName: string;
  value: unknown;
  draftValue: string | boolean | undefined;
  edited: boolean;
  onDraft: (v: string | boolean) => void;
  onLookupPicker: ((meta: RecordFieldMeta) => void) | null;
  /** Polymorphic target + current Id for reference captions (null when n/a). */
  lookupTarget: string | null;
  lookupId: string | null;
  resolveLookup: (apiName: string, id: string) => Promise<string | null>;
}) {
  const editable = isEditable(meta);
  const targets = meta?.type === "reference" ? (meta.refs ?? []) : [];
  return (
    <div className={`flex min-h-[56px] items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors ${
      edited ? "border-bronze-400 bg-bronze-100/60" : "border-[var(--color-line-soft)] bg-white"
    }`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-ivory-950" title={meta?.label ?? apiName}>
          {meta?.label ?? apiName}
          {meta?.required && <span className="ml-0.5 text-red-600" title="Required">*</span>}
        </span>
        <span className="block truncate font-mono text-[10px] text-ivory-500" title={apiName}>
          {apiName}{meta && !meta.updateable ? " · read-only" : ""}
        </span>
      </span>
      <span className="w-[210px] shrink-0">
        {editable ? (
          <span className="block">
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1">
                <FieldInput meta={meta} value={draftValue ?? (typeof value === "boolean" ? value : String(value ?? ""))} onChange={onDraft} />
              </span>
              {onLookupPicker && meta && targets.length > 0 && (
                <LookupSearchButton label={meta.label} onOpen={() => onLookupPicker(meta)} />
              )}
            </span>
            {targets.length > 0 && (
              <ReferenceCaption targetApi={lookupTarget} targetId={lookupId} resolve={resolveLookup} right />
            )}
          </span>
        ) : (
          <span className="block">
            <span className="block break-all text-right font-mono text-[11px] text-ivory-400" title={formatCellValue(value)}>
              {formatCellValue(value)}
            </span>
            {meta?.type === "reference" && (
              <ReferenceCaption targetApi={lookupTarget} targetId={lookupId} resolve={resolveLookup} right />
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export function RecordEditModal({
  data,
  onClose,
  onSave,
}: {
  data: EditModalData;
  onClose: () => void;
  onSave: (apiName: string, id: string, changes: Record<string, unknown>) => Promise<void>;
}) {
  const [tab, setTab] = useState<string>("__all__");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pickerFor, setPickerFor] = useState<{
    meta: RecordFieldMeta;
    currentId: string | null;
    currentTarget: string | null;
    currentName: string | null;
  } | null>(null);

  // Fresh record, fresh draft.
  useEffect(() => {
    setTab("__all__");
    setFilter("");
    setDraft({});
    setReviewing(false);
    setSaving(false);
    setSaveError(null);
    setConfirmDiscard(false);
    setPickerFor(null);
  }, [data.apiName, data.recordId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const metaOf = (apiName: string) => data.metas.find((m) => m.name === apiName);

  /**
   * Current lookup context for a reference field: polymorphic target from
   * the live Id (draft wins over saved), falling back to the first declared
   * target for single-target refs. Powers captions and picker preselect.
   */
  const lookupContext = (meta: RecordFieldMeta): { target: string | null; id: string | null } => {
    const refs = meta.refs ?? [];
    const raw = data.rawFields[meta.name];
    const dv = draft[meta.name];
    const id =
      typeof dv === "string" && dv.trim() !== ""
        ? dv.trim()
        : typeof raw === "string" && raw.trim() !== ""
          ? raw.trim()
          : null;
    const target = (id ? targetApiForId(refs, id) : null) ?? refs[0] ?? null;
    return { target, id };
  };

  /** Open the lookup picker with the current value preselected. */
  const openPicker = (meta: RecordFieldMeta) => {
    const ctx = lookupContext(meta);
    setPickerFor({ meta, currentId: ctx.id, currentTarget: ctx.target, currentName: null });
    if (ctx.id && ctx.target) {
      void data.onResolveLookup(ctx.target, ctx.id).then((name) => {
        setPickerFor((prev) => (prev && prev.meta.name === meta.name ? { ...prev, currentName: name } : prev));
      });
    }
  };
  const changes = useMemo(() => computeChanges(data.metas, data.rawFields, draft), [data.metas, data.rawFields, draft]);
  const changeBody = useMemo(() => {
    const body: Record<string, unknown> = {};
    for (const c of changes) Object.assign(body, c.body);
    return body;
  }, [changes]);
  const changedSet = useMemo(() => new Set(changes.map((c) => c.field)), [changes]);
  const dirty = Object.keys(draft).length > 0;
  const editableCount = data.metas.filter((m) => m.updateable && m.name !== "Id").length;

  const q = filter.trim().toLowerCase();
  const allFields = q
    ? data.metas.filter((m) => m.name.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
    : data.metas;

  const confirmSave = () => {
    if (changes.length === 0) return;
    setSaving(true);
    setSaveError(null);
    void onSave(data.apiName, data.recordId, changeBody)
      .then(() => onClose())
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : "Save failed.");
        setSaving(false);
      });
  };

  const tryClose = () => {
    if (saving) return;
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      window.setTimeout(() => setConfirmDiscard(false), 3000);
      return;
    }
    onClose();
  };

  const activeLayout = data.layouts.find((l) => l.id === tab) ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${data.objectLabel} record`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) tryClose();
      }}
    >
      <div className="flex h-full max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_32px_96px_-16px_rgba(24,20,12,0.5)]">
        {/* Header */}
        <div className="shrink-0 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold text-ivory-950">
                Edit {data.objectLabel}
              </p>
              <p className="truncate font-mono text-[11px] text-ivory-600" title={`${data.recordName} · ${data.recordId}`}>
                {data.recordName} · {data.recordId}
              </p>
            </div>
            {changes.length > 0 && !reviewing && (
              <span className="shrink-0 rounded-full border border-bronze-300 bg-bronze-100 px-2 py-0.5 font-mono text-[10px] font-bold text-bronze-700">
                {changes.length} edited
              </span>
            )}
            <button
              type="button"
              onClick={tryClose}
              title={dirty && !confirmDiscard ? "Click again to discard edits" : "Close without saving"}
              aria-label="Close edit modal"
              className={`shrink-0 rounded px-2 py-1 text-[12px] font-semibold transition-colors cursor-pointer ${
                confirmDiscard ? "bg-red-600 text-white hover:bg-red-700" : "text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200"
              }`}
            >
              {confirmDiscard ? "Discard edits?" : "✕ Close"}
            </button>
          </div>
          {/* Tabs */}
          <div className="mt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="Field groups">
            <button
              key="__all__"
              type="button"
              role="tab"
              aria-selected={tab === "__all__"}
              onClick={() => {
                setTab("__all__");
                setReviewing(false);
              }}
              title="Every field on the object"
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer ${
                tab === "__all__" ? "bg-ivory-950 text-ivory-100" : "text-ivory-600 hover:text-ivory-950 hover:bg-ivory-200"
              }`}
            >
              All fields
            </button>
            {data.layouts.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={tab === l.id}
                onClick={() => {
                  setTab(l.id);
                  setReviewing(false);
                }}
                title={`Page layout${l.defaultLayout ? " (default)" : ""}`}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer ${
                  tab === l.id ? "bg-ivory-950 text-ivory-100" : "text-ivory-600 hover:text-ivory-950 hover:bg-ivory-200"
                }`}
              >
                {l.name}
              </button>
            ))}
            {data.layoutsLoading && (
              <span className="shrink-0 self-center px-2 font-mono text-[10px] text-bronze-600">Loading layouts…</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {saveError && (
            <p className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
              {saveError}
            </p>
          )}
          {data.layoutsError && (
            <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              Page layouts unavailable ({data.layoutsError}) - All fields still edits everything.
            </p>
          )}
          {reviewing ? (
            <div>
              <p className="px-1 pb-2 text-[12px] font-semibold text-ivory-950">
                Review {changes.length} change{changes.length === 1 ? "" : "s"} - one PATCH, then the box refreshes from the server.
              </p>
              {changes.length === 0 ? (
                <p className="px-1 py-2 text-[12px] text-ivory-600">Nothing changed yet - go back and edit a field.</p>
              ) : (
                <dl className="divide-y divide-[var(--color-line-soft)] rounded-xl border border-[var(--color-line-soft)]">
                  {changes.map((c) => (
                    <div key={c.field} className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 px-3 py-2">
                      <dt className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold text-ivory-950" title={c.label}>{c.label}</span>
                        <span className="block truncate font-mono text-[10px] text-ivory-500">{c.field}</span>
                      </dt>
                      <dd className="max-w-[220px] break-all text-right font-mono text-[11px] text-ivory-500" title={c.from}>{c.from}</dd>
                      <dd className="max-w-[220px] break-all text-right font-mono text-[11px] font-bold text-bronze-700" title={c.to}>→ {c.to}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ) : tab === "__all__" ? (
            <div>
              <div className="mb-2 px-1">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${data.metas.length} fields…`}
                  aria-label="Filter fields"
                  spellCheck={false}
                  autoComplete="off"
                  className="h-8 w-full max-w-xs rounded-lg border border-[var(--color-line)] bg-white px-2.5 text-[12px] text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
                />
              </div>
              {editableCount === 0 && (
                <p className="px-1 py-2 text-[12px] text-ivory-600">No updateable fields on this record - everything is read-only.</p>
              )}
              <div className="grid items-start gap-2 sm:grid-cols-2">
                {allFields.map((m) => {
                  const lc = lookupContext(m);
                  return (
                    <FieldCell
                      key={m.name}
                      meta={m}
                      apiName={m.name}
                      value={data.rawFields[m.name]}
                      draftValue={draft[m.name]}
                      edited={changedSet.has(m.name)}
                      onDraft={(v) => setDraft((p) => ({ ...p, [m.name]: v }))}
                      onLookupPicker={openPicker}
                      lookupTarget={lc.target}
                      lookupId={lc.id}
                      resolveLookup={data.onResolveLookup}
                    />
                  );
                })}
              </div>
              {allFields.length === 0 && (
                <p className="px-1 py-2 text-[12px] text-ivory-600">No fields match “{filter}”.</p>
              )}
            </div>
          ) : activeLayout ? (
            <div className="space-y-3">
              {activeLayout.sections.map((s, si) => (
                <section key={`${s.heading}-${si}`} aria-label={s.heading}>
                  <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[1.5px] text-ivory-600">{s.heading}</p>
                  <div className="space-y-2">
                    {s.rows.map((row, ri) => (
                      <div key={ri} className={`grid gap-2 ${row.length > 1 ? "sm:grid-cols-2" : ""}`}>
                        {row.map((item) => {
                          const meta = metaOf(item.apiName);
                          const editable = isEditable(meta, item.layoutEditable);
                          const lc = meta ? lookupContext(meta) : { target: null as string | null, id: null as string | null };
                          return (
                            <div
                              key={item.apiName}
                              className={`rounded-xl border px-2 py-1 ${editable ? "border-transparent hover:border-[var(--color-line-soft)]" : "border-[var(--color-line-soft)] bg-[var(--color-canvas)]"}`}
                            >
                              <FieldRow
                                meta={meta}
                                apiName={item.apiName}
                                value={data.rawFields[item.apiName]}
                                draftValue={draft[item.apiName]}
                                onDraft={(v) => setDraft((p) => ({ ...p, [item.apiName]: v }))}
                                onLookupPicker={openPicker}
                                lookupTarget={lc.target}
                                lookupId={lc.id}
                                resolveLookup={data.onResolveLookup}
                              />
                              {!meta && (
                                <p className="px-2 pb-1 font-mono text-[10px] text-ivory-500">Not in describe - saved as-is.</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-2.5">
          {!reviewing ? (
            <>
              <p className="min-w-0 flex-1 truncate text-[11px] text-ivory-600">
                {changes.length === 0 ? "No edits yet - change any field in any tab." : `${changes.length} field${changes.length === 1 ? "" : "s"} edited across tabs.`}
              </p>
              <Button size="sm" variant="ghost" disabled={saving} onClick={tryClose}>
                Cancel
              </Button>
              <Button size="sm" disabled={saving || changes.length === 0} onClick={() => setReviewing(true)} title="Review every change, then confirm one save">
                Review & save
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setReviewing(false)}>
                ← Back to fields
              </Button>
              <span className="min-w-0 flex-1" />
              <Button size="sm" disabled={saving || changes.length === 0} onClick={confirmSave} title={`PATCH ${changes.length} field${changes.length === 1 ? "" : "s"} on ${data.apiName}`}>
                {saving ? "Saving…" : `Confirm save (${changes.length})`}
              </Button>
            </>
          )}
        </div>
      </div>
      {pickerFor && (pickerFor.meta.refs ?? []).length > 0 && (
        <LookupPickerModal
          fieldLabel={pickerFor.meta.label}
          targets={pickerFor.meta.refs ?? []}
          initialTarget={pickerFor.currentTarget ?? undefined}
          currentId={pickerFor.currentId}
          currentName={pickerFor.currentName}
          targetLabelOf={data.objectLabelOf}
          onSearch={data.onLookupSearch}
          onPick={(id) => {
            setDraft((p) => ({ ...p, [pickerFor.meta.name]: id }));
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
