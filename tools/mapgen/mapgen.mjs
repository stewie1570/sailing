// Map asset generator.
// Reads the painted chart (source-map.jpg) and produces runtime assets for the client:
//   heightmap.png  - 16-bit height encoded in R (high) / G (low); B = class (0 deep, 128 shoal, 255 land)
//   landcolor.jpg  - cleaned colour map for the terrain (UI overlays inpainted, lakebed coloured by depth)
//   detail.png     - small tiling noise texture used to break up texture blur close to the camera
//   mapdata.json   - world scale, buoys, harbors
//   trees.json     - tree instances [x, z, scale] in world metres
//
// Run with: npm run build   (inside tools/mapgen)

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../../client/public/map');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- configuration
// The painted chart's scale bar is 5 km ~ 215 px (23.3 m/px). Play uses a third
// of that on X and Z so a crossing is a short sail. Falloffs below are in that
// same scaled horizontal metre, which keeps each pixel's height unchanged.
const CHART_METERS_PER_PIXEL = 23.3;
const HORIZONTAL_SCALE = 1 / 3;
const METERS_PER_PIXEL = CHART_METERS_PER_PIXEL * HORIZONTAL_SCALE;
const HEIGHT_MIN = -64, HEIGHT_MAX = 400; // metres, encoded range (Y is not scaled)
const HILL_HEIGHT = 280;              // asymptotic inland height (m)
const HILL_FALLOFF = 2000 * HORIZONTAL_SCALE; // scaled metres from shore to ~63% of hill height
const DEEP_MAX = 38, DEEP_FALLOFF = 420 * HORIZONTAL_SCALE;
const SHOAL_MAX = 3.0, SHOAL_FALLOFF = 70 * HORIZONTAL_SCALE;
const TREE_TARGET = 7000;

// Rectangles covering chart UI (title, labels, compass, legend, scale bar). Filled from surroundings.
const UI_RECTS = [
  [8, 8, 282, 72], [52, 174, 198, 204], [876, 468, 998, 500],
  [936, 8, 1014, 88], [6, 622, 182, 756], [772, 682, 1014, 758],
];
const HARBORS = [
  { name: 'West Harbor', px: [90, 236] },
  { name: 'East Harbor', px: [878, 524] },
];

// ---------------------------------------------------------------- load
const { data, info } = await sharp(resolve(import.meta.dirname, 'source-map.jpg')).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

// ---------------------------------------------------------------- colour predicates
const isRed = ([r, g, b]) => r > 140 && g < 130 && b < 130 && r - Math.max(g, b) > 45;
const isGreen = ([r, g, b]) => g > 120 && r < 120 && b < 150 && g - r > 45 && g - b > 30;
const isWater = ([r, g, b]) => b > r * 1.6 + 10 && b > 55 && b >= g - 35;
const isShoal = ([r, g, b]) => isWater([r, g, b]) && g > 110 && r < g * 0.6;
const isWhite = ([r, g, b]) => Math.min(r, g, b) > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 45;
// "Clearly land": green-dominant vegetation or brown/tan ground. Anything that is neither clearly land nor
// clearly water (anti-aliased chart line edges, buoy glyphs, docks, text) is filled from its neighbours.
const isLand = ([r, g, b]) => (g > b + 12 && g >= r * 0.85) || (r > b + 25 && r >= g * 0.8 && !isWhite([r, g, b]));
const isForest = ([r, g, b]) => g > r && g > b && g < 115 && r < 80;

// ---------------------------------------------------------------- connected components (for buoys)
function components(pred, seen) {
  const comps = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (seen[i] || !pred(px(x, y))) continue;
    const stack = [i]; seen[i] = 1; const pixels = []; let sx = 0, sy = 0;
    while (stack.length) {
      const j = stack.pop(); const jx = j % W, jy = (j - jx) / W; pixels.push(j); sx += jx; sy += jy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx, ny = jy + dy; if (!inb(nx, ny)) continue;
        const k = ny * W + nx; if (seen[k] || !pred(px(nx, ny))) continue; seen[k] = 1; stack.push(k);
      }
    }
    comps.push({ n: pixels.length, cx: sx / pixels.length, cy: sy / pixels.length, pixels });
  }
  return comps;
}
function waterRing(cx, cy, r) {
  let w = 0, t = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dy); if (d < r * 0.7 || d > r) continue;
    const x = Math.round(cx) + dx, y = Math.round(cy) + dy; if (!inb(x, y)) continue;
    t++; const p = px(x, y); if (isWater(p) || isWhite(p)) w++;
  }
  return w / t;
}

