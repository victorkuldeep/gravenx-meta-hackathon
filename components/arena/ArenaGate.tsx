"use client";

import { useState } from "react";
import Link from "next/link";
import { BrainQuickConnect } from "./BrainQuickConnect";

function ArenaMark() {
  return (
    <svg viewBox="0 0 320 180" role="img" aria-label="Architecture arena" className="h-28 w-auto shrink-0 sm:h-32">
      <ellipse cx="160" cy="128" rx="118" ry="30" fill="none" stroke="var(--color-line)" strokeWidth="2" />
      <ellipse cx="160" cy="128" rx="82" ry="20" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
      <ellipse cx="160" cy="128" rx="46" ry="11" fill="none" stroke="#8a6d2f" strokeWidth="1.5" />
      <g stroke="#8a6d2f" strokeWidth="1.5">
        <line x1="160" y1="38" x2="160" y2="80" />
        <line x1="160" y1="80" x2="86" y2="122" />
        <line x1="160" y1="80" x2="160" y2="122" />
        <line x1="160" y1="80" x2="234" y2="122" />
      </g>
      <g fill="#1c1917">
        <circle cx="160" cy="34" r="9" />
        <circle cx="86" cy="126" r="7" fill="#fff" stroke="#1c1917" strokeWidth="2.5" />
        <circle cx="160" cy="126" r="7" fill="#fff" stroke="#1c1917" strokeWidth="2.5" />
        <circle cx="234" cy="126" r="7" fill="#fff" stroke="#1c1917" strokeWidth="2.5" />
      </g>
      <g fill="#fff" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
        <text x="160" y="37">?</text>
      </g>
      <g fill="#8a6d2f" fontSize="8.5" fontWeight="bold" textAnchor="middle">
        <text x="86" y="150">JIRA</text>
        <text x="160" y="150">ORG</text>
        <text x="234" y="150">CODE</text>
      </g>
    </svg>
  );
}

const STEPS = [
  { n: "01", title: "Throw a problem", body: "Type it raw, or pull a Jira ticket / ServiceNow record live. It becomes round zero." },
  { n: "02", title: "Ground the brain", body: "Your framework skills, agent files and org docs load beside built-in packs - custom wins openly." },
  { n: "03", title: "Argue in rounds", body: "Findings, proposals, critiques, revisions - the log is the session memory that outlives the chat." },
  { n: "04", title: "Ship the decision", body: "Accept, link canvases and ADRs, attach the brief back to Jira or hand it to Claude Code." },
];

const REFS = [
  { title: "Brain keys", body: "Provider keys live in this browser's vault. Model choice stays in Model Studio." },
  { title: "Grounding", body: "Client framework skills, AGENTS.md files, API contracts - paste once, enable per session." },
  { title: "Problem in", body: "Typed text, Jira (summary + comments), ServiceNow (incident, story, change). Credentials via Setup → Delivery." },
  { title: "Decision out", body: "Rounds + artifacts + handoff brief. One click attaches it back to the Jira ticket." },
];

/**
 * The Arena gate: brain missing, but the page teaches instead of sitting
 * dead - what the Arena is, how a session runs, where everything connects.
 * Full-bleed and lean; brain configuration lives in a full-space modal.
 */
export function ArenaGate({ onConnected }: { onConnected: () => void }) {
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <div className="w-full pb-2">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-center sm:flex-row sm:text-left">
        <ArenaMark />
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-bold text-ivory-950">The Arena is where problems become designs</h2>
          <p className="mx-auto mt-1 max-w-2xl text-[13px] text-ivory-500 sm:mx-0">
            An agentic architecture session with real org awareness - connect a brain and throw the first problem in.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => setConnectOpen(true)}
              className="cursor-pointer rounded-lg bg-ivory-950 px-4 py-2 text-[13px] font-bold text-ivory-100 hover:bg-ivory-800"
            >
              Connect a brain
            </button>
            <Link
              href="/setup"
              className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-[13px] font-bold text-ivory-950 hover:bg-ivory-50"
            >
              Open Setup instead
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
            <p className="font-mono text-[11px] font-bold text-bronze-700">{s.n}</p>
            <p className="mt-0.5 text-[13px] font-bold text-ivory-950">{s.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-ivory-600">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-left">
        <h3 className="text-[13px] font-bold text-ivory-950">Quick reference - where everything plugs in</h3>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {REFS.map((r) => (
            <div key={r.title} className="rounded-lg bg-white px-3 py-2">
              <dt className="text-[12px] font-bold text-ivory-950">{r.title}</dt>
              <dd className="mt-0.5 text-[12px] leading-relaxed text-ivory-600">{r.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <BrainQuickConnect open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={onConnected} />
    </div>
  );
}
