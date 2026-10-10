/* QR Life engine: the QR encoder, the pattern table with its ranks, the pattern finder and the scoring rules, as one
 * dependency-free script (no DOM). battle.html uses it; the rules are the same as in index.html (the same text on the
 * same board class scores the same). Loaded as a classic script so it also works when a page is opened from disk.
 *
 *   const game = QRLifeEngine.createGame("hello", "small");     // text + board class (small | large)
 *   while (!game.finished) { const events = game.step(); ... }   // events: patterns that newly appeared this generation
 *   game.score, game.gen, game.reason ("limit" | "settled")
 */
const QRLifeEngine = (() => {
"use strict";

const QR = (() => {
  const ECC_PER_BLOCK = [
    [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
  const FORMAT_BITS = [1, 0, 3, 2]; // L, M, Q, H

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (ver, ecl) =>
    Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  const countBits = ver => (ver <= 9 ? 8 : 16);
  const maxBytes = (ver, ecl) => Math.floor((dataCodewords(ver, ecl) * 8 - 4 - countBits(ver)) / 8);

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(deg) {
    const res = new Array(deg).fill(0);
    res[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < deg) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 2);
    }
    return res;
  }
  function rsRemainder(data, divisor) {
    const res = divisor.map(() => 0);
    for (const b of data) {
      const f = b ^ res.shift();
      res.push(0);
      divisor.forEach((c, i) => { res[i] ^= gfMul(c, f); });
    }
    return res;
  }

  // `fixedVer` (optional) forces that QR version, so every input gives a grid of the same size
  function encode(bytes, ecl, fixedVer = 0) {
    let ver = fixedVer || 1;
    if (fixedVer) { if (bytes.length > maxBytes(ver, ecl)) throw new RangeError("too long"); }
    else {                                                          // otherwise the smallest version that fits
      while (ver <= 40 && bytes.length > maxBytes(ver, ecl)) ver++;
      if (ver > 40) throw new RangeError("too long");
    }

    // bit stream: mode(0100) + count + data + terminator + pad
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, countBits(ver));
    for (const b of bytes) put(b, 8);
    const capBits = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, capBits - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }

    // split into blocks, add RS ECC, interleave
    const nBlocks = NUM_BLOCKS[ecl][ver];
    const eccLen = ECC_PER_BLOCK[ecl][ver];
    const rawCw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (rawCw % nBlocks);
    const shortLen = Math.floor(rawCw / nBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((blk, j) => {
        if (i !== shortLen - eccLen || j >= nShort) all.push(blk[i]);
      });
    }

    // matrix
    const size = ver * 4 + 17;
    const m = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const setFn = (x, y, v) => { m[y * size + x] = v ? 1 : 0; fn[y * size + x] = 1; };
    const bit = (v, i) => (v >>> i) & 1;

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
          setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    const drawFormat = mask => {
      const d = (FORMAT_BITS[ecl] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i));
      setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i));
      setFn(8, size - 8, 1);
    };
    drawFormat(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), c = Math.floor(i / 3);
        setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i));
      }
    }

    // data bits in zigzag order
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y * size + x] && bi < all.length * 8) {
          m[y * size + x] = bit(all[bi >>> 3], 7 - (bi & 7));
          bi++;
        }
      }
    }

    const applyMask = mask => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv && !fn[y * size + x]) m[y * size + x] ^= 1;
      }
    };
    const countOcc = (s, pat) => {
      let n = 0;
      for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) n++;
      return n;
    };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let dir = 0; dir < 2; dir++) for (let a = 0; a < size; a++) {
        let run = 1, prev = -1, s = "";
        for (let b = 0; b < size; b++) {
          const v = dir ? m[b * size + a] : m[a * size + b];
          s += v;
          if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else { run = 1; prev = v; }
        }
        p += 40 * (countOcc(s, "10111010000") + countOcc(s, "00001011101"));
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = m[y * size + x];
        if (c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) p += 3;
      }
      for (let i = 0; i < m.length; i++) dark += m[i];
      const total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };

    let best = 0, bestPen = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask); drawFormat(mask);
      const p = penalty();
      if (p < bestPen) { bestPen = p; best = mask; }
      applyMask(mask);
    }
    applyMask(best); drawFormat(best);
    return { size, version: ver, modules: m };
  }

  return { encode, maxBytes };
})();

const BOARD_CLASSES = { small: 1, large: 6 };         // class -> QR version (21 x 21 up to 14 bytes, 41 x 41 up to 106 bytes)
const PAD = 12, ECL = 1;                              // empty cells around the QR; error correction M
const POINTS = [0, 1, 3, 9, 27, 81];                  // points for a new appearance, by rank
const GAME_GENS = 1000;                               // a game lasts this many generations, or ends once the board repeats itself
const RANK_COLORS = ["#111111", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];   // plain cells, then rank 1..5
const SPEED = { glider: 0.3, lwss: 0.55, mwss: 0.55, hwss: 0.55 };   // cells per generation, upper bound
const MEMORY = p => (SPEED[p.name] ? 30 : 6);                         // generations a lost pattern is remembered

