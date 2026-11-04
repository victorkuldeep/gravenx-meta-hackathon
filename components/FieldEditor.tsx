"use client";

import { SalesforceField } from "@/lib/salesforce/types";
import { getActivePicklistValues, getFieldEditorType } from "@/lib/salesforce/metadata";

interface FieldEditorProps {
  field: SalesforceField;
  value: unknown;
  onChange: (fieldName: string, value: unknown) => void;
}

export default function FieldEditor({ field, value, onChange }: FieldEditorProps) {
  const editorType = getFieldEditorType(field);
  const activePicklistValues = getActivePicklistValues(field);

  const inputClasses =
    "w-full rounded border border-ivory-400 bg-white px-3 py-1.5 text-sm text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none focus:ring-1 focus:ring-bronze-500";

  switch (editorType) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true || value === "true"}
            onChange={(e) => onChange(field.name, e.target.checked)}
            className="h-4 w-4 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500 focus:ring-offset-ivory-100"
            aria-label={field.label}
          />
          <span className="text-sm text-ivory-800">{field.label}</span>
        </label>
      );

    case "number":
      return (
        <input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          step={field.type === "int" ? "1" : "0.01"}
          placeholder={field.type === "int" ? "0" : "0.00"}
          aria-label={field.label}
        />
      );

    case "date":
      return (
        <input
          type="date"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          aria-label={field.label}
        />
      );

    case "datetime":
      return (
        <input
          type="datetime-local"
          value={
            value === undefined || value === null
              ? ""
              : String(value).replace(/\+\d{4}$/, "").replace("Z", "")
          }
          onChange={(e) => onChange(field.name, e.target.value ? `${e.target.value}:00.000+0000` : "")}
          className={inputClasses}
          aria-label={field.label}
        />
      );

    case "email":
      return (
        <input
          type="email"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          placeholder="user@example.com"
          aria-label={field.label}
        />
      );

    case "url":
      return (
        <input
          type="url"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          placeholder="https://example.com"
          aria-label={field.label}
        />
      );

    case "phone":
      return (
        <input
          type="tel"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          placeholder="+1 555 0100"
          aria-label={field.label}
        />
      );

    case "textarea":
      return (
        <textarea
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          rows={3}
          className={`${inputClasses} resize-y`}
          aria-label={field.label}
        />
      );

    case "picklist":
      return (
        <select
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          aria-label={field.label}
        >
          <option value="">-- Select --</option>
          {activePicklistValues.map((pv) => (
            <option key={pv.value} value={pv.value}>
              {pv.label}{pv.label !== pv.value ? ` (${pv.value})` : ""}
            </option>
          ))}
        </select>
      );

    case "multipicklist": {
      const currentValues = value
        ? String(value)
            .split(";")
            .filter(Boolean)
        : [];

      return (
        <div className="space-y-1">
          {activePicklistValues.map((pv) => (
            <label key={pv.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={currentValues.includes(pv.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...currentValues, pv.value]
                    : currentValues.filter((v) => v !== pv.value);
                  onChange(field.name, next.join(";"));
                }}
                className="h-4 w-4 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
              />
              <span className="text-sm text-ivory-800">
                {pv.label}
                {pv.label !== pv.value && <span className="font-mono text-xs text-ivory-500"> ({pv.value})</span>}
              </span>
            </label>
          ))}
          {activePicklistValues.length === 0 && (
            <input
              type="text"
              value={value === undefined || value === null ? "" : String(value)}
              onChange={(e) => onChange(field.name, e.target.value)}
              className={inputClasses}
              placeholder="Value1;Value2;Value3"
              aria-label={field.label}
            />
          )}
        </div>
      );
    }

    case "reference":
      return (
        <div>
          <input
            type="text"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(field.name, e.target.value)}
            className={inputClasses}
            placeholder="Salesforce ID (18-char)"
            maxLength={18}
            aria-label={field.label}
            spellCheck={false}
          />
          {field.referenceTo.length > 0 && (
            <p className="mt-1 text-xs text-ivory-600">
              References: {field.referenceTo.join(", ")}
            </p>
          )}
        </div>
      );

    default:
      return (
        <input
          type="text"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value)}
          className={inputClasses}
          aria-label={field.label}
        />
      );
  }
}
