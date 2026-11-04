export interface ParsedHeader {
  key: string;
  value: string;
}

export interface ParsedCurl {
  method: string;
  url: string;
  headers: ParsedHeader[];
  body: string;
  warnings: string[];
}

const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Flags that change nothing about the request itself.
const IGNORED_FLAGS = new Set([
  "--location",
  "-L",
  "--compressed",
  "--silent",
  "-s",
  "--insecure",
  "-k",
  "--include",
  "-i",
  "--show-error",
  "-S",
  "--globoff",
  "-g",
]);

/** Shell-ish tokenizer: quotes, backslash-newline continuations, $'…' escapes. */
function tokenize(input: string): string[] {
  // Line continuations first
  const src = input.replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let ansi = false;
  let chunkHasContent = false;

  const push = () => {
    if (chunkHasContent) tokens.push(cur);
    cur = "";
    chunkHasContent = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
        ansi = false;
      } else if (ansi && ch === "\\" && i + 1 < src.length) {
        const nxt = src[i + 1];
        if (nxt === "n") cur += "\n";
        else if (nxt === "t") cur += "\t";
        else if (nxt === "r") cur += "\r";
        else if (nxt === "'") cur += "'";
        else if (nxt === "\\") cur += "\\";
        else if (nxt === "x" && i + 3 < src.length) {
          const hex = src.slice(i + 2, i + 4);
          cur += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else cur += nxt;
        i++;
        chunkHasContent = true;
      } else {
        cur += ch;
        chunkHasContent = true;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        chunkHasContent = true;
      } else if (ch === "\\" && i + 1 < src.length) {
        const nxt = src[i + 1];
        if (nxt === '"' || nxt === "\\" || nxt === "$" || nxt === "`") {
          cur += nxt;
          i++;
        } else if (nxt === "n") {
          cur += "\n";
          i++;
        } else if (nxt === "t") {
          cur += "\t";
          i++;
        } else {
          cur += ch;
        }
        chunkHasContent = true;
      } else {
        cur += ch;
        chunkHasContent = true;
      }
      continue;
    }

    // Unquoted
    if (ch === "'" && cur === "$" && chunkHasContent) {
      // $'...' ANSI-C quoting
      cur = "";
      quote = "'";
      ansi = true;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      ansi = false;
      chunkHasContent = true;
      continue;
    }
    if (ch === '"') {
      quote = '"';
      chunkHasContent = true;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    if (ch === "\\" && i + 1 < src.length) {
      const nxt = src[i + 1];
      if (ansi) {
        if (nxt === "n") cur += "\n";
        else if (nxt === "t") cur += "\t";
        else if (nxt === "r") cur += "\r";
        else cur += nxt;
        i++;
      } else {
        cur += nxt;
        i++;
      }
      chunkHasContent = true;
      continue;
    }
    cur += ch;
    chunkHasContent = true;
  }
  push();
  return tokens;
}

function splitHeader(raw: string): ParsedHeader | null {
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  return { key: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() };
}

/**
 * Parse a pasted cURL command into method + url + headers + body.
 * Lenient by design (Postman, docs and terminals all emit variants).
 * Throws with a human message when nothing usable is found.
 */
