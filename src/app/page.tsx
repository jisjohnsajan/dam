'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DamSim, type CamPreset, type DamStats } from '@/lib/dam/engine';
import { ControlPanel, StatsPanel, SpeedLegend, type ControlState } from '@/components/dam/panels';
import { Button } from '@/components/ui/button';
import {
  Mountain, Film, Pause, Play, ChevronLeft, ChevronRight, AlertTriangle, BarChart3, SlidersHorizontal,
} from 'lucide-react';

const CAMS: { id: CamPreset; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dam', label: 'Dam face' },
  { id: 'valley', label: 'Valley' },
  { id: 'top', label: 'Top view' },
];

export default function Page() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<DamSim | null>(null);
  const hydroRef = useRef<{ t: number; q: number }[]>([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DamStats | null>(null);
  const [hydro, setHydro] = useState<{ t: number; q: number }[]>([]);

  const [ctrl, setCtrl] = useState<ControlState>({
    timeScale: 1,
    paused: false,
    gravity: '9.81',
    inflow: 8,
    breachRate: 1,
    foam: true,
    spray: true,
    speedMap: false,
    sound: false,
    overtopping: false,
  });
  const [cinematic, setCinematic] = useState(false);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 900,
  );

  // ---- engine lifecycle
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let eng: DamSim | null = null;
    const id = setTimeout(() => {
      try {
        eng = new DamSim(el);
        eng.onStats = (s) => {
          setReady(true);
          setStats(s);
          const h = hydroRef.current;
          h.push({ t: s.t, q: s.q });
          if (h.length > 400) h.shift();
          if (s.t % 1 < 0.2) setHydro([...h]);
        };
        eng.onError = (m) => setError(m);
        engineRef.current = eng;
        // fallback: never keep the loading overlay stuck (e.g. throttled rAF)
        setTimeout(() => setReady(true), 800);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 0);
    return () => {
      clearTimeout(id);
      eng?.dispose();
      engineRef.current = null;
    };
  }, []);

  const patch = useCallback((p: Partial<ControlState>) => {
    setCtrl((prev) => {
      const next = { ...prev, ...p };
      const eng = engineRef.current;
      if (eng) {
        if (p.timeScale !== undefined) eng.setTimeScale(next.timeScale);
        if (p.gravity !== undefined) eng.setGravity(parseFloat(next.gravity));
        if (p.inflow !== undefined) eng.setInflow(next.inflow);
        if (p.breachRate !== undefined) eng.setBreachRate(next.breachRate);
        if (p.foam !== undefined || p.spray !== undefined) {
          eng.setFoam(next.foam);
          eng.setSpray(next.spray);
        }
        if (p.speedMap !== undefined) eng.setSpeedMap(next.speedMap);
        if (p.sound !== undefined) eng.setSound(next.sound);
      }
      return next;
    });
  }, []);

  const onBreak = useCallback(() => engineRef.current?.breakDam(), []);
  const onGates = useCallback(() => engineRef.current?.openGates(), []);
  const onOvertop = useCallback(() => {
    const v = engineRef.current?.toggleOvertopping() ?? false;
    setCtrl((p) => ({ ...p, overtopping: v }));
  }, []);
  const onReset = useCallback(() => {
    engineRef.current?.reset();
    hydroRef.current = [];
    setHydro([]);
    setCtrl((p) => ({ ...p, overtopping: false }));
  }, []);

  const togglePause = useCallback(() => {
    setCtrl((p) => {
      engineRef.current?.setPaused(!p.paused);
      return { ...p, paused: !p.paused };
    });
  }, []);

  const toggleCinematic = useCallback(() => {
    setCinematic((c) => {
      engineRef.current?.setCinematic(!c);
      return !c;
    });
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-zinc-950" aria-label="Interactive 3D dam break simulation">
      {/* 3D canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* cinematic letterbox */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-30 bg-black transition-all duration-700 ${cinematic ? 'h-[7vh]' : 'h-0'}`}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-black transition-all duration-700 ${cinematic ? 'h-[7vh]' : 'h-0'}`}
      />

      {/* left controls */}
      {!cinematic && (
        <div
          className={`absolute left-3 top-3 z-20 transition-transform duration-300 ${showLeft ? 'translate-x-0' : '-translate-x-[110%]'}`}
        >
          <ControlPanel
            state={ctrl}
            onChange={patch}
            onBreak={onBreak}
            onGates={onGates}
            onOvertop={onOvertop}
            onReset={onReset}
          />
        </div>
      )}

      {/* left toggle button (positioned after panel) */}
      {!cinematic && (
        <Button
          variant="outline"
          size="icon"
          aria-label={showLeft ? 'Hide controls' : 'Show controls'}
          onClick={() => setShowLeft((v) => !v)}
          className="absolute top-3 z-20 h-9 w-9 border-white/15 bg-zinc-950/80 text-zinc-300 backdrop-blur-md hover:bg-zinc-900/90"
          style={{ left: showLeft ? 306 : 12 }}
        >
          {showLeft ? <ChevronLeft className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
        </Button>
      )}

      {/* right stats */}
      {!cinematic && (
        <>
          <div
            className={`absolute right-3 top-3 z-20 transition-transform duration-300 ${showRight ? 'translate-x-0' : 'translate-x-[110%]'}`}
          >
            <StatsPanel stats={stats} hydro={hydro} />
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label={showRight ? 'Hide stats' : 'Show stats'}
            onClick={() => setShowRight((v) => !v)}
            className="absolute top-3 z-20 h-9 w-9 border-white/15 bg-zinc-950/80 text-zinc-300 backdrop-blur-md hover:bg-zinc-900/90"
            style={{ right: showRight ? 306 : 12 }}
          >
            {showRight ? <ChevronRight className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
          </Button>
        </>
      )}

      {/* speed legend */}
      {!cinematic && ctrl.speedMap && (
        <div className="absolute bottom-16 left-3 z-20">
          <SpeedLegend />
        </div>
      )}

      {/* bottom bar */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 px-2">
        {CAMS.map((c) => (
          <Button
            key={c.id}
            variant="outline"
            size="sm"
            onClick={() => engineRef.current?.setCamera(c.id)}
            className="h-8 border-white/15 bg-zinc-950/75 px-2.5 text-[11px] text-zinc-200 backdrop-blur-md hover:bg-zinc-800/90"
          >
            <Mountain className="mr-1 h-3 w-3 text-teal-400" />
            {c.label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={togglePause}
          aria-label={ctrl.paused ? 'Resume simulation' : 'Pause simulation'}
          className="h-8 w-8 border-white/15 bg-zinc-950/75 p-0 text-zinc-200 backdrop-blur-md hover:bg-zinc-800/90"
        >
          {ctrl.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleCinematic}
          aria-label="Cinematic orbit view"
          className={`h-8 border-white/15 px-2.5 text-[11px] backdrop-blur-md ${
            cinematic
              ? 'bg-teal-900/80 text-teal-200 hover:bg-teal-800/90'
              : 'bg-zinc-950/75 text-zinc-200 hover:bg-zinc-800/90'
          }`}
        >
          <Film className="mr-1 h-3 w-3" />
          Cinema
        </Button>
      </div>

      {/* hint */}
      {!cinematic && (
        <p className="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2 text-[10px] text-zinc-500">
          Drag to orbit · Scroll to zoom · Right-drag to pan
        </p>
      )}

      {/* exit cinema button */}
      {cinematic && (
        <Button
          variant="outline"
          size="sm"
          onClick={toggleCinematic}
          className="absolute right-4 top-[calc(7vh+12px)] z-40 border-white/15 bg-zinc-950/75 text-[11px] text-zinc-200 backdrop-blur-md hover:bg-zinc-800/90"
        >
          Exit cinema
        </Button>
      )}

      {/* loading / error overlays */}
      {!ready && !error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950">
          <div className="flex flex-col items-center gap-3 text-zinc-300">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
            <p className="text-sm">Building the reservoir…</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/95 p-6">
          <div className="max-w-md rounded-xl border border-red-500/30 bg-red-950/40 p-5 text-center text-zinc-200">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
            <h2 className="mb-2 text-sm font-semibold">WebGL initialization failed</h2>
            <p className="text-xs leading-relaxed text-zinc-400">
              This simulation needs a WebGL2-capable browser with floating-point render targets.
              {error ? ` Detail: ${error}` : ''}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
