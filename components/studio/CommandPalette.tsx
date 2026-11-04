"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  artifactAttachState,
  artifactTarget,
  loadArtifactIndex,
  loadLiveEntries,
  rankEntries,
  type ArtifactEntry,
  type ArtifactKind,
} from "@/lib/studio/artifacts";
import { usePaletteAttachContext } from "@/lib/studio/paletteContext";

interface GoAction {
  key: string;
  label: string;
  detail: string;
  href: string;
}

const GO_ACTIONS: GoAction[] = [
  { key: "go-home", label: "Home", detail: "Start here", href: "/" },
  { key: "go-mapping", label: "Mapping Studio", detail: "Payload-to-object integration mapping", href: "/mapping" },
  { key: "go-wireframe", label: "Wireframe Studio", detail: "Schema-aware experience modeling", href: "/wireframe" },
  { key: "go-system", label: "System Design", detail: "Visual architecture workbench", href: "/system" },
  { key: "go-sequence", label: "Sequence", detail: "Describe the interaction", href: "/sequence" },
  { key: "go-contracts", label: "Contracts", detail: "OpenAPI profiles", href: "/contracts" },
  { key: "go-notes", label: "Notes", detail: "General notes with lifecycle", href: "/notes" },
  { key: "go-validate", label: "Validate", detail: "OpenAPI spec vs payload", href: "/validate" },
  { key: "go-architect", label: "Architect", detail: "Design custom APIs", href: "/architect" },
  { key: "go-studio", label: "Studio", detail: "Themed diagram packs", href: "/studio" },
  { key: "go-draw", label: "Draw", detail: "Freeform whiteboard", href: "/draw" },
  { key: "go-console", label: "Console", detail: "Personal task console", href: "/console" },
];

const KIND_LABEL: Record<ArtifactKind, string> = {
  "wireframe-screen": "Wireframes",
  "integration-mapping": "Mappings",
  "contract-profile": "Contracts",
  "salesforce-object": "Objects",
  "saved-query": "Queries",
};

const KIND_ORDER: ArtifactKind[] = ["salesforce-object", "saved-query", "wireframe-screen", "integration-mapping", "contract-profile"];

interface Row {
  key: string;
  group: string;
  label: string;
  detail: string;
  href: string;
  entry: ArtifactEntry | null;
}

/**
 * Global command palette. Navigate mode (Cmd/Ctrl+K) searches everything and
 * opens places. Attach mode (opened with { attachOnly: true }) offers Attach
 * actions against the registered surface context - screen or project.
 */