// class: 0 deep water, 1 shoal, 2 land, 3 unknown (to be filled)
const cls = new Uint8Array(N);
const buoys = [];
{
  const buoyMask = new Uint8Array(N);
  for (const [type, pred] of [['starboard', isRed], ['port', isGreen]]) {
    for (const c of components(pred, new Uint8Array(N))) {
      if (c.n < 20 || c.n > 400) continue;
      if (waterRing(c.cx, c.cy, 14) < 0.75) continue;
      buoys.push({ type, px: [c.cx, c.cy] });
      // blank the whole glyph (body, outline, highlights, pole) so it is refilled from surrounding water
      const R = 10, cx = Math.round(c.cx), cy = Math.round(c.cy);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue; const x = cx + dx, y = cy + dy; if (inb(x, y)) buoyMask[y * W + x] = 1;
      }
    }
  }
  const uiMask = new Uint8Array(N);
  for (const [x0, y0, x1, y1] of UI_RECTS) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) uiMask[y * W + x] = 1;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; const p = px(x, y);
    if (uiMask[i]) cls[i] = 3;
    else if (buoyMask[i]) cls[i] = 3;            // buoy glyph: fill from neighbouring water
    else if (isWater(p)) cls[i] = isShoal(p) ? 1 : 0;
    else if (isLand(p)) cls[i] = 2;
    else cls[i] = 3;                             // dashed channel lines / docks / text edges: decide by neighbours
  }
  // Fill unknowns from nearest known class (iterative dilation). White pixels on land stay land because
  // land surrounds them; dashed lines and docks are absorbed by water.
  for (let iter = 0; iter < 60; iter++) {
    let changed = 0; const next = Uint8Array.from(cls);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (cls[i] !== 3) continue;
      const votes = [0, 0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const c = cls[ny * W + nx]; if (c !== 3) votes[c]++;
      }
      const total = votes[0] + votes[1] + votes[2];
      if (total >= 2) { next[i] = votes.indexOf(Math.max(...votes)); changed++; }
    }
    cls.set(next); if (!changed) break;
  }
  for (let i = 0; i < N; i++) if (cls[i] === 3) cls[i] = 2;
}

// Remove tiny specks: 3x3 majority filter, twice.
for (let pass = 0; pass < 2; pass++) {
  const next = Uint8Array.from(cls);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const votes = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) votes[cls[(y + dy) * W + x + dx]]++;
    const land = votes[2], water = votes[0] + votes[1];
    const i = y * W + x;
    if (cls[i] === 2 && water >= 7) next[i] = votes[1] >= votes[0] ? 1 : 0;
    else if (cls[i] !== 2 && land >= 7) next[i] = 2;
  }
  cls.set(next);
}
// Remove tiny land specks (chart artefacts); the smallest real islets are well over 30 px.
{
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (seen[i] || cls[i] !== 2) continue;
    const stack = [i]; seen[i] = 1; const comp = [];
    while (stack.length) {
      const j = stack.pop(); comp.push(j); const x = j % W, y = (j - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const k = ny * W + nx;
        if (!seen[k] && cls[k] === 2) { seen[k] = 1; stack.push(k); }
      }
    }
    if (comp.length < 30) for (const j of comp) cls[j] = 1;
  }
}

// ---------------------------------------------------------------- distance transforms (chamfer 3-4, in pixels)
function distanceTo(pred) {
  const INF = 1e9; const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = pred(cls[i]) ? 0 : INF;
  const relax = (i, j, cost) => { if (d[j] + cost < d[i]) d[i] = d[j] + cost; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (d[i] === 0) continue;
    if (x > 0) relax(i, i - 1, 3); if (y > 0) relax(i, i - W, 3);
    if (x > 0 && y > 0) relax(i, i - W - 1, 4); if (x < W - 1 && y > 0) relax(i, i - W + 1, 4);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (d[i] === 0) continue;
    if (x < W - 1) relax(i, i + 1, 3); if (y < H - 1) relax(i, i + W, 3);
    if (x < W - 1 && y < H - 1) relax(i, i + W + 1, 4); if (x > 0 && y < H - 1) relax(i, i + W - 1, 4);
  }
  for (let i = 0; i < N; i++) d[i] /= 3;
  return d;
}
const distToWater = distanceTo(c => c !== 2);  // for land pixels
const distToLand = distanceTo(c => c === 2);   // for water pixels

