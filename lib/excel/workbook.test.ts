import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildExcelWorkbook, excelCell, safeSheetName } from "./workbook";

describe("excel engine", () => {
  it("sanitizes, truncates, and dedupes sheet names", () => {
    const used = new Set<string>();
    expect(safeSheetName("Field Mappings", used)).toBe("Field Mappings");
    expect(safeSheetName("A/B:C*D?E[F]G", used)).toBe("A-B-C-D-E-F-G");
    expect(safeSheetName("x".repeat(40), used)).toBe("x".repeat(31));
    expect(safeSheetName("Field Mappings", used)).toBe("Field Mappings (2)");
    expect(safeSheetName("   ", used)).toBe("Sheet");
  });

  it("coerces values to cells without throwing", () => {
    expect(excelCell(null)).toBeNull();
    expect(excelCell(undefined)).toBeNull();
    expect(excelCell("a")).toBe("a");
    expect(excelCell(42)).toBe(42);
    expect(excelCell(true)).toBe(true);
    const d = new Date("2026-01-01");
    expect(excelCell(d)).toBe(d);
    expect(excelCell({ a: 1 })).toBe('{"a":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(excelCell(cyclic)).toBe("[object Object]");
  });

  it("builds frozen, filtered sheets with bold headers", async () => {
    const wb = await buildExcelWorkbook([
      { name: "First", header: ["A", "B"], rows: [["a1", 1]], widths: [20, 10] },
      { name: "KV", rows: [["K", "V"]] },
    ]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["First", "KV"]);
    const first = wb.getWorksheet("First")!;
    expect(first.getRow(1).font?.bold).toBe(true);
    expect(first.views).toEqual([{ state: "frozen", ySplit: 1 }]);
    expect(first.autoFilter).toBeTruthy();
    expect(first.columns.map((c) => c.width)).toEqual([20, 10]);
    // Round-trip: bytes parse back with values intact.
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
    const round = new ExcelJS.Workbook();
    await round.xlsx.load(buf);
    expect(round.getWorksheet("First")!.getRow(2).values).toEqual([undefined, "a1", 1]);
  });
});
