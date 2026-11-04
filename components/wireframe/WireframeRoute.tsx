"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { DraftDialog, type DraftConfirmation } from "../draw/DraftDialog";
import { SYSTEM_DRAFT_KEY, buildSystemProject, type TopologyDraft } from "@/lib/draw/toSystemDraft";
import { canTransition, cloneExperience, newExperience, renameExperience, type Experience, type SnapshotStatus } from "@/lib/wireframe/model";
import { WIREFRAME_SAMPLES, type WireframeSample } from "@/lib/wireframe/samples";
import { experiencePackage, importExperiencePackage } from "@/lib/wireframe/packageIo";
import { deleteExperience, listExperiences, saveExperience } from "@/lib/wireframe/store";
import { findDeepRecord, syncDeepParam, useDeepParam } from "@/lib/deep/deep";
import { validateShareEnvelope } from "@/lib/share/envelope";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import { ShareButton } from "../share/ShareButton";
import { experienceToDraft } from "@/lib/wireframe/systemBridge";
import { ConfirmDialog } from "./ConfirmDialog";
import { InventoryAside } from "../ui/InventoryAside";
import { HistoryDialog } from "./HistoryDialog";
import { SpecDialog } from "./SpecDialog";
import { WireCanvas } from "./WireCanvas";

const STATUS_STYLE: Record<SnapshotStatus, string> = {
  draft: "bg-[#F5F1E8] text-[#777168] border-[#E3D9C6]",
  "in-review": "bg-[#F5EEDF] text-[#8A6A2F] border-[#E5C98F]",
  approved: "bg-[#EAF3ED] text-[#2F7D4F] border-[#BFDCC9]",
};

const STATUS_LABEL: Record<SnapshotStatus, string> = {
  draft: "Draft",
  "in-review": "In Review",
  approved: "Approved",
};

const STATUS_HINT: Record<SnapshotStatus, string> = {
  draft: "Submit for review",
  "in-review": "Approve, or send back to draft",
  approved: "Terminal - clone to iterate",
};

