import { nodeTypeOf } from "./document";

/**
 * Canonical structural comparison engine. Recursive, path-native,
 * deterministic - the single source of truth behind Summary, Tree Diff,
 * Graph Diff and Engineering views. The legacy side-by-side viewer keeps
 * its own behavior untouched; these findings never depend on it.
 *
 * Every finding carries BOTH sides' canonical paths (they diverge under
 * key-based array matching). Ignored paths suppress either side.
 */

export type CompareStrategy = "strict" | "loose" | "type-aware";
export type ArrayMode = "index" | "lcs" | "key";

export interface CompareOptions {
  strategy?: CompareStrategy;
  ignorePaths?: string[];
  arrayMode?: ArrayMode;
  /** Property used to match array items in key mode. */
  matchKey?: string;
}

export type FindingCategory =
  | "added"
  | "removed"
  | "modified"
  | "type-changed"
  | "array-added"
  | "array-removed"
  | "array-modified"
  | "unmatched"
  | "duplicate-key"
  | "structural";

export interface Finding {
  id: string;
  category: FindingCategory;
  /** Canonical path strings ($.a[0].b); null when absent on that side. */
  pathA: string | null;
  pathB: string | null;
  parent: string;
  oldValue?: unknown;
  newValue?: unknown;
  oldType?: string;
  newType?: string;
  matchKey?: string;
  matchStatus?: "matched" | "unmatched-a" | "unmatched-b" | "duplicate";
  explanation: string;
}

export interface CompareResult {
  findings: Finding[];
  counts: Record<FindingCategory, number>;
  warnings: string[];
  config: Required<Pick<CompareOptions, "strategy" | "arrayMode">> & {
    matchKey: string;
    ignorePaths: string[];
  };
}

export type JsonPath = (string | number)[];

const typeName = (v: unknown): string => (v === undefined ? "missing" : nodeTypeOf(v));

