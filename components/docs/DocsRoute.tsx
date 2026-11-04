"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DOC_GROUPS, DOC_SECTIONS, type DocBlock, type DocDiagram } from "@/lib/docs/content";

const INK = "#27241F";
const ACCENT = "#C9A86A";
const MUTED = "#A39B8E";
const BODY = "#777168";

function LifecycleDiagram() {
  const steps = ["Think", "Model", "Design", "Connect", "Build", "Execute"];
  return (
    <svg viewBox="0 0 640 64" fill="none" aria-hidden="true" className="h-auto w-full">
      {steps.map((s, i) => {
        const x = 8 + i * 106;
        return (
          <g key={s}>
            <rect x={x} y={12} width={88} height={40} rx={10} fill="#FFFFFF" stroke={i === 5 ? ACCENT : "#E3D9C6"} strokeWidth={i === 5 ? 2 : 1.5} />
            <text x={x + 44} y={37} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK} fontFamily="ui-sans-serif, system-ui">
              {s}
            </text>
            {i < steps.length - 1 && (
              <path d={`M${x + 88} 32 h14 m-5 -5 l5 5 l-5 5`} stroke={ACCENT} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SystemFlowDiagram() {
  const boxes = [
    { x: 8, label: "Salesforce", sub: "GET order · 622" },
    { x: 226, label: "Middleware", sub: "$body passthrough" },
    { x: 444, label: "Hub", sub: "as-is · 688 event" },
  ];
  return (
    <svg viewBox="0 0 640 120" fill="none" aria-hidden="true" className="h-auto w-full">
      {boxes.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={20} width={188} height={64} rx={12} fill="#FFFFFF" stroke="#9A7653" strokeWidth={1.5} />
          <text x={b.x + 94} y={48} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK} fontFamily="ui-sans-serif, system-ui">
            {b.label}
          </text>
          <text x={b.x + 94} y={68} textAnchor="middle" fontSize={10} fill={BODY} fontFamily="ui-monospace, monospace">
            {b.sub}
          </text>
        </g>
      ))}
      <g fontSize={10} fill={BODY} fontFamily="ui-monospace, monospace">
        <line x1={196} y1={52} x2={226} y2={52} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={198} y={44}>GET → $body</text>
        <line x1={414} y1={52} x2={444} y2={52} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={392} y={100}>POST as-is · wrap $body</text>
        <line x1={444} y1={84} x2={226} y2={84} stroke={MUTED} strokeWidth={1} strokeDasharray="2 3" />
        <text x={300} y={98}>responses trace back</text>
      </g>
    </svg>
  );
}

function WireBindingDiagram() {
  const rows = [
    { label: "Customer Name → Account.Name", tag: "EXISTING", color: "#3E7C4F" },
    { label: "Contract Value → Annual_Contract_Value__c", tag: "PROPOSED", color: "#8A6A2F" },
    { label: "Credit Score → Credit API", tag: "EXTERNAL", color: "#3E5C7C" },
  ];
  return (
    <svg viewBox="0 0 640 150" fill="none" aria-hidden="true" className="h-auto w-full">
      <rect x={8} y={18} width={180} height={114} rx={12} fill={INK} />
      <text x={98} y={70} textAnchor="middle" fontSize={13} fontWeight={700} fill="#F5F1E8" fontFamily="ui-sans-serif, system-ui">
        Customer
      </text>
      <text x={98} y={90} textAnchor="middle" fontSize={13} fontWeight={700} fill="#F5F1E8" fontFamily="ui-sans-serif, system-ui">
        Detail
      </text>
      <text x={98} y={110} textAnchor="middle" fontSize={10} fill={ACCENT} fontFamily="ui-monospace, monospace">
        SCREEN
      </text>
      {rows.map((r, i) => {
        const y = 18 + i * 42;
        return (
          <g key={r.label}>
            <line x1={188} y1={60} x2={218} y2={y + 17} stroke="#E3D9C6" strokeWidth={1.5} />
            <rect x={218} y={y} width={414} height={34} rx={8} fill="#FFFFFF" stroke="#E3D9C6" strokeWidth={1.5} />
            <circle cx={238} cy={y + 17} r={5} fill={r.color} />
            <text x={250} y={y + 21} fontSize={11} fill={INK} fontFamily="ui-monospace, monospace">
              {r.label}
            </text>
            <text x={622} y={y + 21} textAnchor="end" fontSize={9} fontWeight={700} fill={r.color} fontFamily="ui-monospace, monospace">
              {r.tag}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SeqMiniDiagram() {
  const lanes = [80, 320, 560];
  const names = ["Salesforce", "Middleware", "ServiceNow"];
  return (
    <svg viewBox="0 0 640 170" fill="none" aria-hidden="true" className="h-auto w-full">
      {lanes.map((x, i) => (
        <g key={names[i]}>
          <rect x={x - 70} y={8} width={140} height={30} rx={8} fill="#FFFFFF" stroke="#9A7653" strokeWidth={1.5} />
          <text x={x} y={28} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK} fontFamily="ui-sans-serif, system-ui">
            {names[i]}
          </text>
          <line x1={x} y1={38} x2={x} y2={162} stroke="#E3D9C6" strokeWidth={1.5} strokeDasharray="4 4" />
        </g>
      ))}
      <g fontSize={10} fill={BODY} fontFamily="ui-monospace, monospace">
        <line x1={80} y1={70} x2={320} y2={70} stroke={INK} strokeWidth={1.5} />
        <path d="M310 65 l10 5 l-10 5" stroke={INK} strokeWidth={1.5} />
        <text x={120} y={64}>Create Order</text>
        <line x1={320} y1={100} x2={560} y2={100} stroke={INK} strokeWidth={1.5} />
        <path d="M550 95 l10 5 l-10 5" stroke={INK} strokeWidth={1.5} />
        <text x={360} y={94}>Create Fulfillment</text>
        <line x1={560} y1={130} x2={320} y2={130} stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 3" />
        <path d="M330 125 l-10 5 l10 5" stroke={MUTED} strokeWidth={1.5} />
        <text x={400} y={124}>201 Created</text>
      </g>
    </svg>
  );
}

function Diagram({ name }: { name: DocDiagram }) {
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] px-4 py-3">
      {name === "lifecycle" && <LifecycleDiagram />}
      {name === "system-flow" && <SystemFlowDiagram />}
      {name === "wire-binding" && <WireBindingDiagram />}
      {name === "seq-mini" && <SeqMiniDiagram />}
    </div>
  );
}

function Block({ block }: { block: DocBlock }) {
  if (block.k === "p") return <p className="mt-2 text-[13px] leading-relaxed text-[#3A352D]">{block.text}</p>;
  if (block.k === "list")
    return (
      <ul className="mt-2 space-y-1.5">
        {block.items.map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-[#3A352D]">
            <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#C9A86A]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  if (block.k === "code")
    return (
      <pre className="mt-3 overflow-x-auto rounded-xl border border-[#E8E2D8] bg-[#27241F] px-4 py-3 font-mono text-[12px] leading-relaxed text-[#F5F1E8]">
        {block.text}
      </pre>
    );
  if (block.k === "callout")
    return (
      <div className="mt-3 rounded-xl border border-[#E5C98F] bg-[#F5EEDF] px-4 py-3">
        <p className="text-[12px] font-bold text-[#8A6A2F]">{block.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#5C4A23]">{block.text}</p>
      </div>
    );
  if (block.k === "diagram") return <Diagram name={block.name} />;
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {block.items.map((r) => (
        <Link
          key={r.href + r.label}
          href={r.href}
          className="group rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 transition-colors hover:border-[#C9A86A]"
        >
          <span className="block text-[13px] font-semibold text-[#27241F] group-hover:underline">
            {r.label} <span aria-hidden="true">→</span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-[#777168]">{r.note}</span>
        </Link>
      ))}
    </div>
  );
}

function matches(section: (typeof DOC_SECTIONS)[number], q: string): boolean {
  const hay = `${section.title} ${section.keywords}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function DocsRoute() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>("welcome");

  useEffect(() => {
    const id = window.location.hash.replace("#", "");
    if (id && DOC_SECTIONS.some((s) => s.id === id)) {
      setActiveId(id);
      window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    }
  }, []);

  const results = useMemo(
    () => (query.trim() ? DOC_SECTIONS.filter((s) => matches(s, query)) : null),
    [query],
  );

  const go = (id: string) => {
    setActiveId(id);
    setQuery("");
    window.history.replaceState(null, "", `#${id}`);
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const activeIndex = DOC_SECTIONS.findIndex((s) => s.id === activeId);
  const prev = activeIndex > 0 ? DOC_SECTIONS[activeIndex - 1] : null;
  const next = activeIndex >= 0 && activeIndex < DOC_SECTIONS.length - 1 ? DOC_SECTIONS[activeIndex + 1] : null;
  const visible = results ?? DOC_SECTIONS;

  return (
    <div className="flex gap-4">
      <aside className="sticky top-[70px] hidden h-[calc(100vh-140px)] w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white md:flex">
        <div className="border-b border-[#E8E2D8] p-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            aria-label="Search documentation"
            spellCheck={false}
            className="w-full rounded-lg border border-[#E8E2D8] bg-[#FBFAF7] px-2.5 py-1.5 text-[12px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
          />
        </div>
        <nav aria-label="Documentation" className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {(results ? ["Results"] : [...DOC_GROUPS]).map((group) => {
            const items = results ?? DOC_SECTIONS.filter((s) => s.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-3">
                {!results && (
                  <p className="px-1.5 pb-1 font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">{group}</p>
                )}
                <ul className="space-y-0.5">
                  {items.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => go(s.id)}
                        aria-current={s.id === activeId ? "true" : undefined}
                        className={`w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                          s.id === activeId
                            ? "bg-[#F5F1E8] font-semibold text-[#27241F]"
                            : "text-[#777168] hover:bg-[#FBFAF7] hover:text-[#27241F]"
                        }`}
                      >
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {results && results.length === 0 && (
            <p className="px-1.5 py-4 text-[12px] text-[#777168]">No sections match “{query}”.</p>
          )}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-3 md:hidden">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            aria-label="Search documentation"
            spellCheck={false}
            className="w-full rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
          />
        </div>

        <article className="rounded-xl border border-[#E8E2D8] bg-white px-5 py-5 sm:px-8 sm:py-6">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">Architect onboarding · GRAVENX docs</p>
          <div className="mt-4 space-y-8">
            {visible.map((s) => (
              <section key={s.id} id={s.id} aria-label={s.title} className="scroll-mt-24">
                <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">{s.group}</p>
                <h2 className="mt-0.5 text-[17px] font-bold text-[#27241F]">{s.title}</h2>
                {s.blocks.map((b, i) => (
                  <Block key={i} block={b} />
                ))}
              </section>
            ))}
          </div>

          {!results && prev && next && (
            <nav aria-label="Next steps" className="mt-10 grid gap-1.5 border-t border-[#E8E2D8] pt-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => go(prev.id)}
                className="cursor-pointer rounded-xl border border-[#E8E2D8] px-3 py-2 text-left transition-colors hover:border-[#C9A86A]"
              >
                <span className="block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">← Previous</span>
                <span className="block text-[13px] font-semibold text-[#27241F]">{prev.title}</span>
              </button>
              <button
                type="button"
                onClick={() => go(next.id)}
                className="cursor-pointer rounded-xl border border-[#E8E2D8] px-3 py-2 text-right transition-colors hover:border-[#C9A86A]"
              >
                <span className="block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Next →</span>
                <span className="block text-[13px] font-semibold text-[#27241F]">{next.title}</span>
              </button>
            </nav>
          )}
        </article>
      </div>
    </div>
  );
}
