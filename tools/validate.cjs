// Checks every pattern in index.html's PATTERNS table (run it after adding or editing a pattern):
//  - returns to its own shape after `period` generations (oscillators / ships), when it is meant to be periodic
//  - every phase is recognised as exactly that pattern by findPatterns() (one group, <= 100 cells, no name clash)
//
//   node tools/validate.cjs
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error("cut " + a); return src.slice(i, j); };
const code = [
  cut("function lifeStep", "function step()"),
  cut("/* ---- famous patterns ---- */", "// Follow patterns"),
].join("\n");
const ctx = { TextEncoder };
vm.createContext(ctx);
vm.runInContext("var N = 0, cur, tint, boardClass = \"large\";\n" + code +
  "\nthis.lifeStep = lifeStep; this.findPatterns = findPatterns; this.PATTERNS = PATTERNS; this.KNOWN = KNOWN;" +
  "\nthis.setState = (n, c, t) => { N = n; cur = c; tint = t; };", ctx);

const NONPERIODIC = new Set(["rpent"]);
const G = 64;
const keyOf = grid => {
  const cells = [];
  grid.forEach((v, i) => { if (v) cells.push([i % G, Math.floor(i / G)]); });
  const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
  return cells.map(c => (c[1] - my) * 1000 + (c[0] - mx)).sort((a, b) => a - b).join(",");
};
let bad = 0;
for (const [id, rank, period, art] of ctx.PATTERNS) {
  let a = new Uint8Array(G * G), b = new Uint8Array(G * G);
  art.split("/").forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "O") a[(y + 24) * G + x + 24] = 1; }));
  const k0 = keyOf(a), problems = [];
  const tint = new Uint8Array(G * G);
  let cells = a.reduce((s, v) => s + v, 0);
  for (let p = 0; p < period; p++) {
    ctx.setState(G, a, tint);
    const found = ctx.findPatterns();
    if (!(found.length === 1 && found[0].name === id)) problems.push(`phase ${p}: found ${JSON.stringify(found.map(f => f.name))}`);
    ctx.lifeStep(a, b, G); [a, b] = [b, a];
  }
  if (!NONPERIODIC.has(id) && keyOf(a) !== k0) problems.push("not periodic with the given period");
  if (cells > 100) problems.push("more than 100 cells");
  console.log((problems.length ? "FAIL " : "ok   ") + id.padEnd(9), "period", period, "cells", cells, problems.join("; "));
  if (problems.length) bad++;
}
console.log(bad ? `${bad} problem pattern(s)` : "all patterns OK");
