"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";
import {
  deleteStoredProject,
  listStoredProjects,
  parseStoredProjectImport,
  saveStoredProject,
} from "@/lib/api-contracts/persistence";import type { StoredApiProject } from "@/lib/api-contracts/persistence";
import { seedAcquisitionProject, seedEnrichmentProject } from "@/lib/api-contracts/seeds";
import type { ApiProject } from "@/lib/api-contracts/types";
import { ConnectModal } from "@/components/ConnectModal";
import { newStudioId } from "@/lib/composite/studio";
import { Orchestrator } from "./Orchestrator";

function readSession(): { instanceUrl: string; token: string; apiVersion: string } | null {
  try {
    const raw = sessionStorage.getItem("gravenx_session");
    if (!raw) return null;
    const s = JSON.parse(raw) as { instanceUrl?: string; token?: string; apiVersion?: string };
    if (s.instanceUrl && s.token && s.apiVersion) {
      return { instanceUrl: s.instanceUrl, token: s.token, apiVersion: s.apiVersion };
    }
    return null;
  } catch {
    return null;
  }
}

function seedStored(now: number): StoredApiProject[] {
  return [seedAcquisitionProject(), seedEnrichmentProject()].map((project) => ({
    id: project.id,
    project: { ...project, createdAt: now, updatedAt: now },
    snapshots: [],
  }));
}

/**
 * Architect route: session + canonical drafts + persistence.
 * Drafts live in memory (stages are resumable); Save persists.
 */