function childStr(parent: string, key: string): string {
  return `${parent}${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`}`;
}

function primitivesEqual(a: unknown, b: unknown, strategy: CompareStrategy): boolean {
  if (typeof a !== typeof b) {
    if (strategy === "strict") return false;
    if (a === null || b === null) return false;
    return String(a) === String(b);
  }
  return a === b;
}

const MAX_LCS_CELLS = 4_000_000;

/** LCS alignment on stable-serialized items. Empty = too large (caller falls back). */
function lcsAlign(a: unknown[], b: unknown[]): { kind: "pair" | "del" | "add"; ai: number; bi: number }[] {
  if (a.length * b.length > MAX_LCS_CELLS) return [];
  const key = (v: unknown) => JSON.stringify(v);
  const ka = a.map(key);
  const kb = b.map(key);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: { kind: "pair" | "del" | "add"; ai: number; bi: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      ops.push({ kind: "pair", ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "del", ai: i, bi: -1 });
      i++;
    } else {
      ops.push({ kind: "add", ai: -1, bi: j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "del", ai: i, bi: -1 });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "add", ai: -1, bi: j });
    j++;
  }
  return ops;
}

interface Ctx {
  findings: Finding[];
  warnings: string[];
  ignored: string[];
  strategy: CompareStrategy;
  arrayMode: ArrayMode;
  matchKey: string;
  seq: number;
}

function ignored(ctx: Ctx, strA: string | null, strB: string | null): boolean {
  const hit = (p: string | null) =>
    p !== null && ctx.ignored.some((ig) => p === ig || p.startsWith(`${ig}.`) || p.startsWith(`${ig}[`));
  return hit(strA) || hit(strB);
}

function emit(ctx: Ctx, f: Omit<Finding, "id">): void {
  ctx.seq += 1;
  ctx.findings.push({ ...f, id: `f${ctx.seq}` });
}

function explainChange(path: string, a: unknown, b: unknown): string {
  return `${path} changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}.`;
}

/** Match-key value of an item, or null when it cannot be keyed. */
function keyOf(v: unknown, matchKey: string): string | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const kv = (v as Record<string, unknown>)[matchKey];
  if (kv === undefined || kv === null || typeof kv === "object") return null;
  return String(kv);
}

/**
 * A real payload mixes arrays that share one natural id (e.g.
 * productOrderItem[].id) with nested arrays that have none (e.g.
 * productCharacteristic[] keyed only by position). Key-mode therefore
 * applies per array: only arrays that actually carry the key on at
 * least one item on either side; the rest fall through to their own
 * lcs/index handling exactly as if no matchKey had been set.
 */
function arrayHasUsableKey(a: unknown[], b: unknown[], matchKey: string): boolean {
  return a.some((v) => keyOf(v, matchKey) !== null) || b.some((v) => keyOf(v, matchKey) !== null);
}

function diffValue(
  ctx: Ctx,
  a: unknown,
  b: unknown,
  pathA: JsonPath,
  pathB: JsonPath,
  strA: string,
  strB: string,
  parent: string
): void {
  const ta = typeName(a);
  const tb = typeName(b);

  if (ta === "missing" && tb === "missing") return;
  if (ta === "missing") {
    emit(ctx, {
      category: "added",
      pathA: null,
      pathB: strB,
      parent,
      newValue: b,
      newType: tb,
      explanation: `${strB} was added with ${JSON.stringify(b)}.`,
    });
    return;
  }
  if (tb === "missing") {
    emit(ctx, {
      category: "removed",
      pathA: strA,
      pathB: null,
      parent,
      oldValue: a,
      oldType: ta,
      explanation: `${strA} was removed (was ${JSON.stringify(a)}).`,
    });
    return;
  }

  if (ta === tb) {
    if (ta === "object") {
      const ao = a as Record<string, unknown>;
      const bo = b as Record<string, unknown>;
      for (const k of Object.keys(ao)) {
        const cA = childStr(strA, k);
        const cB = childStr(strB, k);
        if (ignored(ctx, cA, cB)) continue;
        if (!Object.prototype.hasOwnProperty.call(bo, k)) {
          emit(ctx, {
            category: "removed",
            pathA: cA,
            pathB: null,
            parent: strA,
            oldValue: ao[k],
            oldType: typeName(ao[k]),
            explanation: `${cA} was removed (was ${JSON.stringify(ao[k])}).`,
          });
        } else {
          diffValue(ctx, ao[k], bo[k], [...pathA, k], [...pathB, k], cA, cB, strA);
        }
      }
      for (const k of Object.keys(bo)) {
        if (Object.prototype.hasOwnProperty.call(ao, k)) continue;
        const cA = childStr(strA, k);
        const cB = childStr(strB, k);
        if (ignored(ctx, cA, cB)) continue;
        emit(ctx, {
          category: "added",
          pathA: null,
          pathB: cB,
          parent: strA,
          newValue: bo[k],
          newType: typeName(bo[k]),
          explanation: `${cB} was added with ${JSON.stringify(bo[k])}.`,
        });
      }
      return;
    }
    if (ta === "array") {
      diffArray(ctx, a as unknown[], b as unknown[], pathA, pathB, strA, strB);
      return;
    }
    if (!primitivesEqual(a, b, ctx.strategy)) {
      emit(ctx, {
        category: "modified",
        pathA: strA,
        pathB: strB,
        parent,
        oldValue: a,
        newValue: b,
        oldType: ta,
        newType: tb,
        explanation: explainChange(strA, a, b),
      });
    }
    return;
  }

  // Types differ.
  const container = (t: string) => t === "object" || t === "array";
  if ((ta === "null" || tb === "null") && !container(ta) && !container(tb)) {
    // Null is value-state, not a type assertion: null vs primitive = modified.
    emit(ctx, {
      category: "modified",
      pathA: strA,
      pathB: strB,
      parent,
      oldValue: a,
      newValue: b,
      oldType: ta,
      newType: tb,
      explanation: explainChange(strA, a, b),
    });
    return;
  }
  if (ta !== "object" && ta !== "array" && tb !== "object" && tb !== "array" && primitivesEqual(a, b, ctx.strategy)) {
    return; // Cross-type equality under loose / type-aware.
  }
  emit(ctx, {
    category: "type-changed",
    pathA: strA,
    pathB: strB,
    parent,
    oldValue: a,
    newValue: b,
    oldType: ta,
    newType: tb,
    explanation: `${strA} changed type from ${ta} to ${tb}.`,
  });
}

function markArrayModified(
  ctx: Ctx,
  before: number,
  strA: string,
  strB: string,
  parent: string,
  aItem: unknown,
  bItem: unknown,
  matchKey?: string
): void {
  if (ctx.findings.length === before) return;
  emit(ctx, {
    category: "array-modified",
    pathA: strA,
    pathB: strB,
    parent,
    oldType: typeName(aItem),
    newType: typeName(bItem),
    ...(matchKey !== undefined ? { matchKey, matchStatus: "matched" as const } : {}),
    explanation: `Array item ${strA} changed - see detail findings below.`,
  });
}

function diffArray(
  ctx: Ctx,
  a: unknown[],
  b: unknown[],
  pathA: JsonPath,
  pathB: JsonPath,
  strA: string,
  strB: string
): void {
  if (ctx.arrayMode === "key" && ctx.matchKey !== "" && arrayHasUsableKey(a, b, ctx.matchKey)) {
    diffArrayByKey(ctx, a, b, pathA, pathB, strA, strB);
    return;
  }

  if (ctx.arrayMode === "lcs") {
    const ops = lcsAlign(a, b);
    if (ops.length === 0 && a.length * b.length > MAX_LCS_CELLS) {
      ctx.warnings.push(`${strA}: array too large for LCS (${a.length}×${b.length}) - compared by index.`);
    } else if (ops.length > 0) {
      for (const op of ops) {
        if (op.kind === "pair") {
          const before = ctx.findings.length;
          diffValue(ctx, a[op.ai], b[op.bi], [...pathA, op.ai], [...pathB, op.bi], `${strA}[${op.ai}]`, `${strB}[${op.bi}]`, strA);
          markArrayModified(ctx, before, `${strA}[${op.ai}]`, `${strB}[${op.bi}]`, strA, a[op.ai], b[op.bi]);
        } else if (op.kind === "del") {
          emit(ctx, {
            category: "array-removed",
            pathA: `${strA}[${op.ai}]`,
            pathB: null,
            parent: strA,
            oldValue: a[op.ai],
            oldType: typeName(a[op.ai]),
            explanation: `Array item ${strA}[${op.ai}] was removed.`,
          });
        } else {
          emit(ctx, {
            category: "array-added",
            pathA: null,
            pathB: `${strB}[${op.bi}]`,
            parent: strA,
            newValue: b[op.bi],
            newType: typeName(b[op.bi]),
            explanation: `Array item ${strB}[${op.bi}] was added.`,
          });
        }
      }
      return;
    }
  }

  // Index mode (default + LCS fallback).
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i >= a.length) {
      emit(ctx, {
        category: "array-added",
        pathA: null,
        pathB: `${strB}[${i}]`,
        parent: strA,
        newValue: b[i],
        newType: typeName(b[i]),
        explanation: `Array item ${strB}[${i}] was added.`,
      });
    } else if (i >= b.length) {
      emit(ctx, {
        category: "array-removed",
        pathA: `${strA}[${i}]`,
        pathB: null,
        parent: strA,
        oldValue: a[i],
        oldType: typeName(a[i]),
        explanation: `Array item ${strA}[${i}] was removed.`,
      });
    } else {
      const before = ctx.findings.length;
      diffValue(ctx, a[i], b[i], [...pathA, i], [...pathB, i], `${strA}[${i}]`, `${strB}[${i}]`, strA);
      markArrayModified(ctx, before, `${strA}[${i}]`, `${strB}[${i}]`, strA, a[i], b[i]);
    }
  }
}

function diffArrayByKey(
  ctx: Ctx,
  a: unknown[],
  b: unknown[],
  pathA: JsonPath,
  pathB: JsonPath,
  strA: string,
  strB: string
): void {
  const indexByKey = (arr: unknown[]) => {
    const map = new Map<string, number[]>();
    arr.forEach((item, i) => {
      const k = keyOf(item, ctx.matchKey);
      if (k === null) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k)?.push(i);
    });
    return map;
  };

  const am = indexByKey(a);
  const bm = indexByKey(b);
  const seenA = new Set<number>();
  const seenB = new Set<number>();
  const parent = strA;

  for (const [k, ais] of am) {
    const bis = bm.get(k) ?? [];
    if (ais.length > 1 || bis.length > 1) {
      for (const ai of ais) {
        seenA.add(ai);
        emit(ctx, {
          category: "duplicate-key",
          pathA: `${strA}[${ai}]`,
          pathB: bis.length > 0 ? `${strB}[${bis[0]}]` : null,
          parent,
          matchKey: ctx.matchKey,
          matchStatus: "duplicate",
          explanation: `Duplicate match key ${ctx.matchKey} = "${k}" - items cannot be matched safely.`,
        });
      }
      for (const bi of bis) {
        seenB.add(bi);
        emit(ctx, {
          category: "unmatched",
          pathA: null,
          pathB: `${strB}[${bi}]`,
          parent,
          newValue: b[bi],
          newType: typeName(b[bi]),
          matchKey: ctx.matchKey,
          matchStatus: "duplicate",
          explanation: `Item with duplicate key "${k}" left unmatched.`,
        });
      }
      continue;
    }
    if (bis.length === 0) {
      seenA.add(ais[0]);
      emit(ctx, {
        category: "unmatched",
        pathA: `${strA}[${ais[0]}]`,
        pathB: null,
        parent,
        oldValue: a[ais[0]],
        oldType: typeName(a[ais[0]]),
        matchKey: ctx.matchKey,
        matchStatus: "unmatched-a",
        explanation: `An item with ${ctx.matchKey} = "${k}" exists in A but not B.`,
      });
      continue;
    }
    const ai = ais[0];
    const bi = bis[0];
    seenA.add(ai);
    seenB.add(bi);
    if (ai !== bi) {
      emit(ctx, {
        category: "structural",
        pathA: `${strA}[${ai}]`,
        pathB: `${strB}[${bi}]`,
        parent,
        matchKey: ctx.matchKey,
        matchStatus: "matched",
        explanation: `Item "${k}" moved from index ${ai} to ${bi} (order only).`,
      });
    }
    const before = ctx.findings.length;
    diffValue(ctx, a[ai], b[bi], [...pathA, ai], [...pathB, bi], `${strA}[${ai}]`, `${strB}[${bi}]`, parent);
    markArrayModified(ctx, before, `${strA}[${ai}]`, `${strB}[${bi}]`, parent, a[ai], b[bi], ctx.matchKey);
  }

  const leftovers = (arr: unknown[], seen: Set<number>, side: "a" | "b") => {
    arr.forEach((item, i) => {
      if (seen.has(i)) return;
      seen.add(i);
      const k = keyOf(item, ctx.matchKey);
      const ref = side === "a" ? `${strA}[${i}]` : `${strB}[${i}]`;
      if (k === null) ctx.warnings.push(`${ref} has no "${ctx.matchKey}" - left unmatched.`);
      emit(ctx, {
        category: "unmatched",
        pathA: side === "a" ? ref : null,
        pathB: side === "b" ? ref : null,
        parent,
        ...(side === "a" ? { oldValue: item, oldType: typeName(item) } : { newValue: item, newType: typeName(item) }),
        matchKey: ctx.matchKey,
        matchStatus: side === "a" ? "unmatched-a" : "unmatched-b",
        explanation:
          k === null
            ? `Item at ${ref} has no "${ctx.matchKey}" and cannot be matched.`
            : `An item with ${ctx.matchKey} = "${k}" exists in ${side.toUpperCase()} but not ${side === "a" ? "B" : "A"}.`,
      });
    });
  };
  leftovers(a, seenA, "a");
  leftovers(b, seenB, "b");
}

export function compareDocuments(a: unknown, b: unknown, options: CompareOptions = {}): CompareResult {
  const strategy = options.strategy ?? "strict";
  const arrayMode = options.arrayMode ?? "index";
  const matchKey = options.matchKey ?? "";
  const warnings: string[] = [];

  const validIgnored: string[] = [];
  for (const ig of options.ignorePaths ?? []) {
    if (typeof ig !== "string" || !ig.startsWith("$")) {
      warnings.push(`Ignored path "${ig}" is not a canonical $ path - skipped.`);
      continue;
    }
    validIgnored.push(ig);
  }

  const ctx: Ctx = {
    findings: [],
    warnings,
    ignored: validIgnored,
    strategy,
    arrayMode,
    matchKey,
    seq: 0,
  };

  const ignored = (p: string | null) =>
    p !== null && validIgnored.some((ig) => p === ig || p.startsWith(`${ig}.`) || p.startsWith(`${ig}[`));

  const ta = typeName(a);
  const tb = typeName(b);
  if ((ta === "object" || ta === "array") && ta === tb) {
    if (ta === "object") {
      const ao = a as Record<string, unknown>;
      const bo = b as Record<string, unknown>;
      for (const k of Object.keys(ao)) {
        const child = childStr("$", k);
        if (ignored(child)) continue;
        if (!Object.prototype.hasOwnProperty.call(bo, k)) {
          emit(ctx, {
            category: "removed",
            pathA: child,
            pathB: null,
            parent: "$",
            oldValue: ao[k],
            oldType: typeName(ao[k]),
            explanation: `${child} was removed.`,
          });
        } else {
          diffValue(ctx, ao[k], bo[k], [k], [k], child, child, "$");
        }
      }
      for (const k of Object.keys(bo)) {
        if (Object.prototype.hasOwnProperty.call(ao, k)) continue;
        const child = childStr("$", k);
        if (ignored(child)) continue;
        emit(ctx, {
          category: "added",
          pathA: null,
          pathB: child,
          parent: "$",
          newValue: bo[k],
          newType: typeName(bo[k]),
          explanation: `${child} was added.`,
        });
      }
    } else {
      diffArray(ctx, a as unknown[], b as unknown[], [], [], "$", "$");
    }
  } else if (ta !== tb) {
    emit(ctx, {
      category: "structural",
      pathA: "$",
      pathB: "$",
      parent: "$",
      oldType: ta,
      newType: tb,
      explanation: `Root changed type from ${ta} to ${tb} - documents are structurally different.`,
    });
  } else {
    diffValue(ctx, a, b, [], [], "$", "$", "$");
  }

  const counts = {
    added: 0,
    removed: 0,
    modified: 0,
    "type-changed": 0,
    "array-added": 0,
    "array-removed": 0,
    "array-modified": 0,
    unmatched: 0,
    "duplicate-key": 0,
    structural: 0,
  } as Record<FindingCategory, number>;
  for (const f of ctx.findings) counts[f.category] += 1;

  return {
    findings: ctx.findings,
    counts,
    warnings: ctx.warnings,
    config: { strategy, arrayMode, matchKey, ignorePaths: validIgnored },
  };
}