// shoal weight: blurred shoal mask so bathymetry transitions are smooth
const shoalW = new Float32Array(N);
{
  const tmp = new Float32Array(N); const R = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let dx = -R; dx <= R; dx++) { const nx = x + dx; if (nx < 0 || nx >= W) continue; n++; if (cls[y * W + nx] === 1) s++; } tmp[y * W + x] = s / n; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let dy = -R; dy <= R; dy++) { const ny = y + dy; if (ny < 0 || ny >= H) continue; n++; s += tmp[ny * W + x]; } shoalW[y * W + x] = s / n; }
}

// ---------------------------------------------------------------- noise (value noise fbm, deterministic)
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function fbm(x, y, oct) { let v = 0, a = 0.5, f = 1, norm = 0; for (let o = 0; o < oct; o++) { v += a * vnoise(x * f, y * f); norm += a; a *= 0.5; f *= 2.1; } return v / norm; }

// ---------------------------------------------------------------- height field (metres)
const height = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (cls[i] === 2) {
    const d = distToWater[i] * METERS_PER_PIXEL;
    const base = HILL_HEIGHT * (1 - Math.exp(-d / HILL_FALLOFF));
    const n = (fbm(x / 70, y / 70, 4) - 0.5) * 2;                 // -1..1, broad hills in pixel space
    const ridge = Math.pow(fbm(x / 30 + 7, y / 30 + 3, 3), 2);    // small bumps
    const shoreFade = Math.min(1, d / (350 * HORIZONTAL_SCALE));
    height[i] = base + shoreFade * (n * 60 + ridge * 30) + Math.min(d, 60 * HORIZONTAL_SCALE) * 0.02;
  } else {
    const d = distToLand[i] * METERS_PER_PIXEL;
    const deep = -DEEP_MAX * (1 - Math.exp(-d / DEEP_FALLOFF));
    const shoal = -SHOAL_MAX * (1 - Math.exp(-d / SHOAL_FALLOFF)) - 0.4;
    const w = shoalW[i];
    const bumps = (fbm(x / 25 + 11, y / 25 + 5, 3) - 0.5) * 2;
    height[i] = deep * (1 - w) + shoal * w + bumps * (0.5 + 2.5 * (1 - w)) - 0.6;
  }
}
// 3x3 blur to soften pixel steps
{
  const tmp = Float32Array.from(height);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += tmp[(y + dy) * W + x + dx];
    height[y * W + x] = s / 9;
  }
}

// ---------------------------------------------------------------- heightmap.png (RGB: R hi, G lo, B class)
{
  const out = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const t = Math.min(1, Math.max(0, (height[i] - HEIGHT_MIN) / (HEIGHT_MAX - HEIGHT_MIN)));
    const v = Math.round(t * 65535);
    out[i * 3] = v >> 8; out[i * 3 + 1] = v & 255; out[i * 3 + 2] = cls[i] === 2 ? 255 : cls[i] === 1 ? 128 : 0;
  }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(resolve(OUT, 'heightmap.png'));
}

// ---------------------------------------------------------------- waterdepth.png (8-bit, GPU-filterable)
// v = (8 - h) / 48 -> 0 at 8 m above water, 42 at the waterline, 255 at 40 m depth. ~0.19 m per step.
const DEPTH_OFFSET = 8, DEPTH_RANGE = 48;
{
  const out = Buffer.alloc(N);
  for (let i = 0; i < N; i++) out[i] = Math.round(Math.min(1, Math.max(0, (DEPTH_OFFSET - height[i]) / DEPTH_RANGE)) * 255);
  await sharp(out, { raw: { width: W, height: H, channels: 1 } }).png({ compressionLevel: 9 }).toFile(resolve(OUT, 'waterdepth.png'));
}

