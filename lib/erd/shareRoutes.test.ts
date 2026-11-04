"use client";

import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/share/route";
import { GET } from "@/app/api/share/[id]/route";

const shape = () => ({
  v: 1,
  name: "Lead canvas",
  root: "Lead",
  nodes: ["Lead", "Account"],
  positions: { Lead: { x: 0, y: 0 }, Account: { x: 400, y: 0 } },
  view: "erd",
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );

describe("share api routes", () => {
  it("round-trips publish then fetch", async () => {
    const created = await post(shape());
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect(typeof id).toBe("string");

    const fetched = await GET(new Request(`http://localhost/api/share/${id}`), {
      params: Promise.resolve({ id }),
    } as never);
    expect(fetched.status).toBe(200);
    const payload = (await fetched.json()) as { root: string; nodes: string[] };
    expect(payload.root).toBe("Lead");
    expect(payload.nodes).toEqual(["Lead", "Account"]);
  });

  it("rejects invalid bodies and unknown ids", async () => {
    const bad = await post({ v: 99, root: "", nodes: [] });
    expect(bad.status).toBe(400);
    const missing = await GET(new Request("http://localhost/api/share/nope-not-real-id-1234567890ab"), {
      params: Promise.resolve({ id: "nope-not-real-id-1234567890ab" }),
    } as never);
    expect(missing.status).toBe(404);
  });
});
