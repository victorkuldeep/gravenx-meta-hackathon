"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { parseFrontdoorUrl, looksLikeFrontdoor } from "@/lib/salesforce/frontdoor";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Select from "./ui/Select";

interface ConnectModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  initialInstanceUrl: string;
  initialToken: string;
  initialApiVersion: string;
  onClose: () => void;
  onConnect: (instanceUrl: string, token: string, apiVersion: string) => Promise<boolean>;
}

const VERSIONS = [
  "v75.0", "v74.0", "v73.0", "v72.0", "v71.0", "v70.0", "v69.0",
  "v68.0", "v67.0", "v66.0", "v65.0",
];

/** Terms acceptance persists on this browser; the token itself never does. */
const TERMS_KEY = "gravenx-terms-accepted-v1";

type Tab = "credentials" | "session" | "token-help";

const TAB_LABELS: Record<Tab, string> = {
  credentials: "Credentials",
  session: "Session ID",
  "token-help": "Where's my token?",
};

export function ConnectModal({
  open,
  loading,
  error,
  initialInstanceUrl,
  initialToken,
  initialApiVersion,
  onClose,
  onConnect,
}: ConnectModalProps) {
  const [tab, setTab] = useState<Tab>("credentials");
  const [instanceUrl, setInstanceUrl] = useState(initialInstanceUrl);
  const [token, setToken] = useState(initialToken);
  const [apiVersion, setApiVersion] = useState(initialApiVersion);
  const [showToken, setShowToken] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [frontdoorUrl, setFrontdoorUrl] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  // Re-seed fields every time the modal opens (e.g. session restore / switch org)
  useEffect(() => {
    if (open) {
      setInstanceUrl(initialInstanceUrl);
      setToken(initialToken);
      setApiVersion(initialApiVersion);
      setUrlError("");
      setTokenError("");
      setSessionError("");
      setFrontdoorUrl("");
      setTab("credentials");
      try {
        setAccepted(window.localStorage.getItem(TERMS_KEY) === "1");
      } catch {
        setAccepted(false);
      }
      const t = setTimeout(() => urlRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, initialInstanceUrl, initialToken, initialApiVersion]);

  // ESC to close (unless a connection attempt is in flight)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  if (!open) return null;

  const submit = async () => {
    setUrlError("");
    setTokenError("");

    // One-click: a frontdoor link pasted into either field auto-fills both
    const pasted = [instanceUrl, token].find((v) => looksLikeFrontdoor(v));
    let effUrl = instanceUrl.trim();
    let effToken = token.trim();
    if (pasted) {
      try {
        const parsed = parseFrontdoorUrl(pasted);
        effUrl = parsed.instanceUrl;
        effToken = parsed.token;
        setInstanceUrl(effUrl);
        setToken(effToken);
      } catch (err) {
        setUrlError(err instanceof Error ? err.message : "Invalid frontdoor link");
        return;
      }
    }

    let bad = false;
    if (!effUrl) { setUrlError("Instance URL is required"); bad = true; }
    else if (!/^https:\/\//i.test(effUrl)) { setUrlError("Must start with https://"); bad = true; }
    if (!effToken) { setTokenError("Access token is required"); bad = true; }
    if (bad) return;
    await onConnect(effUrl, effToken, apiVersion);
  };

  const submitSession = async () => {
    const raw = frontdoorUrl.trim();
    if (!raw) {
      setSessionError("Paste a frontdoor link or a session ID");
      return;
    }
    try {
      // Full frontdoor link → instance + session extracted, one click
      if (looksLikeFrontdoor(raw)) {
        const parsed = parseFrontdoorUrl(raw);
        setSessionError("");
        setInstanceUrl(parsed.instanceUrl);
        setToken(parsed.token);
        await onConnect(parsed.instanceUrl, parsed.token, apiVersion);
        return;
      }
      // Raw session ID → still needs the instance URL alongside
      const org = instanceUrl.trim();
      if (!/^https:\/\//i.test(org)) {
        setSessionError("That's a session ID - also add your Instance URL below (https://…) so we know which org to hit.");
        return;
      }
      if (/\s/.test(raw)) {
        setSessionError("Session IDs don't contain spaces - check the pasted value.");
        return;
      }
      setSessionError("");
      setToken(raw);
      await onConnect(org, raw, apiVersion);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Couldn't use that session");
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-title"
      onClick={() => { if (!loading) onClose(); }}
    >
      <div
        className="modal-card max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Live connection
            </p>
            <h2 id="connect-title" className="mt-1 text-lg font-bold text-ivory-950">
              Connect to Salesforce
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Image
              src="/SalesforceLogo.webp"
              alt="Salesforce"
              width={144}
              height={48}
              className="h-12 w-auto"
              priority={false}
            />
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              aria-label="Close connect dialog"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 pt-4 shrink-0">
          <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden w-fit max-w-full text-xs font-medium" role="tablist" aria-label="Connect dialog tabs">
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`px-3 sm:px-4 py-2 transition-colors cursor-pointer whitespace-nowrap ${
                  tab === t ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface)] text-ivory-700 hover:text-ivory-950"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "credentials" ? (
          <div className="px-6 py-4 space-y-4">
            <Input
              ref={urlRef}
              label="Salesforce Instance URL"
              type="url"
              placeholder="https://myorg.my.salesforce.com"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              error={urlError}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <div>
              <Input
                label="Access Token"
                type={showToken ? "text" : "password"}
                placeholder="00D... / session id"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                error={tokenError}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="mt-1 text-[11px] font-medium text-bronze-600 hover:text-bronze-700 cursor-pointer"
              >
                {showToken ? "Hide token" : "Show token"}
              </button>
            </div>
            <Select
              label="API Version"
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              disabled={loading}
            >
              {VERSIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}
          </div>
        ) : tab === "session" ? (
          <div className="px-6 py-4 space-y-4">
            <Input
              label="Frontdoor link or Session ID"
              type="text"
              placeholder="https://mydomain.my.salesforce.com/secur/frontdoor.jsp?sid=…"
              value={frontdoorUrl}
              onChange={(e) => {
                setFrontdoorUrl(e.target.value);
                setSessionError("");
              }}
              error={sessionError}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              hint="Paste the full frontdoor.jsp?sid=… link for true one-click login"
              onKeyDown={(e) => { if (e.key === "Enter") submitSession(); }}
            />
            <Input
              label="Instance URL (only needed for a raw session ID)"
              type="url"
              placeholder="https://myorg.my.salesforce.com"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter") submitSession(); }}
            />
            <Select
              label="API Version"
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              disabled={loading}
            >
              {VERSIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 py-4 space-y-3 text-xs leading-relaxed text-ivory-700">
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
              <p className="font-semibold text-ivory-950">Option 1 - Workbench</p>
              <p className="mt-1">Log in at workbench.developerforce.com, then open the session info page to copy your Session ID and use it as the token.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
              <p className="font-semibold text-ivory-950">Option 2 - Salesforce CLI</p>
              <p className="mt-1">Run <code className="font-mono text-[11px] bg-ivory-300 px-1 rounded">sf org display --target-org &lt;alias&gt;</code> and copy the Access Token.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
              <p className="font-semibold text-ivory-950">Option 3 - Connected App</p>
              <p className="mt-1">Use an OAuth client-credentials or authorization-code flow against your org, then paste the issued access token here.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-accent-soft)] bg-[var(--color-accent-bg)] p-3">
              <p className="font-semibold text-ivory-950">Option 4 - Frontdoor link (fastest)</p>
              <p className="mt-1">
                Have a <code className="font-mono text-[11px] bg-ivory-300 px-1 rounded">…/secur/frontdoor.jsp?sid=…</code> link?
                Open the <button type="button" onClick={() => setTab("session")} className="font-semibold text-bronze-600 underline cursor-pointer">Session ID</button> tab
                and paste it - instance + token are extracted automatically.
              </p>
            </div>
          </div>
        )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] space-y-3 shrink-0">
          <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-ivory-700">
            <input
              type="checkbox"
              checked={accepted}
              disabled={loading}
              onChange={(e) => {
                setAccepted(e.target.checked);
                try {
                  if (e.target.checked) window.localStorage.setItem(TERMS_KEY, "1");
                  else window.localStorage.removeItem(TERMS_KEY);
                } catch {
                  /* private mode: acceptance lasts for this dialog only */
                }
              }}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-amber-800"
            />
            <span>
              I accept the{" "}
              <a href="/terms" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-medium underline hover:text-ivory-950">
                Terms &amp; Conditions
              </a>{" "}
              and{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-medium underline hover:text-ivory-950">
                Privacy Policy
              </a>
              , and I have authority to connect this org.
            </span>
          </label>
          <p className="text-[11px] leading-relaxed text-ivory-600">
            <span className="font-semibold text-ivory-950">Disclaimer:</span> Token stays in this
            browser tab (sessionStorage) and is proxied server-side to your org only -
            never written to disk. Reads, record edits, and confirmed Author-mode schema changes all travel
            the same proxied path. Independent project.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex gap-2 shrink-0 sm:ml-auto">
              <Button variant="secondary" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                onClick={tab === "session" ? submitSession : submit}
                loading={loading}
                disabled={loading || !accepted}
                title={!accepted && !loading ? "Accept the Terms & Conditions first" : undefined}
              >
                <>Test &amp; Connect</>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
