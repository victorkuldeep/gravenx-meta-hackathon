// Copies version-locked Excalidraw runtime assets (fonts, locales) from the
// installed npm package into public/ so they are served from our own origin.
// Idempotent: skips work when the stamp matches the installed version.
// Wired via predev / prebuild / prebuild:worker - never commit the output.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
// Resolve without loading the (browser-only) package entry point.
const pkgJson = join(root, "node_modules", "@excalidraw", "excalidraw", "package.json");
const version = JSON.parse(readFileSync(pkgJson, "utf8")).version;
const src = join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod");
const dest = join(root, "public", "excalidraw-assets");
const stamp = join(dest, ".version");

if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
  console.log(`[excalidraw-assets] up to date (${version})`);
  process.exit(0);
}

const walk = (dir) => {
  const out = [];
  for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

rmSync(dest, { recursive: true, force: true });
let count = 0;
for (const sub of ["fonts", "locales", "data"]) {
  const from = join(src, sub);
  if (!existsSync(from)) continue;
  for (const file of walk(from)) {
    const rel = file.slice(from.length);
    const to = join(dest, sub, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
    count += 1;
  }
}
writeFileSync(stamp, `${version}\n`);
console.log(`[excalidraw-assets] copied ${count} files (${version}) -> public/excalidraw-assets/`);
