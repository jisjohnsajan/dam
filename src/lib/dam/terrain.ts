// Terrain generation & physical layout for the dam-break simulation.
// DIAGONAL CORNER MAP (reference satellite diorama): the dam + reservoir
// occupy the TOP-LEFT corner with the dam wall running DIAGONALLY (45°) across
// the corner; the river/flood flows down-right toward the BOTTOM-RIGHT corner
// through a broad floodplain between low green hills — the far canvas corners
// fall away to a matte base shelf (no excess land). x ∈ [0, LX] west → east,
// z ∈ [-LZ/2, LZ/2] north → south
// (screen top = -z). Sim texture uv: u = x / LX, v = (z + LZ/2) / LZ.
//
// All valley geometry is authored in a rotated frame:
//   s = downstream distance from the top-left corner (along the +x,+z diagonal)
//   t = cross-valley offset (+t toward the top-right corner)
// with a 1:1 metre scale (pure rotation, no scaling).

export const LX = 160;
export const LZ = 160;
export const NX = 320;
export const NZ = 320;
export const DX = LX / NX;
export const DZ = LZ / NZ;

// ---------------------------------------------------------------- rotated frame
export const SC = Math.SQRT1_2; // cos/sin of the 45° diagonal

/** rotated (s,t) → world (x,z). s: downstream from the top-left corner,
 *  t: cross-valley (+ toward the top-right corner). */
export function st2xz(s: number, t: number): [number, number] {
  return [(s + t) * SC, (s - t) * SC - LZ / 2];
}

/** world (x,z) → rotated (s,t). */
export function xz2st(x: number, z: number): [number, number] {
  const z2 = z + LZ / 2;
  return [(x + z2) * SC, (x - z2) * SC];
}

// ------------------------------------------------------------------ dam layout
// The concrete dam cuts the top-left corner: its upstream face lies on the
// diagonal line s = DAM_S, spanning t ∈ [T_DAM0, T_DAM1] — the south-west end
// lands exactly ON the west domain edge (the dam reads as running off-frame,
// like the reference) and the north-east end keys into the abutment massif.
export const DAM_S = 61; // upstream face (s)
export const DAM_TOE_S = DAM_S + 8.6; // downstream toe (s)
export const T_DAM0 = -61; // dam span start (t) — at the west edge
export const T_DAM1 = -5; // dam span end (t) — into the NE abutment

// Legacy world-x of the dam zone (used by engine stats/drive clamp; the lake
// sits mostly west of this line so the reservoir drive region stays correct).
export const DAM_X = 40;
export const CREST = 23; // main crest elevation (m)
export const RES_LEVEL = 18.5; // default reservoir surface elevation — kept
// noticeably low at the operator's request (lake sits well below the crest)

// Spillway notch band (t) — two radial gates between three piers.
export const SPILL_Z0 = -52;
export const SPILL_Z1 = -40;
export const SPILL_CREST_CLOSED = 22.8; // gate-top sill when gates closed
// (kept above the live-operable level range — slider max 22.7 — so a full
// reservoir never leaks through visually-closed gates; only "Open gates"
// or a real overtopping scenario can ever put water through the spillway)
export const GATE_OPEN_ELEV = 15.5; // sill when gates fully open

// The central dam section is split into 5 monolith blocks so a breach opens
// exactly where blocks fail — water can only flow through the visible gap.
export const BLOCK_Z0 = -34; // breach zone start (t)
export const BLOCK_Z1 = -10; // breach zone end (t)
export const BLOCK_N = 5;
export const BLOCK_W = (BLOCK_Z1 - BLOCK_Z0) / BLOCK_N; // 4.8 m
export const BREACH_BOTTOM = 11.4; // final breach invert (rubble top)

// Reservoir inflow source band (engine shader injects here — west edge at
// z ≈ 0, which the corner lake covers with deep water).
export const GORGE_HALF_W = 3.6; // inflow band |z| < GORGE_HALF_W
export const SRC_X0 = 1.6;
export const SRC_X1 = 6.0;

// Stilling-basin apron: concrete slab on the channel bed at the dam toe
// (diagonal band downstream of the dam, centred on the gorge axis t = APRON_T).
export const APRON_S0 = DAM_TOE_S;
export const APRON_S1 = DAM_TOE_S + 14;
export const APRON_T = -29;
export const APRON_HALF_W = 18;
export const APRON_TOP = bedAt(DAM_TOE_S + 13.5, APRON_T) + 0.35; // slab top (m)

