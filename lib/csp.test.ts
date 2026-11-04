import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

async function csp(): Promise<string> {
  const config = nextConfig as unknown as {
    headers: () => Promise<{ headers: { key: string; value: string }[] }[]>;
  };
  const routes = await config.headers();
  const headers = routes.flatMap((r) => r.headers);
  return headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
}

describe("content security policy", () => {
  it("allows user-initiated Excalidraw library installs and nothing else new", async () => {
    const policy = await csp();
    const connect = policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src")) ?? "";
    expect(connect).toContain("https://libraries.excalidraw.com");
    expect(connect).toContain("'self'");
    // No open data: CDNs, fonts and images stay self-hosted.
    expect(policy).toContain("font-src 'self' data:");
    expect(policy).not.toMatch(/jsdelivr|unpkg|googleapis|gstatic/);
  });
});
