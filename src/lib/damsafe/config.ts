// DAMSAFE 3D — reusable dam configuration architecture.
// Real dam reference values are approximate published figures; every value the
// application displays is either labeled as reference data or SIMULATED DEMO DATA.

export type DamId = 'idukki' | 'mullaperiyar';
export type FailureMechanism = 'overtopping' | 'piping' | 'structural';
export type BreachLocation = 'left' | 'center' | 'right';
export type RainScenario = 'none' | 'moderate' | 'heavy';

export interface VillageDef {
  name: string;
  x: number; // demo world coords (m)
  z: number;
  pop: number; // demo population per settlement (SIMULATED)
}

export interface ShelterDef {
  name: string;
  x: number;
  z: number;
  capacity: number;
}

export interface InfraDef {
  kind: 'hospital' | 'school' | 'bridge' | 'substation' | 'waterworks';
  name: string;
  x: number;
  z: number;
}

export interface DamProfile {
  id: DamId;
  name: string;
  river: string;
  state: string;
  damType: string;
  heightM: number; // reference height above foundation
  lengthM: number;
  frlM: number; // full reservoir level (m a.s.l.)
  mwlM: number; // max water level
  minDrawdownM: number; // lowest normal operating level
  grossStorageMm3: number; // Mm³ at FRL (reference)
  spillway: string;
  coords: [number, number];
  // ---- demo-world mapping (SIMULATED scaling from interactive solver)
  timeMinPerSec: number; // 1 demo-sim second = X real minutes
  qScale: number; // demo m³/s -> real m³/s at gauges
  lenScale: number; // demo metre -> real metre downstream
  areaScale: number; // demo m² flooded -> real km²
  buildingScale: number; // flooded demo buildings -> real estimate
  popScale: number; // demo people -> real estimate
  villages: VillageDef[];
  shelters: ShelterDef[];
  infra: InfraDef[];
}

export const DAMS: Record<DamId, DamProfile> = {
  idukki: {
    id: 'idukki',
    name: 'Idukki',
    river: 'Periyar',
    state: 'Kerala, India',
    damType: 'Concrete double-curvature arch dam',
    heightM: 168.91,
    lengthM: 365.85,
    frlM: 1683.39,
    mwlM: 1685.09,
    minDrawdownM: 1652.0,
    grossStorageMm3: 1996,
    spillway: '7 radial gates · Cheruthoni spillway · ≈ 7,450 m³/s',
    coords: [9.8425, 76.9733],
    timeMinPerSec: 2,
    qScale: 22,
    lenScale: 260,
    areaScale: 0.00042,
    buildingScale: 210,
    popScale: 460,
    villages: [
      { name: 'Cheruthoni', x: 74, z: -14, pop: 6200 },
      { name: 'Painavu', x: 98, z: 0, pop: 9400 },
      { name: 'Kulamavu', x: 128, z: 8, pop: 5100 },
      { name: 'Kattappana', x: 140, z: 30, pop: 12800 },
      { name: 'Thadiyampad', x: 84, z: 20, pop: 3600 },
      { name: 'Valara', x: 118, z: -16, pop: 2400 },
    ],
    shelters: [
      { name: 'Hilltop Government School', x: 66, z: 52, capacity: 800 },
      { name: 'Painavu Community Hall', x: 118, z: 56, capacity: 650 },
      { name: 'Kulamavu Temple Ground', x: 148, z: 46, capacity: 500 },
    ],
    infra: [
      { kind: 'hospital', name: 'Cheruthoni Taluk Hospital', x: 122, z: 10 },
      { kind: 'school', name: 'St. George HS', x: 84, z: 12 },
      { kind: 'school', name: 'Kulamavu UPS', x: 134, z: -4 },
      { kind: 'bridge', name: 'Periyar Bridge', x: 124, z: -42 },
      { kind: 'substation', name: 'Painavu 110 kV S/S', x: 126, z: 26 },
      { kind: 'waterworks', name: 'Cheruthoni WTP', x: 62, z: -34 },
    ],
  },
  mullaperiyar: {
    id: 'mullaperiyar',
    name: 'Mullaperiyar',
    river: 'Periyar (headwaters)',
    state: 'Kerala / Tamil Nadu',
    damType: 'Masonry gravity dam (limestone surkhi)',
    heightM: 53.16,
    lengthM: 365.76,
    frlM: 43.28, // 142 ft
    mwlM: 44.5,
    minDrawdownM: 36.6, // 120 ft
    grossStorageMm3: 443,
    spillway: '3 spillway bays · ≈ 3,300 m³/s (reference)',
    coords: [9.5267, 77.1581],
    timeMinPerSec: 1,
    qScale: 6,
    lenScale: 90,
    areaScale: 0.00012,
    buildingScale: 65,
    popScale: 150,
    villages: [
      { name: 'Vallakkadavu', x: 74, z: -14, pop: 2100 },
      { name: 'Kumily', x: 98, z: 0, pop: 14800 },
      { name: 'Vandiperiyar', x: 128, z: 8, pop: 12600 },
      { name: 'Kakki', x: 140, z: 30, pop: 3100 },
      { name: 'Gavi', x: 84, z: 20, pop: 900 },
      { name: 'Periyar Estate', x: 118, z: -16, pop: 1200 },
    ],
    shelters: [
      { name: 'Vallakkadavu School', x: 66, z: 52, capacity: 400 },
      { name: 'Kumily Community Hall', x: 118, z: 56, capacity: 900 },
      { name: 'Vandiperiyar Temple Ground', x: 148, z: 46, capacity: 550 },
    ],
    infra: [
      { kind: 'hospital', name: 'Vandiperiyar PHC', x: 122, z: 10 },
      { kind: 'school', name: 'Kumily GHSS', x: 84, z: 12 },
      { kind: 'school', name: 'Kulamavu UPS', x: 134, z: -4 },
      { kind: 'bridge', name: 'Periyar Footbridge', x: 124, z: -42 },
      { kind: 'substation', name: 'Kumily 66 kV S/S', x: 126, z: 26 },
      { kind: 'waterworks', name: 'Vandiperiyar WTP', x: 62, z: -34 },
    ],
  },
};

