/**
 * Masking pipeline: everything quoted TO the model passes through here.
 * Raw bodies stay verbatim in the browser (evidence must be exact); only
 * the slices handed to LLM tools get scrubbed. Business data (SOQL
 * literals, ids, amounts) is never touched - only credential-shaped
 * material: bearer tokens, session ids, frontdoor sids, secrets and emails.
 */

const RULES: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
  // ?token=.. &sessionId=.. key=value credentials in URLs
  [/([?&](?:token|session_?id|auth|api_?key)[^=]*=)[^&\s"']+/gi, "$1[REDACTED]"],
  // frontdoor-style session: 00D...!...
  [/(00D[a-zA-Z0-9]{12,15}![A-Za-z0-9._~+/=-]+)/g, "[REDACTED_SESSION]"],
  // password=.. client_secret: .. (quoted or bare)
  [/((?:password|passwd|pwd|client_secret|secret)["'\s:=]+)[^\s&,;"']+/gi, "$1[REDACTED]"],
  // emails - PII the model never needs to fix a transaction
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of RULES) out = out.replace(re, replacement);
  return out;
}

export function maskRawLines<T extends { raw: string }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, raw: maskSecrets(l.raw) }));
}
