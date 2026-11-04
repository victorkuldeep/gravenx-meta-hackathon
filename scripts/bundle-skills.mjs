// Builds the installable GRAVENX skill bundle: dist/gravenx-skills-<version>.zip
// Zero dependencies - store-only zip (no compression) written by hand.
// Usage: node scripts/bundle-skills.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bundle = JSON.parse(readFileSync(join(root, "skills", "bundle.json"), "utf8"));
if (bundle.version !== pkg.version) {
  console.error(`bundle.json version ${bundle.version} != package.json ${pkg.version} - align them first.`);
  process.exit(1);
}

const skillNames = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const files = [];
for (const n of skillNames) {
  files.push({
    path: `gravenx-skills/skills/${n}/SKILL.md`,
    data: readFileSync(join(root, "skills", n, "SKILL.md")),
  });
}
const manifest = {
  ...bundle,
  skills: skillNames.map((n) => {
    const text = readFileSync(join(root, "skills", n, "SKILL.md"), "utf8");
    const d = text.match(/^description:\s*(.+)$/m);
    return { name: n, description: d ? d[1].trim() : "" };
  }),
  skillCount: skillNames.length,
};
files.push({
  path: "gravenx-skills/bundle.json",
  data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
});
files.push({
  path: "gravenx-skills/README.md",
  data: readFileSync(join(root, "skills", "README.md")),
});

// --- minimal store-only zip ---
function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const chunks = [];
const central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.path);
  const crc = crc32(f.data);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // utf-8 names
  local.writeUInt16LE(0, 8); // store
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(f.data.length, 18);
  local.writeUInt32LE(f.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);
  chunks.push(local, f.data);
  central.push({ name, crc, size: f.data.length, offset });
  offset += local.length + f.data.length;
}
const cdStart = offset;
const cdChunks = [];
for (const e of central) {
  const h = Buffer.alloc(46 + e.name.length);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(0x031e, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0x0800, 8); // utf-8 names
  h.writeUInt16LE(0, 10); // store
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.size, 20);
  h.writeUInt32LE(e.size, 24);
  h.writeUInt16LE(e.name.length, 28);
  h.writeUInt32LE(e.offset, 42);
  e.name.copy(h, 46);
  cdChunks.push(h);
  offset += h.length;
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length, 8);
end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(offset - cdStart, 12);
end.writeUInt32LE(cdStart, 16);

mkdirSync(join(root, "dist"), { recursive: true });
const zipName = `gravenx-skills-${bundle.version}.zip`;
writeFileSync(join(root, "dist", zipName), Buffer.concat([...chunks, ...cdChunks, end]));
console.log(`bundled ${skillNames.length} skills -> dist/${zipName}`);