// [id, { small: rank, large: rank }, period, first phase]. A rank (1-5) is the rarity, set by how OFTEN the pattern
// appears (counted as in the log: a new appearance), as a ladder: about once per 1000 generations is rank 5, once per
// 300 is rank 4, once per 100 rank 3, once per 30 rank 2 and anything more frequent rank 1. Each class has its own
// ranks (a smaller board has fewer live cells, so everything is rarer there). The values come from
// `node tools/tally.cjs 1000 small|large` (~1100 QR "soups" of 1000 generations: every printable ASCII character plus
// random strings that fit); its "suggest" column is what to put here. Measure again after changing a class or the list.
const PATTERNS = [
  ["block", { small: 1, large: 1 }, 1, "OO/OO"],
  ["beehive", { small: 2, large: 1 }, 1, ".OO./O..O/.OO."],
  ["loaf", { small: 3, large: 2 }, 1, ".OO./O..O/.O.O/..O."],
  ["boat", { small: 3, large: 2 }, 1, "OO./O.O/.O."],
  ["ship", { small: 5, large: 4 }, 1, "OO./O.O/.OO"],
  ["tub", { small: 4, large: 3 }, 1, ".O./O.O/.O."],
  ["pond", { small: 4, large: 4 }, 1, ".OO./O..O/O..O/.OO."],
  ["blinker", { small: 2, large: 1 }, 2, "OOO"],
  ["toad", { small: 5, large: 5 }, 2, ".OOO/OOO."],
  ["beacon", { small: 5, large: 5 }, 2, "OO../OO../..OO/..OO"],
  ["pulsar", { small: 5, large: 5 }, 3, "..OOO...OOO../............./O....O.O....O/O....O.O....O/O....O.O....O/..OOO...OOO../............./..OOO...OOO../O....O.O....O/O....O.O....O/O....O.O....O/............./..OOO...OOO.."],
  ["glider", { small: 3, large: 2 }, 4, ".O./..O/OOO"],
  ["lwss", { small: 5, large: 5 }, 4, "O..O./....O/O...O/.OOOO"],
  ["snake", { small: 5, large: 5 }, 1, "OO.O/O.OO"],
  ["carrier", { small: 5, large: 5 }, 1, "OO../O..O/..OO"],
  ["barge", { small: 5, large: 5 }, 1, ".O../O.O./.O.O/..O."],
  ["longboat", { small: 5, large: 4 }, 1, "OO../O.O./.O.O/..O."],
  ["mango", { small: 5, large: 5 }, 1, ".OO../O..O./.O..O/..OO."],
  ["eater", { small: 5, large: 5 }, 1, "OO../O.O./..O./..OO"],
  ["clock", { small: 5, large: 5 }, 2, "..O./O.O./.O.O/.O.."],
  ["figure8", { small: 5, large: 5 }, 8, "OOO.../OOO.../OOO.../...OOO/...OOO/...OOO"],
  ["mwss", { small: 5, large: 5 }, 4, "..O.../O...O./.....O/O....O/.OOOOO"],
  ["hwss", { small: 5, large: 5 }, 4, "..OO.../O....O./......O/O.....O/.OOOOOO"],
  ["rpent", { small: 4, large: 3 }, 1, ".OO/OO./.O."],
];

const NAMES = {
  en: { block: "Block", beehive: "Beehive", loaf: "Loaf", boat: "Boat", ship: "Ship", tub: "Tub", pond: "Pond",
             blinker: "Blinker", toad: "Toad", beacon: "Beacon", pulsar: "Pulsar", glider: "Glider", lwss: "Lightweight spaceship",
             snake: "Snake", carrier: "Carrier", barge: "Barge", longboat: "Long boat", mango: "Mango", eater: "Eater", clock: "Clock",
             figure8: "Figure eight", mwss: "Middleweight spaceship", hwss: "Heavyweight spaceship", rpent: "R-pentomino" },
  ja: { block: "ブロック", beehive: "ビーハイブ", loaf: "ローフ", boat: "ボート", ship: "シップ", tub: "タブ", pond: "ポンド",
             blinker: "ブリンカー", toad: "ヒキガエル", beacon: "ビーコン", pulsar: "パルサー", glider: "グライダー", lwss: "軽量宇宙船",
             snake: "スネーク", carrier: "キャリア", barge: "バージ", longboat: "ロングボート", mango: "マンゴー", eater: "イーター", clock: "クロック",
             figure8: "フィギュアエイト", mwss: "中量宇宙船", hwss: "重量宇宙船", rpent: "R-ペントミノ" },
};

