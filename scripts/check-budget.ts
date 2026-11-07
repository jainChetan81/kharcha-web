// Ratchets (React guide §7, §11). Run after `npm run build`: npm run check:budget
// First-view JS: the entry chunk plus everything it imports statically, gzipped.
// Lower the limits when you shrink the bundle; raise them only in a reviewed change.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const FIRST_VIEW_KB = 240; // ponytail: shipped baseline (react-dom ~97, motion ~120). LazyMotion + m.* would cut ~80.
const CSS_KB = 16;
const SUPPRESSIONS = 0;

const dir = ".output/public/assets";
const files = readdirSync(dir);
const entry = files.find((f) => /^index-.*\.js$/.test(f));
assert.ok(entry, "No entry chunk; run npm run build first.");
const seen = new Set<string>();
const visit = (file: string) => {
  if (seen.has(file)) return;
  seen.add(file);
  for (const [, dep] of readFileSync(`${dir}/${file}`, "utf8").matchAll(/(?:^|[;\n])import[^"(]*?from"\.\/([^"]+\.js)"/g)) visit(dep);
};
visit(entry);
const kb = (file: string) => gzipSync(readFileSync(`${dir}/${file}`)).length / 1024;
const js = [...seen].reduce((sum, file) => sum + kb(file), 0);
const css = files.filter((f) => f.endsWith(".css")).reduce((sum, file) => sum + kb(file), 0);
console.log(`first-view JS ${js.toFixed(1)} KB (${seen.size} chunks) · CSS ${css.toFixed(1)} KB`);
assert.ok(js <= FIRST_VIEW_KB, `First-view JS ${js.toFixed(1)} KB is over ${FIRST_VIEW_KB} KB.`);
assert.ok(css <= CSS_KB, `CSS ${css.toFixed(1)} KB is over ${CSS_KB} KB.`);

const found = execSync(
  "git grep -nE '@ts-(ignore|expect-error|nocheck)|biome-ignore|eslint-disable' -- src scripts ':!scripts/check-budget.ts' ':!src/routeTree.gen.ts' || true",
  {
    encoding: "utf8",
  },
).trim();
const count = found ? found.split("\n").length : 0;
assert.ok(count <= SUPPRESSIONS, `Lint/type suppressions went up to ${count}:\n${found}`);
