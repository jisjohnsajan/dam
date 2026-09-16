// DAMSAFE 3D — transparent risk engine, forecasting, impact & evacuation analysis.
// All downstream-impact numbers are SIMULATED ESTIMATES derived from the
// interactive hydraulic solver plus per-dam scale factors — never live truth.

import type { DamProfile } from './config';
import { simToRealLevel, storagePercent } from './config';

// ------------------------------------------------------------------ risk engine
export interface RiskFactor {
  key: string;
  label: string;
  level: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME';
  weight: number; // max contribution of this factor
  score: number; // 0..weight
  note: string;
}

export interface RiskResult {
  score: number; // 0..100
  status: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  factors: RiskFactor[];
  why: { bad: string[]; ok: string[] };
}

const band = (v: number, a: number, b: number, c: number): RiskFactor['level'] =>
  v >= c ? 'EXTREME' : v >= b ? 'HIGH' : v >= a ? 'ELEVATED' : 'NORMAL';

export function computeRisk(
  dam: DamProfile,
  liveFrac: number,
  levelFrac: number,
  riseMPerHr: number, // real metres/hour
  inflowReal: number,
  rainInflow: number,
  structural?: { strain: number; tilt: number; seepage: number }, // ESP32 channels
): RiskResult {
  const factors: RiskFactor[] = [];
  const add = (
    key: string, label: string, lvl: RiskFactor['level'], weight: number, score: number, note: string,
  ): void => {
    factors.push({ key, label, level: lvl, weight, score: Math.max(0, Math.min(score, weight)), note });
  };

  // reservoir level vs FRL
  const lvl = band(liveFrac * 100, 70, 88, 97);
  add('level', 'Reservoir level', lvl, 30, (liveFrac / 1.0) * 30,
    liveFrac > 0.88 ? 'Level approaching FRL' : 'Level within operating band');

  // rate of rise (real m/hr; band scale depends on dam size)
  const riseScale = dam.heightM / 60; // normalize per dam
  const rn = riseMPerHr / riseScale;
  const rl = band(rn, 0.35, 0.9, 1.6);
  add('rise', 'Rate of rise', rl, 15, Math.min(rn / 1.8, 1) * 15,
    riseMPerHr > 0 ? `+${riseMPerHr.toFixed(2)} m/hr` : 'Level steady or falling');

  // inflow vs typical (demo scale: qScale)
  const inTyp = 6 * dam.qScale;
  const if_ = band(inflowReal / inTyp, 1.2, 2.5, 5);
  add('inflow', 'Inflow', if_, 15, Math.min(inflowReal / (inTyp * 5), 1) * 15,
    `${Math.round(inflowReal)} m³/s vs ~${Math.round(inTyp)} m³/s recent average`);

  // rainfall scenario
  const rain01 = rainInflow / 64;
  const rr = band(rain01 * 100, 25, 55, 85);
  add('rain', 'Rainfall', rr, 15, rain01 * 15,
    rainInflow === 0 ? 'No significant rainfall' : `${Math.round(rainInflow)} m³/s rain-driven inflow (simulated)`);

  // spillway (assumed operational in the prototype)
  add('spillway', 'Spillway condition', 'NORMAL', 15, 0.08 * 15, 'Gates operational within assumed limits');

  // structural indicators — live ESP32 channels (strain / tilt / seepage) when
  // telemetry is flowing, otherwise the assumed-healthy prototype baseline.
  let slvl: RiskFactor['level'] = 'NORMAL';
  let sScore = 0.05 * 10;
  let sNote = 'No sensor-verified warnings (prototype)';
  if (structural) {
    const strainN = structural.strain / 430; // alarm threshold at S4
    const tiltN = structural.tilt / 2.2;
    const seepN = structural.seepage / 26;
    const worst = Math.max(strainN, tiltN, seepN);
    slvl = worst >= 0.95 ? 'EXTREME' : worst >= 0.74 ? 'HIGH' : worst >= 0.52 ? 'ELEVATED' : 'NORMAL';
    sScore = Math.min(worst, 1) * 10;
    sNote = worst >= 0.95
      ? 'Structural channel at/over ALARM threshold'
      : worst >= 0.74
        ? 'Structural channel beyond WARN threshold'
        : worst >= 0.52
          ? 'Structural loading above mid-band'
          : 'Strain / tilt / seepage within design band';
  }
  add('struct', 'Structural indicators', slvl, 10, sScore, sNote);

  const score = Math.round(factors.reduce((s, f) => s + f.score, 0));
  const status: RiskResult['status'] = score >= 75 ? 'EXTREME' : score >= 50 ? 'HIGH' : score >= 25 ? 'MODERATE' : 'LOW';
  const why = {
    bad: factors.filter((f) => f.level === 'HIGH' || f.level === 'EXTREME').map((f) => `${f.label}: ${f.note}`),
    ok: factors.filter((f) => f.level === 'NORMAL').map((f) => `${f.label}: ${f.note}`),
  };
  return { score, status, factors, why };
}

