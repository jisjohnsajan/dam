// Terrain generation & physical layout for the dam-break simulation.
// World convention: x ∈ [0, LX] flows upstream → downstream, z ∈ [-LZ/2, LZ/2] across valley.
// Sim texture uv: u = x / LX, v = (z + LZ/2) / LZ  (row 0 == v 0 == z = -LZ/2)

export const LX = 192;
export const LZ = 112;
export const NX = 384;
export const NZ = 224;
export const DX = LX / NX;
export const DZ = LZ / NZ;

export const DAM_X = 112; // upstream face of the dam
export const CREST = 23; // main crest elevation (m)
export const RES_LEVEL = 21.5; // default reservoir surface elevation
export const SPILL_Z0 = 18; // spillway notch band (z)
export const SPILL_Z1 = 30;
export const SPILL_CREST_CLOSED = 22.2; // gate-top sill when gates closed
export const GATE_OPEN_ELEV = 15.5; // sill when gates fully open

// The central dam section is split into 5 monolith blocks so a breach opens
// exactly where blocks fail — water can only flow through the visible gap.
export const BLOCK_Z0 = -14;
export const BLOCK_Z1 = 10;
export const BLOCK_N = 5;
export const BLOCK_W = (BLOCK_Z1 - BLOCK_Z0) / BLOCK_N; // 4.8 m
export const BREACH_BOTTOM = 11.4; // final breach invert (rubble top)

// River inlet gorge at the upstream end — the reservoir is fed by a VISIBLE
// river channel carved through the mountain wall (no water appears from nowhere).
export const GORGE_HALF_W = 3.6; // inflow band |z| < GORGE_HALF_W
export const SRC_X0 = 1.6;
export const SRC_X1 = 6.0;

// ---------------------------------------------------------------- value noise
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2.07;
    a *= 0.5;
  }
  return s;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------- bed zone
// Longitudinal profile + canyon walls + incised downstream channel + gorge inlet.
export function bedAt(x: number, z: number): number {
  let floor: number;
  if (x < DAM_X) {
    floor = 13.0 - (x / DAM_X) * 1.2; // reservoir reach: 13 → 11.8
  } else {
    const t = Math.min((x - DAM_X) / 80, 1);
    floor = 11.8 - t * 7.8; // downstream valley: 11.8 → 4.0
  }
  const wz = Math.abs(z);
  const w0 = 30 + 5 * Math.sin(x * 0.045 + 1.3) + 3 * Math.sin(x * 0.013);

  // incised main channel downstream of the dam (gaussian cut, ~2.2 m deep)
  if (x > DAM_X + 4) {
    floor -= 2.2 * Math.exp(-(wz * wz) / 100);
  }

  // canyon walls rising from the channel edge
  if (wz > w0) {
    const t = wz - w0;
    const rough = 0.75 + 0.5 * fbm(x * 0.08 + 3.7, z * 0.08, 3);
    floor += Math.min(t * 0.62, 24) * rough;
  }

  // mountain wall closing the upstream end — with a carved river gorge
  if (x < 9) {
    const carve = smoothstep(GORGE_HALF_W, 8.5, wz); // 0 inside gorge, 1 outside
    if (x < 7) floor += (7 - x) * (7 - x) * 0.5 * (0.1 + 0.9 * carve);
    if (wz < GORGE_HALF_W + 1.2) {
      floor = Math.min(floor, 13.4 - x * 0.09); // gorge floor feeds the reservoir
    }
  }

  // rockiness
  const amp = wz > w0 ? 5.0 : 0.55;
  floor += (fbm(x * 0.11 + 7.3, z * 0.11 + 2.1, 4) - 0.5) * amp;

  return Math.max(floor, 2.5);
}

// --------------------------------------------------------- structure (dam) field
// Per-cell solid elevation for the dam. -1000 = "no structure" (terrain only).
export function buildStructBase(): Float32Array {
  const arr = new Float32Array(NX * NZ).fill(-1000);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * DX;
      const z = (j + 0.5) * DZ - LZ / 2;
      if (x > 111.7 && x < 120.6) {
        const b = bedAt(x, z);
        if (b < 22.6) {
          const crest = z > SPILL_Z0 && z < SPILL_Z1 ? SPILL_CREST_CLOSED : CREST;
          let e: number;
          if (x <= 115.2) {
            e = crest; // holding section with vertical upstream face
          } else {
            e = Math.max(crest - (x - 115.2) * 2.2, b); // downstream batter
          }
          arr[j * NX + i] = e;
        }
      }
    }
  }
  return arr;
}

export interface BreachSpan {
  start: number; // block index 0..4
  count: number; // 1..5
  depth01: number; // 0 intact → 1 fully eroded (max across blocks)
  depths?: number[]; // per-block erosion depth01 — lets blocks fail in a staggered
  // sequence while the simulated structure field stays EXACTLY in sync with the
  // visual block sinking (water only ever pours through the visibly-open gap).
}

