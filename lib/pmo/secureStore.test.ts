import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string };
type RowTable = Map<string, Row>;
const mem: Map<string, RowTable> = vi.hoisted(() => new Map());

vi.mock("@/lib/db", () => ({
  STORES: { pmoCredentials: "pmo-credentials" },
  withStore: async (store: string, _mode: string, fn: (s: unknown) => { result: unknown }) => {
    let table = mem.get(store);
    if (!table) {
      table = new Map();
      mem.set(store, table);
    }
    const fake = {
      put: (row: Row) => {
        (table as RowTable).set(row.id, row);
        return { result: undefined };
      },
      getAll: () => ({ result: [...(table as RowTable).values()] }),
      delete: (id: string) => {
        (table as RowTable).delete(id);
        return { result: undefined };
      },
    };
    // Resolve like the real withStore: put/delete -> undefined, getAll -> array.
    const req = fn(fake) as { result: unknown };
    const r = req.result;
    if (r != null && typeof r !== "string" && typeof (r as Iterable<unknown>)[Symbol.iterator] === "function") {
      return [...(r as Iterable<unknown>)];
    }
    return r;
  },
}));

import { forgetPmoSecret, isPmoUnlocked, listPmoSaved, lockPmo, revealPmoSecret, savePmoSecret, unlockPmo } from "./secureStore";

describe("encrypted PMO store", () => {
  beforeEach(() => {
    mem.clear();
    lockPmo();
  });

  it("round-trips a secret and stays opaque at rest", async () => {
    await unlockPmo("correct horse");
    expect(isPmoUnlocked()).toBe(true);
    await savePmoSecret("jira", "acme.atlassian.net", "me@acme.com", "dummy-test-token");
    const rows = await listPmoSaved();
    expect(rows).toHaveLength(1);
    expect(rows[0].login).toBe("me@acme.com");
    expect(rows[0].cipher).not.toContain("dummy-test-token");
    expect(await revealPmoSecret("jira")).toBe("dummy-test-token");
  });

  it("locks out reveals and rejects a wrong passphrase", async () => {
    await unlockPmo("right");
    await savePmoSecret("snow", "acme.service-now.com", "admin", "pw");
    lockPmo();
    expect(isPmoUnlocked()).toBe(false);
    await expect(revealPmoSecret("snow")).rejects.toThrow(/Locked/);
    await unlockPmo("wrong");
    await expect(revealPmoSecret("snow")).rejects.toThrow(/Wrong passphrase/);
    await unlockPmo("right");
    expect(await revealPmoSecret("snow")).toBe("pw");
  });

  it("forgets per system", async () => {
    await unlockPmo("p");
    await savePmoSecret("jira", "s", "u", "t");
    await forgetPmoSecret("jira");
    expect(await listPmoSaved()).toHaveLength(0);
  });

  it("refuses to save while locked", async () => {
    await expect(savePmoSecret("jira", "s", "u", "t")).rejects.toThrow(/Unlock first/);
  });
});
