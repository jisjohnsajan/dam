'use client';

// DAMSAFE 3D — interactive 2D situation map with zoom & pan.
// Background: solver terrain (bedAt/terrainColor), live water extent from the
// GPU downsample, dam + villages + gauges + ESP32 sensor markers (blinking on
// warn/alarm). Click a sensor/village to fly the 3D camera to it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { bedAt, terrainColor, LX, LZ, DAM_X } from '@/lib/dam/terrain';
import { DAMS, GAUGES, type DamId } from '@/lib/damsafe/config';
import type { SensorMarkerDef } from '@/lib/dam/engine';
import { Minus, Plus, Maximize2, Map as MapIcon } from 'lucide-react';

const W = 272; // css px — fits the 280px right-hand column
const H = 160;
const TERRAIN_PX = 2; // offscreen px per world metre (384×224)

interface View {
  cx: number; // world x at canvas centre
  cz: number;
  scale: number; // css px per world metre
}

export function Minimap({
  damId,
  sensors,
  getFlow,
  onFocus,
}: {
  damId: DamId;
  sensors: SensorMarkerDef[];
  getFlow: () => { data: Float32Array; w: number; h: number } | null;
  onFocus: (x: number, z: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ cx: 105, cz: 0, scale: W / (LX + 30) });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const [zoomLabel, setZoomLabel] = useState(1);

  // ---- static terrain layer (built once, client-only — SSR has no canvas)
  useEffect(() => {
    const cv = document.createElement('canvas');
    cv.width = LX * TERRAIN_PX;
    cv.height = LZ * TERRAIN_PX;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cv.width, cv.height);
    const out = { r: 0, g: 0, b: 0 };
    for (let py = 0; py < cv.height; py++) {
      const z = (py + 0.5) / TERRAIN_PX - LZ / 2;
      for (let px = 0; px < cv.width; px++) {
        const x = (px + 0.5) / TERRAIN_PX;
        const b = bedAt(x, z);
        const slope =
          (Math.abs(bedAt(x + 0.9, z) - bedAt(x - 0.9, z)) +
            Math.abs(bedAt(x, z + 0.9) - bedAt(x, z - 0.9))) / 2;
        terrainColor(x, z, b, slope, out);
        const k = (py * cv.width + px) * 4;
        img.data[k] = out.r * 255;
        img.data[k + 1] = out.g * 255;
        img.data[k + 2] = out.b * 255;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    terrainRef.current = cv;
  }, []);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== W * dpr) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const v = viewRef.current;
    const proj = (x: number, z: number): [number, number] => [
      (x - v.cx) * v.scale + W / 2,
      (z - v.cz) * v.scale + H / 2,
    ];

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#060b14';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.cx, -v.cz);

    // terrain
    if (terrainRef.current) ctx.drawImage(terrainRef.current, 0, 0, LX, LZ);

    // live water from the solver downsample (layout: eta, u, v, h per cell)
    const flow = getFlow();
    if (flow) {
      const cw = LX / flow.w;
      const ch = LZ / flow.h;
      for (let j = 0; j < flow.h; j++) {
        for (let i = 0; i < flow.w; i++) {
          const k = (j * flow.w + i) * 4;
          const h = flow.data[k + 3];
          if (h <= 0.12) continue;
          const a = Math.min(0.25 + h * 0.07, 0.8);
          ctx.fillStyle = h > 3.5 ? `rgba(10,52,128,${a})` : `rgba(56,150,220,${a})`;
          ctx.fillRect(i * cw, -LZ / 2 + j * ch, cw + 0.02, ch + 0.02);
        }
      }
    }

    // dam wall
    ctx.fillStyle = '#e8e4da';
    ctx.fillRect(DAM_X, -14, 8.6, 44);

    ctx.restore();

    // ---- screen-space overlays
    const dam = DAMS[damId];

    // villages
    ctx.font = '8.5px ui-sans-serif, system-ui';
    for (const vil of dam.villages) {
      const [sx, sy] = proj(vil.x, vil.z);
      ctx.fillStyle = 'rgba(240,230,190,0.95)';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (v.scale > 1.55) {
        ctx.fillStyle = 'rgba(235,240,250,0.82)';
        ctx.textAlign = 'center';
        ctx.fillText(vil.name, sx, sy - 4.5);
      }
    }

    // gauges
    for (const g of GAUGES) {
      const [sx, sy] = proj(g.x, g.z);
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 3.4);
      ctx.lineTo(sx + 3, sy + 2.4);
      ctx.lineTo(sx - 3, sy + 2.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(34,211,238,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText(g.id, sx, sy + 10);
    }

    // inflow arrow at the gorge
    {
      const [sx, sy] = proj(6, 0);
      ctx.strokeStyle = 'rgba(103,232,249,0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy);
      ctx.lineTo(sx + 7, sy);
      ctx.moveTo(sx + 3, sy - 3);
      ctx.lineTo(sx + 7, sy);
      ctx.lineTo(sx + 3, sy + 3);
      ctx.stroke();
    }

    // sensors — blinking halo on warn/alarm
    const t = performance.now() / 1000;
    for (const s of sensors) {
      const [sx, sy] = proj(s.x, s.z);
      const col = s.state === 'alarm' ? '#ff4d4d' : s.state === 'warn' ? '#fbbf24' : '#34d399';
      if (s.state !== 'ok') {
        const pulse = 0.45 + 0.55 * Math.pow(Math.sin(t * (s.state === 'alarm' ? 9 : 5)) * 0.5 + 0.5, 2);
        ctx.fillStyle = s.state === 'alarm' ? `rgba(255,77,77,${0.3 * pulse})` : `rgba(251,191,36,${0.28 * pulse})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(4,10,20,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (v.scale > 1.1) {
        ctx.fillStyle = 'rgba(226,243,255,0.92)';
        ctx.textAlign = 'center';
        ctx.fillText(s.id, sx, sy - 5.6);
      }
    }

    // viewport frame hint (world bounds)
    const [bx, by] = proj(0, -LZ / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, LX * v.scale, LZ * v.scale);

    // scale bar (real-world km via the dam's length scale)
    const barWorld = 40; // demo metres
    const km = (barWorld * dam.lenScale) / 1000;
    const [x0, y0] = proj(v.cx - barWorld / 2, v.cz + LZ / 2 - 4);
    const px = barWorld * v.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + px, y0);
    ctx.moveTo(x0, y0 - 3);
    ctx.lineTo(x0, y0 + 3);
    ctx.moveTo(x0 + px, y0 - 3);
    ctx.lineTo(x0 + px, y0 + 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(`${km.toFixed(1)} km`, x0 + px / 2, y0 - 5);
  }, [damId, getFlow, sensors]);

  // redraw loop ~10 Hz (smooth blink, cheap draws)
  useEffect(() => {
    const iv = setInterval(draw, 100);
    return () => clearInterval(iv);
  }, [draw]);

  // ---- interaction
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const v = viewRef.current;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left - W / 2;
    const my = e.clientY - rect.top - H / 2;
    const wx = v.cx + mx / v.scale;
    const wz = v.cz + my / v.scale;
    const next = Math.min(Math.max(v.scale * Math.exp(-e.deltaY * 0.0012), 0.7), 9);
    v.cx = wx - mx / next;
    v.cz = wz - my / next;
    v.scale = next;
    setZoomLabel(Math.round(next * 10) / 10);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    const v = viewRef.current;
    v.cx -= dx / v.scale;
    v.cz -= dy / v.scale;
    d.x = e.clientX;
    d.y = e.clientY;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || d.moved) return;
      // click: hit-test sensors then villages, fly the 3D camera there
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const hit = (x: number, z: number, r = 9) => {
        const sx = (x - v.cx) * v.scale + W / 2;
        const sy = (z - v.cz) * v.scale + H / 2;
        return Math.hypot(sx - mx, sy - my) <= r;
      };
      for (const s of sensors) {
        if (hit(s.x, s.z)) {
          onFocus(s.x, s.z);
          return;
        }
      }
      for (const vil of DAMS[damId].villages) {
        if (hit(vil.x, vil.z, 7)) {
          onFocus(vil.x, vil.z);
          return;
        }
      }
    },
    [damId, onFocus, sensors],
  );

  const zoomBy = (f: number) => {
    const v = viewRef.current;
    v.scale = Math.min(Math.max(v.scale * f, 0.7), 9);
    setZoomLabel(Math.round(v.scale * 10) / 10);
  };
  const resetView = () => {
    viewRef.current = { cx: 105, cz: 0, scale: W / (LX + 30) };
    setZoomLabel(1);
  };

  return (
    <div ref={wrapRef} className="pointer-events-auto rounded-lg border border-cyan-100/10 bg-[#0a1526]/92 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/5 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">
          <MapIcon className="h-3 w-3" /> Situation map · {DAMS[damId].name}
        </span>
        <span className="font-mono text-[8.5px] text-slate-500">×{zoomLabel.toFixed(1)}</span>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          style={{ width: W, height: H }}
          className="block cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { dragRef.current = null; }}
          onDoubleClick={resetView}
          aria-label="Interactive situation map — scroll to zoom, drag to pan, click markers to focus the 3D view"
        />
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1">
          <button
            aria-label="Zoom in"
            onClick={() => zoomBy(1.3)}
            className="flex h-6 w-6 items-center justify-center rounded border border-white/15 bg-black/55 text-slate-200 backdrop-blur hover:bg-black/75"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.3)}
            className="flex h-6 w-6 items-center justify-center rounded border border-white/15 bg-black/55 text-slate-200 backdrop-blur hover:bg-black/75"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            aria-label="Reset view"
            onClick={resetView}
            className="flex h-6 w-6 items-center justify-center rounded border border-white/15 bg-black/55 text-slate-200 backdrop-blur hover:bg-black/75"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
