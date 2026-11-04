"use client";

/**
 * Declarative step-to-step mapping: a target body template with {{refs}}
 * resolved against prior step outputs, plus a pass-through mode that
 * forwards the source body untouched. Pure string work - no code execution.
 *
 * Namespaces (first path segment):
 *   {{response}} / {{response.a.0.b}} - immediate previous output (whole / path)
 *   {{request}} / {{request.a.0.b}}   - body just sent to the previous hop
 *     (what middleware received - forwarding this replays the payload even
 *     when the hop answered with a bare ack)
 *   {{seed}} / {{seed.path}}           - flow seed payload (chain entry input)
 *   {{steps.<systemId>}} / {{steps.<systemId>.path}} - output of the hop that
 *     targeted that system (stable node id - survives renames)
 *   {{requests.<systemId>}} / {{requests.<systemId>.path}} - body that was
 *     sent to that system (pairs with {{steps.*}} responses)
 *   {{anything.else}}                  - path into the immediate previous
 *     output (back-compat with early templates)
 * A reference that resolves to nothing becomes null and is reported.
 */

export type MappingMode = "passthrough" | "template";

/** Resolve a dotted path (array indices supported) against JSON data. */
export function resolvePath(data: unknown, path: string): unknown {
  const parts = path
    .split(".")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  let cur: unknown = data;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    const idx = /^\d+$/.test(part) ? Number(part) : null;
    if (Array.isArray(cur)) {
      if (idx === null || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export interface TemplateResult {
  text: string;
  missing: string[];
}

/** Prior outputs addressable from a template: raw bodies keyed by system node id. */
export interface StepContext {
  seed?: string;
  steps?: Record<string, string>;
  /** Body just sent to the previous hop ({{request}}). */
  request?: string;
  /** Bodies sent per target system ({{requests.<systemId>}}). */
  requests?: Record<string, string>;
}

const tryParse = (raw: string | undefined): unknown => {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Render {{path}} refs. Missing refs become null and are reported. */
export function renderTemplate(template: string, data: unknown, ctx?: StepContext): TemplateResult {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, raw: string) => {
    const ref = raw.trim();
    const [head, ...rest] = ref.split(".").map((p) => p.trim());
    let base: unknown = data;
    let path = ref;
    if (head === "response") {
      base = data;
      path = rest.join(".");
      if (!path) {
        const rendered = JSON.stringify(data);
        if (rendered === undefined) {
          missing.push(ref);
          return "null";
        }
        return rendered;
      }
    } else if (head === "seed") {
      base = tryParse(ctx?.seed);
      path = rest.join(".");
      if (!path) {
        const rendered = JSON.stringify(base);
        if (rendered === undefined || base === null) {
          missing.push(ref);
          return "null";
        }
        return rendered;
      }
    } else if (head === "steps") {
      const [id, ...tail] = rest;
      base = tryParse(id ? ctx?.steps?.[id] : undefined);
      path = tail.join(".");
      if (base === null || base === undefined) {
        missing.push(ref);
        return "null";
      }
      if (!path) {
        const rendered = JSON.stringify(base);
        if (rendered === undefined) {
          missing.push(ref);
          return "null";
        }
        return rendered;
      }
    } else if (head === "request") {
      base = tryParse(ctx?.request);
      path = rest.join(".");
      if (!path) {
        const rendered = JSON.stringify(base);
        if (rendered === undefined || base === null) {
          missing.push(ref);
          return "null";
        }
        return rendered;
      }
    } else if (head === "requests") {
      const [id, ...tail] = rest;
      base = tryParse(id ? ctx?.requests?.[id] : undefined);
      path = tail.join(".");
      if (base === null || base === undefined) {
        missing.push(ref);
        return "null";
      }
      if (!path) {
        const rendered = JSON.stringify(base);
        if (rendered === undefined) {
          missing.push(ref);
          return "null";
        }
        return rendered;
      }
    }
    const value = resolvePath(base, path);
    if (value === undefined) {
      // Legacy fallback: early templates used {{response.foo}} to mean the
      // "response" key inside the source - honor that when the new
      // interpretation (path "foo") resolves to nothing.
      if (head === "response" && path !== ref) {
        const legacy = resolvePath(base, ref);
        if (legacy !== undefined) return JSON.stringify(legacy) ?? "null";
      }
      if (!missing.includes(ref)) missing.push(ref);
      return "null";
    }
    return JSON.stringify(value) ?? "null";
  });
  return { text, missing };
}

export interface MappingCompile {
  ok: boolean;
  body: string;
  missing: string[];
  error: string | null;
}

/** Build the step-2 body. Validates the result parses as JSON.
 * Contract: ok:true means "rendered valid JSON" - NOT "every ref resolved".
 * Unresolvable refs become null and are listed in missing; every caller
 * surfaces them (chain hop note, edge-run "nulled" count, transform preview,
 * run-MD note) so a nulled body is always visible, never silent. */
export function compileMapping(
  mode: MappingMode,
  template: string,
  sourceBody: string,
  ctx?: StepContext
): MappingCompile {
  if (mode === "passthrough") {
    const trimmed = sourceBody.trim();
    if (!trimmed) return { ok: false, body: "", missing: [], error: "Source response is empty - nothing to forward." };
    try {
      JSON.parse(trimmed);
    } catch {
      return { ok: false, body: "", missing: [], error: "Source response is not JSON - switch to template mode or pick a JSON step." };
    }
    return { ok: true, body: trimmed, missing: [], error: null };
  }
  let source: unknown = null;
  try {
    source = sourceBody.trim() ? JSON.parse(sourceBody) : null;
  } catch {
    return { ok: false, body: "", missing: [], error: "Source response is not JSON - template references cannot resolve." };
  }
  const { text, missing } = renderTemplate(template, source, ctx);
  try {
    JSON.parse(text);
  } catch {
    return { ok: false, body: text, missing, error: "Rendered template is not valid JSON - check quotes around {{refs}}." };
  }
  return { ok: true, body: text, missing, error: null };
}
