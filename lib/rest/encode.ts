/**
 * Query-string encoding for the REST proxy. Architects paste paths both
 * ways - raw (`?q=SELECT Id ... LIKE '%Active%'`) and pre-encoded
 * (`?q=SELECT%20Id...`) - and both must reach Salesforce encoded exactly
 * once. A blanket encodeURI double-encodes pasted input (%20 -> %2520),
 * which Salesforce rejects as a malformed query.
 */

/** Idempotent segment codec: decode first (normalizes pasted input), then encode. */
function codec(segment: string): string {
  try {
    // `+` reads as a space in query strings (a literal plus arrives %2B,
    // which this swap leaves untouched).
    return encodeURIComponent(decodeURIComponent(segment.replace(/\+/g, " ")));
  } catch {
    // Lone `%` (a raw LIKE wildcard) is not decodable - encode it as-is.
    return encodeURIComponent(segment.replace(/\+/g, " "));
  }
}

/** Encode the query string per parameter (split on & and the first =), path untouched. */
export function encodePath(path: string): string {
  const q = path.indexOf("?");
  if (q === -1) return path;
  const head = path.slice(0, q);
  const tail = path.slice(q + 1);
  if (!tail) return path;
  const out = tail.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return codec(pair);
    return `${codec(pair.slice(0, eq))}=${codec(pair.slice(eq + 1))}`;
  });
  return `${head}?${out.join("&")}`;
}
