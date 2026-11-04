"use client";

import { useState } from "react";
import { GeneratedPayload } from "@/lib/salesforce/types";
import type { NewCollectionItem } from "@/lib/collection/types";
import { originOf } from "@/lib/collection/postman";
import CodeBlock from "./ui/CodeBlock";
import Button from "./ui/Button";
import { CollectionTrayButton } from "./CollectionTrayButton";

interface ExportPanelProps {
  generatedPayload: GeneratedPayload;
  onAddToCollection: (item: NewCollectionItem) => void;
  collectionCount: number;
  onOpenCollection: () => void;
}

type ExportTab = "json" | "curl" | "javascript" | "apex";

function generateCurl(payload: GeneratedPayload): string {
  const body = JSON.stringify(payload.payload, null, 2);
  return `curl -X ${payload.operation} \\
  '${payload.endpoint}' \\
  -H 'Authorization: Bearer $SF_ACCESS_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '${body}'`;
}

function generateJavaScript(payload: GeneratedPayload): string {
  const body = JSON.stringify(payload.payload, null, 2);
  return `const response = await fetch(
  '${payload.endpoint}',
  {
    method: '${payload.operation}',
    headers: {
      'Authorization': 'Bearer $SF_ACCESS_TOKEN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(${body}),
  }
);

const result = await response.json();
console.log(result);`;
}

function generateApex(payload: GeneratedPayload): string {
  const path = payload.endpoint.split("/services/data/")[1] ?? `v62.0/sobjects/${payload.objectName}`;
  const body = JSON.stringify(payload.payload).replace(/'/g, "\\'");

  return `HttpRequest req = new HttpRequest();
req.setEndpoint('callout:SF_Named_Credential/services/data/${path}');
req.setMethod('${payload.operation}');
req.setHeader('Content-Type', 'application/json');
req.setBody('${body}');

Http http = new Http();
HttpResponse res = http.send(req);

System.debug('Status: ' + res.getStatusCode());
System.debug('Body: ' + res.getBody());`;
}

function generatePostmanJson(payload: GeneratedPayload): string {
  return JSON.stringify(
    {
      info: {
        name: `${payload.operation} ${payload.objectName}`,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: [
        {
          name: `${payload.operation} ${payload.objectName}`,
          request: {
            method: payload.operation,
            header: [
              {
                key: "Authorization",
                value: "Bearer {{SF_ACCESS_TOKEN}}",
                type: "text",
              },
              {
                key: "Content-Type",
                value: "application/json",
                type: "text",
              },
            ],
            body: {
              mode: "raw",
              raw: JSON.stringify(payload.payload, null, 2),
              options: { raw: { language: "json" } },
            },
            url: {
              raw: payload.endpoint,
              protocol: "https",
            },
          },
        },
      ],
    },
    null,
    2
  );
}

export default function ExportPanel({ generatedPayload, onAddToCollection, collectionCount, onOpenCollection }: ExportPanelProps) {
  const [activeTab, setActiveTab] = useState<ExportTab>("json");
  const [minified, setMinified] = useState(false);

  const jsonOutput = minified
    ? JSON.stringify(generatedPayload.payload)
    : JSON.stringify(generatedPayload.payload, null, 2);

  const curlOutput = generateCurl(generatedPayload);
  const jsOutput = generateJavaScript(generatedPayload);
  const apexOutput = generateApex(generatedPayload);

  const handleDownloadJson = () => {
    const blob = new Blob([jsonOutput], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generatedPayload.objectName}_${generatedPayload.operation.toLowerCase()}_payload.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPostman = () => {
    const blob = new Blob([generatePostmanJson(generatedPayload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generatedPayload.objectName}_postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCode =
    activeTab === "json"
      ? jsonOutput
      : activeTab === "curl"
      ? curlOutput
      : activeTab === "javascript"
      ? jsOutput
      : apexOutput;

  const tabLanguage: Record<ExportTab, string> = {
    json: "json",
    curl: "bash",
    javascript: "javascript",
    apex: "apex",
  };

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="border-b border-ivory-400 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ivory-900">Generated Payload</h2>
            <span className="text-xs text-ivory-600">
              {generatedPayload.operation} · {generatedPayload.objectName}
            </span>
          </div>
          <div className="flex gap-2">
            {activeTab === "json" && (
              <button
                onClick={() => setMinified((m) => !m)}
                className="rounded px-2 py-1 text-xs text-ivory-700 hover:bg-ivory-300 hover:text-ivory-950 transition-colors"
              >
                {minified ? "Format" : "Minify"}
              </button>
            )}
            <Button variant="ghost" size="sm" onClick={handleDownloadJson}>
              Download JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownloadPostman}>
              Postman
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onAddToCollection({
                  name: `${generatedPayload.operation} ${generatedPayload.objectName}`,
                  method: generatedPayload.operation,
                  kind: "rest",
                  url: generatedPayload.endpoint,
                  origin: originOf(generatedPayload.endpoint),
                  body: generatedPayload.payload,
                });
              }}
              title="Choose a collection to stage this request in"
            >
              + Collection
            </Button>
            <CollectionTrayButton count={collectionCount} onOpen={onOpenCollection} />
          </div>
        </div>

        <div className="mt-3 flex border-b border-ivory-400 -mb-4">
          {(["json", "curl", "javascript", "apex"] as ExportTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium tracking-wide border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-ivory-950 text-ivory-950"
                  : "border-transparent text-ivory-600 hover:text-ivory-950"
              }`}
            >
              {tab === "json" ? "JSON" : tab === "curl" ? "cURL" : tab === "javascript" ? "JavaScript" : "Apex"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        <CodeBlock code={activeCode} language={tabLanguage[activeTab]} maxHeight="500px" />
        {activeTab === "curl" && (
          <p className="mt-2 text-xs text-ivory-600">
            Set the <code className="font-mono text-ivory-800">SF_ACCESS_TOKEN</code> environment variable before running.
          </p>
        )}
        {activeTab === "apex" && (
          <p className="mt-2 text-xs text-ivory-600">
            Replace <code className="font-mono text-ivory-800">SF_Named_Credential</code> with your Named Credential API name.
          </p>
        )}
      </div>
    </div>
  );
}
