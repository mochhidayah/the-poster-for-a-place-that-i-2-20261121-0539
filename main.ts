// VELMORA — The Floating Isles
// A procedural travel poster for a place that does not exist.
// Everything is drawn at runtime: hand-rolled PNG encoder (zlib deflate +
// hand-made CRC32), a procedural sunset seascape with floating islands, and
// a hand-built 5x7 bitmap font. No external assets, no network, Node stdlib only.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const OUT = "/output/entry.png";

// ---------------------------------------------------------------------------
// Tiny deterministic RNG (mulberry32) so the poster is identical every run.
// ---------------------------------------------------------------------------
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder: CRC32 table built by hand, IHDR / IDAT / IEND chunks,
// raw RGB scanlines with the Up filter, deflated by Node's built-in zlib.
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Up filter: each row stores (pixel - pixel above) mod 256, great for gradients.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 2;
    for (let x = 0; x < width * 3; x++) {
      const i = y * width * 3 + x;
      const above = y === 0 ? 0 : rgb[i - width * 3];
      raw[y * (1 + width * 3) + 1 + x] = (rgb[i] - above) & 0xff;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB buffer with the drawing primitives the poster needs.
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

class Canvas {
  buf: Uint8Array;
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h * 3);
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
  }
  blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = Math.round(this.buf[i] * (1 - a) + c[0] * a);
    this.buf[i + 1] = Math.round(this.buf[i + 1] * (1 - a) + c[1] * a);
    this.buf[i + 2] = Math.round(this.buf[i + 2] * (1 - a) + c[2] * a);
  }
  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 3;
    return [this.buf[i], this.buf[i + 1], this.buf[i + 2]];
  }
  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.set(x, y, c);
  }
  // Vertical gradient between stops: [position 0..1, colour].
  vgrad(y0: number, y1: number, stops: Array<[number, RGB]>): void {
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1);
      let a = stops[0];
      let b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) {
          a = stops[s];
          b = stops[s + 1];
          break;
        }
      }
      const lt = (t - a[0]) / Math.max(0.0001, b[0] - a[0]);
      const c: RGB = [
        Math.round(a[1][0] + (b[1][0] - a[1][0]) * lt),
        Math.round(a[1][1] + (b[1][1] - a[1][1]) * lt),
        Math.round(a[1][2] + (b[1][2] - a[1][2]) * lt),
      ];
      for (let x = 0; x < this.w; x++) this.set(x, y, c);
    }
  }
  disc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) {
          if (alpha >= 1) this.set(x, y, c);
          else this.blend(x, y, c, alpha * (1 - d / (r + 1)) * 0.6 + alpha * 0.4);
        }
      }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1) this.set(x, y, c);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, thick = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (let dy = 0; dy < thick; dy++)
        for (let dx = 0; dx < thick; dx++) this.set(x + dx, y + dy, c);
    }
  }
  // Filled triangle (flat scanline walk).
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB): void {
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      const edges: Array<[number, number, number, number]> = [
        [ax, ay, bx, by],
        [bx, by, cx, cy],
        [cx, cy, ax, ay],
      ];
      for (const [x0, y0, x1, y1] of edges) {
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      if (xs.length >= 2) {
        const lo = Math.max(0, Math.floor(Math.min(...xs)));
        const hi = Math.min(this.w - 1, Math.ceil(Math.max(...xs)));
        for (let x = lo; x <= hi; x++) this.set(x, y, c);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hand-built 5x7 bitmap font. Each glyph is 7 rows of 5 bits ("#" = ink).
// Covers A-Z, 0-9 and basic punctuation used by the poster copy.
// ---------------------------------------------------------------------------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
};

function textWidth(s: string, scale: number, tracking: number): number {
  return s.length * (5 * scale + tracking) - tracking;
}

function drawText(
  cv: Canvas,
  s: string,
  cx: number,
  y: number,
  scale: number,
  color: RGB,
  tracking = 0,
): void {
  const w = textWidth(s, scale, tracking);
  let x = Math.round(cx - w / 2);
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] ?? FONT["?"];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === "1")
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              cv.set(x + c * scale + dx, y + r * scale + dy, color);
    x += 5 * scale + tracking;
  }
}

