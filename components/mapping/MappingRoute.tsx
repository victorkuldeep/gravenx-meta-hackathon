"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../ui/Button";
import { ProjectWizard } from "./ProjectWizard";
import { SourceExplorer } from "./SourceExplorer";
import { SourceJsonViewer } from "./SourceJsonViewer";
import { SfExplorer } from "./SfExplorer";
import { FieldInspector } from "./FieldInspector";
import { MappingTable } from "./MappingTable";
import { MappingGrid } from "./MappingGrid";
import { MappingGraph } from "./MappingGraph";
import { SourceJsonModal } from "./SourceJsonModal";
import { ConstantsModal } from "./ConstantsModal";
import { SuggestModal } from "./SuggestModal";
import { CoverageModal } from "./CoverageModal";
import { requiredTargets } from "@/lib/mapping/coverage";
import { suggestMappings } from "@/lib/mapping/suggest";
import { RecordPlans } from "./RecordPlans";
import { ExportDialog, ImportDialog } from "./ProjectExchange";
import { DriftReview } from "./DriftReview";
import { ReviewPanel } from "./ReviewPanel";
import { ensureExperience } from "@/lib/experience/migrate";
import { ExperienceWorkspace } from "@/components/experience/ExperienceWorkspace";
import { ApiCatalogPanel } from "@/components/experience/ApiCatalogPanel";
import { DecisionsPanel } from "@/components/experience/DecisionsPanel";
import { SnapshotsPanel } from "@/components/experience/SnapshotsPanel";
import { WorkspaceDeliverables } from "@/components/experience/WorkspaceDeliverables";
import { useMappingMetadata } from "./useMappingMetadata";
import { buildSnapshot } from "@/lib/mapping/snapshot";
import { extractPaths, parseSourceJson } from "@/lib/mapping/source";
import { mergePasteRows, type PasteRow } from "@/lib/mapping/grid";
import { freeConstants, mapLeafToConstant, upsertConstant } from "@/lib/mapping/constants";
import { deleteProject, duplicateProject, listProjects, loadProject, saveProject, type ProjectSummary } from "@/lib/mapping/store";
import { validateImport } from "@/lib/mapping/exchange";
import type { MappingProject, MappingRow, RecordPlan, RelationshipDef, SnapshotField, SnapshotObject, SourceSnapshot } from "@/lib/mapping/types";
import { attachMapping, detachMapping, upgradeToWorkspace } from "@/lib/studio/upgrade";
import { blankStudio, type StudioProject } from "@/lib/studio/types";
import { deleteStudio, listStudios, loadStudio, saveStudio, type StudioSummary } from "@/lib/studio/store";
import { setPaletteAttachContext } from "@/lib/studio/paletteContext";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type SaveState = "saved" | "saving" | "unsaved" | "error";
type View = "start" | "ws-wizard" | "library";
type Module = "mappings" | "experience" | "apis" | "decisions" | "deliverables";

/**
 * Mapping Studio route.
 *
 * Workspace root (PROJECT umbrella, e.g. "Accenture") containing many
 * child integration mappings (orders, quotes, …) plus one Experience
 * workspace. Standalone mappings keep working and can attach/upgrade.
 */
