// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST as mine } from "../../app/api/webhooks/mine/route";
import { POST as register } from "../../app/api/webhooks/register/route";
import { POST as activate } from "../../app/api/webhooks/activate/route";
import { POST as uuidOp } from "../../app/api/webhooks/[id]/[...rest]/route";
import { POST as uuidRoot } from "../../app/api/webhooks/[id]/route";

const SESSION = { token: "dev-token", instanceUrl: "https://dev.test" };

function req(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://local.test/api/webhooks/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

function ctx(id: string, rest: string[]) {
  return { params: Promise.resolve({ id, rest }) };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ organization_id: "org-dev", user_id: "user-dev" }),
    }))
  );
});

/** User flow: register -> listed -> pause/resume -> open inbox -> deregister wipes all. */
describe("localhost webhook flow (dev mesh)", () => {
  it("registers, lists, toggles, captures, and deregisters cleanly", async () => {
    const reg = await register(req({ ...SESSION, name: "order-events", note: "pilot drops" }));
    expect(reg.status).toBe(200);
    const { uuid } = (await reg.json()) as { uuid: string };
    expect(uuid).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

    const listed = (await (await mine(req(SESSION))).json()) as {
      entries: { uuid: string; active: boolean; note: string }[];
    };
    expect(listed.entries.map((e) => e.uuid)).toContain(uuid);
    expect(listed.entries.find((e) => e.uuid === uuid)?.note).toBe("pilot drops");

    // Pause then resume through activate.
    const paused = (await (await activate(req({ ...SESSION, uuids: [{ uuid, active: false }] }))).json()) as {
      entries: { uuid: string; active: boolean }[];
    };
    expect(paused.entries.find((e) => e.uuid === uuid)?.active).toBe(false);
    // A paused inbox stops capturing.
    const blocked = await uuidOp(req({ hello: "paused" }), ctx(uuid, ["sf"]));
    expect(blocked.status).toBe(404);
    const resumed = (await (await activate(req({ ...SESSION, uuids: [{ uuid, active: true }] }))).json()) as {
      entries: { uuid: string; active: boolean }[];
    };
    expect(resumed.entries.find((e) => e.uuid === uuid)?.active).toBe(true);

    // Reshape the reply later: echo the sender's correlation id with a 201.
    const shaped = await uuidOp(
      req({
        ...SESSION,
        config: {
          status: 201,
          headers: { "X-Correlation-ID": "{{headers.x-correlation-id}}" },
          body: '{"id":"{{reqId}}","correlationId":"{{headers.x-correlation-id}}"}',
        },
      }),
      ctx(uuid, ["response"])
    );
    expect(shaped.status).toBe(200);
    const custom = await uuidOp(req({ hello: "dev" }, { "x-correlation-id": "c-9" }), ctx(uuid, ["sf"]));
    expect(custom.status).toBe(201);
    expect(custom.headers.get("x-correlation-id")).toBe("c-9");
    expect((await custom.json()) as { correlationId: string }).toMatchObject({ correlationId: "c-9" });

    // Inbox: capture on a sub-path, then read it back through the owner feed.
    const cap = await uuidOp(req({ hello: "dev" }), ctx(uuid, ["sf", "order"]));
    expect(cap.status).toBe(201);
    const feed = (await (await uuidOp(req(SESSION), ctx(uuid, ["feed"]))).json()) as {
      ok: boolean;
      requests: { path: string; bodyText: string }[];
    };
    expect(feed.ok).toBe(true);
    expect(feed.requests).toHaveLength(2);
    expect(feed.requests.map((r) => r.path).sort()).toEqual(["/sf", "/sf/order"]);

    // Deregister: release wipes events and the registry entry.
    const rel = await uuidOp(req(SESSION), ctx(uuid, ["release"]));
    expect(rel.status).toBe(200);
    const after = (await (await mine(req(SESSION))).json()) as { entries: unknown[] };
    expect(after.entries).toHaveLength(0);
    const gone = await uuidRoot(req({}), { params: Promise.resolve({ id: uuid }) });
    expect(gone.status).toBe(404);
  });
});
