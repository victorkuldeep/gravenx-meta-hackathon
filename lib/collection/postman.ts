import type { CollectionItem } from "./types";

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * Build a Postman Collection v2.1 document.
 * Org origins become the {{baseUrl}} variable, tokens become {{accessToken}},
 * so the downloaded file imports cleanly and runs anywhere.
 */
export function buildPostmanCollection(
  name: string,
  items: CollectionItem[]
): Record<string, unknown> {
  const firstOrigin = items.find((i) => i.origin)?.origin ?? "";

  return {
    info: {
      name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
    },
    variable: [
      {
        key: "baseUrl",
        value: firstOrigin,
        description: "Salesforce org instance URL (no trailing slash)",
      },
      {
        key: "accessToken",
        value: "",
        description: "Paste a session access token here - never stored in this file",
      },
    ],
    item: items.map((item) => {
      const raw = item.origin && item.url.startsWith(item.origin)
        ? item.url.replace(item.origin, "{{baseUrl}}")
        : item.url;
      return {
        name: item.name,
        request: {
          auth: {
            type: "bearer",
            bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
          },
          method: item.method,
          header: [
            { key: "Content-Type", value: "application/json", type: "text" },
          ],
          body: {
            mode: "raw",
            raw: JSON.stringify(item.body, null, 2),
            options: { raw: { language: "json" } },
          },
          url: { raw },
        },
        response: [],
      };
    }),
  };
}

export function collectionFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `salesforce-payloads-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.postman_collection.json`;
}

export function downloadTextFile(fileName: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
