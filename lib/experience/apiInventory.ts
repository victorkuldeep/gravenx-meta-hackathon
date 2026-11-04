/**
 * API catalog inventory - the integration-review sheet: every operation
 * with its method, path, layer, owner, lifecycle and contracts, plus
 * backend dependencies resolved to operation names.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { ApiCatalog, BackendDependency } from "./types";

export function buildApiInventorySheets(name: string, catalog: Pick<ApiCatalog, "operations" | "dependencies">): ExcelSheetDef[] {
  const ops = new Map(catalog.operations.map((o) => [o.id, o]));
  return [
    {
      name: "Summary",
      rows: [
        ["API Inventory", ""],
        ["Project", name],
        ["Exported", new Date().toISOString()],
        ["Operations", catalog.operations.length],
        ["Dependencies", catalog.dependencies.length],
      ],
      widths: [18, 100],
    },
    {
      name: "Operations",
      header: [
        "Name", "Method", "Path", "Layer", "Owner", "Version", "Lifecycle",
        "Status", "Request Contract", "Response Contract", "Operation Key", "Updated",
      ],
      rows: catalog.operations.map((o) => [
        o.name, o.method, o.path, o.layer, o.owner ?? "", o.version ?? "", o.lifecycle,
        o.status, o.requestContractId ?? "", o.responseContractId ?? "", o.operationKey, o.updatedAt,
      ]),
      widths: [32, 10, 40, 14, 18, 12, 14, 14, 22, 22, 30, 14],
    },
    {
      name: "Dependencies",
      header: ["Operation", "Label", "Kind", "Reference", "Status", "Notes"],
      rows: catalog.dependencies.map((d: BackendDependency) => [
        ops.get(d.operationId)?.name ?? d.operationId,
        d.label,
        d.kind,
        [d.reference?.objectApiName, d.reference?.fieldApiName].filter(Boolean).join(".") ||
          d.reference?.label ||
          d.reference?.artifactId ||
          "",
        d.status,
        d.notes ?? "",
      ]),
      widths: [32, 32, 20, 36, 14, 50],
    },
  ];
}

export async function buildApiInventoryWorkbook(name: string, catalog: Pick<ApiCatalog, "operations" | "dependencies">): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildApiInventorySheets(name, catalog));
}

export async function downloadApiInventory(
  name: string,
  catalog: Pick<ApiCatalog, "operations" | "dependencies">,
  filename: string,
): Promise<void> {
  await downloadExcelWorkbook(await buildApiInventoryWorkbook(name, catalog), filename);
}