function lifeStep(src, dst, n) {
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (dx || dy) c += src[((y + dy + n) % n) * n + (x + dx + n) % n];
    const i = y * n + x;
    dst[i] = c === 3 || (src[i] && c === 2) ? 1 : 0;
  }
}

// cell list -> position-independent key
const cellKey = cells => {
  const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1]));
  return cells.map(c => (c[1] - my) * 1000 + (c[0] - mx)).sort((a, b) => a - b).join(",");
};
const SYMS = [(x, y) => [x, y], (x, y) => [-x, y], (x, y) => [x, -y], (x, y) => [-x, -y],
              (x, y) => [y, x], (x, y) => [-y, x], (x, y) => [y, -x], (x, y) => [-y, -x]];

// every phase x every rotation/reflection -> pattern id (phases are produced by simulating the pattern)
const KNOWN = new Map(), RANKS = {};
for (const [name, rank, period, art] of PATTERNS) {
  RANKS[name] = rank;
  const G = 48, a = new Uint8Array(G * G), b = new Uint8Array(G * G);
  art.split("/").forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "O") a[(y + 16) * G + x + 16] = 1; }));
  let s = a, t = b;
  for (let p = 0; p < period; p++) {
    const cells = [];
    s.forEach((v, i) => { if (v) cells.push([i % G, Math.floor(i / G)]); });
    for (const f of SYMS) KNOWN.set(cellKey(cells.map(([x, y]) => f(x, y))), name);
    lifeStep(s, t, G); [s, t] = [t, s];
  }
}
const rankOf = (id, cls) => RANKS[id][cls];

// groups of live cells (cells within 2 squares belong together). The board is a torus, so a group can straddle an
// edge: each cell carries "unwrapped" coordinates [x, y] (relative to the group's first cell) plus its board index.
function groups(grid, n) {
  const seen = new Uint8Array(n * n), out = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    const x0 = i % n, y0 = (i - x0) / n, cells = [], stack = [[x0, y0]];
    seen[i] = 1;
    while (stack.length) {
      const [ux, uy] = stack.pop();
      cells.push([ux, uy, (((uy % n) + n) % n) * n + (((ux % n) + n) % n)]);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const vx = ux + dx, vy = uy + dy, k = (((vy % n) + n) % n) * n + (((vx % n) + n) % n);
        if (grid[k] && !seen[k]) { seen[k] = 1; stack.push([vx, vy]); }
      }
    }
    out.push(cells);
  }
  return out;
}

// every recognised pattern on the board right now (also paints `tint` by rank)
function findPatterns(grid, n, tint, cls) {
  const found = [];
  tint.fill(0);
  for (const cells of groups(grid, n)) {
    if (cells.length > 100) continue;
    const name = KNOWN.get(cellKey(cells));
    if (!name) continue;
    const rank = rankOf(name, cls);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y, idx] of cells) {
      tint[idx] = rank;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const mod = v => ((v % n) + n) % n;
    found.push({ name, rank, cx: mod((x0 + x1) / 2), cy: mod((y0 + y1) / 2), size: Math.max(x1 - x0, y1 - y0) + 1 });
  }
  return found;
}

const maxBytes = cls => QR.maxBytes(BOARD_CLASSES[cls], ECL);
const boardSize = cls => 17 + 4 * BOARD_CLASSES[cls] + PAD * 2;

// the QR centred in an empty field: the Life seed of a text (throws RangeError when the text is too long)
function seedFor(text, cls) {
  const qr = QR.encode(new TextEncoder().encode(text), ECL, BOARD_CLASSES[cls]), n = qr.size + PAD * 2;
  const cells = new Uint8Array(n * n);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) cells[(y + PAD) * n + x + PAD] = qr.modules[y * qr.size + x];
  return { n, cells };
}

/* ---- sound effects: a tiny synth, no audio files. voice(context, destination node, rank 1-5, start time) ---- */
const NOTE = m => 440 * 2 ** ((m - 69) / 12);                      // MIDI note number -> Hz

function tone(c, out, t0, f, dur, type, gain, slideTo = 0) {
  const o = c.createOscillator(), v = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  v.gain.setValueAtTime(0.0001, t0);
  v.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(v).connect(out);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function whoosh(c, out, t0, dur, gain) {                            // rising noise sweep
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), bp = c.createBiquadFilter(), v = c.createGain();
  src.buffer = buf;
  bp.type = "bandpass"; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(300, t0);
  bp.frequency.exponentialRampToValueAtTime(5000, t0 + dur);
  v.gain.setValueAtTime(0.0001, t0);
  v.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.7);
  v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(v).connect(out);
  src.start(t0);
}

