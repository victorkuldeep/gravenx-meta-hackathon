"use client";

import { SalesforceField, OperationType } from "@/lib/salesforce/types";
import { getWritableFields, isRequiredField } from "@/lib/salesforce/metadata";
import FieldEditor from "./FieldEditor";
import Button from "./ui/Button";
import Badge from "./ui/Badge";

interface PayloadPanelProps {
  selectedFields: SalesforceField[];
  fieldValues: Record<string, unknown>;
  operation: OperationType;
  recordId: string;
  onFieldValueChange: (fieldName: string, value: unknown) => void;
  onOperationChange: (op: OperationType) => void;
  onRecordIdChange: (id: string) => void;
  onGeneratePayload: () => void;
  onGenerateSamples: () => void;
}

export default function PayloadPanel({
  selectedFields,
  fieldValues,
  operation,
  recordId,
  onFieldValueChange,
  onOperationChange,
  onRecordIdChange,
  onGeneratePayload,
  onGenerateSamples,
}: PayloadPanelProps) {
  const writableFields = getWritableFields(selectedFields, operation);

  if (selectedFields.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-center">
        <p className="text-sm text-ivory-600">Select fields above to configure payload values.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="border-b border-ivory-400 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-ivory-900">Payload Values</h2>
            <div className="flex rounded border border-ivory-400 overflow-hidden">
              <button
                className={`px-3 py-1 text-xs font-medium tracking-wide transition-colors ${
                  operation === "POST"
                    ? "bg-ivory-950 text-ivory-100"
                    : "bg-ivory-100 text-ivory-700 hover:text-ivory-950"
                }`}
                onClick={() => onOperationChange("POST")}
                aria-pressed={operation === "POST"}
              >
                POST
              </button>
              <button
                className={`px-3 py-1 text-xs font-medium tracking-wide transition-colors ${
                  operation === "PATCH"
                    ? "bg-ivory-950 text-ivory-100"
                    : "bg-ivory-100 text-ivory-700 hover:text-ivory-950"
                }`}
                onClick={() => onOperationChange("PATCH")}
                aria-pressed={operation === "PATCH"}
              >
                PATCH
              </button>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onGenerateSamples}>
            Generate Sample Values
          </Button>
        </div>

        {operation === "PATCH" && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-ivory-700 mb-1">
              Record ID <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={recordId}
              onChange={(e) => onRecordIdChange(e.target.value)}
              placeholder="Record ID (15 or 18 characters)"
              className="w-full rounded border border-ivory-400 bg-white px-3 py-2 text-sm font-mono text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none focus:ring-1 focus:ring-bronze-500"
              maxLength={18}
              spellCheck={false}
            />
          </div>
        )}

        {writableFields.length < selectedFields.length && (
          <p className="mt-2 text-xs text-ivory-600">
            {selectedFields.length - writableFields.length} selected field(s) are not writable for {operation} and are excluded.
          </p>
        )}
      </div>

      <div className="divide-y divide-ivory-300">
        {writableFields.map((field) => {
          const isRequired = isRequiredField(field, operation);
          return (
            <div key={field.name} className="px-4 py-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-ivory-950">
                  {field.label}
                  {isRequired && <span className="ml-1 text-red-600">*</span>}
                </label>
                <span className="font-mono text-xs text-ivory-600">{field.name}</span>
                <Badge variant="default">{field.type}</Badge>
                {isRequired && <Badge variant="error">Required</Badge>}
                {field.type === "reference" && field.referenceTo.length > 0 && (
                  <Badge color="purple">→ {field.referenceTo.join(", ")}</Badge>
                )}
              </div>
              <FieldEditor
                field={field}
                value={fieldValues[field.name]}
                onChange={onFieldValueChange}
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-ivory-400 p-4">
        <Button onClick={onGeneratePayload} className="w-full sm:w-auto">
          Generate Payload
        </Button>
        <p className="mt-2 text-xs text-ivory-600">
          Only fields writable for {operation} will be included.
        </p>
      </div>
    </div>
  );
}