// ---------------------------------------------------------------------------
// Helpers: colour lerp, wavy ridge, soft cloud, waterfall, floating island.
// ---------------------------------------------------------------------------
function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function ridge(
  cv: Canvas,
  baseY: number,
  amp: number,
  color: RGB,
  seed: number,
  yBottom: number,
): void {
  const r = rng(seed);
  const p1 = 0.4 + r() * 0.5;
  const p2 = 0.9 + r() * 0.8;
  const p3 = 0.13 + r() * 0.1;
  const o1 = r() * 6.28;
  const o2 = r() * 6.28;
  const o3 = r() * 6.28;
  for (let x = 0; x < cv.w; x++) {
    const t = x / cv.w;
    const y =
      baseY -
      amp *
        (p1 * Math.sin(t * 6.28 * 2 + o1) +
          p2 * Math.sin(t * 6.28 * 3.7 + o2) +
          p3 * Math.sin(t * 6.28 * 9 + o3)) *
        (0.55 + 0.45 * Math.sin(t * 3.14159));
    for (let yy = Math.max(0, Math.round(y)); yy < yBottom; yy++) cv.set(x, yy, color);
  }
}

function cloud(cv: Canvas, cx: number, cy: number, w: number, h: number, c: RGB, a: number): void {
  const r = rng(Math.round(cx * 7 + cy));
  for (let i = 0; i < 26; i++) {
    const ox = (r() - 0.5) * w;
    const oy = (r() - 0.5) * h * 0.7;
    const rr = (0.14 + r() * 0.22) * w;
    cv.disc(cx + ox, cy + oy, rr, c, a * (0.5 + r() * 0.5));
  }
}

function waterfall(cv: Canvas, x: number, y0: number, y1: number, w: number, seed: number): void {
  const r = rng(seed);
  for (let y = y0; y < y1; y++) {
    const sway = Math.sin((y - y0) * 0.045 + seed) * 5;
    const ww = w * (0.55 + 0.45 * Math.sin((y - y0) * 0.11));
    for (let x2 = Math.round(x + sway - ww / 2); x2 <= x + sway + ww / 2; x2++) {
      const edge = Math.abs(x2 - (x + sway)) / Math.max(1, ww / 2);
      const bright: RGB = edge > 0.75 ? [226, 244, 255] : [168, 214, 240];
      cv.blend(x2, y, bright, 0.55 + r() * 0.35);
    }
  }
}

function floatingIsland(
  cv: Canvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): void {
  const r = rng(seed);
  // Rocky underside: inverted cone with strata.
  const tipY = cy + ry + rx * 0.85;
  cv.tri(cx - rx * 0.92, cy + ry * 0.25, cx + rx * 0.92, cy + ry * 0.25, cx, tipY, [74, 47, 77]);
  cv.tri(cx - rx * 0.55, cy + ry * 0.25, cx + rx * 0.55, cy + ry * 0.25, cx, tipY - rx * 0.22, [96, 60, 92]);
  for (let i = 0; i < 5; i++) {
    const yy = cy + ry * 0.3 + i * ((tipY - cy) / 6);
    const half = rx * 0.9 * (1 - (yy - cy) / (tipY - cy));
    cv.line(cx - half * 0.8, yy, cx + half * 0.8, yy + 3, [52, 33, 58], 2);
  }
  // Grassy top dome.
  cv.ellipse(cx, cy, rx, ry, [58, 122, 88]);
  cv.ellipse(cx, cy - ry * 0.28, rx * 0.94, ry * 0.62, [84, 158, 110]);
  cv.ellipse(cx - rx * 0.3, cy - ry * 0.42, rx * 0.5, ry * 0.4, [112, 186, 130]);
  // Pine trees.
  const trees = 3 + Math.floor(r() * 2);
  for (let i = 0; i < trees; i++) {
    const tx = cx - rx * 0.62 + (i * rx * 1.24) / Math.max(1, trees - 1) + (r() - 0.5) * 14;
    const th = 26 + r() * 22;
    const ty = cy - ry * 0.55 - r() * 8;
    cv.tri(tx - 9, ty, tx + 9, ty, tx, ty - th, [24, 74, 52]);
    cv.tri(tx - 7, ty - th * 0.45, tx + 7, ty - th * 0.45, tx, ty - th * 1.05, [30, 92, 64]);
    cv.line(tx, ty, tx, ty + 6, [58, 40, 30], 3);
  }
  // A tiny lantern tower on the biggest isle.
  if (rx > 140) {
    const tx = cx + rx * 0.42;
    cv.fillRect(tx - 7, cy - ry - 46, tx + 7, cy - ry + 4, [245, 222, 178]);
    cv.tri(tx - 12, cy - ry - 46, tx + 12, cy - ry - 46, tx, cy - ry - 64, [178, 62, 66]);
    cv.disc(tx, cy - ry - 30, 4, [255, 214, 120]);
  }
}

