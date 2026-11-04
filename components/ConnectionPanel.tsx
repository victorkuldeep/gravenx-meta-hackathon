"use client";

import { useState, useEffect } from "react";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Select from "./ui/Select";
import StatusBadge from "./StatusBadge";

interface ConnectionPanelProps {
  connected: boolean;
  instanceUrl: string;
  apiVersion: string;
  objectCount: number;
  onConnect: (instanceUrl: string, token: string, apiVersion: string) => Promise<void>;
  onDisconnect: () => void;
  loading: boolean;
  error: string | null;
}

const DEFAULT_VERSIONS = [
  "v75.0",
  "v74.0",
  "v73.0",
  "v72.0",
  "v71.0",
  "v70.0",
  "v69.0",
  "v68.0",
  "v67.0",
  "v66.0",
  "v65.0",
];

export default function ConnectionPanel({
  connected,
  instanceUrl: connectedInstanceUrl,
  apiVersion: connectedApiVersion,
  objectCount,
  onConnect,
  onDisconnect,
  loading,
  error,
}: ConnectionPanelProps) {
  const [instanceUrl, setInstanceUrl] = useState("");
  const [token, setToken] = useState("");
  const [apiVersion, setApiVersion] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_SF_API_VERSION ?? "v66.0"
  );
  const [urlError, setUrlError] = useState("");
  const [tokenError, setTokenError] = useState("");

  // Pre-fill from sessionStorage so fields are populated if session exists
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("gravenx_session");
      if (saved) {
        const parsed = JSON.parse(saved) as { instanceUrl?: string; token?: string; apiVersion?: string };
        if (parsed.instanceUrl) setInstanceUrl(parsed.instanceUrl);
        if (parsed.token) setToken(parsed.token);
        if (parsed.apiVersion) setApiVersion(parsed.apiVersion);
      }
    } catch { /* ignore */ }
  }, []);

  const handleConnect = async () => {
    setUrlError("");
    setTokenError("");

    let hasError = false;
    if (!instanceUrl.trim()) {
      setUrlError("Instance URL is required");
      hasError = true;
    }
    if (!token.trim()) {
      setTokenError("Access token is required");
      hasError = true;
    }
    if (hasError) return;

    await onConnect(instanceUrl.trim(), token.trim(), apiVersion);
  };

  const handleDisconnect = () => {
    setToken("");
    onDisconnect();
  };

  if (connected) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <StatusBadge status="connected" />
            <div className="text-sm text-ivory-700">
              <span className="text-ivory-950">{connectedInstanceUrl}</span>
              <span className="mx-2">·</span>
              <span>{connectedApiVersion}</span>
              {objectCount > 0 && (
                <>
                  <span className="mx-2">·</span>
                  <span>{objectCount.toLocaleString()} objects</span>
                </>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ivory-900">Connect to Salesforce</h2>
        <StatusBadge status={loading ? "loading" : "disconnected"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Input
            label="Salesforce Instance URL"
            type="url"
            placeholder="https://myorg.my.salesforce.com"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            error={urlError}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="lg:col-span-1">
          <Input
            label="Access Token"
            type="password"
            placeholder="00D..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            error={tokenError}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <Select
            label="API Version"
            value={apiVersion}
            onChange={(e) => setApiVersion(e.target.value)}
            disabled={loading}
          >
            {DEFAULT_VERSIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-ivory-600">
          Token is used only for this session and is never persisted.
        </p>
        <Button onClick={handleConnect} loading={loading} disabled={loading}>
          Connect
        </Button>
      </div>
    </div>
  );
}