export function CommandPalette() {
  const router = useRouter();
  const ctx = usePaletteAttachContext();
  const [open, setOpen] = useState(false);
  const [attachOnly, setAttachOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<ArtifactEntry[] | null>(null);
  const [live, setLive] = useState<ArtifactEntry[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAttachOnly(false);
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onSignal = (e: Event) => {
      setAttachOnly((e as CustomEvent).detail?.attachOnly === true);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("gravenx:palette", onSignal);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gravenx:palette", onSignal);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (entries === null) {
      void loadArtifactIndex()
        .then((all) => {
          if (!cancelled) setEntries(all);
        })
        .catch(() => {
          if (!cancelled) setEntries([]);
        });
    }
    void loadLiveEntries()
      .then((all) => {
        if (!cancelled) setLive(all);
      })
      .catch(() => {
        if (!cancelled) setLive([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entries]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setAttachOnly(false);
    }
  }, [open ]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim();
    const go = attachOnly
      ? []
      : GO_ACTIONS.filter(
          (g) => !q || g.label.toLowerCase().includes(q.toLowerCase()) || g.detail.toLowerCase().includes(q.toLowerCase())
        ).map((g) => ({ key: g.key, group: "Go", label: g.label, detail: g.detail, href: g.href, entry: null }));
    if (!entries) return go;
    const ranked = rankEntries([...live, ...entries], q).slice(0, 30);
    const arts: Row[] = ranked.map((r) => ({
      key: r.entry.key,
      group: KIND_LABEL[r.entry.kind],
      label: r.entry.label,
      detail: `${r.entry.detail}${r.entry.usedIn.length > 0 ? ` · used in ${r.entry.usedIn.join(", ")}` : ""}`,
      href: artifactTarget(r.entry),
      entry: r.entry,
    }));
    const order = (g: string) => (g === "Go" ? -1 : KIND_ORDER.indexOf(Object.keys(KIND_LABEL).find((k) => KIND_LABEL[k as ArtifactKind] === g)! as ArtifactKind));
    return [...go, ...arts].sort((a, b) => order(a.group) - order(b.group));
  }, [query, entries, live, attachOnly]);

  useEffect(() => {
    setActive(0);
  }, [rows.length]);

  const attach = (row: Row) => {
    if (!row.entry || !ctx) return;
    const e = row.entry;
    if (e.kind === "wireframe-screen" && e.experienceId && e.screenId) {
      const parts = e.label.split(" → ");
      ctx.onAttachWireframe({ experienceId: e.experienceId, screenId: e.screenId, experienceName: parts[0], screenName: parts[1] });
    } else if (e.kind === "integration-mapping" && e.mappingId) {
      ctx.onAttachMapping(e.mappingId);
    }
    setOpen(false);
  };

  const pick = (row: Row | undefined) => {
    if (!row) return;
    if (attachOnly && row.entry && ctx) {
      const state = artifactAttachState(row.entry, ctx);
      if (state === "attach") {
        attach(row);
        return;
      }
    }
    setOpen(false);
    router.push(row.href);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Command palette" onClick={() => setOpen(false)}>
      <div
        className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-[#E8E2D8] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (rows.length === 0 ? 0 : (a + 1) % rows.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (rows.length === 0 ? 0 : (a - 1 + rows.length) % rows.length));
          } else if (e.key === "Enter") {
            pick(rows[active]);
          }
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={attachOnly ? `Attach to ${ctx?.title ?? "…"} - type to search…` : "Type to search screens, mappings, contracts, places…"}
          aria-label="Search everything"
          spellCheck={false}
          className="w-full border-b border-[#E8E2D8] px-4 py-3 text-[14px] focus:outline-none"
        />
        {entries === null ? (
          <p className="px-4 py-6 text-center text-[12px] text-[#777168]">Loading index…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-[#777168]">No matches - try fewer letters.</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto p-1.5">
            {rows.map((r, i) => {
              const state = r.entry && ctx && attachOnly ? artifactAttachState(r.entry, ctx) : null;
              return (
                <li key={r.key}>
                  {(i === 0 || rows[i - 1].group !== r.group) && (
                    <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-[1.6px] text-[#A39B8E]">{r.group}</p>
                  )}
                  <div className={`flex items-center gap-1 rounded-lg px-1 ${i === active ? "bg-[#FAF3E3]" : ""}`}>
                    <button
                      type="button"
                      onClick={() => pick(r)}
                      onMouseEnter={() => setActive(i)}
                      className="min-w-0 flex-1 cursor-pointer rounded-lg px-1.5 py-1.5 text-left"
                    >
                      <span className="block truncate text-[13px] font-semibold text-[#27241F]">{r.label}</span>
                      <span className="block truncate font-mono text-[10px] text-[#A39B8E]">{r.detail}</span>
                    </button>
                    {state === "attach" && (
                      <button
                        type="button"
                        onClick={() => attach(r)}
                        className="shrink-0 cursor-pointer rounded-lg border border-[#211F1B] bg-[#211F1B] px-2 py-1 text-[11px] font-semibold text-white"
                      >
                        Attach
                      </button>
                    )}
                    {state === "attached" && <span className="shrink-0 px-1 font-mono text-[10px] text-[#2F7D4F]">✓</span>}
                    {state === "open" && (
                      <button
                        type="button"
                        onClick={() => pick({ ...r })}
                        title="Open (not attachable here)"
                        className="shrink-0 cursor-pointer rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] font-semibold text-[#A98450]"
                      >
                        ↗
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-[#F0EBE0] px-4 py-1.5 font-mono text-[10px] text-[#A39B8E]">
          ↑↓ move · ↵ open{attachOnly ? " / attach" : ""} · esc close · ⌘K toggle
        </p>
      </div>
    </div>
  );
}
