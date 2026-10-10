// How often does each pattern show up? Runs many QR "soups" for 1000 generations and counts, per pattern,
// how many soups ever contained it and how many distinct appearances there were (same tracking as the page).
// The share of soups is what the rarity ranks in index.html are based on (see the comment above PATTERNS).
//
//   node tools/tally.cjs [random-strings] [small|large]    default: 300 random strings, large class
//   node tools/tally.cjs 1000 small      ~1100 soups of the small class (QR version 1), a few minutes
//   node tools/tally.cjs 1000 large      ... of the large class (version 6)
// The "suggest" column is the rank this data implies (see suggestRanks below).
// Every printable ASCII character is also run on its own. The random stream is fixed, so the same command always
// gives the same numbers. The "rank" column is the rank currently set for that class in index.html.
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error("cut " + a); return src.slice(i, j); };
const code = [cut("const QR = (() => {", "/* ===================== Game of Life"), cut("function lifeStep", "function step()"),
  cut("/* ---- famous patterns ---- */", "// Follow patterns")].join("\n");
const BOARD_CLASSES = eval("(" + src.match(/const BOARD_CLASSES = (\{.*?\});/)[1] + ")");   // class -> QR version
const CLS = process.argv[3] || "large";
if (!(CLS in BOARD_CLASSES)) throw new Error("class must be one of: " + Object.keys(BOARD_CLASSES).join(", "));
const QR_VERSION = BOARD_CLASSES[CLS];
const speedLine = src.match(/const SPEED = (\{.*?\});/)[1];
const ctx = { TextEncoder };
vm.createContext(ctx);
vm.runInContext("var N = 0, cur, tint, boardClass = " + JSON.stringify(CLS) + ";\n" + code + "\nthis.QR = QR; this.lifeStep = lifeStep; this.findPatterns = findPatterns; this.PATTERNS = PATTERNS; this.rankOf = rankOf;" +
  "\nthis.setState = (n, c, t) => { N = n; cur = c; tint = t; };", ctx);
const SPEED = eval("(" + speedLine + ")");
const MEMORY = p => (SPEED[p.name] ? 30 : 6);
const PAD = 12, MAXGEN = 1000;

let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const maxLen = Math.min(59, ctx.QR.maxBytes(QR_VERSION, 1)), minLen = Math.min(5, maxLen);   // string lengths, in bytes
const inputs = [];
for (let c = 32; c < 127; c++) inputs.push(String.fromCharCode(c));                 // every printable ASCII char
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:/?#-_=&";
for (let i = 0; i < +(process.argv[2] || 300); i++) {                                  // random strings (bigger QRs)
  let s = ""; const len = minLen + Math.floor(rnd() * (maxLen - minLen + 1));
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

// Ranks follow how OFTEN a pattern shows up, as a ladder: about once per 1000 generations is rank 5, once per 300 is
// rank 4, once per 100 rank 3, once per 30 rank 2, and anything more frequent is rank 1. The patterns are sorted by
// how often they appear and cut into 5 consecutive groups (rank 1 = most frequent). The cuts are chosen so that the
// groups' combined rates (appearances per 1000 generations) are as close as possible to the ladder, in log scale.
// Patterns never seen are rank 5.
const TARGET = { 5: 1000 / 1000, 4: 1000 / 300, 3: 1000 / 100, 2: 1000 / 30 };       // appearances per 1000 generations
function suggestRanks(rate) {                                                          // rate: id -> per 1000 generations
  const seenIds = Object.keys(rate).filter(id => rate[id] > 0).sort((a, b) => rate[b] - rate[a]), m = seenIds.length;
  const cost = (r, j, i) => {                                                          // group seenIds[j..i-1] gets rank r
    if (j >= i) return Infinity;
    if (r === 1) return 0;
    let sum = 0;
    for (let k = j; k < i; k++) sum += rate[seenIds[k]];
    return Math.log(sum / TARGET[r]) ** 2;
  };
  const dp = Array.from({ length: 6 }, () => new Array(m + 1).fill(Infinity)), from = Array.from({ length: 6 }, () => new Array(m + 1).fill(0));
  dp[0][0] = 0;
  for (let r = 1; r <= 5; r++) for (let i = 1; i <= m; i++) for (let j = 0; j < i; j++) {
    const c = dp[r - 1][j] + cost(r, j, i);
    if (c < dp[r][i]) { dp[r][i] = c; from[r][i] = j; }
  }
  const out = {};
  for (let r = 5, i = m; r >= 1; r--) { const j = from[r][i]; for (let k = j; k < i; k++) out[seenIds[k]] = r; i = j; }
  for (const id of Object.keys(rate)) if (!(id in out)) out[id] = 5;
  return out;
}
const perGen = {};
for (const [id] of ctx.PATTERNS) perGen[id] = (appear[id] || 0) / total * 1000 / (MAXGEN + 1);
const suggest = suggestRanks(perGen);

console.log("class:", CLS, "(QR version " + QR_VERSION + ")   soups:", total);
console.log("id".padEnd(10), "rank", "suggest", "soups%".padStart(7), "appearances".padStart(12), "per 1000 gens".padStart(14), "once per".padStart(10));
for (const [id] of ctx.PATTERNS) {
  const rank = ctx.rankOf(id);
  const s = soups[id] || 0, a = appear[id] || 0, r = perGen[id];
  console.log(id.padEnd(10), String(rank).padEnd(4), String(suggest[id]).padEnd(7), ((100 * s / total).toFixed(1) + "%").padStart(7),
    String(a).padStart(12), r.toFixed(3).padStart(14), (r ? Math.round(1000 / r) + " gens" : "never").padStart(10));
}
const groupRate = [1, 2, 3, 4, 5].map(k => ctx.PATTERNS.filter(([id]) => suggest[id] === k).reduce((t, [id]) => t + perGen[id], 0));
console.log("suggested groups, combined: " + groupRate.map((g, k) => `rank ${k + 1}: ` + (g ? "once per " + Math.round(1000 / g) + " gens" : "never")).join(" | "));
