import { describe, expect, it } from "vitest";
import { fieldFlags, fieldTypeDetail } from "./fieldDetail";

const base = {
  type: "string",
  length: 255,
  precision: 0,
  scale: 0,
  refs: [] as string[],
  refKind: undefined as "lookup" | "master-detail" | undefined,
  pickValues: [] as { label: string; value: string; active: boolean; isDefault: boolean }[],
  required: false,
  unique: false,
  externalId: false,
  calculated: false,
  updateable: true,
  isName: false,
};

describe("fieldTypeDetail", () => {
  it("renders text types with length", () => {
    expect(fieldTypeDetail(base)).toBe("String · 255");
    expect(fieldTypeDetail({ ...base, type: "textarea", length: 131072 })).toBe("Textarea · 131072");
  });

  it("renders lookups and master-details with targets", () => {
    expect(fieldTypeDetail({ ...base, type: "reference", refs: ["Account"], refKind: "lookup" })).toBe("Lookup → Account");
    expect(fieldTypeDetail({ ...base, type: "reference", refs: ["Account"], refKind: "master-detail" })).toBe("Master-Detail → Account");
    expect(fieldTypeDetail({ ...base, type: "reference" })).toBe("Lookup");
  });

  it("renders numbers with precision and picklists with counts", () => {
    expect(fieldTypeDetail({ ...base, type: "currency", precision: 18, scale: 2, length: 0 })).toBe("Currency · 18, 2");
    expect(
      fieldTypeDetail({
        ...base,
        type: "picklist",
        length: 0,
        pickValues: [
          { label: "A", value: "A", active: true, isDefault: false },
          { label: "B", value: "B", active: true, isDefault: false },
        ],
      }),
    ).toBe("Picklist · 2 values");
    expect(fieldTypeDetail({ ...base, type: "boolean", length: 0 })).toBe("Boolean");
    expect(fieldTypeDetail({ ...base, type: "id", length: 18 })).toBe("ID");
  });
});

describe("fieldFlags", () => {
  it("lists honesty chips", () => {
    expect(fieldFlags({ ...base, required: true, unique: true })).toEqual(["Required", "Unique"]);
    expect(fieldFlags({ ...base, updateable: false })).toEqual(["Read-only"]);
    expect(fieldFlags({ ...base, calculated: true, updateable: false })).toEqual(["Calculated"]);
    expect(fieldFlags(base)).toEqual([]);
  });
});
