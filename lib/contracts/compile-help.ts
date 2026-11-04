import { compileContract, type CompileResult } from "./openapi-compiler";
import { adaptDescribe } from "./metadata-adapter";
import type { StoredContractProfile } from "./persistence";
import type { ContractProfile } from "./types";
import type { SalesforceDescribeResult } from "../salesforce/types";

/**
 * Compile the active draft with live-or-snapshot metadata.
 * Shared by Preview and Validate so both screens agree exactly.
 */
export function compileDraft(
  draft: ContractProfile | null | undefined,
  describes: Map<string, SalesforceDescribeResult>,
  stored: StoredContractProfile[]
): CompileResult | null {
  if (!draft) return null;
  const desc = describes.get(draft.targetObjectApiName);
  const snap = stored.find((s) => s.id === draft.id)?.snapshot ?? null;
  const meta = new Map();
  const source = desc ?? (snap ? (snap.describe as never) : null);
  if (source && typeof source === "object" && "fields" in (source as object)) {
    try {
      for (const f of adaptDescribe(source as never).fields) meta.set(f.apiName, f);
    } catch {
      /* corrupt snapshot - compile metadata-blind, diagnostics flag it */
    }
  }
  return compileContract({
    profile: draft,
    metaByName: meta,
    snapshotCapturedAt: snap?.capturedAt ?? null,
  });
}
