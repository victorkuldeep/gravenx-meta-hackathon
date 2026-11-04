import { STORES, withStore } from "@/lib/db";
import { decisionSchema, type Decision } from "./model";

/**
 * Decisions persistence: records live in their own `decision-records`
 * store (DB v20). Linked architecture is never copied here - decisions
 * only carry links. Degrades to safe empties off-browser.
 */

function clean(d: Decision): Decision {
  return decisionSchema.parse(d);
}

function report(op: string, err: unknown): void {
  // Silent degrade stays, but the cause must be visible in DevTools -
  // a swallowed error here is a decision lost on reload.
  if (typeof console !== "undefined") console.error(`[decisions] ${op} failed:`, err);
}

export async function listDecisions(): Promise<Decision[]> {
  try {
    const all = await withStore<Decision[]>(STORES.decisionRecords, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    report("load", err);
    return [];
  }
}

export async function saveDecision(d: Decision): Promise<boolean> {
  try {
    await withStore(STORES.decisionRecords, "readwrite", (s) => s.put(clean({ ...d, updatedAt: Date.now() })));
    return true;
  } catch (err) {
    report("save", err);
    return false;
  }
}

export async function deleteDecision(id: string): Promise<boolean> {
  try {
    await withStore(STORES.decisionRecords, "readwrite", (s) => s.delete(id));
    return true;
  } catch (err) {
    report("delete", err);
    return false;
  }
}

export function exportDecisions(decisions: Decision[]): string {
  return JSON.stringify(
    { version: 1, type: "gravenx-decisions-package", exportedAt: new Date().toISOString(), decisions },
    null,
    2,
  );
}

/** Import a package: re-ids and renumbers every decision so imports never overwrite. */
export function importDecisions(
  json: string,
  taken: Pick<Decision, "number">[] = [],
  now = Date.now(),
): { decisions: Decision[]; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { decisions: [], error: "Not valid JSON." };
  }
  const list = (raw as { decisions?: unknown }).decisions;
  if (!Array.isArray(list)) return { decisions: [], error: "No decisions array in this package." };
  const used = new Set(taken.map((d) => d.number));
  let max = 0;
  for (const n of used) {
    const m = /^ADR-(\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const decisions: Decision[] = [];
  for (const item of list) {
    const parsed = decisionSchema.safeParse(item);
    if (!parsed.success) continue;
    max++;
    const number = `ADR-${String(max).padStart(3, "0")}`;
    used.add(number);
    decisions.push({
      ...parsed.data,
      id: `adr_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      number,
      history: [...parsed.data.history, { at: now, what: "Imported into Decisions." }],
    });
    now++;
  }
  if (decisions.length === 0) return { decisions: [], error: "No valid decisions in this package." };
  return { decisions };
}
