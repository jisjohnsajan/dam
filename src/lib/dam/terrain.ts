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
export const RES_LEVEL = 21.5; // initial reservoir surface elevation
export const SPILL_Z0 = 18; // spillway notch band (z)
export const SPILL_Z1 = 30;
export const SPILL_CREST_CLOSED = 22.2; // gate-top sill when gates closed
export const GATE_OPEN_ELEV = 15.5; // sill when gates fully open
export const BREACH_Z0 = -14; // breach band (z)
export const BREACH_Z1 = 10;
export const BREACH_BOTTOM = 11.4; // final breach invert

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

// ------------------------------------------------------------------- bed zone
// Longitudinal profile + canyon walls + incised downstream channel.
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

  // mountain wall closing the upstream end
  if (x < 7) floor += (7 - x) * (7 - x) * 0.5;

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

// Apply current breach / gate animation onto a copy of the base structure.
export function applyStructState(
  target: Float32Array,
  base: Float32Array,
  breachElev: number | null, // null = intact
  gateElev: number | null, // null = closed
): void {
  target.set(base);
  if (breachElev != null) {
    const i0 = Math.max(0, Math.floor(111.7 / DX));
    const i1 = Math.min(NX - 1, Math.ceil(115.4 / DX));
    const j0 = Math.max(0, Math.floor((BREACH_Z0 + LZ / 2) / DZ));
    const j1 = Math.min(NZ - 1, Math.ceil((BREACH_Z1 + LZ / 2) / DZ));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (base[j * NX + i] > -500) target[j * NX + i] = breachElev;
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
export function buildInitState(): Float32Array {
  const arr = new Float32Array(NX * NZ * 4);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * DX;
      const z = (j + 0.5) * DZ - LZ / 2;
      const b = bedAt(x, z);
      let eta = b - 0.5; // dry
      let u = 0;
      if (x < DAM_X - 0.3) {
        if (b < RES_LEVEL) eta = RES_LEVEL; // reservoir
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
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
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

  // base rock
  let r = 0.33 + 0.09 * n;
  let g = 0.30 + 0.075 * n;
  let bl = 0.26 + 0.06 * n;

  // grass on gentle terrain (mostly downstream benches + upstream valley edge)
  const grass = smoothstep(0.35, 0.12, slope) * smoothstep(24, 17, b) * (0.55 + 0.45 * n2);
  r = r * (1 - grass) + 0.23 * grass;
  g = g * (1 - grass) + 0.34 * grass;
  bl = bl * (1 - grass) + 0.16 * grass;

  // sandy channel bed
  const sand = smoothstep(0.6, 1.8, 1.8 - slope) * smoothstep(10.8, 9.2, b) * (x > DAM_X - 4 ? 1 : 0);
  r = r * (1 - sand) + 0.46 * sand;
  g = g * (1 - sand) + 0.39 * sand;
  bl = bl * (1 - sand) + 0.28 * sand;

  // dark sediment under the reservoir
  if (x < DAM_X && b < RES_LEVEL) {
    const s = smoothstep(RES_LEVEL, RES_LEVEL - 2.5, b);
    r = r * (1 - s) + 0.27 * s;
    g = g * (1 - s) + 0.245 * s;
    bl = bl * (1 - s) + 0.20 * s;
  }

  // subtle altitude fade on high rock
  const high = smoothstep(28, 42, b);
  r = r * (1 - high) + 0.37 * high;
  g = g * (1 - high) + 0.36 * high;
  bl = bl * (1 - high) + 0.35 * high;

  out.r = clamp01(r);
  out.g = clamp01(g);
  out.b = clamp01(bl);
}
