import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newConsoleTask, type ConsoleAttachment, type ConsoleTask } from "@/lib/console/model";
import { clearPmoConnection, setPmoConnection } from "@/lib/pmo/jiraVault";
import { clearSnowConnection, setSnowConnection } from "@/lib/pmo/snowVault";
import { PMO_TOOLS, setPmoBackend } from "./toolsPmo";

let tasks: ConsoleTask[];
let shots: ConsoleAttachment[];
let fetchCalls: { url: string; action: string | null }[];

const META = {
  projects: [
    {
      key: "ACME",
      name: "Acme",
      issuetypes: [
        { id: "10001", name: "Story", subtask: false },
        { id: "10002", name: "Bug", subtask: false },
      ],
    },
  ],
};

function mockFetch() {
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      if (u.startsWith("data:")) return new Response("shotbytes");
      let action: string | null = null;
      const body = (init as { body?: unknown } | undefined)?.body;
      if (typeof body === "string") {
        try {
          action = (JSON.parse(body) as { action?: string }).action ?? null;
        } catch {
          action = null;
        }
      } else if (body instanceof FormData) {
        action = String(body.get("action") ?? null);
      }
      fetchCalls.push({ url: u, action });
      if (u === "/api/pmo/snow") {
        if (action === "probe") return Response.json({ ok: true, table: "incident", sampleFields: ["number", "short_description"] });
        if (action === "create")
          return Response.json({ ok: true, number: "INC0010007", url: "https://acme.service-now.com/nav_to.do?uri=incident.do?sys_id=abc" });
        return Response.json({ ok: false, error: "Unexpected action." }, { status: 400 });
      }
      if (action === "createmeta") return Response.json({ ok: true, meta: META });
      if (action === "create")
        return Response.json({ ok: true, key: "ACME-7", url: "https://acme.atlassian.net/browse/ACME-7" });
      if (action === "attach") return Response.json({ ok: true });
      return Response.json({ ok: false, error: "Unexpected action." }, { status: 400 });
    },
  );
}

function seed(withShot: boolean) {
  tasks = [{ ...newConsoleTask("Wire retry policy", 100), body: "Retry **thrice**." }];
  shots = withShot
    ? [
        {
          id: "att_1",
          taskId: tasks[0].id,
          name: "shot.png",
          mime: "image/png",
          size: 100,
          dataUrl: "data:image/png;base64,AAA",
          at: 200,
        },
      ]
    : [];
  setPmoBackend({
    listTasks: async () => [...tasks],
    saveTask: async (t) => {
      tasks = tasks.map((x) => (x.id === t.id ? t : x));
    },
    listShots: async (taskId) => shots.filter((s) => s.taskId === taskId),
  });
}

