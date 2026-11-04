"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { ConfirmDialog } from "../wireframe/ConfirmDialog";
import { InventoryAside } from "../ui/InventoryAside";
import { SequenceCanvas } from "./SequenceCanvas";
import { SequenceHistoryDialog } from "./SequenceHistoryDialog";
import {
  canTransition,
  messageCount,
  newSequence,
  renameSequence,
  validateSequence,
  type SequenceDocument,
  type SeqStatus,
} from "@/lib/sequence/model";
import { deleteSequence, listSequences, saveSequence } from "@/lib/sequence/store";
import { importSequenceFile, sequencePackage } from "@/lib/sequence/packageIo";
import { SEQUENCE_SAMPLES, type SequenceSample } from "@/lib/sequence/samples";
import { parseStatements } from "@/lib/sequence/dsl";
import { downloadSequenceMatrix } from "@/lib/sequence/matrix";
import { findDeepRecord, syncDeepParam, useDeepParam } from "@/lib/deep/deep";
import { validateShareEnvelope } from "@/lib/share/envelope";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import { ShareButton } from "../share/ShareButton";

const STATUS_STYLE: Record<SeqStatus, string> = {
  draft: "bg-[#F5F1E8] text-[#777168] border-[#E3D9C6]",
  "in-review": "bg-[#F5EEDF] text-[#8A6A2F] border-[#E5C98F]",
  approved: "bg-[#EAF3ED] text-[#2F7D4F] border-[#BFDCC9]",
};

const STATUS_LABEL: Record<SeqStatus, string> = {
  draft: "Draft",
  "in-review": "In Review",
  approved: "Approved",
};

/**
 * Sequence Studio route: library with the approval workflow.
 * This shell owns
 * identity, version, status - the model, not the pixels.
 */
