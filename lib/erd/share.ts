"use client";

/**
 * Portable ERD snapshot sharing: export a snapshot (or the live canvas) to a
 * JSON file a teammate can import to continue the exact same work - full
 * field metadata, positions, notes, curation. Import needs zero API calls,
 * so it lands even on a fresh session.
 */

import type { SalesforceDescribeResult } from "@/lib/salesforce/types";
import type { CanvasTodoStatus, InboxItemKind } from "@/lib/inbox/types";

export const ERD_SHARE_KIND = "gravenx-erd";
export const ERD_SHARE_VERSION = 1;

/** One Markdown-only entity-log row in a share payload. */
export interface ShareEntityRow {
  title?: string;
  text: string;
  kind?: InboxItemKind;
  status?: CanvasTodoStatus;
  updatedAt?: number;
}

/** Legacy single-note shape (pre-log shares) - receivers migrate on touch. */
export interface LegacyShareEntityNote {
  text: string;
  todo?: boolean;
  done?: boolean;
  updatedAt?: number;
}

export interface ErdSharePayload {
  kind: typeof ERD_SHARE_KIND;
  version: number;
  exportedAt: number;
  exportedOrg: string;
  snapshot: {
    name: string;
    root: string;
    focus: string;
    describes: SalesforceDescribeResult[];
    positions: Record<string, { x: number; y: number }>;
    notes?: string;
    notesFormat?: "md" | "rich";
    notesHtml?: string;
    removedIds?: string[];
    hiddenIds?: string[];
    dismissedIds?: string[];
  };
  entityNotes?: Record<string, ShareEntityRow[] | LegacyShareEntityNote>;
}

export function validateSharePayload(raw: unknown): ErdSharePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<ErdSharePayload>;
  if (p.kind !== ERD_SHARE_KIND) return null;
  if (typeof p.version !== "number" || p.version > ERD_SHARE_VERSION) return null;
  const s = p.snapshot;
  if (!s || typeof s !== "object") return null;
  if (typeof s.root !== "string" || !Array.isArray(s.describes)) return null;
  if (s.describes.length === 0) return null;
  for (const d of s.describes) {
    if (!d || typeof (d as SalesforceDescribeResult).name !== "string") return null;
    if (!Array.isArray((d as SalesforceDescribeResult).fields)) return null;
  }
  return {
    kind: ERD_SHARE_KIND,
    version: p.version,
    exportedAt: typeof p.exportedAt === "number" ? p.exportedAt : Date.now(),
    exportedOrg: typeof p.exportedOrg === "string" ? p.exportedOrg : "unknown org",
    snapshot: {
      name: typeof s.name === "string" && s.name ? s.name : "Shared canvas",
      root: s.root,
      focus: typeof s.focus === "string" && s.focus ? s.focus : s.root,
      describes: s.describes,
      positions:
        s.positions && typeof s.positions === "object" ? s.positions : {},
      notes: typeof s.notes === "string" ? s.notes : undefined,
      notesFormat: s.notesFormat === "rich" || s.notesFormat === "md" ? s.notesFormat : undefined,
      notesHtml: typeof s.notesHtml === "string" ? s.notesHtml : undefined,
      removedIds: Array.isArray(s.removedIds) ? s.removedIds.filter((x): x is string => typeof x === "string") : undefined,
      hiddenIds: Array.isArray(s.hiddenIds) ? s.hiddenIds.filter((x): x is string => typeof x === "string") : undefined,
      dismissedIds: Array.isArray(s.dismissedIds) ? s.dismissedIds.filter((x): x is string => typeof x === "string") : undefined,
    },
    entityNotes:
      p.entityNotes && typeof p.entityNotes === "object"
        ? Object.fromEntries(
            Object.entries(p.entityNotes as Record<string, unknown>).flatMap(([api, v]): [string, ShareEntityRow[] | LegacyShareEntityNote][] => {
              if (Array.isArray(v)) {
                const rows = v.filter(
                  (r): r is ShareEntityRow => !!r && typeof (r as ShareEntityRow).text === "string"
                );
                return rows.length > 0 ? [[api, rows]] : [];
              }
              const legacy = v as LegacyShareEntityNote;
              return legacy && typeof legacy.text === "string" ? [[api, legacy]] : [];
            })
          )
        : undefined,
  };
}

export function shareFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "erd";
  return `${slug}.sobject-erd.json`;
}
