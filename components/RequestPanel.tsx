"use client";

import { useState } from "react";
import { GeneratedPayload, TestRequestResult } from "@/lib/salesforce/types";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { apiFetch } from "@/lib/api";
import Button from "./ui/Button";
import CodeBlock from "./ui/CodeBlock";

interface RequestPanelProps {
  generatedPayload: GeneratedPayload;
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onSessionExpired?: () => void;
}

export default function RequestPanel({
  generatedPayload,
  instanceUrl,
  apiVersion,
  getToken,
  onSessionExpired,
}: RequestPanelProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setShowConfirm(false);

    const token = getToken();
    if (!token) {
      setError("Session token is no longer available. Please reconnect.");
      setLoading(false);
      return;
    }

    try {
      const response = await apiFetch("/api/salesforce/test-request", {
        instanceUrl,
        token,
        apiVersion,
        objectName: generatedPayload.objectName,
        operation: generatedPayload.operation,
        payload: generatedPayload.payload,
        recordId: generatedPayload.recordId,
      });

      const data = (await response.json()) as TestRequestResult & { error?: string };

      if (!response.ok || data.error) {
        const message = typeof data.error === "string" ? data.error : "Request failed";
        setError(message);
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
      } else {
        setResult(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="border-b border-ivory-400 p-4">
        <h2 className="text-sm font-semibold text-ivory-900">Send Test Request</h2>
        <p className="mt-1 text-xs text-ivory-600">
          This will send a real {generatedPayload.operation} request to your Salesforce org.
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded border border-ivory-400 bg-ivory-100 p-3 space-y-1.5">
          <Row label="Method">
            <span className={`font-mono text-xs font-bold ${generatedPayload.operation === "POST" ? "text-green-700" : "text-amber-700"}`}>
              {generatedPayload.operation}
            </span>
          </Row>
          <Row label="Endpoint">
            <span className="font-mono text-xs text-ivory-800 break-all">{generatedPayload.endpoint}</span>
          </Row>
          <Row label="Object">
            <span className="font-mono text-xs text-ivory-800">{generatedPayload.objectName}</span>
          </Row>
          <Row label="Fields">
            <span className="text-xs text-ivory-800">{Object.keys(generatedPayload.payload).length} fields</span>
          </Row>
          <Row label="Auth">
            <span className="text-xs text-ivory-600">Bearer [session token - not shown]</span>
          </Row>
        </div>

        {!showConfirm ? (
          <Button
            variant="danger"
            onClick={() => setShowConfirm(true)}
            disabled={loading}
          >
            Send Test Request
          </Button>
        ) : (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-3">
            <p className="text-sm text-amber-800">
              ⚠ This will {generatedPayload.operation === "POST" ? "create a new record" : `update record ${generatedPayload.recordId ?? "unknown"}`} in your Salesforce org. Are you sure?
            </p>
            <div className="flex gap-2">
              <Button variant="danger" onClick={handleSend} loading={loading}>
                Confirm Send
              </Button>
              <Button variant="ghost" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-bold ${result.success ? "text-green-700" : "text-red-600"}`}>
                {result.status} {result.statusText}
              </span>
              <span className="text-xs text-ivory-600">{result.responseTime}ms</span>
            </div>

            {Object.keys(result.headers).length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-ivory-700">Response Headers</p>
                <div className="rounded border border-ivory-400 bg-ivory-100 p-2 font-mono text-xs text-ivory-700 space-y-0.5">
                  {Object.entries(result.headers).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-ivory-500">{k}: </span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.body !== null && result.body !== undefined && (
              <div>
                <p className="mb-1 text-xs font-medium text-ivory-700">Response Body</p>
                <CodeBlock
                  code={
                    typeof result.body === "string"
                      ? result.body
                      : JSON.stringify(result.body, null, 2)
                  }
                  language="json"
                  maxHeight="300px"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-ivory-600 text-xs">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
