/**
 * Spreadsheet-grid helpers - pure parse/validate/merge behind the grid
 * editing surface. The grid and the guide edit the same mappings array;
 * everything here commits through the same row patches.
 */

import { FREE_SOURCE_PATH, type MappingProject, type MappingRow } from "./types";

export interface ParsedTarget {
  objectName: string;
  fieldName: string;
}

/** "Account.Name" -> parts. Exactly one dot, no blanks, no inner spaces. */
export function parseTargetText(text: string): ParsedTarget | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length !== 2) return null;
  const [objectName, fieldName] = parts.map((p) => p.trim());
  if (!objectName || !fieldName) return null;
  if (/\s/.test(objectName) || /\s/.test(fieldName)) return null;
  return { objectName, fieldName };
}

export type TargetCheck =
  | { ok: true; target: ParsedTarget }
  | { ok: false; reason: string };

/**
 * Shape is always enforced; existence is enforced against the snapshot
 * when one is captured. Without a snapshot the target commits blind and
 * diagnostics flags it if wrong - the grid never bricks on metadata.
 */
export function validateTarget(project: MappingProject, text: string): TargetCheck {
  const target = parseTargetText(text);
  if (!target) return { ok: false, reason: "Use Object.Field - e.g. Account.Industry." };
  const snap = project.sfSnapshot;
  if (!snap) return { ok: true, target };
  const obj = snap.objects.find((o) => o.name === target.objectName);
  if (!obj) return { ok: false, reason: `${target.objectName} is not in the metadata snapshot.` };
  const field = obj.fields.find((f) => f.name === target.fieldName);
  if (!field) return { ok: false, reason: `${target.fieldName} is not on ${target.objectName} in the snapshot.` };
  return { ok: true, target };
}

export interface PasteRow {
  sourcePath: string;
  objectName: string;
  fieldName: string;
  /** Set when the value is a "double-quoted" constant instead of a target. */
  hardcodedValue?: string;
}

export interface PasteSkip {
  line: number;
  reason: string;
}

const SEPARATORS = ["\t", "->", "→", ",", ";"];

/**
 * Client spreadsheets paste as "source -> Object.Field" lines. Tab wins,
 * then arrows, then comma/semicolon. Blank lines are ignored silently;
 * malformed lines are reported with reasons, never half-applied.
 */
export function parsePasteGrid(text: string): { rows: PasteRow[]; skipped: PasteSkip[] } {
  const rows: PasteRow[] = [];
  const skipped: PasteSkip[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const sep = SEPARATORS.find((s) => line.includes(s));
    if (!sep) {
      skipped.push({ line: i + 1, reason: "No separator (tab, ->, comma)." });
      continue;
    }
    const at = line.indexOf(sep);
    const sourcePath = line.slice(0, at).trim();
    const target = parseTargetText(line.slice(at + sep.length));
    if (!sourcePath) {
      skipped.push({ line: i + 1, reason: "Empty source path." });
      continue;
    }
    if (!target) {
      skipped.push({ line: i + 1, reason: "Target must be Object.Field." });
      continue;
    }
    rows.push({ sourcePath, ...target });
  }
  return { rows, skipped };
}

/**
 * Fold pasted rows into the mapping list: same source updates in place
 * (last wins), new sources append. Pasted "(constant)" lines always
 * append as free rows - they never collide with each other.
 */
export function mergePasteRows(
  existing: MappingRow[],
  parsed: PasteRow[],
  planId: string | null,
  nextId: () => string,
  now: string,
): MappingRow[] {
  const next = existing.map((m) => ({ ...m }));
  const bySource = new Map(next.filter((m) => m.sourcePath !== FREE_SOURCE_PATH).map((m) => [m.sourcePath, m]));
  for (const p of parsed) {
    const hit = p.sourcePath === FREE_SOURCE_PATH ? undefined : bySource.get(p.sourcePath);
    if (hit) {
      if (p.hardcodedValue !== undefined) {
        hit.objectName = "";
        hit.fieldName = "";
        hit.kind = "hardcoded";
        hit.status = "hardcoded";
        hit.hardcodedValue = p.hardcodedValue;
      } else {
        hit.objectName = p.objectName;
        hit.fieldName = p.fieldName;
        hit.kind = "direct";
      }
      hit.updatedAt = now;
      continue;
    }
    const hardcoded = p.hardcodedValue !== undefined;
    const row: MappingRow = {
      id: nextId(),
      sourcePath: p.sourcePath,
      planId,
      objectName: hardcoded ? "" : p.objectName,
      fieldName: hardcoded ? "" : p.fieldName,
      kind: hardcoded ? "hardcoded" : "direct",
      status: hardcoded ? "hardcoded" : "mapped",
      ...(hardcoded ? { hardcodedValue: p.hardcodedValue } : {}),
      updatedAt: now,
    };
    next.push(row);
    if (p.sourcePath !== FREE_SOURCE_PATH) bySource.set(p.sourcePath, row);
  }
  return next;
}

