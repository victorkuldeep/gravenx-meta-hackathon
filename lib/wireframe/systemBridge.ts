import type { Experience } from "./model";
import { guessSystemType, type TopologyDraft } from "@/lib/draw/toSystemDraft";

/**
 * EPIC 09 - wireframe-to-System-Design bridge (deterministic, no AI).
 * Same contract as the whiteboard bridge: an experience becomes draft
 * systems + connections, the architect confirms, the System canvas takes
 * it from there. Screens group the edges; explicit API refs travel along.
 */

interface ExtKey {
  key: string;
  name: string;
}

/** Distinct external endpoints touched by bound components. */
export function externalEndpoints(exp: Experience): ExtKey[] {
  const seen = new Map<string, string>();
  for (const c of exp.components) {
    const b = c.binding;
    if (!b || c.bindingState === "external") {
      if (b?.externalLabel?.trim()) {
        const label = b.externalLabel.trim().slice(0, 80);
        if (!seen.has(`ext:${label.toLowerCase()}`)) seen.set(`ext:${label.toLowerCase()}`, label);
      }
      continue;
    }
    if (b.source !== "salesforce") {
      const label = (b.object?.trim() || "External API").slice(0, 80);
      const k = `rest:${label.toLowerCase()}`;
      if (!seen.has(k)) seen.set(k, label);
    }
  }
  return [...seen.entries()].map(([key, name]) => ({ key, name }));
}

function hasSalesforce(exp: Experience): boolean {
  return exp.components.some((c) => c.binding?.source === "salesforce" && c.bindingState !== undefined);
}

function screenName(exp: Experience, parentId?: string): string {
  return exp.screens.find((s) => s.id === parentId)?.name ?? "Canvas";
}

/** Experience -> topology draft. Salesforce anchors left, externals fan right. */
export function experienceToDraft(exp: Experience): TopologyDraft {
  const systems: TopologyDraft["systems"] = [];
  const connections: TopologyDraft["connections"] = [];
  const warnings: string[] = [];
  const usesSf = hasSalesforce(exp);
  const externals = externalEndpoints(exp);

  if (usesSf) {
    systems.push({ key: "sf", name: "Salesforce", systemType: guessSystemType("Salesforce"), x: 80, y: 140 });
  }
  externals.forEach((e, i) => {
    systems.push({
      key: e.key,
      name: e.name,
      systemType: guessSystemType(e.name),
      x: 480,
      y: 80 + i * 160,
      portHint: e.name.match(/:(\d{2,5})$/)?.[1],
    });
  });

  // One edge per (screen, external) pair: writes flow out, reads flow in.
  const edged = new Set<string>();
  for (const c of exp.components) {
    const b = c.binding;
    if (!b) continue;
    let extKey: string | null = null;
    if (c.bindingState === "external" && b.externalLabel?.trim()) {
      extKey = `ext:${b.externalLabel.trim().toLowerCase()}`;
    } else if (b.source !== "salesforce" && c.bindingState !== undefined) {
      extKey = `rest:${(b.object?.trim() || "External API").toLowerCase()}`;
    }
    if (!extKey || !externals.some((e) => e.key === extKey)) continue;
    const pair = `${c.parentId ?? ""}→${extKey}`;
    if (edged.has(pair)) continue;
    edged.add(pair);
    const writes = !!(b.writeApi?.trim() || c.interaction);
    const label = `${screenName(exp, c.parentId)}${b.writeApi?.trim() ? ` · ${b.writeApi.trim()}` : b.readApi?.trim() ? ` · ${b.readApi.trim()}` : ""}`;
    connections.push({
      key: `conn-${edged.size}`,
      fromKey: writes ? "sf" : extKey,
      toKey: writes ? extKey : "sf",
      label: label.slice(0, 160),
    });
  }

  for (const s of exp.screens) {
    const comps = exp.components.filter((c) => c.parentId === s.id);
    if (comps.length > 0 && !comps.some((c) => c.binding)) {
      warnings.push(`"${s.name}" has components but no bindings - topology only, no API refs.`);
    }
  }
  if (systems.length === 0) {
    warnings.push("Nothing bound yet - bind a component before sending to System.");
  }
  return { systems, connections, warnings };
}

/** Per-screen API impact: explicit refs plus binding targets. */
export interface ScreenApiImpact {
  screenId: string;
  screenName: string;
  reads: string[];
  writes: string[];
  bindings: string[];
  externals: string[];
}

export function apiImpact(exp: Experience): ScreenApiImpact[] {
  return exp.screens.map((s) => {
    const reads = new Set<string>();
    const writes = new Set<string>();
    const bindings = new Set<string>();
    const externals = new Set<string>();
    for (const c of exp.components.filter((x) => x.parentId === s.id)) {
      const b = c.binding;
      if (!b) continue;
      if (b.readApi?.trim()) reads.add(b.readApi.trim());
      if (b.writeApi?.trim()) writes.add(b.writeApi.trim());
      if (b.source === "salesforce" && b.object?.trim()) {
        bindings.add(b.field?.trim() ? `${b.object.trim()}.${b.field.trim()}` : b.object.trim());
      } else if (b.source !== "salesforce" || c.bindingState === "external") {
        const label = b.externalLabel?.trim() || b.object?.trim() || "External";
        externals.add(label);
      }
      if (c.interaction?.target?.trim() && c.interaction.action.toLowerCase() !== "navigate") {
        writes.add(`${c.interaction.action}:${c.interaction.target.trim()}`);
      }
    }
    return {
      screenId: s.id,
      screenName: s.name,
      reads: [...reads].sort(),
      writes: [...writes].sort(),
      bindings: [...bindings].sort(),
      externals: [...externals].sort(),
    };
  });
}