function tool(name: string) {
  return PMO_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

function connect(defaults = true) {
  setPmoConnection({
    site: "acme.atlassian.net",
    email: "arch@acme.test",
    token: "tok",
    ...(defaults ? { projectKey: "ACME", issueTypeId: "10001" } : {}),
  });
}

function connectSnow() {
  setSnowConnection({ instance: "acme.service-now.com", user: "arch", pass: "pw", table: "incident" });
}

beforeEach(() => {
  sessionStorage.clear();
  clearPmoConnection();
  clearSnowConnection();
  mockFetch();
});

afterEach(() => {
  setPmoBackend(null);
  vi.unstubAllGlobals();
});

describe("pmo tool set", () => {
  it("registers jira + snow tools, pushes approval-gated", () => {
    expect(PMO_TOOLS.map((t) => t.name)).toEqual([
      "jira_status",
      "jira_projects",
      "jira_push",
      "snow_status",
      "snow_probe",
      "snow_push",
    ]);
    expect(tool("jira_status").needsApproval).toBe(false);
    expect(tool("jira_projects").needsApproval).toBe(false);
    expect(tool("jira_push").needsApproval).toBe(true);
    expect(tool("snow_status").needsApproval).toBe(false);
    expect(tool("snow_probe").needsApproval).toBe(false);
    expect(tool("snow_push").needsApproval).toBe(true);
  });

  it("status is honest about disconnected vs connected", async () => {
    seed(false);
    const off = await run("jira_status");
    expect(off.ok).toBe(true);
    expect(off.result).toMatchObject({ connected: false });
    connect();
    const on = await run("jira_status");
    expect(on.result).toMatchObject({
      connected: true,
      site: "https://acme.atlassian.net",
      defaultProject: "ACME",
    });
  });

  it("lists live projects, refuses without a connection", async () => {
    seed(false);
    expect((await run("jira_projects")).ok).toBe(false);
    connect();
    const r = await run("jira_projects");
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ projects: [{ key: "ACME", name: "Acme", issueTypes: ["Story", "Bug"] }] });
  });

  it("pushes the task, attaches shots, stores the backlink", async () => {
    seed(true);
    connect();
    const r = await run("jira_push", { task: "retry policy" });
    expect(r.ok).toBe(true);
    expect(String(r.result)).toContain("ACME-7");
    expect(String(r.result)).toContain("https://acme.atlassian.net/browse/ACME-7");
    expect(fetchCalls.filter((c) => c.action === "attach")).toHaveLength(1);
    expect(tasks[0].pmo).toMatchObject({ system: "jira", key: "ACME-7" });
    expect(tasks[0].history.at(-1)?.what).toContain("ACME-7");
  });

  it("rejects unknown destinations with the valid list, not a 400", async () => {
    seed(false);
    connect();
    const r = await run("jira_push", { task: "retry policy", projectKey: "NOPE", issueTypeId: "1" });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("ACME");
  });

  it("demands a destination when none is saved", async () => {
    seed(false);
    connect(false);
    const r = await run("jira_push", { task: "retry policy" });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("jira_projects");
  });

  it("answers honestly on misses and ambiguity", async () => {
    tasks = [newConsoleTask("Retry one", 1), newConsoleTask("Retry two", 2)];
    setPmoBackend({
      listTasks: async () => [...tasks],
      saveTask: async () => {},
      listShots: async () => [],
    });
    connect();
    expect((await run("jira_push", { task: "nope" })).ok).toBe(false);
    const amb = await run("jira_push", { task: "retry" });
    expect(amb.ok).toBe(false);
    expect(String(amb.error)).toContain("Ambiguous");
  });

  it("never pushes without a connection", async () => {
    seed(false);
    const r = await run("jira_push", { task: "retry policy" });
    expect(r.ok).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it("snow status is honest, probe samples fields, push stores the record number", async () => {
    seed(false);
    expect((await run("snow_status")).result).toMatchObject({ connected: false });
    expect((await run("snow_probe")).ok).toBe(false);
    connectSnow();
    expect((await run("snow_status")).result).toMatchObject({
      connected: true,
      instance: "https://acme.service-now.com",
      table: "incident",
    });
    const probed = await run("snow_probe", { table: "incident" });
    expect(probed.ok).toBe(true);
    expect(probed.result).toMatchObject({ table: "incident", sampleFields: ["number", "short_description"] });
    const pushed = await run("snow_push", { task: "retry policy" });
    expect(pushed.ok).toBe(true);
    expect(String(pushed.result)).toContain("INC0010007");
    expect(tasks[0].pmo).toMatchObject({ system: "snow", key: "INC0010007" });
    expect(tasks[0].history.at(-1)?.what).toContain("INC0010007");
  });

  it("snow refuses bad tables and missing tasks without touching the network", async () => {
    seed(false);
    connectSnow();
    const bad = await run("snow_push", { task: "retry policy", table: "incident; DROP" });
    expect(bad.ok).toBe(false);
    const miss = await run("snow_push", { task: "nope" });
    expect(miss.ok).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });
});
