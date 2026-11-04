"use client";

import { useMemo, useState } from "react";
import { rankObjects } from "@/lib/search/rank";
import { diagnoseProfile } from "@/lib/contracts/diagnostics";
import { adaptDescribe } from "@/lib/contracts/metadata-adapter";
import Button from "../ui/Button";
import Input from "../ui/Input";
import type { ContractsTabsProps } from "./ContractsTabs";

/**
 * Profiles tab: inventory with validation state, create (from live objects),
 * duplicate / rename / delete / export / import. Seeded Acquisition +
 * Enrichment are editable templates, not fixed contracts.
 */
export function ProfileManager(props: ContractsTabsProps) {
  const { drafts, stored, activeId, setActiveId, dirtyIds, objects, describes, session } = props;
  const { onCreate, onDuplicate, onDelete, onExport, onSave } = props;
  const [search, setSearch] = useState("");
  const [newObject, setNewObject] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = [...drafts.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    if (!q) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.targetObjectApiName.toLowerCase().includes(q) ||
        p.consumer.toLowerCase().includes(q)
    );
  }, [drafts, search]);

  const statusFor = (id: string) => {
    const draft = drafts.get(id);
    if (!draft) return { errors: 0, warnings: 0 };
    const desc = describes.get(draft.targetObjectApiName);
    const storedSnap = stored.find((s) => s.id === id)?.snapshot ?? null;
    const meta = new Map();
    if (desc) {
      for (const f of adaptDescribe(desc).fields) meta.set(f.apiName, f);
    } else if (storedSnap) {
      try {
        for (const f of adaptDescribe(storedSnap.describe as never).fields) meta.set(f.apiName, f);
      } catch {
        /* corrupt snapshot - treated as unknown */
      }
    }
    const issues = diagnoseProfile({
      profile: draft,
      metaByName: meta,
      snapshotCapturedAt: storedSnap?.capturedAt ?? null,
    });
    return {
      errors: issues.filter((i) => i.level === "error").length,
      warnings: issues.filter((i) => i.level === "warning").length,
    };
  };

  const objSuggestions = useMemo(() => {
    const q = newObject.trim().toLowerCase();
    if (!q) return [];
    return rankObjects(objects, newObject, 8).filter(
      (o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [objects, newObject]);

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E8E2D8] p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Profiles · {list.length}
        </p>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => props.fileRef.current?.click()}>
          Import
        </Button>
        <Input
          placeholder="Search profiles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search profiles"
        />
        <span className="flex items-center gap-1 text-[11px] text-[#A39B8E]">
          Template:
          {(
            [
              ["acquisition", "Acquisition"],
              ["enrichment", "Enrichment"],
              ["bff", "BFF Intake"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              onClick={() => props.onCreateFromTemplate(kind)}
              className="rounded-md border border-[#E8E2D8] bg-white px-1.5 py-0.5 text-[11px] hover:border-[#A98450] hover:text-[#27241F] transition-colors cursor-pointer"
              title={`New profile from the ${label} template`}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="text-[11px] text-[#A39B8E]" title="New profile needs a connected org for metadata">
          {session ? "New from:" : "Connect to create"}
        </span>
        <div className="relative">
          <Input
            placeholder="Search objects…"
            value={newObject}
            onChange={(e) => setNewObject(e.target.value)}
            aria-label="Search objects for a new profile"
            disabled={!session}
          />
          {newObject.trim() !== "" && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[#E8E2D8] bg-white shadow-lg">
              {objSuggestions.map((o) => (
                <button
                  key={o.name}
                  onClick={() => {
                    onCreate(o.name);
                    setNewObject("");
                  }}
                  className="w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F1E8] transition-colors cursor-pointer"
                >
                  <span className="font-medium text-[#27241F]">{o.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-[#A39B8E]">{o.name}</span>
                </button>
              ))}
              {objSuggestions.length === 0 && <p className="px-3 py-2 text-[13px] text-[#A39B8E]">No matches</p>}
            </div>
          )}
        </div>
      </div>

      <div className="divide-y divide-[#E8E2D8]">
        {list.map((p) => {
          const st = statusFor(p.id);
          const dirty = dirtyIds.has(p.id);
          const isActive = p.id === activeId;
          return (
            <div key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors ${isActive ? "bg-[#F5F1E8]/60" : ""}`}>
              <button
                onClick={() => setActiveId(p.id)}
                className="min-w-0 flex-1 text-left cursor-pointer"
                title="Open profile"
              >
                {renaming === p.id ? (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          props.onPatchDraft(p.id, { name: renameValue.trim() || p.name });
                          setRenaming(null);
                        }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      aria-label="Rename profile"
                    />
                  </span>
                ) : (
                  <>
                    <span className="text-[14px] font-semibold text-[#27241F]">
                      {p.name}
                      {dirty && <span className="ml-1.5 text-[#A98450]" title="Unsaved changes">•</span>}
                    </span>
                    <span className="ml-2 font-mono text-[11px] text-[#A39B8E]">
                      {p.targetObjectApiName} · {p.consumer || "no consumer"} · {p.fields.length}f · rev {p.revision}
                    </span>
                  </>
                )}
              </button>
              <span className={`flex items-center gap-1 font-mono text-[11px] ${st.errors > 0 ? "text-[#B84C42]" : st.warnings > 0 ? "text-[#B98335]" : "text-[#32815B]"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${st.errors > 0 ? "bg-[#B84C42]" : st.warnings > 0 ? "bg-[#B98335]" : "bg-[#32815B]"}`} />
                {st.errors > 0 ? `${st.errors}e` : st.warnings > 0 ? `${st.warnings}w` : "ok"}
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setActiveId(p.id); props.setTab("designer"); }}>Open</Button>
                <Button variant="ghost" size="sm" onClick={() => { setRenaming(p.id); setRenameValue(p.name); }}>Rename</Button>
                <Button variant="ghost" size="sm" onClick={() => onDuplicate(p.id)}>Duplicate</Button>
                <Button variant="ghost" size="sm" onClick={() => onExport(p.id)}>Export</Button>
                {!confirmDelete || confirmDelete !== p.id ? (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(p.id)}>Delete</Button>
                ) : (
                  <>
                    <Button variant="danger" size="sm" onClick={() => { setConfirmDelete(null); onDelete(p.id); }}>Confirm</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>Keep</Button>
                  </>
                )}
                {dirty && (
                  <Button size="sm" onClick={() => onSave(p.id)}>Save</Button>
                )}
              </span>
            </div>
          );
        })}
        {list.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-[#A39B8E]">No profiles - create one from an object above.</p>
        )}
      </div>
    </div>
  );
}
