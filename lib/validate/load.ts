/**
 * Validate workspace - contract assembly.
 *
 * Runs ingestion + operation extraction and assembles the final
 * ParsedContract with status. UI calls one function.
 */

import { extractOperations } from "./operations";
import { ingestSpec } from "./spec";
import type { ParsedContract } from "./types";

export async function loadContract(
  fileName: string,
  text: string,
  byteSize: number
): Promise<ParsedContract> {
  const { contract, dereferenced, diagnostics, fatal } = await ingestSpec({ fileName, text, byteSize });

  if (fatal || dereferenced === undefined) {
    return {
      ...contract,
      operations: [],
      diagnostics,
      status: diagnostics.some((d) => d.id === "external-refs" || d.id === "unsupported-version" || d.id === "swagger-2.0")
        ? "unsupported"
        : "invalid",
      schemaCount: 0,
    };
  }

  const { operations, diagnostics: opDiagnostics, schemaCount } = extractOperations(
    dereferenced,
    contract.version ?? "3.0.0"
  );
  const all = [...diagnostics, ...opDiagnostics];
  const opDiags = operations.flatMap((o) => o.diagnostics);
  const hasError = all.some((d) => d.severity === "error");
  const hasWarning = all.some((d) => d.severity === "warning") || opDiags.some((d) => d.severity === "warning");

  return {
    ...contract,
    operations,
    diagnostics: all,
    status: hasError ? "invalid" : hasWarning ? "parsed-with-warnings" : "parsed",
    schemaCount,
  };
}
