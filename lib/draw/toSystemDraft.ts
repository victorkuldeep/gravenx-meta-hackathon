/**
 * Whiteboard-to-System-Design bridge (deterministic, no AI).
 *
 * A sketch is only geometry: boxes with text become draft systems, arrows
 * whose ends land in boxes become draft connections. Everything the sketch
 * cannot know (methods, headers, auth, transforms) arrives empty for the
 * architect to fill in the confirm dialog and on the System canvas.
 */
import { newId, newProject, type SystemProject, type SystemType } from "@/lib/system-design/model";

/** sessionStorage handoff read once by the System canvas on mount. */
export const SYSTEM_DRAFT_KEY = "gravenx/system-draft";

export interface DraftSystem {
  key: string;
  name: string;
  systemType: SystemType;
  x: number;
  y: number;
  portHint?: string;
}

export interface DraftConnection {
  key: string;
  fromKey: string;
  toKey: string;
  label: string;
}

export interface TopologyDraft {
  systems: DraftSystem[];
  connections: DraftConnection[];
  warnings: string[];
}

const CONTAINER_KINDS = new Set(["rectangle", "ellipse", "diamond"]);
const ARROW_KINDS = new Set(["arrow", "line"]);
const TEXT_KIND = "text";
const EDGE_PAD = 8;

type El = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isLive(el: El): boolean {
  return el.isDeleted !== true;
}

function kindOf(el: El): string {
  return str(el.type);
}

function center(el: El): { x: number; y: number } {
  return { x: num(el.x) + num(el.width) / 2, y: num(el.y) + num(el.height) / 2 };
}

function inside(px: number, py: number, box: El, pad = 0): boolean {
  return (
    px >= num(box.x) - pad &&
    px <= num(box.x) + num(box.width) + pad &&
    py >= num(box.y) - pad &&
    py <= num(box.y) + num(box.height) + pad
  );
}

function textContent(el: El): string {
  const raw = str(el.originalText) || str(el.text);
  return raw.trim();
}

/** "Middleware :8080" -> { name: "Middleware", port: "8080" }. */
function splitNamePort(label: string): { name: string; port?: string } {
  const m = label.match(/^(.*?)\s*:\s*(\d{2,5})\s*$/);
  if (m && m[1].trim() !== "") return { name: m[1].trim(), port: m[2] };
  return { name: label };
}

const TYPE_RULES: { match: RegExp; type: SystemType }[] = [
  { match: /salesforce|sfdc|\bcrm\b/, type: "salesforce" },
  { match: /middleware|mule|boomi|esb|broker|ipaaS/i, type: "middleware" },
  { match: /servicenow|\bsnow\b|itsm/, type: "servicenow" },
  { match: /kafka|confluent|streaming|kinesis/, type: "streaming" },
  { match: /queue|sqs|rabbit|topic|pubsub/, type: "queue" },
  { match: /snowflake|bigquery|warehouse|redshift/, type: "warehouse" },
  { match: /dynamo|postgres|mysql|\bdb\b|database|mongo|oracle/, type: "database" },
  { match: /graphql|\bgql\b/, type: "graphql" },
  { match: /\brest\b|\bapi\b/, type: "rest" },
  { match: /app\b|web\b|react|portal|frontend/, type: "webapp" },
  { match: /aws|azure|\bcloud\b|gcp/, type: "cloud" },
  { match: /okta|sso|auth|identity|entra/, type: "identity" },
  { match: /bill|stripe|zuora|invoic/, type: "billing" },
  { match: /\berp\b|sap|netsuite/, type: "erp" },
  { match: /slack|email|sms|notif|alert/, type: "notify" },
];

export function guessSystemType(name: string): SystemType {
  const lower = name.toLowerCase();
  for (const rule of TYPE_RULES) {
    if (rule.match.test(lower)) return rule.type;
  }
  return "custom";
}

function arrowEnds(arrow: El): [{ x: number; y: number }, { x: number; y: number }] {
  const pts = Array.isArray(arrow.points) ? (arrow.points as unknown[]) : [];
  const at = (i: number): { x: number; y: number } => {
    const p = Array.isArray(pts[i]) ? (pts[i] as unknown[]) : [];
    return { x: num(arrow.x) + num(p[0]), y: num(arrow.y) + num(p[1]) };
  };
  if (pts.length >= 2) return [at(0), at(pts.length - 1)];
  return [
    { x: num(arrow.x), y: num(arrow.y) },
    { x: num(arrow.x) + num(arrow.width), y: num(arrow.y) + num(arrow.height) },
  ];
}

function boundId(binding: unknown): string | null {
  if (typeof binding !== "object" || binding === null) return null;
  const id = (binding as Record<string, unknown>).elementId;
  return typeof id === "string" ? id : null;
}

/**
 * Parse raw Excalidraw elements (structural - no Excalidraw imports here).
 * Never throws on foreign shapes; unknowns surface as warnings.
 */
