"use client";

/**
 * Link-share codec: a slim STRUCTURE payload (api names + positions + view,
 * optional notes) that a teammate resolves against their own org. No field
 * metadata ever leaves the browser - the receiver re-describes locally.
 * Transport-agnostic: same shape rides URL-hash links and the KV backend.
 */

import type { CanvasTodoStatus, InboxItemKind, InboxPriority } from "@/lib/inbox/types";
import type { LegacyShareEntityNote, ShareEntityRow } from "./share";

export const SHARE_LINK_VERSION = 1;
export const SHARE_MAX_NODES = 2000;
export const SHARE_MAX_BODY_BYTES = 256 * 1024;

export type { LegacyShareEntityNote, ShareEntityRow } from "./share";

const SHARE_KINDS = ["note", "task", "question", "decision"] as const;
const SHARE_PRIORITIES = ["low", "normal", "high", "critical"] as const;

function cleanKind(v: unknown): InboxItemKind | undefined {
  return typeof v === "string" && (SHARE_KINDS as readonly string[]).includes(v) ? (v as InboxItemKind) : undefined;
}

function cleanPriority(v: unknown): InboxPriority | undefined {
  return typeof v === "string" && (SHARE_PRIORITIES as readonly string[]).includes(v) ? (v as InboxPriority) : undefined;
}

function cleanStatus(v: unknown): CanvasTodoStatus {
  return v === "done" || v === "in-progress" || v === "blocked" || v === "awaiting-feedback" ? v : "open";
}

export interface ShareStructure {
  v: number;
  name: string;
  root: string;
  nodes: string[];
  positions: Record<string, { x: number; y: number }>;
  view?: "erd" | "graph";
  notes?: string;
  entityNotes?: Record<string, ShareEntityRow[] | LegacyShareEntityNote>;

  todos?: {
    id: string;
    title: string;
    body?: string;
    assignee?: string;
    dueDate?: string;
    kind?: InboxItemKind;
    owner?: string;
    team?: string;
    priority?: InboxPriority;
    status: "open" | "in-progress" | "blocked" | "awaiting-feedback" | "done";
    createdAt: number;
    updatedAt: number;
  }[];
}

export function validateShareStructure(raw: unknown): ShareStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== SHARE_LINK_VERSION) return null;
  if (typeof p.root !== "string" || !p.root) return null;
  if (!Array.isArray(p.nodes) || p.nodes.length === 0 || p.nodes.length > SHARE_MAX_NODES) return null;
  if (!p.nodes.every((n): n is string => typeof n === "string" && !!n)) return null;
  if (!p.positions || typeof p.positions !== "object") return null;
  for (const [k, v] of Object.entries(p.positions as Record<string, unknown>)) {
    if (typeof k !== "string") return null;
    const pos = v as { x?: unknown; y?: unknown };
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return null;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  }
  if (p.view !== undefined && p.view !== "erd" && p.view !== "graph") return null;
  if (p.notes !== undefined && typeof p.notes !== "string") return null;
  let entityNotes: ShareStructure["entityNotes"];
  if (p.entityNotes !== undefined) {
    if (!p.entityNotes || typeof p.entityNotes !== "object") return null;
    entityNotes = {};
    for (const [api, en] of Object.entries(p.entityNotes as Record<string, unknown>)) {
      if (Array.isArray(en)) {
        // New log shape: Markdown-only rows, sanitized field by field.
        const rows: ShareEntityRow[] = [];
        for (const r of en) {
          const row = r as Record<string, unknown>;
          if (!row || typeof row.text !== "string") continue;
          rows.push({
            ...(typeof row.title === "string" ? { title: row.title.slice(0, 160) } : {}),
            text: row.text.slice(0, 50_000),
            ...(cleanKind(row.kind) ? { kind: cleanKind(row.kind) } : {}),
            ...(typeof row.status === "string" ? { status: cleanStatus(row.status) } : {}),
            ...(typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
          });
        }
        if (rows.length > 0) entityNotes[api] = rows;
      } else {
        // Legacy single-note shape - receivers migrate on touch.
        const e = en as { text?: unknown; todo?: unknown; done?: unknown; updatedAt?: unknown };
        if (!e || typeof e.text !== "string") return null;
        entityNotes[api] = {
          text: e.text,
          ...(typeof e.todo === "boolean" ? { todo: e.todo } : {}),
          ...(typeof e.done === "boolean" ? { done: e.done } : {}),
          ...(typeof e.updatedAt === "number" ? { updatedAt: e.updatedAt } : {}),
        };
      }
    }
  }
  let todos: ShareStructure["todos"];
  if (p.todos !== undefined) {
    if (!Array.isArray(p.todos)) return null;
    todos = [];
    for (const t of p.todos) {
      const todo = t as Record<string, unknown>;
      if (!todo || typeof todo.id !== "string" || !todo.id || typeof todo.title !== "string") return null;
      todos.push({
        id: todo.id,
        title: todo.title,
        body: typeof todo.body === "string" ? todo.body : undefined,
        assignee: typeof todo.assignee === "string" ? todo.assignee : undefined,
        dueDate: typeof todo.dueDate === "string" ? todo.dueDate : undefined,
        ...(cleanKind(todo.kind) ? { kind: cleanKind(todo.kind) } : {}),
        ...(typeof todo.owner === "string" ? { owner: todo.owner.slice(0, 120) } : {}),
        ...(typeof todo.team === "string" ? { team: todo.team.slice(0, 120) } : {}),
        ...(cleanPriority(todo.priority) ? { priority: cleanPriority(todo.priority) } : {}),
        status: cleanStatus(todo.status),
        createdAt: typeof todo.createdAt === "number" ? todo.createdAt : Date.now(),
        updatedAt: typeof todo.updatedAt === "number" ? todo.updatedAt : Date.now(),
      });
    }
  }
  return {
    v: SHARE_LINK_VERSION,
    name: typeof p.name === "string" && p.name ? p.name : "Shared canvas",
    root: p.root,
    nodes: p.nodes as string[],
    positions: p.positions as ShareStructure["positions"],
    view: p.view as ShareStructure["view"],
    notes: p.notes as string | undefined,
    entityNotes,
    todos,
  };
}

export function shareStructureBytes(s: ShareStructure): number {
  try {
    return new TextEncoder().encode(JSON.stringify(s)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Short random id for KV keys (32 hex chars, unguessable capability). */
export function newShareId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}${Math.random().toString(36).slice(2, 18)}`.slice(0, 32);
}
