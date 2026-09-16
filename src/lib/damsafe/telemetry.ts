// DAMSAFE 3D — server-side telemetry store (singleton on globalThis).
//
// One ingest service, two packet sources, one consumer contract:
//   • HARDWARE  — real ESP32 nodes POST JSON to /api/telemetry (Phase 1 pipeline)
//   • SIMULATOR — while hardware is silent (>12 s) the store synthesises
//     physically-plausible packets from the digital twin's own state, which the
//     browser twin keeps pushing via POST /api/telemetry/state. This exercises
//     the exact production data path (store → SSE → UI → 3D → risk engine)
//     without pretending real sensors exist.
//
// Multi-dam readiness (Phase 2): everything is keyed by dam id, and every node
// that has ever reported is kept in a per-dam registry the UI can list.

import {
  type TelemetryPacket, type SensorValues, type TwinStateSnapshot,
  parsePacket, simulatePacket, mergeSensors, HW_TIMEOUT_MS,
} from './sensors';

const HISTORY_MAX = 180;

interface DamChannel {
  seq: number;
  latest: TelemetryPacket | null;
  history: TelemetryPacket[];
  hardwareLastSeen: number; // ms epoch of last real hardware packet
  nodes: Map<string, { node: string; at: number; bat: number; rssi: number; packets: number }>;
  twin: TwinStateSnapshot | null;
}

interface TelemetryState {
  chans: Map<string, DamChannel>;
  clients: Set<(p: TelemetryPacket) => void>;
  loop: ReturnType<typeof setInterval> | null;
  loopRefs: number;
}

const g = globalThis as unknown as { __damsafeTelemetry?: TelemetryState };

function state(): TelemetryState {
  if (!g.__damsafeTelemetry) {
    g.__damsafeTelemetry = { chans: new Map(), clients: new Set(), loop: null, loopRefs: 0 };
  }
  return g.__damsafeTelemetry;
}

function channel(dam: string): DamChannel {
  const s = state();
  let c = s.chans.get(dam);
  if (!c) {
    c = { seq: 0, latest: null, history: [], hardwareLastSeen: 0, nodes: new Map(), twin: null };
    s.chans.set(dam, c);
  }
  return c;
}

function publish(p: TelemetryPacket): void {
  const s = state();
  for (const cb of s.clients) {
    try {
      cb(p);
    } catch {
      /* a dead SSE client must never break the pipeline */
    }
  }
}

function storePacket(p: TelemetryPacket): void {
  const c = channel(p.dam);
  c.seq = Math.max(c.seq, p.seq) + 0;
  c.latest = p;
  c.history.push(p);
  if (c.history.length > HISTORY_MAX) c.history.shift();
  if (p.source === 'hardware') {
    c.hardwareLastSeen = p.at;
    const n = c.nodes.get(p.node);
    c.nodes.set(p.node, {
      node: p.node,
      at: p.at,
      bat: p.bat,
      rssi: p.rssi,
      packets: (n?.packets ?? 0) + 1,
    });
  }
  publish(p);
}

/**
 * 1 Hz heartbeat. On each tick a dam channel either relays fresh hardware
 * packets as they arrive (push already happened) or emits one simulator packet
 * derived from the twin state. The loop lives on globalThis so dev-server
 * module reloads cannot spawn duplicates.
 */
function ensureLoop(): void {
  const s = state();
  if (s.loop) return;
  s.loop = setInterval(() => {
    for (const [dam, c] of s.chans) {
      const hwFresh = Date.now() - c.hardwareLastSeen < HW_TIMEOUT_MS;
      if (hwFresh) continue; // real hardware owns this channel right now
      // Twin state older than 30 s (browser closed) → coast on last known level.
      const p = simulatePacket(c.twin, dam, ++c.seq);
      storePacket(p);
    }
  }, 1000);
  // never keep the process alive just for the heartbeat
  (s.loop as unknown as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------- public API

/** Ingest one raw ESP32 body. Returns the stored packet, or null if invalid. */
export function ingestHardware(body: unknown, fallbackDam: string): TelemetryPacket | null {
  const c0 = channel(fallbackDam);
  const p = parsePacket(body, fallbackDam, ++c0.seq);
  if (!p) return null;
  // merge over previous values so partial packets never blank live channels
  const merged: SensorValues = mergeSensors(c0.latest?.source === 'hardware' ? c0.latest.sensors : undefined, p.sensors);
  storePacket({ ...p, sensors: merged });
  ensureLoop();
  return p;
}

/** Browser twin pushes its solver state; the simulator mirrors it into sensors. */
export function pushTwinState(dam: string, twin: Omit<TwinStateSnapshot, 'at'>): void {
  const c = channel(dam);
  c.twin = { ...twin, at: Date.now() };
  ensureLoop();
}

/** Latest packet + derived metadata for one dam (JSON snapshot for polling). */
export function snapshot(dam: string) {
  const c = channel(dam);
  const hwFresh = c.latest?.source === 'hardware' && Date.now() - c.hardwareLastSeen < HW_TIMEOUT_MS;
  return {
    dam,
    source: hwFresh ? 'hardware' : 'simulator',
    hardwareOnline: Date.now() - c.hardwareLastSeen < HW_TIMEOUT_MS,
    latest: c.latest,
    packets: c.history.length,
    nodes: [...c.nodes.values()].sort((a, b) => b.at - a.at),
    twinFresh: !!c.twin && Date.now() - c.twin.at < 30_000,
  };
}

/** Subscribe to every packet (any dam). Returns an unsubscribe function. */
export function subscribe(cb: (p: TelemetryPacket) => void): () => void {
  const s = state();
  s.clients.add(cb);
  ensureLoop();
  return () => {
    s.clients.delete(cb);
  };
}

/** Recent history for sparklines (oldest → newest). */
export function history(dam: string, n = HISTORY_MAX): TelemetryPacket[] {
  const c = channel(dam);
  return c.history.slice(-n);
}

/** Dam ids this server process has seen (multi-dam / cascade registry). */
export function knownDams(): string[] {
  return [...state().chans.keys()];
}
