import type { StudioProject } from "@/lib/studio/types";
import type {
  APIBinding,
  APIOperation,
  Screen,
  ScreenAnnotation,
  UIComponent,
  UIDataRequirement,
} from "@/lib/experience/types";

/**
 * Single-screen portable artifact. A screen travels with its components,
 * annotations, requirements, bindings and the catalog operations they point
 * at (matched by operationKey on import, proposed when missing). Wireframe
 * refs travel as ids - resolved against the importing browser, stale-safe
 * by design. Import always creates a NEW screen; nothing is overwritten.
 */

export const SCREEN_ARTIFACT_FORMAT = "gravenx-screen";
export const SCREEN_ARTIFACT_VERSION = 1;

export interface ScreenArtifactOperation {
  id: string;
  operationKey: string;
  method: string;
  path: string;
  name: string;
}

export interface ScreenArtifact {
  format: typeof SCREEN_ARTIFACT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  screen: Screen;
  components: UIComponent[];
  annotations: ScreenAnnotation[];
  requirements: UIDataRequirement[];
  bindings: APIBinding[];
  operations: ScreenArtifactOperation[];
}

function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Collect one screen and everything hanging off it. Null when the screen is absent. */
export function buildScreenArtifact(project: StudioProject, screenId: string): ScreenArtifact | null {
  const exp = project.experience;
  const screen = exp?.screens.find((s) => s.id === screenId);
  if (!exp || !screen) return null;
  const components = exp.components.filter((c) => c.screenId === screenId);
  const annotations = exp.annotations.filter((a) => a.screenId === screenId);
  const requirements = exp.requirements.filter((r) => r.screenId === screenId);
  const bindings = exp.bindings.filter((b) => b.screenId === screenId);
  const opIds = new Set(bindings.map((b) => b.operationId));
  const operations = (project.apiCatalog?.operations ?? [])
    .filter((o) => opIds.has(o.id))
    .map((o) => ({ id: o.id, operationKey: o.operationKey, method: o.method, path: o.path, name: o.name }));
  return {
    format: SCREEN_ARTIFACT_FORMAT,
    formatVersion: SCREEN_ARTIFACT_VERSION,
    exportedAt: new Date().toISOString(),
    screen: JSON.parse(JSON.stringify(screen)),
    components: JSON.parse(JSON.stringify(components)),
    annotations: JSON.parse(JSON.stringify(annotations)),
    requirements: JSON.parse(JSON.stringify(requirements)),
    bindings: JSON.parse(JSON.stringify(bindings)),
    operations,
  };
}

export interface ScreenArtifactCheck {
  ok: boolean;
  errors: string[];
  artifact?: ScreenArtifact;
}

