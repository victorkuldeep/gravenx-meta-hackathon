import type { Experience, ProposedField, WireComponent } from "./model";

/**
 * EPIC 06 - proposed schema authoring + schema delta.
 * Proposed fields are the design's ask of the org: named, typed, and
 * rolled up per object so the Author queue gets a clean worklist.
 */

export const PROPOSED_FIELD_TYPES = [
  "Text",
  "TextArea",
  "Number",
  "Currency",
  "Percent",
  "Checkbox",
  "Date",
  "DateTime",
  "Picklist",
  "Multiselect Picklist",
  "Email",
  "Phone",
  "Url",
  "Lookup",
] as const;

/** "Annual Contract Value" -> "Annual_Contract_Value__c". */
export function suggestApiName(label: string): string {
  // A trailing __c is intent, not noise: lift it before sanitizing.
  const raw = label.trim().replace(/__c$/i, "");
  const stem = raw
    .replace(/[^A-Za-z0-9 ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  if (!stem) return "";
  const capped = stem.charAt(0).toUpperCase() + stem.slice(1);
  return `${capped}__c`;
}

/** Human-readable problems; empty means shippable to the Author queue. */
export function validateProposed(p: ProposedField): string[] {
  const problems: string[] = [];
  if (!p.object.trim()) problems.push("Object is required.");
  if (!/^[A-Za-z][A-Za-z0-9]*__c$/.test(p.apiName.trim())) {
    problems.push("API name must look like Custom_Field__c.");
  }
  if (!p.label.trim()) problems.push("Label is required.");
  if ((p.type === "Picklist" || p.type === "Multiselect Picklist") && (p.values ?? []).length === 0) {
    problems.push("Picklist needs at least one value.");
  }
  if (p.type === "Lookup" && (p.values ?? []).length === 0) {
    problems.push("Lookup needs its target object as the first value.");
  }
  return problems;
}

export interface DeltaObject {
  object: string;
  existing: string[];
  proposed: ProposedField[];
}

/** Per-object delta: live-bound fields vs the design's ask. In object order of first sight. */
export function schemaDelta(exp: Experience): DeltaObject[] {
  const order: string[] = [];
  const existing = new Map<string, Set<string>>();
  const proposed = new Map<string, ProposedField[]>();
  const touchExisting = (object: string) => {
    if (!existing.has(object)) {
      existing.set(object, new Set());
      order.push(object);
    }
  };
  for (const c of exp.components) {
    const obj = c.binding?.object?.trim();
    if (c.bindingState === "existing" && obj) {
      touchExisting(obj);
      const field = c.binding?.field?.trim();
      existing.get(obj)!.add(field ? `${obj}.${field}` : obj);
    }
  }
  for (const p of exp.proposedFields) {
    const obj = p.object.trim();
    if (!obj) continue;
    if (!proposed.has(obj)) {
      proposed.set(obj, []);
      if (!existing.has(obj)) order.push(obj);
    }
    const list = proposed.get(obj)!;
    if (!list.some((q) => q.apiName.toLowerCase() === p.apiName.toLowerCase())) list.push(p);
  }
  return order.map((object) => ({
    object,
    existing: [...(existing.get(object) ?? [])].sort(),
    proposed: [...(proposed.get(object) ?? [])].sort((a, b) => a.apiName.localeCompare(b.apiName)),
  }));
}

/** Components carrying an invalid proposal - the delta panel flags them. */
export function invalidProposals(components: WireComponent[]): { id: string; label: string; problems: string[] }[] {
  const out: { id: string; label: string; problems: string[] }[] = [];
  for (const c of components) {
    if (c.bindingState !== "proposed" || !c.proposedField) continue;
    const problems = validateProposed(c.proposedField);
    if (problems.length > 0) out.push({ id: c.id, label: c.label || c.kind, problems });
  }
  return out;
}
