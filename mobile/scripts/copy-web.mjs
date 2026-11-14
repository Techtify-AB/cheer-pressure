// Copies the web interface's static export (the repository's out/, written by `pnpm build` at the
// root) into the app: modules/cheer-native/ios/web, which the native module's podspec copies into
// the app as one folder. Run before a build that should carry the interface (every release build;
// development builds load the dev server instead). `--build` runs `pnpm build` at the root first.
//
//   node scripts/copy-web.mjs           copy the out/ that is there
//   node scripts/copy-web.mjs --build   build the web interface, then copy it

import { execSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const mobile = path.resolve(import.meta.dirname, "..");
const root = path.resolve(mobile, "..");
const out = path.join(root, "out");
const dest = path.join(mobile, "modules", "cheer-native", "ios", "web");

if (process.argv.includes("--build")) {
  execSync("pnpm build", { cwd: root, stdio: "inherit" });
}

if (!existsSync(path.join(out, "index.html"))) {
  console.error(`No web interface at ${out}. Run \`pnpm build\` in ${root} first, or run this with --build.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(out, dest, { recursive: true });
writeFileSync(path.join(dest, ".keep"), "The web interface is copied here by scripts/copy-web.mjs (npm run web:copy). Not committed.\n");

let files = 0;
let bytes = 0;
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = path.join(d, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      files++;
      bytes += s.size;
    }
  }
};
walk(dest);
const built = statSync(path.join(out, "index.html")).mtime;
console.log(`Copied the web interface (built ${built.toLocaleString()}): ${files} files, ${(bytes / 1e6).toFixed(1)} MB, into ${path.relative(mobile, dest)}`);
