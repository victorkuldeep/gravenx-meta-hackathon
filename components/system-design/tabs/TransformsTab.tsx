"use client";

/**
 * Transformations tab: every connection's stored mapping in one place.
 * Edit the template with a live preview against a sample payload, then the
 * edge runs it on the next chain. Passthrough edges are listed too - an
 * edge with no stored mapping forwards the inbound body untouched.
 */

import { useMemo, useState } from "react";
import { renderTemplate } from "@/lib/system-design/mapping";
import type { MappingMode, SystemProject } from "@/lib/system-design/model";
import { edgeLabel, fieldLabel, monoInput, panelShell, type Mutate } from "./shared";

interface Props {
  project: SystemProject;
  mutate: Mutate;
}

const COOKBOOK = `Namespaces: {{response}} previous output · {{request}} body just sent · {{seed}} flow input · {{steps.<systemId>}} hop output · {{requests.<systemId>}} hop request
Event wrap: {"event": {"order": {{response}}}}`;

export function TransformsTab({ project, mutate }: Props) {
  const [selId, setSelId] = useState<string | null>(null);
  const [seed, setSeed] = useState('{"id":"00000238","state":"active"}');

  const edges = useMemo(() => project.connections, [project.connections]);
  const sel = edges.find((e) => e.id === selId) ?? null;

  const seedData = useMemo(() => {
    try {
      return JSON.parse(seed) as unknown;
    } catch {
      return null;
    }
  }, [seed]);
  const seedValid = seedData !== null || seed.trim() === "";

  const preview = useMemo(() => {
    if (!sel || sel.mapping?.mode !== "template") return null;
    return renderTemplate(sel.mapping.template, seedData);
  }, [sel, seedData]);

  const setMode = (mode: MappingMode) =>
    sel &&
    mutate((p) => ({
      ...p,
      connections: p.connections.map((c) =>
        c.id === sel.id ? { ...c, mapping: mode === "passthrough" ? undefined : { mode, template: c.mapping?.template ?? '{"echo": {{response}}}' } } : c
      ),
    }));

  return (
    <div className={panelShell}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-ivory-950">
          Transformations · {edges.filter((e) => e.mapping).length}/{edges.length} templated
        </h2>
        <span className="text-[11px] text-ivory-500">stored on the edge · runs on every chain hop</span>
      </div>

      {edges.length === 0 ? (
        <p className="mt-3 text-xs text-ivory-500">No connections yet - link two systems on the canvas first.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-1">
            {edges.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setSelId(e.id)}
                  aria-pressed={selId === e.id}
                  className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] cursor-pointer ${
                    selId === e.id
                      ? "border-bronze-500 bg-bronze-500/5 font-bold text-ivory-950"
                      : "border-[var(--color-line-soft)] bg-[var(--color-canvas)] text-ivory-800 hover:border-bronze-500"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{edgeLabel(project, e.id)}</span>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${e.mapping ? "bg-bronze-500/10 text-bronze-700" : "bg-ivory-500/10 text-ivory-600"}`}>
                    {e.mapping ? "template" : "pass"}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div>
            {!sel ? (
              <p className="text-xs text-ivory-500">Pick a connection to edit its transform.</p>
            ) : (
              <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-xs font-bold text-ivory-950">{edgeLabel(project, sel.id)}</p>
                  <div className="ml-auto flex gap-1" role="group" aria-label="Mapping mode">
                    {(["passthrough", "template"] as MappingMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        aria-pressed={(sel.mapping?.mode ?? "passthrough") === m}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                          (sel.mapping?.mode ?? "passthrough") === m
                            ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                            : "border-[var(--color-line)] text-ivory-600 hover:border-bronze-500"
                        }`}
                      >
                        {m === "passthrough" ? "Passthrough" : "Template"}
                      </button>
                    ))}
                  </div>
                </div>

                {sel.mapping?.mode === "template" ? (
                  <>
                    <label className="mt-2 block">
                      <span className={fieldLabel}>Template · {"{{refs}}"} resolve per hop</span>
                      <textarea
                        value={sel.mapping.template}
                        onChange={(e) =>
                          mutate((p) => ({
                            ...p,
                            connections: p.connections.map((c) =>
                              c.id === sel.id && c.mapping ? { ...c, mapping: { ...c.mapping, template: e.target.value.slice(0, 10000) } } : c
                            ),
                          }))
                        }
                        spellCheck={false}
                        rows={7}
                        className={`${monoInput} min-h-28 resize-y`}
                      />
                    </label>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="block">
                        <span className={fieldLabel}>Sample {"{{response}}"} {!seedValid && <span className="text-red-700">· invalid JSON</span>}</span>
                        <textarea
                          value={seed}
                          onChange={(e) => setSeed(e.target.value)}
                          spellCheck={false}
                          rows={7}
                          className={`${monoInput} min-h-28 resize-y`}
                        />
                      </label>
                      <div>
                        <span className={fieldLabel}>Live preview</span>
                        <pre className="max-h-48 min-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2 font-mono text-[10px] leading-relaxed text-ivory-100">
                          {!seedValid ? "Fix the sample JSON to preview." : (preview?.text ?? "")}
                        </pre>
                        {preview && preview.missing.length > 0 && (
                          <p className="mt-1 font-mono text-[10px] text-amber-800">
                            missing → null: {preview.missing.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] leading-relaxed text-ivory-600">
                    Passthrough: this hop forwards the inbound body untouched. Switch to Template to reshape it per hop.
                  </p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-lg bg-ivory-950 p-2 font-mono text-[10px] leading-relaxed text-ivory-100">{COOKBOOK}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
