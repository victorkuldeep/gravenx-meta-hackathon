"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type {
  SalesforceObject,
  SalesforceDescribeResult,
} from "@/lib/salesforce/types";
import { rankObjects } from "@/lib/search/rank";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { apiFetch, ApiTimeoutError } from "@/lib/api";
import { downloadTextFile } from "@/lib/collection/postman";
import { downloadQueryResult } from "@/lib/soql/export";
import { QueryFilterBar } from "@/components/QueryFilterBar";
import { QueryToolStrip } from "@/components/QueryToolStrip";
import { newItemId } from "@/lib/collection/types";
import {
  listSoqlQueries,
  saveSoqlQuery,
  deleteSoqlQuery,
  clearSoqlHistory,
  type SoqlQuery,
} from "@/lib/soql/historyDb";
import {
  SOSL_STARTER,
  SOSL_TEMPLATES,
  countByObject,
  looksLikeSosl,
  toObjectTable,
} from "@/lib/salesforce/sosl";
import type { QueryPlan } from "@/app/api/salesforce/query-plan/route";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { QueryHistoryDialog } from "./QueryHistoryDialog";
import Input from "./ui/Input";

interface SoqlPanelProps {
  objects: SalesforceObject[];
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onSessionExpired?: () => void;
  onLanguageChange?: (mode: "soql" | "sosl") => void;
}

const SOQL_STARTER = "SELECT Id, Name FROM Account LIMIT 20";

const SOQL_TIMEOUT_MS = 120000;
/**
 * Client-driven auto-batching has no 50k-style cap, so this is the only
 * guardrail: fetching stops here with a clear note instead of growing the
 * tab's memory without bound. 500k small SOQL rows ≈ low-hundreds MB.
 */
const ROW_CEILING = 500_000;
const PAGE_SIZES = [10, 20, 50, 100, 200, 500];

/**
 * Block sliding window: 10 consecutive page buttons that jump in tens
 * (1-10, then 11-20, …), framed by First / Prev / … / Next / Last with
 * ellipses wherever pages are skipped. Thousands of pages never print -
 * the window shifts as the current page crosses each block edge.
 */
function pageList(cur: number, total: number): (number | "l" | "r")[] {
  if (total <= 12) return Array.from({ length: total }, (_, i) => i);
  const start = Math.min(Math.floor(cur / 10) * 10, total - 10);
  const out: (number | "l" | "r")[] = [];
  if (start > 0) {
    out.push(0);
    if (start > 1) out.push("l");
  }
  for (let i = start; i < start + 10; i++) out.push(i);
  if (start + 10 < total) {
    if (start + 10 < total - 1) out.push("r");
    out.push(total - 1);
  }
  return out;
}

const TEMPLATES: { name: string; soql: string; tooling?: boolean }[] = [
  {
    name: "Accounts (recent)",
    soql: "SELECT Id, Name, Industry, AnnualRevenue FROM Account ORDER BY CreatedDate DESC LIMIT 20",
  },
  {
    name: "Open opportunities",
    soql: "SELECT Id, Name, StageName, Amount FROM Opportunity WHERE IsClosed = false ORDER BY Amount DESC LIMIT 20",
  },
  {
    name: "Contacts + account names",
    soql: "SELECT Id, FirstName, LastName, Email, Account.Name FROM Contact ORDER BY LastName LIMIT 20",
  },
  {
    name: "Cases + recent comments",
    soql: "SELECT Id, CaseNumber, Subject, (SELECT Id, CommentBody FROM CaseComments ORDER BY CreatedDate DESC LIMIT 3) FROM Case ORDER BY CreatedDate DESC LIMIT 20",
  },
  {
    name: "Tooling: custom objects",
    soql: "SELECT Id, DeveloperName, Label FROM CustomObject ORDER BY DeveloperName LIMIT 50",
    tooling: true,
  },
];

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "LIKE", "IN",
  "ORDER BY", "ASC", "DESC", "LIMIT", "OFFSET", "GROUP BY", "HAVING",
  "COUNT()", "TODAY", "YESTERDAY", "TOMORROW", "NULL", "TRUE", "FALSE",
];

interface SoqlRow {
  columns: string[];
  rows: string[][];
  totalSize: number;
  truncated: boolean;
  truncatedNote?: string;
  timeMs: number;
}

function flattenValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, val] of Object.entries(o)) {
      if (k === "attributes") continue;
      const s = flattenValue(val);
      if (s) parts.push(s);
    }
    return parts.join(" | ");
  }
  return String(v);
}

function toTable(records: unknown[]): { columns: string[]; rows: string[][] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const rec of records) {
    if (typeof rec !== "object" || rec === null) continue;
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
      if (k === "attributes") continue;
      flat[k] = flattenValue(v);
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
    rows.push(columns.map((c) => flat[c] ?? ""));
  }
  return { columns, rows };
}

function toCsv(columns: string[], rows: string[][], sep: string): string {
  const esc = (s: string) =>
    s.includes(sep) || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  return [columns.map(esc).join(sep), ...rows.map((r) => r.map(esc).join(sep))].join("\n");
}

