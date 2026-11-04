/**
 * Screen sign-off - the client-approval sheet: every wireframe screen
 * with its contract (route, endpoint, role, device), component counts,
 * and blank approval columns for countersignature.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { ExperienceModule } from "./types";

export function buildSignoffSheets(name: string, exp: ExperienceModule): ExcelSheetDef[] {
  const compsByScreen = new Map<string, number>();
  for (const c of exp.components) {
    compsByScreen.set(c.screenId, (compsByScreen.get(c.screenId) ?? 0) + 1);
  }
  return [
    {
      name: "Summary",
      rows: [
        ["Screen Sign-off", ""],
        ["Project", name],
        ["Exported", new Date().toISOString()],
        ["Screens", exp.screens.length],
        ["Components", exp.components.length],
      ],
      widths: [18, 100],
    },
    {
      name: "Screens",
      header: [
        "Screen", "Route", "Endpoint", "Feature", "Role", "Device",
        "Status", "Components", "Approved?", "Approver", "Date",
      ],
      rows: exp.screens.map((s) => [
        s.name, s.route ?? "", s.endpoint ?? "", s.feature ?? "", s.userRole ?? "",
        s.deviceContext ?? "", s.status, compsByScreen.get(s.id) ?? 0, "", "", "",
      ]),
      widths: [30, 28, 28, 20, 18, 14, 14, 12, 12, 20, 14],
    },
    {
      name: "Components",
      header: ["Component", "Screen", "Type", "Purpose", "Status"],
      rows: exp.components.map((c) => [
        c.name,
        exp.screens.find((s) => s.id === c.screenId)?.name ?? c.screenId,
        c.componentType,
        c.purpose ?? "",
        c.status,
      ]),
      widths: [32, 30, 16, 60, 14],
    },
  ];
}

export async function buildSignoffWorkbook(name: string, exp: ExperienceModule): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildSignoffSheets(name, exp));
}

export async function downloadSignoff(name: string, exp: ExperienceModule, filename: string): Promise<void> {
  await downloadExcelWorkbook(await buildSignoffWorkbook(name, exp), filename);
}
