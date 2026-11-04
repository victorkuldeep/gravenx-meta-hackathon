"use client";

import { useState } from "react";
import type { SalesforcePicklistValue } from "@/lib/salesforce/types";
import { PicklistPopover } from "./erd/PicklistPopover";

/**
 * Shared picklist inspector trigger: a right-side count button that opens
 * the floating values popover. Used in Single, Composite and GraphQL pickers
 * so 100-value lists never stretch a row. Must stopPropagation - it often
 * lives inside a <label> that would otherwise toggle a checkbox.
 */
export function PicklistValuesButton({
  objectName,
  objectLabel,
  fieldName,
  fieldLabel,
  fieldType,
  values,
}: {
  objectName: string;
  objectLabel: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  values: SalesforcePicklistValue[];
}) {
  const [open, setOpen] = useState<null | { x: number; y: number }>(null);

  if (values.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen({ x: rect.right + 8, y: rect.top });
        }}
        title={`View all ${values.length} values`}
        aria-label={`View ${fieldLabel} picklist values`}
        className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-bronze-300 bg-bronze-100 px-2 py-0.5 text-[11px] font-semibold text-bronze-700 transition-colors hover:bg-bronze-200"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M9 6h12M9 12h12M9 18h12" />
          <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="3.2" />
        </svg>
        {values.length}
      </button>
      {open && (
        <PicklistPopover
          pop={{
            apiName: objectName || fieldName,
            nodeLabel: objectLabel || objectName || "Field",
            fieldName,
            fieldType,
            values: values.slice(0, 200).map((v) => ({
              label: v.label ?? v.value,
              value: v.value,
              active: v.active !== false,
              isDefault: !!v.defaultValue,
            })),
            x: open.x,
            y: open.y,
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
