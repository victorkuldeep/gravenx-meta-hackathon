import { describe, expect, it, vi } from "vitest";
import {
  apexLogListSoql,
  debugLevelListSoql,
  debugLevelPayload,
  defaultExpirationIso,
  guessTargetKind,
  isDeletableSobject,
  isToolingSobject,
  isWritableSobject,
  parseApexLogRows,
  parseDebugLevelRows,
  parseTraceFlagRows,
  parseTraceTargetRows,
  soqlEscape,
  TRACE_PRESETS,
  traceFlagListSoql,
  traceFlagPayload,
  traceTargetSearchSoql,
} from "./tooling";
import {
  createDebugLevel,
  deleteApexLog,
  getApexLogBody,
  getMyIdentity,
  listApexLogs,
  listOrgTraceFlags,
  resolveUserNames,
  searchTraceTargets,
  setTraceFlag,
} from "./capture";

const CONN = { instanceUrl: "https://x.salesforce.com", token: "tok", apiVersion: "v66.0" };

function stubFetch(responder: (path: string, payload: Record<string, unknown>) => unknown) {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return { ok: true, status: 200, json: async () => responder(String(input), payload) } as Response;
  });
}

describe("tooling allowlists", () => {
  it("writes only TraceFlag + DebugLevel", () => {
    expect(isToolingSobject("TraceFlag")).toBe(true);
    expect(isToolingSobject("ApexLog")).toBe(true);
    expect(isToolingSobject("Account")).toBe(false);
    expect(isWritableSobject("DebugLevel")).toBe(true);
    expect(isWritableSobject("ApexLog")).toBe(false);
    expect(isWritableSobject("User")).toBe(false);
  });

  it("deletes only ApexLog", () => {
    expect(isDeletableSobject("ApexLog")).toBe(true);
    expect(isDeletableSobject("TraceFlag")).toBe(false);
    expect(isDeletableSobject("Account")).toBe(false);
  });
});

describe("payload builders", () => {
  it("builds preset DebugLevel payloads", () => {
    const p = debugLevelPayload("GRAVENX_smart_x", "label", "smart");
    expect(p.ApexCode).toBe(TRACE_PRESETS.smart.ApexCode);
    expect(p.DeveloperName).toBe("GRAVENX_smart_x");
    const deep = debugLevelPayload("n", "l", "apex-deep");
    expect(deep.ApexCode).toBe("FINEST");
  });

  it("builds TraceFlag payloads with developer-log type", () => {
    const iso = defaultExpirationIso(0);
    const f = traceFlagPayload("005xx", "lvl", iso);
    expect(f).toEqual({ TracedEntityId: "005xx", DebugLevelId: "lvl", LogType: "DEVELOPER_LOG", ExpirationDate: iso });
    expect(new Date(iso).getTime()).toBe(30 * 60 * 1000);
  });

  it("bounds the log list query", () => {
    expect(apexLogListSoql(500)).toContain("LIMIT 100");
    expect(apexLogListSoql(0)).toContain("LIMIT 1");
    expect(apexLogListSoql(10)).toContain("LIMIT 10");
  });

  it("selects only describe-verified ApexLog columns", () => {
    // Live Tooling describe: Id, LogUserId, LogLength, LastModifiedDate,
    // Request, Operation, Application, Status, DurationMilliseconds,
    // SystemModstamp, StartTime, Location, RequestIdentifier. A bare
    // RequestId is NOT a column (a live 400 proved it) and must never
    // come back - RequestIdentifier is the legal one.
    const q = apexLogListSoql(10);
    for (const col of ["Application", "Request,", "RequestIdentifier", "StartTime", "LogUserId"]) {
      expect(q).toContain(col);
    }
    expect(q).not.toMatch(/RequestId(?!entifier)/);
  });

  it("drops malformed log rows, keeps valid ones", () => {
    expect(parseApexLogRows(null)).toEqual([]);
    expect(parseApexLogRows([{ Id: "07Lx" }, { nope: 1 }, { Id: 42 }])).toEqual([{ Id: "07Lx" }]);
  });

  it("builds safe target searches and shapes picker rows", () => {
    expect(soqlEscape("o'brien%")).toBe("o''brien\\%");
    const uq = traceTargetSearchSoql("user", "kul");
    expect(uq).toContain("FROM User");
    expect(uq).toContain("LIKE '%kul%'");
    const cq = traceTargetSearchSoql("class", "Order");
    expect(cq).toContain("FROM ApexClass");
    const tq = traceTargetSearchSoql("trigger", "Acc");
    expect(tq).toContain("FROM ApexTrigger");
    expect(
      parseTraceTargetRows("user", [
        { Id: "005x", Name: "Kuldeep", Username: "k@x.com" },
        { Id: 1, Name: "Bad" },
        null,
      ])
    ).toEqual([{ id: "005x", name: "Kuldeep", detail: "k@x.com" }]);
    expect(parseTraceTargetRows("class", [{ Id: "01px", Name: "Svc", NamespacePrefix: "ns" }])).toEqual([
      { id: "01px", name: "Svc", detail: "ns: ns" },
    ]);
  });

  it("parses org flag rows and resolves kinds", () => {
    expect(guessTargetKind("005xx")).toBe("user");
    expect(guessTargetKind("01px")).toBe("class");
    expect(guessTargetKind("01qx")).toBe("trigger");
    expect(guessTargetKind("001xx")).toBe("other");
    const rows = parseTraceFlagRows([{ Id: "f1", TracedEntityId: "005xx", DebugLevelId: "lvl", LogType: "DEVELOPER_LOG" }, { nope: 1 }]);
    expect(rows).toHaveLength(1);
    const names = parseDebugLevelRows([{ Id: "lvl", MasterLabel: "Smart" }]);
    expect(names.get("lvl")).toBe("Smart");
    expect(traceFlagListSoql()).toContain("FROM TraceFlag");
    expect(debugLevelListSoql()).toContain("FROM DebugLevel");
  });
});

