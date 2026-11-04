"use client";

import { useMemo, useState, type RefObject } from "react";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";
import { STAGES, stageStatus } from "@/lib/api-contracts/stages";
import type { StoredApiProject } from "@/lib/api-contracts/persistence";
import type { ApiProject, HttpMethod, OperationDef } from "@/lib/api-contracts/types";
import { newStudioId } from "@/lib/composite/studio";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { AssistantPanel } from "./AssistantPanel";
import { SchemaWorkbench } from "./SchemaWorkbench";

export interface OrchestratorProps {
  session: { instanceUrl: string; token: string; apiVersion: string } | null;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  stored: StoredApiProject[];
  drafts: Map<string, ApiProject>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  stageId: string;
  setStageId: (id: string) => void;
  dirtyIds: Set<string>;
  notice: string | null;
  fileRef: RefObject<HTMLInputElement | null>;
  onConnect: () => void;
  onSave: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImportFile: (file: File) => void;
  onPatchDraft: (id: string, patch: Partial<ApiProject> | ((p: ApiProject) => ApiProject)) => void;
  onFetchDescribe: (objectName: string) => Promise<SalesforceDescribeResult | null>;
}

/**
 * Design orchestrator: project + stages left, stage activity center,
 * assistant right. Resumable - drafts persist in memory, Save persists.
 */
export function Orchestrator(props: OrchestratorProps) {
  const { drafts, activeId, setActiveId, stageId, setStageId, dirtyIds, notice } = props;
  const { onSave, onCreate, onDuplicate, onDelete, onExport, fileRef } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draft = activeId ? (drafts.get(activeId) ?? null) : null;
  const statuses = useMemo(() => (draft ? stageStatus(draft) : []), [draft]);
  const doneCount = statuses.filter((s) => s.complete).length;

  return (
    <div className="space-y-4">
      {/* Project bar */}
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[#27241F]">API Contract Architect</h2>
            <p className="text-xs text-[#777168]">Design custom APIs from Salesforce data models.</p>
          </div>
          <span className="flex-1" />
          <select
            value={activeId ?? ""}
            onChange={(e) => setActiveId(e.target.value || null)}
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] max-w-[240px]"
            aria-label="Active project"
          >
            {[...drafts.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{dirtyIds.has(p.id) ? " •" : ""}
              </option>
            ))}
          </select>
          {draft && (
            <>
              <Button size="sm" onClick={onCreate}>New</Button>
              <Button variant="ghost" size="sm" onClick={() => onDuplicate(draft.id)}>Duplicate</Button>
              <Button variant="ghost" size="sm" onClick={() => onExport(draft.id)}>Export</Button>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>Import</Button>
              {!confirmDelete ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
              ) : (
                <>
                  <Button variant="danger" size="sm" onClick={() => { setConfirmDelete(false); onDelete(draft.id); }}>Confirm</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
                </>
              )}
              <Button size="sm" disabled={!dirtyIds.has(draft.id)} onClick={() => onSave(draft.id)}>
                {dirtyIds.has(draft.id) ? "Save •" : "Saved"}
              </Button>
            </>
          )}
        </div>
        {notice && (
          <p className="mt-1.5 rounded-lg bg-[#F5F1E8] px-2 py-1 text-[11px] text-[#777168]" role="status">{notice}</p>
        )}
        <div className="mt-2 flex overflow-x-auto" role="tablist" aria-label="Design stages">
          {STAGES.map((s) => {
            const st = statuses.find((x) => x.id === s.id);
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={stageId === s.id}
                onClick={() => setStageId(s.id)}
                title={s.purpose}
                className={`flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
                  stageId === s.id
                    ? "text-[#27241F] underline underline-offset-8 decoration-[#A98450] decoration-2"
                    : "text-[#A39B8E] hover:text-[#27241F]"
                }`}
              >
                <span className="font-mono text-[10px] text-[#A39B8E]">{s.n}</span>
                {s.title}
                <span className={`h-1.5 w-1.5 rounded-full ${st?.complete ? "bg-[#32815B]" : "bg-[#E8E2D8]"}`} title={st?.complete ? "Complete" : st?.blockers.join(" ") ?? ""} />
              </button>
            );
          })}
          <span className="ml-auto hidden self-center font-mono text-[11px] text-[#A39B8E] sm:inline">
            {doneCount}/{STAGES.length} stages · schemas, mappings, review land in later phases
          </span>
        </div>
      </div>

      {!draft ? (
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
          No project open - create one to begin the workshop.
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)_280px]">
          <ProjectPanel draft={draft} statuses={statuses} onPatch={(p) => props.onPatchDraft(draft.id, p)} setStageId={setStageId} />
          <StageBody
            draft={draft}
            stageId={stageId}
            objects={props.objects}
            describes={props.describes}
            stored={props.stored}
            session={props.session}
            onPatchDraft={props.onPatchDraft}
            onFetchDescribe={props.onFetchDescribe}
            onConnect={props.onConnect}
          />
          <AssistantPanel {...props} />
        </div>
      )}
    </div>
  );
}

