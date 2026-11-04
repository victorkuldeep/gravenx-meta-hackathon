"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getCachedConnection } from "@/lib/session/cache";
import { BUCKET_LABEL, fetchCoverage, type CoverageBucket, type CoverageReport } from "@/lib/salesforce/coverage";
import { downloadCoverageReport } from "@/lib/salesforce/coverageExcel";
import { fetchDensity, fetchLensCounts, type DensityRow, type LensCounts } from "@/lib/salesforce/orgLens";
import type { CoverageRunner } from "@/lib/salesforce/coverage";

const BUCKETS: CoverageBucket[] = ["risk", "watch", "healthy", "no-lines"];
const BUCKET_BAR: Record<CoverageBucket, string> = {
  risk: "bg-red-500",
  watch: "bg-amber-500",
  healthy: "bg-emerald-600",
  "no-lines": "bg-ivory-300",
};
const BUCKET_TEXT: Record<CoverageBucket, string> = {
  risk: "text-red-700",
  watch: "text-amber-700",
  healthy: "text-emerald-700",
  "no-lines": "text-ivory-500",
};

export function LensPanel() {
  const [connected, setConnected] = useState(false);
  const [orgLabel, setOrgLabel] = useState("");
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [counts, setCounts] = useState<LensCounts | null>(null);
  const [density, setDensity] = useState<DensityRow[] | null>(null);
  const [densityMissing, setDensityMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<CoverageBucket | "all">("all");
  const [q, setQ] = useState("");
  const [xlsBusy, setXlsBusy] = useState(false);

  const load = useCallback(async () => {
    const conn = getCachedConnection();
    if (!conn) {
      setConnected(false);
      return;
    }
    setConnected(true);
    setOrgLabel(conn.orgKey || conn.instanceUrl);
    setLoading(true);
    setError(null);
    try {
      const run: CoverageRunner = async (soql) => {
        const res = await apiFetch(
          "/api/salesforce/soql",
          { instanceUrl: conn.instanceUrl, token: conn.token, apiVersion: conn.apiVersion, soql, tooling: true },
          60000
        );
        let body: { error?: unknown; records?: unknown[]; totalSize?: number };
        try {
          body = (await res.json()) as typeof body;
        } catch {
          return { ok: false, error: `Request failed (HTTP ${res.status}).` };
        }
        if (res.status === 401) return { ok: false, error: "Session expired - reconnect on home, then reopen Lens." };
        if (!res.ok || typeof body.error === "string") {
          return { ok: false, error: typeof body.error === "string" && body.error ? body.error : `Request failed (HTTP ${res.status}).` };
        }
        return { ok: true, records: (Array.isArray(body.records) ? body.records : []) as Record<string, unknown>[], totalSize: body.totalSize };
      };
      const [rep, lens, dens] = await Promise.all([fetchCoverage(run), fetchLensCounts(run), fetchDensity(run)]);
      setCoverage(rep);
      setCounts(lens);
      setDensity(dens);
      setDensityMissing(dens === null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lens failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!coverage) return [];
    const needle = q.trim().toLowerCase();
    return coverage.rows.filter(
      (r) =>
        (bucketFilter === "all" || r.bucket === bucketFilter) &&
        (!needle || r.name.toLowerCase().includes(needle) || r.objectName.toLowerCase().includes(needle))
    );
  }, [coverage, bucketFilter, q]);

  const maxBucket = Math.max(1, ...(coverage ? BUCKETS.map((b) => coverage.counts[b]) : [1]));

  if (!connected && !loading) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center">
        <h2 className="text-[16px] font-bold text-ivory-950">Org Lens needs a live org</h2>
        <p className="mt-2 text-[13px] text-ivory-500">
          Connect on the home page first - Lens reads Tooling API coverage and automation counts through your session. Nothing is stored.
        </p>
        <Link href="/" className="mt-4 inline-block rounded-lg bg-ivory-950 px-4 py-2 text-[13px] font-bold text-ivory-100 hover:bg-ivory-800">
          Go to home and connect
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-bold text-ivory-950">Org Lens</h2>
          <p className="truncate font-mono text-[11px] text-ivory-500">{orgLabel || "…"}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-[12px] font-semibold hover:bg-ivory-50 disabled:opacity-50"
        >
          {loading ? "Reading…" : "Refresh"}
        </button>
        <button
          type="button"
          disabled={!coverage || xlsBusy}
          onClick={() => {
            if (!coverage) return;
            setXlsBusy(true);
            void downloadCoverageReport(coverage, orgLabel || "org").finally(() => setXlsBusy(false));
          }}
          title="Download the leadership coverage workbook (.xlsx): summary + pivoted detail"
          className="rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
        >
          {xlsBusy ? "Building…" : "Coverage (.xlsx)"}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}

      {loading && !coverage && (
        <div className="grid gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-ivory-200" />
          ))}
        </div>
      )}

      {coverage && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ivory-500">Org Apex coverage</p>
              <p className="text-[34px] font-bold leading-none text-ivory-950">
                {coverage.orgPct === null ? "n/a" : `${coverage.orgPct.toFixed(1)}%`}
              </p>
              <p className="mt-1 text-[11px] text-ivory-500">
                {coverage.orgCovered.toLocaleString()} / {(coverage.orgCovered + coverage.orgUncovered).toLocaleString()} lines ·{" "}
                {coverage.rows.length} classes + triggers
              </p>
            </div>
            <div className="min-w-[220px] flex-1 space-y-1.5">
              {BUCKETS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBucketFilter((cur) => (cur === b ? "all" : b))}
                  title={`Filter table: ${BUCKET_LABEL[b]}`}
                  className="flex w-full cursor-pointer items-center gap-2"
                >
                  <span className={`w-24 shrink-0 text-left text-[11px] font-bold ${BUCKET_TEXT[b]}`}>{BUCKET_LABEL[b]}</span>
                  <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-ivory-200">
                    <span className={`block h-full rounded-full ${BUCKET_BAR[b]}`} style={{ width: `${(coverage.counts[b] / maxBucket) * 100}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right text-[11px] font-bold text-ivory-950">{coverage.counts[b]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or object…"
              className="w-56 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
            />
            {bucketFilter !== "all" && (
              <button
                type="button"
                onClick={() => setBucketFilter("all")}
                className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[11px] font-bold hover:bg-ivory-100"
              >
                {BUCKET_LABEL[bucketFilter]} ×
              </button>
            )}
            <span className="ml-auto text-[11px] text-ivory-500">
              {rows.length} of {coverage.rows.length} shown
            </span>
          </div>

          <div className="mt-2 max-h-[26rem] overflow-auto rounded-lg border border-[var(--color-line)]">
            <table className="w-full min-w-[52rem] border-collapse text-[12px]">
              <thead className="sticky top-0 bg-ivory-100">
                <tr className="text-left">
                  {["Name", "Type", "Object", "Covered", "Uncovered", "%", "Bucket"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-[var(--color-line)] px-2 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0 hover:bg-ivory-50">
                    <td className="max-w-[22rem] truncate px-2 py-1.5 font-mono font-bold" title={r.name}>
                      {r.name}
                    </td>
                    <td className="px-2 py-1.5 text-ivory-500">{r.kind}</td>
                    <td className="px-2 py-1.5 font-mono text-ivory-500">{r.objectName || "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r.covered.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">{r.uncovered.toLocaleString()}</td>
                    <td className={`px-2 py-1.5 text-right font-bold ${BUCKET_TEXT[r.bucket]}`}>
                      {r.pct === null ? "n/a" : `${r.pct.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-1.5">{BUCKET_LABEL[r.bucket]}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-ivory-500">
                      No classes or triggers match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h3 className="text-[13px] font-bold text-ivory-950">Automation load</h3>
          <p className="text-[11px] text-ivory-500">Live counts - inactive rows are the cleanup backlog.</p>
          <dl className="mt-2 grid grid-cols-2 gap-1.5">
            {(
              [
                ["Triggers active", counts?.triggersActive],
                ["Triggers inactive", counts?.triggersInactive],
                ["Flow versions active", counts?.flowActiveVersions],
                ["Validation on", counts?.validationActive],
                ["Validation off", counts?.validationInactive],
                ["Approval processes", counts?.approvals],
                ["Duplicate rules", counts?.duplicateRules],
                ["Queues with members", counts?.queues],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex items-baseline justify-between rounded-lg bg-white px-2.5 py-1.5 text-[12px]">
                <dt className="text-ivory-600">{label}</dt>
                <dd className="font-mono font-bold text-ivory-950">{v === null || v === undefined ? "n/a" : v.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h3 className="text-[13px] font-bold text-ivory-950">Heaviest objects</h3>
          <p className="text-[11px] text-ivory-500">Triggers + flows + validation per object. Open one in ERD for the full footprint.</p>
          {densityMissing && <p className="mt-2 text-[12px] text-amber-700">Grouping is unavailable in this org - individual counts above still stand.</p>}
          {density && density.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {density.map((d) => (
                <li key={d.objectName} className="flex items-center gap-2 text-[12px]">
                  <span className="w-40 shrink-0 truncate font-mono font-bold" title={d.objectName}>
                    {d.objectName}
                  </span>
                  <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ivory-200">
                    <span
                      className="block h-full rounded-full bg-bronze-600"
                      style={{ width: `${(d.total / Math.max(1, density[0].total)) * 100}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-ivory-600">
                    {d.triggers}T · {d.flows}F · {d.validation}V
                  </span>
                </li>
              ))}
            </ul>
          )}
          {density && density.length === 0 && <p className="mt-2 text-[12px] text-ivory-500">No grouped automation found.</p>}
        </section>
      </div>
    </div>
  );
}
