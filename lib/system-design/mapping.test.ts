"use client";

import { describe, it, expect } from "vitest";
import { resolvePath, renderTemplate, compileMapping } from "./mapping";

describe("request namespaces", () => {
  const ctx = {
    seed: '{"order":{"id":"00000238"}}',
    steps: { sys_mw: '{"ack":true}' },
    request: '{"event":{"productOrder":{"id":"00000238"}}}',
    requests: { sys_mw: '{"event":{"productOrder":{"id":"00000238"}}}' },
  };
  it("resolves {{request}} whole and by path", () => {
    expect(renderTemplate("X={{request}}", {}, ctx).text).toBe(
      'X={"event":{"productOrder":{"id":"00000238"}}}'
    );
    expect(renderTemplate("X={{request.event.productOrder.id}}", {}, ctx).text).toBe('X="00000238"');
  });
  it("resolves {{requests.<id>}} whole and by path", () => {
    expect(renderTemplate("X={{requests.sys_mw}}", {}, ctx).text).toBe(
      'X={"event":{"productOrder":{"id":"00000238"}}}'
    );
    expect(renderTemplate("X={{requests.sys_mw.event.productOrder.id}}", {}, ctx).text).toBe(
      'X="00000238"'
    );
  });
  it("nulls missing request refs and reports them", () => {
    const r = renderTemplate("X={{requests.sys_missing}} Y={{request}}", {}, {});
    expect(r.text).toBe("X=null Y=null");
    expect(r.missing).toEqual(["requests.sys_missing", "request"]);
  });
  it("wraps a prior payload via template (TMF688 shape)", () => {
    const c = compileMapping(
      "template",
      '{"event":{"productOrder":{{response}}}}',
      '{"id":"00000238","total":42}',
      ctx
    );
    expect(c.ok).toBe(true);
    expect(JSON.parse(c.body)).toEqual({ event: { productOrder: { id: "00000238", total: 42 } } });
  });
});

describe("step mapping", () => {
  it("resolves dotted paths with array indices", () => {
    const data = { order: { id: "1", lines: [{ sku: "a" }, { sku: "b" }] } };
    expect(resolvePath(data, "order.id")).toBe("1");
    expect(resolvePath(data, "order.lines.1.sku")).toBe("b");
    expect(resolvePath(data, "order.nope")).toBeUndefined();
    expect(resolvePath(data, "order.lines.9.sku")).toBeUndefined();
    expect(resolvePath(null, "a")).toBeUndefined();
  });

  it("renders templates and reports missing refs", () => {
    const { text, missing } = renderTemplate('{"x": {{order.id}}, "y": {{gone.deep}}}', { order: { id: 7 } });
    expect(text).toBe('{"x": 7, "y": null}');
    expect(missing).toEqual(["gone.deep"]);
  });

  it("compiles passthrough only for JSON sources", () => {
    expect(compileMapping("passthrough", "", '{"x":"hello"}').ok).toBe(true);
    const bad = compileMapping("passthrough", "", "not json{{{");
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/not JSON/);
    expect(compileMapping("passthrough", "", "   ").ok).toBe(false);
  });

  it("validates rendered templates as JSON", () => {    const good = compileMapping("template", '{"x": {{v}}}', '{"v": "hello world"}');
    expect(good.ok).toBe(true);
    expect(JSON.parse(good.body)).toEqual({ x: "hello world" });
    const bad = compileMapping("template", '{"x": {{v}}}', "nope");
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Source response is not JSON/);
    const broken = compileMapping("template", "{oops {{v}}", '{"v":1}');
    expect(broken.ok).toBe(false);
    expect(broken.error).toMatch(/not valid JSON/);
  });

  it("resolves response/seed/steps namespaces", () => {
    const ctx = {
      seed: '{"prompt":"hi"}',
      steps: { sys_groq: '{"id":"chatcmpl-1","choices":[{"message":{"content":"hello"}}]}' },
    };
    const { text, missing } = renderTemplate(
      '{"a": {{response.token}}, "whole": {{response}}, "p": {{seed.prompt}}, "c": {{steps.sys_groq.choices.0.message.content}}, "full": {{steps.sys_groq}}, "gone": {{steps.sys_missing.x}}}',
      { token: "tok-1" },
      ctx
    );
    expect(missing).toEqual(["steps.sys_missing.x"]);
    expect(JSON.parse(text)).toEqual({
      a: "tok-1",
      whole: { token: "tok-1" },
      p: "hi",
      c: "hello",
      full: { id: "chatcmpl-1", choices: [{ message: { content: "hello" } }] },
      gone: null,
    });
  });

  it("keeps legacy response-key templates working", () => {
    const { text, missing } = renderTemplate('{"x": {{response.token}}}', { response: { token: "legacy" } });
    expect(missing).toEqual([]);
    expect(JSON.parse(text)).toEqual({ x: "legacy" });
  });

  it("compileMapping threads step context through", () => {
    const out = compileMapping(
      "template",
      '{"content": {{steps.sys_in.prompt}}}',
      '{"ignored": true}',
      { steps: { sys_in: '{"prompt":"say hi"}' } }
    );
    expect(out.ok).toBe(true);
    expect(JSON.parse(out.body)).toEqual({ content: "say hi" });
  });
});
