import { STORES, withStore } from "@/lib/db";
import { requirementSchema, type Requirement } from "./model";

/**
 * Requirements persistence: records live in their own `requirement-records`
 * store (DB v21). Linked architecture is never copied here - requirements
 * only carry links. Degrades to safe empties off-browser.
 */

function clean(r: Requirement): Requirement {
  return requirementSchema.parse(r);
}

export async function listRequirements(): Promise<Requirement[]> {
  try {
    const all = await withStore<Requirement[]>(STORES.requirementRecords, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveRequirement(r: Requirement): Promise<boolean> {
  try {
    await withStore(STORES.requirementRecords, "readwrite", (s) => s.put(clean({ ...r, updatedAt: Date.now() })));
    return true;
  } catch {
    return false;
  }
}

export async function deleteRequirement(id: string): Promise<boolean> {
  try {
    await withStore(STORES.requirementRecords, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}

export function exportRequirements(reqs: Requirement[]): string {
  return JSON.stringify(
    { version: 1, type: "gravenx-requirements-package", exportedAt: new Date().toISOString(), requirements: reqs },
    null,
    2,
  );
}

/** Import a package: re-ids and renumbers every requirement so imports never overwrite. */
export function importRequirements(
  json: string,
  taken: Pick<Requirement, "number">[] = [],
  now = Date.now(),
): { requirements: Requirement[]; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { requirements: [], error: "Not valid JSON." };
  }
  const list = (raw as { requirements?: unknown }).requirements;
  if (!Array.isArray(list)) return { requirements: [], error: "No requirements array in this package." };
  const used = new Set(taken.map((r) => r.number));
  let max = 0;
  for (const n of used) {
    const m = /^REQ-(\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const requirements: Requirement[] = [];
  for (const item of list) {
    const parsed = requirementSchema.safeParse(item);
    if (!parsed.success) continue;
    max++;
    const number = `REQ-${String(max).padStart(3, "0")}`;
    used.add(number);
    requirements.push({
      ...parsed.data,
      id: `req_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      number,
      history: [...parsed.data.history, { at: now, what: "Imported into Requirements." }],
    });
    now++;
  }
  if (requirements.length === 0) return { requirements: [], error: "No valid requirements in this package." };
  return { requirements };
}