/** Every Object.Field in the snapshot, for grid autocomplete. */
export function snapshotTargets(project: MappingProject): string[] {
  return (project.sfSnapshot?.objects ?? []).flatMap((o) => o.fields.map((f) => `${o.name}.${f.name}`));
}

export interface KeyValuePair {
  key: string;
  value: string;
  line: number;
}

/**
 * Postman-style K:V input. One pair per line on the first separator found:
 * arrows (→, ->, =>), then =, tab, pipe - and a colon that is not part of
 * a URL (so pasted endpoints survive). A whole JSON object also parses:
 * {"$.order.id": "Order.Id", ...} - the agent's native tongue.
 */
export function splitKeyValue(line: string): { key: string; value: string } | null {
  const t = line.trim();
  if (!t) return null;
  for (const sep of ["→", "->", "=>", "="]) {
    const at = t.indexOf(sep);
    if (at > 0) return { key: t.slice(0, at).trim(), value: t.slice(at + sep.length).trim() };
  }
  for (const sep of ["\t", "|"]) {
    const at = t.indexOf(sep);
    if (at > 0) return { key: t.slice(0, at).trim(), value: t.slice(at + sep.length).trim() };
  }
  // First colon not followed by / - "orderId: Account.Name" splits, URLs don't.
  const m = /(.*?):(?!\/)(.*)/.exec(t);
  if (m && m[1].trim()) return { key: m[1].trim(), value: m[2].trim() };
  return null;
}

export function parseKeyValueGrid(text: string): { pairs: KeyValuePair[]; skipped: PasteSkip[] } {
  const pairs: KeyValuePair[] = [];
  const skipped: PasteSkip[] = [];
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      const obj: unknown = JSON.parse(t);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        let line = 0;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          line++;
          if (!k.trim() || typeof v !== "string" || !v.trim()) {
            skipped.push({ line, reason: "Keys need non-empty string values." });
            continue;
          }
          pairs.push({ key: k.trim(), value: v.trim(), line });
        }
        return { pairs, skipped };
      }
    } catch {
      /* fall through to line mode - the brace may be literal text */
    }
  }
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    const split = splitKeyValue(raw);
    if (!split || !split.key || !split.value) {
      skipped.push({ line: i + 1, reason: "No K:V separator (→, ->, =, tab, |, :)." });
      continue;
    }
    pairs.push({ key: split.key, value: split.value, line: i + 1 });
  }
  return { pairs, skipped };
}

export type QuickMatchStatus = "ok" | "blind" | "ambiguous" | "unknown-source" | "unknown-target" | "no-plan";

export interface QuickMatch {
  key: string;
  value: string;
  line: number;
  status: QuickMatchStatus;
  note: string;
  row?: PasteRow;
}

/** Leaf segment of a canonical path: "$.order.id" -> "id". */
function leafOf(path: string): string {
  const m = /([^.[\]]+)\]?$/.exec(path.trim());
  return m ? m[1] : path.trim();
}

/**
 * Fast-forward resolution. Sources match exact canonical paths first, then
 * unique leaf keys against the source snapshot; targets accept Object.Field
 * or a bare field resolved through the plan's object. Without snapshots both
 * sides commit blind (diagnostics flags drift later) - the modal never
 * bricks on metadata. Only "ok"/"blind" rows are importable; everything
 * else reports why, never half-applies.
 */
