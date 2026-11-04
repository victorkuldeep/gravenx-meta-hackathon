import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  soql: z.string().min(1).max(20000),
  tooling: z.boolean().optional().default(false),
  allRows: z.boolean().optional().default(false),
  pageUrl: z.string().max(4000).optional(),
});

// Two-phase fetching: the first call pulls a fast path of up to 10 pages
// (2000 rows/page = 20k rows) and hands back nextRecordsUrl when more remain.
// The Query tab then drives paging client-side, one short-lived page per
// request, until done - so a lakh-scale result set never has to fit inside a
// single server call's budget. No 50k cap anywhere: that limit is the
// synchronous Apex governor, not the REST query API, which paginates
// (via nextRecordsUrl) without a platform total.
const MAX_PAGES = 10;

class SfPageError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SfPageError";
    this.status = status;
  }
}

type SfPage = {
  totalSize: number;
  done: boolean;
  records?: unknown[];
  nextRecordsUrl?: string;
};

async function fetchQueryPage(
  url: string,
  headers: { Authorization: string; Accept: string }
): Promise<SfPage> {
  const response: Response = await fetch(url, { headers, signal: sfTimeoutSignal() });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const errBody = (await response.json()) as Array<{ message: string }> | { message: string };
      const first = Array.isArray(errBody) ? errBody[0] : errBody;
      if (first?.message) message = first.message;
    } catch {
      /* ignore */
    }
    throw new SfPageError(message, response.status);
  }
  return (await response.json()) as SfPage;
}

function pageErrorResponse(err: unknown) {
  if (err instanceof SfPageError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (isAbortError(err)) {
    return NextResponse.json({ error: sfTimeoutMessage(), success: false }, { status: 504 });
  }
  return NextResponse.json(
    { error: `Network error: ${err instanceof Error ? err.message : "unknown"}`, success: false },
    { status: 502 }
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { instanceUrl, token, apiVersion, soql, tooling, allRows, pageUrl } = parsed.data;

  if (tooling && allRows) {
    return NextResponse.json(
      { error: "Deleted/archived rows (queryAll) are not supported with the Tooling API." },
      { status: 400 }
    );
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid instance URL" },
      { status: 400 }
    );
  }

  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const op = tooling ? "tooling/query" : allRows ? "queryAll" : "query";
  let nextUrl: string | null = `${normalizedUrl}/services/data/${ver}/${op}?q=${encodeURIComponent(soql)}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  // Continuation page: the locator already encodes the query + op, so the
  // body flags are irrelevant here. Strictly org-relative (SSRF guard).
  if (pageUrl) {
    if (!pageUrl.startsWith("/services/data/")) {
      return NextResponse.json(
        { error: "pageUrl must be a Salesforce query locator path." },
        { status: 400 }
      );
    }
    try {
      const page = await fetchQueryPage(`${normalizedUrl}${pageUrl}`, headers);
      return NextResponse.json({
        success: true,
        records: Array.isArray(page.records) ? page.records : [],
        totalSize: page.totalSize,
        done: page.done,
        nextRecordsUrl: !page.done && page.nextRecordsUrl ? page.nextRecordsUrl : null,
      });
    } catch (err) {
      return pageErrorResponse(err);
    }
  }

  const startTime = Date.now();
  const records: unknown[] = [];
  let totalSize = 0;
  let done = true;
  let pages = 0;

  try {
    while (nextUrl && pages < MAX_PAGES) {
      // nextRecordsUrl is org-relative - resolve against the instance origin
      const url = nextUrl.startsWith("http")
        ? nextUrl
        : `${normalizedUrl}${nextUrl.startsWith("/") ? "" : "/"}${nextUrl}`;
      const page = await fetchQueryPage(url, headers);
      totalSize = page.totalSize;
      done = page.done;
      if (Array.isArray(page.records)) records.push(...page.records);
      pages += 1;
      nextUrl = !page.done && page.nextRecordsUrl ? page.nextRecordsUrl : null;
    }
  } catch (err) {
    return pageErrorResponse(err);
  }

  return NextResponse.json({
    success: true,
    records,
    totalSize,
    done,
    truncated: !done,
    nextRecordsUrl: !done && nextUrl ? nextUrl : null,
    pages,
    responseTime: Date.now() - startTime,
  });
}
