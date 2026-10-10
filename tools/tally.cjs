// How often does each pattern show up? Runs many QR "soups" for 1000 generations and counts, per pattern,
// how many soups ever contained it and how many distinct appearances there were (same tracking as the page).
// The share of soups is what the rarity ranks in index.html are based on (see the comment above PATTERNS).
//
//   node tools/tally.cjs [random-strings]     default 300 random strings + every printable ASCII character
//   node tools/tally.cjs 1000                 ~1100 soups, takes a few minutes; the random stream is fixed,
//                                             so the same command always gives the same numbers
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error("cut " + a); return src.slice(i, j); };
const code = [cut("const QR = (() => {", "/* ===================== Game of Life"), cut("function lifeStep", "function step()"),
  cut("/* ---- famous patterns ---- */", "// Follow patterns")].join("\n");
const QR_VERSION = +src.match(/const QR_VERSION = (\d+);/)[1];   // the page's fixed QR version
const speedLine = src.match(/const SPEED = (\{.*?\});/)[1];
const ctx = { TextEncoder };
vm.createContext(ctx);
vm.runInContext("var N = 0, cur, tint;\n" + code + "\nthis.QR = QR; this.lifeStep = lifeStep; this.findPatterns = findPatterns; this.PATTERNS = PATTERNS;" +
  "\nthis.setState = (n, c, t) => { N = n; cur = c; tint = t; };", ctx);
const SPEED = eval("(" + speedLine + ")");
const MEMORY = p => (SPEED[p.name] ? 30 : 6);
const PAD = 12, MAXGEN = 1000;

let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const inputs = [];
for (let c = 32; c < 127; c++) inputs.push(String.fromCharCode(c));                 // every printable ASCII char
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:/?#-_=&";
for (let i = 0; i < +(process.argv[2] || 300); i++) {                                  // random strings (bigger QRs)
  let s = ""; const len = 5 + Math.floor(rnd() * 55);
  for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  inputs.push(s);
}

const soups = {}, appear = {};
function run(text) {
  const qr = ctx.QR.encode(new TextEncoder().encode(text), 1, QR_VERSION), n = qr.size + PAD * 2;
  let cur = new Uint8Array(n * n), nxt = new Uint8Array(n * n);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) cur[(y + PAD) * n + x + PAD] = qr.modules[y * qr.size + x];
  const tint = new Uint8Array(n * n), seen = new Set();
  const wrap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
  let tracked = [];
  for (let gen = 0; gen <= MAXGEN; gen++) {
    ctx.setState(n, cur, tint);
    const pool = tracked.slice(), next = [];
    for (const it of ctx.findPatterns()) {
      let best = -1, bd = Infinity;
      pool.forEach((p, i) => {
        if (p.name !== it.name) return;
        const d = Math.hypot(wrap(p.cx, it.cx), wrap(p.cy, it.cy));
        if (d < 2.6 + p.missed * (SPEED[p.name] || 0) && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) { const p = pool.splice(best, 1)[0]; p.cx = it.cx; p.cy = it.cy; p.missed = 0; next.push(p); }
      else { it.missed = 0; next.push(it); appear[it.name] = (appear[it.name] || 0) + 1; seen.add(it.name); }
    }
    for (const p of pool) if (++p.missed <= MEMORY(p)) next.push(p);
    tracked = next;
    ctx.lifeStep(cur, nxt, n); [cur, nxt] = [nxt, cur];
  }
  seen.forEach(id => { soups[id] = (soups[id] || 0) + 1; });
}
inputs.forEach(run);
const total = inputs.length;
console.log("soups:", total);
console.log("id".padEnd(10), "rank", "soups%".padStart(7), "appearances".padStart(12), "per soup".padStart(9));
for (const [id, rank] of ctx.PATTERNS) {
  const s = soups[id] || 0, a = appear[id] || 0;
  console.log(id.padEnd(10), String(rank).padEnd(4), ((100 * s / total).toFixed(1) + "%").padStart(7), String(a).padStart(12), (a / total).toFixed(2).padStart(9));
}