describe("capture client", () => {
  it("lists logs through the proxy", async () => {
    const fetchImpl = stubFetch(() => ({ success: true, records: [{ Id: "07Lx", Operation: "/a" }], totalSize: 1 }));
    const rows = await listApexLogs(CONN, 5, fetchImpl);
    expect(rows).toEqual([{ Id: "07Lx", Operation: "/a" }]);
    const [path, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/salesforce/tooling-trace");
    expect(JSON.parse(String(init.body)).op).toBe("query");
  });

  it("reads a log body", async () => {
    const fetchImpl = stubFetch((path) => {
      expect(path).toBe("/api/salesforce/apex-log");
      return { success: true, body: "line1\nline2", truncated: false };
    });
    await expect(getApexLogBody(CONN, "07Lx00000000001", fetchImpl)).resolves.toEqual({ body: "line1\nline2", truncated: false });
  });

  it("creates level + flag, surfaces proxy errors", async () => {
    const fetchImpl = stubFetch((_path, payload) => {
      if (payload.sobject === "DebugLevel") return { success: true, id: "lvl1" };
      return { success: true, id: "flag1" };
    });
    await expect(createDebugLevel(CONN, "smart", fetchImpl)).resolves.toBe("lvl1");
    await expect(setTraceFlag(CONN, "005xx", "lvl1", undefined, fetchImpl)).resolves.toBe("flag1");
    const bad = stubFetch(() => ({ success: false, error: "DUPLICATE_VALUE" }));
    await expect(createDebugLevel(CONN, "smart", bad)).rejects.toThrow("DUPLICATE_VALUE");
  });

  it("searches targets through the tooling proxy", async () => {
    const fetchImpl = stubFetch((path, payload) => {
      expect(path).toBe("/api/salesforce/tooling-trace");
      expect((payload as { sobject?: string }).sobject).toBe("ApexClass");
      expect(String((payload as { soql?: string }).soql)).toContain("ApexClass");
      return { success: true, records: [{ Id: "01px", Name: "OrderService" }], totalSize: 1 };
    });
    await expect(searchTraceTargets(CONN, "class", "Order", fetchImpl)).resolves.toEqual([
      { id: "01px", name: "OrderService", detail: "01px" },
    ]);
    await expect(searchTraceTargets(CONN, "class", "   ", fetchImpl)).resolves.toEqual([]);
  });

  it("resolves user names in one bounded query", async () => {
    const fetchImpl = stubFetch((_path, payload) => {
      expect(String((payload as { soql?: string }).soql)).toContain("FROM User");
      return { success: true, records: [{ Id: "005aa0000000001A", Name: "Kuldeep" }], totalSize: 1 };
    });
    await expect(resolveUserNames(CONN, ["005aa0000000001A", "005aa0000000001A", "bad!!id", ""], fetchImpl)).resolves.toEqual({
      "005aa0000000001A": "Kuldeep",
    });
    await expect(resolveUserNames(CONN, [], fetchImpl)).resolves.toEqual({});
  });

  it("resolves the logged-in user and marks several own flags", async () => {
    const meFetch = stubFetch((path) => {
      expect(path).toBe("/api/salesforce/me");
      return { success: true, userId: "005aa0000000001A", username: "me@org.com", name: "Me" };
    });
    await expect(getMyIdentity(CONN, meFetch)).resolves.toEqual({ userId: "005aa0000000001A", username: "me@org.com", name: "Me" });
    const badFetch = stubFetch(() => ({ success: false, error: "nope" }));
    await expect(getMyIdentity(CONN, badFetch)).rejects.toThrow("nope");

    const flagsFetch = stubFetch((path, payload) => {
      if (String((payload as { sobject?: string }).sobject) === "DebugLevel") {
        return { success: true, records: [], totalSize: 0 };
      }
      return {
        success: true,
        records: [
          { Id: "mine1", TracedEntityId: "005u", DebugLevelId: "lvl1", ExpirationDate: new Date(Date.now() + 600000).toISOString() },
          { Id: "mine2", TracedEntityId: "005v", DebugLevelId: "lvl1", ExpirationDate: new Date(Date.now() + 600000).toISOString() },
          { Id: "theirs", TracedEntityId: "01px", DebugLevelId: "lvl1", ExpirationDate: new Date(Date.now() + 600000).toISOString() },
        ],
        totalSize: 3,
      };
    });
    const flags = await listOrgTraceFlags(CONN, ["mine1", "mine2"], flagsFetch);
    expect(flags.filter((f) => f.ours).map((f) => f.Id).sort()).toEqual(["mine1", "mine2"]);
  });

  it("deletes a log through the proxy with a strict id", async () => {
    const fetchImpl = stubFetch((_path, payload) => {
      expect((payload as { op?: string }).op).toBe("delete");
      expect((payload as { sobject?: string }).sobject).toBe("ApexLog");
      return { success: true };
    });
    await expect(deleteApexLog(CONN, "07Lx00000000001", fetchImpl)).resolves.toBeUndefined();
    await expect(deleteApexLog(CONN, "x", fetchImpl)).rejects.toThrow("Invalid ApexLog id");
  });

  it("merges org flags with level names and marks ours", async () => {
    const fetchImpl = stubFetch((path, payload) => {
      if (String((payload as { sobject?: string }).sobject) === "DebugLevel" && (payload as { op?: string }).op === "query") {
        return { success: true, records: [{ Id: "lvl1", MasterLabel: "Smart" }], totalSize: 1 };
      }
      return {
        success: true,
        records: [
          { Id: "mine", TracedEntityId: "005u", DebugLevelId: "lvl1", ExpirationDate: new Date(Date.now() + 600000).toISOString() },
          { Id: "theirs", TracedEntityId: "01px", DebugLevelId: "lvl9", ExpirationDate: new Date(Date.now() + 600000).toISOString() },
          { Id: "old", TracedEntityId: "005u", DebugLevelId: "lvl1", ExpirationDate: new Date(Date.now() - 7200000).toISOString() },
        ],
        totalSize: 3,
      };
    });
    const flags = await listOrgTraceFlags(CONN, "mine", fetchImpl);
    expect(flags.map((f) => f.Id)).toEqual(["mine", "theirs"]);
    expect(flags[0]).toMatchObject({ debugLevelName: "Smart", targetKind: "user", ours: true });
    expect(flags[1]).toMatchObject({ debugLevelName: "lvl9", targetKind: "class", ours: false });
  });
});