export function resolveQuickPairs(
  project: MappingProject,
  pairs: KeyValuePair[],
  planId: string | null
): { rows: PasteRow[]; matches: QuickMatch[] } {
  const rows: PasteRow[] = [];
  const matches: QuickMatch[] = [];
  const plan = planId ? (project.recordPlans.find((p) => p.id === planId) ?? null) : null;
  const leaves = project.source?.paths ?? [];
  const byPath = new Map(leaves.map((p) => [p.path, p]));
  const byId = new Map(leaves.map((p) => [p.id, p]));

  for (const pair of pairs) {
    const fail = (status: QuickMatchStatus, note: string): void => {
      matches.push({ key: pair.key, value: pair.value, line: pair.line, status, note });
    };
    // ---- source side ----
    let sourcePath: string | null = null;
    let blindSource = false;
    if (leaves.length === 0) {
      sourcePath = pair.key;
      blindSource = true;
    } else {
      const exact = byPath.get(pair.key) ?? byId.get(pair.key);
      if (exact) {
        sourcePath = exact.path;
      } else {
        const leaf = leafOf(pair.key).toLowerCase();
        const hits = leaves.filter(
          (p) => p.key.toLowerCase() === leaf || leafOf(p.path).toLowerCase() === leaf || p.path.toLowerCase() === pair.key.toLowerCase()
        );
        if (hits.length === 1) sourcePath = hits[0].path;
        else if (hits.length > 1) {
          fail("ambiguous", `"${pair.key}" matches ${hits.length} source nodes: ${hits.slice(0, 3).map((h) => h.path).join(", ")}${hits.length > 3 ? "…" : ""}. Use the full path.`);
          continue;
        } else {
          fail("unknown-source", `"${pair.key}" is not in the source sample. Use a full $.path.`);
          continue;
        }
      }
    }
    // ---- target side ----
    const strict = parseTargetText(pair.value);
    if (strict) {
      const check = validateTarget(project, pair.value);
      if (!check.ok) {
        fail("unknown-target", check.reason);
        continue;
      }
      const row: PasteRow = { sourcePath: sourcePath!, objectName: check.target.objectName, fieldName: check.target.fieldName };
      rows.push(row);
      matches.push({
        key: pair.key, value: pair.value, line: pair.line,
        status: blindSource || !project.sfSnapshot ? "blind" : "ok",
        note: blindSource ? "No source sample - commits blind." : !project.sfSnapshot ? "No metadata snapshot - commits blind." : `${sourcePath} → ${check.target.objectName}.${check.target.fieldName}`,
        row,
      });
      continue;
    }
    // Bare field - resolves through the plan's object.
    if (/^[A-Za-z_][A-Za-z0-9_]*(__[cC])?$/.test(pair.value)) {
      if (!plan) {
        fail("no-plan", `"${pair.value}" needs an object - pick the record plan first, or use Object.Field.`);
        continue;
      }
      const obj = project.sfSnapshot?.objects.find((o) => o.name === plan.objectName);
      if (obj && !obj.fields.some((f) => f.name === pair.value)) {
        fail("unknown-target", `${pair.value} is not on ${plan.objectName} in the snapshot.`);
        continue;
      }
      const row: PasteRow = { sourcePath: sourcePath!, objectName: plan.objectName, fieldName: pair.value };
      rows.push(row);
      matches.push({
        key: pair.key, value: pair.value, line: pair.line,
        status: !project.sfSnapshot || blindSource ? "blind" : "ok",
        note: `${sourcePath} → ${plan.objectName}.${pair.value}${!project.sfSnapshot ? " (blind - no snapshot)" : ""}`,
        row,
      });
      continue;
    }
    // "Double-quoted" literal - a hardcoded constant, not a target.
    const quoted = /^"([\s\S]*)"$/.exec(pair.value.trim());
    if (quoted && quoted[1].trim()) {
      const row: PasteRow = { sourcePath: sourcePath!, objectName: "", fieldName: "", hardcodedValue: quoted[1] };
      rows.push(row);
      matches.push({
        key: pair.key, value: pair.value, line: pair.line,
        status: !project.sfSnapshot || blindSource ? "blind" : "ok",
        note: `${sourcePath} → "${quoted[1]}" (constant)${!project.sfSnapshot ? " (blind - no snapshot)" : ""}`,
        row,
      });
      continue;
    }
    fail("unknown-target", `"${pair.value}" must be Object.Field, a bare field with a plan picked, or a "quoted" constant.`);
  }
  return { rows, matches };
}

/**
 * Fast-mapper prefill: existing leaf rows back into K:V text. Direct rows
 * read as Object.Field; pure constants read as "quoted" literals; excluded,
 * enum and untargeted rows have no K:V spelling and are skipped, so an
 * untouched reimport never degrades them.
 */
export function mappingsToKvPrefill(mappings: MappingRow[]): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const m of mappings) {
    if (m.sourcePath === FREE_SOURCE_PATH) continue;
    if (m.kind === "excluded" || m.kind === "enum") continue;
    if (m.fieldName) {
      out.push({ key: m.sourcePath, value: `${m.objectName}.${m.fieldName}` });
    } else if (m.kind === "hardcoded" && m.hardcodedValue !== undefined && String(m.hardcodedValue).trim() !== "") {
      out.push({ key: m.sourcePath, value: `"${String(m.hardcodedValue)}"` });
    }
  }
  return out;
}