/** Workflow status menu: current state checked, only legal transitions clickable. */
function StatusMenu({ exp, onPick }: { exp: Experience; onPick: (to: SnapshotStatus) => void }) {
  const [open, setOpen] = useState(false);
  const options = (Object.keys(STATUS_LABEL) as SnapshotStatus[]).filter(
    (s) => s === exp.status || canTransition(exp.status, s),
  );
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={STATUS_HINT[exp.status]}
        className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[exp.status]}`}
      >
        {STATUS_LABEL[exp.status]} ▾
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close status menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-[#E8E2D8] bg-white py-1 shadow-md">
            {options.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                disabled={s === exp.status}
                onClick={() => {
                  setOpen(false);
                  if (s !== exp.status) onPick(s);
                }}
                className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-[#27241F] hover:bg-[#F5F1E8] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="w-3 text-center text-[#9A7653]">{s === exp.status ? "✓" : ""}</span>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Wireframe Studio route (EPIC 01): experience library with the
 * approval workflow. The canvas itself lands in EPIC 02; this shell owns
 * identity, version, status - the model, not the pixels.
 */
export function WireframeRoute() {
  const router = useRouter();
  const [items, setItems] = useState<Experience[]>([]);
  const [name, setName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [draft, setDraft] = useState<TopologyDraft | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rev, setRev] = useState(0);
  const [q, setQ] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listExperiences().catch(() => []));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep link: ?exp= opens the exact experience.
  const deepExp = useDeepParam("exp");
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !loaded || deepExp === null) return;
    const hit = findDeepRecord(items, deepExp);
    if (hit) {
      setActiveId(hit.id);
      deepDone.current = true;
    }
  }, [loaded, deepExp, items]);

  // Keep the URL on the open experience so every design is linkable and a
  // reload restores it. Library view clears the key.
  useEffect(() => {
    if (!loaded) return;
    syncDeepParam("exp", activeId);
  }, [loaded, activeId]);

  // Collaboration entry: ?share=<id> imports the shared package as a local
  // copy, then selects it. Consumed once; the key is cleared either way.
  const deepShare = useDeepParam("share");
  const shareDone = useRef(false);
  useEffect(() => {
    if (shareDone.current || !loaded || deepShare === null) return;
    shareDone.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(deepShare)}`);
        const raw: unknown = await res.json().catch(() => null);
        const env = validateShareEnvelope(raw);
        if (!res.ok || !env || env.kind !== "experience") {
          setImportError("That share link is expired, invalid, or not an experience.");
          return;
        }
        const r = importExperiencePackage(JSON.stringify(env.data));
        if (!r.ok || !r.experience) {
          setImportError(r.error ?? "Could not import the shared experience.");
          return;
        }
        if (await saveExperience(r.experience).catch(() => false)) {
          setActiveId(r.experience.id);
          await refresh();
        } else {
          setImportError("Could not save the shared experience.");
        }
      } catch {
        setImportError("Could not read that share link.");
      } finally {
        syncDeepParam("share", null);
      }
    })();
  }, [loaded, deepShare, refresh]);

  const create = async () => {
    const exp = newExperience(name);
    if (await saveExperience(exp).catch(() => false)) {
      setName("");
      setActiveId(exp.id);
      await refresh();
    }
  };

  const loadWireSample = async (sample: WireframeSample) => {
    setImportError(null);
    const exp = sample.build();
    if (await saveExperience(exp).catch(() => false)) {
      setActiveId(exp.id);
      await refresh();
    } else {
      setImportError("Could not save the sample.");
    }
  };

  const importFile = async (file: File) => {
    setImportError(null);
    let text = "";
    try {
      text = await file.text();
    } catch {
      setImportError("Could not read that file.");
      return;
    }
    const r = importExperiencePackage(text);
    if (!r.ok || !r.experience) {
      setImportError(r.error ?? "Import failed.");
      return;
    }
    if (await saveExperience(r.experience).catch(() => false)) {
      setActiveId(r.experience.id);
      await refresh();
    } else {
      setImportError("Could not save the import.");
    }
  };

  const [pendingExpDelete, setPendingExpDelete] = useState<string | null>(null);

  const remove = async (id: string) => {
    setPendingExpDelete(null);
    await deleteExperience(id).catch(() => {});
    if (activeId === id) setActiveId(null);
    await refresh();
  };

  const clone = async (exp: Experience) => {
    const copy = cloneExperience(exp);
    if (await saveExperience(copy).catch(() => false)) {
      setActiveId(copy.id);
      await refresh();
    }
  };

  const transition = async (exp: Experience, to: SnapshotStatus) => {
    if (!canTransition(exp.status, to)) return;
    if (await saveExperience({ ...exp, status: to }).catch(() => false)) {
      await refresh();
    }
  };

  const commitRename = async (exp: Experience) => {
    const next = renameExperience(exp, renameDraft);
    setRenaming(false);
    if (!next) return;
    if (await saveExperience(next).catch(() => false)) {
      await refresh();
    }
  };

  const active = items.find((i) => i.id === activeId) ?? null;

  const handleConfirm = (selection: DraftConfirmation) => {
    if (!draft) return;
    const project = buildSystemProject(draft, selection);
    try {
      sessionStorage.setItem(SYSTEM_DRAFT_KEY, JSON.stringify(project));
    } catch {
      /* private mode etc - the canvas still holds the experience */
    }
    setDraft(null);
    router.push("/system");
  };

  const shown = q.trim()
    ? items.filter((e) => `${e.name} ${e.status}`.toLowerCase().includes(q.trim().toLowerCase()))
    : items;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {(active || !loaded || items.length > 0) && (
      <div className="shrink-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
        {!active ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-semibold text-[#27241F]">Wireframe Studio</h2>
            <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Experience · Schema · API · Build
            </p>
            <span className="ml-auto font-mono text-[10px] text-[#A39B8E]">
              {items.length} experience{items.length === 1 ? "" : "s"}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveId(null)} title="Back to the library">
              ← Library
            </Button>
            {renaming ? (
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void commitRename(active)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename(active);
                  if (e.key === "Escape") setRenaming(false);
                }}
                autoFocus
                maxLength={160}
                spellCheck={false}
                aria-label="Experience name"
                className="min-w-0 flex-1 rounded-lg border border-[#C9A86A] bg-white px-2 py-1 text-[15px] font-semibold text-[#27241F] focus:outline-none"
              />
            ) : (
              <h2
                className="min-w-0 flex-1 cursor-text truncate text-[15px] font-semibold text-[#27241F]"
                title="Double-click to rename"
                onDoubleClick={() => {
                  setRenameDraft(active.name);
                  setRenaming(true);
                }}
              >
                {active.name}
              </h2>
            )}
            {!renaming && (
              <button
                type="button"
                onClick={() => {
                  setRenameDraft(active.name);
                  setRenaming(true);
                }}
                title="Rename experience"
                aria-label="Rename experience"
                className="shrink-0 rounded p-1 text-[#A39B8E] transition-colors cursor-pointer hover:bg-[#F5F1E8] hover:text-[#27241F]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            )}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[active.status]}`}>
              {STATUS_LABEL[active.status]} · v{active.version}
            </span>
            {active.status === "draft" && (
              <Button size="sm" variant="secondary" onClick={() => void transition(active, "in-review")}>
                Submit for review
              </Button>
            )}
            {active.status === "in-review" && (
              <>
                <Button size="sm" variant="secondary" onClick={() => void transition(active, "draft")}>
                  Request changes
                </Button>
                <Button size="sm" onClick={() => void transition(active, "approved")}>
                  Approve
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={() => setDraft(experienceToDraft(active))} title="Send this experience to System Design">
              Send to System
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSpecOpen(true)} title="Generate AI build instructions">
              Build spec
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setHistoryOpen(true)} title="Snapshots and export">
              History
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                try {
                  const text = JSON.stringify(experiencePackage(active), null, 2);
                  const safe = active.name.toLowerCase().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "experience";
                  const blob = new Blob([text], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${safe}-package.json`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch {
                  /* download unavailable */
                }
              }}
              title="Download this experience as a portable package JSON"
            >
              Export
            </Button>
            <DeepLinkButton path="/wireframe" param="exp" value={active.id} />
            <ShareButton kind="experience" name={active.name} getPayload={() => experiencePackage(active)} />
            <Button size="sm" variant="secondary" onClick={() => void clone(active)} title="Duplicate this experience and open the copy">
              Clone
            </Button>
            <a
              href="/console"
              title="Open Console - track this experience as tasks"
              className="inline-flex items-center rounded-lg border border-[#E3D9C6] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#3A352D] transition-colors hover:border-[#C9A86A] hover:text-[#27241F]"
            >
              Console
            </a>
          </div>
        )}
      </div>
      )}

      {!active && (
        <div className="grid min-h-0 flex-1 items-stretch gap-3 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)]">
          <InventoryAside
            fill
            title="Experiences"
            count={items.length}
            query={q}
            onQuery={setQ}
            searchLabel="Search experiences…"
            onNew={() => nameRef.current?.focus()}
            newTitle="Jump to the name box and start one"
            zeroTitle="No experiences yet"
            zeroLines={[
              "Name one experience on the right to begin.",
              "Screens compose structured components.",
              "Bind fields to live Salesforce schema.",
              "Submit, review, approve the workflow.",
              "Export a build spec for coding agents.",
            ]}
          >
            <ul className="space-y-1.5">
              {shown.map((exp) => (
                <li key={exp.id} className="group flex flex-wrap items-center gap-3 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setActiveId(exp.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title={`Open ${exp.name}`}
                  >
                    <span className="block truncate text-[13px] font-semibold text-[#27241F]">{exp.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-[#A39B8E]">
                      v{exp.version} · {exp.screens.length} screen{exp.screens.length === 1 ? "" : "s"} ·{" "}
                      {exp.components.length} component{exp.components.length === 1 ? "" : "s"} ·{" "}
                      {new Date(exp.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <span className="w-24 shrink-0 text-right">
                    <StatusMenu exp={exp} onPick={(to) => void transition(exp, to)} />
                  </span>
                  <span className="flex w-[68px] shrink-0 items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => void clone(exp)}
                      title={`Clone ${exp.name}`}
                      aria-label={`Clone ${exp.name}`}
                      className="rounded p-1.5 text-[#A39B8E] opacity-0 transition-colors cursor-pointer hover:bg-[#F5F1E8] hover:text-[#27241F] group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="12" height="12" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingExpDelete(exp.id)}
                      title={`Delete ${exp.name}`}
                      aria-label={`Delete ${exp.name}`}
                      className="rounded p-1.5 text-[#C9BFAE] opacity-0 transition-colors cursor-pointer hover:bg-red-500/10 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </InventoryAside>
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
              <svg
                width="430"
                height="150"
                viewBox="0 0 430 150"
                fill="none"
                aria-hidden="true"
                className="mx-auto mt-1 h-auto w-full max-w-[400px]"
              >
                <rect x="115" y="14" width="200" height="122" rx="12" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
                <rect x="115" y="14" width="200" height="22" rx="11" fill="#F5F1E8" stroke="#9A7653" strokeWidth="1.5" />
                <circle cx="131" cy="25" r="3" fill="#C9A86A" />
                <circle cx="141" cy="25" r="3" fill="#C9A86A" />
                <circle cx="151" cy="25" r="3" fill="#C9A86A" />
                <rect x="129" y="48" width="120" height="10" rx="5" fill="#27241F" />
                <rect x="129" y="64" width="172" height="8" rx="4" fill="#E3D9C6" />
                <rect x="129" y="78" width="80" height="26" rx="6" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
                <rect x="217" y="78" width="80" height="26" rx="6" fill="#FFFFFF" stroke="#E3D9C6" strokeWidth="1.5" />
                <rect x="129" y="110" width="172" height="14" rx="7" fill="#C9A86A" />
                <line x1="315" y1="75" x2="352" y2="75" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx="352" cy="75" r="9" fill="#27241F" />
                <path d="M348 75 L351.5 78.5 L357 71.5" stroke="#C9A86A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <text x="215" y="148" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700" fill="#A39B8E">SCREEN · BIND · SHIP</text>
              </svg>
              <h2 className="mt-1 text-center text-[15px] font-semibold text-[#27241F]">Wireframe Studio</h2>
              <p className="mx-auto mt-1 max-w-xl text-center text-xs text-[#777168]">
                Schema-aware experience modeling: screens composed of structured, composable assets bound to Salesforce
                schema - existing, proposed or external. The canvas is a view; the model is the truth.
              </p>
              <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
                Experience · Schema · API · Build
              </p>
            </div>
            <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
              <div className="flex gap-1.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create();
                  }}
                  placeholder="New experience - e.g. Customer Management Portal"
                  aria-label="New experience name"
                  spellCheck={false}
                  ref={nameRef}
                  className="min-w-0 flex-1 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
                />
                <Button onClick={() => void create()}>New Exp</Button>
                <Button variant="secondary" onClick={() => fileRef.current?.click()} title="Import a package JSON from a fellow dev">
                  Import
                </Button>
                <Button variant="secondary" onClick={() => setShowSamples((v) => !v)} title="Browse training samples - load one to start" aria-expanded={showSamples}>
                  {showSamples ? "Hide samples" : "Samples"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-label="Import experience package"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void importFile(f);
                  }}
                />
              </div>
              {importError && <p className="mt-2 text-[11px] text-red-700">{importError}</p>}
              {showSamples && (
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
                  {WIREFRAME_SAMPLES.map((s) => (
                    <li key={s.name} className="rounded-lg border border-[#EFE9DC] bg-[#FAF8F2] px-2.5 py-2">
                      <p className="truncate text-[12px] font-semibold text-[#27241F]" title={s.name}>{s.name.replace(/^Sample: /, "")}</p>
                      <p className="mt-0.5 line-clamp-2 min-h-7 text-[11px] leading-snug text-[#777168]">{s.hint}</p>
                      <button
                        type="button"
                        onClick={() => void loadWireSample(s)}
                        className="mt-1.5 cursor-pointer rounded-md border border-[#E3D9C6] bg-white px-2 py-1 text-[11px] font-semibold text-[#3A352D] transition-colors hover:border-[#C9A86A] hover:text-[#27241F]"
                      >
                        Load sample
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">01</p>
                <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Model screens</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">Compose structured components - the canvas is a view, the model is the truth.</p>
              </div>
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">02</p>
                <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Bind schema</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">Every field binds to live Salesforce metadata - existing, proposed or external.</p>
              </div>
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">03</p>
                <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Review and ship</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">Submit, approve, then export a build spec your coding agent can execute.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className="min-h-0 flex-1 overflow-y-auto">
        <WireCanvas
          key={`${active.id}:${rev}`}
          experience={active}
          onSaved={(next) => setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)))}
        />
        </div>
      )}
      {draft && (
        <DraftDialog
          draft={draft}
          onCancel={() => setDraft(null)}
          onConfirm={handleConfirm}
        />
      )}
      {specOpen && active && (
        <SpecDialog exp={active} onClose={() => setSpecOpen(false)} />
      )}
      {historyOpen && active && (
        <HistoryDialog
          exp={active}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            setHistoryOpen(false);
            setRev((r) => r + 1);
            void refresh();
          }}
        />
      )}
      {pendingExpDelete && (
        <ConfirmDialog
          title="Delete this experience?"
          message={`"${items.find((i) => i.id === pendingExpDelete)?.name ?? "Experience"}" and all of its screens will be removed. Snapshots stay in history. This cannot be undone.`}
          confirmLabel="Delete experience"
          onCancel={() => setPendingExpDelete(null)}
          onConfirm={() => void remove(pendingExpDelete)}
        />
      )}
    </div>
  );
}
