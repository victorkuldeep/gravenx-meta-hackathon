import { describe, expect, it } from "vitest";
import { fetchObjectLayouts, parseLayouts } from "./layouts";

const FIXTURE = {
  layouts: [
    {
      id: "00h000000000001",
      editLayoutSections: [
        {
          heading: "Information",
          columns: 2,
          layoutRows: [
            {
              layoutItems: [
                {
                  editableForNew: true,
                  editableForUpdate: true,
                  label: "Account Name",
                  placeholder: false,
                  required: true,
                  layoutComponents: [{ type: "Field", value: "Name" }],
                },
                {
                  editableForNew: true,
                  editableForUpdate: false,
                  label: "Rating",
                  placeholder: false,
                  required: false,
                  layoutComponents: [{ type: "Field", value: "Rating" }],
                },
              ],
            },
            {
              layoutItems: [
                { placeholder: true, layoutComponents: [] },
                {
                  editableForNew: true,
                  editableForUpdate: true,
                  label: "Phone",
                  placeholder: false,
                  required: false,
                  layoutComponents: [
                    { type: "Field", value: "Phone" },
                    { type: "Separator" },
                  ],
                },
              ],
            },
          ],
        },
        { heading: "Empty", columns: 1, layoutRows: [{ layoutItems: [{ placeholder: true }] }] },
      ],
      detailLayoutSections: [],
    },
  ],
  recordTypeMappings: [
    { available: true, defaultRecordTypeMapping: true, layoutId: "00h000000000001", name: "Master", recordTypeId: "012000000000000AAA" },
    { available: false, defaultRecordTypeMapping: false, layoutId: "00h000000000009", name: "Hidden", recordTypeId: "012000000000009AAA" },
  ],
};

describe("parseLayouts", () => {
  it("names tabs by record type and groups fields by section", () => {
    const r = parseLayouts(FIXTURE);
    expect(r.layouts).toHaveLength(1);
    const [master] = r.layouts;
    expect(master.name).toBe("Master");
    expect(master.defaultLayout).toBe(true);
    expect(master.sections).toHaveLength(1);
    expect(master.sections[0].heading).toBe("Information");
    const flat = master.sections[0].rows.flat();
    expect(flat.map((f) => f.apiName)).toEqual(["Name", "Rating", "Phone"]);
    expect(flat[0]).toMatchObject({ label: "Account Name", required: true, layoutEditable: true });
    expect(flat[1]).toMatchObject({ layoutEditable: false });
  });

  it("tolerates garbage without throwing", () => {
    expect(parseLayouts(null)).toEqual({ layouts: [] });
    expect(parseLayouts({})).toEqual({ layouts: [] });
    expect(parseLayouts({ layouts: [{ id: "" }], recordTypeMappings: [{ layoutId: "x" }] })).toEqual({ layouts: [] });
  });
});

describe("fetchObjectLayouts", () => {
  it("hits the describe/layouts path with a versioned prefix", async () => {
    let seen = "";
    const r = await fetchObjectLayouts(async (path) => {
      seen = path;
      return FIXTURE;
    }, "62.0", "Account");
    expect(seen).toBe("/services/data/v62.0/sobjects/Account/describe/layouts");
    expect(r.layouts).toHaveLength(1);
  });
});