// ---------------------------------------------------------------------------
// The poster itself.
// ---------------------------------------------------------------------------
function build(): Canvas {
  const cv = new Canvas(W, H);
  const HORIZON = 648;
  const BAND_Y = 824;

  // 1. Sunset sky.
  cv.vgrad(0, HORIZON, [
    [0, [32, 16, 66]],
    [0.34, [86, 42, 99]],
    [0.6, [178, 74, 82]],
    [0.84, [232, 128, 79]],
    [1, [247, 178, 103]],
  ]);
  // Faint grain so the gradient never bands.
  const grain = rng(20261121);
  for (let y = 0; y < HORIZON; y++)
    for (let x = 0; x < W; x += 2) {
      const n = Math.floor((grain() - 0.5) * 5);
      const p = cv.get(x, y);
      cv.set(x, y, [
        Math.max(0, Math.min(255, p[0] + n)),
        Math.max(0, Math.min(255, p[1] + n)),
        Math.max(0, Math.min(255, p[2] + n)),
      ]);
    }

  // 2. Stars in the deep upper sky.
  const stars = rng(77);
  for (let i = 0; i < 170; i++) {
    const x = Math.floor(stars() * W);
    const y = Math.floor(stars() * 330);
    const b = 140 + Math.floor(stars() * 115);
    const s = stars();
    if (s < 0.12) {
      cv.disc(x, y, 2, [255, 240, 200]);
      cv.set(x - 3, y, [255, 240, 200]);
      cv.set(x + 3, y, [255, 240, 200]);
      cv.set(x, y - 3, [255, 240, 200]);
      cv.set(x, y + 3, [255, 240, 200]);
    } else {
      cv.set(x, y, [b, b, Math.min(255, b + 20)]);
    }
  }

  // 3. Low sun with a warm halo, sinking toward the horizon.
  const SUN: [number, number] = [712, 566];
  for (let k = 7; k >= 1; k--) {
    cv.disc(SUN[0], SUN[1], 78 + k * 16, [255, 166, 92], 0.05 + 0.02 * (7 - k));
  }
  cv.disc(SUN[0], SUN[1], 78, [255, 227, 174]);
  cv.disc(SUN[0], SUN[1], 62, [255, 240, 205]);

  // 4. Soft dusk clouds.
  cloud(cv, 180, 180, 260, 34, [214, 130, 140], 0.5);
  cloud(cv, 880, 120, 220, 28, [160, 90, 140], 0.45);
  cloud(cv, 470, 470, 300, 26, [240, 150, 100], 0.4);
  cloud(cv, 120, 520, 240, 24, [226, 120, 96], 0.35);

  // 5. The floating isles of Velmora.
  floatingIsland(cv, 302, 318, 168, 44, 11);
  floatingIsland(cv, 776, 236, 108, 30, 23);
  floatingIsland(cv, 540, 150, 62, 18, 37);
  // Waterfalls spilling from the isles into the sea.
  waterfall(cv, 252, 356, HORIZON, 16, 5);
  waterfall(cv, 742, 262, HORIZON, 11, 9);
  waterfall(cv, 522, 168, 330, 7, 13);

  // 6. Birds riding the evening wind.
  const birds: Array<[number, number, number]> = [
    [150, 430, 14],
    [205, 405, 11],
    [620, 380, 12],
    [880, 420, 15],
    [930, 380, 10],
  ];
  for (const [bx, by, bs] of birds) {
    cv.line(bx - bs, by, bx, by - bs * 0.45, [38, 20, 52], 3);
    cv.line(bx, by - bs * 0.45, bx + bs, by, [38, 20, 52], 3);
  }

  // 7. Layered mountain ridges at the horizon.
  ridge(cv, 618, 34, [122, 59, 99], 101, HORIZON);
  ridge(cv, 640, 26, [90, 44, 80], 202, HORIZON);
  ridge(cv, 656, 18, [61, 31, 69], 303, HORIZON + 2);

  // 8. The sea: deep violet water catching the sunset.
  cv.vgrad(HORIZON, BAND_Y, [
    [0, [240, 140, 92]],
    [0.25, [150, 74, 104]],
    [0.6, [74, 44, 96]],
    [1, [44, 26, 78]],
  ]);
  // Sun's glitter path on the water.
  const glit = rng(4242);
  for (let y = HORIZON + 4; y < BAND_Y - 6; y += 3) {
    const spread = 46 + ((y - HORIZON) / (BAND_Y - HORIZON)) * 130;
    const n = 2 + Math.floor(glit() * 3);
    for (let i = 0; i < n; i++) {
      const gx = SUN[0] + (glit() - 0.5) * 2 * spread;
      const gw = 12 + glit() * 46;
      const warm: RGB = glit() < 0.6 ? [255, 196, 120] : [255, 226, 170];
      for (let x = Math.round(gx - gw / 2); x <= gx + gw / 2; x++)
        cv.blend(x, y, warm, 0.5 + glit() * 0.3);
    }
  }
  // Wave strokes.
  const waves = rng(909);
  for (let i = 0; i < 130; i++) {
    const y = HORIZON + 12 + Math.floor(waves() * (BAND_Y - HORIZON - 24));
    const x = Math.floor(waves() * (W - 160));
    const len = 26 + waves() * 90;
    const shade: RGB =
      waves() < 0.5 ? [196, 120, 140] : waves() < 0.8 ? [140, 90, 140] : [255, 190, 130];
    cv.line(x, y, x + len, y, shade, 2);
  }

  // 9. A lone sailboat crossing the glitter path.
  const bx = 566;
  const by = 742;
  cv.tri(bx, by - 52, bx, by - 6, bx + 34, by - 6, [247, 233, 208]);
  cv.tri(bx - 4, by - 40, bx - 4, by - 6, bx - 30, by - 6, [232, 150, 110]);
  cv.line(bx, by - 56, bx, by - 4, [30, 18, 46], 3);
  cv.tri(bx - 34, by - 4, bx + 38, by - 4, bx + 26, by + 8, [28, 16, 44]);
  cv.tri(bx - 34, by - 4, bx + 38, by - 4, bx - 26, by + 8, [28, 16, 44]);
  for (let i = 0; i < 4; i++)
    cv.line(bx - 26 + i * 4, by + 12 + i * 3, bx + 26 - i * 4, by + 12 + i * 3, [255, 200, 130], 2);

  // 10. Bottom title band — deep night violet, gold rules, cream type.
  cv.fillRect(0, BAND_Y, W, H, [29, 16, 56]);
  cv.fillRect(0, BAND_Y, W, BAND_Y + 4, [242, 166, 94]);
  cv.fillRect(0, H - 18, W, H - 14, [242, 166, 94]);
  drawText(cv, "VELMORA", W / 2, BAND_Y + 22, 14, [247, 232, 200], 10);
  drawText(cv, "THE FLOATING ISLES", W / 2, BAND_Y + 130, 4, [242, 166, 94], 6);
  drawText(cv, "WHERE THE SKY LEARNS TO SWIM", W / 2, BAND_Y + 154, 3, [203, 184, 232], 3);

  // 11. Cream poster frame.
  cv.fillRect(0, 0, W, 12, [245, 233, 208]);
  cv.fillRect(0, H - 12, W, H, [245, 233, 208]);
  cv.fillRect(0, 0, 12, H, [245, 233, 208]);
  cv.fillRect(W - 12, 0, W, H, [245, 233, 208]);
  cv.line(20, 20, W - 20, 20, [245, 233, 208], 2);
  cv.line(20, H - 20, W - 20, H - 20, [245, 233, 208], 2);

  return cv;
}

function main(): void {
  const cv = build();
  const png = encodePng(cv.buf, W, H);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log(`wrote ${OUT}: ${png.length} bytes, ${W}x${H}`);
}

main();
