import { describe, expect, it } from "vitest";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { docxBufferToNoteBody, docxImportEmpty } from "./docxImport";

async function toNodeBuffer(doc: Document): Promise<Buffer> {
  return Packer.toBuffer(doc);
}

function meetingDoc(): Document {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Steering notes")] }),
          new Paragraph({
            children: [new TextRun({ text: "Bold decision", bold: true }), new TextRun(" and plain follow-up")],
          }),
          new Paragraph({ bullet: { level: 0 }, children: [new TextRun("first item")] }),
          new Paragraph({ bullet: { level: 0 }, children: [new TextRun("second item")] }),
        ],
      },
    ],
  });
}

describe("docx import", () => {
  it("turns headings, marks and bullets into an editable note", async () => {
    const imp = await docxBufferToNoteBody(await toNodeBuffer(meetingDoc()), "Steering.docx");
    expect(imp.title).toBe("Steering");
    expect(imp.body.format).toBe("rich");
    expect(imp.body.html).toContain("<h1>Steering notes</h1>");
    expect(imp.body.html).toContain("<strong>Bold decision</strong>");
    expect(imp.body.html).toContain("<ul>");
    expect(imp.body.md).toContain("Steering notes");
    expect(imp.body.md).toContain("- first item");
    expect(docxImportEmpty(imp)).toBe(false);
  });

  it("falls back to a default title and reports empty documents", async () => {
    const empty = new Document({ sections: [{ children: [new Paragraph({})] }] });
    const imp = await docxBufferToNoteBody(await toNodeBuffer(empty), "   .docx");
    expect(imp.title).toBe("Imported note");
    expect(docxImportEmpty(imp)).toBe(true);
  });

  it("rejects non-docx buffers", async () => {
    await expect(docxBufferToNoteBody(new ArrayBuffer(8), "x.docx")).rejects.toThrow();
  });
});
