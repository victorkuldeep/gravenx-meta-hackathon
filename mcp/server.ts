#!/usr/bin/env tsx
/**
 * gravenx-mcp: headless GRAVENX over MCP (stdio).
 *
 * Terminal agents (Cursor, Claude Code, Muse, Codex, OpenCode) connect to
 * this server and operate the studio's domain models through files:
 * sequences, wireframe experiences, system projects, ERD canvases,
 * decisions, requirements and console tasks. The studio Import buttons open
 * every file this server writes - the file workspace is the contract.
 *
 * Nothing here touches the network except erd_share_canvas (explicit,
 * opt-in, posts a structure to YOUR running studio). No tokens, no org
 * calls, no secrets in files - ever.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveWorkspace } from "./workspace";
import { sequenceTools } from "./tools/sequence";
import { builderTools } from "./tools/builder";
import { postmanTools } from "./tools/postman";
import { skillTools } from "./tools/skills";
import { contractTools } from "./tools/contracts";
import { noteTools } from "./tools/notes";
import { mappingTools } from "./tools/mapping";
import { wireframeTools } from "./tools/wireframe";
import { systemTools } from "./tools/system";
import { erdTools } from "./tools/erd";
import { governanceTools } from "./tools/governance";
import { BridgeHub } from "./bridge/hub.js";
import { liveTools } from "./bridge/tools.js";
import type { McpTool } from "./tools/types";

const VERSION = "1.0.0";

const ALL_TOOLS: McpTool[] = [
  ...sequenceTools,
  ...builderTools,
  ...postmanTools,
  ...skillTools,
  ...contractTools,
  ...noteTools,
  ...mappingTools,
  ...wireframeTools,
  ...systemTools,
  ...erdTools,
  ...governanceTools,
];

async function main(): Promise<void> {
  const dir = resolveWorkspace();
  const server = new McpServer({ name: "gravenx", version: VERSION });

  // Agent bridge: localhost WS hub for the live tab. Always on - costs
  // nothing until a tab pairs; live tools fail clearly without one.
  const hub = new BridgeHub();
  const bridgePort = Number(process.env.GRAVENX_BRIDGE_PORT ?? 49321);
  hub.listen(Number.isFinite(bridgePort) ? bridgePort : 49321);
  for (const tool of liveTools(hub)) {
    ALL_TOOLS.push(tool);
  }
  console.error(
    `[gravenx-mcp] agent bridge on 127.0.0.1:${hub.port} - pairing code ${hub.code} (show it to the architect; they enter it in Setup > Terminal Bridge)`
  );
  console.error(
    `[gravenx-mcp] one-click pair: open <your-studio-URL>/setup?bridge=${hub.code}&port=${hub.port} (or Setup > Terminal Bridge > Find local hub)`
  );

  for (const tool of ALL_TOOLS) {
    server.tool(tool.name, tool.description, tool.shape, async (args) => {
      try {
        const result = await tool.run(dir, args as Record<string, unknown>);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          isError: result.ok ? false : true,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Tool failed.";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, summary: "Tool failed.", error: message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`[gravenx-mcp] fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
