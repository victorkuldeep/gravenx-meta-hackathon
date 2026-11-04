// Syncs skills/*/SKILL.md (canonical) into mcp/tools/skills.ts (MCP runtime).
// Usage: node scripts/sync-skills.mjs [--check]
// --check exits 1 when the generated file differs (drift guard for CI).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const outFile = join(root, "mcp", "tools", "skills.ts");
const check = process.argv.includes("--check");

function parseSkill(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing frontmatter block`);
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 0) throw new Error(`${file}: bad frontmatter line: ${line}`);
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!fm.name || !fm.description) throw new Error(`${file}: name + description required`);
  return { name: fm.name, when: fm.description, body: m[2].trim() };
}

const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
if (!names.length) throw new Error("no skills found");

const packs = names.map((n) => {
  const file = join(skillsDir, n, "SKILL.md");
  const parsed = parseSkill(readFileSync(file, "utf8"), `skills/${n}/SKILL.md`);
  if (parsed.name !== n) throw new Error(`skills/${n}/SKILL.md: frontmatter name "${parsed.name}" must match directory "${n}"`);
  return parsed;
});

const q = (s) => JSON.stringify(s);
const entries = packs
  .map(
    (p) =>
      `  ${q(p.name)}: {\n    when: ${q(p.when)},\n    body: [\n${p.body
        .split("\n")
        .map((l) => `      ${q(l)},`)
        .join("\n")}\n    ].join("\\n"),\n  },`
  )
  .join("\n");

const header = `import { z } from "zod";
import type { McpTool } from "./types";

/**
 * Skill packs: opinionated GRAVENX playbooks per surface. Agents read the
 * pack BEFORE calling that surface's tools so plans follow studio
 * conventions (naming, validation order, what the Import buttons accept).
 * Start with skill_list, then skill_read for the surfaces in play.
 *
 * GENERATED from the skills pack markdown by scripts/sync-skills.mjs - do not edit.
 * The markdown files are canonical (Agent Skills format, MIT).
 */
`;

const footer = `
export function listSkills(): { name: string; when: string }[] {
  return Object.entries(SKILLS).map(([name, s]) => ({ name, when: s.when }));
}

export function readSkill(name: string): string {
  const key = name.trim().toLowerCase();
  const hit = SKILLS[key];
  if (!hit) {
    throw new Error(\`Unknown skill "\${name}". Available: \${Object.keys(SKILLS).join(", ")}.\`);
  }
  return hit.body;
}

export const skillTools: McpTool[] = [
  {
    name: "skill_list",
    description: "List GRAVENX skill packs (${names.join(", ")}). Read the relevant pack before planning work on that surface.",
    shape: {},
    run: async () => ({ ok: true, summary: \`\${Object.keys(SKILLS).length} skill packs.\`, data: { skills: listSkills() } }),
  },
  {
    name: "skill_read",
    description: "Read one skill pack: conventions, tool order, pitfalls for that surface.",
    shape: { name: z.string().min(1).max(40) },
    run: async (_dir, args) => {
      try {
        const body = readSkill(args.name as string);
        return { ok: true, summary: \`Skill "\${(args.name as string).trim().toLowerCase()}".\`, data: { markdown: body } };
      } catch (e) {
        return { ok: false, summary: "Unknown skill.", error: e instanceof Error ? e.message : "Unknown skill." };
      }
    },
  },
];
`;

const out = `${header}const SKILLS: Record<string, { when: string; body: string }> = {\n${entries}\n};\n${footer}`;
const prev = readFileSync(outFile, "utf8");
if (prev === out) {
  console.log(`skills in sync (${packs.length} packs).`);
} else if (check) {
  console.error("skills.ts drifted from skills/*/SKILL.md - run: npm run skills:sync");
  process.exit(1);
} else {
  writeFileSync(outFile, out);
  console.log(`synced ${packs.length} packs -> mcp/tools/skills.ts`);
}
