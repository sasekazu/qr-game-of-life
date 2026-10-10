// Scores games exactly as index.html does (points per new pattern appearance over GAME_GENS generations), so you can
// look up what a text scores or see how scores are spread.
//
//   CLASS=small node tools/score.cjs "a" "hello"     score of each text (class small | large, default large)
//   CLASS=large node tools/score.cjs --random 200    spread of scores over 200 random texts (fixed random stream)
//
// The QR encoder, pattern table, finder and the scoring constants are cut out of index.html at run time.
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const cut = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("index.html layout changed, cannot find: " + a);
  return src.slice(i, j);
};
const grab = re => eval("(" + src.match(re)[1] + ")");
const BOARD_CLASSES = grab(/const BOARD_CLASSES = (\{.*?\});/);
const POINTS = grab(/const POINTS = (\[.*?\]);/), GAME_GENS = grab(/const GAME_GENS = (\d+);/);
const SPEED = grab(/const SPEED = (\{.*?\});/), PAD = grab(/const PAD = (\d+),/), ECL = 1;
const MEMORY = p => (SPEED[p.name] ? 30 : 6);

const CLS = process.env.CLASS || "large";
if (!(CLS in BOARD_CLASSES)) throw new Error("CLASS must be one of: " + Object.keys(BOARD_CLASSES).join(", "));
const QR_VERSION = BOARD_CLASSES[CLS];

const code = [
  cut("const QR = (() => {", "/* ===================== Game of Life"),
  cut("function lifeStep", "function step()"),
  cut("/* ---- famous patterns ---- */", "// Follow patterns"),
].join("\n");
const ctx = { TextEncoder };
vm.createContext(ctx);
vm.runInContext("var N = 0, cur, tint, boardClass = " + JSON.stringify(CLS) + ";\n" + code +
  "\nthis.QR = QR; this.lifeStep = lifeStep; this.findPatterns = findPatterns;" +
  "\nthis.setState = (n, c, t) => { N = n; cur = c; tint = t; };", ctx);

function play(text) {
  const qr = ctx.QR.encode(new TextEncoder().encode(text), ECL, QR_VERSION), n = qr.size + PAD * 2;
  let cur = new Uint8Array(n * n), nxt = new Uint8Array(n * n);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) cur[(y + PAD) * n + x + PAD] = qr.modules[y * qr.size + x];
  const tint = new Uint8Array(n * n);
  const wrap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
  let tracked = [], score = 0, gen = 0;
  const detect = () => {                                   // same tracking as detect() in the page
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
      else { it.missed = 0; next.push(it); score += POINTS[it.rank]; }
    }
    for (const p of pool) if (++p.missed <= MEMORY(p)) next.push(p);
    tracked = next;
  };
  detect();
  while (gen < GAME_GENS) {
    ctx.lifeStep(cur, nxt, n); [cur, nxt] = [nxt, cur]; gen++;
    detect();
  }
  return score;
}

const args = process.argv.slice(2);
if (args[0] === "--random") {
  const count = +args[1] || 100;
  let seed = 4242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:/?#-_=&";
  const max = ctx.QR.maxBytes(QR_VERSION, ECL);
  const scores = [];
  for (let i = 0; i < count; i++) {
    let t = ""; const len = 1 + Math.floor(rnd() * max);
    for (let j = 0; j < len; j++) t += alphabet[Math.floor(rnd() * alphabet.length)];
    scores.push(play(t));
  }
  scores.sort((a, b) => a - b);
  const q = f => scores[Math.min(scores.length - 1, Math.floor(f * scores.length))];
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  console.log(`class ${CLS}, ${count} random texts, points per rank ${POINTS.slice(1).join("/")}, ${GAME_GENS} generations`);
  console.log(`score: mean ${mean.toFixed(0)}  sd ${sd.toFixed(0)}  min ${scores[0]}  p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${scores[scores.length - 1]}`);
} else if (args.length) {
  for (const t of args) console.log(JSON.stringify(t).padEnd(22), String(play(t)).padStart(6), "points");
} else {
  console.error('usage: node tools/score.cjs "<text>" ...   |   node tools/score.cjs --random <count>');
  process.exit(1);
}
