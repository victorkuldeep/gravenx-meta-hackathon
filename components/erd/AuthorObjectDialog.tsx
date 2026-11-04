"use client";

import { useState } from "react";
import {
  apiNameFromLabel,
  defaultObjectDraft,
  validateObjectDraft,
  type ObjectDraft,
} from "@/lib/salesforce/design";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";

interface AuthorObjectDialogProps {
  busy: boolean;
  serverError: string | null;
  isProduction: boolean;
  onClose: () => void;
  onDeploy: (draft: ObjectDraft) => void;
}

export function AuthorObjectDialog({
  busy,
  serverError,
  isProduction,
  onClose,
  onDeploy,
}: AuthorObjectDialogProps) {
  const [draft, setDraft] = useState<ObjectDraft>(defaultObjectDraft);
  const [apiTouched, setApiTouched] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof ObjectDraft>(k: K, v: ObjectDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setLocalError(null);
  };

  const submit = () => {
    const err = validateObjectDraft(draft);
    if (err) {
      setLocalError(err);
      return;
    }
    if (confirm.trim() !== draft.apiName.trim()) {
      setLocalError(`Type ${draft.apiName.trim()} to confirm this creates a live object.`);
      return;
    }
    onDeploy(draft);
  };

  const err = localError ?? serverError;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="author-object-title"
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
            <h2 id="author-object-title" className="mt-1 text-lg font-bold text-ivory-950">
              New custom object
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close new object dialog"
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
              placeholder="Invoice"
              value={draft.label}
              onChange={(e) => {
                const label = e.target.value;
                setDraft((d) => ({
                  ...d,
                  label,
                  apiName: apiTouched ? d.apiName : apiNameFromLabel(label),
                  pluralLabel: d.pluralLabel === "" || d.pluralLabel === `${d.label}s` ? `${label}s` : d.pluralLabel,
                }));
                setLocalError(null);
              }}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              label="Plural label"
              placeholder="Invoices"
              value={draft.pluralLabel}
              onChange={(e) => set("pluralLabel", e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="API name"
              placeholder="Invoice__c"
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
            <Input
              label="Record name field"
              placeholder="Name"
              value={draft.nameFieldLabel}
              onChange={(e) => set("nameFieldLabel", e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Input
            label="Description (optional)"
            placeholder="Billing line items for project work"
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Deployment status"
              value={draft.deploymentStatus}
              onChange={(e) => set("deploymentStatus", e.target.value as ObjectDraft["deploymentStatus"])}
              disabled={busy}
            >
              <option value="Deployed">Deployed</option>
              <option value="InDevelopment">In Development</option>
            </Select>
            <Select
              label="Sharing"
              value={draft.sharingModel}
              onChange={(e) => set("sharingModel", e.target.value as ObjectDraft["sharingModel"])}
              disabled={busy}
            >
              <option value="ReadWrite">Public Read/Write</option>
              <option value="Read">Public Read Only</option>
              <option value="Private">Private</option>
            </Select>
          </div>
          <Input
            label={`Type ${draft.apiName.trim() || "…"} to confirm`}
            placeholder={draft.apiName.trim() || "Invoice__c"}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setLocalError(null);
            }}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            hint="Object creates land on the canvas after deploy"
          />
          {isProduction && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
              Production org: this object goes live immediately. Prefer a sandbox for design work.
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
              Deploy object
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
