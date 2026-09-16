// DAMSAFE 3D — IoT sensor network definitions & telemetry packet contract.
//
// The deployed hardware (Phase 1): one ESP32 master node at the dam site polls
// 6 sensors and POSTs a JSON packet to /api/telemetry every second:
//
//   {
//     "dam":  "idukki",              // dam namespace (multi-dam ready, Phase 2)
//     "node": "esp32-dam-01",        // master node id
//     "sensors": {
//       "level": 21.4,             // S1 JSN-SR04T ultrasonic, reservoir stage (demo m)
//       "inflowV": 1.8,            // S2 inflow velocity, gorge channel (m/s)
//       "pressure": 9.6,           // S3 submerged transducer head (m of water)
//       "strain": 241.5,           // S4 strain gauge on dam wall (micro-strain)
//       "tilt": 0.62,              // S5 crest tiltmeter (mrad)
//       "seepage": 5.1             // S6 foundation piezometer / seepage weir (L/min)
//     },
//     "bat": 3.94,                 // node supply voltage (V)
//     "rssi": -63                  // Wi-Fi RSSI (dBm)
//   }
//
// Every field except dam/node is optional in a packet, so a partially wired
// rig streams only the channels it actually has. When no hardware has been
// heard from for >12 s the ingestion service synthesises packets from the
// digital twin's own solver state (EMBEDDED SIMULATOR) so the monitoring UI,
// 3D markers and risk engine always exercise the exact production data path.

// Sensor positions live in the solver's demo world: x < 112 (dam face) =
// upstream reservoir reach, x ≥ 112 = dam wall & downstream valley.

export type SensorKind = 'reservoir' | 'structure';
export type SensorState = 'ok' | 'warn' | 'alarm';

export interface SensorDef {
  id: string;
  name: string;
  hardware: string;
  kind: SensorKind;
  unit: string;
  // demo-world position (metres, solver coordinates)
  x: number;
  z: number;
  // operational thresholds (in sensor units)
  warn: number;
  alarm: number;
  // plausible baseline + span for the embedded simulator
  base: number;
  span: number;
  desc: string;
}

// ---------------------------------------------------------------- sensor layout
// 3 reservoir / underwater sensors + 3 dam-wall & bedding sensors, mapped into
// the demo solver world so their 3D markers and map pins sit on real geometry.
export const SENSORS: SensorDef[] = [
  {
    id: 'S1', name: 'Reservoir stage', hardware: 'JSN-SR04T ultrasonic',
    kind: 'reservoir', unit: 'm', x: 46, z: 2,
    warn: 21.9, alarm: 22.6, base: 21.5, span: 0.05,
    desc: 'Water-surface elevation in the upstream reach (stage).',
  },
  {
    id: 'S2', name: 'Inflow velocity', hardware: 'Submerged Doppler probe',
    kind: 'reservoir', unit: 'm/s', x: 10, z: 0,
    warn: 2.4, alarm: 3.4, base: 0.9, span: 0.35,
    desc: 'River inflow speed through the upstream gorge channel.',
  },
  {
    id: 'S3', name: 'Dam-face pressure', hardware: 'Submersible pressure transducer',
    kind: 'reservoir', unit: 'mH₂O', x: 103, z: -7,
    warn: 9.4, alarm: 10.6, base: 9.2, span: 0.04,
    desc: 'Hydrostatic head on the upstream face near the heel.',
  },
  {
    id: 'S4', name: 'Wall strain', hardware: 'Vibrating-wire strain gauge',
    kind: 'structure', unit: 'με', x: 114.6, z: -6,
    warn: 320, alarm: 430, base: 228, span: 3.5,
    desc: 'Concrete compressive strain mid-height on the dam wall.',
  },
  {
    id: 'S5', name: 'Crest tilt', hardware: 'MEMS biaxial tiltmeter',
    kind: 'structure', unit: 'mrad', x: 113.2, z: 4.5,
    warn: 1.4, alarm: 2.2, base: 0.55, span: 0.03,
    desc: 'Structural rotation / micro-movement at the crest.',
  },
  {
    id: 'S6', name: 'Foundation seepage', hardware: 'Piezometer + weir',
    kind: 'structure', unit: 'L/min', x: 121.5, z: 2,
    warn: 14, alarm: 26, base: 4.6, span: 0.25,
    desc: 'Seepage through the foundation bedding and uplift drain.',
  },
];

export const SENSOR_BY_ID: Record<string, SensorDef> = Object.fromEntries(
  SENSORS.map((s) => [s.id, s]),
);

// ---------------------------------------------------------------- packet types
export interface SensorValues {
  level?: number;   // S1 demo metres
  inflowV?: number; // S2 m/s
  pressure?: number;// S3 mH₂O
  strain?: number;  // S4 με
  tilt?: number;    // S5 mrad
  seepage?: number; // S6 L/min
}

export interface TelemetryPacket {
  dam: string;
  node: string;
  at: number;            // server receive time (ms epoch)
  seq: number;           // monotonically increasing per dam
  source: 'hardware' | 'simulator';
  sensors: SensorValues; // complete — simulator fills gaps, hardware partials are merged
  bat: number;           // V
  rssi: number;          // dBm
}

