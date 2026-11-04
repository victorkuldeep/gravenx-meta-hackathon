/**
 * Agent Control Plane - policy store.
 *
 * Everything the Setup tab governs lives here as data, not code edits:
 * per-skill enable flags, per-tool enable + approval overrides, global
 * read-only, and numeric caps. Persisted in localStorage (small, sync
 * reads - the agent loop cannot await IDB mid-turn); code defaults are
 * the fallback and the reset target. Versioned for clean upgrades.
 */

export type ApprovalOverride = "default" | "always" | "never";

export interface ToolPolicy {
  enabled: boolean;
  approval: ApprovalOverride;
}

export interface SkillPolicy {
  enabled: boolean;
  tools: Record<string, ToolPolicy>;
}

export interface AgentCaps {
  /** Rows handed back per SOQL/SOSL/Tooling page. */
  maxRows: number;
  /** Fields listed per describe. */
  maxFields: number;
  /** Apex debug-log chars handed back. */
  maxLogChars: number;
  /** Agent loop turns per user message. */
  maxSteps: number;
  /** Apex block chars accepted per run (schema ceiling is 8000). */
  maxApexChars: number;
}

export interface AgentPolicy {
  version: 1;
  /** When on, every org-touching tool requires explicit Apply. */
  globalReadOnly: boolean;
  skills: Record<string, SkillPolicy>;
  caps: AgentCaps;
}

/** Inventory shape the registry hands in - no import cycle with lib/ai. */
export interface PolicyInventoryTool {
  name: string;
  needsApproval: boolean;
  /** Human-readable contract - shown in Setup, never sent to the model as policy. */
  description: string;
  /** JSON-schema parameters object, as declared on the tool. */
  schema: unknown;
}

export interface PolicyInventorySkill {
  skill: string;
  tools: PolicyInventoryTool[];
}

export const POLICY_VERSION = 1 as const;
const STORAGE_KEY = "gravenx-agent-policy";

export const DEFAULT_CAPS: AgentCaps = {
  maxRows: 25,
  maxFields: 80,
  maxLogChars: 4000,
  maxSteps: 8,
  maxApexChars: 8000,
};

const CAP_FLOORS: AgentCaps = { maxRows: 1, maxFields: 10, maxLogChars: 500, maxSteps: 1, maxApexChars: 100 };
const CAP_CEILINGS: AgentCaps = { maxRows: 100, maxFields: 400, maxLogChars: 12000, maxSteps: 12, maxApexChars: 8000 };

export function clampCaps(caps: Partial<AgentCaps>): AgentCaps {
  const out = { ...DEFAULT_CAPS };
  (Object.keys(DEFAULT_CAPS) as (keyof AgentCaps)[]).forEach((k) => {
    const v = caps[k];
    if (typeof v !== "number" || Number.isNaN(v)) return;
    out[k] = Math.min(CAP_CEILINGS[k], Math.max(CAP_FLOORS[k], Math.floor(v)));
  });
  return out;
}

export function buildDefaultPolicy(inventory: PolicyInventorySkill[]): AgentPolicy {
  const skills: Record<string, SkillPolicy> = {};
  for (const s of inventory) {
    const tools: Record<string, ToolPolicy> = {};
    for (const t of s.tools) tools[t.name] = { enabled: true, approval: "default" };
    skills[s.skill] = { enabled: true, tools };
  }
  return { version: POLICY_VERSION, globalReadOnly: false, skills, caps: { ...DEFAULT_CAPS } };
}

function isToolPolicy(v: unknown): v is ToolPolicy {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.enabled === "boolean" && (o.approval === "default" || o.approval === "always" || o.approval === "never");
}

/** Fresh copy - callers may freely mutate the returned policy. */
export function copyPolicy(policy: AgentPolicy): AgentPolicy {
  const skills: Record<string, SkillPolicy> = {};
  for (const [name, s] of Object.entries(policy.skills)) {
    const tools: Record<string, ToolPolicy> = {};
    for (const [tname, t] of Object.entries(s.tools)) tools[tname] = { ...t };
    skills[name] = { enabled: s.enabled, tools };
  }
  return { version: POLICY_VERSION, globalReadOnly: policy.globalReadOnly, skills, caps: { ...policy.caps } };
}