// ── Left: project, parties, stages, ops ─────────────────────────────────────

function ProjectPanel({
  draft,
  statuses,
  onPatch,
  setStageId,
}: {
  draft: ApiProject;
  statuses: { id: string; complete: boolean; blockers: string[] }[];
  onPatch: (p: Partial<ApiProject>) => void;
  setStageId: (id: string) => void;
}) {
  const done = statuses.filter((s) => s.complete).length;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <Input label="Project name" value={draft.name} onChange={(e) => onPatch({ name: e.target.value })} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-[#777168]">Lifecycle</span>
            <select
              value={draft.intent.lifecycle}
              onChange={(e) => onPatch({ intent: { ...draft.intent, lifecycle: e.target.value as ApiProject["intent"]["lifecycle"] } })}
              className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] cursor-pointer"
            >
              {["draft", "in-design", "in-review", "approved", "deprecated", "archived"].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <Input label="Contract version" value={draft.apiVersion} onChange={(e) => onPatch({ apiVersion: e.target.value })} spellCheck={false} />
        </div>
        <p className="mt-2 font-mono text-[11px] text-[#A39B8E]">
          {draft.consumer.system || "no consumer"} → {draft.provider.system || "no provider"}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F0EAE1]">
          <div className="h-full rounded-full bg-[#32815B] transition-all" style={{ width: `${Math.round((done / statuses.length) * 100)}%` }} />
        </div>
        <p className="mt-1 font-mono text-[11px] text-[#A39B8E]">{done}/{statuses.length} stages complete</p>
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Operations · {draft.operations.length}</p>
        <div className="mt-1.5 space-y-1">
          {draft.operations.map((o) => (
            <div key={o.id} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] hover:bg-[#F5F1E8]">
              <span className="rounded border border-[#E8E2D8] bg-[#F8F6F0] px-1 font-mono text-[10px] font-bold text-[#27241F]">{o.method}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#777168]">{o.route}</span>
            </div>
          ))}
          {draft.operations.length === 0 && <p className="px-1 py-1 text-[11px] text-[#A39B8E]">None yet - stage 4.</p>}
        </div>
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Stages</p>
        <div className="mt-1.5 space-y-0.5">
          {STAGES.map((s) => {
            const st = statuses.find((x) => x.id === s.id);
            return (
              <button
                key={s.id}
                onClick={() => setStageId(s.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-[#F5F1E8] transition-colors cursor-pointer"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st?.complete ? "bg-[#32815B]" : "bg-[#E8E2D8]"}`} />
                <span className="font-mono text-[10px] text-[#A39B8E]">{s.n}</span>
                <span className="text-[#27241F]">{s.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Center: stage activity ──────────────────────────────────────────────────

function StageBody(props: {
  draft: ApiProject;
  stageId: string;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  stored: StoredApiProject[];
  session: { instanceUrl: string; token: string; apiVersion: string } | null;
  onPatchDraft: (id: string, patch: Partial<ApiProject> | ((p: ApiProject) => ApiProject)) => void;
  onFetchDescribe: (objectName: string) => Promise<SalesforceDescribeResult | null>;
  onConnect: () => void;
}) {
  const { draft, stageId } = props;
  if (stageId === "intent") return <IntentStage {...props} draft={draft} />;
  if (stageId === "parties") return <PartiesStage {...props} draft={draft} />;
  if (stageId === "boundary") return <BoundaryStage {...props} draft={draft} />;
  if (stageId === "operations") return <OperationsStage {...props} draft={draft} />;
  if (stageId === "routes") return <RoutesStage {...props} draft={draft} />;
  return (
    <SchemaWorkbench
      draft={draft}
      objects={props.objects}
      describes={props.describes}
      snapshots={props.stored.find((s) => s.id === draft.id)?.snapshots ?? []}
      session={props.session}
      onPatchDraft={props.onPatchDraft}
      onFetchDescribe={props.onFetchDescribe}
      onConnect={props.onConnect}
    />
  );
}

type StageProps = {
  draft: ApiProject;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  session: { instanceUrl: string; token: string; apiVersion: string } | null;
  onPatchDraft: (id: string, patch: Partial<ApiProject> | ((p: ApiProject) => ApiProject)) => void;
  onFetchDescribe: (objectName: string) => Promise<SalesforceDescribeResult | null>;
  onConnect: () => void;
};

function Card({ title, purpose, children }: { title: string; purpose: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
      <div className="border-b border-[#E8E2D8] px-4 py-2.5">
        <p className="text-[14px] font-semibold text-[#27241F]">{title}</p>
        <p className="text-xs text-[#777168]">{purpose}</p>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function IntentStage({ draft, onPatchDraft }: StageProps) {
  const set = (patch: Partial<ApiProject["intent"]>) =>
    onPatchDraft(draft.id, { intent: { ...draft.intent, ...patch } });
  const q = [
    "What business capability does this API expose?",
    "What problem is it solving - and what is explicitly out of scope?",
    "Is it new, replacing an interface, or consolidating operations?",
  ];
  return (
    <Card title="1 · Business intent" purpose="Name the capability, purpose, owners and lifecycle. No object name is an adequate business description.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="API name" value={draft.intent.apiName} onChange={(e) => set({ apiName: e.target.value })} placeholder="Lead Acquisition" />
        <Input label="Business capability" value={draft.intent.capability} onChange={(e) => set({ capability: e.target.value })} placeholder="Lead acquisition" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ivory-700">Business purpose</label>
        <textarea value={draft.intent.purpose} onChange={(e) => set({ purpose: e.target.value })} rows={2} className="w-full rounded-lg border border-[#E8E2D8] px-3 py-2 text-sm focus:border-[#A98450] focus:outline-none" placeholder="Acquire new leads from…" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ivory-700">Explicitly out of scope</label>
        <textarea value={draft.intent.outOfScope} onChange={(e) => set({ outOfScope: e.target.value })} rows={2} className="w-full rounded-lg border border-[#E8E2D8] px-3 py-2 text-sm focus:border-[#A98450] focus:outline-none" placeholder="Lead scoring, deduplication…" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Business owner" value={draft.intent.businessOwner} onChange={(e) => set({ businessOwner: e.target.value })} />
        <Input label="Technical owner" value={draft.intent.technicalOwner} onChange={(e) => set({ technicalOwner: e.target.value })} />
        <Input label="Target release" value={draft.intent.targetRelease} onChange={(e) => set({ targetRelease: e.target.value })} placeholder="2026-Q4" />
        <Input label="Known constraints" value={draft.intent.constraints} onChange={(e) => set({ constraints: e.target.value })} placeholder="Rate limits, PII…" />
      </div>
      <Questions items={q} />
    </Card>
  );
}

function PartiesStage({ draft, onPatchDraft }: StageProps) {
  const setC = (patch: Partial<ApiProject["consumer"]>) =>
    onPatchDraft(draft.id, { consumer: { ...draft.consumer, ...patch } });
  const setP = (patch: Partial<ApiProject["provider"]>) =>
    onPatchDraft(draft.id, { provider: { ...draft.provider, ...patch } });
  return (
    <Card title="2 · Consumer & provider" purpose="Who consumes, who provides, how they interact. Trust lives here.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-[#E8E2D8] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Consumer</p>
          <Input label="System" value={draft.consumer.system} onChange={(e) => setC({ system: e.target.value })} placeholder="Marketing Platform" />
          <Input label="Owner" value={draft.consumer.owner} onChange={(e) => setC({ owner: e.target.value })} />
        </div>
        <div className="space-y-2 rounded-lg border border-[#E8E2D8] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Provider</p>
          <Input label="System" value={draft.provider.system} onChange={(e) => setP({ system: e.target.value })} placeholder="Salesforce-facing API layer" />
          <Input label="Owner" value={draft.provider.owner} onChange={(e) => setP({ owner: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ivory-700">Integration direction</span>
          <select value={draft.direction} onChange={(e) => onPatchDraft(draft.id, { direction: e.target.value as ApiProject["direction"] })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-3 py-2 text-sm cursor-pointer">
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
            <option value="bidirectional">bidirectional</option>
          </select>
        </label>
        <Input label="Trust boundary" value={draft.trustBoundary} onChange={(e) => onPatchDraft(draft.id, { trustBoundary: e.target.value })} placeholder="Partner network → DMZ → org" />
      </div>
      <Questions
        items={[
          "Synchronous request/response, async command, event, query or batch?",
          "What data sensitivity rides this interface?",
          "Never auto-generate REST paths for event contracts.",
        ]}
      />
    </Card>
  );
}

function BoundaryStage({ draft, objects, session, onPatchDraft, onConnect, onFetchDescribe }: StageProps) {
  const [resInput, setResInput] = useState("");
  const [objSearch, setObjSearch] = useState("");

  const addResource = () => {
    const v = resInput.trim();
    if (!v || draft.boundary.resources.includes(v)) return;
    onPatchDraft(draft.id, { boundary: { ...draft.boundary, resources: [...draft.boundary.resources, v] } });
    setResInput("");
  };
  const toggleObject = (name: string) => {
    const has = draft.boundary.participatingObjects.includes(name);
    onPatchDraft(draft.id, {
      boundary: {
        ...draft.boundary,
        participatingObjects: has
          ? draft.boundary.participatingObjects.filter((o) => o !== name)
          : [...draft.boundary.participatingObjects, name],
      },
    });
    if (!has) void onFetchDescribe(name);
  };
  const q = objSearch.trim().toLowerCase();
  const matches = q === "" ? [] : objects.filter((o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)).slice(0, 8);

  return (
    <Card title="3 · API boundary" purpose="Resources exposed, objects involved, information intentionally hidden.">
      <div>
        <p className="mb-1 text-xs font-medium text-ivory-700">Business resources</p>
        <div className="flex flex-wrap gap-1.5">
          {draft.boundary.resources.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded-full border border-[#E8E2D8] bg-[#F8F6F0] px-2.5 py-1 text-xs">
              {r}
              <button
                onClick={() => onPatchDraft(draft.id, { boundary: { ...draft.boundary, resources: draft.boundary.resources.filter((x) => x !== r) } })}
                className="text-[#A39B8E] hover:text-[#B84C42] cursor-pointer"
                aria-label={`Remove ${r}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <Input placeholder="Add resource… e.g. Lead" value={resInput} onChange={(e) => setResInput(e.target.value)} aria-label="Add resource" />
          <Button size="sm" onClick={addResource} disabled={resInput.trim() === ""}>Add</Button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-ivory-700">Participating Salesforce objects</p>
        <div className="flex flex-wrap gap-1.5">
          {draft.boundary.participatingObjects.map((o) => (
            <span key={o} className="inline-flex items-center gap-1 rounded-full bg-[#211F1B] px-2.5 py-1 font-mono text-[11px] text-white">
              {o}
              <button
                onClick={() => toggleObject(o)}
                className="text-white/60 hover:text-white cursor-pointer"
                aria-label={`Remove ${o}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {session ? (
          <div className="relative mt-1.5">
            <Input placeholder="Search org objects to include…" value={objSearch} onChange={(e) => setObjSearch(e.target.value)} aria-label="Search objects" />
            {q !== "" && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#E8E2D8] bg-white shadow-lg">
                {matches.map((o) => (
                  <button
                    key={o.name}
                    onClick={() => {
                      toggleObject(o.name);
                      setObjSearch("");
                    }}
                    className="w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F1E8] cursor-pointer"
                  >
                    <span className="font-medium">{o.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-[#A39B8E]">{o.name}</span>
                  </button>
                ))}
                {matches.length === 0 && <p className="px-3 py-2 text-[13px] text-[#A39B8E]">No matches</p>}
              </div>
            )}
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={onConnect} className="mt-1.5">Connect org to browse objects</Button>
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={draft.boundary.entityOriented}
          onChange={(e) => onPatchDraft(draft.id, { boundary: { ...draft.boundary, entityOriented: e.target.checked } })}
          className="h-3.5 w-3.5 rounded"
        />
        Entity-oriented (off = task-oriented)
      </label>
      <div>
        <label className="mb-1 block text-xs font-medium text-ivory-700">Intentionally hidden</label>
        <textarea
          value={draft.boundary.hiddenInfo}
          onChange={(e) => onPatchDraft(draft.id, { boundary: { ...draft.boundary, hiddenInfo: e.target.value } })}
          rows={2}
          placeholder="Internal IDs, audit fields, unapproved objects…"
          className="w-full rounded-lg border border-[#E8E2D8] px-3 py-2 text-sm focus:border-[#A98450] focus:outline-none"
        />
      </div>
      <Questions
        items={[
          "Entity lifecycle, business action, search, command - or async initiation?",
          "One resource per sObject is not required; composites are allowed.",
          "Never force every operation into CRUD.",
        ]}
      />
    </Card>
  );
}

function Questions({ items }: { items: string[] }) {
  return (
    <div className="rounded-lg bg-[#F8F6F0] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Architect questions</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-[#777168]">
        {items.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </div>
  );
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function OperationsStage({ draft, onPatchDraft }: StageProps) {
  const [selId, setSelId] = useState<string | null>(draft.operations[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [newMethod, setNewMethod] = useState<HttpMethod>("POST");
  const [newRoute, setNewRoute] = useState("");
  const [newShell, setNewShell] = useState("");

  const selected = draft.operations.find((o) => o.id === selId) ?? null;
  const setOp = (id: string, patch: Partial<OperationDef>) =>
    onPatchDraft(draft.id, { operations: draft.operations.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

  const addOp = () => {
    if (newName.trim() === "" || newRoute.trim() === "") return;
    const id = newStudioId("op");
    const base = newRoute.trim();
    const op: OperationDef = {
      id,
      name: newName.trim(),
      operationId: `${newMethod.toLowerCase()}${base.split("/").filter(Boolean).map((s) => s.replace(/[{}\-]/g, "").slice(0, 1).toUpperCase() + s.replace(/[{}\-]/g, "").slice(1)).join("") || "Resource"}`,
      summary: "",
      description: "",
      tags: [],
      method: newMethod,
      route: base.startsWith("/") ? base : `/${base}`,
      resource: "",
      interaction: "sync-request-response",
      requestSchema: null,
      responseSchema: null,
      parameters: [],
      errorResponses: [],
      security: [],
      status: "draft",
      dependencies: [],
      notes: "",
    };
    onPatchDraft(draft.id, { operations: [...draft.operations, op] });
    setSelId(id);
    setNewName("");
    setNewRoute("");
  };

  const addShell = () => {
    const name = newShell.trim().replace(/[^A-Za-z0-9_]/g, "");
    if (name === "" || draft.schemas.some((s) => s.name === name)) return;
    onPatchDraft(draft.id, { schemas: [...draft.schemas, { name, description: "", properties: [] }] });
    setNewShell("");
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
        <div className="border-b border-[#E8E2D8] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Operation inventory · {draft.operations.length}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Input placeholder="Name…" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New operation name" />
            <select value={newMethod} onChange={(e) => setNewMethod(e.target.value as HttpMethod)} className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-xs cursor-pointer" aria-label="Method">
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <div className="min-w-[140px] flex-1">
              <Input placeholder="/leads/{leadId}" value={newRoute} onChange={(e) => setNewRoute(e.target.value)} aria-label="New operation route" spellCheck={false} />
            </div>
            <Button size="sm" onClick={addOp} disabled={newName.trim() === "" || newRoute.trim() === ""}>Add</Button>
          </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {draft.operations.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelId(o.id)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${selId === o.id ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8] text-[#27241F]"}`}
            >
              <span className={`rounded border px-1 font-mono text-[10px] font-bold ${selId === o.id ? "border-white/30 bg-white/10 text-white" : "border-[#E8E2D8] bg-[#F8F6F0] text-[#27241F]"}`}>{o.method}</span>
              <span className={`min-w-0 flex-1 truncate font-mono text-[12px] ${selId === o.id ? "text-white/80" : "text-[#777168]"}`}>{o.route}</span>
              <span className={`min-w-0 flex-1 truncate font-medium ${selId === o.id ? "text-white" : ""}`}>{o.name}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label="Delete operation"
                onClick={(e) => {
                  e.stopPropagation();
                  onPatchDraft(draft.id, { operations: draft.operations.filter((x) => x.id !== o.id) });
                  if (selId === o.id) setSelId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onPatchDraft(draft.id, { operations: draft.operations.filter((x) => x.id !== o.id) });
                  }
                }}
                className={`shrink-0 rounded p-1 text-xs leading-none cursor-pointer ${selId === o.id ? "text-white/60 hover:text-white" : "text-[#A39B8E] hover:text-[#B84C42]"}`}
              >
                ×
              </span>
            </button>
          ))}
          {draft.operations.length === 0 && <p className="px-2 py-3 text-[12px] text-[#A39B8E]">No operations yet.</p>}
        </div>
      </div>

      {selected && (
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Business name" value={selected.name} onChange={(e) => setOp(selected.id, { name: e.target.value })} />
            <Input label="operationId" value={selected.operationId} onChange={(e) => setOp(selected.id, { operationId: e.target.value })} spellCheck={false} />
          </div>
          <Input label="Summary" value={selected.summary} onChange={(e) => setOp(selected.id, { summary: e.target.value })} />
          <div>
            <label className="mb-1 block text-xs font-medium text-ivory-700">Description</label>
            <textarea value={selected.description} onChange={(e) => setOp(selected.id, { description: e.target.value })} rows={2} className="w-full rounded-lg border border-[#E8E2D8] px-3 py-2 text-sm focus:border-[#A98450] focus:outline-none" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ivory-700">Request schema</span>
              <select value={selected.requestSchema ?? ""} onChange={(e) => setOp(selected.id, { requestSchema: e.target.value || null })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[13px] cursor-pointer">
                <option value="">— none —</option>
                {draft.schemas.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ivory-700">Response schema</span>
              <select value={selected.responseSchema ?? ""} onChange={(e) => setOp(selected.id, { responseSchema: e.target.value || null })} className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[13px] cursor-pointer">
                <option value="">— none —</option>
                {draft.schemas.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          <Input
            label="Tags (comma-separated)"
            value={selected.tags.join(", ")}
            onChange={(e) => setOp(selected.id, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            spellCheck={false}
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-ivory-700">Architect notes</label>
            <textarea value={selected.notes} onChange={(e) => setOp(selected.id, { notes: e.target.value })} rows={2} className="w-full rounded-lg border border-[#E8E2D8] px-3 py-2 text-sm focus:border-[#A98450] focus:outline-none" />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Schema shells · {draft.schemas.length} <span className="normal-case font-normal">(full designer lands next phase)</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {draft.schemas.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 rounded-full border border-[#E8E2D8] bg-[#F8F6F0] px-2.5 py-1 font-mono text-[11px]" title={s.description || s.name}>
              {s.name}
              <button
                onClick={() => onPatchDraft(draft.id, { schemas: draft.schemas.filter((x) => x.name !== s.name) })}
                className="text-[#A39B8E] hover:text-[#B84C42] cursor-pointer"
                aria-label={`Delete schema ${s.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <Input placeholder="NewSchemaName" value={newShell} onChange={(e) => setNewShell(e.target.value)} aria-label="New schema shell name" spellCheck={false} />
          <Button size="sm" onClick={addShell} disabled={newShell.trim() === ""}>Shell</Button>
        </div>
      </div>
    </div>
  );
}

function RoutesStage({ draft, onPatchDraft }: StageProps) {
  const addParam = (opId: string, name: string, location: "path" | "query") => {
    const op = draft.operations.find((o) => o.id === opId);
    if (!op || op.parameters.some((p) => p.name === name)) return;
    onPatchDraft(draft.id, {
      operations: draft.operations.map((o) =>
        o.id === opId
          ? { ...o, parameters: [...o.parameters, { name, in: location, required: location === "path", type: "string", description: "" }] }
          : o
      ),
    });
  };
  const removeParam = (opId: string, name: string) => {
    onPatchDraft(draft.id, {
      operations: draft.operations.map((o) =>
        o.id === opId ? { ...o, parameters: o.parameters.filter((p) => p.name !== name) } : o
      ),
    });
  };

  return (
    <Card title="5 · Routes" purpose="Methods, paths, parameters - validated against the operation inventory.">
      {draft.operations.length === 0 && (
        <p className="text-[13px] text-[#A39B8E]">Inventory operations first (stage 4) - routes follow the inventory, never lead it.</p>
      )}
      <div className="space-y-2">
        {draft.operations.map((op) => {
          const declared = new Set(op.parameters.filter((p) => p.in === "path").map((p) => p.name));
          const inRoute = [...op.route.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
          const missing = [...new Set(inRoute)].filter((p) => !declared.has(p));
          return (
            <div key={op.id} className="rounded-lg border border-[#E8E2D8] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-[#E8E2D8] bg-[#F8F6F0] px-1.5 py-0.5 font-mono text-[11px] font-bold">{op.method}</span>
                <Input value={op.route} onChange={(e) => onPatchDraft(draft.id, { operations: draft.operations.map((o) => (o.id === op.id ? { ...o, route: e.target.value } : o)) })} aria-label={`Route for ${op.operationId}`} spellCheck={false} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {op.parameters.map((p) => (
                  <span key={`${p.in}:${p.name}`} className="inline-flex items-center gap-1 rounded-full border border-[#E8E2D8] bg-white px-2 py-0.5 font-mono text-[11px]">
                    {p.in === "path" ? `{${p.name}}` : `?${p.name}`}
                    <button onClick={() => removeParam(op.id, p.name)} className="text-[#A39B8E] hover:text-[#B84C42] cursor-pointer" aria-label={`Remove ${p.name}`}>×</button>
                  </span>
                ))}
                {missing.map((p) => (
                  <button
                    key={p}
                    onClick={() => addParam(op.id, p, "path")}
                    className="rounded-full border border-dashed border-[#B98335] px-2 py-0.5 font-mono text-[11px] text-[#B98335] hover:bg-amber-50 cursor-pointer"
                    title={`Declare {${p}} as a path parameter`}
                  >
                    + declare {`{${p}}`}
                  </button>
                ))}
              </div>
              {missing.length > 0 && (
                <p className="mt-1 text-[11px] text-[#B98335]">Path parameters without schemas - declare them explicitly.</p>
              )}
            </div>
          );
        })}
      </div>
      <Questions
        items={[
          "Resource lifecycle, business action, search, command or async initiation?",
          "POST /leads and POST /lead-enrichment share a method, not semantics.",
          "Suggestions never rename routes - the architect does.",
        ]}
      />
    </Card>
  );
}
