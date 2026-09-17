// Terrain generation & physical layout for the dam-break simulation.
// SQUARE CANVAS world (160 × 160 m): the dam + reservoir occupy the TOP-LEFT
// corner, the river runs east along the upper canvas and the floodplain fans
// south-east across the rest of the square, where the city, villages and
// farmland stand. x ∈ [0, LX] west → east, z ∈ [-LZ/2, LZ/2] north → south
// (screen top = -z). Sim texture uv: u = x / LX, v = (z + LZ/2) / LZ.

export const LX = 160;
export const LZ = 160;
export const NX = 320;
export const NZ = 320;
export const DX = LX / NX;
export const DZ = LZ / NZ;

// River / reservoir axis: the upper (northern) band of the square canvas.
export const AXIS_Z = -45;

export const DAM_X = 40; // upstream face of the dam (near the left edge)
export const CREST = 23; // main crest elevation (m)
export const RES_LEVEL = 21.5; // default reservoir surface elevation
export const SPILL_Z0 = AXIS_Z + 18; // spillway notch band (z)
export const SPILL_Z1 = AXIS_Z + 30;
export const SPILL_CREST_CLOSED = 22.8; // gate-top sill when gates closed
// (kept above the live-operable level range — slider max 22.7 — so a full
// reservoir never leaks through visually-closed gates; only "Open gates"
// or a real overtopping scenario can ever put water through the spillway)
export const GATE_OPEN_ELEV = 15.5; // sill when gates fully open

// The central dam section is split into 5 monolith blocks so a breach opens
// exactly where blocks fail — water can only flow through the visible gap.
export const BLOCK_Z0 = AXIS_Z - 14;
export const BLOCK_Z1 = AXIS_Z + 10;
export const BLOCK_N = 5;
export const BLOCK_W = (BLOCK_Z1 - BLOCK_Z0) / BLOCK_N; // 4.8 m
export const BREACH_BOTTOM = 11.4; // final breach invert (rubble top)

// River inlet gorge at the WEST edge — the reservoir is fed by a VISIBLE
// river channel carved through the mountain wall (no water appears from
// nowhere). The gorge band is centred on AXIS_Z.
export const GORGE_HALF_W = 3.6; // inflow band |z - AXIS_Z| < GORGE_HALF_W
export const SRC_X0 = 1.6;
export const SRC_X1 = 6.0;

// Stilling-basin apron: concrete slab on the channel bed at the dam toe.
// props.ts draws the visual slab at the SAME elevation so the flood visibly
// rides over it instead of vanishing under a floating slab.
export const APRON_X0 = DAM_X + 8.6;
export const APRON_X1 = DAM_X + 22.6;
export const APRON_HALF_W = 30;
export const APRON_TOP = bedAt(DAM_X + 13.5, AXIS_Z) + 0.35; // slab top elevation (m)

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

// River axis drifts gently south-east downstream so the flood wave fans
// across the canvas (top-left dam → centre/east floodplain).
export function axisAt(x: number): number {
  return AXIS_Z + 17 * smoothstep(54, 152, x);
}

