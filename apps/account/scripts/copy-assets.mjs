// Copie à côté du code compilé ce que tsc ne copie pas : les migrations SQL et les images des e-mails (src/assets).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
for (const [dir, ext] of [["migrations", ".sql"], ["assets", ".png"]]) {
  const src = new URL(`../src/${dir}/`, import.meta.url);
  const dst = new URL(`../dist/${dir}/`, import.meta.url);
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) if (f.endsWith(ext)) cpSync(new URL(f, src), new URL(f, dst));
}