// Legacy axis helper (kept for compatibility): world z of the valley centre
// where the channel crosses the given world x.
export function axisAt(x: number): number {
  for (let s = DAM_TOE_S; s <= 226; s += 2) {
    const [x0] = st2xz(s, axisT(s));
    const [x1] = st2xz(s + 2, axisT(s + 2));
    if (x >= x0 && x <= x1) {
      const f = (x - x0) / Math.max(x1 - x0, 1e-6);
      return st2xz(s + 2 * f, axisT(s))[1];
    }
  }
  return st2xz(150, axisT(150))[1];
}

// Channel centreline (t) meandering down the diagonal valley: leaves the
// apron at t ≈ -29, sweeps toward the valley centre, then exits at the
// bottom-right corner (s = 226, t = 0).
function sstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
export function axisT(s: number): number {
  return -29 + 24 * sstep(70, 130, s) - 4 * sstep(140, 190, s) + 9 * sstep(190, 226, s);
}
// Valley centre (broader than the channel — the floodplain axis).
function valleyMid(s: number): number {
  return -29 + 24 * sstep(70, 135, s);
}
// Valley half-widths (asymmetric: the north-east bench — where the village,
// industry and agricultural land stand — is broader than the south-west one),
// confined gorge at the toe, opening floodplain, narrowing exit corner.
function valleyWN(s: number): number {
  return Math.min(38 + 0.40 * (s - 70), 58, 10 + 1.5 * (226 - s));
}
function valleyWS(s: number): number {
  return Math.min(14 + 0.55 * (s - 70), 52, 7 + 1.5 * (226 - s));
}

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
// Longitudinal profile + reservoir pocket + diagonal gorge + floodplain walls
// + flank ranges + canvas rims + bottom-right exit gorge.
export function bedAt(x: number, z: number): number {
  const [s, t] = xz2st(x, z);
  const rough = 0.85 + 0.3 * fbm(s * 0.08 + 3.7, t * 0.08, 3);

  let floor: number;
  if (s < DAM_S) {
    floor = 12.8 - (s / DAM_S) * 1.0; // reservoir reach: 12.8 → 11.8
  } else if (s < DAM_TOE_S) {
    floor = 11.8; // under the dam
  } else {
    const d = Math.min((s - DAM_TOE_S) / 95, 1);
    floor = 11.8 - d * 7.3; // downstream valley: 11.8 → 4.5
  }

  // incised main channel downstream of the toe (gaussian cut, ~2.2 m deep)
  if (s > DAM_TOE_S + 2) {
    const dzo = t - axisT(s);
    floor -= 2.2 * Math.exp(-(dzo * dzo) / 100);
  }

  // ---- reservoir pocket (mountain-bounded lake behind the dam) ------------
  if (s < DAM_S) {
    // north-east shore: a wall line running from the top edge down to the
    // dam's NE end, keying the lake into the abutment massif
    const shoreN = Math.min(s + 1.5, -5 + 0.34 * (DAM_S - s));
    const dtn = t - shoreN;
    if (dtn > 0) floor += (1 - Math.exp(-dtn / 9)) * 22 * rough;

    // west-shore massif — the mountains BEHIND the dam that hold the
    // reservoir: full height against the west edge, easing inland, with a
    // flooded inflow gorge cut at z ≈ 0 (the engine injects river inflow
    // there). Crest heights stay well above the max scenario drive (24.4 m)
    // so the basin never overtops its mountain walls.
    const westAmp = 32 * sstep(30, 7, x);
    const gorge = sstep(4.5, 10, Math.abs(z));
    floor += westAmp * gorge * rough;
  }

  // ---- NE abutment massif (downstream of the dam's NE end) ----------------
  // rises steeply within ~3 m of the dam end so the reservoir is sealed,
  // then fades out into the valley's north-east wall
  if (s > DAM_S - 0.5 && t > T_DAM1) {
    const steep = 1 - sstep(DAM_S + 14, DAM_S + 30, s);
    const amp = 26 * steep;
    const width = 3 * steep + 11 * (1 - steep);
    floor += (1 - Math.exp(-(t - T_DAM1) / width)) * amp * rough;
  }

  // ---- SW abutment wedge (downstream of the dam's SW end, at the edge) ----
  if (s > DAM_S && t < T_DAM0) {
    floor += (1 - Math.exp(-(T_DAM0 - t) / 3)) * 24 * rough;
  }

  // ---- downstream valley walls + flank ranges -----------------------------
  if (s >= DAM_TOE_S - 4) {
    const mid = valleyMid(s);
    const wv = t > mid ? valleyWN(s) : valleyWS(s);
    const dt = Math.abs(t - mid) - wv;
    if (dt > 0) {
      // low green hills flanking the floodplain — kept modest so the map
      // reads tight; the towering relief lives behind the dam only
      const rangeEnv =
        sstep(78, 100, s) * (1 - sstep(190, 224, s)) * 5 +
        2 * sstep(150, 200, s);
      const wall = (1 - Math.exp(-dt / 16)) * (7 + rangeEnv) * rough;
      floor += wall;
      floor += sstep(24, 66, dt) * rangeEnv * 0.4 * rough;
    }
  }

  // ---- square-canvas rims (modest frame; big relief comes from the flanks)
  // north rim — mountain wall behind the reservoir (full over the lake
  // reach), easing to a modest canvas frame downstream
  if (z < -76) {
    const lakeSide = 1 - sstep(30, 48, x);
    floor += (1 - Math.exp(-(-76 - z) / 9)) * (12 + 26 * lakeSide) * rough;
  }
  // south rim — lowest, so the aerial camera sees over it
  if (z > 72) {
    floor += (1 - Math.exp(-(z - 72) / 19)) * 9 * rough;
  }
  // west rim — south of the dam (below the inflow gorge), modest shoulder
  if (x < 3 && z > 10) {
    floor += (1 - Math.exp(-(3 - x) / 9)) * 8 * rough * sstep(10, 26, z);
  }
  // east rim with the river exit gorge carved through at t ≈ 0
  if (x > 153) {
    const carve = sstep(5.5, 14, Math.abs(t - axisT(226)));
    floor += (1 - Math.exp(-(x - 153) / 14)) * 13 * rough * (0.12 + 0.88 * carve);
  }

  // ---- excess-land cut ------------------------------------------------------
  // far canvas corners beyond the valley margins drop away to a low matte
  // base shelf — the map keeps only the land it needs (the flood exits
  // through the corner gorge, so wide flanks are dead weight)
  if (s > 92) {
    const midC = valleyMid(s);
    const wvC = t > midC ? valleyWN(s) : valleyWS(s);
    const dtC = Math.abs(t - midC) - wvC;
    floor -= sstep(92, 116, s) * sstep(13, 34, dtC) * (floor - 3.1);
  }

  // rockiness — kept subtle on the walls so the slopes read as smooth turf
  // and weathered rock, not craggy rubble
  const dtWall = s >= DAM_TOE_S - 4
    ? Math.abs(t - valleyMid(s)) - (t > valleyMid(s) ? valleyWN(s) : valleyWS(s))
    : 0;
  const amp = dtWall > 26 ? 2.6 : 0.55;
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
      const [s, t] = xz2st(x, z);
      if (s > DAM_S - 0.3 && s < DAM_TOE_S && t > T_DAM0 - 0.2 && t < T_DAM1 + 0.2) {
        const b = bedAt(x, z);
        if (b < 22.6) {
          const crest = t > SPILL_Z0 && t < SPILL_Z1 ? SPILL_CREST_CLOSED : CREST;
          const u = s - DAM_S;
          let e: number;
          if (u <= 3.2) {
            e = crest; // holding section with vertical upstream face
          } else {
            e = Math.max(crest - (u - 3.2) * 2.2, b); // downstream batter
          }
          arr[j * NX + i] = e;
        }
      }

      // stilling-basin apron slab — the flood rides over this shelf and the
      // baffle blocks churn it into whitewater (matches the visual slab)
      if (s >= APRON_S0 && s <= APRON_S1 && Math.abs(t - APRON_T) <= APRON_HALF_W) {
        if (APRON_TOP > bedAt(x, z)) {
          arr[j * NX + i] = Math.max(arr[j * NX + i], APRON_TOP);
        }
      }

      // Watertight west boundary plug. The corner lake runs off the west
      // domain edge (like the reference frame crop), so a tall invisible wall
      // just inside the boundary seals EVERY achievable water level (max
      // scenario drive 24.4 m) inside the domain.
      if (x < 0.6) {
        arr[j * NX + i] = Math.max(arr[j * NX + i], 30.0);
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
    const tA = BLOCK_Z0 + breach.start * BLOCK_W;
    const tB = tA + breach.count * BLOCK_W;
    // Clear the FULL dam thickness (holding section AND the downstream batter
    // down to the toe). The visual monolith blocks sink rigidly, so the
    // simulated structure must drop across their whole footprint — otherwise
    // an invisible wedge of "intact batter" keeps blocking the flow behind
    // the visibly-open gap and the breach jet never pours through.
    const s0 = DAM_S - 0.3;
    const s1 = DAM_TOE_S + 0.3;
    for (let j = 0; j < NZ; j++) {
      const z = (j + 0.5) * DZ - LZ / 2;
      for (let i = 0; i < NX; i++) {
        if (base[j * NX + i] <= -500) continue;
        const x = (i + 0.5) * DX;
        const [s, t] = xz2st(x, z);
        if (s < s0 || s > s1 || t < tA || t > tB) continue;
        const kb = Math.min(breach.count - 1, Math.max(0, Math.floor((t - tA) / BLOCK_W)));
        const d01 = breach.depths ? breach.depths[kb] : breach.depth01;
        if (d01 <= 0) continue;
        const b = bedAt(x, z);
        const invert = Math.min(Math.max(b + 0.4, BREACH_BOTTOM - 1.2), BREACH_BOTTOM + 1.4);
        target[j * NX + i] = CREST + (invert - CREST) * d01;
      }
    }
  }
  if (gateElev != null) {
    for (let j = 0; j < NZ; j++) {
      const z = (j + 0.5) * DZ - LZ / 2;
      for (let i = 0; i < NX; i++) {
        if (base[j * NX + i] <= -500) continue;
        const x = (i + 0.5) * DX;
        const [s, t] = xz2st(x, z);
        if (s < DAM_S - 0.3 || s > DAM_S + 3.7 || t < SPILL_Z0 || t > SPILL_Z1) continue;
        target[j * NX + i] = gateElev;
      }
    }
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
      const [s, t] = xz2st(x, z);
      const b = bedAt(x, z);
      let eta = b - 0.5; // dry
      let u = 0;
      let v = 0;
      if (s < DAM_S - 0.3) {
        if (b < resLevel) eta = resLevel; // reservoir (corner lake)
      } else if (b < 10.2) {
        // base river confined to the incised channel (where the channel cut is
        // significant) — a full-valley sheet reads as a flooded floodplain and
        // ends in a hard straight edge at the domain boundary
        const dzo = t - axisT(s);
        const inChannel = Math.exp(-(dzo * dzo) / 100) > 0.45; // |dt| <~ 10.7 m
        if (inChannel) {
          const taper = 1 - sstep(206, 222, s); // sink the river before the exit
          eta = b + 0.4 * taper;
          u = 0.5; // initial drift along the +x,+z diagonal (down-valley)
          v = 0.5;
        }
      }
      const k = (j * NX + i) * 4;
      arr[k] = eta;
      arr[k + 1] = u;
      arr[k + 2] = v;
      arr[k + 3] = 0;
    }
  }
  return arr;
}

