"use client";

import { useState, useMemo } from "react";
import { SalesforceField, OperationType } from "@/lib/salesforce/types";
import { getWritableFields, isRequiredField } from "@/lib/salesforce/metadata";
import Badge from "./ui/Badge";
import Input from "./ui/Input";
import Button from "./ui/Button";
import { PicklistValuesButton } from "./PicklistValuesButton";

interface FieldPanelProps {
  fields: SalesforceField[];
  selectedFieldNames: Set<string>;
  operation: OperationType;
  loading: boolean;
  error: string | null;
  objectName?: string;
  objectLabel?: string;
  onToggleField: (fieldName: string) => void;
  onSelectAll: (fields: SalesforceField[]) => void;
  onClearAll: () => void;
}

type TypeFilter = "all" | "createable" | "updateable" | "required" | "reference" | "picklist";

export default function FieldPanel({
  fields,
  selectedFieldNames,
  operation,
  loading,
  error,
  objectName = "",
  objectLabel = "",
  onToggleField,
  onSelectAll,
  onClearAll,
}: FieldPanelProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const writableFields = useMemo(
    () => getWritableFields(fields, operation),
    [fields, operation]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return writableFields.filter((f) => {
      const matchesSearch =
        !q ||
        f.label.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q);

      const matchesFilter =
        typeFilter === "all" ||
        (typeFilter === "createable" && f.createable) ||
        (typeFilter === "updateable" && f.updateable) ||
        (typeFilter === "required" && isRequiredField(f, operation)) ||
        (typeFilter === "reference" && f.type === "reference") ||
        (typeFilter === "picklist" && (f.type === "picklist" || f.type === "multipicklist"));

      return matchesSearch && matchesFilter;
    });
  }, [writableFields, search, typeFilter, operation]);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center gap-2 text-sm text-ivory-700">
          <svg className="h-4 w-4 animate-spin text-bronze-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading fields...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="shrink-0 border-b border-ivory-400 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ivory-900">Select Fields</h2>
          <span className="text-xs text-ivory-600">
            {selectedFieldNames.size} selected / {writableFields.length} writable
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Input
              placeholder="Search fields..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search fields"
            />
          </div>
          <select
            className="rounded border border-ivory-400 bg-white px-3 py-2 text-sm text-ivory-950 focus:outline-none focus:ring-1 focus:ring-bronze-500"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            aria-label="Filter fields"
          >
            <option value="all">All writable</option>
            <option value="required">Required</option>
            <option value="createable">Createable</option>
            <option value="updateable">Updateable</option>
            <option value="reference">Reference</option>
            <option value="picklist">Picklist</option>
          </select>
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectAll(filtered)}
            disabled={filtered.length === 0}
          >
            Select All ({filtered.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            disabled={selectedFieldNames.size === 0}
          >
            Clear All
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="group" aria-label="Field selection">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-ivory-600">No fields match the current filter.</p>
        ) : (
          filtered.map((field) => {
            const isSelected = selectedFieldNames.has(field.name);
            const isRequired = isRequiredField(field, operation);
            const pickValues = field.picklistValues ?? [];
            const isPicklist =
              (field.type === "picklist" || field.type === "multipicklist") &&
              pickValues.length > 0;

            return (
              <label
                key={field.name}
                className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-ivory-300 ${
                  isSelected ? "bg-ivory-300" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleField(field.name)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500 focus:ring-offset-ivory-100"
                  aria-label={`Select field ${field.label}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ivory-950 text-sm">{field.label}</span>
                    {isRequired && <Badge variant="error">Required</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs text-ivory-600">{field.name}</span>
                    <Badge variant="default">{field.type}</Badge>
                    {field.type === "reference" && field.referenceTo.length > 0 && (
                      <Badge color="purple">→ {field.referenceTo.join(", ")}</Badge>
                    )}
                    {field.createable && operation === "POST" && (
                      <Badge variant="success">Createable</Badge>
                    )}
                    {field.updateable && operation === "PATCH" && (
                      <Badge color="yellow">Updateable</Badge>
                    )}
                    {isPicklist && (
                      <PicklistValuesButton
                        objectName={objectName}
                        objectLabel={objectLabel}
                        fieldName={field.name}
                        fieldLabel={field.label}
                        fieldType={field.type}
                        values={pickValues}
                      />
                    )}
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
