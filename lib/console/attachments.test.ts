import { describe, expect, it } from "vitest";
import { newConsoleTask } from "./model";
import { checkAttachmentFile, consoleAttachmentSchema, needsDownscale } from "./attachments";
import { exportConsoleTasks, importConsoleTasks } from "./store";

describe("console attachments", () => {
  it("gates the picker: images only, 3 MB cap", () => {
    expect(checkAttachmentFile({ name: "shot.png", type: "image/png", size: 1024 }).ok).toBe(true);
    expect(checkAttachmentFile({ name: "doc.pdf", type: "application/pdf", size: 1024 }).ok).toBe(false);
    expect(checkAttachmentFile({ name: "big.png", type: "image/png", size: 4 * 1024 * 1024 }).ok).toBe(false);
    expect(checkAttachmentFile({ name: "empty.png", type: "image/png", size: 0 }).ok).toBe(false);
  });

  it("flags oversized files for a downscale pass", () => {
    expect(needsDownscale({ name: "shot.png", type: "image/png", size: 1024 })).toBe(false);
    expect(needsDownscale({ name: "huge.png", type: "image/png", size: 5 * 1024 * 1024 })).toBe(true);
  });

  it("validates attachment records", () => {
    const good = {
      id: "att_1",
      taskId: "task_1",
      name: "shot.png",
      mime: "image/png",
      size: 10,
      dataUrl: "data:image/png;base64,AAA",
      at: 5,
    };
    expect(consoleAttachmentSchema.safeParse(good).success).toBe(true);
    expect(consoleAttachmentSchema.safeParse({ ...good, mime: "" }).success).toBe(false);
  });

  it("round-trips tasks with screenshots and remaps ids on import", () => {
    const task = newConsoleTask("Wire the hub", 1000);
    const att = {
      id: "att_old",
      taskId: task.id,
      name: "erd.png",
      mime: "image/png",
      size: 10,
      dataUrl: "data:image/png;base64,AAA",
      at: 1001,
    };
    const pkg = exportConsoleTasks([task], [att]);
    const { tasks, attachments, error } = importConsoleTasks(pkg, 2000);
    expect(error).toBeUndefined();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).not.toBe(task.id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].taskId).toBe(tasks[0].id);
    expect(attachments[0].id).not.toBe("att_old");
  });

  it("still imports v1 packages without attachments", () => {
    const task = newConsoleTask("Legacy", 1000);
    const v1 = JSON.stringify({ version: 1, type: "gravenx-console-package", tasks: [task] });
    const { tasks, attachments, error } = importConsoleTasks(v1, 2000);
    expect(error).toBeUndefined();
    expect(tasks).toHaveLength(1);
    expect(attachments).toHaveLength(0);
  });

  it("drops orphan attachments pointing at unknown tasks", () => {
    const task = newConsoleTask("Kept", 1000);
    const pkg = JSON.stringify({
      version: 2,
      type: "gravenx-console-package",
      tasks: [task],
      attachments: [
        { id: "a1", taskId: task.id, name: "ok.png", mime: "image/png", size: 1, dataUrl: "data:x", at: 1 },
        { id: "a2", taskId: "task_gone", name: "orphan.png", mime: "image/png", size: 1, dataUrl: "data:x", at: 1 },
      ],
    });
    const { attachments } = importConsoleTasks(pkg, 2000);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe("ok.png");
  });
});