// ------------------------------------------------------------------ terrain colors
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// soft rounded-rect zone test with falloff, in rotated (s,t) space
function zoneFallST(s: number, t: number, s0: number, t0: number, s1: number, t1: number, f: number): number {
  const ds = Math.min(s - s0, s1 - s);
  const dtn = Math.min(t - t0, t1 - t);
  return sstep(-f, 0, Math.min(ds, dtn));
}

// slope: |∇bed| estimated by caller
export function terrainColor(
  x: number,
  z: number,
  b: number,
  slope: number,
  out: { r: number; g: number; b: number },
): void {
  const [s, t] = xz2st(x, z);
  const n = fbm(x * 0.35 + 11.1, z * 0.35 + 4.2, 3);
  const n2 = fbm(x * 0.06 + 1.7, z * 0.06 + 9.4, 2);
  const strata = Math.sin(b * 0.85 + n2 * 3.1) * 0.5 + 0.5; // rock banding

  // base rock with subtle stratification (warm granite/gneiss, kept deep so
  // the sunlit faces of the towering ranges stay mid-tone, never glacial)
  let r = 0.325 + 0.07 * n + 0.03 * strata;
  let g = 0.29 + 0.058 * n + 0.026 * strata;
  let bl = 0.246 + 0.045 * n + 0.018 * strata;

  // lush grass on gentle terrain (tropical valley floor + benches) — vivid
  // yellow-green meadow like a sunlit satellite valley, brighter on the flats
  const grass = sstep(0.55, 0.12, slope) * sstep(42, 14, b) * (0.5 + 0.5 * n2);
  r = r * (1 - grass) + (0.26 + 0.07 * n2) * grass;
  g = g * (1 - grass) + (0.44 + 0.09 * n2) * grass;
  bl = bl * (1 - grass) + (0.17 + 0.04 * n2) * grass;

  // scrub vegetation clothing the slopes — every hill/range in the canvas
  // reads as green and rounded; bare rock only shows on the steepest faces
  const scrub = sstep(2.6, 0.5, slope) * sstep(135, 20, b) * (0.3 + 0.7 * n);
  const sv = scrub * 0.95;
  r = r * (1 - sv) + (0.20 + 0.05 * n2) * sv;
  g = g * (1 - sv) + (0.33 + 0.06 * n2) * sv;
  bl = bl * (1 - sv) + (0.145 + 0.035 * n2) * sv;

  // forest floor — darker, richer green on the flank ranges and around the
  // reservoir so the canvas edges read as wooded hills framing the valley
  const rimD = Math.min(x, LX - x, z + LZ / 2, LZ / 2 - z);
  const forest = Math.max(sstep(2.1, 0.4, slope), sstep(34, 18, rimD) * 0.9)
    * sstep(100, 18, b) * (0.6 + 0.4 * n);
  r = r * (1 - forest) + (0.11 + 0.035 * n2) * forest;
  g = g * (1 - forest) + (0.24 + 0.055 * n2) * forest;
  bl = bl * (1 - forest) + (0.115 + 0.03 * n2) * forest;

  // urban ground — the town plain (centre-left bank of the diagonal valley)
  const urbanZone = zoneFallST(s, t, 92, -48, 154, -2, 9);
  const urban = urbanZone * sstep(13.5, 8.5, b) * sstep(0.5, 0.12, slope) * (0.55 + 0.45 * n2);
  r = r * (1 - urban) + (0.315 + 0.035 * n) * urban;
  g = g * (1 - urban) + (0.30 + 0.03 * n) * urban;
  bl = bl * (1 - urban) + (0.262 + 0.028 * n) * urban;

  // farmland belts — upper-right agricultural bench (reference AGRICULTURAL
  // LAND), the south-west bench, and fields east of the lower floodplain
  const farmZone =
    zoneFallST(s, t, 84, 4, 132, 36, 8) * 0.85 +
    zoneFallST(s, t, 102, -50, 140, -38, 7) * 0.8 +
    zoneFallST(s, t, 140, -44, 176, -8, 7) * 0.7;
  const farm = Math.min(farmZone, 1) * sstep(16, 8, b) * sstep(0.7, 0.2, slope) * (0.4 + 0.6 * n2);
  r = r * (1 - farm) + (0.36 + 0.04 * n) * farm;
  g = g * (1 - farm) + (0.33 + 0.03 * n) * farm;
  bl = bl * (1 - farm) + (0.20 + 0.02 * n) * farm;

  // sandy channel bed — restricted to the incised channel band (gaussian cut
  // |dt| ≲ 11) so the floodplain reads as vegetated plain, not desert
  const dzo = t - axisT(s);
  const sand = sstep(0.6, 1.8, 1.8 - slope) * sstep(10.8, 9.2, b)
    * (s > DAM_S - 4 ? 1 : 0) * sstep(16, 9, Math.abs(dzo));
  r = r * (1 - sand) + 0.52 * sand;
  g = g * (1 - sand) + 0.46 * sand;
  bl = bl * (1 - sand) + 0.33 * sand;

  // matte diorama base — the low outer shelf beyond the escarpment (and the
  // exit channel bed) reads as dark slate so the map sits on a clean base
  const shelf = sstep(4.6, 3.0, b) * sstep(1.1, 0.4, slope);
  r = r * (1 - shelf) + 0.125 * shelf;
  g = g * (1 - shelf) + 0.13 * shelf;
  bl = bl * (1 - shelf) + 0.122 * shelf;

  // dark wet sediment under the reservoir + drawdown stain ring
  if (s < DAM_S && b < RES_LEVEL + 0.7) {
    const st = sstep(RES_LEVEL + 0.7, RES_LEVEL - 2.5, b);
    r = r * (1 - st) + 0.235 * st;
    g = g * (1 - st) + 0.215 * st;
    bl = bl * (1 - st) + 0.175 * st;
  }

  // sun-bleached rock only on the very top of the tallest flank massifs —
  // every mid slope stays clothed in scrub/forest
  const high = sstep(60, 92, b);
  const band = 0.5 + 0.5 * Math.sin(b * 0.55 + n2 * 4.2); // large rock strata
  r = r * (1 - high) + (0.42 + 0.07 * band + 0.03 * n) * high;
  g = g * (1 - high) + (0.33 + 0.055 * band + 0.025 * n) * high;
  bl = bl * (1 - high) + (0.235 + 0.04 * band + 0.02 * n) * high;

  out.r = clamp01(r);
  out.g = clamp01(g);
  out.b = clamp01(bl);
}
