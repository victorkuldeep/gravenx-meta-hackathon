/**
 * Field audit via the Tooling API: who created / last modified each custom
 * field and when. Describe calls carry shape only, so the Explorer layers
 * this on top. Standard platform fields have no audit rows - the UI renders
 * those as Salesforce-owned.
 */
import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, safeSheetName, type ExcelSheetDef } from "@/lib/excel/workbook";
import { picklistText } from "./fieldDictionary";
import type { SalesforceDescribeResult, SalesforceField } from "./types";

export interface AuditEnvelope {
  success?: boolean;
  status?: number;
  body?: { records?: unknown[] };
  error?: string;
}

/**
 * Unwrap the REST-proxy envelope (`{success, body.records}`) into the audit
 * map. Throws when the proxy reports failure so the UI can say why audit is
 * missing instead of rendering silent blanks.
 */
export function parseAuditEnvelope(data: AuditEnvelope): Record<string, FieldAudit> {
  if (!data || data.success === false) {
    throw new Error(typeof data?.error === "string" && data.error ? data.error : "field audit unavailable");
  }
  const records = data.body?.records;
  return parseFieldAudit(((Array.isArray(records) ? records : []) as unknown) as Parameters<typeof parseFieldAudit>[0]);
}

export interface FieldAudit {
  createdDate: string | null;
  createdBy: string | null;
  modifiedDate: string | null;
  modifiedBy: string | null;
}

interface ToolingAuditRow {
  DeveloperName?: string;
  NamespacePrefix?: string | null;
  CreatedDate?: string;
  CreatedBy?: { Name?: string } | null;
  LastModifiedDate?: string;
  LastModifiedBy?: { Name?: string } | null;
}

/**
 * Tooling SOQL: audit columns for every custom field on one object. Filters
 * on the parent EntityDefinition - TableEnumOrId with a bare API name
 * resolves for standard objects but returns nothing for custom ones
 * (verified live against CIR_Service__c: 0 rows by name, 4 by parent).
 */
export function fieldAuditQuery(objectApi: string): string {
  const safe = objectApi.replace(/'/g, "\\'");
  return (
    "SELECT DeveloperName, NamespacePrefix, CreatedDate, CreatedBy.Name, " +
    `LastModifiedDate, LastModifiedBy.Name FROM CustomField WHERE EntityDefinition.QualifiedApiName = '${safe}'`
  );
}

function fieldKey(row: ToolingAuditRow): string | null {
  const dev = (row.DeveloperName ?? "").trim();
  if (!dev) return null;
  const ns = (row.NamespacePrefix ?? "").trim();
  return ns ? `${ns}__${dev}__c` : `${dev}__c`;
}

/** Index Tooling rows by describe-style API name (`Dev__c`, `ns__Dev__c`). */
export function parseFieldAudit(records: ToolingAuditRow[]): Record<string, FieldAudit> {
  const out: Record<string, FieldAudit> = {};
  for (const r of records ?? []) {
    const key = fieldKey(r);
    if (!key || out[key]) continue;
    out[key] = {
      createdDate: r.CreatedDate ?? null,
      createdBy: r.CreatedBy?.Name ?? null,
      modifiedDate: r.LastModifiedDate ?? null,
      modifiedBy: r.LastModifiedBy?.Name ?? null,
    };
  }
  return out;
}

const AUDIT_HEADER = ["Field Label", "API Name", "Type", "Length", "Required", "Unique", "External ID", "Reference To", "Picklist Values", "Default Value", "Help Text", "Created By", "Created Date", "Modified By", "Modified Date"];

const AUDIT_WIDTHS = [28, 28, 16, 10, 10, 10, 12, 22, 50, 18, 40, 20, 14, 20, 14];

function auditRow(f: SalesforceField, audit: Record<string, FieldAudit>): unknown[] {
  const a = audit[f.name];
  const standard = !f.custom;
  return [
    f.label,
    f.name,
    f.type,
    f.length || "",
    !f.nillable && !f.defaultedOnCreate ? "Y" : "N",
    f.unique ? "Y" : "N",
    f.externalId ? "Y" : "N",
    f.referenceTo.join(", "),
    picklistText(f),
    f.defaultValue === null || f.defaultValue === undefined ? "" : String(f.defaultValue),
    f.inlineHelpText ?? "",
    a?.createdBy ?? (standard ? "Salesforce" : "—"),
    a?.createdDate ?? "—",
    a?.modifiedBy ?? (standard ? "Salesforce" : "—"),
    a?.modifiedDate ?? "—",
  ];
}

export function buildExplorerSheets(
  describe: SalesforceDescribeResult,
  audit: Record<string, FieldAudit>,
  opts: { org?: string; exportedAt?: string } = {}
): ExcelSheetDef[] {
  const audited = describe.fields.filter((f) => audit[f.name]).length;
  const used = new Set<string>();
  const relRows: unknown[][] = [];
  for (const r of describe.childRelationships ?? []) {
    if (!r.relationshipName) continue;
    relRows.push([describe.name, r.childSObject, r.field, r.cascadeDelete ? "Master-Detail" : "Lookup", r.relationshipName]);
  }
  return [
    {
      name: "Summary",
      rows: [
        ["Explorer", describe.label || describe.name],
        ["Object", describe.name],
        ["Org", opts.org ?? ""],
        ["Exported", opts.exportedAt ?? new Date().toISOString()],
        ["Fields", describe.fields.length],
        ["With audit", audited],
        ["Relationships", relRows.length],
      ],
      widths: [20, 90],
    },
    {
      name: safeSheetName(describe.label || describe.name, used),
      header: AUDIT_HEADER,
      rows: describe.fields.map((f) => auditRow(f, audit)),
      widths: AUDIT_WIDTHS,
    },
    {
      name: "Relationships",
      header: ["Parent Object", "Child Object", "Via Field", "Kind", "Relationship Name"],
      rows: relRows,
      widths: [24, 24, 28, 16, 28],
    },
  ];
}

export async function buildExplorerWorkbook(
  describe: SalesforceDescribeResult,
  audit: Record<string, FieldAudit>,
  opts: { org?: string; exportedAt?: string } = {}
): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildExplorerSheets(describe, audit, opts));
}

export async function downloadExplorerWorkbook(
  describe: SalesforceDescribeResult,
  audit: Record<string, FieldAudit>,
  filename: string,
  opts: { org?: string; exportedAt?: string } = {}
): Promise<void> {
  await downloadExcelWorkbook(await buildExplorerWorkbook(describe, audit, opts), filename);
}
