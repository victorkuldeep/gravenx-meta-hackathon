import { describe, it, expect } from "vitest";
import {
  soapVersion,
  escapeXml,
  categoryLevels,
  soapCategory,
  buildExecuteAnonymousEnvelope,
  parseApexSoapResponse,
  parseSoapFault,
  apexSummary,
  apexHeaderLine,
} from "./apex";

describe("soapVersion", () => {
  it("strips the v prefix", () => {
    expect(soapVersion("v68.0")).toBe("68.0");
    expect(soapVersion("68.0")).toBe("68.0");
  });
});

describe("escapeXml", () => {
  it("escapes code safely", () => {
    expect(escapeXml(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });
});

describe("categoryLevels", () => {
  it("runs the chosen category at the chosen level", () => {
    const l = categoryLevels("Db", "Fine");
    expect(l.Db).toBe("Fine");
    expect(l.Workflow).toBe("INFO");
  });

  it("never drops ApexCode below DEBUG unless chosen", () => {
    expect(categoryLevels("Db", "Info").ApexCode).toBe("DEBUG");
    expect(categoryLevels("ApexCode", "Error").ApexCode).toBe("Error");
  });
});

describe("buildExecuteAnonymousEnvelope", () => {
  it("carries session, debug levels and escaped code", () => {
    const xml = buildExecuteAnonymousEnvelope(`System.debug("x");`, "ApexCode", "Debug", "SID");
    expect(xml).toContain("<apex:sessionId>SID</apex:sessionId>");
    expect(xml).toContain("<apex:category>Apex_code</apex:category><apex:level>Debug</apex:level>");
    expect(xml).toContain("System.debug(&quot;x&quot;);");
  });
  it("uses SOAP LogCategory enum names (Apex_code, Apex_profiling)", () => {
    expect(soapCategory("ApexCode")).toBe("Apex_code");
    expect(soapCategory("ApexProfiling")).toBe("Apex_profiling");
    expect(soapCategory("Db")).toBe("Db");
    for (const cat of ["ApexCode", "ApexProfiling"] as const) {
      const xml = buildExecuteAnonymousEnvelope("System.debug(1);", cat, "Debug", "SID");
      expect(xml).not.toContain(`<apex:category>${cat}</apex:category>`);
    }
    expect(buildExecuteAnonymousEnvelope("System.debug(1);", "Db", "Info", "SID")).toContain(
      "<apex:category>Apex_code</apex:category><apex:level>DEBUG</apex:level>"
    );
  });
});

const SOAP_OK = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Body><executeAnonymousResponse><result>
<compiled>true</compiled><success>true</success><line>-1</line><column>-1</column>
<debugLog>10:55:54.33|USER_DEBUG|[1]|DEBUG|Hello &amp; bye</debugLog>
</result></executeAnonymousResponse></soapenv:Body></soapenv:Envelope>`;

describe("parseApexSoapResponse", () => {
  it("parses a clean execution with unescaped log", () => {
    const r = parseApexSoapResponse(SOAP_OK);
    expect(r).toEqual({
      compiled: true,
      success: true,
      line: null,
      column: null,
      compileProblem: null,
      exceptionMessage: null,
      exceptionStackTrace: null,
      debugLog: "10:55:54.33|USER_DEBUG|[1]|DEBUG|Hello & bye",
    });
    expect(apexSummary(r)).toBe("Executed clean");
  });

  it("parses compile and runtime failures", () => {
    const bad = parseApexSoapResponse("<r><compiled>false</compiled><success>false</success><line>3</line><compileProblem>Unexpected token</compileProblem></r>");
    expect(bad.compiled).toBe(false);
    expect(apexSummary(bad)).toContain("line 3");
    const ex = parseApexSoapResponse("<r><compiled>true</compiled><success>false</success><exceptionMessage>System.DmlException</exceptionMessage></r>");
    expect(apexSummary(ex)).toContain("System.DmlException");
  });

  it("never throws on garbage", () => {
    expect(parseApexSoapResponse(null).success).toBe(false);
    expect(parseApexSoapResponse("oops").debugLog).toBeNull();
  });

  it("extracts SOAP faults", () => {
    expect(parseSoapFault("<faultstring>INVALID_SESSION_ID</faultstring>")).toBe("INVALID_SESSION_ID");
    expect(parseSoapFault("nope")).toBeNull();
  });
});

describe("apexHeaderLine", () => {
  it("mirrors the Workbench header", () => {
    expect(apexHeaderLine("v68.0", "ApexCode", "Debug")).toBe("68.0 APEX_CODE,DEBUG");
    expect(apexHeaderLine("68.0", "Db", "Fine")).toBe("68.0 DATABASE,FINE");
  });
});
