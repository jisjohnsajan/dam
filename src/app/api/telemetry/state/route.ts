// DAMSAFE 3D — digital-twin state push (browser → ingestion service).
//
//   POST /api/telemetry/state   { dam, levelFrac, level, inflow, qOut, breach01, vmax }
//
// The browser twin pushes its solver state every ~2 s. The embedded sensor
// simulator consumes this to synthesise physically-consistent ESP32 packets
// while no real hardware is reporting — simulated sensors always agree with
// what the 3D solver is actually doing.

import { NextRequest, NextResponse } from 'next/server';
import { pushTwinState } from '@/lib/damsafe/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const dam = typeof body.dam === 'string' && body.dam ? body.dam : 'idukki';
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  pushTwinState(dam, {
    levelFrac: n(body.levelFrac),
    level: n(body.level),
    inflow: n(body.inflow),
    qOut: n(body.qOut),
    breach01: n(body.breach01),
    vmax: n(body.vmax),
  });
  return NextResponse.json({ ok: true });
}
