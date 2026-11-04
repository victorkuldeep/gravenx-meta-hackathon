// Installs the GRAVENX skill bundle into an agent's skills directory.
// The USER runs this - it only writes where the user points it.
// Usage:
//   node scripts/install-skills.mjs --target claude|codex|cursor|opencode [--source <dir>] [--project <dir>] [--dir <dir>] [--list]
// Defaults: --source = this repo's skills/. --project = cwd (cursor/opencode).
// --dir overrides the destination entirely.
import { readdirSync, cpSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const ROOT = resolve(join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), ".."));
const source = resolve(opt("--source", join(ROOT, "skills")));
const project = resolve(opt("--project", process.cwd()));
const explicitDir = opt("--dir", null);
const target = opt("--target", null);

const DESTS = {
  claude: join(os.homedir(), ".claude", "skills"),
  codex: join(os.homedir(), ".codex", "skills"),
  cursor: join(project, ".cursor", "skills"),
  opencode: join(project, ".opencode", "skills"),
};

if (args.includes("--list") || !target) {
  console.log("targets: " + Object.keys(DESTS).join(", "));
  console.log("example: node scripts/install-skills.mjs --target claude");
  process.exit(args.includes("--list") || !target ? 0 : 1);
}
if (!DESTS[target]) {
  console.error(`unknown target "${target}" - one of: ${Object.keys(DESTS).join(", ")}`);
  process.exit(1);
}
if (!existsSync(join(source, "bundle.json"))) {
  console.error(`source is not a skill bundle (no bundle.json): ${source}`);
  process.exit(1);
}

const dest = explicitDir ? resolve(explicitDir) : DESTS[target];
const skills = readdirSync(source, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
mkdirSync(dest, { recursive: true });
for (const s of skills) cpSync(join(source, s), join(dest, s), { recursive: true });
console.log(`installed ${skills.length} GRAVENX skills -> ${dest}`);