/** Merge a stored blob over defaults - unknown skills/tools are dropped, missing ones heal. */
export function mergePolicy(defaults: AgentPolicy, stored: unknown): AgentPolicy {
  if (!stored || typeof stored !== "object") return copyPolicy(defaults);
  const s = stored as Partial<AgentPolicy> & { skills?: Record<string, unknown>; caps?: Partial<AgentCaps> };
  if (s.version !== POLICY_VERSION) return defaults;
  const skills: Record<string, SkillPolicy> = {};
  for (const [skillName, defSkill] of Object.entries(defaults.skills)) {
    const storedSkill = (s.skills?.[skillName] ?? {}) as { enabled?: unknown; tools?: Record<string, unknown> };
    const tools: Record<string, ToolPolicy> = {};
    for (const [toolName, defTool] of Object.entries(defSkill.tools)) {
      const storedTool = storedSkill.tools?.[toolName];
      tools[toolName] = isToolPolicy(storedTool) ? { enabled: storedTool.enabled, approval: storedTool.approval } : { ...defTool };
    }
    skills[skillName] = {
      enabled: typeof storedSkill.enabled === "boolean" ? storedSkill.enabled : defSkill.enabled,
      tools,
    };
  }
  return {
    version: POLICY_VERSION,
    globalReadOnly: s.globalReadOnly === true,
    skills,
    caps: clampCaps(s.caps ?? {}),
  };
}

let cached: AgentPolicy | null = null;
let defaultsRef: AgentPolicy | null = null;

/** Registry hands its inventory once at startup; doubles as the reset source. */
export function setPolicyDefaults(policy: AgentPolicy): void {
  defaultsRef = policy;
  cached = null;
}

function readStored(): unknown {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function baseDefaults(): AgentPolicy {
  return (
    defaultsRef ?? { version: POLICY_VERSION, globalReadOnly: false, skills: {}, caps: { ...DEFAULT_CAPS } }
  );
}

/** Sync read - safe anywhere (loop, tools, SSR, tests). */
export function getPolicy(): AgentPolicy {
  if (!cached) cached = mergePolicy(baseDefaults(), readStored());
  return cached;
}

export function savePolicy(policy: AgentPolicy): AgentPolicy {
  const clean = copyPolicy(policy);
  clean.caps = clampCaps(policy.caps);
  clean.globalReadOnly = policy.globalReadOnly === true;
  cached = clean;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode etc - memory copy still governs this tab */
  }
  return clean;
}

export function resetPolicy(): AgentPolicy {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  cached = null;
  return getPolicy();
}

/** Test/SSR escape hatch - forget the in-memory copy. */
export function clearPolicyCache(): void {
  cached = null;
}

export function skillEnabled(skillName: string): boolean {
  const s = getPolicy().skills[skillName];
  return s ? s.enabled : true;
}

export function toolEnabled(skillName: string, toolName: string): boolean {
  const s = getPolicy().skills[skillName];
  // Unknown skills/tools fail open - toolsForSkill only serves registered
  // names, and the policy must never disable what it does not know.
  if (!s) return true;
  if (!s.enabled) return false;
  const t = s.tools[toolName];
  return t ? t.enabled : true;
}

export function policyCaps(): AgentCaps {
  return getPolicy().caps;
}

/**
 * Approval verdict for one tool call. "always"/"never" overrides win;
 * otherwise the tool's own flag stands. Global read-only forces Apply
 * on everything that reaches the org (orgTouch tools).
 */
export function resolveNeedsApproval(skillName: string, tool: { name: string; needsApproval: boolean; orgTouch?: boolean }): boolean {
  const override = getPolicy().skills[skillName]?.tools[tool.name]?.approval ?? "default";
  if (override === "always") return true;
  if (override === "never") return false;
  if (getPolicy().globalReadOnly && tool.orgTouch === true) return true;
  return tool.needsApproval;
}
