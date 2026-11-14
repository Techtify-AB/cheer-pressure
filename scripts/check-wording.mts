// Greps the source for wording left over from earlier versions (scripts/banned-phrases.json,
// `everywhere`), so a string that is not on screen right now is caught too. Comments count:
// they are what the next builder copies from. Run: npx tsx scripts/check-wording.mts
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const list = JSON.parse(readFileSync(path.join(ROOT, "scripts/banned-phrases.json"), "utf8")) as {
  everywhere: string[];
  allow: { file: string; phrase: string; line?: string; why: string }[];
};
const ROOTS = ["app", "components", "lib", "server/app", "server/lib", "server/components", "src-tauri/src", "src-tauri/Info.plist", "src-tauri/tauri.conf.json", "README.md", "docs/PROJECT.md"];
const EXT = /\.(tsx?|mts|js|mjs|css|rs|md|json|plist)$/;

function files(p: string): string[] {
  const full = path.join(ROOT, p);
  let st;
  try {
    st = statSync(full);
  } catch {
    return [];
  }
  if (st.isFile()) return EXT.test(p) ? [p] : [];
  return readdirSync(full).flatMap((n) => (n === "node_modules" || n.startsWith(".") ? [] : files(path.join(p, n))));
}

const hits: string[] = [];
for (const f of ROOTS.flatMap(files)) {
  const lines = readFileSync(path.join(ROOT, f), "utf8").split("\n");
  lines.forEach((text, i) => {
    for (const phrase of list.everywhere) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (!re.test(text)) continue;
      const ok = list.allow.some((a) => a.file === f && a.phrase === phrase && (!a.line || new RegExp(a.line, "i").test(text)));
      if (!ok) hits.push(`${f}:${i + 1}: "${phrase}": ${text.trim().slice(0, 140)}`);
    }
  });
}
for (const h of hits) console.log(`FAIL ${h}`);
console.log(hits.length ? `${hits.length} leftover phrases in the source` : `wording: no leftover phrases in ${ROOTS.length} places`);
process.exit(hits.length ? 1 : 0);