export function MappingRoute() {
  const [view, setView] = useState<View>("start");
  const [invQuery, setInvQuery] = useState("");
  const [studios, setStudios] = useState<StudioSummary[]>([]);
  const [studio, setStudio] = useState<StudioProject | null>(null);
  const [child, setChild] = useState<MappingProject | null>(null);
  const [childMaps, setChildMaps] = useState<MappingProject[]>([]);
  const [library, setLibrary] = useState<ProjectSummary[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ objectName: string; field: SnapshotField } | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [sourceJsonOpen, setSourceJsonOpen] = useState(false);
  const [showChildWizard, setShowChildWizard] = useState(false);
  const [childWizardMode, setChildWizardMode] = useState<"attached" | "standalone">("attached");
  const startChildWizard = (mode: "attached" | "standalone", tab: "paste" | "openapi" = "paste") => {
    setChildWizardMode(mode);
    setWizardTab(tab);
    setShowChildWizard(true);
  };
  const [wizardTab, setWizardTab] = useState<"paste" | "openapi">("paste");
  const [trainState, setTrainState] = useState<"idle" | "busy" | "error">("idle");
  // Training set: sample mapping + a project with one linked screen, so the
  // spine completes end to end with zero org access.
  const loadTrainingSet = async () => {
    if (trainState === "busy") return;
    setTrainState("busy");
    try {
      const res = await fetch("/samples/product-order-mapping.json");
      const v = validateImport(await res.text());
      if (!v.ok || !v.project) throw new Error(v.errors.join(" ") || "Sample invalid.");
      const now = new Date().toISOString();
      const map = { ...v.project, id: uid("map"), createdAt: now, updatedAt: now };
      await saveProject(map);
      let ws = ensureExperience(blankStudio({ id: uid("ws"), name: "Training", description: "Sample project - safe to break.", now }), now);
      ws = attachMapping(ws, map.id, now);
      const screenId = uid("scr");
      const compIds = [uid("comp"), uid("comp")];
      const reqIds = [uid("req"), uid("req")];
      const fields: [string, string][] = [["Customer email", "email"], ["Order total", "total"]];
      ws = {
        ...ws,
        experience: {
          ...ws.experience!,
          screens: [
            ...ws.experience!.screens,
            {
              id: screenId, name: "Product order form", description: "Training screen - annotate regions, then map fields.",
              journeyIds: [], componentIds: compIds, actionIds: [], bindingIds: [], payloadMappingId: map.id,
              status: "draft", tags: ["training"], createdAt: now, updatedAt: now,
              canvas: { sourceWidth: 1200, sourceHeight: 800, aspectRatio: 1.5 },
            },
          ],
          components: [
            ...ws.experience!.components,
            ...compIds.map((id, i) => ({
              id, screenId, name: fields[i][0], componentType: "input" as const, requirementIds: [reqIds[i]],
              bindingIds: [], actionIds: [], stateIds: [], status: "draft" as const, tags: ["training"], createdAt: now, updatedAt: now,
            })),
          ],
          requirements: [
            ...ws.experience!.requirements,
            ...reqIds.map((id, i) => ({
              id, screenId, componentId: compIds[i], name: `Order.${fields[i][1]}`, description: `Training field ${i + 1} - edit me.`,
              direction: "request" as const, propertyPath: fields[i][1], dataType: i === 1 ? ("number" as const) : ("string" as const),
              required: i === 0, source: "contract" as const, status: "draft" as const, createdAt: now, updatedAt: now,
            })),
          ],
          updatedAt: now,
        },
        updatedAt: now,
      };
      await persistStudio(ws);
      setStudio(ws);
      setChildMaps([map]);
      setModule("experience");
      setView("start");
      setTrainState("idle");
    } catch {
      setTrainState("error");
    }
  };
  const [playState, setPlayState] = useState<"idle" | "busy" | "error">("idle");
  // Training playground: fetch the bundled sample, validate, save a fresh copy, open it.
  const playSample = async () => {
    if (playState === "busy") return;
    setPlayState("busy");
    try {
      const res = await fetch("/samples/product-order-mapping.json");
      const text = await res.text();
      const v = validateImport(text);
      if (!v.ok || !v.project) throw new Error(v.errors.join(" ") || "Sample invalid.");
      const now = new Date().toISOString();
      const project = { ...v.project, id: uid("map"), createdAt: now, updatedAt: now };
      await saveProject(project);
      refreshAll();
      await openChildStandalone(project.id);
      setPlayState("idle");
    } catch {
      setPlayState("error");
    }
  };
  const [confirmDeleteWs, setConfirmDeleteWs] = useState(false);
  const [confirmDeleteChild, setConfirmDeleteChild] = useState(false);
  const [module, setModule] = useState<Module>("mappings");
  /** One-shot: open the Add-screen dialog when Experience first mounts (Start-with-screen). */
  const [expFresh, setExpFresh] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsCustomer, setWsCustomer] = useState("");
  const studioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const childTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meta = useMappingMetadata();

  const refreshAll = useCallback(() => {
    void listStudios().then(setStudios).catch(() => setStudios([]));
    void listProjects().then(setLibrary).catch(() => setLibrary([]));
  }, []);

  useEffect(() => {
    refreshAll();
    // Deep link: /mapping?project=<id> opens the child straight into its
    // workspace (Knowledge jump links land here).
    try {
      const id = new URLSearchParams(window.location.search).get("project");
      if (id) void openChildStandalone(id);
    } catch {
      /* share links stay on the library */
    }
  }, [refreshAll]);

  // ---- studio persistence ----
  const persistStudio = useCallback(async (next: StudioProject) => {
    setSaveState("saving");
    try {
      await saveStudio({ ...next, updatedAt: new Date().toISOString() });
      setSaveState("saved");
      refreshAll();
    } catch {
      setSaveState("error");
    }
  }, [refreshAll]);

  const mutateStudio = useCallback(
    (fn: (p: StudioProject) => StudioProject) => {
      setStudio((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        if (studioTimer.current) clearTimeout(studioTimer.current);
        setSaveState("unsaved");
        studioTimer.current = setTimeout(() => void persistStudio(next), 900);
        return next;
      });
    },
    [persistStudio]
  );

  // ---- child persistence ----
  const persistChild = useCallback(async (next: MappingProject) => {
    setSaveState("saving");
    try {
      await saveProject({ ...next, updatedAt: new Date().toISOString() });
      setSaveState("saved");
      refreshAll();
      setChildMaps((prev) => prev.map((c) => (c.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : c)));
    } catch {
      setSaveState("error");
    }
  }, [refreshAll]);

  const mutateChild = useCallback(
    (fn: (p: MappingProject) => MappingProject) => {
      setChild((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        if (childTimer.current) clearTimeout(childTimer.current);
        setSaveState("unsaved");
        childTimer.current = setTimeout(() => void persistChild(next), 900);
        return next;
      });
    },
    [persistChild]
  );

  // ---- open / load ----
  const openStudio = useCallback(async (id: string) => {
    const w = await loadStudio(id).catch(() => undefined);
    if (!w) return;
    setStudio(w);
    setChild(null);
    setModule("mappings");
    setSaveState("saved");
    const maps: MappingProject[] = [];
    for (const mid of w.mappingIds) {
      const m = await loadProject(mid).catch(() => undefined);
      if (m) maps.push(m);
    }
    setChildMaps(maps);
  }, []);

  const openChild = useCallback(async (id: string) => {
    const m = await loadProject(id).catch(() => undefined);
    if (!m) return;
    setChild(m);
    setSelectedSource(null);
    setPicked(null);
    setActivePlanId(null);
    setSaveState("saved");
  }, []);

  /** Start-with-screen: umbrella + straight into a blank screen, Add dialog open. */
  const startWithScreen = () => {
    const now = new Date().toISOString();
    const ws = ensureExperience(blankStudio({ id: uid("ws"), name: "Screen-first project", now }), now);
    void persistStudio(ws).then(() => {
      setStudio(ws);
      setChildMaps([]);
      setModule("experience");
      setExpFresh(true);
    });
    setWsName("");
    setWsCustomer("");
    setView("start");
  };

  useEffect(() => {
    if (expFresh) setExpFresh(false);
  }, [expFresh]);

  const createWorkspace = () => {
    if (!wsName.trim()) return;
    const now = new Date().toISOString();
    const ws = blankStudio({ id: uid("ws"), name: wsName.trim(), customer: wsCustomer.trim() || undefined, now });
    void persistStudio(ws).then(() => {
      setStudio(ws);
      setChildMaps([]);
      setModule("mappings");
    });
    setWsName("");
    setWsCustomer("");
    setView("start");
  };

  const upgradeStandalone = async (id: string) => {
    const p = await loadProject(id).catch(() => undefined);
    if (!p) return;
    const now = new Date().toISOString();
    const { root, child: upgraded } = upgradeToWorkspace(p, now);
    await saveProject(upgraded).catch(() => undefined);
    await persistStudio(root);
    setLibrary((prev) => prev.filter((s) => s.id !== id));
    await deleteProject(id).catch(() => undefined);
    refreshAll();
    void openStudio(root.id);
  };

  // A2: the open project is a palette attach target on the mappings tab.
  useEffect(() => {
    if (!studio || module !== "mappings") return;
    const owner = {};
    setPaletteAttachContext(
      {
        kind: "project",
        title: studio.name,
        attachedMappingIds: studio.mappingIds,
        attachedWireKey: null,
        onAttachWireframe: () => undefined,
        onAttachMapping: (id) => void attachExisting(id),
      },
      owner
    );
    return () => setPaletteAttachContext(null, owner);
    // attachExisting closes only over studio + stable fns - [studio, module] is exact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio, module]);

  const attachExisting = async (id: string) => {
    if (!studio) return;
    const now = new Date().toISOString();
    const next = attachMapping(studio, id, now);
    await persistStudio(next);
    setStudio(next);
    const m = await loadProject(id).catch(() => undefined);
    if (m) setChildMaps((prev) => (prev.some((c) => c.id === id) ? prev : [...prev, m]));
  };

  const deleteWorkspace = async () => {
    if (!studio) return;
    await deleteStudio(studio.id).catch(() => undefined);
    setStudio(null);
    setChild(null);
    setChildMaps([]);
    setConfirmDeleteWs(false);
    refreshAll();
  };

  const deleteChildMapping = async () => {
    if (!child) return;
    await deleteProject(child.id).catch(() => undefined);
    if (studio) {
      const next = detachMapping(studio, child.id, new Date().toISOString());
      await persistStudio(next);
      setStudio(next);
      setChildMaps((prev) => prev.filter((c) => c.id !== child.id));
    } else {
      setChildMaps([]);
    }
    setChild(null);
    setConfirmDeleteChild(false);
    refreshAll();
  };

  const deleteChildById = async (id: string) => {
    await deleteProject(id).catch(() => undefined);
    if (studio) {
      const next = detachMapping(studio, id, new Date().toISOString());
      await persistStudio(next);
      setStudio(next);
    }
    setChildMaps((prev) => prev.filter((c) => c.id !== id));
    refreshAll();
  };

  // ---- child mapping actions (integration workspace) ----
  const [mapMode, setMapMode] = useState<"guide" | "grid" | "graph">("guide");
  const [sourceOpen, setSourceOpen] = useState(true);
  const [sfOpen, setSfOpen] = useState(true);
  const [showSuggest, setShowSuggest] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [constantsOpen, setConstantsOpen] = useState(false);

  // Grid surface: typed Object.Field targets upsert by source path.
  const upsertRow = (sourcePath: string, target: { objectName: string; fieldName: string }) => {
    const now = new Date().toISOString();
    mutateChild((p) => {
      const existing = p.mappings.find((m) => m.sourcePath === sourcePath);
      if (existing) {
        return {
          ...p,
          mappings: p.mappings.map((m) =>
            m.id === existing.id ? { ...m, ...target, kind: m.kind === "excluded" ? ("direct" as const) : m.kind, updatedAt: now } : m
          ),
        };
      }
      return {
        ...p,
        mappings: [...p.mappings, { id: uid("row"), sourcePath, planId: activePlanId, ...target, kind: "direct" as const, status: "mapped" as const, updatedAt: now }],
      };
    });
  };

  // Grid surface: pasted Excel rows merge last-wins by source.
  const importPaste = (rows: PasteRow[]) => {
    const now = new Date().toISOString();
    mutateChild((p) => ({ ...p, mappings: mergePasteRows(p.mappings, rows, activePlanId, () => uid("row"), now) }));
  };

  // Constants: named hardcoded literals shared by Guide and Grid.
  const saveConstant = (id: string | null, label: string, value: string) => {
    const now = new Date().toISOString();
    mutateChild((p) => ({ ...p, mappings: upsertConstant(p.mappings, { label, value }, { id, planId: activePlanId, uid: () => uid("row"), now }) }));
  };
  const removeConstant = (id: string) => {
    mutateChild((p) => ({ ...p, mappings: p.mappings.filter((m) => m.id !== id) }));
  };
  // Guide surface: map a source leaf onto an existing constant.
  const confirmConstant = (sourcePath: string, constantId: string) => {
    const now = new Date().toISOString();
    mutateChild((p) => ({ ...p, mappings: mapLeafToConstant(p.mappings, sourcePath, constantId, { planId: activePlanId, uid: () => uid("row"), now }) }));
    setSelectedSource(null);
  };

  const confirmMap = (sourcePath: string) => {
    if (!picked) return;
    const now = new Date().toISOString();
    mutateChild((p) => {
      const existing = p.mappings.find((m) => m.sourcePath === sourcePath);
      if (existing) {
        return {
          ...p,
          mappings: p.mappings.map((m) =>
            m.id === existing.id ? { ...m, objectName: picked.objectName, fieldName: picked.field.name, kind: "direct" as const, updatedAt: now } : m
          ),
        };
      }
      const row: MappingRow = {
        id: uid("row"),
        sourcePath,
        planId: activePlanId,
        objectName: picked.objectName,
        fieldName: picked.field.name,
        kind: "direct",
        status: "mapped",
        updatedAt: now,
      };
      return { ...p, mappings: [...p.mappings, row] };
    });
    setSelectedSource(null);
  };

  const captureSnapshot = async () => {
    if (!child || !meta.session) return;
    setSnapshotBusy(true);
    try {
      const names = [...new Set([...child.mappings.map((m) => m.objectName), ...child.recordPlans.map((r) => r.objectName)])];
      if (names.length === 0) return;
      const entries = [];
      for (const name of names) {
        const describe = await meta.loadDescribe(name);
        const objMeta = meta.objects.find((o) => o.name === name);
        if (describe && objMeta) entries.push({ meta: objMeta, describe });
      }
      if (entries.length === 0) return;
      const snapshot = buildSnapshot(uid("snap"), entries, undefined, new Date().toISOString());
      mutateChild((p) => ({ ...p, sfSnapshot: snapshot }));
    } finally {
      setSnapshotBusy(false);
    }
  };

  // Source replace (Edit & Replace in the source modal): rebuild the path
  // catalog from edited JSON. Mappings stay keyed by sourcePath, so rows
  // pointing at removed paths are kept as-is - the preview calls them
  // out before anything is applied.
  const applySourceReplace = (newText: string) => {
    if (!child?.source) return;
    const parsed = parseSourceJson(newText);
    if (!parsed.ok) return;
    const snapshot: SourceSnapshot = {
      kind: child.source.kind,
      name: child.source.name,
      originalText: newText,
      paths: extractPaths(parsed.value),
      capturedAt: new Date().toISOString(),
    };
    mutateChild((x) => ({ ...x, source: snapshot }));
    setSourceJsonOpen(false);
  };

  const switchModule = (m: Module) => {
    setModule(m);
    if (m !== "mappings") {
      mutateStudio((p) => ensureExperience(p, new Date().toISOString()));
    }
  };

  // ---- cross-child aggregation for root scopes ----
  const cross = useMemo(() => {
    const snapMap = new Map<string, SnapshotObject>();
    for (const c of childMaps) {
      for (const o of c.sfSnapshot?.objects ?? []) {
        if (!snapMap.has(o.name)) snapMap.set(o.name, o);
      }
    }
    return {
      snapshots: [...snapMap.values()],
      mappings: childMaps.flatMap((c) =>
        c.mappings.map((m) => ({ id: m.id, sourcePath: m.sourcePath, objectName: m.objectName, fieldName: m.fieldName }))
      ),
      plans: childMaps.flatMap((c) => c.recordPlans.map((r) => ({ id: r.id, name: `${c.name} / ${r.name}`, objectName: r.objectName }))),
    };
  }, [childMaps]);

  const payloadChoices = useMemo(
    () => childMaps.map((c) => ({ id: c.id, label: `${c.name}${c.sourceApi ? ` · ${c.sourceApi}` : ""}` })),
    [childMaps]
  );

  const artifactChoices = useMemo(
    () => [
      ...cross.mappings.map((m) => ({ id: m.id, label: `map: ${m.sourcePath} → ${m.objectName}.${m.fieldName || "?"}` })),
      ...cross.plans.map((r) => ({ id: r.id, label: `plan: ${r.name}` })),
    ],
    [cross]
  );

  const childObjectsUsed = useMemo(
    () => (child ? [...new Set([...child.mappings.map((m) => m.objectName), ...child.recordPlans.map((r) => r.objectName)])] : []),
    [child]
  );

  const activePlan = child?.recordPlans.find((p) => p.id === activePlanId) ?? null;
  // Auto-suggest scopes to the active record plan object when one is picked.
  const suggestions = useMemo(
    () => (child ? suggestMappings(child, { planObject: activePlan?.objectName ?? null }) : []),
    [child, activePlan]
  );
  const coverageCount = useMemo(() => (child ? requiredTargets(child).length : 0), [child]);
  const invShown = useMemo(() => {
    const q = invQuery.trim().toLowerCase();
    if (!q) return studios;
    return studios.filter((s) => `${s.name} ${s.customer ?? ""}`.toLowerCase().includes(q));
  }, [studios, invQuery]);
  const planMismatch =
    activePlan && picked && picked.objectName !== activePlan.objectName
      ? `Field is on ${picked.objectName}, but the active plan (${activePlan.name}) targets ${activePlan.objectName}. Switch plans or pick a ${activePlan.objectName} field.`
      : null;

  const saveBadge = (
    <span
      role="status"
      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
        saveState === "saved"
          ? "border-[#BFD9C6] bg-[#E9F3EC] text-[#2F7D4F]"
          : saveState === "error"
            ? "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]"
            : "border-[#DCC99A] bg-[#F5EEDF] text-[#8A6A2F]"
      }`}
    >
      {saveState === "saved" ? "Saved locally" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed — Retry" : "Unsaved changes"}
    </span>
  );

  // New-mapping wizard: shared by every view (start, library, workspace).
  // It used to live inside the workspace return only, so the buttons on
  // Start/Library silently did nothing - fully local, no connection needed.
  // openChildStandalone is a hoisted function declaration, safe to call here.
  const childWizardModal = showChildWizard && (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="New integration mapping">
      <ProjectWizard
        title={childWizardMode === "standalone" ? "New standalone mapping" : "New integration mapping"}
        initialSourceTab={wizardTab}
        contextName={childWizardMode === "attached" && studio ? studio.name : undefined}
        onCreate={(p) => {
          void (async () => {
            await saveProject(p).catch(() => undefined);
            if (childWizardMode === "attached" && studio) {
              const next = attachMapping(studio, p.id, new Date().toISOString());
              await persistStudio(next);
              setStudio(next);
            } else {
              // Standalone birth: open it direct - no umbrella needed.
              setShowChildWizard(false);
              refreshAll();
              await openChildStandalone(p.id);
              return;
            }
            setChildMaps((prev) => [...prev, p]);
            setShowChildWizard(false);
            refreshAll();
          })();
        }}
        onCancel={() => setShowChildWizard(false)}
      />
    </div>
  );

  // ================= start screen: inventory left, action right =================
  // NOTE: child-first - a standalone mapping has no studio by design, so the
  // workspace branch below must win over this one or opens silently no-op.
  if (!studio && !child) {
    return (
      <div className="grid min-h-0 flex-1 items-stretch gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex h-full max-h-[calc(100vh-140px)] min-h-[420px] flex-col rounded-xl border border-[#E8E2D8] bg-white p-3" aria-label="Projects inventory">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Projects · {studios.length}</p>
            <Button size="sm" variant="ghost" onClick={() => setView("ws-wizard")} title="New project umbrella">
              + New
            </Button>
          </div>
          {studios.length > 0 && (
            <input
              value={invQuery}
              onChange={(e) => setInvQuery(e.target.value)}
              placeholder="Search projects…"
              aria-label="Search projects"
              spellCheck={false}
              className="mb-2 w-full rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
            />
          )}
          {invShown.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto py-3 text-center">
              <svg
                width="132"
                height="76"
                viewBox="0 0 132 76"
                fill="none"
                aria-hidden="true"
                className="mx-auto h-auto w-[132px]"
              >
                <rect x="6" y="12" width="48" height="52" rx="9" fill="#FFFFFF" stroke="#D8CFC0" strokeWidth="1.5" strokeDasharray="4 4" />
                <line x1="16" y1="28" x2="44" y2="28" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
                <line x1="16" y1="40" x2="44" y2="40" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
                <line x1="16" y1="52" x2="34" y2="52" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
                <rect x="78" y="12" width="48" height="52" rx="9" fill="#FAF8F2" stroke="#C9A86A" strokeWidth="1.5" />
                <line x1="88" y1="28" x2="116" y2="28" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
                <line x1="88" y1="40" x2="108" y2="40" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
                <line x1="54" y1="38" x2="78" y2="38" stroke="#A98450" strokeWidth="1.5" strokeDasharray="3 3" />
                <path d="M72 33 L78 38 L72 43" stroke="#A98450" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
              <p className="mt-2 text-[13px] font-semibold text-[#27241F]">No projects yet</p>
              <ol className="mx-auto mt-2 max-w-[240px] space-y-1.5 text-left text-[11px] leading-relaxed text-[#777168]">
                <li><span className="font-mono font-bold text-[#A98450]">1 </span>One umbrella per client or program.</li>
                <li><span className="font-mono font-bold text-[#A98450]">2 </span>Many payload mappings under each.</li>
                <li><span className="font-mono font-bold text-[#A98450]">3 </span>Paste JSON or generate from OpenAPI.</li>
                <li><span className="font-mono font-bold text-[#A98450]">4 </span>Auto-suggest + coverage queue finish it fast.</li>
                <li><span className="font-mono font-bold text-[#A98450]">5 </span>Export, share, hand off to build agents.</li>
              </ol>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {invShown.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => void openStudio(s.id)} className="w-full cursor-pointer rounded-xl border border-[#F0EBE0] px-3 py-2 text-left hover:border-[#A98450]">
                    <span className="block truncate text-[13px] font-semibold text-[#27241F]">{s.name}{s.customer ? ` · ${s.customer}` : ""}</span>
                    <span className="block font-mono text-[10px] text-[#A39B8E]">{s.status} · {s.mappingCount} mappings · {s.openDecisions} open decisions</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setView("library")} className="mt-auto w-full shrink-0 cursor-pointer rounded-lg px-2 py-1.5 pt-2 text-center text-[12px] font-semibold text-[#777168] hover:bg-[#FAF8F2] hover:text-[#27241F]">
            Standalone mappings ({library.length}) →
          </button>
        </aside>
        <div className="min-w-0 space-y-3">
        <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-4 text-center">
          <svg
            width="430"
            height="168"
            viewBox="0 0 430 168"
            fill="none"
            aria-hidden="true"
            className="mx-auto mt-2 h-auto w-full max-w-[400px]"
          >
            <ellipse cx="215" cy="84" rx="185" ry="72" stroke="#E3D9C6" strokeWidth="1.5" strokeDasharray="5 6" />
            <rect x="28" y="52" width="100" height="64" rx="10" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
            <line x1="40" y1="70" x2="94" y2="70" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
            <line x1="40" y1="84" x2="116" y2="84" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <line x1="40" y1="98" x2="104" y2="98" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <rect x="302" y="52" width="100" height="64" rx="10" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
            <rect x="312" y="64" width="46" height="30" rx="4" fill="#F5F1E8" stroke="#C9A86A" strokeWidth="1.5" />
            <line x1="366" y1="70" x2="394" y2="70" stroke="#C9A86A" strokeWidth="3" strokeLinecap="round" />
            <line x1="366" y1="80" x2="388" y2="80" stroke="#E3D9C6" strokeWidth="3" strokeLinecap="round" />
            <line x1="366" y1="90" x2="394" y2="90" stroke="#E3D9C6" strokeWidth="3" strokeLinecap="round" />
            <line x1="128" y1="84" x2="176" y2="84" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="254" y1="84" x2="302" y2="84" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
            <rect x="176" y="52" width="78" height="64" rx="14" fill="#27241F" />
            <path d="M186 92 C186 74 200 66 215 66 C230 66 244 74 244 92 C236 86 228 86 223 91 C218 86 210 86 205 91 C200 86 192 86 186 92 Z" fill="#C9A86A" />
            <line x1="215" y1="91" x2="215" y2="102" stroke="#C9A86A" strokeWidth="2.5" strokeLinecap="round" />
            <text x="78" y="134" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700" fill="#A39B8E">INTEGRATION</text>
            <text x="215" y="134" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700" fill="#A39B8E">PROJECT</text>
            <text x="352" y="134" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700" fill="#A39B8E">SCREEN → PAYLOAD</text>
          </svg>
          <h2 className="mt-1 text-[15px] font-semibold text-[#27241F]">Mapping Studio</h2>
          <p className="mx-auto mt-1 max-w-xl text-xs text-[#777168]">
            A project umbrella (e.g. Accenture) holding many integration mappings plus UI screen-to-payload mapping. Everything stays in your browser.
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
            Project · Mappings · Screens
          </p>
          {view === "start" && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setView("ws-wizard")}>New Project</Button>
              <Button variant="ghost" onClick={() => startWithScreen()} title="Create a project and land straight in a blank screen">
                Start with screen
              </Button>
              <Button variant="ghost" onClick={() => setView("library")}>
                Standalone mappings ({library.length})
              </Button>
              <Button variant="ghost" onClick={() => setShowImport(true)}>
                Import mapping JSON
              </Button>
              <a href="/samples/product-order-mapping.json" download className="inline-flex items-center rounded-lg border border-[#E8E2D8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#777168] hover:border-[#A98450] hover:text-[#27241F]" title="A training mapping - import it to see the supported format, then break it">
                Try a sample
              </a>
              <button
                type="button"
                onClick={() => void loadTrainingSet()}
                disabled={trainState === "busy"}
                title="Load the sample mapping plus a training project with a linked screen - no org needed"
                className="inline-flex items-center rounded-lg border border-[#E8E2D8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#777168] hover:border-[#A98450] hover:text-[#27241F] disabled:opacity-50"
              >
                {trainState === "busy" ? "Loading…" : trainState === "error" ? "Retry training set" : "Load training set"}
              </button>
            </div>
          )}
        </div>

        {view === "start" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">01</p>
              <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Create a project</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">
                Open one umbrella per client or program, then add as many integration mappings as you need under it.
              </p>
            </div>
            <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">02</p>
              <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Map source to target</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">
                Pick fields from live org snapshots, draw the links, and resolve every open decision before export.
              </p>
            </div>
            <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">03</p>
              <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Link screens to payloads</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">
                Attach the experience workspace to bind UI screens to the same payloads, then export or share the set.
              </p>
            </div>
          </div>
        )}

        {view === "start" && (
          <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
            <p className="text-[13px] font-semibold text-[#27241F]">Training playground</p>
            <p className="mt-0.5 text-xs text-[#777168]">Learn by playing - each template opens a real mapping you can break safely. Nothing leaves your browser.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-[#F0EBE0] p-3">
                <p className="text-[13px] font-semibold text-[#27241F]">Product order sample</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#777168]">Order + line items with an enum row, a plan and an open decision.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => void playSample()} disabled={playState === "busy"}>
                    {playState === "busy" ? "Opening…" : "Import & play"}
                  </Button>
                  <a href="/samples/product-order-mapping.json" download className="inline-flex items-center rounded-lg px-2 py-1 text-[12px] font-semibold text-[#777168] hover:text-[#27241F]">
                    Download
                  </a>
                </div>
                {playState === "error" && (
                  <p role="alert" className="mt-2 text-[11px] text-red-700">Could not load the sample - check connection and retry.</p>
                )}
              </div>
              <div className="rounded-xl border border-[#F0EBE0] p-3">
                <p className="text-[13px] font-semibold text-[#27241F]">Spec to sample</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#777168]">Paste an OpenAPI spec, tick fields, get a mapping-ready sample.</p>
                <div className="mt-2">
                  <Button size="sm" variant="ghost" onClick={() => startChildWizard("standalone", "openapi")}>
                    Start from a spec
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-[#F0EBE0] p-3">
                <p className="text-[13px] font-semibold text-[#27241F]">Blank canvas</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#777168]">Paste any JSON and map it with auto-suggest and coverage.</p>
                <div className="mt-2">
                  <Button size="sm" variant="ghost" onClick={() => startChildWizard("standalone", "paste")}>
                    Start blank
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}


        {view === "ws-wizard" && (
          <div className="mx-auto max-w-xl rounded-xl border border-[#E8E2D8] bg-white p-5">
            <p className="mb-3 text-[14px] font-semibold text-[#27241F]">New project (umbrella)</p>
            <label className="block text-[12px] font-semibold text-[#27241F]">
              Project name
              <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Accenture" className="mt-1 w-full rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none" />
            </label>
            <label className="mt-3 block text-[12px] font-semibold text-[#27241F]">
              Customer (optional)
              <input value={wsCustomer} onChange={(e) => setWsCustomer(e.target.value)} placeholder="Customer program" className="mt-1 w-full rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none" />
            </label>
            <div className="mt-4 flex justify-between">
              <Button variant="ghost" onClick={() => setView("start")}>
                Cancel
              </Button>
              <Button disabled={!wsName.trim()} onClick={createWorkspace}>
                Create project
              </Button>
            </div>
          </div>
        )}

        {view === "library" && (
          <LibraryList
            library={library}
            onOpen={(id) => void openChildStandalone(id)}
            onBack={() => setView("start")}
            onNew={() => startChildWizard("standalone")}
            onChanged={refreshAll}
            onUpgrade={(id) => void upgradeStandalone(id)}
          />
        )}

        {showImport && (
          <ImportDialog
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false);
              refreshAll();
              setView("library");
            }}
          />
        )}
        {childWizardModal}
        </div>
      </div>
    );
  }

  async function openChildStandalone(id: string) {
    // Standalone mappings open directly in the integration workspace.
    const m = await loadProject(id).catch(() => undefined);
    if (!m) return;
    setChild(m);
    setChildMaps([m]);
    setSaveState("saved");
  }

  // ================= child integration workspace =================
  if (child) {
    const inWorkspace = studio?.mappingIds.includes(child.id) ?? false;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] text-[#A39B8E]">
              {inWorkspace && studio ? studio.name : "standalone"} / integration mapping
            </p>
            <p className="truncate text-[14px] font-semibold text-[#27241F]">{child.name}</p>
            <p className="font-mono text-[10px] text-[#A39B8E]">
              {child.sourceApi ?? "no source API"} → {child.targetSystem} · {child.status} · v{child.versions.length} · {child.mappings.length} mappings
              {child.sfSnapshot ? ` · snapshot ${child.sfSnapshot.fingerprint}` : " · no metadata snapshot"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {saveBadge}
            {saveState === "error" && (
              <Button size="sm" variant="ghost" onClick={() => void persistChild(child)}>
                Retry
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void persistChild(child)}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReview((v) => !v)} aria-pressed={showReview}>
              Review
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowExport(true)}>
              Export
            </Button>
            {confirmDeleteChild ? (
              <span className="flex items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-[#B3261E]">Delete mapping?</span>
                <Button size="sm" variant="ghost" onClick={() => void deleteChildMapping()}>
                  Yes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteChild(false)}>
                  No
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteChild(true)}>
                Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setChild(null); setConfirmDeleteChild(false); if (!inWorkspace) setView("library"); }}>
              {inWorkspace ? "← Mappings" : "← Close"}
            </Button>
          </div>
        </div>
        {showExport && <ExportDialog project={child} onClose={() => setShowExport(false)} />}
        {showSuggest && (
          <SuggestModal
            suggestions={suggestions}
            onClose={() => setShowSuggest(false)}
            onApply={(chosen) => {
              const now = new Date().toISOString();
              mutateChild((p) => {
                let mappings = p.mappings;
                for (const s of chosen) {
                  if (mappings.some((m) => m.sourcePath === s.sourcePath)) continue;
                  mappings = [
                    ...mappings,
                    {
                      id: uid("row"),
                      sourcePath: s.sourcePath,
                      planId: activePlanId,
                      objectName: s.objectName,
                      fieldName: s.fieldName,
                      kind: "direct" as const,
                      status: "mapped" as const,
                      rationale: `Auto-suggested (${s.confidence} name match) - review me.`,
                      updatedAt: now,
                    },
                  ];
                }
                return { ...p, mappings };
              });
              setShowSuggest(false);
            }}
          />
        )}
        {showCoverage && child && (
          <CoverageModal
            project={child}
            onClose={() => setShowCoverage(false)}
            onApply={(item, sourcePath) => {
              const now = new Date().toISOString();
              mutateChild((p) => ({
                ...p,
                mappings: [
                  ...p.mappings,
                  {
                    id: uid("row"),
                    sourcePath,
                    planId: item.planId ?? activePlanId,
                    objectName: item.objectName,
                    fieldName: item.field.name,
                    kind: "direct" as const,
                    status: "mapped" as const,
                    rationale: "Coverage queue - review me.",
                    updatedAt: now,
                  },
                ],
              }));
            }}
          />
        )}

        <div
          id="mapping-workspace"
          className={'grid min-h-0 flex-1 items-stretch gap-3 ' + (sourceOpen ? (sfOpen ? 'xl:grid-cols-[23%_52%_25%] lg:grid-cols-[280px_minmax(0,1fr)]' : 'xl:grid-cols-[25%_minmax(0,1fr)_48px] lg:grid-cols-[280px_minmax(0,1fr)]') : sfOpen ? 'xl:grid-cols-[48px_minmax(0,1fr)_25%] lg:grid-cols-[48px_minmax(0,1fr)]' : 'xl:grid-cols-[48px_minmax(0,1fr)_48px] lg:grid-cols-[48px_minmax(0,1fr)]')}
        >
          {sourceOpen ? (
          <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
                Source · {child.source?.paths.length ?? 0} paths
              </p>
              <button
                type="button"
                onClick={() => setSourceOpen(false)}
                aria-label="Collapse Source panel"
                title="Collapse Source panel"
                className="cursor-pointer rounded-md px-1.5 py-0.5 font-mono text-[12px] text-[#A39B8E] hover:bg-[#FAF8F2] hover:text-[#27241F]"
              >
                «
              </button>
            </div>
            {child.source ? (
              <SourceExplorer paths={child.source.paths} mappings={child.mappings} selected={selectedSource} onSelect={setSelectedSource} />
            ) : (
              <p className="text-[12px] text-[#A39B8E]">No source loaded.</p>
            )}
            {child.source && (
              <SourceJsonViewer text={child.source.originalText} selected={selectedSource} onSelectPath={setSelectedSource} />
            )}
          </div>
          ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white py-3">
            <button
              type="button"
              onClick={() => setSourceOpen(true)}
              aria-label="Expand Source panel"
              title="Expand Source panel"
              className="cursor-pointer rounded-md px-1.5 py-0.5 font-mono text-[12px] text-[#A39B8E] hover:bg-[#FAF8F2] hover:text-[#27241F]"
            >
              »
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E] [writing-mode:vertical-rl]">
              Source
            </span>
          </div>
          )}

          <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Mapping table</p>
            <div className="mb-3">
              <RecordPlans
                project={child}
                activePlanId={activePlanId}
                onActivePlan={setActivePlanId}
                onAddPlan={(plan: RecordPlan) => {
                  mutateChild((p) => ({ ...p, recordPlans: [...p.recordPlans, plan] }));
                  setActivePlanId(plan.id);
                }}
                onRemovePlan={(id) =>
                  mutateChild((p) => ({
                    ...p,
                    recordPlans: p.recordPlans.filter((r) => r.id !== id),
                    relationships: p.relationships.filter((r) => r.childPlanId !== id && r.parentPlanId !== id),
                    mappings: p.mappings.map((m) => (m.planId === id ? { ...m, planId: null } : m)),
                  }))
                }
                onAddRelationship={(rel: RelationshipDef) =>
                  mutateChild((p) => ({
                    ...p,
                    relationships: p.relationships.some((r) => r.id === rel.id)
                      ? p.relationships.map((r) => (r.id === rel.id ? rel : r))
                      : [...p.relationships, rel],
                  }))
                }
                onRemoveRelationship={(id) => mutateChild((p) => ({ ...p, relationships: p.relationships.filter((r) => r.id !== id) }))}
                onToggleConfirm={(id) =>
                  mutateChild((p) => ({ ...p, relationships: p.relationships.map((r) => (r.id === id ? { ...r, confirmed: !r.confirmed } : r)) }))
                }
              />
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex rounded-lg border border-[#E8E2D8] bg-white p-0.5" role="tablist" aria-label="Mapping surface">
                {(["guide", "grid", "graph"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mapMode === m}
                    onClick={() => setMapMode(m)}
                    className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      mapMode === m ? "bg-[#211F1B] text-white" : "text-[#777168] hover:text-[#27241F]"
                    }`}
                  >
                    {m === "guide" ? "Guide" : m === "grid" ? "Grid" : "Graph"}
                  </button>
                ))}
              </div>
              <p className="font-mono text-[10px] text-[#A39B8E]">
                {mapMode === "grid"
                  ? "Spreadsheet editing - same rows, click any cell to type."
                  : mapMode === "graph"
                    ? "Left-to-right flow: JSON source and constants into sObject fields. Click the circle for the JSON."
                    : "Guided mapping - pick a source, then a target field."}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSuggest(true)}
                disabled={suggestions.length === 0}
                title={suggestions.length === 0 ? "No name-similar targets found - capture a snapshot first" : "Review name-similarity proposals before applying"}
              >
                Auto-suggest{suggestions.length > 0 ? ` (${suggestions.length})` : ""}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCoverage(true)}
                disabled={coverageCount === 0}
                title={coverageCount === 0 ? "Zero required fields unmapped" : "Step through required fields with no mapping"}
              >
                Coverage{coverageCount > 0 ? ` (${coverageCount})` : ""}
              </Button>
            </div>
            {mapMode === "guide" ? (
              <MappingTable
                project={child}
                selectedSource={selectedSource}
                onSelectSource={setSelectedSource}
                pendingTarget={picked}
                planMismatch={planMismatch}
                onConfirmMap={confirmMap}
                constants={freeConstants(child.mappings)}
                onOpenConstants={() => setConstantsOpen(true)}
                onMapConstant={confirmConstant}
                onUpdateRow={(id, patch) => mutateChild((p) => ({ ...p, mappings: p.mappings.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m)) }))}
                onRemoveRow={(id) => mutateChild((p) => ({ ...p, mappings: p.mappings.filter((m) => m.id !== id) }))}
              />
            ) : mapMode === "grid" ? (
              <MappingGrid
                project={child}
                planId={activePlanId}
                planLabel={activePlan ? `${activePlan.name} → ${activePlan.objectName}` : null}
                onUpdateRow={(id, patch) => mutateChild((p) => ({ ...p, mappings: p.mappings.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m)) }))}
                onRemoveRow={(id) => mutateChild((p) => ({ ...p, mappings: p.mappings.filter((m) => m.id !== id) }))}
                onUpsertRow={upsertRow}
                onImportPaste={importPaste}
                onOpenConstants={() => setConstantsOpen(true)}
              />
            ) : (
              <MappingGraph project={child} onOpenSource={() => setSourceJsonOpen(true)} />
            )}
          </div>

          {sfOpen ? (
          <div className="space-y-3 lg:col-span-2 xl:col-span-1">
            <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Salesforce</p>
                <span className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={!meta.connected || snapshotBusy || childObjectsUsed.length === 0} onClick={() => void captureSnapshot()} title={childObjectsUsed.length === 0 ? "Map a field first" : "Freeze current metadata for mapped objects"}>
                  {snapshotBusy ? "Capturing…" : "Capture snapshot"}
                </Button>
                <button
                  type="button"
                  onClick={() => setSfOpen(false)}
                  aria-label="Collapse Salesforce panel"
                  title="Collapse Salesforce panel"
                  className="cursor-pointer rounded-md px-1.5 py-0.5 font-mono text-[12px] text-[#A39B8E] hover:bg-[#FAF8F2] hover:text-[#27241F]"
                >
                  »
                </button>
                </span>
              </div>
              <SfExplorer
                connected={meta.connected}
                loading={meta.loading}
                objects={meta.objects}
                describes={meta.describes}
                snapshotObjects={child.sfSnapshot?.objects ?? []}
                onEnsureDescribe={(n) => void meta.loadDescribe(n)}
                onPickField={(objectName, field) => setPicked({ objectName, field })}
                activeObject={picked?.objectName ?? null}
                activeField={picked?.field.name ?? null}
              />
            </div>
            <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Inspector</p>
              <FieldInspector objectName={picked?.objectName ?? null} field={picked?.field ?? null} />
            </div>
          </div>
          ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white py-3 lg:col-span-2 xl:col-span-1">
            <button
              type="button"
              onClick={() => setSfOpen(true)}
              aria-label="Expand Salesforce panel"
              title="Expand Salesforce panel"
              className="cursor-pointer rounded-md px-1.5 py-0.5 font-mono text-[12px] text-[#A39B8E] hover:bg-[#FAF8F2] hover:text-[#27241F]"
            >
              «
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E] [writing-mode:vertical-rl]">
              Salesforce
            </span>
          </div>
          )}
        </div>

        {constantsOpen && child && (
          <ConstantsModal
            constants={freeConstants(child.mappings)}
            onSave={(id, label, value) => saveConstant(id, label, value)}
            onRemove={removeConstant}
            onClose={() => setConstantsOpen(false)}
          />
        )}

        <DriftReview
          project={child}
          connected={meta.connected}
          objects={meta.objects}
          loadDescribe={meta.loadDescribe}
          onApplySnapshot={(snapshot, affected) =>
            mutateChild((p) => {
              const now = new Date().toISOString();
              return {
                ...p,
                sfSnapshot: snapshot,
                versions: [
                  ...p.versions,
                  {
                    id: uid("ver"),
                    label: `pre-refresh ${now}`,
                    createdAt: now,
                    summary: `Snapshot applied after drift check (${affected.length} findings). Previous snapshot ${p.sfSnapshot?.fingerprint ?? "none"}.`,
                    mappings: p.mappings,
                    decisions: p.decisions,
                    recordPlans: p.recordPlans,
                    relationships: p.relationships,
                    fingerprint: p.sfSnapshot?.fingerprint ?? "",
                  },
                ],
              };
            })
          }
        />

        {showReview && (
          <ReviewPanel
            project={child}
            onMutate={mutateChild}
            onFocus={(path) => {
              setSelectedSource(path);
              if (path) {
                document.getElementById("mapping-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          />
        )}

        {sourceJsonOpen && child.source && (
          <SourceJsonModal
            name={child.source.name}
            origin={child.sourceApi ?? child.sourceSystem ?? null}
            text={child.source.originalText}
            pathIds={child.source.paths.map((x) => x.id)}
            mappingPaths={[...new Set(child.mappings.map((m) => m.sourcePath))]}
            onApplySource={applySourceReplace}
            onClose={() => setSourceJsonOpen(false)}
          />
        )}
      </div>
    );
  }

  // ================= workspace root =================
  // studio is non-null here (null studio exits at the start screen or the
  // child workspace above) - the guard is for the type checker.
  if (!studio) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] text-[#A39B8E]">project{studio.customer ? ` · ${studio.customer}` : ""}</p>
          <p className="truncate text-[14px] font-semibold text-[#27241F]">{studio.name}</p>
          <p className="font-mono text-[10px] text-[#A39B8E]">
            {studio.status} · {studio.mappingIds.length} mappings · {studio.experience?.screens.length ?? 0} screens · {studio.apiCatalog?.operations.length ?? 0} APIs
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {saveBadge}
          {saveState === "error" && (
            <Button size="sm" variant="ghost" onClick={() => void persistStudio(studio)}>
              Retry
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void persistStudio(studio)}>
            Save
          </Button>
          {confirmDeleteWs ? (
            <span className="flex items-center gap-1.5 text-[11px]">
              <span className="font-semibold text-[#B3261E]">Delete project? Mappings are kept.</span>
              <Button size="sm" variant="ghost" onClick={() => void deleteWorkspace()}>
                Yes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteWs(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteWs(true)}>
              Delete
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStudio(null);
              setChildMaps([]);
              refreshAll();
            }}
          >
            Close
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Project modules">
        {(
          [
            ["mappings", `Mappings · ${studio.mappingIds.length}`],
            ["experience", "Experience"],
            ["apis", "API Catalog"],
            ["decisions", "Decisions"],
            ["deliverables", "Deliverables"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={module === id}
            onClick={() => switchModule(id)}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer ${
              module === id
                ? "border-[#211F1B] bg-[#211F1B] text-white"
                : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
            }`}
          >
            {label}
            {id === "experience" && studio.experience && studio.experience.screens.length > 0 && (
              <span className="ml-1.5 font-mono text-[10px] opacity-70">{studio.experience.screens.length}</span>
            )}
          </button>
        ))}
      </div>

      {module === "mappings" && (
        <MappingsTab
          studio={studio}
          items={childMaps}
          library={library}
          onOpen={(id) => void openChild(id)}
          onNew={() => startChildWizard("attached")}
          onNewStandalone={() => startChildWizard("standalone")}
          onAttach={(id) => void attachExisting(id)}
          onDetach={(id) => {
            const next = detachMapping(studio, id, new Date().toISOString());
            void persistStudio(next).then(() => {
              setStudio(next);
              setChildMaps((prev) => prev.filter((c) => c.id !== id));
            });
          }}
          onDelete={(id) => void deleteChildById(id)}
        />
      )}

      {module === "experience" && studio.experience && (
        <ExperienceWorkspace
          project={studio}
          payloadChoices={payloadChoices}
          onMutate={mutateStudio}
          onOpenApis={() => switchModule("apis")}
          onOpenMapping={(id) => void openChild(id)}
          autoAddScreen={expFresh}
          snapshotObjects={cross.snapshots}
          childMaps={childMaps}
        />
      )}

      {module === "apis" && studio.apiCatalog && (
        <ApiCatalogPanel project={studio} cross={cross} onMutate={mutateStudio} onOpenIntegration={() => switchModule("mappings")} />
      )}

      {module === "decisions" && (
        <div className="space-y-3">
          <DecisionsPanel project={studio} onMutate={mutateStudio} />
          <SnapshotsPanel
            project={studio}
            artifactChoices={artifactChoices}
            onMutate={mutateStudio}
            onOpenScreen={() => switchModule("experience")}
            onOpenApis={() => switchModule("apis")}
          />
        </div>
      )}

      {module === "deliverables" && (
        <WorkspaceDeliverables
          root={studio}
          childMaps={childMaps}
          cross={cross}
          onImported={(root, mappings) => {
            setStudio(root);
            setChildMaps(mappings);
            setModule("mappings");
            refreshAll();
          }}
        />
      )}

      {childWizardModal}
    </div>
  );

}

  function MappingsTab({
  studio,
  items,
  library,
  onOpen,
  onNew,
  onNewStandalone,
  onAttach,
  onDetach,
  onDelete,
}: {
  studio: StudioProject;
  items: MappingProject[];
  library: ProjectSummary[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onNewStandalone: () => void;
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // B2: inline attach list superseded by palette attach mode (kept dead until LibraryList converges).
  const attaching = false;
  const attachable = library.filter((s) => !studio.mappingIds.includes(s.id));
  const [confirmChildDelete, setConfirmChildDelete] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Integration mappings · {items.length}
          </p>
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent("gravenx:palette", { detail: { attachOnly: true } }))} title="Search everything to attach - mappings, wireframes, contracts">
              Attach existing…
            </Button>
            <Button size="sm" onClick={onNew}>
              New mapping
            </Button>
            <Button size="sm" variant="ghost" onClick={onNewStandalone} title="Create outside this project - opens direct, attach later if needed">
              New standalone
            </Button>
          </span>
        </div>
        {false && attaching && (
          <div className="mb-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
            {attachable.length === 0 ? (
              <p className="text-[12px] text-[#A39B8E]">No standalone mappings to attach.</p>
            ) : (
              <ul className="space-y-1">
                {attachable.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-[12px]">
                    <span className="flex-1 truncate font-semibold text-[#27241F]">{s.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => onAttach(s.id)}>
                      Attach
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {items.length === 0 && (
          <p className="py-4 text-center text-[13px] text-[#A39B8E]">
            No mappings yet - create one per payload (orders, quotes, …), each with its own source JSON and Salesforce field maps.
          </p>
        )}
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#F0EBE0] px-3 py-2">
              <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                <span className="block truncate text-[13px] font-semibold text-[#27241F] hover:underline">{c.name}</span>
                <span className="block font-mono text-[10px] text-[#A39B8E]">
                  {c.sourceApi ?? "no source API"} · {c.mappings.length} mappings · {c.recordPlans.length} plans
                  {c.sfSnapshot ? ` · snapshot ${c.sfSnapshot.fingerprint}` : " · no snapshot"}
                </span>
              </button>
              {confirmChildDelete === c.id ? (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-semibold text-[#B3261E]">Delete mapping + its rows?</span>
                  <Button size="sm" variant="ghost" onClick={() => { onDelete(c.id); setConfirmChildDelete(null); }}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmChildDelete(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => onDetach(c.id)} title="Detach from project (mapping record kept)">
                    Detach
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmChildDelete(c.id)}>
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LibraryList({
  library,
  onOpen,
  onBack,
  onNew,
  onChanged,
  onUpgrade,
}: {
  library: ProjectSummary[];
  onOpen: (id: string) => void;
  onBack: () => void;
  onNew: () => void;
  onChanged: () => void;
  onUpgrade?: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const shown =
    query.length === 0
      ? library
      : library.filter((s) =>
          [s.name, s.description ?? "", s.sourceApi ?? "", s.targetSystem ?? "", s.status]
            .join(" ")
            .toLowerCase()
            .includes(query),
        );

  const act = async (fn: () => Promise<void>) => {
    await fn().catch(() => undefined);
    setConfirmDelete(null);
    setRenaming(null);
    onChanged();
  };

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[#27241F]">Standalone mappings · {shown.length}{shown.length !== library.length ? ` of ${library.length}` : ""}</p>
        <span className="flex items-center gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, purpose, API…"
            aria-label="Search standalone mappings"
            className="w-44 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[12px] focus:border-[#A98450] focus:outline-none"
          />
          <Button size="sm" variant="ghost" onClick={onBack}>
            ← Start
          </Button>
          <Button size="sm" onClick={onNew} title="Create a mapping without a project umbrella - paste JSON and map direct">
            New standalone mapping
          </Button>
        </span>
      </div>
      {library.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-[13px] text-[#A39B8E]">No saved mappings yet - map one payload direct, no project needed.</p>
          <Button size="sm" className="mt-3" onClick={onNew}>
            Create the first one
          </Button>
        </div>
      )}
      {library.length > 0 && shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-[#E8E2D8] p-4 text-center text-[12px] text-[#A39B8E]">No mappings match &ldquo;{q.trim()}&rdquo; - clear the search or create a new one above.</p>
      )}
      <ul className="space-y-2">
        {shown.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#F0EBE0] px-3 py-2">
            <button type="button" onClick={() => onOpen(s.id)} className="min-w-0 flex-1 cursor-pointer text-left">
              <span className="block truncate text-[13px] font-semibold text-[#27241F] hover:underline">{s.name}</span>
              {s.description ? (
                <span className="block truncate text-[11px] text-[#777168]">{s.description}</span>
              ) : null}
              <span className="block font-mono text-[10px] text-[#A39B8E]">
                {s.sourceApi ?? "—"} · {s.status} · {s.mappingCount} mappings · {s.unmappedCount} unmapped · {s.decisionOpenCount} open decisions · v{s.versionCount}
              </span>
            </button>
            {renaming === s.id ? (
              <span className="flex items-center gap-1.5">
                <input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  aria-label="New project name"
                  className="w-40 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[12px] focus:border-[#A98450] focus:outline-none"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    act(async () => {
                      const p = await loadProject(s.id);
                      if (p && renameText.trim()) await saveProject({ ...p, name: renameText.trim(), updatedAt: new Date().toISOString() });
                    })
                  }
                >
                  Save
                </Button>
              </span>
            ) : (
              <>
                {onUpgrade && (
                  <Button size="sm" variant="ghost" onClick={() => onUpgrade(s.id)} title="Wrap in a new project umbrella">
                    Upgrade to project
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenaming(s.id);
                    setRenameText(s.name);
                  }}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    act(async () => {
                      const p = await loadProject(s.id);
                      if (p) await saveProject(duplicateProject(p, `map-${Date.now().toString(36)}`, new Date().toISOString()));
                    })
                  }
                >
                  Duplicate
                </Button>
                {confirmDelete === s.id ? (
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-[#B3261E] font-semibold">Delete?</span>
                    <Button size="sm" variant="ghost" onClick={() => act(() => deleteProject(s.id))}>
                      Yes
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      No
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(s.id)}>
                    Delete
                  </Button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
