import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Live MCP smoke: boots the real stdio server, runs initialize ->
 * tools/list -> tools/call(sequence_parse), then exits. This proves the
 * transport, the SDK wiring and one end-to-end tool - not just the
 * handler functions (those have their own suite in tools.test.ts).
 */

async function rpc(
  proc: ChildProcess,
  id: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 25000);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const text = line.trim();
        if (!text || !text.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(text) as { id?: number; result?: unknown; error?: unknown };
          if (parsed.id === id) {
            clearTimeout(timer);
            proc.stdout?.off("data", onData);
            if (parsed.error) reject(new Error(JSON.stringify(parsed.error)));
            else resolve(parsed.result);
          }
        } catch {
          /* server log line - ignore */
        }
      }
    };
    proc.stdout?.on("data", onData);
    proc.stdin?.write(`${msg}\n`);
  });
}

describe("mcp stdio smoke", () => {
  it("serves tools over JSON-RPC", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gravenx-mcp-smoke-"));
    const proc = spawn(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"],
      { cwd: process.cwd(), env: { ...process.env, GRAVENX_WORKSPACE: dir } },
    );
    try {
      const init = (await rpc(proc, 1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      })) as { serverInfo?: { name?: string } };
      expect(init.serverInfo?.name).toBe("gravenx");

      // Initialized is a notification: no id, no response.
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

      const listed = (await rpc(proc, 3, "tools/list")) as { tools?: { name: string }[] };
      const names = (listed.tools ?? []).map((t) => t.name);
      for (const need of ["sequence_create", "wireframe_add_component", "system_create_sample", "erd_share_canvas", "decision_create", "console_create_task"]) {
        expect(names).toContain(need);
      }

      const called = (await rpc(proc, 4, "tools/call", {
        name: "sequence_parse",
        arguments: { dsl: "A -> B: Hello" },
      })) as { content?: { text?: string }[]; isError?: boolean };
      expect(called.isError ?? false).toBe(false);
      const payload = JSON.parse(called.content?.[0]?.text ?? "{}") as { ok?: boolean };
      expect(payload.ok).toBe(true);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (!proc.killed) proc.kill("SIGKILL");
    }
  }, 60000);
});
