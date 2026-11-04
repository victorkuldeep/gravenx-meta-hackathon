"use client";

import { useRef, useState } from "react";
import Button from "../ui/Button";
import { buildSnapshot, diffSnapshots, type DriftFinding } from "@/lib/mapping/snapshot";
import type { MappingProject } from "@/lib/mapping/types";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Schema drift review: refresh live metadata, diff against the project
 * snapshot, and reconcile explicitly. The old snapshot is never silently
 * replaced - applying it is a deliberate architect action.
 */
export function DriftReview({
  project,
  connected,
  objects,
  loadDescribe,
  onApplySnapshot,
}: {
  project: MappingProject;
  connected: boolean;
  objects: SalesforceObject[];
  loadDescribe: (objectName: string) => Promise<SalesforceDescribeResult | null>;
  onApplySnapshot: (snapshot: MappingProject["sfSnapshot"], affected: DriftFinding[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [findings, setFindings] = useState<DriftFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const freshRef = useRef<MappingProject["sfSnapshot"]>(null);

  const refresh = async () => {
    if (!project.sfSnapshot) return;
    setBusy(true);
    setError(null);
    try {
      const entries = [];
      for (const o of project.sfSnapshot.objects) {
        const describe = await loadDescribe(o.name);
        const objMeta = objects.find((x) => x.name === o.name);
        if (describe && objMeta) entries.push({ meta: objMeta, describe });
      }
      if (entries.length === 0) {
        setError("None of the snapshot objects could be re-described. Check the connection.");
        return;
      }
      const now = new Date().toISOString();
      const fresh = buildSnapshot(uid("snap"), entries, project.sfSnapshot.orgAlias, now);
      freshRef.current = fresh;
      setFreshId(fresh.id);
      setFindings(diffSnapshots(project.sfSnapshot, fresh));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!freshRef.current || !findings) return;
    onApplySnapshot(freshRef.current, findings);
    setOpen(false);
    setFindings(null);
  };

  const affectedMappings = (f: DriftFinding): string[] => {
    if (!f.fieldName) return [];
    return project.mappings
      .filter((m) => m.objectName === f.objectName && (!f.fieldName || m.fieldName === f.fieldName))
      .map((m) => m.sourcePath);
  };

  if (!project.sfSnapshot) return null;

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Schema drift · {project.sfSnapshot.fingerprint}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Check for drift"}
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {!connected && (
            <p className="rounded-lg border border-[#DCC99A] bg-[#F5EEDF] px-2.5 py-2 text-[11px] text-[#8A6A2F]">
              Connect via Home to refresh live metadata.
            </p>
          )}
          <Button size="sm" disabled={!connected || busy} onClick={() => void refresh()}>
            {busy ? "Refreshing…" : "Refresh against live metadata"}
          </Button>
          {error && (
            <p role="alert" className="text-[12px] text-[#B3261E]">
              {error}
            </p>
          )}
          {findings && (
            <div className="space-y-2">
              {findings.length === 0 ? (
                <p className="text-[12px] text-[#2F7D4F]">No drift - snapshot {freshId} matches live metadata.</p>
              ) : (
                <>
                  <p className="text-[12px] font-semibold text-[#27241F]">
                    {findings.length} change{findings.length > 1 ? "s" : ""} found. Review each, then apply explicitly.
                  </p>
                  <ul className="max-h-[300px] space-y-1.5 overflow-y-auto">
                    {findings.map((f, i) => {
                      const affected = affectedMappings(f);
                      return (
                        <li key={i} className="rounded-lg border border-[#F0EBE0] px-2.5 py-2 text-[11px]">
                          <span className="font-mono font-semibold text-[#27241F]">{f.kind}</span>
                          <span className="block text-[#55504A]">{f.message}</span>
                          {affected.length > 0 && (
                            <span className="block font-mono text-[10px] text-[#9A5B13]">
                              affects {affected.length} mapping{affected.length > 1 ? "s" : ""}: {affected.slice(0, 3).join(", ")}
                              {affected.length > 3 ? ` +${affected.length - 3} more` : ""}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setFindings(null)}>
                      Dismiss (keep old snapshot)
                    </Button>
                    <Button size="sm" onClick={apply}>
                      Apply new snapshot
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
