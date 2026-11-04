import { z } from "zod";

/**
 * Generic share envelope: lets System projects, Sequences and Wireframe
 * experiences travel through the same ephemeral KV share backend as ERD
 * canvases. Payloads are org-independent models only - never tokens,
 * never live field data. 30-minute TTL, same as structure shares.
 */

export const SHARE_ENVELOPE_KINDS = ["sequence", "experience", "system-project"] as const;
export type ShareEnvelopeKind = (typeof SHARE_ENVELOPE_KINDS)[number];

/** Cap per envelope: models are small; runs and screenshots stay local. */
export const SHARE_ENVELOPE_MAX_BYTES = 400 * 1024;

const envelopeSchema = z.object({
  v: z.number(),
  kind: z.enum(SHARE_ENVELOPE_KINDS),
  name: z.string().min(1).max(200),
  // Required payload: z.unknown() alone infers optional in Zod 4, so the
  // presence check is explicit and the type stays `unknown`, never `any`.
  data: z.custom<unknown>((v) => v !== undefined),
});

export interface ShareEnvelope {
  v: number;
  kind: ShareEnvelopeKind;
  name: string;
  data: unknown;
}

export function validateShareEnvelope(raw: unknown): ShareEnvelope | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.v !== 1) return null;
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(parsed.data)).length;
  } catch {
    return null;
  }
  if (bytes > SHARE_ENVELOPE_MAX_BYTES) return null;
  // Rebuild explicitly: the custom data check guarantees presence at
  // runtime, and the literal keeps the key required in the type.
  const { v, kind, name, data } = parsed.data;
  return { v, kind, name, data };
}

export function buildShareEnvelope(kind: ShareEnvelopeKind, name: string, data: unknown): ShareEnvelope {
  return { v: 1, kind, name: name.slice(0, 200) || "Shared", data };
}