// ---------------------------------------------------------------- landcolor.jpg
{
  const col = Buffer.from(data);
  // Inpaint UI rectangles by mirroring the texture across the nearest rectangle edge (keeps the painted
  // texture's character instead of smearing). Mirrored samples that land in water or another UI rect fall
  // back to an iterative neighbour fill afterwards.
  const unknown = new Uint8Array(N);
  const MARGIN = 3, EDGE = 14; // the chart also has a decorative frame around the image edge
  const rects = [
    ...UI_RECTS.map(([x0, y0, x1, y1]) => [Math.max(0, x0 - MARGIN), Math.max(0, y0 - MARGIN), Math.min(W - 1, x1 + MARGIN), Math.min(H - 1, y1 + MARGIN)]),
    [0, 0, W - 1, EDGE], [0, H - 1 - EDGE, W - 1, H - 1], [0, 0, EDGE, H - 1], [W - 1 - EDGE, 0, W - 1, H - 1],
  ];
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) unknown[y * W + x] = 1;
  const src = Buffer.from(col);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (cls[i] !== 2) { unknown[i] = 0; continue; }      // water inside the rect gets lakebed colour later
    const dl = x - x0 + 1, dr = x1 - x + 1, dt = y - y0 + 1, db = y1 - y + 1;
    const m = Math.min(dl, dr, dt, db);
    let sx = x, sy = y;
    if (m === dl) sx = x0 - dl; else if (m === dr) sx = x1 + dr; else if (m === dt) sy = y0 - dt; else sy = y1 + db;
    const j = sy * W + sx;
    if (inb(sx, sy) && !unknown[j] && cls[j] === 2) { col[i * 3] = src[j * 3]; col[i * 3 + 1] = src[j * 3 + 1]; col[i * 3 + 2] = src[j * 3 + 2]; unknown[i] = 0; }
  }
  // Fallback: pixels the mirror could not fill borrow texture from a nearby known land pixel.
  let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const inRect = (x, y) => rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!unknown[i]) continue;
    for (let attempt = 0, radius = 12; attempt < 200; attempt++, radius += 1.5) {
      const a = rnd() * Math.PI * 2, r = radius * (0.6 + 0.4 * rnd());
      const sx = Math.round(x + Math.cos(a) * r), sy = Math.round(y + Math.sin(a) * r);
      if (!inb(sx, sy) || inRect(sx, sy)) continue;
      const j = sy * W + sx; if (cls[j] !== 2 || isWhite([src[j * 3], src[j * 3 + 1], src[j * 3 + 2]])) continue;
      col[i * 3] = src[j * 3]; col[i * 3 + 1] = src[j * 3 + 1]; col[i * 3 + 2] = src[j * 3 + 2]; unknown[i] = 0; break;
    }
  }
  // Lakebed colour by depth, blended into the shoreline.
  const sand = [184, 170, 128], wetSand = [142, 132, 98], mud = [70, 76, 56];
  for (let i = 0; i < N; i++) {
    if (cls[i] === 2 && distToWater[i] > 1.5) continue;
    const depth = Math.max(0, -height[i]);
    // dry sand above the waterline, wet sand just below, grading to mud with depth
    const t = Math.min(1, depth / 14);
    const base = cls[i] === 2 ? sand : wetSand;
    const r = base[0] + (mud[0] - base[0]) * t, g = base[1] + (mud[1] - base[1]) * t, b = base[2] + (mud[2] - base[2]) * t;
    const grain = (fbm((i % W) / 3, Math.floor(i / W) / 3, 2) - 0.5) * 20;
    if (cls[i] === 2) { // thin beach band on land
      const k = 1 - distToWater[i] / 1.5;
      col[i * 3] = col[i * 3] * (1 - k) + (r + grain) * k; col[i * 3 + 1] = col[i * 3 + 1] * (1 - k) + (g + grain) * k; col[i * 3 + 2] = col[i * 3 + 2] * (1 - k) + (b + grain * 0.5) * k;
    } else {
      col[i * 3] = r + grain; col[i * 3 + 1] = g + grain; col[i * 3 + 2] = b + grain * 0.5;
    }
  }
  await sharp(col, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toFile(resolve(OUT, 'landcolor.jpg'));
}

// ---------------------------------------------------------------- detail.png (tiling noise, 256x256)
{
  const S = 256; const out = Buffer.alloc(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // tileable by sampling noise on a torus via 4-corner blend
    const u = x / S, v = y / S;
    const a = fbm(x / 23, y / 23, 3), b = fbm((x + S) / 23, y / 23, 3), c = fbm(x / 23, (y + S) / 23, 3), d = fbm((x + S) / 23, (y + S) / 23, 3);
    const n = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    out[y * S + x] = Math.round(Math.max(0, Math.min(255, 128 + (n - 0.5) * 220)));
  }
  await sharp(out, { raw: { width: S, height: S, channels: 1 } }).png().toFile(resolve(OUT, 'detail.png'));
}

