// Rare-pattern scanner: for each character, build the QR -> Life seed exactly like index.html
// and report when patterns of rank >= MIN_RANK first show up within MAX_GEN generations.
//
//   node tools/scan.cjs "abc[7"            characters to try (each one is tested as a 1-character text)
//   MAX_GEN=2000 MIN_RANK=4 node tools/scan.cjs "[7AN"
//   CLASS=small node tools/scan.cjs "abc"  board class (small | large, default large); ranks are per class
//
// The QR encoder, pattern table and pattern finder are cut out of index.html at run time,
// so the scan always matches the page. Pattern tracking mirrors detect() (without effects).
const fs = require("fs"), vm = require("vm"), path = require("path");

const MAX_GEN = +process.env.MAX_GEN || 1000;
const MIN_RANK = +process.env.MIN_RANK || 3;
const PAD = 12;                     // same as index.html
const ECL = 1;                      // error correction M, same as index.html
const SPEED = { glider: 0.3, lwss: 0.55, mwss: 0.55, hwss: 0.55 };   // keep in sync with index.html (pattern ids)
const MEMORY = p => (SPEED[p.name] ? 30 : 6);

const chars = process.argv[2];
if (!chars) { console.error('usage: node tools/scan.cjs "<characters>"'); process.exit(1); }

const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const BOARD_CLASSES = eval("(" + src.match(/const BOARD_CLASSES = (\{.*?\});/)[1] + ")");   // class -> QR version
const CLS = process.env.CLASS || "large";
if (!(CLS in BOARD_CLASSES)) throw new Error("CLASS must be one of: " + Object.keys(BOARD_CLASSES).join(", "));
const QR_VERSION = BOARD_CLASSES[CLS];
const cut = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("index.html layout changed, cannot find: " + a);
  return src.slice(i, j);
};
const code = [
  cut("const QR = (() => {", "/* ===================== Game of Life"),
  cut("function lifeStep", "function step()"),
  cut("/* ---- famous patterns ---- */", "// Follow patterns"),
].join("\n");

const ctx = { TextEncoder };
vm.createContext(ctx);
vm.runInContext(
  "var N = 0, cur, tint, boardClass = " + JSON.stringify(CLS) + ";\n" + code +
  "\nthis.QR = QR; this.lifeStep = lifeStep; this.findPatterns = findPatterns;" +
  "\nthis.setState = (n, c, t) => { N = n; cur = c; tint = t; };", ctx);

function scan(ch) {
  const qr = ctx.QR.encode(new TextEncoder().encode(ch), ECL, QR_VERSION);
  const n = qr.size + PAD * 2;
  let cur = new Uint8Array(n * n), nxt = new Uint8Array(n * n);
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) cur[(y + PAD) * n + x + PAD] = qr.modules[y * qr.size + x];
  const tint = new Uint8Array(n * n), events = [];
  const wrap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
  let tracked = [];
  for (let gen = 0; gen <= MAX_GEN; gen++) {
    ctx.setState(n, cur, tint);
    const pool = tracked.slice(), next = [];
    for (const it of ctx.findPatterns()) {
      let best = -1, bd = Infinity;
      pool.forEach((p, i) => {
        if (p.name !== it.name) return;
        const d = Math.hypot(wrap(p.cx, it.cx), wrap(p.cy, it.cy));
        if (d < 2.6 + p.missed * (SPEED[p.name] || 0) && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) {
        const p = pool.splice(best, 1)[0];
        p.cx = it.cx; p.cy = it.cy; p.missed = 0;
        next.push(p);
      } else {
        it.missed = 0;
        next.push(it);
        events.push({ gen, name: it.name, rank: it.rank });
      }
    }
    for (const p of pool) if (++p.missed <= MEMORY(p)) next.push(p);
    tracked = next;
    ctx.lifeStep(cur, nxt, n);
    [cur, nxt] = [nxt, cur];
  }
  return events;
}

for (const ch of chars) {
  const rare = scan(ch).filter(e => e.rank >= MIN_RANK);
  const best = Math.max(0, ...rare.map(e => e.rank));
  console.log(JSON.stringify(ch), "best", best || "-", "|", rare.map(e => `${e.gen}:${e.name}★${e.rank}`).join(" "));
}
