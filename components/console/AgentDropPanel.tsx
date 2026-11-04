"use client";

import { useState } from "react";
import type { ConsoleAttachment, ConsoleTask } from "@/lib/console/model";
import {
  AGENT_DROP_DIR,
  AGENT_DROP_MEDIA_DIR,
  agentTaskFilename,
  buildAgentDrop,
  buildAgentPrompt,
} from "@/lib/pmo/agentDrop";

/**
 * Send-to-agent: drops TASK-CX-XXXX.md (+ media/) into the repo folder where
 * the architect's coding agent runs, and copies a paste-ready prompt.
 * File System Access picker first (Chromium), ZIP download fallback
 * (Firefox/Safari), single-file download last resort.
 */

interface FsWritable {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  createWritable(): Promise<FsWritable>;
}
interface FsDirHandle {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
}

function picker(): ((opts?: { mode?: string }) => Promise<FsDirHandle>) | undefined {
  const w = window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FsDirHandle> };
  return w.showDirectoryPicker;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function AgentDropPanel({ task, attachments }: { task: ConsoleTask; attachments: ConsoleAttachment[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const copyPrompt = async () => {
    const prompt = buildAgentPrompt(task);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setPromptCopied(true);
    setStatus("Prompt copied - paste it into your agent chat after the files land.");
    setTimeout(() => setPromptCopied(false), 4000);
  };

  const saveZip = async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const f of buildAgentDrop(task, attachments.map((a) => a.name))) zip.file(f.path, f.text);
    for (const a of attachments) {
      try {
        zip.file(`${AGENT_DROP_MEDIA_DIR}/${a.name}`, await dataUrlToBlob(a.dataUrl));
      } catch {
        /* one bad shot must not sink the package */
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `console-${agentTaskFilename(task).replace(/\.md$/, "")}-agent-drop.zip`);
    setStatus("Downloaded a ZIP - unzip it at your repo root, then paste the prompt.");
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const showPicker = picker();
      if (!showPicker) {
        await saveZip();
        return;
      }
      const root = await showPicker({ mode: "readwrite" });
      const dir = await root.getDirectoryHandle(AGENT_DROP_DIR, { create: true });
      for (const f of buildAgentDrop(task, attachments.map((a) => a.name))) {
        const handle = await dir.getFileHandle(f.path.split("/").pop() ?? "TASK.md", { create: true });
        const w = await handle.createWritable();
        await w.write(f.text);
        await w.close();
      }
      if (attachments.length > 0) {
        const media = await dir.getDirectoryHandle("media", { create: true });
        for (const a of attachments) {
          try {
            const blob = await dataUrlToBlob(a.dataUrl);
            const handle = await media.getFileHandle(a.name, { create: true });
            const w = await handle.createWritable();
            await w.write(blob);
            await w.close();
          } catch {
            /* one bad shot must not sink the package */
          }
        }
      }
      setStatus(`Saved to ${AGENT_DROP_DIR}/${agentTaskFilename(task)} in the picked folder - now copy the prompt.`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setStatus("Folder pick cancelled - nothing written.");
      else {
        try {
          await saveZip();
        } catch {
          setStatus("Could not write the drop - try again or copy the prompt only.");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] p-2.5">
      <p className="text-[12px] leading-relaxed text-[#777168]">
        Drops <span className="font-mono text-[11px] text-[#3A352D]">{agentTaskFilename(task)}</span>
        {attachments.length > 0 ? ` + ${attachments.length} screenshot${attachments.length === 1 ? "" : "s"}` : ""} into
        your agent&apos;s working folder. Pick the repo root where Cursor / Claude Code / Codex / Muse Code runs.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="cursor-pointer rounded-lg bg-[#27241F] px-2.5 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D] disabled:cursor-default disabled:opacity-40"
        >
          {busy ? "Writing…" : "Save to agent folder"}
        </button>
        <button
          type="button"
          onClick={() => void copyPrompt()}
          className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#27241F] hover:border-[#C9A86A]"
        >
          {promptCopied ? "Copied ✓" : "Copy agent prompt"}
        </button>
      </div>
      {status && <p className="mt-1.5 text-[12px] text-[#777168]">{status}</p>}
    </div>
  );
}
