import { describe, expect, it } from "vitest";
import { maskRawLines, maskSecrets } from "./mask";

describe("masking pipeline", () => {
  it("scrubs credential-shaped material for the model", () => {
    expect(maskSecrets("Authorization: Bearer 00Dxx0000001abc.token123")).toBe("Authorization: Bearer [REDACTED]");
    expect(maskSecrets("POST https://x.example/cb?sessionId=abc123&ok=1")).toBe(
      "POST https://x.example/cb?sessionId=[REDACTED]&ok=1"
    );
    expect(maskSecrets("sid=00DAAAAAAAAAAA01!TESTSESSIONVALUE")).toBe("sid=[REDACTED_SESSION]");
    expect(maskSecrets('client_secret="shh-dont-tell"')).toBe('client_secret="[REDACTED]"');
    expect(maskSecrets("notify jane.doe@example.com now")).toBe("notify [REDACTED_EMAIL] now");
  });

  it("leaves business data and ids untouched", () => {
    const soql = "SELECT Id FROM Account WHERE Name = 'Acme' AND Amount__c = 42";
    expect(maskSecrets(soql)).toBe(soql);
    expect(maskSecrets("005h000009Yhb4EAQ")).toBe("005h000009Yhb4EAQ");
    const lines = maskRawLines([{ line: 1, raw: "pwd=hunter2 ok" }]);
    expect(lines[0].raw).toBe("pwd=[REDACTED] ok");
    expect(lines[0].line).toBe(1);
  });
});