/** Shape validation before anything touches the project. */
export function parseScreenArtifact(value: unknown): ScreenArtifactCheck {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["Not a JSON object."] };
  const v = value as Partial<ScreenArtifact>;
  if (v.format !== SCREEN_ARTIFACT_FORMAT) return { ok: false, errors: [`Not a screen artifact (format "${String((v as { format?: string }).format)}").`] };
  if (typeof v.formatVersion !== "number" || v.formatVersion > SCREEN_ARTIFACT_VERSION) {
    return { ok: false, errors: [`Unsupported screen version ${String(v.formatVersion)} (this app reads v${SCREEN_ARTIFACT_VERSION}).`] };
  }
  const s = v.screen as Screen | undefined;
  if (!s || typeof s.id !== "string" || typeof s.name !== "string") errors.push("Screen record missing.");
  for (const key of ["components", "annotations", "requirements", "bindings", "operations"] as const) {
    if (!Array.isArray(v[key])) errors.push(`"${key}" missing.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], artifact: v as ScreenArtifact };
}

/**
 * Import as a NEW screen with fresh ids. Operations match by operationKey;
 * missing ones are proposed into the catalog (never invented silently -
 * they arrive as proposed for architect review).
 */
export function importScreenArtifact(project: StudioProject, artifact: ScreenArtifact): StudioProject {
  const now = new Date().toISOString();
  if (!project.experience) return project;
  const exp = project.experience;
  const screenId = nid("scr");
  const compMap = new Map(artifact.components.map((c) => [c.id, nid("comp")]));
  const reqMap = new Map(artifact.requirements.map((r) => [r.id, nid("req")]));
  const bindMap = new Map(artifact.bindings.map((b) => [b.id, nid("bind")]));
  const annMap = new Map(artifact.annotations.map((a) => [a.id, nid("ann")]));

  let ops = project.apiCatalog?.operations ?? [];
  const opMap = new Map<string, string>();
  for (const ao of artifact.operations) {
    const found = ops.find((o) => o.operationKey === ao.operationKey);
    if (found) {
      opMap.set(ao.id, found.id);
      continue;
    }
    const fresh = nid("op");
    opMap.set(ao.id, fresh);
    ops = [
      ...ops,
      {
        id: fresh, operationKey: ao.operationKey, name: `${ao.name} (imported)`, description: undefined,
        method: ao.method as APIOperation["method"], path: ao.path, layer: "unknown" as const,
        requestContractId: undefined, responseContractId: undefined, errorContractIds: [], dependencyIds: [],
        lifecycle: "proposed" as const, status: "proposed" as const, tags: [], createdAt: now, updatedAt: now,
      },
    ];
  }

  const screen: Screen = {
    ...artifact.screen, id: screenId, name: `${artifact.screen.name} (imported)`,
    componentIds: artifact.screen.componentIds.map((id) => compMap.get(id) ?? id),
    actionIds: [], bindingIds: artifact.screen.bindingIds.map((id) => bindMap.get(id) ?? id),
    status: "draft", updatedAt: now,
  };
  return {
    ...project,
    apiCatalog: project.apiCatalog ? { ...project.apiCatalog, operations: ops, updatedAt: now } : project.apiCatalog,
    experience: {
      ...exp,
      screens: [...exp.screens, screen],
      components: [...exp.components, ...artifact.components.map((c) => ({
        ...c, id: compMap.get(c.id)!, screenId,
        requirementIds: c.requirementIds.map((id) => reqMap.get(id) ?? id),
        bindingIds: c.bindingIds.map((id) => bindMap.get(id) ?? id),
        status: "draft" as const, createdAt: now, updatedAt: now,
      }))],
      annotations: [...exp.annotations, ...artifact.annotations.map((a) => ({
        ...a, id: annMap.get(a.id)!, screenId,
        componentId: a.componentId ? (compMap.get(a.componentId) ?? undefined) : undefined,
        createdAt: now, updatedAt: now,
      }))],
      requirements: [...exp.requirements, ...artifact.requirements.map((r) => ({
        ...r, id: reqMap.get(r.id)!, screenId,
        componentId: r.componentId ? (compMap.get(r.componentId) ?? undefined) : undefined,
        bindingId: r.bindingId ? (bindMap.get(r.bindingId) ?? undefined) : undefined,
        status: "draft" as const, createdAt: now, updatedAt: now,
      }))],
      bindings: [...exp.bindings, ...artifact.bindings.map((b) => ({
        ...b, id: bindMap.get(b.id)!, screenId,
        componentId: b.componentId ? (compMap.get(b.componentId) ?? undefined) : undefined,
        actionId: undefined, operationId: opMap.get(b.operationId) ?? b.operationId,
        requestRequirementIds: b.requestRequirementIds.map((id) => reqMap.get(id) ?? id),
        responseRequirementIds: b.responseRequirementIds.map((id) => reqMap.get(id) ?? id),
        stateIds: [], status: "proposed" as const, createdAt: now, updatedAt: now,
      }))],
      updatedAt: now,
    },
    updatedAt: now,
  };
}

export function screenArtifactFileName(screenName: string): string {
  const safe = screenName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen";
  return `${safe}.screen.json`;
}
