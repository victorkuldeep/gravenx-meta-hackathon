import { describe, expect, it } from "vitest";
import { encodePath } from "./encode";

const SOQL =
  "SELECT Id, Sirion_CLM__Account_Name__c FROM Sirion_CLM__Contract_Draft__c WHERE Sirion_CLM__Account_Name__c = '001WE00001OtWKKYA3' AND Sirion_CLM__CDR_Status__c LIKE '%Active%'";
const SOQL_ENCODED = encodeURIComponent(SOQL);

describe("rest proxy path encoding", () => {
  it("leaves paths without a query string untouched", () => {
    expect(encodePath("/services/data/v66.0/sobjects/")).toBe("/services/data/v66.0/sobjects/");
  });

  it("encodes a raw pasted query string exactly once", () => {
    const out = encodePath(`/services/data/v66.0/query/?q=${SOQL}`);
    expect(out).toBe(`/services/data/v66.0/query/?q=${SOQL_ENCODED}`);
    // LIKE wildcards encode, nothing double-encodes.
    expect(out).toContain("LIKE%20'%25Active%25'");
    expect(out).not.toContain("%25Active%2525");
  });

  it("does not double-encode an already-encoded query string", () => {
    const out = encodePath(`/services/data/v66.0/query/?q=${SOQL_ENCODED}`);
    expect(out).toBe(`/services/data/v66.0/query/?q=${SOQL_ENCODED}`);
    expect(out).not.toContain("%2520");
    expect(out).not.toContain("%2525");
  });

  it("keeps parameter structure: & splits, = inside values survives", () => {
    const out = encodePath("/x?explain=SELECT Id FROM A WHERE X = 'a=b'&pretty=true");
    expect(out).toBe("/x?explain=SELECT%20Id%20FROM%20A%20WHERE%20X%20%3D%20'a%3Db'&pretty=true");
  });

  it("treats + as a space, like salesforce does", () => {
    expect(encodePath("/x?q=a+b")).toBe("/x?q=a%20b");
    // A literal plus arrives pre-encoded and stays literal.
    expect(encodePath("/x?q=a%2Bb")).toBe("/x?q=a%2Bb");
  });
});
