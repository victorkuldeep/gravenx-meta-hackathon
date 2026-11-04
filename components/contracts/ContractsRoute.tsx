"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";
import {
  deleteStoredProfile,
  listStoredProfiles,
  parseStoredProfileImport,
  saveStoredProfile,
  seedStoredProfiles,
  type StoredContractProfile,
} from "@/lib/contracts/persistence";
import { newStudioId } from "@/lib/composite/studio";
import { compileContract } from "@/lib/contracts/openapi-compiler";
import { adaptDescribe } from "@/lib/contracts/metadata-adapter";
import { summarizeProfileChange, saveRevision, listRevisions, deleteRevisionsForProfile } from "@/lib/contracts/revisions";
import { instantiateTemplate, type SeedKind } from "@/lib/contracts/seeds";
import type { ContractProfile } from "@/lib/contracts/types";
import { ConnectModal } from "@/components/ConnectModal";
import { ContractsTabs } from "./ContractsTabs";

export type ContractsTab = "profiles" | "designer" | "preview" | "validate" | "versions" | "compare";

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

/**
 * Contracts route: session + canonical drafts + persistence.
 * Drafts live in memory (switching never loses work); Save persists to
 * IndexedDB with the current metadata snapshot. Dirty = draft ≠ stored.
 */
export function ContractsRoute() {
  const [session, setSession] = useState<ReturnType<typeof readSession>>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [describes, setDescribes] = useState<Map<string, SalesforceDescribeResult>>(new Map());
  const [stored, setStored] = useState<StoredContractProfile[]>([]);
  const [drafts, setDrafts] = useState<Map<string, ContractProfile>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<ContractsTab>("profiles");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);

  // Session restore + stored profiles load.
  useEffect(() => {
    setSession(readSession());
    listStoredProfiles()
      .then(async (list) => {
        if (list.length === 0) {
          const seeds = seedStoredProfiles();
          for (const s of seeds) {
            try {
              await saveStoredProfile(s);
            } catch {
              /* IDB unavailable - seeds stay in memory */
            }
          }
          setStored(seeds);
          setDrafts(new Map(seeds.map((s) => [s.id, s.profile])));
          setActiveId(seeds[0]?.id ?? null);
        } else {
          setStored(list);
          setDrafts(new Map(list.map((s) => [s.id, s.profile])));
          setActiveId(list[0]?.id ?? null);
        }
      })
      .catch(() => {
        const seeds = seedStoredProfiles();
        setStored(seeds);
        setDrafts(new Map(seeds.map((s) => [s.id, s.profile])));
        setActiveId(seeds[0]?.id ?? null);
      });
  }, []);

  // Objects list follows the session.
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
        /* offline - snapshot covers viewing */
      }
      return null;
    },
    [session, describes]
  );

  const dirtyIds = useMemo(() => {
    const out = new Set<string>();
    for (const s of stored) {
      const d = drafts.get(s.id);
      if (d && JSON.stringify(d) !== JSON.stringify(s.profile)) out.add(s.id);
    }
    for (const id of drafts.keys()) {
      if (!stored.some((s) => s.id === id)) out.add(id);
    }
    return out;
  }, [stored, drafts]);

  const patchDraft = useCallback((id: string, patch: Partial<ContractProfile> | ((p: ContractProfile) => ContractProfile)) => {
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
      const live = describes.get(draft.targetObjectApiName) ?? null;
      const prevSnap = stored.find((s) => s.id === id)?.snapshot ?? null;
      const snapshot =
        live != null
          ? { capturedAt: Date.now(), describe: live }
          : prevSnap;
      const record: StoredContractProfile = {
        id,
        profile: { ...draft, updatedAt: Date.now(), metadataSnapshotRef: snapshot ? `snap-${id}-${snapshot.capturedAt}` : null, metadataCapturedAt: snapshot?.capturedAt ?? null },
        snapshot,
      };
      try {
        await saveStoredProfile(record);
      } catch {
        setNotice("IndexedDB unavailable - changes kept in memory only.");
      }
      // Revision log: compile with live-or-snapshot metadata, append when
      // the document hash moved. The bumped revision lands in BOTH states
      // so save-then-clean holds.
      let bumped: number | null = null;
      try {
        const prevStored = stored.find((s) => s.id === id) ?? null;
        const source = describes.get(record.profile.targetObjectApiName) ?? (record.snapshot?.describe as SalesforceDescribeResult | undefined) ?? null;
        if (source) {
          const meta = new Map(adaptDescribe(source).fields.map((f) => [f.apiName, f]));
          const compiled = compileContract({
            profile: record.profile,
            metaByName: meta,
            snapshotCapturedAt: record.snapshot?.capturedAt ?? null,
          });
          const history = await listRevisions(id).catch(() => []);
          if (history[0]?.hash !== compiled.hash) {
            bumped = (history[0]?.revision ?? 0) + 1;
            await saveRevision({
              id: newStudioId("rev"),
              profileId: id,
              revision: bumped,
              hash: compiled.hash,
              summary: summarizeProfileChange(prevStored?.profile ?? null, record.profile),
              compiler: "contracts-1",
              generatedAt: Date.now(),
              snapshotRef: record.profile.metadataSnapshotRef,
              profile: { ...record.profile, revision: bumped },
              document: compiled.document as Record<string, unknown>,
            }).catch(() => undefined);
          }
        }
      } catch {
        /* revisions are best-effort */
      }
      if (bumped !== null) {
        const withRev = { ...record, profile: { ...record.profile, revision: bumped } };
        setStored((prev) => (prev.some((s) => s.id === id) ? prev.map((s) => (s.id === id ? withRev : s)) : [...prev, withRev]));
        setDrafts((prev) => new Map(prev).set(id, withRev.profile));
        setNotice(`Saved revision ${bumped}.`);
      } else {
        setStored((prev) => (prev.some((s) => s.id === id) ? prev.map((s) => (s.id === id ? record : s)) : [...prev, record]));
        setDrafts((prev) => new Map(prev).set(id, record.profile));
        setNotice(`Saved revision ${record.profile.revision}.`);
      }
      window.setTimeout(() => setNotice(null), 2500);
    },
    [drafts, describes, stored]
  );

  const handleCreate = useCallback(
    (objectName: string) => {
      const obj = objects.find((o) => o.name === objectName);
      if (!obj) return;
      const id = newStudioId("prof");
      const now = Date.now();
      const profile: ContractProfile = {
        id,
        name: `${obj.label} Contract`,
        description: "",
        targetObjectApiName: obj.name,
        orgId: session ? new URL(session.instanceUrl).host : "",
        consumer: "",
        direction: "inbound",
        apiTitle: `${obj.label} API`,
        apiVersion: "1.0.0",
        salesforceApiVersion: session?.apiVersion ?? "v66.0",
        baseUrl: "",
        resourcePath: "",
        operations: [
          { operation: "POST", enabled: true, operationId: `create${obj.name.replace(/__c$/i, "")}`, summary: `Create ${obj.label.toLowerCase()}`, description: "", tags: [obj.label] },
          { operation: "PATCH", enabled: false, operationId: `update${obj.name.replace(/__c$/i, "")}`, summary: `Update ${obj.label.toLowerCase()}`, description: "", tags: [obj.label] },
        ],
        fields: [],
        security: { type: "oauth2-client-credentials", description: "OAuth2 client credentials (placeholder, no secrets exported)." },
        revision: 1,
        createdAt: now,
        updatedAt: now,
        metadataSnapshotRef: null,
        metadataCapturedAt: null,
      };
      setDrafts((prev) => new Map(prev).set(id, profile));
      setActiveId(id);
      setTab("designer");
      void fetchDescribe(objectName);
    },
    [objects, session, fetchDescribe]
  );

  const handleCreateFromTemplate = useCallback(
    (kind: SeedKind) => {
      const id = newStudioId("prof");
      const now = Date.now();
      const template = instantiateTemplate(kind, id, now);
      const profile: ContractProfile = {
        ...template,
        orgId: session ? new URL(session.instanceUrl).host : "",
        salesforceApiVersion: session?.apiVersion ?? "v66.0",
      };
      setDrafts((prev) => new Map(prev).set(id, profile));
      setActiveId(id);
      setTab("designer");
      if (session) void fetchDescribe(profile.targetObjectApiName);
    },
    [session, fetchDescribe]
  );

  const handleRestoreRevision = useCallback(
    (profile: ContractProfile) => {
      setDrafts((prev) => new Map(prev).set(profile.id, { ...profile, updatedAt: Date.now() }));
      setActiveId(profile.id);
      setTab("designer");
      setNotice(`Restored revision ${profile.revision} into drafts - Save to keep it.`);
      window.setTimeout(() => setNotice(null), 3000);
    },
    []
  );

  const handleDuplicate = useCallback(
    (id: string) => {
      const src = drafts.get(id);
      if (!src) return;
      const cloneId = newStudioId("prof");
      const now = Date.now();
      const clone: ContractProfile = {
        ...src,
        id: cloneId,
        name: `${src.name} copy`,
        fields: src.fields.map((f) => ({ ...f, mapping: f.mapping ? { ...f.mapping, enumMap: f.mapping.enumMap ? { ...f.mapping.enumMap } : undefined } : undefined })),
        operations: src.operations.map((o) => ({ ...o, tags: [...o.tags] })),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      setDrafts((prev) => new Map(prev).set(cloneId, clone));
      setActiveId(cloneId);
    },
    [drafts]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteStoredProfile(id);
      } catch {
        /* ignore */
      }
      try {
        await deleteRevisionsForProfile(id);
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
      const snap = stored.find((s) => s.id === id)?.snapshot ?? null;
      const blob = new Blob([JSON.stringify({ kind: "sf-contract-profile", version: 1, id, profile: draft, snapshot: snap }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "contract"}.contract.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [drafts, stored]
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const imported = parseStoredProfileImport(text);
        const clash = drafts.has(imported.id) || stored.some((s) => s.id === imported.id);
        const id = clash ? newStudioId("prof") : imported.id;
        const profile = clash ? { ...imported.profile, id, name: `${imported.profile.name} (imported)` } : imported.profile;
        setDrafts((prev) => new Map(prev).set(id, profile));
        setActiveId(id);
        setTab("designer");
        setNotice(`Imported ${profile.name} - review, then Save.`);
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
      {!session && (
        <section aria-label="Welcome" className="hero-mesh overflow-hidden rounded-xl border border-[var(--color-line)]">
          <div className="px-6 sm:px-10 pt-10 sm:pt-12 pb-8 max-w-3xl">
            <p className="hero-kicker">
              <span className="hero-kicker__dot" aria-hidden="true" />
              API Contract Studio
            </p>
            <h1 className="hero-title mt-3 text-4xl sm:text-5xl text-ivory-950">
              Design contracts, <em>ship OpenAPI.</em>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-ivory-700">
              Author profiles, map fields, compile deterministic OpenAPI 3.1 -
              versions and compatibility included. Connect an org for live
              metadata, or explore the seeded profiles right now.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-accent)] text-white text-xs font-medium hover:bg-[var(--color-accent)]/90 transition-all cursor-pointer"
              >
                Connect org
              </button>
              <button
                type="button"
                onClick={() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-strong)] transition-colors cursor-pointer"
              >
                Explore profiles →
              </button>
            </div>
          </div>
        </section>
      )}
      <div ref={studioRef} className="scroll-mt-20">
      <ContractsTabs
        tab={tab}
        setTab={setTab}
        session={session}
        objects={objects}
        describes={describes}
        stored={stored}
        drafts={drafts}
        activeId={activeId}
        setActiveId={setActiveId}
        dirtyIds={dirtyIds}
        notice={notice}
        fileRef={fileRef}
        onConnect={() => setShowConnect(true)}
        onSave={handleSave}
        onCreate={handleCreate}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onExport={handleExport}
        onImportFile={handleImportFile}
      onPatchDraft={patchDraft}
      onFetchDescribe={fetchDescribe}
      onCreateFromTemplate={handleCreateFromTemplate}
      onRestoreRevision={handleRestoreRevision}
    />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import contract profile"
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