export function parseTopology(elements: unknown): TopologyDraft {
  const warnings: string[] = [];
  if (!Array.isArray(elements)) {
    return { systems: [], connections: [], warnings: ["The board has no readable elements."] };
  }
  const els = elements.filter(
    (e): e is El => typeof e === "object" && e !== null && isLive(e as El),
  ) as El[];

  const boxes = els.filter((e) => CONTAINER_KINDS.has(kindOf(e)));
  const texts = els.filter((e) => kindOf(e) === TEXT_KIND);
  const arrows = els.filter((e) => ARROW_KINDS.has(kindOf(e)));

  if (boxes.length === 0) {
    return { systems: [], connections: [], warnings: ["No boxes found - draw a box per system."] };
  }

  const byId = new Map<string, El>();
  for (const e of els) {
    const id = str(e.id);
    if (id !== "") byId.set(id, e);
  }

  // Label per box: bound text wins, else text whose center sits inside.
  const labelFor = (box: El): string => {
    const boxId = str(box.id);
    const bound = texts.find((t) => str(t.containerId) === boxId && boxId !== "");
    if (bound) return textContent(bound);
    const inner = texts.find((t) => {
      if (str(t.containerId) !== "") return false;
      const p = center(t);
      return inside(p.x, p.y, box, EDGE_PAD);
    });
    return inner ? textContent(inner) : "";
  };

  const systems: DraftSystem[] = boxes.map((box, i) => {
    const rawLabel = labelFor(box);
    const firstLine = rawLabel.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
    const { name, port } = splitNamePort(firstLine);
    const finalName = name !== "" ? name : `Untitled-${i + 1}`;
    if (name === "") warnings.push(`Box ${i + 1} has no label - named "${finalName}".`);
    const system: DraftSystem = {
      key: `box-${i}`,
      name: finalName,
      systemType: guessSystemType(finalName),
      x: Math.round(num(box.x)),
      y: Math.round(num(box.y)),
    };
    if (port) system.portHint = port;
    return system;
  });

  const boxIndexById = new Map<string, number>();
  boxes.forEach((b, i) => {
    const id = str(b.id);
    if (id !== "") boxIndexById.set(id, i);
  });
  const locate = (p: { x: number; y: number }): number =>
    boxes.findIndex((b) => inside(p.x, p.y, b, EDGE_PAD));

  const labelForArrow = (arrow: El): string => {
    const arrowId = str(arrow.id);
    if (arrowId !== "") {
      const bound = texts.find((t) => str(t.containerId) === arrowId);
      if (bound) return textContent(bound).split("\n")[0] ?? "";
    }
    const [s, e] = arrowEnds(arrow);
    const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
    let best: El | null = null;
    let bestDist = 60;
    for (const t of texts) {
      if (str(t.containerId) !== "") continue;
      const p = center(t);
      const d = Math.hypot(p.x - mid.x, p.y - mid.y);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best ? textContent(best).split("\n")[0] ?? "" : "";
  };

  const connections: DraftConnection[] = [];
  arrows.forEach((arrow, i) => {
    const fromBound = boundId(arrow.startBinding);
    const toBound = boundId(arrow.endBinding);
    const fromIdx =
      fromBound && boxIndexById.has(fromBound) ? (boxIndexById.get(fromBound) as number) : -1;
    const toIdx =
      toBound && boxIndexById.has(toBound) ? (boxIndexById.get(toBound) as number) : -1;
    let from = fromIdx;
    let to = toIdx;
    if (from < 0 || to < 0) {
      const [s, e] = arrowEnds(arrow);
      if (from < 0) from = locate(s);
      if (to < 0) to = locate(e);
    }
    if (from < 0 || to < 0 || from === to) {
      warnings.push(`Arrow ${i + 1} points nowhere usable - skipped.`);
      return;
    }
    connections.push({
      key: `flow-${i}`,
      fromKey: systems[from].key,
      toKey: systems[to].key,
      label: labelForArrow(arrow),
    });
  });

  return { systems, connections, warnings };
}

export interface DraftSelection {
  included: string[];
  names: Record<string, string>;
  projectName: string;
}

/** Build a real (unsaved) SystemProject from a confirmed draft. */
export function buildSystemProject(draft: TopologyDraft, selection: DraftSelection): SystemProject {
  const project = newProject(
    selection.projectName.trim() === "" ? "Whiteboard topology" : selection.projectName.trim(),
  );
  const idByKey = new Map<string, string>();
  for (const s of draft.systems) {
    if (!selection.included.includes(s.key)) continue;
    const id = newId("sys");
    idByKey.set(s.key, id);
    const renamed = (selection.names[s.key] ?? "").trim();
    project.systems.push({
      id,
      name: renamed === "" ? s.name : renamed,
      systemType: s.systemType,
      description: s.portHint ? `Port hint from whiteboard: :${s.portHint}` : "",
      position: { x: s.x, y: s.y },
      iconKey: "plus",
    });
  }
  for (const c of draft.connections) {
    const fromId = idByKey.get(c.fromKey);
    const toId = idByKey.get(c.toKey);
    if (!fromId || !toId) continue;
    project.connections.push({
      id: newId("conn"),
      sourceId: fromId,
      targetId: toId,
      label: c.label,
      status: "draft",
    });
  }
  return project;
}
