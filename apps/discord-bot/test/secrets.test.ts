// Garde-fou : aucun token Discord dans les fichiers du bot ni dans la configuration versionnée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TOKENISH = /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/;
const root = new URL("..", import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  if (["node_modules", "dist", ".git"].includes(f)) return [];
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test("aucun token dans le code, les tests, la doc et la composition Docker versionnée", () => {
  const files = [...walk(root), join(root, "../deploy/docker-compose.discord.yml")].filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), TOKENISH, f);
});
