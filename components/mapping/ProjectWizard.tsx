"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { extractPaths, parseSourceJson } from "@/lib/mapping/source";
import { blankProject, type MappingProject } from "@/lib/mapping/types";
import { OpenApiSource } from "./OpenApiSource";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Short progressive setup: mapping details -> source payload -> create. */
export function ProjectWizard({
  onCreate,
  onCancel,
  title,
  contextName,
  initialSourceTab,
}: {
  onCreate: (project: MappingProject) => void;
  onCancel: () => void;
  /** e.g. "New integration mapping" or "New standalone mapping". */
  title?: string;
  /** Umbrella shown for context, e.g. the studio project name. */
  contextName?: string;
  /** Which source card shows first. The wizard remounts per open, so this applies cleanly. */
  initialSourceTab?: "paste" | "openapi";
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [sourceApi, setSourceApi] = useState("");
  const [domain, setDomain] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("source-payload.json");
  const [sourceTab, setSourceTab] = useState<"paste" | "openapi">(initialSourceTab ?? "paste");
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    const parsed = parseSourceJson(sourceText);
    if (!parsed.ok) {
      setError(parsed.error ?? "Invalid JSON.");
      return;
    }
    const now = new Date().toISOString();
    const project = blankProject({
      id: uid("map"),
      name: name.trim() || "Untitled mapping",
      description: description.trim() || undefined,
      sourceSystem: sourceSystem.trim() || undefined,
      sourceApi: sourceApi.trim() || undefined,
      domain: domain.trim() || undefined,
      now,
    });
    project.source = {
      kind: "json-sample",
      name: sourceName,
      originalText: sourceText,
      paths: extractPaths(parsed.value),
      capturedAt: now,
    };
    onCreate(project);
  };

  const inputCls =
    "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[13px] focus:border-[#A98450] focus:outline-none";

  const wide = step === 1 && sourceTab === "openapi";

  return (
    <div className={`mx-auto ${wide ? "max-w-4xl" : "max-w-2xl"} rounded-2xl border border-[#E8E2D8] bg-white p-6 sm:p-8 shadow-[0_2px_24px_rgba(169,132,80,0.08)]`}>
      <p className="text-[16px] font-semibold text-[#27241F]">{title ?? "New integration mapping"}</p>
      {contextName && (
        <p className="mt-0.5 text-[12px] text-[#777168]">Under {contextName} - detach anytime to make it standalone.</p>
      )}
      <div className="mb-6 mt-4 flex items-center gap-3 text-[15px]" aria-label="Setup progress">
        {["Mapping Details", "Source Payload"].map((label, i) => (
          <span key={label} className="flex items-center gap-2.5">
            <span className={`flex h-8 w-8 items-center justify-center rounded-full font-mono text-[13px] font-bold ${i === step ? "bg-[#211F1B] text-white" : i < step ? "bg-[#E9F3EC] text-[#2F7D4F]" : "bg-[#F5F1E8] text-[#A39B8E]"}`}>
              {i + 1}
            </span>
            <span className={i === step ? "text-[#27241F] font-semibold" : "text-[#A39B8E]"}>{label}</span>
            {i === 0 && <span aria-hidden="true" className="text-[#D8CFC0]">→</span>}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Integration mapping name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product Order → Salesforce" className={`${inputCls} mt-1 font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Purpose
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this payload mapping covers" className={`${inputCls} mt-1 font-normal`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-semibold text-[#27241F]">
              Source system
              <input value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} placeholder="Middleware (ZSP hub)" className={`${inputCls} mt-1 font-normal`} />
            </label>
            <label className="block text-[12px] font-semibold text-[#27241F]">
              Source API
              <input value={sourceApi} onChange={(e) => setSourceApi(e.target.value)} placeholder="Product Order API v4" className={`${inputCls} mt-1 font-normal`} />
            </label>
          </div>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Business domain (optional)
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Order management" className={`${inputCls} mt-1 font-normal`} />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="How to supply the source payload">
            <button
              type="button"
              onClick={() => setSourceTab("paste")}
              aria-pressed={sourceTab === "paste"}
              className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${sourceTab === "paste" ? "border-[#211F1B] bg-[#FAF8F2]" : "border-[#E8E2D8] bg-white hover:border-[#A98450]"}`}
            >
              <span className="block text-[13px] font-semibold text-[#27241F]">Paste JSON</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[#777168]">
                You have a real sample payload - paste it exactly as the mapping template.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSourceTab("openapi")}
              aria-pressed={sourceTab === "openapi"}
              className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${sourceTab === "openapi" ? "border-[#211F1B] bg-[#FAF8F2]" : "border-[#E8E2D8] bg-white hover:border-[#A98450]"}`}
            >
              <span className="block text-[13px] font-semibold text-[#27241F]">Generate from OpenAPI</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[#777168]">
                You have a spec - pick an operation, tick 4 of 10 fields, we build the sample.
              </span>
            </button>
          </div>
          {sourceTab === "openapi" ? (
            <OpenApiSource
              onBack={() => setSourceTab("paste")}
              onUse={(sample) => {
                setSourceText(sample.text);
                setSourceName(sample.name);
                setError(null);
                setSourceTab("paste");
              }}
            />
          ) : (
          <>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Source file name
            <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} className={`${inputCls} mt-1 font-mono font-normal`} />
          </label>
          <label className="block text-[12px] font-semibold text-[#27241F]">
            Paste source JSON (preserved exactly as the template)
            <textarea
              value={sourceText}
              onChange={(e) => {
                setSourceText(e.target.value);
                setError(null);
              }}
              rows={12}
              spellCheck={false}
              placeholder='{"order": {"orderNumber": "A1"}}'
              className={`${inputCls} mt-1 font-mono text-[12px] leading-relaxed font-normal`}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </p>
          )}
          </>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-between">
        <Button variant="ghost" onClick={() => (step === 0 ? onCancel() : setStep(0))}>
          {step === 0 ? "Cancel" : "← Back"}
        </Button>
        {step === 0 ? (
          <Button onClick={() => setStep(1)}>Continue →</Button>
        ) : (
          <Button onClick={create}>Create mapping</Button>
        )}
      </div>
    </div>
  );
}
