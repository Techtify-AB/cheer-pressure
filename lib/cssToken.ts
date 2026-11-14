// Reads a design token from styles/tokens.css at build time, for the few places that
// need a literal value instead of a CSS variable (the theme colour in the page head and
// the web app manifest). Server only: it reads the file from disk.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function cssToken(name: string): string {
  const css = readFileSync(join(process.cwd(), "styles", "tokens.css"), "utf8");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`Design token ${name} is missing from styles/tokens.css`);
  return match[1].trim();
}
