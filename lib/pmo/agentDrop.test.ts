import { describe, expect, it } from "vitest";
import type { ConsoleTask } from "@/lib/console/model";
import { newConsoleTask } from "@/lib/console/model";
import {
  AGENT_DROP_DIR,
  agentTaskFilename,
  buildAgentDrop,
  buildAgentPrompt,
  buildAgentTaskMd,
} from "./agentDrop";

function task(over: Partial<ConsoleTask> = {}): ConsoleTask {
  return {
    ...newConsoleTask("Wire retry policy", 1000),
    body: "## Goal\n\nRetry thrice.\n\n- [ ] attempt\n- [ ] backoff",
    links: [{ surface: "system", recordId: "p1", label: "Middleware" }],
    notes: [{ id: "n1", at: 2000, text: "Ask ZSP team." }],
    history: [
      { at: 1000, what: "Logged in Console." },
      { at: 3000, what: "Moved open → in-progress." },
    ],
    ...over,
  };
}

describe("agent drop", () => {
  it("names the file after the stable task key", () => {
    const t = task();
    expect(agentTaskFilename(t)).toMatch(/^TASK-CX-[0-9A-Z]{1,4}\.md$/);
  });

  it("packs goal, links, notes, shots and activity into one markdown file", () => {
    const md = buildAgentTaskMd(task(), ["shot.png"]);
    expect(md).toContain("# Wire retry policy");
    expect(md).toContain("CX-");
    expect(md).toContain("Retry thrice");
    expect(md).toContain("**system** · Middleware");
    expect(md).toContain("Ask ZSP team.");
    expect(md).toContain("gravenx/media/shot.png");
    expect(md).toContain("Moved open → in-progress.");
  });

  it("says so when the description is empty instead of shipping a blank goal", () => {
    const md = buildAgentTaskMd(task({ body: undefined }));
    expect(md).toContain("clarify with the architect");
  });

  it("builds the drop as a single repo-relative path", () => {
    const files = buildAgentDrop(task());
    expect(files).toHaveLength(1);
    expect(files[0].path.startsWith(`${AGENT_DROP_DIR}/TASK-CX-`)).toBe(true);
  });

  it("points the paste-prompt at the dropped file", () => {
    const t = task();
    const prompt = buildAgentPrompt(t);
    expect(prompt).toContain(`./${AGENT_DROP_DIR}/${agentTaskFilename(t)}`);
    expect(prompt).toContain("report files changed");
  });
});
