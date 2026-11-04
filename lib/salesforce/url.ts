export function normalizeSalesforceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");

  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://localhost")) {
    throw new Error(
      "Salesforce instance URL must use HTTPS. Example: https://myorg.my.salesforce.com"
    );
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new Error("Invalid Salesforce instance URL.");
  }
}

export function validateSalesforceUrl(url: string): boolean {
  try {
    normalizeSalesforceUrl(url);
    return true;
  } catch {
    return false;
  }
}

export function buildSalesforceApiUrl(instanceUrl: string, version: string, path: string): string {
  const base = instanceUrl.replace(/\/+$/, "");
  const ver = version.startsWith("v") ? version : `v${version}`;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}/services/data/${ver}${p}`;
}

/**
 * SSRF screen for custom-scope REST targets. Syntactic only (no DNS lookup,
 * so it stays portable to edge runtimes): no private/loopback/link-local
 * literals, no internal hostnames. Returns a reason when blocked, null when ok.
 */
export function screenTargetHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  if (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    bare.endsWith(".internal") ||
    bare.endsWith(".lan") ||
    bare.endsWith(".home") ||
    bare.endsWith(".invalid")
  ) {
    return `Host "${hostname}" looks internal - custom calls stay on public hosts.`;
  }

  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      return `IP ${hostname} is private, loopback or link-local - blocked.`;
    }
    return null;
  }

  if (bare.includes(":")) {
    const h = bare.toLowerCase();
    if (
      h === "::1" ||
      h === "::" ||
      h.startsWith("fe80:") ||
      h.startsWith("fec0:") ||
      h.startsWith("fc") ||
      h.startsWith("fd")
    ) {
      return `IP ${hostname} is loopback, link-local or private - blocked.`;
    }
    return null;
  }

  return null;
}
