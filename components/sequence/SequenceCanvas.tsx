"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import Button from "../ui/Button";
import { DraftDialog, type DraftConfirmation } from "../draw/DraftDialog";
import { SYSTEM_DRAFT_KEY, buildSystemProject, type TopologyDraft } from "@/lib/draw/toSystemDraft";
import { formatStatement, parseStatements, printStatements } from "@/lib/sequence/dsl";
import { registerSeqBridge, seqSnapshotOf } from "@/lib/ai/seqBridge";
import { sequenceToDraft } from "@/lib/sequence/systemBridge";
import { seqPngFileName } from "@/lib/sequence/seqExport";
import { SystemImportDialog } from "./SystemImportDialog";
import { findNode } from "@/lib/sequence/edit";
import { patchNode, removeNode } from "@/lib/sequence/edit";
import type { MessageKind, SequenceDocument, SeqNode } from "@/lib/sequence/model";
import { saveSequence } from "@/lib/sequence/store";
import { SequenceDiagram } from "./SequenceDiagram";
import { SequenceInspector } from "./SequenceInspector";

const SAVE_DEBOUNCE_MS = 800;

/** One-click block templates. Each parses cleanly on insert; the cursor lands
 * on the blank line inside so content goes between the opener and `end`. */
const SNIPPETS: { label: string; title: string; text: string }[] = [
  { label: "Loop", title: "Insert a loop: loop each <items> : <label> … end — type messages inside", text: "loop each order.lines\n\nend\n" },
  { label: "If", title: "Insert a condition: if <condition> … end — type messages inside", text: "if condition\n\nend\n" },
  { label: "Parallel", title: "Insert a parallel block: parallel <label> … end — type messages inside", text: "parallel description\n\nend\n" },
  { label: "Retry", title: "Insert a retry block: retry 3 times … end — type messages inside", text: "retry 3 times\n\nend\n" },
  { label: "Note", title: "Insert a note: note <text>", text: "note write something\n" },
];

/**
 * Sequence canvas (EPIC 03): statement editor + diagram, two-way synced.
 * Text is the input; the parsed model is the truth. Only valid parses
 * persist - errors show per line and the last good model stays live.
 */
