import { SalesforceApiError } from "./types";
import { normalizeSalesforceUrl } from "./url";

interface SfFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Low-level Salesforce REST fetch. Never logs the token.
 * `url` must be a fully-qualified URL.
 */
export async function sfFetch<T>(
  fullUrl: string,
  token: string,
  options: SfFetchOptions = {}
): Promise<T> {
  const fetchOptions: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: options.signal,
  };

  if (options.body !== undefined && options.method !== "GET") {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(fullUrl, fetchOptions);
  } catch (err) {
    if (err instanceof Error) {
      throw new SalesforceApiError(`Network error: ${err.message}`, 0);
    }
    throw new SalesforceApiError("Network error: unknown", 0);
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status} ${response.statusText}`;
    let errorCode: string | undefined;
    let fields: string[] | undefined;

    try {
      const errBody = (await response.json()) as
        | Array<{ message: string; errorCode: string; fields?: string[] }>
        | { message: string; errorCode: string; fields?: string[] };

      const firstError = Array.isArray(errBody) ? errBody[0] : errBody;
      if (firstError?.message) {
        errorMessage = firstError.message;
        errorCode = firstError.errorCode;
        fields = firstError.fields;
      }
    } catch {
      // ignore JSON parse failure - use status text
    }

    throw new SalesforceApiError(
      getHumanErrorMessage(response.status, errorMessage),
      response.status,
      errorCode,
      fields
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new SalesforceApiError("Failed to parse Salesforce response as JSON.", response.status);
  }
}

/**
 * Versioned Salesforce API fetch - constructs the full URL from components.
 */
export async function sfFetchVersioned<T>(
  instanceUrl: string,
  token: string,
  apiVersion: string,
  path: string,
  options: SfFetchOptions = {}
): Promise<T> {
  const normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const p = path.startsWith("/") ? path : `/${path}`;
  const fullUrl = `${normalizedUrl}/services/data/${ver}${p}`;
  return sfFetch<T>(fullUrl, token, options);
}

function getHumanErrorMessage(status: number, detail: string): string {
  switch (status) {
    case 400:
      return `400 Bad Request - ${detail}`;
    case 401:
      return `401 Unauthorized - the access token may be expired or invalid. ${detail}`;
    case 403:
      return `403 Forbidden - insufficient permissions to access this resource. ${detail}`;
    case 404:
      return `404 Not Found - the object or resource does not exist. ${detail}`;
    case 409:
      return `409 Conflict - ${detail}`;
    case 429:
      return `429 Too Many Requests - Salesforce API rate limit exceeded. ${detail}`;
    default:
      if (status >= 500) {
        return `${status} Salesforce Server Error - ${detail}`;
      }
      return `${status} - ${detail}`;
  }
}

// ── Timeouts & session-expiry detection (shared by API routes) ────────────

/** Salesforce leg timeout - the browser leg uses a longer budget (see lib/api.ts). */
export const SF_TIMEOUT_MS = 25000;

export function sfTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(SF_TIMEOUT_MS);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function sfTimeoutMessage(): string {
  return `Salesforce did not respond within ${SF_TIMEOUT_MS / 1000}s - the org may be slow or unreachable. Try again.`;
}

/** True when an error message means the session is dead (expired/invalid token). */
export function isSessionExpiredMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return (
    /\b401\b/.test(message) ||
    /unauthori[sz]ed|invalid_session_id|session (has )?expired|session (is )?invalid|expired or invalid/i.test(
      message
    )
  );
}