// ------------------------------------------------------------------- bed zone
// Longitudinal profile + valley walls + incised downstream channel + gorge
// inlet + the square-canvas perimeter range (smooth rounded mountains on all
// four edges — tallest around the reservoir corner, lowest at the south rim).
export function bedAt(x: number, z: number): number {
  const az = axisAt(x);
  const dzo = z - az; // cross-valley offset from the local river axis

  let floor: number;
  if (x < DAM_X) {
    floor = 13.0 - (x / DAM_X) * 1.2; // reservoir reach: 13 → 11.8
  } else {
    const t = Math.min((x - DAM_X) / 95, 1);
    floor = 11.8 - t * 7.3; // downstream valley: 11.8 → 4.5
  }

  // incised main channel downstream of the dam (gaussian cut, ~2.2 m deep)
  if (x > DAM_X + 4) {
    floor -= 2.2 * Math.exp(-(dzo * dzo) / 100);
  }

  const rough = 0.85 + 0.3 * fbm(x * 0.08 + 3.7, z * 0.08, 3);

  // ---- reservoir basin (top-left corner lake) ----------------------------
  // asymmetric half-widths: the north shore hugs the rim, the south shore
  // leaves a strip of land (SW quadrant) between the lake and the canvas
  if (x < DAM_X) {
    const bulge = Math.exp(-((x - 19) * (x - 19)) / 430);
    const wN = 26 + 3.5 * bulge; // north shore distance from the axis
    const wS = 31 + 7.5 * bulge; // south shore distance from the axis
    const tN = -dzo - wN; // > 0 north of the north shore
    const tS = dzo - wS; // > 0 south of the south shore
    if (tN > 0) floor += (1 - Math.exp(-tN / 15)) * 20 * rough;
    if (tS > 0) floor += (1 - Math.exp(-tS / 17)) * 17 * rough;
  }

  // ---- downstream corridor walls ------------------------------------------
  // the valley is confined near the dam, then the SOUTH wall recedes so the
  // floodplain opens across the centre/south of the canvas (city floor)
  if (x >= DAM_X) {
    const open = smoothstep(56, 118, x);
    const wN2 = 27;
    const wS2 = 26 + 36 * open;
    const tN2 = -dzo - wN2;
    const tS2 = dzo - wS2;
    if (tN2 > 0) floor += (1 - Math.exp(-tN2 / 16)) * 19 * rough;
    if (tS2 > 0) floor += (1 - Math.exp(-tS2 / 19)) * 16 * rough;
  }

  // Abutment shoulders — near the dam the valley walls rise just above the
  // crest so the structure visibly keys into solid rock at both flanks.
  const damDist = Math.abs(x - DAM_X);
  const wz = Math.abs(dzo);
  if (damDist < 30 && wz > 24) {
    const near = smoothstep(30, 8, damDist); // 1 at the dam axis, fades by ±30 m
    const t = (wz - 24) / 13;
    floor += near * Math.min(t, 0.9) * 9.0;
  }

  // ---- square-canvas perimeter range (smooth rounded walls, no peaks) -----
  // west headwall behind the reservoir (gorge carved through it)
  if (x < 10) {
    const carve = smoothstep(GORGE_HALF_W, 9.5, Math.abs(z - AXIS_Z));
    const corner = 1 + 0.55 * smoothstep(-30, -72, z); // NW massif boost
    if (x < 8) floor += (7 - x) * (7 - x) * 0.5 * (0.1 + 0.9 * carve) * corner;
    if (Math.abs(z - AXIS_Z) < GORGE_HALF_W + 1.2) {
      // gorge floor feeds the reservoir; a rapids channel ramps gently down
      // toward the lake (the visible inflow river)
      floor = Math.min(floor, 13.4 - x * 0.09 + smoothstep(3.6, 0.6, x) * 10.0);
      // end sill: the notch floor rises back ABOVE every achievable water
      // level (scenario drive caps at 24.4 m) right at the domain edge, so
      // the reservoir shoreline always tucks onto this rock ramp INSIDE the
      // notch instead of being sliced off by the boundary plane.
      const band = 1 - smoothstep(GORGE_HALF_W + 1.2, GORGE_HALF_W + 2.8, Math.abs(z - AXIS_Z));
      floor += smoothstep(2.6, 0.4, x) * 13.2 * band;
    }
  }
  // north rim (canvas top edge)
  {
    const tN3 = -(z + 77);
    if (tN3 > 0) {
      const boost = 1 + 0.35 * smoothstep(70, 20, x); // taller around the lake
      floor += (1 - Math.exp(-tN3 / 15)) * 22 * rough * boost;
    }
  }
  // south rim (canvas bottom edge) — lowest, so the aerial camera sees over it
  {
    const tS3 = z - 72;
    if (tS3 > 0) floor += (1 - Math.exp(-tS3 / 19)) * 17 * rough;
  }
  // east rim (canvas right edge) with the river exit gorge carved through
  {
    const tE = x - 154;
    if (tE > 0) {
      const carve = smoothstep(5.5, 14, Math.abs(z - axisAt(LX))); // 0 at the exit
      floor += (1 - Math.exp(-tE / 14)) * 21 * rough * (0.12 + 0.88 * carve);
    }
  }

  // rockiness — kept subtle on the walls so the slopes read as smooth turf
  // and weathered rock, not craggy rubble
  const amp = wz > 26 ? 2.6 : 0.55;
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
      if (x > DAM_X - 0.3 && x < DAM_X + 8.6) {
        const b = bedAt(x, z);
        if (b < 22.6) {
          const crest = z > SPILL_Z0 && z < SPILL_Z1 ? SPILL_CREST_CLOSED : CREST;
          let e: number;
          if (x <= DAM_X + 3.2) {
            e = crest; // holding section with vertical upstream face
          } else {
            e = Math.max(crest - (x - (DAM_X + 3.2)) * 2.2, b); // downstream batter
          }
          arr[j * NX + i] = e;
        }
      }

      // stilling-basin apron slab — the flood rides over this shelf and the
      // baffle blocks churn it into whitewater (matches the visual slab)
      if (x >= APRON_X0 && x <= APRON_X1 && Math.abs(z - AXIS_Z) <= APRON_HALF_W) {
        if (APRON_TOP > bedAt(x, z)) {
          arr[j * NX + i] = Math.max(arr[j * NX + i], APRON_TOP);
        }
      }

      // Watertight west boundary plug. The gorge notch is open at the domain
      // edge (analytic bed ~15 m there, far below every water level), so the
      // lake surface would be sliced at x = 0 — at storm / overtop levels
      // (24 m) that slice reads as a huge waterfall pouring off the edge of
      // the world. A tall invisible wall just inside the boundary, hidden
      // deep inside the mountain notch, seals EVERY achievable water level
      // (max scenario drive 24.4 m) inside the domain.
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
    const zA = BLOCK_Z0 + breach.start * BLOCK_W;
    const zB = zA + breach.count * BLOCK_W;
    // Clear the FULL dam thickness (holding section AND the downstream batter
    // down to the toe). The visual monolith blocks sink rigidly, so the
    // simulated structure must drop across their whole footprint — otherwise
    // an invisible wedge of "intact batter" keeps blocking the flow behind
    // the visibly-open gap and the breach jet never pours through.
    const i0 = Math.max(0, Math.floor((DAM_X - 0.3) / DX));
    const i1 = Math.min(NX - 1, Math.ceil((DAM_X + 8.9) / DX));
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
    const i0 = Math.max(0, Math.floor((DAM_X - 0.3) / DX));
    const i1 = Math.min(NX - 1, Math.ceil((DAM_X + 3.7) / DX));
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
        // base river confined to the incised channel (where the channel cut is
        // significant) — a full-valley sheet reads as a flooded floodplain and
        // ends in a hard straight edge at the domain boundary
        const dzo = z - axisAt(x);
        const inChannel = Math.exp(-(dzo * dzo) / 100) > 0.45; // |dz| <~ 10.7 m
        if (inChannel) {
          const taper = 1 - smoothstep(144, 159, x); // sink the river before the edge
          eta = b + 0.4 * taper;
          u = 0.7;
        }
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

// soft rounded-rect zone test with falloff (km-style city/farm masks)
function zoneFall(x: number, z: number, x0: number, z0: number, x1: number, z1: number, f: number): number {
  const dx = Math.min(x - x0, x1 - x);
  const dz = Math.min(z - z0, z1 - z);
  return smoothstep(-f, 0, Math.min(dx, dz));
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

  // base rock with subtle stratification (warm granite/gneiss, kept deep so
  // the sunlit faces of the towering ranges stay mid-tone, never glacial)
  let r = 0.325 + 0.07 * n + 0.03 * strata;
  let g = 0.29 + 0.058 * n + 0.026 * strata;
  let bl = 0.246 + 0.045 * n + 0.018 * strata;

  // lush grass on gentle terrain (tropical valley floor + benches) — the band
  // reaches further up the lower slopes so the valley reads as green, not raw
  const grass = smoothstep(0.55, 0.12, slope) * smoothstep(42, 14, b) * (0.5 + 0.5 * n2);
  r = r * (1 - grass) + (0.16 + 0.05 * n2) * grass;
  g = g * (1 - grass) + (0.30 + 0.08 * n2) * grass;
  bl = bl * (1 - grass) + (0.115 + 0.03 * n2) * grass;

  // scrub vegetation clothing the slopes — every hill/rim in the square canvas
  // reads as green and rounded; bare rock only shows on steep faces
  const scrub = smoothstep(1.5, 0.35, slope) * smoothstep(135, 20, b) * (0.3 + 0.7 * n);
  const sv = scrub * 0.9;
  r = r * (1 - sv) + (0.21 + 0.04 * n2) * sv;
  g = g * (1 - sv) + (0.285 + 0.05 * n2) * sv;
  bl = bl * (1 - sv) + (0.15 + 0.03 * n2) * sv;

  // forest floor — darker, richer green on the rim slopes and around the
  // reservoir so the canvas edges read as wooded hills framing the valley
  const rimD = Math.min(x, LX - x, z + LZ / 2, LZ / 2 - z);
  const forest = Math.max(smoothstep(1.35, 0.3, slope), smoothstep(34, 18, rimD) * 0.85)
    * smoothstep(100, 18, b) * (0.6 + 0.4 * n);
  r = r * (1 - forest) + (0.125 + 0.03 * n2) * forest;
  g = g * (1 - forest) + (0.235 + 0.05 * n2) * forest;
  bl = bl * (1 - forest) + (0.115 + 0.025 * n2) * forest;

  // urban ground — the city plain (centre/east of the canvas) gets a warm
  // pavement/park blend so streets and districts sit on visibly developed land
  const urbanZone = zoneFall(x, z, 58, -28, 150, 42, 9);
  const urban = urbanZone * smoothstep(13.5, 9.5, b) * smoothstep(0.5, 0.12, slope) * (0.55 + 0.45 * n2);
  r = r * (1 - urban) + (0.315 + 0.035 * n) * urban;
  g = g * (1 - urban) + (0.30 + 0.03 * n) * urban;
  bl = bl * (1 - urban) + (0.262 + 0.028 * n) * urban;

  // farmland belts — south of the city + the SW quadrant, subtle warm strips
  const farmZone =
    zoneFall(x, z, 48, 44, 152, 68, 7) * 0.8 + zoneFall(x, z, 6, -4, 44, 40, 8) * 0.7;
  const farm = Math.min(farmZone, 1) * smoothstep(16, 9, b) * smoothstep(0.7, 0.2, slope) * (0.4 + 0.6 * n2);
  r = r * (1 - farm) + (0.36 + 0.04 * n) * farm;
  g = g * (1 - farm) + (0.33 + 0.03 * n) * farm;
  bl = bl * (1 - farm) + (0.20 + 0.02 * n) * farm;

  // sandy channel bed — restricted to the incised channel band (gaussian cut
  // |dz| ≲ 11) so the floodplain reads as vegetated plain, not desert
  const dzo = z - axisAt(x);
  const sand = smoothstep(0.6, 1.8, 1.8 - slope) * smoothstep(10.8, 9.2, b)
    * (x > DAM_X - 4 ? 1 : 0) * smoothstep(16, 9, Math.abs(dzo));
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

  // sun-bleached rock only on the very top of the tallest rim massifs — every
  // mid slope stays clothed in scrub/forest
  const high = smoothstep(66, 96, b);
  const band = 0.5 + 0.5 * Math.sin(b * 0.55 + n2 * 4.2); // large rock strata
  r = r * (1 - high) + (0.265 + 0.058 * band + 0.026 * n) * high;
  g = g * (1 - high) + (0.248 + 0.046 * band + 0.022 * n) * high;
  bl = bl * (1 - high) + (0.226 + 0.036 * band + 0.018 * n) * high;

  out.r = clamp01(r);
  out.g = clamp01(g);
  out.b = clamp01(bl);
}
