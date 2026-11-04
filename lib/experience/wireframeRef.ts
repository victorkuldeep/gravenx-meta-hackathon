import type { Experience } from "@/lib/wireframe/model";

/** Live summary of one Wireframe Studio screen for the mapping Experience panel. */
export interface WireScreenSummary {
  experienceName: string;
  screenName: string;
  status: string;
  /** Components placed on this screen (parentId === screen id). */
  components: number;
  /** Distinct Salesforce Object.Field bindings on this screen. */
  salesforceBindings: string[];
  /** Proposed (not-yet-in-org) fields referenced on this screen. */
  proposedFields: string[];
}

/** Summarize a wireframe screen, or null when the ref is stale (deleted wireframe/screen). */
export function summarizeWireScreen(exp: Experience | null | undefined, screenId: string): WireScreenSummary | null {
  if (!exp) return null;
  const screen = exp.screens.find((s) => s.id === screenId);
  if (!screen) return null;
  const onScreen = exp.components.filter((c) => c.parentId === screenId);
  const bindings = new Set<string>();
  const proposed = new Set<string>();
  for (const c of onScreen) {
    if (c.binding?.object && c.bindingState === "existing") {
      bindings.add(c.binding.field ? `${c.binding.object}.${c.binding.field}` : c.binding.object);
    }
    if (c.proposedField) proposed.add(`${c.proposedField.object}.${c.proposedField.apiName}`);
  }
  return {
    experienceName: exp.name,
    screenName: screen.name,
    status: exp.status,
    components: onScreen.length,
    salesforceBindings: [...bindings].sort(),
    proposedFields: [...proposed].sort(),
  };
}
