"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SKILL_PACKS } from "@/lib/ai/skills";
import { policyInventory } from "@/lib/ai/toolsSystem";
import {
  buildDefaultPolicy,
  copyPolicy,
  getPolicy,
  mergePolicy,
  resetPolicy,
  savePolicy,
  type AgentPolicy,
  type ApprovalOverride,
} from "@/lib/setup/policy";
import { clearAudit, listAuditRuns, type AuditEvent } from "@/lib/setup/audit";
import { clearArchActivity, listArchActivity, renderActivityReport, type ArchActivityEntry } from "@/lib/erd-activity";
import { aiHistoryKey } from "@/lib/ai/gate";
import { AboutPanel, CompliancePanel, ConnectionsPanel, DiagnosticsPanel, PreferencesPanel, ShortcutsPanel, WorkspacePanel } from "./SetupPanels";
import { BridgeSetupPanel } from "./BridgeSetupPanel";
import { PmoConnectionsPanel } from "./PmoConnectionsPanel";

const SECTIONS = [
  { id: "agent", label: "Agent Control", desc: "Skills, tools, approvals, caps, audit" },
  { id: "bridge", label: "Terminal Bridge", desc: "Pair terminal agents to this tab" },
  { id: "preferences", label: "Preferences", desc: "Connect + panel defaults" },
  { id: "connections", label: "Connections", desc: "Salesforce session + AI providers" },
  { id: "delivery", label: "Delivery", desc: "Jira + ServiceNow, encrypted remember" },
  { id: "workspace", label: "Workspace", desc: "Local data, export, import" },
  { id: "shortcuts", label: "Shortcuts", desc: "Every shortcut in one place" },
  { id: "diagnostics", label: "Diagnostics", desc: "Health checks that run" },
  { id: "compliance", label: "Compliance", desc: "Privacy, terms, what stays local" },
  { id: "about", label: "About", desc: "Version, storage, danger zone" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const APPROVAL_LABEL: Record<ApprovalOverride, string> = {
  default: "Default",
  always: "Always ask",
  never: "Never ask",
};

function AgentControl() {
  const [policy, setPolicy] = useState<AgentPolicy>(() => getPolicy());
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<AgentPolicy | null>(null);
  const [packMessage, setPackMessage] = useState<string | null>(null);
  const packFileRef = useRef<HTMLInputElement>(null);
  const inventory = useMemo(() => policyInventory(), []);
  const labels = useMemo(() => new Map(SKILL_PACKS.map((s) => [s.name, s.label])), []);
  const totalTools = inventory.reduce((n, s) => n + s.tools.length, 0);
  const enabledTools = inventory.reduce(
    (n, s) => n + s.tools.filter((t) => policy.skills[s.skill]?.tools[t.name]?.enabled !== false && policy.skills[s.skill]?.enabled !== false).length,
    0
  );

  const update = (fn: (p: AgentPolicy) => void) => {
    setPolicy((prev) => {
      const next = copyPolicy(prev);
      fn(next);
      return savePolicy(next);
    });
  };

  const refreshAudit = async () => setAudit(await listAuditRuns(100).catch(() => []));
  useEffect(() => {
    void refreshAudit();
  }, []);
  const [activity, setActivity] = useState<ArchActivityEntry[]>([]);
  const [activityMsg, setActivityMsg] = useState<string | null>(null);
  const refreshActivity = async () => setActivity(await listArchActivity(200).catch(() => []));
  useEffect(() => {
    void refreshActivity();
  }, []);
  const downloadActivity = (format: "md" | "json") => {
    try {
      const body =
        format === "md"
          ? renderActivityReport(activity, aiHistoryKey())
          : JSON.stringify({ exportedAt: new Date().toISOString(), org: aiHistoryKey(), entries: activity }, null, 2);
      const blob = new Blob([body], { type: format === "md" ? "text/markdown" : "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arch-activity-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setActivityMsg(`Exported ${activity.length} actions as ${format.toUpperCase()}.`);
    } catch {
      setActivityMsg("Export failed in this browser.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="arch-card flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ivory-950">
            {enabledTools} of {totalTools} tools live
          </p>
          <p className="mt-0.5 text-xs text-ivory-600">
            Disabled tools are hidden from the model entirely. Overrides beat the tool&apos;s own flag; global read-only forces
            Apply on everything that reaches the org.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-800">
          <input
            type="checkbox"
            checked={policy.globalReadOnly}
            onChange={(e) => update((p) => {
              p.globalReadOnly = e.target.checked;
            })}
            className="h-3.5 w-3.5 accent-[#722F37]"
          />
          Read-only mode
        </label>
        <button
          type="button"
          onClick={() => {
            try {
              const blob = new Blob([JSON.stringify(getPolicy(), null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "gravenx-agent-policy.json";
              a.click();
              URL.revokeObjectURL(a.href);
              setPackMessage("Policy pack exported - share the file, import it on another browser.");
            } catch {
              setPackMessage("Export failed in this browser.");
            }
          }}
          title="Download this policy as a shareable JSON pack"
          className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950"
        >
          Export pack
        </button>
        <button
          type="button"
          onClick={() => packFileRef.current?.click()}
          title="Load a policy pack file (applies on confirm)"
          className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950"
        >
          Import pack…
        </button>
        <input
          ref={packFileRef}
          type="file"
          accept="application/json"
          className="hidden"
          aria-label="Agent policy pack file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (packFileRef.current) packFileRef.current.value = "";
            if (!file) return;
            void file
              .text()
              .then((text) => {
                try {
                  const parsed = JSON.parse(text) as unknown;
                  const merged = mergePolicy(buildDefaultPolicy(policyInventory()), parsed);
                  setConfirmImport(merged);
                  setPackMessage(null);
                } catch {
                  setPackMessage("That file is not a valid policy pack.");
                }
              })
              .catch(() => setPackMessage("Could not read that file."));
          }}
        />
        {confirmImport ? (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPolicy(savePolicy(confirmImport));
                setConfirmImport(null);
                setPackMessage("Policy pack applied.");
              }}
              className="cursor-pointer rounded-full bg-ivory-950 px-3 py-1.5 text-xs font-semibold text-ivory-100 hover:bg-ivory-800"
            >
              Apply pack
            </button>
            <button
              type="button"
              onClick={() => setConfirmImport(null)}
              className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-700 hover:text-ivory-950"
            >
              Cancel
            </button>
          </span>
        ) : confirmReset ? (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPolicy(resetPolicy());
                setConfirmReset(false);
              }}
              className="cursor-pointer rounded-full bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
            >
              Confirm reset
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-700 hover:text-ivory-950"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            title="Restore every skill, tool, approval and cap to code defaults"
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950"
          >
            Reset defaults
          </button>
        )}
      </div>
      {packMessage ? <p className="px-1 text-xs text-ivory-700">{packMessage}</p> : null}
      {confirmImport ? (
        <div className="arch-card border-[#C9A86A] px-4 py-3">
          <p className="text-xs font-semibold text-ivory-950">Apply this pack? Unknown entries are dropped, missing tools heal to defaults.</p>
          <p className="mt-0.5 font-mono text-[10px] text-ivory-600">
            {Object.keys(confirmImport.skills).length} skills · read-only {confirmImport.globalReadOnly ? "on" : "off"} · {confirmImport.caps.maxRows} rows/page
          </p>
        </div>
      ) : null}

      <div className="arch-card px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-[1.5px] text-ivory-500">Caps</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ["maxRows", "Rows / page"],
              ["maxFields", "Fields / describe"],
              ["maxLogChars", "Apex log chars"],
              ["maxSteps", "Agent steps"],
              ["maxApexChars", "Apex code chars"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-[11px] font-semibold text-ivory-600">{label}</span>
              <input
                type="number"
                defaultValue={policy.caps[key]}
                min={1}
                onBlur={(e) => {
                  const v = Math.floor(Number(e.target.value));
                  if (Number.isNaN(v)) {
                    e.target.value = String(policy.caps[key]);
                    return;
                  }
                  update((p) => {
                    p.caps[key] = v;
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="mt-1 h-8 w-full rounded-lg border border-[var(--color-line)] bg-white px-2 text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
              />
            </label>
          ))}
        </div>
      </div>

      {inventory.map((pack) => {
        const sp = policy.skills[pack.skill];
        const on = pack.tools.filter((t) => sp?.tools[t.name]?.enabled !== false).length;
        return (
          <div key={pack.skill} className="arch-card overflow-hidden">
            <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={sp?.enabled !== false}
                onClick={() => update((p) => {
                  p.skills[pack.skill].enabled = !(p.skills[pack.skill]?.enabled !== false);
                })}
                title={sp?.enabled !== false ? `Disable the ${pack.skill} skill` : `Enable the ${pack.skill} skill`}
                className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${sp?.enabled !== false ? "bg-[#2F5D3A]" : "bg-ivory-300"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sp?.enabled !== false ? "left-[18px]" : "left-0.5"}`}
                />
              </button>
              <p className="min-w-0 flex-1 text-sm font-bold text-ivory-950">
                {labels.get(pack.skill) ?? pack.skill}
                <span className="ml-2 font-mono text-[10px] font-medium text-ivory-500">{pack.skill}</span>
              </p>
              <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                {on}/{pack.tools.length} on
              </span>
            </div>
            {sp?.enabled !== false && (
              <ul className="divide-y divide-[var(--color-line-soft)]">
                {pack.tools.map((t) => {
                  const tp = sp?.tools[t.name];
                  const enabled = tp?.enabled !== false;
                  return (
                    <li key={t.name} className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        onClick={() => update((p) => {
                          p.skills[pack.skill].tools[t.name].enabled = !enabled;
                        })}
                        title={enabled ? `Hide ${t.name} from the model` : `Offer ${t.name} to the model`}
                        className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${enabled ? "bg-[#2F5D3A]" : "bg-ivory-300"}`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? "left-[18px]" : "left-0.5"}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedTool((prev) => (prev === `${pack.skill}/${t.name}` ? null : `${pack.skill}/${t.name}`))}
                        aria-expanded={expandedTool === `${pack.skill}/${t.name}`}
                        title="Show description and parameter schema"
                        className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-xs text-ivory-950 hover:underline"
                      >
                        {t.name}
                      </button>
                      <select
                        aria-label={`Approval for ${t.name}`}
                        value={tp?.approval ?? "default"}
                        onChange={(e) => update((p) => {
                          p.skills[pack.skill].tools[t.name].approval = e.target.value as ApprovalOverride;
                        })}
                        title="Default follows the tool; Always ask forces Apply; Never ask auto-runs"
                        className="h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-1.5 text-[11px] font-semibold text-ivory-800 focus:border-bronze-500 focus:outline-none"
                      >
                        {(Object.keys(APPROVAL_LABEL) as ApprovalOverride[]).map((k) => (
                          <option key={k} value={k}>
                            {APPROVAL_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      </div>
                      {expandedTool === `${pack.skill}/${t.name}` && (
                        <div className="mt-1.5 rounded-lg border border-[var(--color-line-soft)] bg-white px-2.5 py-2">
                          <p className="text-[11px] leading-relaxed text-ivory-800">{t.description}</p>
                          <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-[1.5px] text-ivory-500">Parameters</p>
                          <pre className="max-h-48 overflow-auto rounded-lg bg-ivory-950 p-2.5 font-mono text-[10px] leading-relaxed text-ivory-100">
                            {JSON.stringify(t.schema, null, 2)}
                          </pre>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <div className="arch-card overflow-hidden">
        <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-bold text-ivory-950">Audit trail</p>
          <span className="font-mono text-[10px] text-ivory-500">{audit.length} events</span>
          <button
            type="button"
            onClick={() => void refreshAudit()}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void clearAudit().then(() => void refreshAudit())}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:text-red-800"
          >
            Clear
          </button>
        </div>
        {audit.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ivory-600">No tool runs recorded yet - ask the agent something and they land here.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-[var(--color-line-soft)] overflow-y-auto">
            {audit.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.ok ? "bg-[#2F5D3A]" : "bg-red-600"}`} aria-hidden="true" />
                <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                  {new Date(e.at).toLocaleString()}
                </span>
                <span className="min-w-0 flex-1 truncate text-ivory-950">
                  <span className="font-mono text-[10px] text-ivory-500">{e.skill}/{e.tool}</span> · {e.label}
                  {e.detail ? <span className="text-ivory-500"> — {e.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="arch-card overflow-hidden">
        <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-bold text-ivory-950">Arch Activity</p>
          <span className="font-mono text-[10px] text-ivory-500">{activity.length} org mutations</span>
          <button
            type="button"
            onClick={() => void refreshActivity()}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void downloadActivity("md")}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Export MD
          </button>
          <button
            type="button"
            onClick={() => void downloadActivity("json")}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void clearArchActivity().then(() => void refreshActivity())}
            className="cursor-pointer rounded-full border border-red-300 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:text-red-800"
          >
            Clear
          </button>
        </div>
        <p className="border-b border-[var(--color-line-soft)] px-4 py-1.5 text-[11px] leading-snug text-ivory-600">
          Every org mutation from the ERD - object/field deploys and record edits, by architect or agent-bridge.
          Canvas curation stays out by design. Paste the MD export straight into JIRA.
        </p>
        {activityMsg && <p className="border-b border-[var(--color-line-soft)] px-4 py-1.5 text-[11px] text-ivory-700">{activityMsg}</p>}
        {activity.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ivory-600">No org mutations yet - deploy a field or save a record from the ERD and it lands here.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-[var(--color-line-soft)] overflow-y-auto">
            {activity.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.ok ? "bg-[#2F5D3A]" : "bg-red-600"}`} aria-hidden="true" />
                <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                  {new Date(e.at).toLocaleString()}
                </span>
                <span className="min-w-0 flex-1 truncate text-ivory-950">
                  <span className="font-mono text-[10px] text-ivory-500">{e.actor}/{e.action}</span> · {e.target}
                  <span className="text-ivory-500"> — {e.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SetupRoute({ linkCode, linkPort }: { linkCode?: string; linkPort?: string }) {
  const [section, setSection] = useState<SectionId>(linkCode ? "bridge" : "agent");
  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ivory-950 text-ivory-100" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </span>
        <div>
          <h1 className="text-lg font-bold text-ivory-950">Setup</h1>
          <p className="text-xs text-ivory-600">Admin console - agent control plane, connections, workspace, compliance, about.</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Setup sections" className="arch-card flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              title={s.desc}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left transition-colors lg:whitespace-normal ${
                section === s.id ? "bg-ivory-950 text-ivory-100" : "text-ivory-800 hover:bg-ivory-200"
              }`}
            >
              <span className="block text-[13px] font-bold">{s.label}</span>
              <span className={`block text-[10px] ${section === s.id ? "text-ivory-300" : "text-ivory-500"}`}>{s.desc}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "agent" && <AgentControl />}
          {section === "bridge" && <BridgeSetupPanel linkCode={linkCode} linkPort={linkPort} />}
          {section === "preferences" && <PreferencesPanel />}
          {section === "connections" && <ConnectionsPanel />}
          {section === "delivery" && <PmoConnectionsPanel />}
          {section === "workspace" && <WorkspacePanel />}
          {section === "shortcuts" && <ShortcutsPanel />}
          {section === "diagnostics" && <DiagnosticsPanel />}
          {section === "compliance" && <CompliancePanel />}
          {section === "about" && <AboutPanel />}
        </div>
      </div>
    </div>
  );
}
