/**
 * Minimal character-level diff for inspector value previews. LCS over the
 * two strings, merged into same/del/add runs. Values here are small
 * (pretty-printed node values, capped by callers) - quadratic DP is fine.
 */

export type TextSegment = {
  text: string;
  kind: "same" | "del" | "add";
};

const MAX_DIFF_CHARS = 800;

/** Returns null when either side is too large to diff cheaply. */
export function diffSegments(a: string, b: string): TextSegment[] | null {
  if (a === b) return a === "" ? [] : [{ text: a, kind: "same" }];
  if (a.length > MAX_DIFF_CHARS || b.length > MAX_DIFF_CHARS) return null;
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }
  const raw: TextSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ text: a[i], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ text: a[i], kind: "del" });
      i++;
    } else {
      raw.push({ text: b[j], kind: "add" });
      j++;
    }
  }
  while (i < n) {
    raw.push({ text: a[i], kind: "del" });
    i++;
  }
  while (j < m) {
    raw.push({ text: b[j], kind: "add" });
    j++;
  }
  // Merge adjacent runs of the same kind.
  const merged: TextSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.kind === seg.kind) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}
