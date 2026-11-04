"use client";

/**
 * Session credential vault (env-var style): KEY = secret rows kept in tab
 * memory (+ sessionStorage mirror so in-app navigation keeps them), cleared
 * on demand. Referenced as $env.NAME inside request bodies, header values
 * and bearer tokens. NEVER persisted to IDB, projects, exports or history -
 * resolution happens at send time and only redacted traces remain.
 */

export type CredVault = Record<string, string>;

const NAME_PATTERN = /^[A-Z0-9_]{1,64}$/;

export function isValidCredName(name: string): boolean {
  return NAME_PATTERN.test(name.trim());
}

export function normalizeCredName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
}

/** Find $env.NAME references in a text (names only, no values leak). */
export function findEnvRefs(text: string): string[] {
  const out: string[] = [];
  const re = /\$env\.([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Vault keys are uppercase-normalized on entry (see CredentialsModal) while
 * authors naturally write lowercase refs - resolve case-insensitively so a
 * lowercase ref hits its normalized entry. Exact keys still win (legacy
 * mixed-case entries keep working). */
function lookupVault(name: string, vault: CredVault): string | undefined {
  if (name in vault) return vault[name];
  const folded = normalizeCredName(name);
  if (folded in vault) return vault[folded];
  return undefined;
}

/** Refs in texts that have no vault entry - senders must block on these. */
export function findMissingVars(texts: string[], vault: CredVault): string[] {
  const missing: string[] = [];
  for (const t of texts) {
    for (const name of findEnvRefs(t)) {
      if (lookupVault(name, vault) === undefined && !missing.includes(name)) missing.push(name);
    }
  }
  return missing;
}

export interface ResolvedText {
  text: string;
  missing: string[];
}

/** Scrub resolved secret values from text before persisting to history/IDB.
 * Vault values are never written to disk - previews keep their shape. */
export function scrubSecrets(text: string, vault: CredVault): string {  let out = text;
  const values = Object.values(vault).filter((v) => v.length >= 3);
  values.sort((a, b) => b.length - a.length);
  for (const v of values) {
    if (out.includes(v)) out = out.split(v).join("***");
  }
  return out;
}

/**
 * Heuristic tripwire for literal secrets typed into STORED config (headers,
 * samples) - stored values export with the project, vault refs do not.
 * $env refs always pass. Conservative on purpose: unknown shapes pass, only
 * known provider prefixes, private keys and long opaque Bearer tokens flag.
 */
const SECRET_PREFIXES = /gsk_|sk-|xox[bpa]-|github_pat_|ghp_|gho_|ghu_|AKIA|AIza|-----BEGIN [A-Z ]*PRIVATE KEY/i;
const LONG_BEARER = /Bearer\s+[A-Za-z0-9_\-~+/=]{24,}/;

export function looksLikeSecret(value: string): boolean {
  if (!value || value.includes("$env.")) return false;
  return SECRET_PREFIXES.test(value) || LONG_BEARER.test(value);
}

/** Substitute known refs. Unknown refs are left literal AND reported -
 * callers block the send when missing is non-empty. */
export function resolveEnvVars(text: string, vault: CredVault): ResolvedText {
  const missing: string[] = [];
  const out = text.replace(/\$env\.([A-Za-z0-9_]+)/g, (_m, name: string) => {
    const hit = lookupVault(name, vault);
    if (hit !== undefined) return hit;
    if (!missing.includes(name)) missing.push(name);
    return _m;
  });
  return { text: out, missing };
}
