"use client";

import { useMemo, useState } from "react";
import {
  DESIGN_FIELD_TYPES,
  apiNameFromLabel,
  defaultFieldDraft,
  labelFromApiName,
  relationshipNameFromField,
  validateFieldDraft,
  type DesignFieldType,
  type FieldDraft,
} from "@/lib/salesforce/design";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";

export interface FieldDialogInitial {
  /** Preselect the type (edge-drawn relationships start at Lookup). */
  type?: DesignFieldType;
  /** Lock the related object (edge-drawn relationships). */
  referenceTo?: string;
  lockReferenceTo?: boolean;
}

interface AuthorFieldDialogProps {
  /** Object the field lands on (the relationship child). */
  objectApi: string;
  objectLabel: string;
  /** Canvas objects for the relationship target picker. */
  objectOptions: { name: string; label: string }[];
  initial?: FieldDialogInitial;
  busy: boolean;
  serverError: string | null;
  isProduction: boolean;
  onClose: () => void;
  onDeploy: (draft: FieldDraft, childApi: string) => void;
}

function Check({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 text-xs text-ivory-700 select-none"
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[#7A5C3A] cursor-pointer"
      />
      {label}
    </label>
  );
}

export function AuthorFieldDialog({
  objectApi,
  objectLabel,
  objectOptions,
  initial,
  busy,
  serverError,
  isProduction,
  onClose,
  onDeploy,
}: AuthorFieldDialogProps) {
  const [childApi, setChildApi] = useState(objectApi);
  const [draft, setDraft] = useState<FieldDraft>(() => ({
    ...defaultFieldDraft(),
    type: initial?.type ?? "Text",
    referenceTo: initial?.referenceTo ?? "",
    relationshipLabel: initial?.referenceTo ? labelFromApiName(initial.referenceTo) : "",
    relationshipName: initial?.referenceTo ? "" : "",
  }));
  const [apiTouched, setApiTouched] = useState(false);
  const [, setRelTouched] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isRelationship = draft.type === "Lookup" || draft.type === "MasterDetail";
  const set = <K extends keyof FieldDraft>(k: K, v: FieldDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setLocalError(null);
  };

  const onLabel = (label: string) => {
    setDraft((d) => ({
      ...d,
      label,
      apiName: apiTouched ? d.apiName : apiNameFromLabel(label),
    }));
    setLocalError(null);
  };

  const targets = useMemo(
    () => objectOptions.filter((o) => o.name !== childApi),
    [objectOptions, childApi]
  );

  const swapEnds = () => {
    if (!initial?.lockReferenceTo) return;
    const nextChild = draft.referenceTo;
    if (!nextChild) return;
    setChildApi(nextChild);
    setDraft((d) => ({
      ...d,
      referenceTo: objectApi,
      relationshipLabel: labelFromApiName(objectApi),
      relationshipName: relationshipNameFromField(d.apiName || apiNameFromLabel(d.label || "Field")),
    }));
    setRelTouched(true);
  };

  const submit = () => {
    const err = validateFieldDraft(draft, { isRelationship });
    if (err) {
      setLocalError(err);
      return;
    }
    onDeploy(draft, childApi);
  };

  const err = localError ?? serverError;
  const showLength =
    draft.type === "Text" ||
    draft.type === "TextArea" ||
    draft.type === "LongTextArea" ||
    draft.type === "Email" ||
    draft.type === "Phone" ||
    draft.type === "Url";
  const showNumeric = draft.type === "Number" || draft.type === "Currency" || draft.type === "Percent";
  const showFlags =
    draft.type === "Text" ||
    draft.type === "Email" ||
    draft.type === "Phone" ||
    draft.type === "Url" ||
    draft.type === "Number";

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="author-field-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-card max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Author on the org
            </p>
            <h2 id="author-field-title" className="mt-1 text-lg font-bold text-ivory-950">
              New field on {objectLabel}
            </h2>
            <p className="font-mono text-[11px] text-ivory-500">{childApi}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close new field dialog"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Label"
              placeholder="Risk Score"
              value={draft.label}
              onChange={(e) => onLabel(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              label="API name"
              placeholder="Risk_Score__c"
              value={draft.apiName}
              onChange={(e) => {
                setApiTouched(true);
                set("apiName", e.target.value);
              }}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              hint="Must end with __c"
            />
          </div>
          <Select
            label="Type"
            value={draft.type}
            onChange={(e) => set("type", e.target.value as DesignFieldType)}
            disabled={busy}
          >
            {DESIGN_FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>

          {isRelationship && (
            <div className="rounded-lg border border-[var(--color-accent-soft)] bg-[var(--color-accent-bg)] p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-ivory-950">
                  {childApi} <span className="text-ivory-500 font-normal">references</span>{" "}
                  {draft.referenceTo || "…"}
                </p>
                {initial?.lockReferenceTo && (
                  <button
                    type="button"
                    onClick={swapEnds}
                    disabled={busy}
                    className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 underline cursor-pointer disabled:opacity-40"
                  >
                    Swap ends
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ivory-800" htmlFor="author-reParent">
                    Related object
                  </label>
                  <input
                    id="author-reParent"
                    list="author-object-targets"
                    value={draft.referenceTo}
                    disabled={busy || initial?.lockReferenceTo}
                    onChange={(e) => set("referenceTo", e.target.value)}
                    placeholder="Account"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-ivory-950 placeholder:text-ivory-500 focus:border-bronze-500 focus:outline-none disabled:opacity-50"
                  />
                  <datalist id="author-object-targets">
                    {targets.map((o) => (
                      <option key={o.name} value={o.name}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                </div>
                <Input
                  label="Relationship label"
                  placeholder="Primary Contact"
                  value={draft.relationshipLabel}
                  onChange={(e) => {
                    setRelTouched(true);
                    set("relationshipLabel", e.target.value);
                  }}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Input
                label="Relationship name"
                placeholder="Primary_Contact"
                value={draft.relationshipName}
                onChange={(e) => {
                  setRelTouched(true);
                  set("relationshipName", e.target.value);
                }}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                hint={`No __c or __r - try ${relationshipNameFromField(draft.apiName || "Field__c")}`}
              />
              {draft.type === "Lookup" ? (
                <Check label="Required" checked={draft.required} onChange={(v) => set("required", v)} />
              ) : (
                <Check
                  label="Allow reparenting"
                  checked={draft.reparentable}
                  onChange={(v) => set("reparentable", v)}
                  title="Records can be reparented to another master"
                />
              )}
            </div>
          )}

          {showLength && (
            <Input
              label={draft.type === "LongTextArea" ? "Length (256-131072)" : "Length (1-255)"}
              type="number"
              value={String(draft.length)}
              onChange={(e) => set("length", Number(e.target.value) || 0)}
              disabled={busy}
            />
          )}
          {showNumeric && (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Precision (1-18)"
                type="number"
                value={String(draft.precision)}
                onChange={(e) => set("precision", Number(e.target.value) || 0)}
                disabled={busy}
              />
              <Input
                label="Decimals"
                type="number"
                value={String(draft.scale)}
                onChange={(e) => set("scale", Number(e.target.value) || 0)}
                disabled={busy}
              />
            </div>
          )}
          {draft.type === "Checkbox" && (
            <Check
              label="Checked by default"
              checked={draft.defaultCheckbox}
              onChange={(v) => set("defaultCheckbox", v)}
            />
          )}
          {showFlags && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Check label="Required" checked={draft.required} onChange={(v) => set("required", v)} />
              <Check
                label="Unique"
                checked={draft.unique}
                onChange={(v) => set("unique", v)}
                title="No duplicate values allowed"
              />
              <Check
                label="External ID"
                checked={draft.externalId}
                onChange={(v) => set("externalId", v)}
                title="Usable as an upsert key from integrations"
              />
            </div>
          )}
          {draft.type === "Picklist" && (
            <PicklistEditor draft={draft} set={set} busy={busy} />
          )}

          {isProduction && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              Production org: this deploys live immediately. Prefer a sandbox for design work.
            </p>
          )}
          {err && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {err}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 text-[11px] leading-relaxed text-ivory-600">
            Deploys via the Tooling API to this org only - nothing is stored here.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={busy}>
              Deploy field
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PicklistEditor({
  draft,
  set,
  busy,
}: {
  draft: FieldDraft;
  set: <K extends keyof FieldDraft>(k: K, v: FieldDraft[K]) => void;
  busy: boolean;
}) {
  const text = draft.picklistValues.join("\n");
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-ivory-800" htmlFor="author-pick-values">
          Values (one per line)
        </label>
        <textarea
          id="author-pick-values"
          value={text}
          disabled={busy}
          rows={4}
          onChange={(e) =>
            set(
              "picklistValues",
              e.target.value.split("\n").map((v) => v.trim()).filter(Boolean)
            )
          }
          placeholder={"Low\nMedium\nHigh"}
          spellCheck={false}
          className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-ivory-950 placeholder:text-ivory-500 focus:border-bronze-500 focus:outline-none disabled:opacity-50"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label="Default value"
          value={draft.picklistDefault}
          onChange={(e) => set("picklistDefault", e.target.value)}
          disabled={busy}
        >
          <option value="">— None —</option>
          {draft.picklistValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <div className="flex items-end pb-2">
          <Check
            label="Restrict to list"
            checked={draft.picklistRestricted}
            onChange={(v) => set("picklistRestricted", v)}
            title="Block API values outside the list"
          />
        </div>
      </div>
    </div>
  );
}
