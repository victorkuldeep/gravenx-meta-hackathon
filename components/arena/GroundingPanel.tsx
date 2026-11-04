"use client";

import { useRef, useState } from "react";
import { KIND_LABEL, MAX_DOC_BYTES, newGroundingDoc, validateGrounding, type GroundingDoc, type GroundingKind } from "@/lib/arena/grounding";
import { deleteGroundingDoc, saveGroundingDoc } from "@/lib/arena/groundingStore";

const KINDS: GroundingKind[] = ["skill", "agent-file", "framework", "doc"];

export function GroundingPanel({ docs, onChange }: { docs: GroundingDoc[]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<GroundingKind>("skill");
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const addDoc = async () => {
    const err = validateGrounding(name, body);
    if (err) {
      setFormError(err);
      return;
    }
    setBusy(true);
    try {
      const ok = await saveGroundingDoc(newGroundingDoc(name, kind, body));
      if (!ok) throw new Error("save failed");
      setName("");
      setBody("");
      setFormError(null);
      onChange();
    } catch {
      setFormError("Could not save - browser storage unavailable.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setBody(text.slice(0, MAX_DOC_BYTES * 4));
      if (!name) setName(f.name.replace(/\.(md|txt)$/i, ""));
      const lower = f.name.toLowerCase();
      if (lower.includes("agent")) setKind("agent-file");
      else if (lower.includes("skill")) setKind("skill");
    };
    reader.readAsText(f);
  };

  const toggle = async (d: GroundingDoc) => {
    await saveGroundingDoc({ ...d, enabled: !d.enabled });
    onChange();
  };

  const remove = async (d: GroundingDoc) => {
    await deleteGroundingDoc(d.id);
    onChange();
  };

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[13px] font-bold text-ivory-950">Grounding library</h3>
      <p className="text-[11px] text-ivory-500">
        Architect-owned context: client framework skills, agent files, specs. Loaded into sessions you choose - never global, never to disk outside this browser.
      </p>

      <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-line)] bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. Acme integration framework"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px]"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as GroundingKind)}
            aria-label="Context kind"
            className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-[12px]"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px] font-semibold hover:bg-ivory-50"
          >
            Upload .md
          </button>
          <input ref={fileRef} type="file" accept=".md,.txt,.markdown" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste Markdown here - framework rules, agent instructions, API contracts…"
          rows={5}
          className="w-full rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 font-mono text-[12px]"
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ivory-500">{(body.length / 1024).toFixed(1)}KB / {MAX_DOC_BYTES / 1024}KB</span>
          <button
            type="button"
            onClick={() => void addDoc()}
            disabled={busy}
            className="ml-auto cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add to library"}
          </button>
        </div>
        {formError && <p className="text-[12px] text-red-700">{formError}</p>}
      </div>

      <ul className="mt-3 space-y-1.5">
        {docs.length === 0 && <li className="text-[12px] text-ivory-500">No custom context yet - the framework skill from your client engagement belongs here.</li>}
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5">
            <button
              type="button"
              onClick={() => void toggle(d)}
              title={d.enabled ? "Enabled - sessions can load this" : "Disabled"}
              aria-label={`Toggle ${d.name}`}
              className={`shrink-0 flex h-5 w-9 cursor-pointer items-center rounded-full px-0.5 transition-colors ${d.enabled ? "justify-end bg-emerald-600" : "justify-start bg-ivory-300"}`}
            >
              <span className="h-4 w-4 rounded-full bg-white" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ivory-950" title={`${d.name} · ${(d.content.length / 1024).toFixed(1)}KB`}>
              {d.name}
            </span>
            <span className="shrink-0 rounded-full bg-ivory-200 px-1.5 py-px text-[10px] font-bold text-ivory-700">{KIND_LABEL[d.kind]}</span>
            <button
              type="button"
              onClick={() => void remove(d)}
              aria-label={`Delete ${d.name}`}
              className="shrink-0 cursor-pointer rounded p-1 text-ivory-500 hover:bg-red-50 hover:text-red-600"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