/** sensor id → SensorValues channel key (S1 → 'level', …) */
export const CHANNEL_KEY: Record<string, keyof SensorValues> = {
  S1: 'level',
  S2: 'inflowV',
  S3: 'pressure',
  S4: 'strain',
  S5: 'tilt',
  S6: 'seepage',
};

export interface TwinStateSnapshot {
  levelFrac: number; // 0..1
  level: number;     // demo m
  inflow: number;    // demo m³/s through the gorge
  qOut: number;      // demo m³/s at dam toe
  breach01: number;  // 0 intact .. 1 fully breached
  vmax: number;      // demo m/s
  at: number;        // ms epoch
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined;

/** Validate + normalise a raw ESP32 JSON body. Returns null when unusable. */
export function parsePacket(body: unknown, damId: string, seq: number): TelemetryPacket | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const raw = (b.sensors && typeof b.sensors === 'object' ? b.sensors : b) as Record<string, unknown>;
  const sensors: SensorValues = {};
  let any = false;
  const pick = (key: keyof SensorValues) => {
    const v = num(raw[key]);
    if (v !== undefined) {
      sensors[key] = v;
      any = true;
    }
  };
  pick('level'); pick('inflowV'); pick('pressure'); pick('strain'); pick('tilt'); pick('seepage');
  if (!any) return null;
  return {
    dam: typeof b.dam === 'string' && b.dam ? b.dam : damId,
    node: typeof b.node === 'string' && b.node ? b.node.slice(0, 32) : 'esp32-unknown',
    at: Date.now(),
    seq,
    source: 'hardware',
    sensors,
    bat: num(b.bat) ?? 3.9,
    rssi: num(b.rssi) ?? -70,
  };
}

/** Threshold evaluation — drives blinking 3D markers, map pins and the risk engine. */
export function evaluateStates(p: TelemetryPacket): Record<string, SensorState> {
  const out: Record<string, SensorState> = {};
  for (const s of SENSORS) {
    const v = p.sensors[CHANNEL_KEY[s.id]];
    if (v === undefined) {
      out[s.id] = 'ok';
      continue;
    }
    out[s.id] = v >= s.alarm ? 'alarm' : v >= s.warn ? 'warn' : 'ok';
  }
  return out;
}

/**
 * Embedded simulator: synthesise a physically-plausible packet from the live
 * digital-twin state. The twin's own level, inflow, breach progress and
 * outflow drive the sensor values (with measurement noise), so simulated
 * hardware always agrees with what the 3D solver is actually doing.
 */
export function simulatePacket(twin: TwinStateSnapshot | null, dam: string, seq: number): TelemetryPacket {
  const t = Date.now() / 1000;
  const wob = (f: number) => Math.sin(t * f) * 0.5 + Math.sin(t * f * 2.7 + 1.3) * 0.5; // -1..1
  const frac = twin ? Math.min(Math.max(twin.levelFrac, 0), 1.1) : 0.84;
  const breach = twin ? twin.breach01 : 0;
  const surge = twin ? Math.min(twin.inflow / 40, 1) : 0;

  // S1 stage: twin level + ultrasonic noise (±1.5 cm)
  const level = (twin ? twin.level : 21.5) + wob(0.7) * 0.015;
  // S2 inflow velocity: base channel flow + rain surge signal
  const inflowV = 0.55 + surge * 2.6 + wob(1.1) * 0.06 + Math.random() * 0.04;
  // S3 hydrostatic head on the face: stage minus heel bed elevation (~11.9)
  const pressure = Math.max(0.2, level - 11.9) + wob(0.5) * 0.012;
  // S4 strain: dead load + hydrostatic load ∝ depth², relieved by a breach
  const strain = 96 + frac * frac * 168 + breach * -34 + wob(1.7) * 1.6;
  // S5 tilt: creep with load, kicks visibly when the wall is failing
  const tilt = 0.32 + frac * 0.28 + breach * breach * 2.4 + wob(0.9) * 0.012;
  // S6 seepage: grows steeply with head; a forming pipe surges the drain flow
  const seepage = 1.4 + Math.pow(frac, 3) * 9.5 + breach * 17 + wob(1.3) * 0.14;

  return {
    dam,
    node: 'damsafe-sim-01',
    at: Date.now(),
    seq,
    source: 'simulator',
    sensors: {
      level,
      inflowV: Math.max(0, inflowV),
      pressure,
      strain,
      tilt: Math.max(0, tilt),
      seepage: Math.max(0, seepage),
    },
    bat: 3.92 + wob(0.05) * 0.05,
    rssi: -58 + Math.round(wob(0.23) * 6),
  };
}

/** Merge an incoming hardware packet over the previous one (partials allowed). */
export function mergeSensors(prev: SensorValues | undefined, next: SensorValues): SensorValues {
  if (!prev) return { ...next };
  return { ...prev, ...next };
}

export const HW_TIMEOUT_MS = 12_000; // hardware considered offline after this silence
