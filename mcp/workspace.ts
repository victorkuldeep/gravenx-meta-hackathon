import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * gravenx-mcp file workspace: every record is one JSON file holding the
 * EXACT studio package shape (sequence-package, experience-package,
 * system export, decisions/requirements/console packages, ERD structure),
 * so the studio Import buttons open agent-authored files with zero
 * conversion. No tokens, no org calls, no network - files only.
 */

export function resolveWorkspace(): string {
  const dir =
    process.env.GRAVENX_WORKSPACE?.trim() ||
    path.join(process.cwd(), "gravenx-workspace");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Deterministic filename; refuses to clobber unless overwrite is set. */
export function claimFile(dir: string, kind: string, name: string, overwrite = false): string {
  const file = path.join(dir, `${kind}-${slugify(name)}.json`);
  if (!overwrite) {
    try {
      readFileSync(file, "utf8");
      throw new Error(
        `File exists: ${path.basename(file)} - pick another name or set overwrite true.`,
      );
    } catch (e) {
      if ((e as Error).message.startsWith("File exists")) throw e;
      /* missing - claimable */
    }
  }
  return file;
}

/** Atomic write: tmp + rename, never a half-written package. */
export function writeJson(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/** All workspace files for one kind prefix, parsed (skips unreadable). */
export function listKind(dir: string, kind: string): { file: string; data: unknown }[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: { file: string; data: unknown }[] = [];
  for (const e of entries) {
    if (!e.startsWith(`${kind}-`) || !e.endsWith(".json")) continue;
    const file = path.join(dir, e);
    try {
      out.push({ file, data: readJson(file) });
    } catch {
      /* corrupt file - list callers report it, never crash */
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Resolve a record by filename, contained id, or name substring.
 * Returns every match so callers can demand uniqueness.
 */
export function findRecords(
  dir: string,
  kind: string,
  ref: string,
  match: (data: unknown) => { id?: string; name?: string } | null,
): { file: string; data: unknown }[] {
  const q = ref.trim().toLowerCase();
  const exact = path.join(dir, ref);
  const hits: { file: string; data: unknown }[] = [];
  for (const { file, data } of listKind(dir, kind)) {
    if (file === exact || path.basename(file).toLowerCase() === q) {
      hits.push({ file, data });
      continue;
    }
    const m = match(data);
    if (!m) continue;
    if (m.id === ref || (m.name ?? "").toLowerCase().includes(q)) {
      hits.push({ file, data });
    }
  }
  return hits;
}
