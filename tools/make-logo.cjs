// Generates the Toad Hunt logo from the 8x8 cell map below: logo.svg and favicon-32.png.
// Edit LOGO / PALETTE, then run:   node tools/make-logo.cjs
//
// The shape is the Toad-like cell layout (5 rows, centred in an 8x8 grid):
//   e = eye cells (accent), O = body cells, . = empty (the two holes in the body are left empty on purpose
//   so the logo still reads as a set of Life cells, and survives as a 1-bit icon)
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const LOGO = [
  "........",
  "........",
  "..e..e..",
  ".OOOOOO.",
  ".O.OO.O.",
  "..OOOO..",
  "..O..O..",
  "........",
];
const PALETTE = { O: "#2f9e4f", e: "#f5b301" };
const root = path.join(__dirname, "..");

const cells = [];
LOGO.forEach((row, y) => [...row].forEach((ch, x) => { if (PALETTE[ch]) cells.push({ x, y, c: PALETTE[ch] }); }));

// SVG: one rect per cell, grouped by colour
const byColour = {};
cells.forEach(({ x, y, c }) => (byColour[c] = byColour[c] || []).push(`<rect x="${x}" y="${y}" width="1" height="1"/>`));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="64" height="64" shape-rendering="crispEdges" role="img" aria-label="Toad Hunt">\n` +
  Object.entries(byColour).map(([c, r]) => `<g fill="${c}">${r.join("")}</g>`).join("\n") + `\n</svg>\n`;
fs.writeFileSync(path.join(root, "logo.svg"), svg);

// PNG (32x32, 4px per cell, transparent background) for browsers that ignore SVG favicons
const S = 32, K = S / 8, raw = Buffer.alloc((S * 4 + 1) * S);
cells.forEach(({ x, y, c }) => {
  const rgb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  for (let py = y * K; py < (y + 1) * K; py++) for (let px = x * K; px < (x + 1) * K; px++) {
    const o = py * (S * 4 + 1) + 1 + px * 4;
    raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255;
  }
});
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, sum]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(path.join(root, "favicon-32.png"), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
console.log("wrote logo.svg, favicon-32.png");
