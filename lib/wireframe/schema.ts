import { getActivePicklistValues, getFieldEditorType } from "@/lib/salesforce/metadata";
import type { SalesforceDescribeResult, SalesforceField } from "@/lib/salesforce/types";
import type { ComponentKind, WireComponent } from "./model";
import { newComponent } from "./registry";

/**
 * EPIC 05 bridge: Salesforce describe metadata -> wireframe components.
 * Pure functions only - fetching lives in `useWireSchema`. GRAVENX
 * consumes the org's live schema; it never invents a parallel model.
 */

/** Fields hidden from the palette (kept bindable by hand in the Inspector). */
export function isPaletteField(f: SalesforceField): boolean {
  return !f.deprecatedAndHidden;
}

/**
 * Salesforce field type -> the Salesforce-aware component that edits it
 * best. Bound fields always land on `sf*` kinds (except boolean, which has
 * no Salesforce-specific renderer) so the canvas reads as Salesforce-native;
 * generic kinds stay for unbound, proposed and external data.
 */
export function fieldToComponentKind(f: SalesforceField): ComponentKind {
  switch (getFieldEditorType(f)) {
    case "boolean":
      return "checkbox";
    case "picklist":
    case "multipicklist":
      return "sfpicklist";
    case "reference":
      return "sflookup";
    default:
      return "sffield";
  }
}

/**
 * Build a live-schema-bound component for `field` on `screenId`.
 * Label, binding, required-ness and picklist options come from describe;
 * the architect can still retarget everything in the Inspector.
 */
export function buildBoundComponent(
  f: SalesforceField,
  objectName: string,
  screenId: string,
): WireComponent {
  const base = newComponent(fieldToComponentKind(f), screenId);
  const props: Record<string, unknown> = { ...base.props };
  if (base.kind === "sfpicklist") {
    const options = getActivePicklistValues(f).map((v) => v.label || v.value);
    if (options.length > 0) props.options = options.slice(0, 100);
  }
  if (base.kind === "sflookup" && f.referenceTo.length > 0) {
    props.referenceTo = [...f.referenceTo];
  }
  return {
    ...base,
    label: f.label || f.name,
    bindingState: "existing",
    binding: { source: "salesforce", object: objectName, field: f.name },
    validation: { required: !f.nillable },
    props,
  };
}

/** Palette-ready fields for an object describe, in describe order. */
export function paletteFields(describe: SalesforceDescribeResult | null | undefined): SalesforceField[] {
  if (!describe) return [];
  return describe.fields.filter(isPaletteField);
}
