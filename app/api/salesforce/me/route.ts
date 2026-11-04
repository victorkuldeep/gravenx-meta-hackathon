import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";

/**
 * POST-only identity lookup: who owns this token. The browser posts the
 * token in the body (never a URL); the server calls userinfo and returns
 * the 15/18-char user id plus display name for one-click self-tracing.
 */

const bodySchema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
});

const userinfoSchema = z.object({
  user_id: z.string().optional(),
  preferred_username: z.string().optional(),
  username: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
});

function userIdFromUserinfo(userId: string | undefined): string | null {
  if (!userId) return null;
  const tail = userId.split("/").pop() ?? "";
  return /^[a-zA-Z0-9]{15,18}$/.test(tail) ? tail : null;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { instanceUrl, token } = parsed.data;

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid instance URL" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${normalizedUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: sfTimeoutSignal(),
    });
  } catch (err) {
    if (isAbortError(err)) return NextResponse.json({ error: sfTimeoutMessage() }, { status: 504 });
    return NextResponse.json({ error: `Network error: ${err instanceof Error ? err.message : "unknown"}` }, { status: 502 });
  }
  if (!response.ok) {
    if (response.status === 401) {
      return NextResponse.json({ error: "401 Unauthorized - the access token may be expired or invalid." }, { status: 401 });
    }
    return NextResponse.json({ error: `userinfo failed: ${response.status} ${response.statusText}` }, { status: response.status });
  }
  try {
    const info = userinfoSchema.parse(await response.json());
    const userId = userIdFromUserinfo(info.user_id);
    if (!userId) return NextResponse.json({ error: "userinfo returned no usable user id." }, { status: 502 });
    return NextResponse.json({
      success: true,
      userId,
      username: info.preferred_username ?? info.username ?? null,
      name: info.name ?? null,
      email: info.email ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse userinfo response" }, { status: 502 });
  }
}
