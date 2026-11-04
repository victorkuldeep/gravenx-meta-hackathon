"use client";

export type ZigZagTarget =
  | { kind: "mode"; mode: "single" | "composite" | "soql" | "graphql" | "schema" | "rest" }
  | { kind: "route"; href: "/json" | "/contracts" };

interface ZigZagItem {
  titleA: string;
  titleEm: string;
  copy: string;
  cta: string;
  target: ZigZagTarget;
}

const ITEMS: ZigZagItem[] = [
  {
    titleA: "Type-correct",
    titleEm: "payloads.",
    copy: "POST & PATCH bodies with required-field awareness and record-ID handling.",
    cta: "Single Object",
    target: { kind: "mode", mode: "single" },
  },
  {
    titleA: "Batches with",
    titleEm: "reference IDs.",
    copy: "Multi-sObject graphs with unique reference IDs in a single Composite API call.",
    cta: "Composite",
    target: { kind: "mode", mode: "composite" },
  },
  {
    titleA: "Ask anything,",
    titleEm: "explain everything.",
    copy: "Plans, history, saved queries and CSV exports - Dev Console power, zero context switching.",
    cta: "SOQL",
    target: { kind: "mode", mode: "soql" },
  },
  {
    titleA: "One round trip,",
    titleEm: "whole graph.",
    copy: "Walk lookup trees with value precision. Live metadata, read-only, no mutations.",
    cta: "GraphQL",
    target: { kind: "mode", mode: "graphql" },
  },
  {
    titleA: "See the model,",
    titleEm: "not just the fields.",
    copy: "Any org as an ERD - discover relationships, present with the laser, export hi-res PNG.",
    cta: "Schema Map",
    target: { kind: "mode", mode: "schema" },
  },
  {
    titleA: "Any method,",
    titleEm: "any endpoint.",
    copy: "Org-scoped or public REST calls with cURL paste, history and one-click collection staging.",
    cta: "REST",
    target: { kind: "mode", mode: "rest" },
  },
  {
    titleA: "Diff versions,",
    titleEm: "node by node.",
    copy: "Edit payloads in a tree and compare versions side by side - virtualized for the biggest payloads.",
    cta: "JSON Studio",
    target: { kind: "route", href: "/json" },
  },
  {
    titleA: "Contracts,",
    titleEm: "not guesswork.",
    copy: "Profiles, mappings, deterministic OpenAPI 3.1 - versions and compatibility included.",
    cta: "Contracts",
    target: { kind: "route", href: "/contracts" },
  },
  {
    titleA: "Export",
    titleEm: "anywhere.",
    copy: "JSON, cURL with $SF_ACCESS_TOKEN placeholder, JS fetch, or Apex HttpRequest.",
    cta: "Builder",
    target: { kind: "mode", mode: "single" },
  },
];

/**
 * Home capabilities as numbered zig-zag slogans (archtools language):
 * giant index alternating sides, mocha/burgundy numerals, hairlines.
 */
export function HomeZigZag({ onOpen }: { onOpen: (t: ZigZagTarget) => void }) {
  return (
    <section aria-label="Capabilities" className="w-full pt-10 pb-4">
      {ITEMS.map((item, i) => {
        const flip = i % 2 === 1;
        const num = String(i + 1).padStart(2, "0");
        return (
          <div key={num} className="border-t border-[var(--color-line-soft)] py-10 first:border-t-0 first:pt-2">
            <div className={`flex flex-col gap-4 md:flex-row md:items-start ${flip ? "md:flex-row-reverse md:text-right" : ""}`}>
              <span
                aria-hidden="true"
                style={{ color: i % 2 === 0 ? "#722F37" : "#4E342E" }}
                className="font-mono font-extrabold leading-none select-none text-6xl sm:text-7xl md:w-40 shrink-0"
              >
                {num}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="hero-title zigzag-title text-4xl sm:text-5xl text-ivory-950">
                  {item.titleA} <em>{item.titleEm}</em>
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-ivory-700 md:ml-0" style={flip ? { marginLeft: "auto" } : undefined}>
                  {item.copy}
                </p>
                <button
                  type="button"
                  onClick={() => onOpen(item.target)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent-dark)] hover:text-[var(--color-ink)] hover:underline underline-offset-4 transition-colors cursor-pointer"
                >
                  Open {item.cta} <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