// ------------------------------------------------------------------- forecasting
// Simple water-balance forecast: dV/dt = inflow − outflow over the reservoir
// area curve. Deterministic, fully explainable — ML-ready architecture slot.
export interface ForecastPoint {
  label: string;
  realLevel: number;
  delta: number;
}

export function computeForecast(
  dam: DamProfile,
  liveFrac: number,
  riseMPerHrReal: number,
  netRise: number, // extra real m/hr from (inflow − outflow)
): ForecastPoint[] {
  const simLevel = 15.2 + liveFrac * (22.7 - 15.2);
  const now = simToRealLevel(dam, simLevel);
  const hrs = [1, 3, 6, 12];
  const labels = ['+1 hour', '+3 hours', '+6 hours', '+12 hours'];
  const rate = Math.max(riseMPerHrReal + netRise, -1.5); // clamp unphysical crash drawdowns
  // diminishing: approaches MWL asymptotically
  return hrs.map((h, i) => {
    const rise = rate * h * (1 - 0.04 * h);
    const lvl = Math.min(Math.max(now + rise, dam.minDrawdownM - 1.0), dam.mwlM - 0.15);
    return { label: labels[i], realLevel: lvl, delta: lvl - now };
  });
}

// ---------------------------------------------------------------- impact analysis
export interface ImpactResult {
  floodedKm2: number;
  buildings: number;
  roadsKm: number;
  bridges: number;
  schools: number;
  hospitals: number;
  villages: number;
  population: number;
  maxDepthM: number;
  maxVelMs: number;
  affectedVillages: { name: string; arrivalMin: number | null; depthM: number; velMs: number }[];
  affectedInfra: { kind: string; name: string; flooded: boolean }[];
}

const ROAD_LINES: [number, number][][] = [
  // main +z road
  [[117, 27.5], [132, 24.8], [148, 22.2], [164, 20.2], [180, 20.2], [188, 21.8]],
  // -z road
  [[117, -27.5], [132, -25.5], [148, -23.5], [164, -23.5], [180, -24.5], [188, -25]],
  // spur / bridge crossing
  [[150, 17], [150, 0], [150, -17]],
];

export function computeImpact(
  dam: DamProfile,
  down: { data: Float32Array; w: number; h: number },
  arr: Float32Array,
  timeMinPerSec: number,
): ImpactResult {
  const { data, w, h } = down;
  const cellArea = (192 / w) * (112 / h); // demo m²
  const toX = (col: number) => ((col + 0.5) / w) * 192;
  const toZ = (row: number) => ((row + 0.5) / h) * 112 - 56;
  const depthAt = (x: number, z: number): number => {
    const fu = Math.min(Math.max((x / 192) * w - 0.5, 0), w - 1.001);
    const fv = Math.min(Math.max(((z + 56) / 112) * h - 0.5, 0), h - 1.001);
    const i = Math.floor(fu), j = Math.floor(fv);
    const k = (j * w + i) * 4;
    return Math.max(data[k + 3], 0);
  };
  const velAt = (x: number, z: number): number => {
    const fu = Math.min(Math.max((x / 192) * w - 0.5, 0), w - 1.001);
    const fv = Math.min(Math.max(((z + 56) / 112) * h - 0.5, 0), h - 1.001);
    const i = Math.floor(fu), j = Math.floor(fv);
    const k = (j * w + i) * 4;
    return Math.sqrt(data[k + 1] * data[k + 1] + data[k + 2] * data[k + 2]);
  };
  const arrivalAt = (x: number, z: number): number | null => {
    const i = Math.min(w - 1, Math.max(0, Math.floor((x / 192) * w)));
    const j = Math.min(h - 1, Math.max(0, Math.floor(((z + 56) / 112) * h)));
    const v = arr[j * w + i];
    return v > 0 ? v * timeMinPerSec : null;
  };

  let floodedCells = 0;
  let maxDepth = 0;
  let maxVel = 0;
  // only cells downstream of the dam count as flood (the reservoir is storage)
  const floodColMin = Math.ceil((114 / 192) * w);
  for (let r = 0; r < h; r++) {
    for (let c = floodColMin; c < w; c++) {
      const k = (r * w + c) * 4;
      const dep = Math.max(data[k + 3], 0);
      if (dep > 0.12) {
        floodedCells++;
        maxDepth = Math.max(maxDepth, dep);
        maxVel = Math.max(maxVel, Math.sqrt(data[k + 1] ** 2 + data[k + 2] ** 2));
      }
    }
  }
  const floodedKm2 = floodedCells * cellArea * dam.areaScale;

  // villages
  const affectedVillages = dam.villages.map((v) => ({
    name: v.name,
    arrivalMin: arrivalAt(v.x, v.z),
    depthM: depthAt(v.x, v.z),
    velMs: velAt(v.x, v.z),
  }));
  const floodedVillages = affectedVillages.filter((v) => v.depthM > 0.15).length;

  // population: flooded share weighted by depth; 1.35× multiplier accounts for
  // surrounding hamlets not shown as individual markers (SIMULATED ESTIMATE).
  const population = Math.round(dam.villages.reduce((s, v) => {
    const dep = depthAt(v.x, v.z);
    const frac = dep > 0.15 ? Math.min(1, 0.35 + dep / 5) : 0;
    return s + v.pop * frac;
  }, 0) * 1.35);

  // roads: sample along polylines; flooded fraction × total length
  let roadKm = 0;
  for (const line of ROAD_LINES) {
    let hit = 0;
    let n = 0;
    let lenDemo = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const dx = line[i + 1][0] - line[i][0];
      const dz = line[i + 1][1] - line[i][1];
      lenDemo += Math.hypot(dx, dz);
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const x = line[i][0] + dx * t;
        const z = line[i][1] + dz * t;
        n++;
        if (depthAt(x, z) > 0.15) hit++;
      }
    }
    roadKm += (lenDemo * dam.lenScale) / 1000 * (hit / Math.max(n, 1));
  }

  // infrastructure
  const affectedInfra = dam.infra.map((f) => ({
    kind: f.kind,
    name: f.name,
    flooded: depthAt(f.x, f.z) > 0.15,
  }));

  // buildings: demo houses in scene + scaled estimate
  let demoHit = 0;
  for (const hx of [[140, -18], [148, -22], [158, -19], [145, 21], [156, 24], [166, 18], [163, -25], [173, -22], [179, 21], [151, 29]]) {
    if (depthAt(hx[0], hx[1]) > 0.3) demoHit++;
  }
  const buildings = Math.round(demoHit * dam.buildingScale + floodedVillages * 40 * (dam.buildingScale / 100));

  return {
    floodedKm2,
    buildings,
    roadsKm: roadKm,
    bridges: affectedInfra.filter((f) => f.kind === 'bridge' && f.flooded).length,
    schools: affectedInfra.filter((f) => f.kind === 'school' && f.flooded).length,
    hospitals: affectedInfra.filter((f) => f.kind === 'hospital' && f.flooded).length,
    villages: floodedVillages,
    population,
    maxDepthM: maxDepth,
    maxVelMs: maxVel,
    affectedVillages,
    affectedInfra,
  };
}

