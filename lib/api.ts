/**
 * Browser → Next.js API fetch with a hard timeout.
 * All Salesforce traffic goes through our proxy routes, so every client
 * call site uses this instead of raw fetch (no call ever hangs forever).
 */
export const API_TIMEOUT_MS = 30000;

/** Thrown when apiFetch hits its own timeout (not a user Stop). */
export class ApiTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(
      `Request timed out after ${timeoutMs / 1000}s - check your connection and try again.`
    );
    this.name = "ApiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export async function apiFetch(
  path: string,
  body: unknown,
  timeoutMs: number = API_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternal = () => ctrl.abort();
  externalSignal?.addEventListener("abort", onExternal, { once: true });
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Caller distinguishes user-Stop (its own controller) from timeout
      // via ApiTimeoutError.
      throw new ApiTimeoutError(timeoutMs);
    }
    throw err instanceof Error ? err : new Error("Network error");
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternal);
  }
}
