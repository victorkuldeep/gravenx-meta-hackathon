import { describe, expect, it } from "vitest";
import { ALL_STATUSES, STATUS_LABELS, type MappingStatus } from "./types";

describe("STATUS_LABELS", () => {
  it("covers every MappingStatus", () => {
    const ids = Object.keys(STATUS_LABELS).sort();
    expect(ids).toEqual([...ALL_STATUSES].sort());
    // Union exhaustiveness: assigning the record to each id type-checks.
    for (const s of ALL_STATUSES) {
      const label: string = STATUS_LABELS[s as MappingStatus];
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("uses Title Case display copy, never raw kebab ids", () => {
    for (const label of Object.values(STATUS_LABELS)) {
      expect(label).not.toContain("-");
      expect(label[0]).toBe(label[0].toUpperCase());
    }
    expect(STATUS_LABELS["stale-target"]).toBe("Stale Target");
    expect(STATUS_LABELS.unmapped).toBe("Unmapped");
  });
});
