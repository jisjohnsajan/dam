// DAMSAFE 3D — live telemetry stream (Server-Sent Events).
//
//   GET /api/telemetry/stream?dam=idukki
//
// Emits: `event: packet` JSON frames at the ingestion cadence (~1 Hz) plus a
// `: ping` comment every 15 s so proxies keep the connection open. The browser
// twin consumes this with EventSource — same production path real hardware
// traffic flows through.

import { NextRequest } from 'next/server';
import { snapshot, subscribe } from '@/lib/damsafe/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dam = req.nextUrl.searchParams.get('dam') ?? 'idukki';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // initial snapshot so the UI renders instantly on (re)connect
      send('snapshot', snapshot(dam));

      const unsub = subscribe((p) => {
        if (p.dam !== dam) return;
        send('packet', p);
      });

      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          closed = true;
        }
      }, 15_000);
      (ping as unknown as { unref?: () => void }).unref?.();

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