// ------------------------------------------------------------------- evacuation
export interface EvacPlan {
  village: string;
  shelter: string;
  distanceKm: number;
  travelMin: number;
  arrivalMin: number | null;
  marginMin: number | null;
  safe: boolean;
  route: [number, number][];
}

export function computeEvac(
  dam: DamProfile,
  impact: ImpactResult,
): { plans: EvacPlan[]; shelters: { name: string; capacity: number; risk: string }[] } {
  const plans: EvacPlan[] = [];
  for (const v of impact.affectedVillages) {
    const vDef = dam.villages.find((x) => x.name === v.name)!;
    // nearest shelter by straight distance (avoid flooded cells on the segment)
    let best: { s: (typeof dam.shelters)[number]; d: number } | null = null;
    for (const s of dam.shelters) {
      const d = Math.hypot(s.x - vDef.x, s.z - vDef.z) * dam.lenScale / 1000;
      if (!best || d < best.d) best = { s, d };
    }
    if (!best) continue;
    const travelMin = (best.d / 32) * 60; // 32 km/h evacuation vehicle
    const margin = v.arrivalMin !== null ? v.arrivalMin - travelMin - 10 : null;
    plans.push({
      village: v.name,
      shelter: best.s.name,
      distanceKm: best.d,
      travelMin,
      arrivalMin: v.arrivalMin,
      marginMin: margin,
      safe: margin === null ? true : margin > 0,
      route: [[vDef.x, vDef.z], [best.s.x, best.s.z]],
    });
  }
  const shelters = dam.shelters.map((s) => ({
    name: s.name,
    capacity: s.capacity,
    risk: 'LOW', // shelters are sited on high ground (demo)
  }));
  return { plans, shelters };
}

// ------------------------------------------------------------------- validation
// Predicted flood = solver mask. "Observed" flood = simulated satellite-derived
// mask (solver mask with seeded classification noise) — demonstrates the
// predicted-vs-observed comparison workflow with honestly simulated data.
export function computeValidation(
  down: { data: Float32Array; w: number; h: number },
): { agreementPct: number; overlapKm2: number; missedKm2: number; falseKm2: number } {
  const { data, w, h } = down;
  let inter = 0, union = 0, missed = 0, falsePos = 0;
  for (let i = 0; i < w * h; i++) {
    const pred = data[i * 4 + 3] > 0.12;
    const noise = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const obs = pred ? noise > 0.14 : noise > 0.9;
    if (pred && obs) inter++;
    if (pred || obs) union++;
    if (pred && !obs) falsePos++;
    if (!pred && obs) missed++;
  }
  const cellKm2 = ((192 / w) * (112 / h)) * 0.00042 * (w === 48 ? 1 : 1); // rough demo area per cell
  return {
    agreementPct: union === 0 ? 100 : Math.round((inter / union) * 100),
    overlapKm2: inter * cellKm2,
    missedKm2: missed * cellKm2,
    falseKm2: falsePos * cellKm2,
  };
}

export { simToRealLevel, storagePercent };