export function SequenceCanvas({ document, onSaved }: { document: SequenceDocument; onSaved: (doc: SequenceDocument) => void }) {
  const router = useRouter();
  const [doc, setDoc] = useState(document);
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState<TopologyDraft | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState(() => printStatements(document.participants, document.nodes));
  const [selId, setSelId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Canonical model string of the last persisted/committed state — never raw
  // editor text. Raw text may carry trailing newlines/spaces or blank lines
  // that are semantically empty; comparing raw strings is what used to wipe
  // in-progress lines ~800ms after every keystroke (the save echo).
  const committedRef = useRef<string>(printStatements(document.participants, document.nodes));
  const docIdRef = useRef<string>(document.id);

  // Switched to a different sequence document: hard re-seed.
  if (docIdRef.current !== document.id) {
    docIdRef.current = document.id;
    const printed = printStatements(document.participants, document.nodes);
    committedRef.current = printed;
    // Render-phase setState is intentional here (React allows it for
    // prop-change reseeds) and avoids a flash of the previous doc's text.
    setDoc(document);
    setText(printed);
    setSelId(null);
  }

  // External change (restore, AI apply, other tab): re-seed only when the
  // incoming MODEL differs from the last committed model. Parent save-echoes
  // (same canonical model, newer updatedAt) must never clobber in-progress /
  // invalid text the user is still typing. committedRef is always kept equal
  // to canonical(doc), so comparing against it alone is sufficient and avoids
  // reading live doc state here (which would race with our own persists).
  useEffect(() => {
    if (document.id !== docIdRef.current) return; // handled above
    const incoming = printStatements(document.participants, document.nodes);
    if (incoming === committedRef.current) {
      // Echo of our own persist (or no-op refresh): sync metadata silently,
      // keep the user's raw text (trailing newlines/spaces/partial lines).
      setDoc(document);
      return;
    }
    committedRef.current = incoming;
    setDoc(document);
    setText(incoming);
    setSelId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document]);

  // Flush any pending debounced save on unmount so no edit is lost.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const persist = useCallback(
    (next: SequenceDocument, canonical: string) => {
      setDoc(next);
      committedRef.current = canonical;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveSequence(next).then((ok) => {
          if (ok) onSaved(next);
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [onSaved],
  );

  const parsed = parseStatements(text);
  const valid = parsed.errors.length === 0;

  // Quick-add bar: build A -> B -> C chains without typing raw DSL.
  const [qaFrom, setQaFrom] = useState("");
  const [qaKind, setQaKind] = useState<MessageKind>("sync");
  const [qaTo, setQaTo] = useState("");
  const [qaLabel, setQaLabel] = useState("");
  const [qaChain, setQaChain] = useState(true);
  const qaLabelRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const qaReady = qaFrom.trim() !== "" && qaTo.trim() !== "" && qaLabel.trim() !== "";

  const quickAdd = () => {
    if (!qaReady) return;
    const line = formatStatement(qaFrom, qaKind, qaTo, qaLabel);
    const base = text.replace(/\s+$/, "");
    onEdit(base ? `${base}\n${line}` : line);
    if (qaChain) {
      setQaFrom(qaTo.trim());
      setQaLabel("");
      window.setTimeout(() => qaLabelRef.current?.focus(), 0);
    } else {
      setQaLabel("");
    }
  };

  /** Snippets insert at the cursor (or append) and land the caret on the
   * blank line inside the block, so adding content means just typing. */
  const insertSnippet = (snippet: string) => {
    const el = textAreaRef.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, at);
    const after = text.slice(end);
    const clean = snippet.replace(/^\n+/, "");
    const insertStart = before.length + (before !== "" && !before.endsWith("\n") ? 1 : 0);
    const next = before + (insertStart > before.length ? "\n" : "") + clean + after;
    onEdit(next);
    // Caret: first blank line inside the block, else end of insertion.
    const blank = clean.indexOf("\n\n");
    const caret = insertStart + (blank >= 0 ? blank + 1 : clean.length);
    requestAnimationFrame(() => {
      const ta = textAreaRef.current;
      if (!ta) return;
      ta.focus();
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        /* non-editable state - selection stays */
      }
    });
  };

  const onEdit = (next: string) => {
    setText(next);
    const r = parseStatements(next);
    // Invalid / partial line (e.g. mid-typing "sf -" on a fresh line):
    // keep it on screen, keep the last good model live. Crucially do NOT
    // persist and do NOT touch committedRef, so the debounced save-echo of
    // an earlier valid state can never wipe this in-progress line.
    if (r.errors.length > 0) return;
    const canonical = printStatements(r.participants, r.nodes);
    // Semantically empty change (Enter, trailing space, blank line, comment
    // spacing): leave the model, ids, timers and parent store alone. This is
    // the core of the cursor-jump fix — every Enter used to persist a new
    // doc with fresh random ids, and the 800ms save echo then reprinted the
    // canonical text and yanked the cursor back to the previous line.
    if (canonical === committedRef.current) return;
    // Reuse existing participant ids by case-insensitive name so the diagram
    // and selection don't churn on every keystroke; fresh parses mint new
    // random ids that would otherwise invalidate refs and trigger needless
    // saves/rerenders.
    const prevByName = new Map(doc.participants.map((p) => [p.name.toLowerCase(), p]));
    const idMap = new Map<string, string>();
    const participants = r.participants.map((p) => {
      const prev = prevByName.get(p.name.toLowerCase());
      if (prev) {
        idMap.set(p.id, prev.id);
        return { ...prev, name: p.name, kind: p.kind };
      }
      return p;
    });
    const remapNodes = (list: SequenceDocument["nodes"]): SequenceDocument["nodes"] =>
      list.map((n) => {
        if (n.nodeType === "message") {
          return { ...n, from: idMap.get(n.from) ?? n.from, to: idMap.get(n.to) ?? n.to };
        }
        return {
          ...n,
          children: remapNodes(n.children),
          elseChildren: n.elseChildren ? remapNodes(n.elseChildren) : n.elseChildren,
        };
      });
    const nodes = remapNodes(r.nodes);
    const nextCanonical = printStatements(participants, nodes);
    setSelId(null);
    persist({ ...doc, participants, nodes }, nextCanonical);
  };

  const format = () => {
    const canonical = printStatements(doc.participants, doc.nodes);
    setText(canonical);
  };

  /** Inspector edits land on the model, then reprint - text never drifts. */
  const commitNodes = (nodes: SequenceDocument["nodes"]) => {
    const next = { ...doc, nodes };
    const printed = printStatements(next.participants, next.nodes);
    setText(printed);
    persist(next, printed);
  };

  const patchSelected = (node: SeqNode) => {
    if (!selId) return;
    commitNodes(patchNode(doc.nodes, selId, node));
  };

  const deleteSelected = () => {
    if (!selId) return;
    commitNodes(removeNode(doc.nodes, selId));
    setSelId(null);
  };

  const selected = selId ? findNode(doc.nodes, selId) : null;

  /** AI agent bridge: headless tools read/apply through the canvas persist path. */
  useEffect(() => {
    registerSeqBridge({
      getSnapshot: () => seqSnapshotOf(doc),
      getDocument: () => doc,
      apply: (fn) => {
        const next = fn(doc);
        const printed = printStatements(next.participants, next.nodes);
        setText(printed);
        persist(next, printed);
        return { ok: true };
      },
    });
    return () => registerSeqBridge(null);
  }, [doc, persist]);

  const doExport = useCallback(
    async (scale: 2 | 3) => {
      setExporting(true);
      setExportError(null);
      try {
        const el = diagramRef.current;
        if (!el) throw new Error("Diagram not ready");
        const dataUrl = await toPng(el, { backgroundColor: "#FFFFFF", pixelRatio: scale, cacheBust: true });
        const d = globalThis.document;
        const a = d.createElement("a");
        a.href = dataUrl;
        a.download = seqPngFileName(doc.name, scale);
        d.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        setExportError(err instanceof Error ? err.message : "PNG export failed");
      } finally {
        setExporting(false);
      }
    },
    [doc.name],
  );

  const handleConfirm = (selection: DraftConfirmation) => {
    if (!draft) return;
    const project = buildSystemProject(draft, selection);
    try {
      sessionStorage.setItem(SYSTEM_DRAFT_KEY, JSON.stringify(project));
    } catch {
      /* private mode etc - the canvas still holds the document */
    }
    setDraft(null);
    router.push("/system");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 lg:flex-row">
      <div className="flex min-h-0 w-full flex-col rounded-xl border border-[#E8E2D8] bg-white lg:max-w-md">
        <div className="flex items-center justify-between gap-1.5 border-b border-[#EFE9DC] px-3 py-2">
          <p className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
            Statements · {valid ? `${parsed.nodes.length} top-level` : "fix errors to save"}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)} title="Import a System flow or project">
            ⇄ System
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDraft(sequenceToDraft(doc))} title="Send participants and messages to System Design">
            Send to System
          </Button>
          <Button size="sm" variant="secondary" onClick={format} title="Reprint canonical DSL">
            Format
          </Button>
        </div>
        <p className="shrink-0 border-b border-[#EFE9DC] px-3 py-1 font-mono text-[10px] leading-relaxed text-[#A39B8E]">
          A -&gt; B: label · --&gt; response · -&gt;&gt; async · loop each items : label … end · messages go inside
        </p>
        <div className="shrink-0 border-b border-[#EFE9DC] px-3 py-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              quickAdd();
            }}
            className="flex flex-wrap items-center gap-1.5"
          >
            <datalist id="seq-parts">
              {parsed.participants.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <input
              value={qaFrom}
              onChange={(e) => setQaFrom(e.target.value)}
              list="seq-parts"
              placeholder="From"
              aria-label="From participant"
              spellCheck={false}
              className="w-24 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[12px] text-[#27241F] placeholder-[#C9BFAE] focus:border-[#C9A86A] focus:outline-none"
            />
            <select
              value={qaKind}
              onChange={(e) => setQaKind(e.target.value as MessageKind)}
              aria-label="Message kind"
              title="call draws solid · return draws dashed · async draws an event arrow"
              className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1 text-[12px] font-semibold text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
            >
              <option value="sync">call →</option>
              <option value="response">return ⇢</option>
              <option value="async">async »</option>
            </select>
            <input
              value={qaTo}
              onChange={(e) => setQaTo(e.target.value)}
              list="seq-parts"
              placeholder="To"
              aria-label="To participant"
              spellCheck={false}
              className="w-24 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[12px] text-[#27241F] placeholder-[#C9BFAE] focus:border-[#C9A86A] focus:outline-none"
            />
            <input
              ref={qaLabelRef}
              value={qaLabel}
              onChange={(e) => setQaLabel(e.target.value)}
              placeholder="Message label, Enter adds it"
              aria-label="Message label"
              spellCheck={false}
              className="min-w-[8rem] flex-1 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[12px] text-[#27241F] placeholder-[#C9BFAE] focus:border-[#C9A86A] focus:outline-none"
            />
            <label
              className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-[#777168]"
              title="Chain: the next From starts as this To, so Enter walks A to B to C"
            >
              <input
                type="checkbox"
                checked={qaChain}
                onChange={(e) => setQaChain(e.target.checked)}
                className="cursor-pointer accent-[#722F37]"
              />
              chain
            </label>
            <Button size="sm" type="submit" disabled={!qaReady} title="Append this message to the statements">
              Add
            </Button>
          </form>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {SNIPPETS.map((s) => (
              <Button key={s.label} size="sm" variant="ghost" onClick={() => insertSnippet(s.text)} title={s.title}>
                {s.label}
              </Button>
            ))}
          </div>
        </div>
        <textarea
          ref={textAreaRef}
          value={text}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
          aria-label="Sequence statements"
          placeholder={"Salesforce -> Middleware: Create Order\nloop each order.lines\nend"}
          className="min-h-[240px] w-full flex-1 resize-y rounded-b-xl bg-white px-3 py-2 font-mono text-[12px] leading-[1.7] text-[#27241F] placeholder-[#C9BFAE] focus:outline-none [font-variant-ligatures:none] lg:min-h-0"
        />
        {parsed.errors.length > 0 && (
          <ul className="max-h-32 shrink-0 space-y-0.5 overflow-y-auto border-t border-[#EFE9DC] px-3 py-2">
            {parsed.errors.slice(0, 20).map((e, i) => (
              <li key={`${e.line}-${i}`} className="font-mono text-[11px] text-red-700">
                line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
        <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-[#EFE9DC] px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">Diagram</p>
          <div className="flex gap-1.5">
            <Button
              size="sm" variant="secondary"
              onClick={() => void doExport(2)}
              disabled={exporting || doc.nodes.length === 0}
              title="Download the diagram as PNG (2x)"
            >
              {exporting ? "Exporting…" : "⤓ Snapshot PNG"}
            </Button>
            <Button
              size="sm" variant="secondary"
              onClick={() => void doExport(3)}
              disabled={exporting || doc.nodes.length === 0}
              title="Download the diagram as hi-res PNG (3x) for decks"
            >
              {exporting ? "Exporting…" : "3x Hi-Res"}
            </Button>
          </div>
        </div>
        {exportError && <p className="px-3 pt-1 text-[11px] text-red-700">{exportError}</p>}
        <div ref={diagramRef} className="min-h-0 flex-1 overflow-auto bg-white p-3">
          <SequenceDiagram doc={doc} selectedId={selId} onSelect={(id) => setSelId(id)} />
        </div>
      </div>

      {selected && (
        <SequenceInspector
          node={selected}
          participants={doc.participants}
          onPatch={patchSelected}
          onDelete={deleteSelected}
          onClose={() => setSelId(null)}
        />
      )}
      {importOpen && (
        <SystemImportDialog
          onClose={() => setImportOpen(false)}
          onImport={(statements) => {
            setImportOpen(false);
            onEdit(text.trim() === "" ? statements : `${text.replace(/\s+$/, "")}\n\n${statements}`);
          }}
        />
      )}
      {draft && (
        <DraftDialog
          draft={draft}
          onCancel={() => setDraft(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