function voice(c, out, rank, t0) {
  switch (rank) {
    case 1:                                                         // a soft tick
      tone(c, out, t0, NOTE(76), 0.08, "sine", 0.11);
      break;
    case 2:                                                         // two quick soft notes
      tone(c, out, t0, NOTE(79), 0.1, "sine", 0.12);
      tone(c, out, t0 + 0.06, NOTE(84), 0.12, "sine", 0.1);
      break;
    case 3:                                                         // chime
      tone(c, out, t0, NOTE(76), 0.4, "triangle", 0.16);
      tone(c, out, t0 + 0.09, NOTE(83), 0.45, "triangle", 0.15);
      tone(c, out, t0 + 0.09, NOTE(95), 0.3, "sine", 0.05);
      break;
    case 4:                                                         // rising arpeggio
      [72, 76, 79, 84].forEach((m, i) => {
        tone(c, out, t0 + i * 0.075, NOTE(m), 0.4, "triangle", 0.14);
        tone(c, out, t0 + i * 0.075, NOTE(m + 12), 0.25, "sine", 0.04);
      });
      break;
    default:                                                        // fanfare: boom, whoosh, run, chord
      tone(c, out, t0, 110, 0.7, "sine", 0.4, 38);
      whoosh(c, out, t0, 0.6, 0.18);
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => {
        tone(c, out, t0 + 0.05 + i * 0.06, NOTE(m), 0.5, "sawtooth", 0.06);
        tone(c, out, t0 + 0.05 + i * 0.06, NOTE(m), 0.5, "triangle", 0.1);
      });
      [72, 76, 79, 84].forEach(m => {
        tone(c, out, t0 + 0.5, NOTE(m), 1.3, "sawtooth", 0.05);
        tone(c, out, t0 + 0.5, NOTE(m), 1.3, "triangle", 0.09);
      });
  }
}

class Game {
  constructor(text, cls) {
    const { n, cells } = seedFor(text, cls);
    this.cls = cls; this.n = n;
    this.cur = cells; this.nxt = new Uint8Array(n * n); this.tint = new Uint8Array(n * n);
    this.gen = 0; this.score = 0; this.finished = false; this.reason = null;
    this.tracked = []; this.seen = new Map();
    this.initialEvents = this._detect();                 // patterns already in the starting position score too
    this.seen.set(this._stateKey(), 0);
  }
  _stateKey() {
    let h = 2166136261, pop = 0;
    for (let i = 0; i < this.cur.length; i++) { h = Math.imul(h ^ this.cur[i], 16777619); pop += this.cur[i]; }
    return (h >>> 0).toString(36) + ":" + pop;
  }
  // follow patterns from generation to generation; one that shows up where none of the same kind was a moment ago is new
  // (movers are remembered longer and may reappear, wrap-around included, within the distance they could have travelled)
  _detect() {
    const n = this.n, wrap = (a, b) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
    const pool = this.tracked.slice(), next = [], events = [];
    for (const it of findPatterns(this.cur, n, this.tint, this.cls)) {
      let best = -1, bd = Infinity;
      pool.forEach((p, i) => {
        if (p.name !== it.name) return;
        const d = Math.hypot(wrap(p.cx, it.cx), wrap(p.cy, it.cy));
        if (d < 2.6 + p.missed * (SPEED[p.name] || 0) && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) {
        const p = pool.splice(best, 1)[0];
        p.cx = it.cx; p.cy = it.cy; p.size = it.size; p.missed = 0;
        next.push(p);
      } else {
        it.missed = 0;
        next.push(it);
        const points = POINTS[it.rank];
        this.score += points;
        events.push({ id: it.name, rank: it.rank, points, cx: it.cx, cy: it.cy, size: it.size, gen: this.gen });
      }
    }
    for (const p of pool) if (++p.missed <= MEMORY(p)) next.push(p);
    this.tracked = next;
    return events;
  }
  // advance one generation; returns the events (new appearances) of that generation
  step() {
    if (this.finished) return [];
    lifeStep(this.cur, this.nxt, this.n);
    [this.cur, this.nxt] = [this.nxt, this.cur];
    this.gen++;
    const events = this._detect();
    if (this.gen >= GAME_GENS) { this.finished = true; this.reason = "limit"; }
    else {
      const k = this._stateKey();
      if (this.seen.has(k)) { this.finished = true; this.reason = "settled"; }   // only repeats itself from here on
      else this.seen.set(k, this.gen);
    }
    return events;
  }
}

return {
  QR, BOARD_CLASSES, PAD, POINTS, GAME_GENS, RANK_COLORS, PATTERNS, NAMES, voice,
  rankOf, maxBytes, boardSize, seedFor, Game, createGame: (text, cls) => new Game(text, cls),
};
})();
if (typeof module !== "undefined" && module.exports) module.exports = QRLifeEngine;
