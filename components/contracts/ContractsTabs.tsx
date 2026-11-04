"use client";

import type { RefObject } from "react";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";
import type { StoredContractProfile } from "@/lib/contracts/persistence";
import type { ContractProfile } from "@/lib/contracts/types";
import type { ContractsTab } from "./ContractsRoute";
import Button from "../ui/Button";
import { ProfileManager } from "./ProfileManager";
import { ContractDesigner } from "./ContractDesigner";
import { ContractPreview } from "./ContractPreview";
import { ContractValidate } from "./ContractValidate";
import { ContractVersions } from "./ContractVersions";
import { ContractCompare } from "./ContractCompare";
import type { SeedKind } from "@/lib/contracts/seeds";

export interface ContractsTabsProps {
  tab: ContractsTab;
  setTab: (t: ContractsTab) => void;
  session: { instanceUrl: string; token: string; apiVersion: string } | null;
  objects: SalesforceObject[];
  describes: Map<string, SalesforceDescribeResult>;
  stored: StoredContractProfile[];
  drafts: Map<string, ContractProfile>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  dirtyIds: Set<string>;
  notice: string | null;
  fileRef: RefObject<HTMLInputElement | null>;
  onConnect: () => void;
  onSave: (id: string) => void;
  onCreate: (objectName: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImportFile: (file: File) => void;
  onPatchDraft: (id: string, patch: Partial<ContractProfile> | ((p: ContractProfile) => ContractProfile)) => void;
  onFetchDescribe: (objectName: string) => Promise<SalesforceDescribeResult | null>;
  onCreateFromTemplate: (kind: SeedKind) => void;
  onRestoreRevision: (profile: ContractProfile) => void;
}

/**
 * Contract Studio shell: profile bar, screen tabs, panels.
 * Versions arrive in Phase 4 - tabs stay Profiles/Designer/Preview/Validate.
 */
export function ContractsTabs(props: ContractsTabsProps) {
  const { tab, setTab, drafts, activeId, setActiveId, dirtyIds, notice, session, onConnect, onSave } = props;
  const active = activeId ? (drafts.get(activeId) ?? null) : null;

  const tabs: { id: ContractsTab; label: string }[] = [
    { id: "profiles", label: "Profiles" },
    { id: "designer", label: "Designer" },
    { id: "preview", label: "OpenAPI Preview" },
    { id: "validate", label: "Validate" },
    { id: "versions", label: "Versions" },
    { id: "compare", label: "Compare" },
  ];

  return (
    <div className="space-y-4">
      {/* Studio header */}
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[#27241F]">API Contract Studio</h2>
            <p className="text-xs text-[#777168]">OpenAPI contracts from live Salesforce metadata.</p>
          </div>
          <span className="flex-1" />
          {!session ? (
            <Button size="sm" onClick={onConnect}>Connect org</Button>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#777168]" title={session.instanceUrl}>
              <span className="h-1.5 w-1.5 rounded-full bg-[#32815B]" aria-hidden="true" />
              <span className="max-w-[200px] truncate">{session.instanceUrl.replace(/^https:\/\//, "")}</span>
            </span>
          )}
          <select
            value={activeId ?? ""}
            onChange={(e) => setActiveId(e.target.value || null)}
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] max-w-[240px]"
            aria-label="Active profile"
          >
            {[...drafts.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{dirtyIds.has(p.id) ? " •" : ""}
              </option>
            ))}
          </select>
          {active && (
            <Button
              size="sm"
              disabled={!dirtyIds.has(active.id)}
              onClick={() => onSave(active.id)}
              title={dirtyIds.has(active.id) ? "Persist profile + metadata snapshot" : "No unsaved changes"}
            >
              {dirtyIds.has(active.id) ? "Save •" : "Saved"}
            </Button>
          )}
        </div>
        {notice && (
          <p className="mt-1.5 rounded-lg bg-[#F5F1E8] px-2 py-1 text-[11px] text-[#777168]" role="status">
            {notice}
          </p>
        )}
        <div className="mt-2 flex" role="tablist" aria-label="Contract Studio screens">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-[13px] font-medium transition-colors cursor-pointer ${
                tab === t.id
                  ? "text-[#27241F] underline underline-offset-8 decoration-[#A98450] decoration-2"
                  : "text-[#A39B8E] hover:text-[#27241F]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "profiles" && <ProfileManager {...props} />}
      {tab === "designer" && <ContractDesigner {...props} />}
      {tab === "preview" && <ContractPreview {...props} />}
      {tab === "validate" && <ContractValidate {...props} />}
      {tab === "versions" && <ContractVersions {...props} />}
      {tab === "compare" && <ContractCompare {...props} />}
    </div>
  );
}
