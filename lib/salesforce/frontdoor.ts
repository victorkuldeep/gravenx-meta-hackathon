export interface FrontdoorSession {
  instanceUrl: string;
  token: string;
}

const FRONTDOOR_PATH = /\/secur\/frontdoor\.jsp/i;

/**
 * Parse a Salesforce frontdoor URL of the form:
 * https://<mydomain>.my.salesforce.com/secur/frontdoor.jsp?sid=<SESSION_ID>
 * into an instance URL + session token pair (the sid works as a Bearer token).
 * Throws with a human-readable message when the input is not usable.
 */
export function parseFrontdoorUrl(input: string): FrontdoorSession {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new Error("Paste a frontdoor URL first");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That doesn't look like a URL - paste the full frontdoor.jsp link");
  }

  if (url.protocol !== "https:") {
    throw new Error("Frontdoor URL must start with https://");
  }
  if (!FRONTDOOR_PATH.test(url.pathname)) {
    throw new Error("Not a frontdoor link - it must contain /secur/frontdoor.jsp?sid=…");
  }
  const sid = url.searchParams.get("sid");
  if (!sid) {
    throw new Error("No sid parameter found - copy the full link including ?sid=…");
  }
  return { instanceUrl: url.origin, token: sid };
}

/** True when the value looks like a frontdoor link (used for auto-detect). */
export function looksLikeFrontdoor(input: string): boolean {
  const v = (input ?? "").trim().toLowerCase();
  return v.startsWith("https://") && v.includes("frontdoor.jsp") && v.includes("sid=");
}
