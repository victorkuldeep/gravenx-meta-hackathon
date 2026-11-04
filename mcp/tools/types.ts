import type { z } from "zod";

/**
 * One MCP tool: zod input shape (v3 raw shape) plus a workspace-backed
 * handler. Handlers never throw raw - they return { ok: false, error } so
 * agents get actionable text instead of a transport error.
 */
export interface ToolResult {
  ok: boolean;
  file?: string;
  summary: string;
  error?: string;
  data?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  shape: Record<string, z.ZodTypeAny>;
  run: (dir: string, args: Record<string, unknown>) => Promise<ToolResult>;
}