function parseFromObject(soql: string): string | null {
  const m = soql.match(/\bfrom\s+([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

export default function SoqlPanel({
  objects,
  instanceUrl,
  apiVersion,
  getToken,
  onSessionExpired,
  onLanguageChange,
}: SoqlPanelProps) {
  const [soql, setSoql] = useState(SOQL_STARTER);
  const [tooling, setTooling] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const [mode, setMode] = useState<"soql" | "sosl">("soql");
  const [soslCounts, setSoslCounts] = useState<{ type: string; count: number }[] | null>(null);
  const [caretKey, setCaretKey] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [descCache, setDescCache] = useState<Map<string, SalesforceDescribeResult>>(new Map());
  const descRef = useRef<Map<string, SalesforceDescribeResult>>(new Map());

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<SoqlRow | null>(null);
  /** Raw server rows behind the table - JsonQL filters/aggregates these. */
  const [baseRecords, setBaseRecords] = useState<unknown[] | null>(null);
  /** JsonQL override rows (null = show server table) + status chip. */
  const [jqlRows, setJqlRows] = useState<unknown[] | null>(null);
  const [jqlLabel, setJqlLabel] = useState<string | null>(null);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [plans, setPlans] = useState<QueryPlan[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const [history, setHistory] = useState<SoqlQuery[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [fieldInfoOpen, setFieldInfoOpen] = useState(false);

  useEffect(() => {
    listSoqlQueries()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  const mergeDescribe = useCallback((d: SalesforceDescribeResult) => {
    descRef.current.set(d.name, d);
    setDescCache((prev) => {
      if (prev.has(d.name)) return prev;
      const next = new Map(prev);
      next.set(d.name, d);
      return next;
    });
  }, []);

  const ensureDescribe = useCallback(
    async (objectName: string): Promise<SalesforceDescribeResult> => {
      const hit = descRef.current.get(objectName);
      if (hit) return hit;
      const token = getToken();
      if (!token) throw new Error("Session token is no longer available. Please reconnect.");
      const response = await apiFetch("/api/salesforce/describe", {
        instanceUrl,
        token,
        apiVersion,
        objectName,
      });
      const data = (await response.json()) as SalesforceDescribeResult & { error?: string };
      if (!response.ok) {
        const message =
          typeof (data as unknown as { error?: unknown }).error === "string"
            ? (data as unknown as { error: string }).error
            : `Describe failed for ${objectName}`;
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
        throw new Error(message);
      }
      mergeDescribe(data);
      return data;
    },
    [instanceUrl, apiVersion, getToken, onSessionExpired, mergeDescribe]
  );

  const fromObject = useMemo(() => parseFromObject(soql), [soql]);
  const fromDescribe = fromObject ? descCache.get(fromObject) ?? null : null;

  // Ensure the FROM object's describe is cached for suggestions + field info
  useEffect(() => {
    if (!fromObject || descRef.current.has(fromObject)) return;
    ensureDescribe(fromObject).catch(() => {
      /* suggestions stay keyword-only until it loads */
    });
  }, [fromObject, ensureDescribe]);

  const caretToken = useMemo(() => {
    void caretKey;
    const el = taRef.current;
    if (!el || document.activeElement !== el) return "";
    const m = el.value.slice(0, el.selectionStart).match(/[A-Za-z0-9_.]*$/);
    return m ? m[0] : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soql, caretKey]);

  const suggestions = useMemo(() => {
    const items: { label: string; insert: string; hint: string }[] = [];
    const seen = new Set<string>();
    const push = (label: string, insert: string, hint: string) => {
      if (seen.has(label)) return;
      seen.add(label);
      items.push({ label, insert, hint });
    };

    const token = caretToken;
    const dot = token.lastIndexOf(".");
    if (dot > 0 && fromDescribe) {
      // Relationship drill-down: Account.Na -> Account.Name
      const rel = token.slice(0, dot);
      const tail = token.slice(dot + 1).toLowerCase();
      const parentField = fromDescribe.fields.find(
        (f) => f.relationshipName === rel && (f.referenceTo ?? []).length > 0
      );
      if (parentField) {
        const target = descRef.current.get((parentField.referenceTo ?? [])[0]);
        if (target) {
          for (const f of target.fields) {
            if (!tail || f.name.toLowerCase().startsWith(tail) || f.label.toLowerCase().includes(tail)) {
              push(`${rel}.${f.name}`, `${rel}.${f.name}`, f.type);
            }
            if (items.length >= 24) break;
          }
        } else {
          push(`Load ${rel} fields`, `__load:${(parentField.referenceTo ?? [])[0]}`, "fetch metadata");
        }
        return items;
      }
      const childRel = (fromDescribe.childRelationships ?? []).find((r) => r.relationshipName === rel);
      if (childRel) {
        const target = descRef.current.get(childRel.childSObject);
        if (target) {
          for (const f of target.fields) {
            if (!tail || f.name.toLowerCase().startsWith(tail)) push(`${rel}.${f.name}`, `${rel}.${f.name}`, f.type);
            if (items.length >= 24) break;
          }
        } else {
          push(`Load ${rel} fields`, `__load:${childRel.childSObject}`, "fetch metadata");
        }
        return items;
      }
    }

    const tail = (dot > 0 ? token.slice(dot + 1) : token).toLowerCase();
    for (const kw of KEYWORDS) {
      if (!tail || kw.startsWith(tail.toUpperCase())) push(kw, tail && /[a-z]/.test(token) ? kw : kw + " ", "keyword");
      if (items.length >= 8) break;
    }
    if (fromDescribe) {
      for (const f of fromDescribe.fields) {
        if (!tail || f.name.toLowerCase().startsWith(tail) || f.label.toLowerCase().includes(tail)) {
          push(f.name, f.name, f.type);
        }
        if (items.length >= 32) break;
      }
    } else {
      for (const o of rankObjects(objects, token, 12)) {
        push(o.name, o.name, o.label);
      }
    }
    return items;
  }, [caretToken, fromDescribe, objects]);

  const bumpCaret = useCallback(() => setCaretKey((k) => k + 1), []);

  const applySuggestion = useCallback(
    (insert: string) => {
      if (insert.startsWith("__load:")) {
        void ensureDescribe(insert.slice("__load:".length)).then(() => bumpCaret());
        return;
      }
      const el = taRef.current;
      if (!el) {
        setSoql((s) => s + (s.endsWith(" ") || s === "" ? "" : " ") + insert);
        return;
      }
      const pos = el.selectionStart;
      const before = el.value.slice(0, pos).match(/[A-Za-z0-9_.]*$/)?.[0] ?? "";
      const next = el.value.slice(0, pos - before.length) + insert + el.value.slice(el.selectionEnd);
      setSoql(next);
      const caret = pos - before.length + insert.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
        bumpCaret();
      });
    },
    [ensureDescribe, bumpCaret]
  );

  const runSosl = useCallback(
    async (q: string, token: string) => {
      stoppedRef.current = false;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);
      setRunError(null);
      setResult(null);
      setBaseRecords(null);
      setJqlRows(null);
      setJqlLabel(null);
      setSoslCounts(null);
      const started = Date.now();
      try {
        const response = await apiFetch(
          "/api/salesforce/sosl",
          { instanceUrl, token, apiVersion, sosl: q },
          SOQL_TIMEOUT_MS,
          ctrl.signal
        );
        const data = (await response.json()) as {
          searchRecords?: unknown[];
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !data.success) {
          const message = typeof data.error === "string" ? data.error : "Search failed";
          setRunError(message);
          if (isSessionExpiredMessage(message)) onSessionExpired?.();
          return;
        }
        const table = toObjectTable(data.searchRecords ?? []);
        setBaseRecords(data.searchRecords ?? []);
        setJqlRows(null);
        setJqlLabel(null);
        setResult({
          columns: table.columns,
          rows: table.rows,
          totalSize: table.rows.length,
          truncated: false,
          timeMs: Date.now() - started,
        });
        setSoslCounts(countByObject(data.searchRecords ?? []));
        const now = Date.now();
        setHistory((prev) => {
          const dup = prev.find((h) => !h.saved && h.soql === q && h.mode === "sosl");
          const entry: SoqlQuery = dup
            ? { ...dup, lastRun: now, rowCount: table.rows.length }
            : {
                id: newItemId(),
                soql: q,
                label: "",
                saved: false,
                tooling: false,
                mode: "sosl",
                rowCount: table.rows.length,
                createdAt: now,
                lastRun: now,
              };
          void saveSoqlQuery(entry).catch(() => {});
          const rest = prev.filter((h) => h.id !== entry.id);
          return [entry, ...rest].slice(0, 60);
        });
      } catch (err) {
        if (stoppedRef.current) {
          setRunError("Stopped - partial results (if any) were discarded.");
        } else if (err instanceof ApiTimeoutError) {
          setRunError(err.message);
        } else {
          const message = err instanceof Error ? err.message : "Network error";
          setRunError(message);
          if (isSessionExpiredMessage(message)) onSessionExpired?.();
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [instanceUrl, apiVersion, onSessionExpired]
  );

  const handleRun = useCallback(async () => {
    const q = soql.trim();
    if (!q) {
      setRunError("Write a query first - or pick a template above.");
      return;
    }
    const token = getToken();
    if (!token) {
      setRunError("Session token is no longer available. Please reconnect.");
      return;
    }
    if (mode === "sosl") {
      if (!looksLikeSosl(q)) {
        setRunError("That doesn't look like SOSL - it needs FIND {term} … RETURNING ….");
        return;
      }
      await runSosl(q, token);
      return;
    }
    if (!/\bselect\b/i.test(q) || !/\bfrom\b/i.test(q)) {
      setRunError("That doesn't look like SOQL - it needs SELECT … FROM ….");
      return;
    }
    stoppedRef.current = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setRunError(null);
    setFetchProgress(null);
    setResult(null);
    setBaseRecords(null);
    setJqlRows(null);
    setJqlLabel(null);
    setSoslCounts(null);
    const started = Date.now();
    // Accumulates the fast path + every continuation page, so Stop keeps
    // whatever arrived instead of discarding a lakh-scale fetch.
    let all: unknown[] = [];
    let finalTotal = 0;
    let remaining: string | null = null;
    let ceilingHit = false;
    // Single commit point: table + history + notices stay consistent whether
    // the run completed, hit the ceiling, or was stopped early.
    const commit = (rows: unknown[], total: number, note: string | null, truncNote?: string) => {
      const table = toTable(rows);
      setBaseRecords(rows);
      setJqlRows(null);
      setJqlLabel(null);
      setResult({
        columns: table.columns,
        rows: table.rows,
        totalSize: total,
        truncated: note !== null,
        ...(truncNote ? { truncatedNote: truncNote } : {}),
        timeMs: Date.now() - started,
      });
      if (note) setNotice(note);
      const now = Date.now();
      setHistory((prev) => {
        const dup = prev.find((h) => !h.saved && h.soql === q && h.tooling === tooling && (h.mode ?? "soql") === "soql");
        const entry: SoqlQuery = dup
          ? { ...dup, lastRun: now, rowCount: rows.length }
          : {
              id: newItemId(),
              soql: q,
              label: "",
              saved: false,
              tooling,
              mode: "soql",
              rowCount: rows.length,
              createdAt: now,
              lastRun: now,
            };
        void saveSoqlQuery(entry).catch(() => {});
        const rest = prev.filter((h) => h.id !== entry.id);
        return [entry, ...rest].slice(0, 60);
      });
    };
    try {
      const response = await apiFetch(
        "/api/salesforce/soql",
        { instanceUrl, token, apiVersion, soql: q, tooling, allRows },
        SOQL_TIMEOUT_MS,
        ctrl.signal
      );
      const data = (await response.json()) as {
        records?: unknown[];
        totalSize?: number;
        nextRecordsUrl?: string | null;
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !data.success) {
        const message = typeof data.error === "string" ? data.error : "Query failed";
        setRunError(message);
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
        return;
      }
      all = [...(data.records ?? [])];
      finalTotal = data.totalSize ?? all.length;
      remaining = data.nextRecordsUrl ?? null;
      // Client-driven auto-batching: one short page per request until done,
      // so even lakh-scale result sets stream in without hitting any single
      // call's budget. No 50k-style cap - the platform paginates freely.
      while (remaining) {
        if (stoppedRef.current) break;
        if (all.length >= ROW_CEILING) {
          ceilingHit = true;
          break;
        }
        setFetchProgress(
          `Fetched ${all.length.toLocaleString()} of ${finalTotal.toLocaleString()} rows…`
        );
        const pr = await apiFetch(
          "/api/salesforce/soql",
          { instanceUrl, token, apiVersion, soql: q, tooling, allRows, pageUrl: remaining },
          undefined,
          ctrl.signal
        );
        const pdata = (await pr.json()) as {
          records?: unknown[];
          totalSize?: number;
          nextRecordsUrl?: string | null;
          success?: boolean;
          error?: string;
        };
        if (!pr.ok || !pdata.success) {
          throw new Error(typeof pdata.error === "string" ? pdata.error : "Fetching the next page failed");
        }
        if (Array.isArray(pdata.records)) all.push(...pdata.records);
        if (typeof pdata.totalSize === "number") finalTotal = pdata.totalSize;
        remaining = pdata.nextRecordsUrl ?? null;
      }
      if (ceilingHit) {
        commit(
          all,
          finalTotal,
          `Stopped at the ${ROW_CEILING.toLocaleString()}-row safety ceiling - showing what arrived. Narrow with filters or LIMIT.`,
          `safety ceiling (${ROW_CEILING.toLocaleString()} rows)`
        );
      } else if (stoppedRef.current) {
        commit(
          all,
          finalTotal,
          `Stopped - showing ${all.length.toLocaleString()} of ${finalTotal.toLocaleString()} fetched rows.`,
          "stopped early"
        );
      } else {
        commit(all, finalTotal, null);
      }
    } catch (err) {
      if (stoppedRef.current && all.length > 0) {
        // Aborted mid-stream with pages already in hand - keep them.
        commit(
          all,
          finalTotal,
          `Stopped - showing ${all.length.toLocaleString()} of ${finalTotal.toLocaleString()} fetched rows.`,
          "stopped early"
        );
      } else if (stoppedRef.current) {
        setRunError("Stopped - partial results (if any) were discarded.");
      } else if (err instanceof ApiTimeoutError) {
        setRunError(err.message);
      } else {
        const message = err instanceof Error ? err.message : "Network error";
        setRunError(message);
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
      }
    } finally {
      setRunning(false);
      setFetchProgress(null);
      abortRef.current = null;
    }
  }, [soql, tooling, allRows, mode, runSosl, instanceUrl, apiVersion, getToken, onSessionExpired]);

  const handleStop = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }, []);

  const handlePlan = useCallback(async () => {
    const q = soql.trim();
    if (!q) {
      setPlanError("Write a query first.");
      setPlanOpen(true);
      return;
    }
    const token = getToken();
    if (!token) {
      setPlanError("Session token is no longer available. Please reconnect.");
      setPlanOpen(true);
      return;
    }
    setPlanOpen(true);
    setPlanLoading(true);
    setPlanError(null);
    setPlans(null);
    try {
      const response = await apiFetch("/api/salesforce/query-plan", {
        instanceUrl,
        token,
        apiVersion,
        soql: q,
      });
      const data = (await response.json()) as {
        plans?: QueryPlan[];
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !data.success) {
        const message = typeof data.error === "string" ? data.error : "Query plan failed";
        setPlanError(message);
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
        return;
      }
      setPlans(data.plans ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setPlanError(message);
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
    } finally {
      setPlanLoading(false);
    }
  }, [soql, instanceUrl, apiVersion, getToken, onSessionExpired]);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // New result set or new filter view: back to the first page.
  useEffect(() => {
    setPage(0);
  }, [result, jqlRows]);

  /** Displayed table: JsonQL override when active, else the server table. */
  const shown: SoqlRow | null = useMemo(() => {
    if (!result || !jqlRows) return result;
    const table = toTable(jqlRows);
    return {
      columns: table.columns,
      rows: table.rows,
      totalSize: jqlRows.length,
      truncated: false,
      timeMs: result.timeMs,
    };
  }, [result, jqlRows]);

  // Premium paging over the displayed view (server rows or JsonQL output):
  // only one page of <tr> ever hits the DOM, so 10k rows can't hang the tab.
  const totalPages = shown ? Math.max(1, Math.ceil(shown.rows.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pageRows = shown ? shown.rows.slice(pageStart, pageStart + pageSize) : [];

  const gotoPage = (p: number) => {
    setPage(Math.max(0, Math.min(p, totalPages - 1)));
    tableScrollRef.current?.scrollTo({ top: 0 });
  };

  const exportText = useCallback(
    (format: "csv" | "tsv" | "json") => {
      if (!shown) return null;
      if (format === "json") {
        return JSON.stringify(
          shown.rows.map((r) => Object.fromEntries(shown.columns.map((c, i) => [c, r[i]]))),
          null,
          2
        );
      }
      return toCsv(shown.columns, shown.rows, format === "tsv" ? "\t" : ",");
    },
    [shown]
  );

  const copyExport = useCallback(
    async (format: "csv" | "tsv" | "json") => {
      const text = exportText(format);
      if (text == null) return;
      try {
        await navigator.clipboard.writeText(text);
        setNotice(`Copied ${format === "tsv" ? "Excel" : format.toUpperCase()} (${shown?.rows.length ?? 0} rows) to clipboard.`);
      } catch {
        setNotice("Clipboard unavailable in this browser.");
      }
    },
    [exportText, shown]
  );

  const downloadExport = useCallback(
    (format: "csv" | "json") => {
      const text = exportText(format);
      if (text == null) return;
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      downloadTextFile(
        `soql-export-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${format}`,
        text,
        format === "json" ? "application/json" : "text/csv"
      );
    },
    [exportText]
  );

  const downloadXlsx = useCallback(async () => {
    if (!shown) return;
    setXlsxBusy(true);
    try {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      await downloadQueryResult(
        {
          columns: shown.columns,
          rows: shown.rows,
          totalSize: shown.totalSize,
          truncated: shown.truncated,
          timeMs: shown.timeMs,
          query: soql,
          mode,
        },
        `soql-export-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`
      );
      setNotice(`Downloaded Excel (${shown.rows.length} rows).`);
    } finally {
      setXlsxBusy(false);
    }
  }, [shown, soql, mode]);

  const [notice, setNotice] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);

  const historyItems = useMemo(
    () => history.filter((h) => !h.saved && (h.mode ?? "soql") === mode),
    [history, mode]
  );
  const savedItems = useMemo(
    () => history.filter((h) => h.saved && (h.mode ?? "soql") === mode),
    [history, mode]
  );

  const switchMode = useCallback((next: "soql" | "sosl") => {
    setMode(next);
    onLanguageChange?.(next);
    setResult(null);
    setBaseRecords(null);
    setJqlRows(null);
    setJqlLabel(null);
    setRunError(null);
    setSoslCounts(null);
    setPlanOpen(false);
    setSoql((prev) => {
      const t = prev.trim();
      // Swap the starter when the box still holds the other language's
      // default (or nothing) - never clobber the user's own query.
      if (t === "" || t === SOQL_STARTER || t === SOSL_STARTER) {
        return next === "sosl" ? SOSL_STARTER : SOQL_STARTER;
      }
      return prev;
    });
  }, [onLanguageChange]);

  const loadQuery = useCallback(
    (q: string, useTooling: boolean, useMode?: "soql" | "sosl") => {
      if (useMode) {
        setMode(useMode);
        onLanguageChange?.(useMode);
      }
      setSoql(q);
      setTooling(useTooling);
      setResult(null);
      setBaseRecords(null);
      setJqlRows(null);
      setJqlLabel(null);
      setRunError(null);
      setSoslCounts(null);
      setPlanOpen(false);
    },
    [onLanguageChange]
  );

  const handleSave = useCallback(async () => {
    const label = saveLabel.trim() || soql.slice(0, 48);
    const entry: SoqlQuery = {
      id: newItemId(),
      soql: soql.trim(),
      label,
      saved: true,
      tooling,
      mode,
      rowCount: null,
      createdAt: Date.now(),
      lastRun: Date.now(),
    };
    try {
      await saveSoqlQuery(entry);
      setHistory((prev) => [entry, ...prev]);
      setSaveLabel("");
      setNotice(`Saved “${label}”.`);
    } catch {
      setNotice("Couldn't save (IndexedDB unavailable).");
    }
  }, [saveLabel, soql, tooling, mode]);

  const handleDeleteSaved = useCallback(async (id: string) => {
    try {
      await deleteSoqlQuery(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch {
      /* ignore */
    }
  }, []);

  const handleClearHistory = useCallback(async (): Promise<number> => {
    try {
      const n = await clearSoqlHistory(mode);
      setHistory((prev) => prev.filter((h) => h.saved || (h.mode ?? "soql") !== mode));
      setNotice(n > 0 ? `Cleared ${n} ${mode.toUpperCase()} run${n === 1 ? "" : "s"} from history (saved queries kept).` : "History already empty.");
      return n;
    } catch {
      setNotice("Couldn't clear history (IndexedDB unavailable).");
      return 0;
    }
  }, [mode]);

  const cheapest =
    plans && plans.length > 0
      ? plans.reduce((a, b) => (a.relativeCost <= b.relativeCost ? a : b))
      : null;

  return (
    <div className="arch-card overflow-hidden">
      <div className="arch-card__head px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold text-ivory-950">
          {mode === "sosl" ? "SOSL Search Builder" : "SOQL Query Builder"}
        </h2>
        <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden w-fit text-xs font-medium" role="tablist" aria-label="Query language">
          {(["soql", "sosl"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`px-3 py-1.5 transition-colors cursor-pointer ${
                mode === m ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface)] text-ivory-700 hover:text-ivory-950"
              }`}
            >
              {m === "soql" ? "SOQL" : "SOSL"}
            </button>
          ))}
        </div>
        {mode === "soql" && (
          <label className="flex items-center gap-1.5 text-xs text-ivory-700 cursor-pointer select-none" title="Include deleted and archived records (queryAll)">
            <input
              type="checkbox"
              checked={allRows}
              disabled={tooling}
              onChange={(e) => setAllRows(e.target.checked)}
              className="h-4 w-4 rounded border-ivory-400 text-bronze-600 focus:ring-bronze-500 disabled:opacity-40"
            />
            Deleted/Archived
          </label>
        )}
        {mode === "soql" && (
          <label className="flex items-center gap-1.5 text-xs text-ivory-700 cursor-pointer select-none" title="Run against the Tooling API (ApexClass, CustomObject, …)">
            <input
              type="checkbox"
              checked={tooling}
              onChange={(e) => {
                setTooling(e.target.checked);
                if (e.target.checked) setAllRows(false);
              }}
              className="h-4 w-4 rounded border-ivory-400 text-bronze-600 focus:ring-bronze-500"
            />
            Tooling API
          </label>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFieldInfoOpen(true)}
          disabled={!fromObject || mode !== "soql"}
          title={mode !== "soql" ? "Field reference is SOQL-only" : fromObject ? `Field reference for ${fromObject}` : "Write a FROM clause first"}
        >
          {fromObject && mode === "soql" ? `${fromObject} Field Info` : "Field Info"}
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {/* Templates / history / saved */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Load a template"
            defaultValue=""
            onChange={(e) => {
              if (mode === "sosl") {
                const t = SOSL_TEMPLATES.find((x) => x.name === e.target.value);
                if (t) loadQuery(t.sosl, false, "sosl");
              } else {
                const t = TEMPLATES.find((x) => x.name === e.target.value);
                if (t) loadQuery(t.soql, !!t.tooling, "soql");
              }
              e.target.value = "";
            }}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-ivory-900 focus:outline-none focus:border-bronze-500 cursor-pointer"
          >
            <option value="" disabled>Templates…</option>
            {(mode === "sosl" ? SOSL_TEMPLATES : TEMPLATES).map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)} title="Searchable history and saved queries">
            History ({historyItems.length + savedItems.length})…
          </Button>
          {historyOpen && (
            <QueryHistoryDialog
              history={historyItems}
              saved={savedItems}
              onClose={() => setHistoryOpen(false)}
              onLoad={(h) => loadQuery(h.soql, h.tooling, (h.mode ?? "soql") as "soql" | "sosl")}
              onDelete={(id) => void handleDeleteSaved(id)}
              onClearHistory={() => handleClearHistory()}
            />
          )}
          {/* Saved + delete live in the History dialog now */}
          <div className="flex gap-1.5 flex-1 min-w-[200px]">
            <div className="flex-1">
              <Input
                placeholder="Name this query…"
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                aria-label="Saved query name"
              />
            </div>
            <Button size="sm" variant="secondary" onClick={handleSave} disabled={!soql.trim()}>
              Save
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setSoql(""); setResult(null); setBaseRecords(null); setJqlRows(null); setJqlLabel(null); }}>
            Clear
          </Button>
        </div>

        {/* Editor */}
        <div>
          <textarea
            ref={taRef}
            value={soql}
            onChange={(e) => {
              setSoql(e.target.value);
              bumpCaret();
            }}
            onKeyUp={bumpCaret}
            onClick={bumpCaret}
            onSelect={bumpCaret}
            spellCheck={false}
            rows={5}
            aria-label={mode === "sosl" ? "SOSL search editor" : "SOQL query editor"}
            placeholder={mode === "sosl" ? SOSL_STARTER : SOQL_STARTER}
            className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none focus:ring-1 focus:ring-bronze-500 resize-y"
          />
          {mode === "soql" && suggestions.length > 0 && (
            <div className="mt-1.5">
              <p className="mb-1 text-[11px] text-ivory-600">
                {fromObject ? `${fromObject} suggestions` : "Suggestions"} - click to insert at caret:
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => applySuggestion(s.insert)}
                    title={`${s.insert} (${s.hint})`}
                    className="shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[11px] text-bronze-600 hover:border-bronze-500 hover:bg-[var(--color-accent-bg)] transition-colors cursor-pointer"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {!running ? (
            <Button onClick={handleRun} disabled={!soql.trim()}>
              Run Query
            </Button>
          ) : (
            <Button variant="danger" onClick={handleStop}>
              Stop
            </Button>
          )}
          {running && fetchProgress && (
            <span className="text-xs text-ivory-700" role="status">{fetchProgress}</span>
          )}
          <Button variant="secondary" onClick={handlePlan} disabled={!soql.trim() || running || mode !== "soql"} title={mode !== "soql" ? "Query plans are SOQL-only" : undefined}>
            Query Plan
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" size="sm" onClick={() => void copyExport("csv")} disabled={!result}>
            Copy CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void copyExport("tsv")} disabled={!result} title="Tab-separated - pastes straight into Excel">
            Copy Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void copyExport("json")} disabled={!result}>
            Copy JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={() => downloadExport("csv")} disabled={!result}>
            Download
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void downloadXlsx()} disabled={!result || xlsxBusy} title="Download the full result grid as .xlsx">
            {xlsxBusy ? "Building…" : "Excel (.xlsx)"}
          </Button>
        </div>

        {runError && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap" role="alert">
            {runError}
          </div>
        )}
        {notice && <p className="text-xs text-ivory-700">{notice}</p>}

        {baseRecords && baseRecords.length > 0 && (
          <div className="space-y-2">
            <QueryToolStrip
              records={baseRecords}
              onDisplay={(rows, label) => {
                setJqlRows(rows);
                setJqlLabel(label);
              }}
            />
            <QueryFilterBar
              records={baseRecords}
              onDisplay={(rows, label) => {
                setJqlRows(rows);
                setJqlLabel(label);
              }}
            />
          </div>
        )}

        {shown && (
          <div className="rounded-lg border border-[var(--color-line)] overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2 text-xs">
              <span className="font-semibold text-ivory-950">
                {shown.totalSize.toLocaleString()} row{shown.totalSize === 1 ? "" : "s"}
              </span>
              <span className="text-ivory-600">{shown.timeMs}ms</span>
              {jqlLabel && (
                <span className="rounded-full border border-bronze-300 bg-bronze-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-bronze-700" title="JsonQL view - exports follow this table">
                  {jqlLabel}
                </span>
              )}
              {shown.truncated && (
                <span className="font-medium text-amber-700">Partial results{shown.truncatedNote ? ` - ${shown.truncatedNote}` : ""}.</span>
              )}
              {mode === "sosl" && <Badge variant="info">SOSL</Badge>}
              {mode === "sosl" && soslCounts && (
                <span className="text-ivory-600">
                  {soslCounts.map((c) => `${c.type} ${c.count}`).join(" · ")}
                </span>
              )}
              {mode === "soql" && tooling && <Badge variant="info">Tooling</Badge>}
              {mode === "soql" && allRows && <Badge variant="warning">queryAll</Badge>}
            </div>
            <div ref={tableScrollRef} className="max-h-96 overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0">
                  <tr>
                    {shown.columns.map((c) => (
                      <th
                        key={c}
                        className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-left font-mono font-semibold text-ivory-900 whitespace-nowrap"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => (
                    <tr key={pageStart + i} className="odd:bg-[var(--color-surface)] even:bg-[var(--color-canvas)] hover:bg-ivory-300">
                      {r.map((cell, j) => (
                        <td
                          key={j}
                          className="border-b border-[var(--color-line-soft)] px-2.5 py-1.5 text-ivory-800 whitespace-nowrap max-w-[320px] overflow-hidden text-ellipsis"
                          title={cell}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.rows.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-ivory-600">Query ran clean - zero rows matched.</p>
              )}
            </div>
            {shown.rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-1.5 text-[11px] text-ivory-700">
                <div className="flex flex-1 items-center">
                  <span>
                    Showing {(pageStart + 1).toLocaleString()}–{Math.min(pageStart + pageSize, shown.rows.length).toLocaleString()} of {shown.rows.length.toLocaleString()}
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center gap-2">
                  <span className="font-medium text-ivory-950">
                    Page {(safePage + 1).toLocaleString()} of {totalPages.toLocaleString()}
                  </span>
                  <label className="flex items-center gap-1">
                    Per page
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(0);
                      }}
                      aria-label="Rows per page"
                      className="cursor-pointer rounded-md border border-[var(--color-line-soft)] bg-white px-1 py-0.5 font-mono text-[11px] text-ivory-950"
                    >
                      {PAGE_SIZES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-1 items-center justify-end">
                  <div className="flex items-center" role="navigation" aria-label="Result pages">
                    <button
                      type="button"
                      onClick={() => gotoPage(0)}
                      disabled={safePage === 0}
                      aria-label="First page"
                      title="First page"
                      className="-ml-px cursor-pointer rounded-none border border-[var(--color-line)] bg-white px-2 py-1 font-semibold text-ivory-700 first:ml-0 first:rounded-l-md hover:bg-bronze-100 hover:text-bronze-700 disabled:opacity-40"
                    >
                      First
                    </button>
                    <button
                      type="button"
                      onClick={() => gotoPage(safePage - 1)}
                      disabled={safePage === 0}
                      aria-label="Previous page"
                      title="Previous page"
                      className="-ml-px cursor-pointer rounded-none border border-[var(--color-line)] bg-white px-2 py-1 font-semibold text-ivory-700 hover:bg-bronze-100 hover:text-bronze-700 disabled:opacity-40"
                    >
                      ‹
                    </button>
                    {pageList(safePage, totalPages).map((p, k) =>
                      p === "l" || p === "r" ? (
                        <span key={`${p}${k}`} className="-ml-px border border-[var(--color-line)] bg-white px-1.5 py-1 text-ivory-500">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => gotoPage(p)}
                          disabled={p === safePage}
                          aria-label={`Page ${p + 1}`}
                          aria-current={p === safePage ? "page" : undefined}
                          title={`Page ${p + 1}`}
                          className={`-ml-px cursor-pointer rounded-none border border-[var(--color-line)] bg-white px-2 py-1 font-mono ${
                            p === safePage
                              ? "font-bold text-bronze-700 underline decoration-bronze-400 decoration-2 underline-offset-2"
                              : "text-ivory-700 hover:bg-bronze-100 hover:text-bronze-700"
                          }`}
                        >
                          {p + 1}
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => gotoPage(safePage + 1)}
                      disabled={safePage >= totalPages - 1}
                      aria-label="Next page"
                      title="Next page"
                      className="-ml-px cursor-pointer rounded-none border border-[var(--color-line)] bg-white px-2 py-1 font-semibold text-ivory-700 hover:bg-bronze-100 hover:text-bronze-700 disabled:opacity-40"
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      onClick={() => gotoPage(totalPages - 1)}
                      disabled={safePage >= totalPages - 1}
                      aria-label="Last page"
                      title="Last page"
                      className="-ml-px cursor-pointer rounded-none border border-[var(--color-line)] bg-white px-2 py-1 font-semibold text-ivory-700 last:rounded-r-md hover:bg-bronze-100 hover:text-bronze-700 disabled:opacity-40"
                    >
                      Last
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Query plan */}
        {planOpen && (
          <div className="rounded-lg border border-[var(--color-line)] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2">
              <p className="text-xs font-semibold text-ivory-950">Query Plan (explain)</p>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="text-[11px] text-ivory-600 hover:text-ivory-950 underline cursor-pointer"
              >
                Hide
              </button>
            </div>
            <div className="p-3">
              {planLoading && <p className="text-xs text-bronze-600">Explaining query…</p>}
              {planError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap" role="alert">
                  {planError}
                </div>
              )}
              {plans && plans.length === 0 && !planLoading && (
                <p className="text-xs text-ivory-600">No plans returned - the query may not be explainable.</p>
              )}
              {plans && plans.length > 0 && (
                <div className="space-y-2">
                  {plans.map((p, i) => {
                    const isBest = cheapest === p;
                    return (
                      <div
                        key={i}
                        className={`rounded-lg border p-2.5 ${isBest ? "border-bronze-500 bg-[var(--color-accent-bg)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold tracking-tight text-ivory-950">{p.leadingOperationType}</span>
                          {isBest && (
                            <span className="rounded bg-ivory-950 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-ivory-100">
                              CHOSEN
                            </span>
                          )}
                          <span className="font-medium text-ivory-600">{p.sobjectType}</span>
                          <span className="flex-1" />
                          <span className="font-mono font-semibold text-ivory-950">cost {p.relativeCost}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ivory-300">
                          <div
                            className="h-full rounded-full bg-bronze-500"
                            style={{ width: `${Math.min(100, Math.max(2, p.relativeCost * 100))}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] font-medium text-ivory-800">
                          <span>cardinality: {p.cardinality ?? "unknown - consider a custom index"}</span>
                          <span>sobject: {p.sobjectCardinality?.toLocaleString?.() ?? p.sobjectCardinality}</span>
                          {(p.fields ?? []).length > 0 && <span>fields: {p.fields!.join(", ")}</span>}
                        </div>
                        {(p.notes ?? []).length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {p.notes!.map((n, j) => {
                              const body = n.description ?? n.text ?? "";
                              return (
                                <li key={j} className="text-xs leading-relaxed text-ivory-800">
                                  <span className="font-semibold text-ivory-950">Note: </span>
                                  {body || "No detail provided."}
                                  {n.tableEnumOrId && (
                                    <span className="ml-1.5 font-mono text-[11px] text-ivory-500">
                                      [{n.tableEnumOrId}]
                                    </span>
                                  )}
                                  {n.fields && n.fields.length > 0 && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {n.fields.map((f) => (
                                        <code
                                          key={f}
                                          className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-px font-mono text-[11px] font-medium text-bronze-600"
                                        >
                                          {f}
                                        </code>
                                      ))}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Field info modal */}
      {fieldInfoOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${fromObject ?? ""} field reference`}
          onClick={() => setFieldInfoOpen(false)}
        >
          <div className="modal-card max-w-2xl flex flex-col" style={{ maxHeight: "84vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                  Field reference
                </p>
                <h2 className="mt-1 text-lg font-bold text-ivory-950">{fromObject ?? "No object"}</h2>
              </div>
              <button
                type="button"
                onClick={() => setFieldInfoOpen(false)}
                aria-label="Close field reference"
                className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!fromDescribe ? (
                <p className="text-xs text-ivory-600">Loading field metadata…</p>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0">
                    <tr>
                      {["Field", "Label", "Type", "Custom", "Req", "Pick"].map((h) => (
                        <th key={h} className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-left font-semibold text-ivory-900">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fromDescribe.fields.map((f) => (
                      <tr key={f.name} className="odd:bg-[var(--color-surface)] even:bg-[var(--color-canvas)]">
                        <td className="border-b border-[var(--color-line-soft)] px-2 py-1 font-mono text-ivory-950">{f.name}</td>
                        <td className="border-b border-[var(--color-line-soft)] px-2 py-1 text-ivory-700">{f.label}</td>
                        <td className="border-b border-[var(--color-line-soft)] px-2 py-1 font-mono text-ivory-600">{f.type}</td>
                        <td className="border-b border-[var(--color-line-soft)] px-2 py-1 text-ivory-700">{f.name.includes("__") ? "yes" : ""}</td>
                        <td className="border-b border-[var(--color-line-soft)] px-2 py-1 text-ivory-700">{!f.nillable ? "yes" : ""}</td>
                        <td className="border-b border-[var(--color-line-soft)] px-2 py-1 font-mono text-ivory-600">
                          {(f.type === "picklist" || f.type === "multipicklist") ? (f.picklistValues ?? []).length : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
