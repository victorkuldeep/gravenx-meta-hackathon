/**
 * ERD field dictionary - the client handoff workbook: one sheet per
 * object on the canvas (label, API name, type, constraints, picklists),
 * a single relationships sheet for every edge, and a summary cover.
 * Pure builder over describes; the UI layer downloads it.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { SalesforceDescribeResult, SalesforceField } from "./types";

const FIELD_HEADER = [
  "Field Label",
  "API Name",
  "Type",
  "Length",
  "Required",
  "Unique",
  "External ID",
  "Reference To",
  "Picklist Values",
  "Default Value",
  "Help Text",
];

const FIELD_WIDTHS = [28, 28, 16, 10, 10, 10, 12, 22, 50, 18, 40];

/** Shared with the Explorer audit workbook - same picklist vocabulary. */
export function picklistText(f: SalesforceField): string {
  if (f.picklistValues.length === 0) return "";
  const active = f.picklistValues.filter((p) => p.active);
  const shown = active.map((p) => (p.label === p.value ? p.value : `${p.label} (${p.value})`)).join("; ");
  const inactive = f.picklistValues.length - active.length;
  return inactive > 0 ? `${shown} [+${inactive} inactive]` : shown;
}

function fieldRow(f: SalesforceField): unknown[] {
  return [
    f.label,
    f.name,
    f.type,
    f.length || "",
    !f.nillable && !f.defaultedOnCreate ? "Y" : "N",
    f.unique ? "yes" : "no",
    f.externalId ? "yes" : "no",
    f.referenceTo.join(", "),
    picklistText(f),
    f.defaultValue === null || f.defaultValue === undefined ? "" : String(f.defaultValue),
    f.inlineHelpText ?? "",
  ];
}

export function buildFieldDictionarySheets(
  describes: Iterable<SalesforceDescribeResult>,
  opts: { org?: string; exportedAt?: string } = {},
): ExcelSheetDef[] {
  const list = [...describes];
  const totalFields = list.reduce((n, d) => n + d.fields.length, 0);
  const sheets: ExcelSheetDef[] = [
    {
      name: "Summary",
      rows: [
        ["Field Dictionary", ""],
        ["Org", opts.org ?? ""],
        ["Exported", opts.exportedAt ?? new Date().toISOString()],
        ["Objects", list.length],
        ["Total fields", totalFields],
      ],
      widths: [20, 90],
    },
  ];
  const relRows: unknown[][] = [];
  for (const d of list) {
    for (const r of d.childRelationships ?? []) {
      if (!r.relationshipName) continue;
      relRows.push([d.name, r.childSObject, r.field, r.cascadeDelete ? "Master-Detail" : "Lookup", r.relationshipName]);
    }
  }
  sheets.push({
    name: "Relationships",
    header: ["Parent Object", "Child Object", "Via Field", "Kind", "Relationship Name"],
    rows: relRows,
    widths: [24, 24, 28, 16, 28],
  });
  for (const d of list) {
    sheets.push({
      name: d.label || d.name,
      header: FIELD_HEADER,
      rows: d.fields.map(fieldRow),
      widths: FIELD_WIDTHS,
    });
  }
  return sheets;
}

export async function buildFieldDictionaryWorkbook(
  describes: Iterable<SalesforceDescribeResult>,
  opts: { org?: string; exportedAt?: string } = {},
): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildFieldDictionarySheets(describes, opts));
}

export async function downloadFieldDictionary(
  describes: Iterable<SalesforceDescribeResult>,
  filename: string,
  opts: { org?: string; exportedAt?: string } = {},
): Promise<void> {
  await downloadExcelWorkbook(await buildFieldDictionaryWorkbook(describes, opts), filename);
}