// ---- demo-world fixed layout (shared by both dams; geometry is the scaled twin)
// Gauge columns run across the corridor/floodplain of the square canvas:
// G1 at the dam toe, G2/G3 through the city reach, G4 at the downstream plain.
export const GAUGES = [
  { id: 'G1', label: 'Dam toe', x: 52, z: -45 },
  { id: 'G2', label: 'Bridge site', x: 72, z: -42 },
  { id: 'G3', label: 'Village reach', x: 94, z: -38 },
  { id: 'G4', label: 'Downstream town', x: 118, z: -33 },
] as const;

export const SCENARIO_DEFAULTS = {
  levelFrac: 0.82,
  mechanism: 'structural' as FailureMechanism,
  breachWidthM: 100, // real metres
  formationMin: 30, // real minutes
  location: 'center' as BreachLocation,
  durationMin: 360, // real minutes
  rain: 'moderate' as RainScenario,
};

export const RAIN_FACTORS: Record<RainScenario, { inflow: number; label: string }> = {
  none: { inflow: 0, label: 'No rainfall' },
  moderate: { inflow: 26, label: 'Moderate (25 mm/6 h)' },
  heavy: { inflow: 64, label: 'Heavy (110 mm/6 h)' },
};

export const MECHANISM_LABEL: Record<FailureMechanism, string> = {
  overtopping: 'Overtopping — flood surcharge above crest erodes the crest section',
  piping: 'Piping / internal erosion — seepage pipe develops through the body',
  structural: 'Structural breach — sudden monolith failure at the selected location',
};

// ---- reservoir level mapping (frac 0..1 -> demo sim elevation)
export const SIM_LEVEL_MIN = 15.2; // demo m
export const SIM_LEVEL_MAX = 22.7; // demo m (crest = 23)
export const SIM_LEVEL_MAX_SCENARIO = 24.3; // allows overtopping scenarios

export function fracToSimLevel(frac: number): number {
  return SIM_LEVEL_MIN + frac * (SIM_LEVEL_MAX - SIM_LEVEL_MIN);
}
export function simLevelToFrac(level: number): number {
  return Math.min(Math.max((level - SIM_LEVEL_MIN) / (SIM_LEVEL_MAX - SIM_LEVEL_MIN), 0), 1.1);
}

// demo elevation -> real elevation (m a.s.l.)
export function simToRealLevel(dam: DamProfile, simLevel: number): number {
  const frac = simLevelToFrac(simLevel);
  return dam.minDrawdownM + frac * (dam.frlM - dam.minDrawdownM);
}

// storage % curve (frac shaped — deeper basin at low levels)
export function storagePercent(frac: number): number {
  const f = Math.min(Math.max(frac, 0), 1);
  return Math.round(100 * (0.04 + 0.96 * Math.pow(f, 1.18)));
}

export function fmtRealTime(min: number): string {
  if (!isFinite(min) || min < 0) return '—';
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h} h ${m.toString().padStart(2, '0')} min`;
}

export function fmtNum(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString('en-IN');
}