// Apply current breach / gate animation onto a copy of the base structure.
// The failing blocks' top elevation descends with the SAME curve as the visual
// blocks sink, so water always pours exactly through the visible gap.
export function applyStructState(
  target: Float32Array,
  base: Float32Array,
  breach: BreachSpan | null,
  gateElev: number | null, // null = closed
): void {
  target.set(base);
  if (breach && breach.count > 0 && breach.depth01 > 0) {
    const zA = BLOCK_Z0 + breach.start * BLOCK_W;
    const zB = zA + breach.count * BLOCK_W;
    const i0 = Math.max(0, Math.floor(111.7 / DX));
    const i1 = Math.min(NX - 1, Math.ceil(115.4 / DX));
    const j0 = Math.max(0, Math.floor((zA + LZ / 2) / DZ));
    const j1 = Math.min(NZ - 1, Math.ceil((zB + LZ / 2) / DZ));
    for (let j = j0; j <= j1; j++) {
      const z = (j + 0.5) * DZ - LZ / 2;
      if (z < zA || z > zB) continue;
      const kb = Math.min(breach.count - 1, Math.max(0, Math.floor((z - zA) / BLOCK_W)));
      const d01 = breach.depths ? breach.depths[kb] : breach.depth01;
      if (d01 <= 0) continue;
      for (let i = i0; i <= i1; i++) {
        if (base[j * NX + i] > -500) {
          const b = bedAt((i + 0.5) * DX, z);
          const invert = Math.min(Math.max(b + 0.4, BREACH_BOTTOM - 1.2), BREACH_BOTTOM + 1.4);
          target[j * NX + i] = CREST + (invert - CREST) * d01;
        }
      }
    }
  }
  if (gateElev != null) {
    const i0 = Math.max(0, Math.floor(111.7 / DX));
    const i1 = Math.min(NX - 1, Math.ceil(115.4 / DX));
    const j0 = Math.max(0, Math.floor((SPILL_Z0 + LZ / 2) / DZ));
    const j1 = Math.min(NZ - 1, Math.ceil((SPILL_Z1 + LZ / 2) / DZ));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (base[j * NX + i] > -500) target[j * NX + i] = gateElev;
  }
}

// ------------------------------------------------------------- initial fluid state
// RGBA per cell: (eta, u, v, unused)
export function buildInitState(resLevel = RES_LEVEL): Float32Array {
  const arr = new Float32Array(NX * NZ * 4);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * DX;
      const z = (j + 0.5) * DZ - LZ / 2;
      const b = bedAt(x, z);
      let eta = b - 0.5; // dry
      let u = 0;
      if (x < DAM_X - 0.3) {
        if (b < resLevel) eta = resLevel; // reservoir
      } else if (b < 10.2) {
        eta = b + 0.4; // base river flow downstream
        u = 0.7;
      }
      const k = (j * NX + i) * 4;
      arr[k] = eta;
      arr[k + 1] = u;
      arr[k + 2] = 0;
      arr[k + 3] = 0;
    }
  }
  return arr;
}

// ------------------------------------------------------------------ terrain colors
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// slope: |∇bed| estimated by caller
export function terrainColor(
  x: number,
  z: number,
  b: number,
  slope: number,
  out: { r: number; g: number; b: number },
): void {
  const n = fbm(x * 0.35 + 11.1, z * 0.35 + 4.2, 3);
  const n2 = fbm(x * 0.06 + 1.7, z * 0.06 + 9.4, 2);
  const strata = Math.sin(b * 0.85 + n2 * 3.1) * 0.5 + 0.5; // rock banding

  // base rock with subtle stratification
  let r = 0.32 + 0.085 * n + 0.035 * strata;
  let g = 0.29 + 0.07 * n + 0.03 * strata;
  let bl = 0.255 + 0.055 * n + 0.022 * strata;

  // lush grass on gentle terrain (tropical valley floor + benches)
  const grass = smoothstep(0.38, 0.1, slope) * smoothstep(25, 17.5, b) * (0.5 + 0.5 * n2);
  r = r * (1 - grass) + (0.16 + 0.05 * n2) * grass;
  g = g * (1 - grass) + (0.30 + 0.08 * n2) * grass;
  bl = bl * (1 - grass) + (0.115 + 0.03 * n2) * grass;

  // sandy channel bed
  const sand = smoothstep(0.6, 1.8, 1.8 - slope) * smoothstep(10.8, 9.2, b) * (x > DAM_X - 4 ? 1 : 0);
  r = r * (1 - sand) + 0.47 * sand;
  g = g * (1 - sand) + 0.41 * sand;
  bl = bl * (1 - sand) + 0.30 * sand;

  // dark wet sediment under the reservoir + drawdown stain ring
  if (x < DAM_X && b < RES_LEVEL + 0.7) {
    const s = smoothstep(RES_LEVEL + 0.7, RES_LEVEL - 2.5, b);
    r = r * (1 - s) + 0.235 * s;
    g = g * (1 - s) + 0.215 * s;
    bl = bl * (1 - s) + 0.175 * s;
  }

  // sun-bleached rock higher up
  const high = smoothstep(28, 44, b);
  r = r * (1 - high) + 0.40 * high;
  g = g * (1 - high) + 0.385 * high;
  bl = bl * (1 - high) + 0.36 * high;

  out.r = clamp01(r);
  out.g = clamp01(g);
  out.b = clamp01(bl);
}
