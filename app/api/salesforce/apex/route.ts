import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import {
  buildExecuteAnonymousEnvelope,
  parseApexSoapResponse,
  parseSoapFault,
  soapVersion,
  type LogCategory,
  type LogLevel,
} from "@/lib/salesforce/apex";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  code: z.string().min(1).max(100000),
  logCategory: z.enum(["Db", "Workflow", "Validation", "Callout", "ApexCode", "ApexProfiling"]),
  logLevel: z.enum(["None", "Error", "Warn", "Info", "Debug", "Fine", "Finer", "Finest"]),
});

/**
 * Anonymous Apex over the SOAP Apex API (like Workbench): DebuggingHeader
 * carries the log category + level, and the debug log comes back inline in
 * the same response - no TraceFlag litter, no log polling.
 */
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

  const { instanceUrl, token, apiVersion, code, logCategory, logLevel } = parsed.data;

  let origin: string;
  try {
    origin = new URL(normalizeSalesforceUrl(instanceUrl)).origin;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid instance URL" },
      { status: 400 }
    );
  }

  const endpoint = `${origin}/services/Soap/s/${soapVersion(apiVersion)}`;
  const envelope = buildExecuteAnonymousEnvelope(code, logCategory as LogCategory, logLevel as LogLevel, token);

  const startTime = Date.now();
  let raw: string;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        SOAPAction: '""',
      },
      body: envelope,
      signal: sfTimeoutSignal(),
    });
    raw = await response.text();
    if (!response.ok) {
      const fault = parseSoapFault(raw) ?? `${response.status} ${response.statusText}`;
      const expired = /invalid_session_id|session (has )?expired|session (is )?invalid/i.test(fault);
      return NextResponse.json({ error: fault }, { status: expired ? 401 : response.status });
    }
  } catch (err) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: sfTimeoutMessage(), success: false }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}`, success: false },
      { status: 502 }
    );
  }

  const result = parseApexSoapResponse(raw);
  return NextResponse.json({
    ok: true,
    result,
    responseTime: Date.now() - startTime,
  });
}
