// DAMSAFE 3D — ESP32 telemetry ingestion (Phase 1 hardware-software handshake).
//
//   POST /api/telemetry?dam=idukki   ← ESP32 master node, JSON body (1 Hz)
//   GET  /api/telemetry?dam=idukki   ← latest snapshot (poll fallback)
//
// CORS is open so the ESP32 (a different origin) can POST directly.
// Snapshot shape: { ok, dam, source, hardwareOnline, latest, packets, nodes }.

import { NextRequest, NextResponse } from 'next/server';
import { ingestHardware, snapshot } from '@/lib/damsafe/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const dam = req.nextUrl.searchParams.get('dam') ?? 'idukki';
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400, headers: CORS });
  }
  const packet = ingestHardware(body, dam);
  if (!packet) {
    return NextResponse.json(
      { ok: false, error: 'no recognisable sensor channel (level/inflowV/pressure/strain/tilt/seepage)' },
      { status: 422, headers: CORS },
    );
  }
  // The ack doubles as a downstream-command slot for future actuator nodes
  // (gate control is deliberately NOT exposed — monitoring only in Phase 1).
  return NextResponse.json(
    { ok: true, seq: packet.seq, at: packet.at, intervalMs: 1000 },
    { headers: CORS },
  );
}

export async function GET(req: NextRequest) {
  const dam = req.nextUrl.searchParams.get('dam') ?? 'idukki';
  return NextResponse.json({ ok: true, ...snapshot(dam) }, { headers: CORS });
}
