/**
 * Sequence interaction matrix - every message flattened in document
 * order with its block path (loop > condition > …), retry, timeout and
 * operation reference, plus the participant roster.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { SeqMessage, SeqNode, SequenceDocument } from "./model";

interface FlatMessage {
  message: SeqMessage;
  path: string;
}

function flatten(nodes: SeqNode[], trail: string[], out: FlatMessage[]): void {
  for (const n of nodes) {
    if (n.nodeType === "message") {
      out.push({ message: n, path: trail.join(" > ") });
      continue;
    }
    const label = `${n.type}${n.title ? `: ${n.title}` : ""}`;
    flatten(n.children, [...trail, label], out);
    if (n.elseChildren) flatten(n.elseChildren, [...trail, `${label} (else)`], out);
  }
}

export function flattenSequence(doc: SequenceDocument): FlatMessage[] {
  const out: FlatMessage[] = [];
  flatten(doc.nodes, [], out);
  return out;
}

export function buildSequenceMatrixSheets(doc: SequenceDocument): ExcelSheetDef[] {
  const flat = flattenSequence(doc);
  const names = new Map(doc.participants.map((p) => [p.id, p.name]));
  return [
    {
      name: "Summary",
      rows: [
        ["Sequence Interaction Matrix", ""],
        ["Sequence", doc.name],
        ["Status", doc.status],
        ["Exported", new Date().toISOString()],
        ["Participants", doc.participants.length],
        ["Messages", flat.length],
      ],
      widths: [18, 100],
    },
    {
      name: "Participants",
      header: ["Name", "Kind", "System Ref"],
      rows: doc.participants.map((p) => [p.name, p.kind, p.systemRef ?? ""]),
      widths: [32, 14, 40],
    },
    {
      name: "Messages",
      header: ["#", "From", "To", "Kind", "Label", "Retry", "Timeout (s)", "Operation", "Block Path", "Note"],
      rows: flat.map((f, i) => [
        i + 1,
        names.get(f.message.from) ?? f.message.from,
        names.get(f.message.to) ?? f.message.to,
        f.message.kind,
        f.message.label,
        f.message.retry ? `${f.message.retry.attempts}x${f.message.retry.waitSecs ? ` / ${f.message.retry.waitSecs}s` : ""}` : "",
        f.message.timeoutSecs ?? "",
        f.message.operationRef ?? "",
        f.path,
        f.message.note ?? "",
      ]),
      widths: [6, 24, 24, 12, 50, 14, 12, 30, 40, 50],
    },
  ];
}

export async function buildSequenceMatrixWorkbook(doc: SequenceDocument): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildSequenceMatrixSheets(doc));
}

export async function downloadSequenceMatrix(doc: SequenceDocument, filename: string): Promise<void> {
  await downloadExcelWorkbook(await buildSequenceMatrixWorkbook(doc), filename);
}
