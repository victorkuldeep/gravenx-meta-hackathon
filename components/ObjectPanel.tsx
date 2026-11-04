"use client";

import { useState, useMemo } from "react";
import { SalesforceObject } from "@/lib/salesforce/types";
import { rankObjects } from "@/lib/search/rank";
import Badge from "./ui/Badge";
import Input from "./ui/Input";

interface ObjectPanelProps {
  objects: SalesforceObject[];
  selectedObject: SalesforceObject | null;
  loading: boolean;
  error: string | null;
  onSelect: (obj: SalesforceObject) => void;
}

export default function ObjectPanel({
  objects,
  selectedObject,
  loading,
  error,
  onSelect,
}: ObjectPanelProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => rankObjects(objects, search, Number.POSITIVE_INFINITY),
    [objects, search]
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center gap-2 text-sm text-ivory-700">
          <svg className="h-4 w-4 animate-spin text-bronze-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading objects...
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
          <h2 className="text-sm font-semibold text-ivory-900">Select Object</h2>
          <span className="text-xs text-ivory-600">{filtered.length} / {objects.length}</span>
        </div>
        <Input
          placeholder="Search objects by label or API name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search objects"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Salesforce objects">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-ivory-600">No objects found matching &quot;{search}&quot;</p>
        ) : (
          filtered.map((obj) => (
            <button
              key={obj.name}
              role="option"
              aria-selected={selectedObject?.name === obj.name}
              onClick={() => onSelect(obj)}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-ivory-300 focus-visible:bg-ivory-300 focus-visible:outline-none ${
                selectedObject?.name === obj.name
                  ? "bg-ivory-300 border-l-2 border-l-ivory-950"
                  : "border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="block truncate font-medium text-ivory-950">{obj.label}</span>
                  <span className="block truncate text-xs text-ivory-600 font-mono">{obj.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {obj.custom && <Badge variant="info">Custom</Badge>}
                  {obj.createable && <Badge variant="success">C</Badge>}
                  {obj.updateable && <Badge color="yellow">U</Badge>}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