// ---------------------------------------------------------------- waternormal.png (tileable tangent-space normals, 512x512)
{
  const S = 512, P = 32; // base noise period in cells; every octave keeps an integer period so the tile wraps
  const heightAt = (u, v) => {
    let h = 0, amp = 0.5, cells = P;
    for (let o = 0; o < 5; o++) {
      const x = u * cells, y = v * cells;
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const hp = (ix, iy) => hash(((ix % cells) + cells) % cells + o * 1000, ((iy % cells) + cells) % cells);
      const a = hp(xi, yi), b = hp(xi + 1, yi), c = hp(xi, yi + 1), d = hp(xi + 1, yi + 1);
      const n = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
      // sharpen crests a little so it reads as water rather than clouds
      h += amp * (1 - Math.abs(n * 2 - 1) * 0.6);
      amp *= 0.5; cells *= 2;
    }
    return h;
  };
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = heightAt(x / S, y / S);
  const out = Buffer.alloc(S * S * 3);
  const strength = 2.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = hgt[y * S + ((x - 1 + S) % S)], r = hgt[y * S + ((x + 1) % S)];
    const u = hgt[((y - 1 + S) % S) * S + x], d = hgt[((y + 1) % S) * S + x];
    let nx = -(r - l) * strength * S / 2 / 64, ny = -(d - u) * strength * S / 2 / 64, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * S + x) * 3;
    out[i] = Math.round((nx * 0.5 + 0.5) * 255); out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255); out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
  }
  await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png({ compressionLevel: 9 }).toFile(resolve(OUT, 'waternormal.png'));
}

// ---------------------------------------------------------------- world coordinate helpers
const toWorld = (x, y) => [((x - W / 2) * METERS_PER_PIXEL), ((y - H / 2) * METERS_PER_PIXEL)];
const r1 = v => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- trees
const trees = [];
{
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const candidates = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (cls[i] !== 2 || !isForest(px(x, y))) continue;
    const d = distToWater[i] * METERS_PER_PIXEL;
    const weight = d < 250 * HORIZONTAL_SCALE ? 1.0 : d < 700 * HORIZONTAL_SCALE ? 0.45 : d < 1500 * HORIZONTAL_SCALE ? 0.18 : 0.06;
    candidates.push([x, y, weight]);
  }
  const totalW = candidates.reduce((s, c) => s + c[2], 0);
  const perWeight = TREE_TARGET / totalW;
  for (const [x, y, w] of candidates) {
    let expect = w * perWeight;
    while (expect > 0) {
      if (rnd() < expect) {
        const [wx, wz] = toWorld(x + rnd(), y + rnd());
        trees.push([r1(wx), r1(wz), r1(0.8 + rnd() * 0.5)]);
      }
      expect -= 1;
    }
  }
  console.log(`forest pixels ${candidates.length}, trees ${trees.length}`);
}

// ---------------------------------------------------------------- harbors
const harbors = HARBORS.map(h => {
  const [hx, hy] = h.px; let sx = 0, sy = 0; const R = 30;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = hx + dx, y = hy + dy; if (!inb(x, y)) continue; const d = Math.hypot(dx, dy); if (d > R || d === 0) continue;
    const c = cls[y * W + x]; const s = c === 2 ? -1 : 1; sx += dx / d * s; sy += dy / d * s;
  }
  const len = Math.hypot(sx, sy) || 1;
  const [wx, wz] = toWorld(hx, hy);
  return { name: h.name, x: r1(wx), z: r1(wz), seaward: [r1(sx / len), r1(sy / len)] };
});

// ---------------------------------------------------------------- mapdata.json
const mapdata = {
  name: 'Lake Windermere',
  image: { width: W, height: H },
  metersPerPixel: METERS_PER_PIXEL,
  worldSize: [r1(W * METERS_PER_PIXEL), r1(H * METERS_PER_PIXEL)],
  height: { min: HEIGHT_MIN, max: HEIGHT_MAX, waterLevel: 0 },
  waterDepth: { offset: DEPTH_OFFSET, range: DEPTH_RANGE },
  buoys: buoys.map(b => { const [x, z] = toWorld(b.px[0], b.px[1]); return { type: b.type, x: r1(x), z: r1(z) }; }),
  harbors,
};
writeFileSync(resolve(OUT, 'mapdata.json'), JSON.stringify(mapdata, null, 2));
writeFileSync(resolve(OUT, 'trees.json'), JSON.stringify(trees));

// ---------------------------------------------------------------- debug preview (not shipped)
{
  const out = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const h = height[i];
    let c;
    if (cls[i] === 2) { const t = Math.min(1, h / 160); c = [60 + 150 * t, 120 + 100 * t, 40 + 150 * t]; }
    else { const t = Math.min(1, -h / 38); c = [20 * (1 - t), 160 * (1 - t) + 30 * t, 180 * (1 - t) + 90 * t]; }
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`/tmp/mapgen-height-preview-${Date.now()}.png`);
}
console.log(`buoys ${buoys.length}, harbors`, harbors);