export function parseCurl(input: string): ParsedCurl {
  const text = (input ?? "").trim();
  if (!text) throw new Error("Paste a cURL command first.");
  if (!/^\s*curl\b/i.test(text)) {
    throw new Error("That doesn't look like cURL - it should start with `curl`.");
  }

  const tokens = tokenize(text);
  let method: string | null = null;
  let url = "";
  const headers: ParsedHeader[] = [];
  const bodies: string[] = [];
  const warnings: string[] = [];
  let hasAuthHeader = false;

  const takeValue = (i: number, flag: string): string => {
    // Supports both `--flag value` and `--flag=value`
    const eq = tokens[i].indexOf("=");
    if (eq !== -1 && tokens[i].startsWith("--")) return tokens[i].slice(eq + 1);
    if (i + 1 >= tokens.length) throw new Error(`Missing value after ${flag}.`);
    return tokens[i + 1];
  };
  const consumedValue = (i: number): boolean => {
    return !(tokens[i].includes("=") && tokens[i].startsWith("--"));
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const low = t.toLowerCase();

    if (i === 0) continue; // the `curl` itself
    if (IGNORED_FLAGS.has(t) || IGNORED_FLAGS.has(low)) continue;

    if (t === "-X" || t === "--request" || t.startsWith("--request=")) {
      method = takeValue(i, t).toUpperCase();
      if (consumedValue(i)) i++;
      continue;
    }
    if (/^-X[A-Za-z]+$/.test(t)) {
      // Attached form: -XPOST
      method = t.slice(2).toUpperCase();
      continue;
    }
    if (t === "-H" || t === "--header" || t.startsWith("--header=")) {
      const raw = takeValue(i, t);
      if (consumedValue(i)) i++;
      const h = splitHeader(raw);
      if (h) {
        headers.push(h);
        if (h.key.toLowerCase() === "authorization") hasAuthHeader = true;
      } else {
        warnings.push(`Skipped malformed header: ${raw.slice(0, 40)}`);
      }
      continue;
    }
    if (
      t === "-d" ||
      t === "--data" ||
      t === "--data-raw" ||
      t === "--data-binary" ||
      t === "--data-ascii" ||
      t === "--data-urlencode" ||
      t.startsWith("--data=") ||
      t.startsWith("--data-raw=") ||
      t.startsWith("--data-binary=") ||
      t.startsWith("--data-ascii=") ||
      t.startsWith("--data-urlencode=")
    ) {
      const payload = takeValue(i, t);
      if (consumedValue(i)) i++;
      bodies.push(payload);
      continue;
    }
    if (t === "-u" || t === "--user" || t.startsWith("--user=")) {
      const creds = takeValue(i, t);
      if (consumedValue(i)) i++;
      if (!hasAuthHeader) {
        try {
          const b64 =
            typeof btoa !== "undefined"
              ? btoa(unescape(encodeURIComponent(creds)))
              : Buffer.from(creds, "utf8").toString("base64");
          headers.push({ key: "Authorization", value: `Basic ${b64}` });
          hasAuthHeader = true;
        } catch {
          warnings.push("Could not encode -u credentials, skipped.");
        }
      }
      continue;
    }
    if (t === "-A" || t === "--user-agent" || t.startsWith("--user-agent=")) {
      const v = takeValue(i, t);
      if (consumedValue(i)) i++;
      headers.push({ key: "User-Agent", value: v });
      continue;
    }
    if (t === "-e" || t === "--referer" || t.startsWith("--referer=")) {
      const v = takeValue(i, t);
      if (consumedValue(i)) i++;
      headers.push({ key: "Referer", value: v });
      continue;
    }
    if (t === "-b" || t === "--cookie" || t.startsWith("--cookie=")) {
      const v = takeValue(i, t);
      if (consumedValue(i)) i++;
      headers.push({ key: "Cookie", value: v });
      continue;
    }
    if (t === "--url" || t.startsWith("--url=")) {
      url = takeValue(i, t);
      if (consumedValue(i)) i++;
      continue;
    }
    if (t.startsWith("-") && !t.startsWith("http") && !t.startsWith("/")) {
      warnings.push(`Ignored unsupported flag: ${t}`);
      continue;
    }
    // Bare token: URL or path
    if (!url && (/^https?:\/\//i.test(t) || t.startsWith("/"))) {
      url = t;
      continue;
    }
  }

  if (!url) throw new Error("No URL found in the pasted command.");

  const finalMethod = (method ?? (bodies.length > 0 ? "POST" : "GET")).toUpperCase();
  if (!SUPPORTED_METHODS.has(finalMethod)) {
    throw new Error(`HTTP method ${finalMethod} isn't supported - use GET, POST, PUT, PATCH or DELETE.`);
  }

  if (headers.length > 10) {
    warnings.push(`Kept the first 10 of ${headers.length} headers (proxy limit).`);
  }

  return {
    method: finalMethod,
    url,
    headers: headers.slice(0, 10),
    body: bodies.join("&"),
    warnings,
  };
}
