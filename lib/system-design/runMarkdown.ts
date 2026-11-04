"use client";

/**
 * Run Markdown: full-run evidence as a portable .md file. Renders the
 * topology path, per-hop request/response bodies, timings, and verdicts.
 * Callers scrub vault secrets before rendering - bodies here are literals.
 */

export interface RunMarkdownHop {
  label: string;
  status: "ok" | "failed" | "skipped";
  durationMs: number;
  endpoint: string;
  requestBody: string;
  responseBody: string;
  note: string;
}

export interface RunMarkdownLane {
  path: string[];
  hops: RunMarkdownHop[];
  stopped: string | null;
}

export interface RunMarkdownInput {
  title: string;
  projectName: string;
  environmentName: string;
  startedAt: number;
  seedBody: string;
  lanes: RunMarkdownLane[];
}

const fence = (body: string): string =>
  body.trim() ? ["```json", body.trim(), "```"].join("\n") : "_empty_";

export function renderRunMarkdown(input: RunMarkdownInput): string {
  const lines: string[] = [];
  const ok = input.lanes.flatMap((l) => l.hops).filter((h) => h.status === "ok").length;
  const total = input.lanes.flatMap((l) => l.hops).length;
  const failed = input.lanes.flatMap((l) => l.hops).filter((h) => h.status === "failed").length;
  const ms = input.lanes.flatMap((l) => l.hops).reduce((n, h) => n + h.durationMs, 0);
  lines.push(`# ${input.title}`);
  lines.push("");
  lines.push(`- Project: ${input.projectName}`);
  lines.push(`- Environment: ${input.environmentName}`);
  lines.push(`- Started: ${new Date(input.startedAt).toISOString()}`);
  lines.push(`- Verdict: ${total > 0 && failed === 0 ? "PASS" : "FAIL"} (${ok}/${total} steps ok, ${ms}ms)`);
  lines.push("");
  lines.push("## Seed");
  lines.push("");
  lines.push(fence(input.seedBody));
  lines.push("");
  input.lanes.forEach((lane, i) => {
    lines.push(`## Lane ${i + 1}: ${lane.path.join(" → ")}`);
    lines.push("");
    if (lane.stopped) {
      lines.push(`> Stopped: ${lane.stopped}`);
      lines.push("");
    }
    if (lane.hops.length === 0) {
      lines.push("_No hops executed._");
      lines.push("");
      return;
    }
    lane.hops.forEach((h) => {
      const mark = h.status === "ok" ? "✓" : h.status === "skipped" ? "○" : "✗";
      lines.push(`### ${mark} ${h.label}`);
      lines.push("");
      if (h.endpoint) lines.push(`- Endpoint: \`${h.endpoint}\``);
      if (h.durationMs > 0) lines.push(`- Duration: ${h.durationMs}ms`);
      if (h.note) lines.push(`- Note: ${h.note}`);
      if (h.endpoint || h.durationMs > 0 || h.note) lines.push("");
      lines.push("Request:");
      lines.push("");
      lines.push(fence(h.requestBody));
      lines.push("");
      lines.push("Response:");
      lines.push("");
      lines.push(fence(h.responseBody));
      lines.push("");
    });
  });
  return lines.join("\n");
}

/** Download helper matching the design-notes Markdown pattern. */
export function downloadRunMarkdown(markdown: string, fileName: string): void {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
