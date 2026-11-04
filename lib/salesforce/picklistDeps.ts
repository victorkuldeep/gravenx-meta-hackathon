/**
 * Picklist dependency graph from UI API object-info: which controller value
 * enables which dependent values. Bitmask decoding is LSB-first per byte
 * (Salesforce `validFor` convention); `controllerValues` on the dependent
 * field maps controlling labels to bit positions.
 */

export interface DepEdge {
  controller: string;
  controllerLabel: string;
  dependent: string;
  dependentLabel: string;
  /** Controlling label -> enabled dependent labels. */
  map: { controller: string; values: string[] }[];
}

/** Base64 bitmask -> set bit positions. Null/empty means "always enabled". */
export function decodeValidFor(validFor: string | null | undefined): number[] {
  if (!validFor) return [];
  let binary: string;
  try {
    binary = atob(validFor);
  } catch {
    return [];
  }
  const out: number[] = [];
  for (let i = 0; i < binary.length; i += 1) {
    const byte = binary.charCodeAt(i);
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte >> bit) & 1) out.push(i * 8 + bit);
    }
  }
  return out;
}

interface UiApiValue {
  label?: string;
  value?: string;
  validFor?: string | null;
}

interface UiApiField {
  apiName?: string;
  label?: string;
  controllingFields?: string[];
  controllerValues?: Record<string, number>;
  values?: UiApiValue[];
}

function invert(indexByLabel: Record<string, number> | undefined): Map<number, string> {
  const m = new Map<number, string>();
  for (const [label, idx] of Object.entries(indexByLabel ?? {})) {
    if (!m.has(idx)) m.set(idx, label);
  }
  return m;
}

/**
 * Build controller -> dependent edges from a UI API object-info payload.
 * `labels` maps API names to display labels (from describe).
 */
export function parseDependencyGraph(
  objectInfo: { fields?: Record<string, UiApiField> },
  labels: Record<string, string>
): DepEdge[] {
  const fields = objectInfo?.fields ?? {};
  const edges: DepEdge[] = [];
  for (const [apiName, f] of Object.entries(fields)) {
    const controllers = f?.controllingFields ?? [];
    const values = f?.values ?? [];
    if (controllers.length === 0 || values.length === 0) continue;
    // First controller wins - Salesforce allows one per dependent field.
    const controller = controllers[0];
    const byIndex = invert(f?.controllerValues);
    const buckets = new Map<string, string[]>();
    for (const v of values) {
      const depLabel = v.label ?? v.value ?? "";
      if (!depLabel) continue;
      const idxs = decodeValidFor(v.validFor);
      if (idxs.length === 0) continue;
      for (const i of idxs) {
        const cLabel = byIndex.get(i);
        if (!cLabel) continue;
        const list = buckets.get(cLabel) ?? [];
        if (!list.includes(depLabel)) list.push(depLabel);
        buckets.set(cLabel, list);
      }
    }
    if (buckets.size === 0) continue;
    edges.push({
      controller,
      controllerLabel: labels[controller] ?? controller,
      dependent: apiName,
      dependentLabel: f?.label ?? labels[apiName] ?? apiName,
      map: [...buckets.entries()].map(([controller, vals]) => ({ controller, values: vals })),
    });
  }
  return edges.sort((a, b) => a.dependentLabel.localeCompare(b.dependentLabel));
}

/** UI API object-info path for one object. */
export function objectInfoPath(apiVersion: string, objectApi: string): string {
  return `/services/data/${apiVersion}/ui-api/object-info/${objectApi}`;
}