export function ArchitectRoute() {
  const [session, setSession] = useState<ReturnType<typeof readSession>>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [describes, setDescribes] = useState<Map<string, SalesforceDescribeResult>>(new Map());
  const [stored, setStored] = useState<StoredApiProject[]>([]);
  const [drafts, setDrafts] = useState<Map<string, ApiProject>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stageId, setStageId] = useState("intent");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSession(readSession());
    listStoredProjects()
      .then(async (list) => {
        if (list.length === 0) {
          const seeds = seedStored(Date.now());
          for (const s of seeds) {
            try {
              await saveStoredProject(s);
            } catch {
              /* IDB unavailable - seeds stay in memory */
            }
          }
          setStored(seeds);
          setDrafts(new Map(seeds.map((s) => [s.id, s.project])));
          setActiveId(seeds[0]?.id ?? null);
        } else {
          setStored(list);
          setDrafts(new Map(list.map((s) => [s.id, s.project])));
          setActiveId(list[0]?.id ?? null);
        }
      })
      .catch(() => {
        const seeds = seedStored(Date.now());
        setStored(seeds);
        setDrafts(new Map(seeds.map((s) => [s.id, s.project])));
        setActiveId(seeds[0]?.id ?? null);
      });
  }, []);

  useEffect(() => {
    if (!session) {
      setObjects([]);
      return;
    }
    void apiFetch("/api/salesforce/objects", session)
      .then(async (r) => {
        const data = (await r.json()) as { objects?: SalesforceObject[]; error?: string };
        if (r.ok && Array.isArray(data.objects)) setObjects(data.objects);
        else if (typeof data.error === "string" && isSessionExpiredMessage(data.error)) {
          setSession(null);
          try {
            sessionStorage.removeItem("gravenx_session");
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => undefined);
  }, [session]);

  const handleConnect = useCallback(
    async (instanceUrl: string, token: string, apiVersion: string): Promise<boolean> => {
      setConnecting(true);
      setConnectError(null);
      try {
        const response = await apiFetch("/api/salesforce/connect", { instanceUrl, token, apiVersion });
        const data = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !data.success) {
          setConnectError(typeof data.error === "string" ? data.error : "Connection failed");
          return false;
        }
        try {
          sessionStorage.setItem("gravenx_session", JSON.stringify({ instanceUrl, token, apiVersion }));
        } catch {
          /* ignore */
        }
        setSession({ instanceUrl, token, apiVersion });
        setShowConnect(false);
        return true;
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : "Connection failed");
        return false;
      } finally {
        setConnecting(false);
      }
    },
    []
  );

  const fetchDescribe = useCallback(
    async (objectName: string): Promise<SalesforceDescribeResult | null> => {
      if (!session) return null;
      const hit = describes.get(objectName);
      if (hit) return hit;
      try {
        const response = await apiFetch("/api/salesforce/describe", { ...session, objectName });
        const data = (await response.json()) as SalesforceDescribeResult & { error?: string };
        if (response.ok && data.name) {
          setDescribes((prev) => new Map(prev).set(objectName, data));
          return data;
        }
        if (typeof data.error === "string" && isSessionExpiredMessage(data.error)) setSession(null);
      } catch {
        /* offline */
      }
      return null;
    },
    [session, describes]
  );

  const dirtyIds = useMemo(() => {
    const out = new Set<string>();
    for (const s of stored) {
      const d = drafts.get(s.id);
      if (d && JSON.stringify(d) !== JSON.stringify(s.project)) out.add(s.id);
    }
    for (const id of drafts.keys()) {
      if (!stored.some((s) => s.id === id)) out.add(id);
    }
    return out;
  }, [stored, drafts]);

  const patchDraft = useCallback((id: string, patch: Partial<ApiProject> | ((p: ApiProject) => ApiProject)) => {
    setDrafts((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch, updatedAt: Date.now() };
      const map = new Map(prev);
      map.set(id, next);
      return map;
    });
  }, []);

  const handleSave = useCallback(
    async (id: string) => {
      const draft = drafts.get(id);
      if (!draft) return;
      // Snapshot participating objects with live metadata when available.
      const snapshots: StoredApiProject["snapshots"] = [...(stored.find((s) => s.id === id)?.snapshots ?? [])];
      for (const obj of draft.boundary.participatingObjects) {
        const live = describes.get(obj);
        if (live) {
          const entry = { objectName: obj, capturedAt: Date.now(), describe: live };
          const i = snapshots.findIndex((s) => s.objectName === obj);
          if (i >= 0) snapshots[i] = entry;
          else snapshots.push(entry);
        }
      }
      const record: StoredApiProject = {
        id,
        project: { ...draft, updatedAt: Date.now() },
        snapshots,
      };
      try {
        await saveStoredProject(record);
      } catch {
        setNotice("IndexedDB unavailable - changes kept in memory only.");
      }
      setStored((prev) => (prev.some((s) => s.id === id) ? prev.map((s) => (s.id === id ? record : s)) : [...prev, record]));
      setDrafts((prev) => new Map(prev).set(id, record.project));
      setNotice("Project saved.");
      window.setTimeout(() => setNotice(null), 2500);
    },
    [drafts, describes, stored]
  );

  const handleCreate = useCallback(() => {
    const id = newStudioId("arch");
    const now = Date.now();
    const project: ApiProject = {
      id,
      name: "Untitled API",
      intent: {
        apiName: "", capability: "", purpose: "", outOfScope: "", businessOwner: "",
        technicalOwner: "", lifecycle: "draft", targetRelease: "", constraints: "",
      },
      consumer: { system: "", owner: "" },
      provider: { system: "Salesforce-facing API layer", owner: "" },
      direction: "inbound",
      trustBoundary: "",
      servers: [{ url: "https://api.example.com", description: "External implementation (placeholder)." }],
      boundary: { resources: [], entityOriented: true, hiddenInfo: "", participatingObjects: [] },
      operations: [],
      schemas: [],
      errors: [
        { name: "BadRequest", status: 400, code: "BAD_REQUEST", message: "The request failed validation.", retryable: false, classification: "technical" },
        { name: "Unauthorized", status: 401, code: "UNAUTHORIZED", message: "Missing or invalid credentials.", retryable: false, classification: "technical" },
      ],
      rules: [],
      securitySchemes: [
        { name: "OAuth2", kind: "oauth2", description: "Client credentials (placeholder, no secrets exported)." },
      ],
      defaultSecurity: ["OAuth2"],
      runtime: {},
      decisions: [],
      review: { state: "incomplete", findings: [] },
      approval: { state: "draft", by: "", at: null },
      apiVersion: "1.0.0",
      salesforceApiVersion: session?.apiVersion ?? "v66.0",
      metadataRefs: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    setDrafts((prev) => new Map(prev).set(id, project));
    setActiveId(id);
    setStageId("intent");
  }, [session]);

  const handleDuplicate = useCallback(
    (id: string) => {
      const src = drafts.get(id);
      if (!src) return;
      const cloneId = newStudioId("arch");
      const raw = JSON.parse(JSON.stringify(src)) as ApiProject;
      const clone: ApiProject = { ...raw, id: cloneId, name: `${src.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
      setDrafts((prev) => new Map(prev).set(cloneId, clone));
      setActiveId(cloneId);
    },
    [drafts]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteStoredProject(id);
      } catch {
        /* ignore */
      }
      setStored((prev) => prev.filter((s) => s.id !== id));
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setActiveId((prev) => {
        if (prev !== id) return prev;
        const rest = [...drafts.keys()].filter((k) => k !== id);
        return rest[0] ?? null;
      });
    },
    [drafts]
  );

  const handleExport = useCallback(
    (id: string) => {
      const draft = drafts.get(id);
      if (!draft) return;
      const snap = stored.find((s) => s.id === id)?.snapshots ?? [];
      const blob = new Blob([JSON.stringify({ kind: "sf-architect-project", version: 1, id, project: draft, snapshots: snap }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "api"}.arch.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [drafts, stored]
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const imported = parseStoredProjectImport(await file.text());
        const clash = drafts.has(imported.id) || stored.some((s) => s.id === imported.id);
        const id = clash ? newStudioId("arch") : imported.id;
        const project = clash ? { ...imported.project, id, name: `${imported.project.name} (imported)` } : imported.project;
        setDrafts((prev) => new Map(prev).set(id, project));
        setActiveId(id);
        setNotice(`Imported ${project.name} - review, then Save.`);
        window.setTimeout(() => setNotice(null), 2500);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Import failed.");
        window.setTimeout(() => setNotice(null), 3000);
      }
    },
    [drafts, stored]
  );

  return (
    <>
      <Orchestrator
        session={session}
        objects={objects}
        describes={describes}
        stored={stored}
        drafts={drafts}
        activeId={activeId}
        setActiveId={setActiveId}
        stageId={stageId}
        setStageId={setStageId}
        dirtyIds={dirtyIds}
        notice={notice}
        onConnect={() => setShowConnect(true)}
        onSave={handleSave}
        onCreate={handleCreate}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onExport={handleExport}
        onImportFile={handleImportFile}
        fileRef={fileRef}
        onPatchDraft={patchDraft}
        onFetchDescribe={fetchDescribe}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import architect project"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImportFile(f);
          e.target.value = "";
        }}
      />
      <ConnectModal
        open={showConnect}
        loading={connecting}
        error={connectError}
        initialInstanceUrl=""
        initialToken=""
        initialApiVersion="v66.0"
        onClose={() => {
          if (!connecting) setShowConnect(false);
        }}
        onConnect={handleConnect}
      />
    </>
  );
}