export function SequenceRoute() {
  const [items, setItems] = useState<SequenceDocument[]>([]);
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rev, setRev] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listSequences().catch(() => []));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep link: ?id= opens the exact sequence document.
  const deepId = useDeepParam("id");
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !loaded || deepId === null) return;
    const hit = findDeepRecord(items, deepId);
    if (hit) {
      setActiveId(hit.id);
      deepDone.current = true;
    }
  }, [loaded, deepId, items]);

  // Keep the URL on the open record so every sequence is linkable and a
  // reload restores it. Library view clears the key.
  useEffect(() => {
    if (!loaded) return;
    syncDeepParam("id", activeId);
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
        if (!res.ok || !env || env.kind !== "sequence") {
          setImportError("That share link is expired, invalid, or not a sequence.");
          return;
        }
        const r = importSequenceFile(JSON.stringify(env.data), "shared-sequence.json");
        if (!r.ok || !r.document) {
          setImportError(r.error ?? "Could not import the shared sequence.");
          return;
        }
        if (await saveSequence(r.document).catch(() => false)) {
          setActiveId(r.document.id);
          await refresh();
        } else {
          setImportError("Could not save the shared sequence.");
        }
      } catch {
        setImportError("Could not read that share link.");
      } finally {
        syncDeepParam("share", null);
      }
    })();
  }, [loaded, deepShare, refresh]);

  const create = async () => {
    const doc = newSequence(name);
    if (await saveSequence(doc).catch(() => false)) {
      setName("");
      setActiveId(doc.id);
      await refresh();
    }
  };

  const loadSample = async (sample: SequenceSample) => {
    setImportError(null);
    const r = parseStatements(sample.dsl);
    if (r.errors.length > 0 || r.participants.length === 0) {
      setImportError("Sample failed to parse.");
      return;
    }
    const doc = { ...newSequence(sample.name), participants: r.participants, nodes: r.nodes };
    if (await saveSequence(doc).catch(() => false)) {
      setActiveId(doc.id);
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
    const r = importSequenceFile(text, file.name);
    if (!r.ok || !r.document) {
      setImportError(r.error ?? "Import failed.");
      return;
    }
    if (await saveSequence(r.document).catch(() => false)) {
      setActiveId(r.document.id);
      await refresh();
    } else {
      setImportError("Could not save the import.");
    }
  };

  const remove = async (id: string) => {
    setPendingDelete(null);
    await deleteSequence(id).catch(() => {});
    if (activeId === id) setActiveId(null);
    await refresh();
  };

  const transition = async (doc: SequenceDocument, to: SeqStatus) => {
    if (!canTransition(doc.status, to)) return;
    if (await saveSequence({ ...doc, status: to }).catch(() => false)) {
      await refresh();
    }
  };

  const commitRename = async (doc: SequenceDocument) => {
    const next = renameSequence(doc, renameDraft);
    setRenaming(false);
    if (!next) return;
    if (await saveSequence(next).catch(() => false)) {
      await refresh();
    }
  };

  const active = items.find((i) => i.id === activeId) ?? null;
  const problems = active ? validateSequence(active) : [];

  const shown = q.trim()
    ? items.filter((d) => `${d.name} ${d.status}`.toLowerCase().includes(q.trim().toLowerCase()))
    : items;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {active && (
      <div className="shrink-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
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
                aria-label="Sequence name"
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
                title="Rename sequence"
                aria-label="Rename sequence"
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
            <Button size="sm" variant="secondary" onClick={() => setHistoryOpen(true)} title="Snapshots and export">
              History
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={matrixBusy}
              onClick={() => {
                setMatrixBusy(true);
                const safe = active.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sequence";
                void downloadSequenceMatrix(active, `${safe}-interaction-matrix.xlsx`).finally(() => setMatrixBusy(false));
              }}
              title="Download the interaction matrix as .xlsx"
            >
              {matrixBusy ? "Building…" : "Matrix (.xlsx)"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                try {
                  const text = JSON.stringify(sequencePackage(active), null, 2);
                  const safe = active.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sequence";
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
              title="Download this sequence as a portable package JSON"
            >
              Export
            </Button>
            <DeepLinkButton path="/sequence" param="id" value={active.id} />
            <ShareButton kind="sequence" name={active.name} getPayload={() => sequencePackage(active)} />
            <a
              href="/console"
              title="Open Console - track this sequence as tasks"
              className="inline-flex items-center rounded-lg border border-[#E3D9C6] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#3A352D] transition-colors hover:border-[#C9A86A] hover:text-[#27241F]"
            >
              Console
            </a>
          </div>
      </div>
      )}

      {!active && (
        <div className="grid min-h-0 flex-1 items-stretch gap-3 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)]">
          <InventoryAside
            fill
            title="Sequences"
            count={items.length}
            query={q}
            onQuery={setQ}
            searchLabel="Search sequences…"
            onNew={() => nameRef.current?.focus()}
            newTitle="Jump to the name box and start one"
            zeroTitle="No sequences yet"
            zeroLines={[
              "Name one interaction on the right.",
              "Describe it in plain statements.",
              "Watch the diagram render itself.",
              "Bridge systems in, export proof out.",
            ]}
          >
            <ul className="space-y-1.5">
              {shown.map((doc) => (
                <li key={doc.id} className="group flex flex-wrap items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveId(doc.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title={`Open ${doc.name}`}
                  >
                    <span className="block truncate text-[13px] font-semibold text-[#27241F]">{doc.name}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[#A39B8E]">
                      v{doc.version} · {doc.participants.length} participant{doc.participants.length === 1 ? "" : "s"} ·{" "}
                      {messageCount(doc.nodes)} message{messageCount(doc.nodes) === 1 ? "" : "s"} ·{" "}
                      {new Date(doc.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[doc.status]}`}>
                    {STATUS_LABEL[doc.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(doc.id)}
                    title={`Delete ${doc.name}`}
                    aria-label={`Delete ${doc.name}`}
                    className="shrink-0 rounded p-1 text-[#C9BFAE] opacity-0 transition-colors cursor-pointer hover:bg-red-500/10 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </InventoryAside>
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
              <svg width="430" height="150" viewBox="0 0 430 150" fill="none" aria-hidden="true" className="mx-auto mt-1 h-auto w-full max-w-[400px]">
                <line x1="90" y1="18" x2="90" y2="132" stroke="#9A7653" strokeWidth="1.5" />
                <line x1="215" y1="18" x2="215" y2="132" stroke="#9A7653" strokeWidth="1.5" />
                <line x1="340" y1="18" x2="340" y2="132" stroke="#9A7653" strokeWidth="1.5" />
                <rect x="58" y="8" width="64" height="18" rx="9" fill="#27241F" />
                <rect x="183" y="8" width="64" height="18" rx="9" fill="#27241F" />
                <rect x="308" y="8" width="64" height="18" rx="9" fill="#27241F" />
                <line x1="90" y1="48" x2="208" y2="48" stroke="#C9A86A" strokeWidth="1.5" />
                <path d="M202 43 L210 48 L202 53" stroke="#C9A86A" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="215" y1="76" x2="333" y2="76" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="5 3" />
                <path d="M327 71 L335 76 L327 81" stroke="#C9A86A" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="340" y1="104" x2="222" y2="104" stroke="#C9A86A" strokeWidth="1.5" />
                <path d="M228 99 L220 104 L228 109" stroke="#C9A86A" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <text x="215" y="148" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="700" fill="#A39B8E">DESCRIBE · SEE · PROVE</text>
              </svg>
              <h2 className="mt-1 text-center text-[15px] font-semibold text-[#27241F]">Sequence Studio</h2>
              <p className="mx-auto mt-1 max-w-xl text-center text-xs text-[#777168]">
                Describe the interaction, see the architecture: sync, response and async messages with
                loop, condition, parallel, retry and note blocks. The diagram is a projection; the model is the truth.
              </p>
              <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
                Interaction · System bridge · Build
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
                  placeholder="New Sequence - e.g. Order to fulfillment"
                  aria-label="New Sequence name"
                  spellCheck={false}
                  ref={nameRef}
                  className="min-w-0 flex-1 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
                />
                <Button onClick={() => void create()}>New Sequence</Button>
                <Button variant="secondary" onClick={() => fileRef.current?.click()} title="Import a package JSON, DSL text or Mermaid (.mmd) file from a fellow dev">
                  Import
                </Button>
                <Button variant="secondary" onClick={() => setShowSamples((v) => !v)} title="Browse training samples - load one to start" aria-expanded={showSamples}>
                  {showSamples ? "Hide samples" : "Samples"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,.txt,.text,.seq,.dsl,.mmd,application/json,text/plain"
                  className="hidden"
                  aria-label="Import sequence file"
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
                  {SEQUENCE_SAMPLES.map((s) => (
                    <li key={s.name} className="rounded-lg border border-[#EFE9DC] bg-[#FAF8F2] px-2.5 py-2">
                      <p className="truncate text-[12px] font-semibold text-[#27241F]" title={s.name}>{s.name.replace(/^Sample: /, "")}</p>
                      <p className="mt-0.5 line-clamp-2 min-h-7 text-[11px] leading-snug text-[#777168]">{s.hint}</p>
                      <button
                        type="button"
                        onClick={() => void loadSample(s)}
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
                <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Describe</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">Write the interaction as plain statements - no arrow-drawing marathons.</p>
              </div>
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">02</p>
                <p className="mt-1 text-[13px] font-semibold text-[#27241F]">See</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">Loops, conditions, retries and fan-out render as architecture, not decoration.</p>
              </div>
              <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[2px] text-[#A98450]">03</p>
                <p className="mt-1 text-[13px] font-semibold text-[#27241F]">Prove</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#777168]">Export the matrix, bridge systems in, hand the proof to reviewers.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {problems.length > 0 && (
            <ul className="max-w-2xl shrink-0 space-y-1 rounded-xl border border-red-200 bg-white px-3 py-2">
              {problems.slice(0, 8).map((p) => (
                <li key={p} className="text-[11px] text-red-700">⚠ {p}</li>
              ))}
            </ul>
          )}
          <SequenceCanvas
            key={`${active.id}:${rev}`}
            document={active}
            onSaved={(next) => setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)))}
          />
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this sequence?"
          message={`"${items.find((i) => i.id === pendingDelete)?.name ?? "Sequence"}" and all of its interactions will be removed. Snapshots stay in history. This cannot be undone.`}
          confirmLabel="Delete sequence"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void remove(pendingDelete)}
        />
      )}
      {historyOpen && active && (
        <SequenceHistoryDialog
          doc={active}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            setHistoryOpen(false);
            setRev((r) => r + 1);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
