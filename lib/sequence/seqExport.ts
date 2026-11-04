/**
 * Sequence PNG filenames (EPIC 06). Capture itself needs no frame math -
 * the diagram is a single SVG, so html-to-image shoots it at natural size
 * times the pixel ratio, exactly like the System snapshot buttons.
 */

export function seqPngFileName(docName: string, scale: 2 | 3): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const slug = docName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "").slice(0, 60) || "sequence";
  return `${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}@${scale}x.png`;
}
