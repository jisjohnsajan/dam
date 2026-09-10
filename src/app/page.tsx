'use client';

/* The "latest ref" mirror pattern below is intentional: the engine stats callback
   is registered once and must read current React state without re-registering. */
/* eslint-disable react-hooks/immutability */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DamSim, type CamPreset, type DamStats, type LayerMode } from '@/lib/dam/engine';
import {
  TopBar, CommandCenter, ScenarioPanel, ImpactPanel, EvacPanel, DataPanel, TwinPanel,
  GaugesPanel, TimelineBar, TABS, type ScenarioForm, type TabId, type UIStats,
} from '@/components/damsafe/panels';
import { Panel, GradientLegend } from '@/components/damsafe/ui';
import { AlertTriangle, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import {
  computeRisk, computeForecast, computeImpact, computeEvac, computeValidation,
  type EvacPlan, type ImpactResult, type RiskResult, type ForecastPoint,
} from '@/lib/damsafe/analysis';
import {
  DAMS, SCENARIO_DEFAULTS, fmtRealTime,
  type DamId,
} from '@/lib/damsafe/config';

const CAMS: { id: CamPreset; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dam', label: 'Dam face' },
  { id: 'reservoir', label: 'Reservoir' },
  { id: 'valley', label: 'Valley' },
  { id: 'top', label: 'Top' },
  { id: 'impact', label: 'Impact' },
];

export default function Page() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<DamSim | null>(null);
  const hydroRef = useRef<{ t: number; q: number }[][]>([[], [], [], []]);
  const tickRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UIStats | null>(null);
  const [hydro, setHydro] = useState<{ t: number; q: number }[]>([[], [], [], []][0]);
  const [gaugeIdx, setGaugeIdx] = useState(0);

  const [damId, setDamId] = useState<DamId>('idukki');
  const [mode, setMode] = useState<'live' | 'scenario'>('live');
  const [tab, setTab] = useState<TabId>('command');

  const [liveFrac, setLiveFrac] = useState(0.84);
  const [form, setForm] = useState<ScenarioForm>({
    levelFrac: SCENARIO_DEFAULTS.levelFrac,
    mechanism: SCENARIO_DEFAULTS.mechanism,
    breachWidthM: SCENARIO_DEFAULTS.breachWidthM,
    formationMin: SCENARIO_DEFAULTS.formationMin,
    location: SCENARIO_DEFAULTS.location,
    durationMin: SCENARIO_DEFAULTS.durationMin,
    rain: SCENARIO_DEFAULTS.rain,
  });
  const [running, setRunning] = useState(false);

  const [layer, setLayer] = useState(0);
  const [hd, setHd] = useState(false);
  const [infra, setInfra] = useState(true);
  const [foam, setFoam] = useState(true);
  const [spray, setSpray] = useState(true);
  const [speedMap, setSpeedMap] = useState(false);
  const [sound, setSound] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const [paused, setPaused] = useState(false);
  const [cinematic, setCinematic] = useState(false);

  const [risk, setRisk] = useState<RiskResult | null>(null);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [evacPlans, setEvacPlans] = useState<EvacPlan[]>([]);
  const [validation, setValidation] = useState<ReturnType<typeof computeValidation> | null>(null);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const [snapInfo, setSnapInfo] = useState<{ count: number; times: number[] }>({ count: 0, times: [] });
  const [iot, setIot] = useState<{ connected: boolean; cm: number; log: string[] }>({ connected: false, cm: 0, log: [] });
  const [showLeft, setShowLeft] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1100);
  const [showRight, setShowRight] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);

  // ---- engine lifecycle
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let eng: DamSim | null = null;
    const id = setTimeout(() => {
      try {
        eng = new DamSim(el);
        eng.onStats = (s: DamStats) => {
          setReady(true);
          setStats(s);
          for (let gi = 0; gi < 4; gi++) {
            const h = hydroRef.current[gi];
            const g = s.gauges[gi];
            if (!g) continue;
            h.push({ t: s.t, q: g.q });
            if (h.length > 700) h.shift();
          }
          tickRef.current++;
          if (tickRef.current % 3 === 0) {
            setHydro([...hydroRef.current[gaugeIdxRef.current]]);
            if (engineRef.current) {
              const down = engineRef.current.getDownsample();
              const prof = engineRef.current.profile;
              const imp = computeImpact(prof, down, down.arr, prof.timeMinPerSec);
              setImpact(imp);
              setEvacPlans(computeEvac(prof, imp).plans);
              setValidation(computeValidation(down));
              setRisk(computeRisk(prof, liveFracRef.current, s.levelFrac, s.riseMPerHr, 8 * prof.qScale, 0));
              setForecast(computeForecast(prof, liveFracRef.current, s.riseMPerHr, 0));
            }
          }
        };
        eng.onError = (m) => setError(m);
        engineRef.current = eng;
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

  // refs mirroring state for the engine stats callback (latest-ref pattern)
  const gaugeIdxRef = useRef(gaugeIdx);
  gaugeIdxRef.current = gaugeIdx;
  const liveFracRef = useRef(liveFrac);
  liveFracRef.current = liveFrac;

  // ---- controls
  const onLevel = useCallback((f: number) => {
    setLiveFrac(f);
    engineRef.current?.setLiveLevel(f);
  }, []);

  const onDam = useCallback((d: DamId) => {
    setDamId(d);
    hydroRef.current = [[], [], [], []];
    setHydro([]);
    engineRef.current?.setDam(d, liveFracRef.current);
  }, []);

  const onLayer = useCallback((m: number) => {
    setLayer(m);
    engineRef.current?.setLayer(m as LayerMode);
  }, []);

  const onRun = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    hydroRef.current = [[], [], [], []];
    setHydro([]);
    setRunning(true);
    setMode('scenario');
    eng.runScenario({
      levelFrac: form.levelFrac,
      mechanism: form.mechanism,
      breachWidthM: form.breachWidthM,
      formationMin: form.formationMin,
      location: form.location,
      rain: form.rain,
    });
    // unlock timeline data
    setTimeout(() => {
      const e2 = engineRef.current;
      if (e2) setSnapInfo({ count: e2.snapCount, times: e2.snapTimes });
    }, 500);
  }, [form]);

  const onReset = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.reset();
    setRunning(false);
    setMode('live');
    setScrubIdx(null);
    setImpact(null);
    setValidation(null);
    setEvacPlans([]);
    setSnapInfo({ count: 0, times: [] });
    hydroRef.current = [[], [], [], []];
    setHydro([]);
  }, []);

  // refresh snapshot list periodically while a scenario runs
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      const e = engineRef.current;
      if (e) setSnapInfo({ count: e.snapCount, times: e.snapTimes });
    }, 2000);
    return () => clearInterval(iv);
  }, [running]);

  const onScrub = useCallback((i: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.scrubTo(i)) setScrubIdx(i);
  }, []);

  const onLive = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.exitScrub();
    setScrubIdx(null);
  }, []);

  const onRoute = useCallback((plan: EvacPlan | null) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (plan) eng.drawEvacRoute(plan.route);
    else eng.clearEvacRoute();
  }, []);

  // ---- IoT ESP32 demo
  useEffect(() => {
    if (!iot.connected) return;
    const iv = setInterval(() => {
      setIot((p) => {
        const cm = Math.min(30, p.cm + 0.45 + Math.random() * 0.3);
        const frac = 0.05 + 0.95 * (cm / 30);
        engineRef.current?.setLiveLevel(Math.min(frac, 1));
        setLiveFrac(Math.min(frac, 1));
        const log = [...p.log, `[MQTT] dam/${damId}/waterlevel ← ${(cm).toFixed(1)} cm`];
        return { ...p, cm, log: log.slice(-24) };
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [iot.connected, damId]);

  const onIot = useCallback((on: boolean) => {
    setIot((p) => ({ connected: on, cm: on ? 4 : 0, log: on ? ['[SYS] ESP32 demo connected · topic dam/#'] : [] }));
    if (!on) onLevel(0.84);
  }, [onLevel]);

  const dam = DAMS[damId];

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#060b14]" aria-label="DAMSAFE 3D dam risk and flood digital twin">
      {/* 3D canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* cinematic letterbox */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 z-30 bg-black transition-all duration-700 ${cinematic ? 'h-[7vh]' : 'h-0'}`} />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-black transition-all duration-700 ${cinematic ? 'h-[7vh]' : 'h-0'}`} />

      {/* top bar */}
      {!cinematic && (
        <TopBar damId={damId} onDam={onDam} mode={mode} onMode={setMode} tab={tab} onTab={setTab} />
      )}

      {/* scrub badge */}
      {scrubIdx !== null && (
        <div className="pointer-events-none absolute left-1/2 top-[86px] z-30 -translate-x-1/2">
          <span className="rounded bg-violet-900/80 px-2 py-1 text-[10px] font-semibold tracking-[0.14em] text-violet-200">
            HISTORICAL FRAME · T+{fmtRealTime((snapInfo.times[scrubIdx] ?? 0) * dam.timeMinPerSec)} · TIME MACHINE
          </span>
        </div>
      )}

      {/* left panel per tab */}
      {!cinematic && (
        <div className={`absolute left-2 top-[112px] z-20 w-[292px] max-w-[calc(100vw-1rem)] transition-transform duration-300 ${showLeft ? 'translate-x-0' : '-translate-x-[110%]'}`}>
          <div className="max-h-[calc(100vh-190px)] overflow-y-auto pr-0.5 damsafe-scroll">
            {tab === 'command' && (
              <CommandCenter damId={damId} stats={stats} liveFrac={liveFrac} onLevel={onLevel} risk={risk} forecast={forecast} />
            )}
            {tab === 'twin' && (
              <TwinPanel
                layer={layer} onLayer={onLayer}
                hd={hd} onHd={(b) => { setHd(b); engineRef.current?.setHd(b); }}
                infra={infra} onInfra={(b) => { setInfra(b); engineRef.current?.setInfraVisible(b); }}
                foam={foam} onFoam={(b) => { setFoam(b); engineRef.current?.setFoam(b); }}
                spray={spray} onSpray={(b) => { setSpray(b); engineRef.current?.setSpray(b); }}
                speedMap={speedMap} onSpeedMap={(b) => { setSpeedMap(b); engineRef.current?.setSpeedMap(b); }}
                sound={sound} onSound={(b) => { setSound(b); engineRef.current?.setSound(b); }}
                timeScale={timeScale} onTimeScale={(v) => { setTimeScale(v); engineRef.current?.setTimeScale(v); }}
                fps={stats?.fps ?? 0}
              />
            )}
            {tab === 'scenarios' && (
              <ScenarioPanel form={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} onRun={onRun} onReset={onReset} running={running} stats={stats} damId={damId} />
            )}
            {tab === 'impact' && (
              <ImpactPanel impact={impact} damId={damId} onFocus={(x, z) => engineRef.current?.focusOn(x, z)} />
            )}
            {tab === 'evac' && (
              <EvacPanel plans={evacPlans} shelters={dam.shelters.map((s) => ({ name: s.name, capacity: s.capacity, risk: 'LOW' }))} onRoute={onRoute} impact={impact} />
            )}
            {tab === 'data' && (
              <DataPanel damId={damId} validation={validation} iot={iot} onIot={onIot} />
            )}
          </div>
        </div>
      )}

      {!cinematic && (
        <button
          aria-label={showLeft ? 'Hide controls' : 'Show controls'}
          onClick={() => setShowLeft((v) => !v)}
          className="absolute top-[112px] z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0a1526]/85 text-slate-300 backdrop-blur-md hover:bg-[#12213a]/90"
          style={{ left: showLeft ? 302 : 10 }}
        >
          {showLeft ? <ChevronLeft className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
        </button>
      )}

      {/* right gauges */}
      {!cinematic && (
        <>
          <div className={`absolute right-2 top-[112px] z-20 w-[280px] max-w-[calc(100vw-1rem)] transition-transform duration-300 ${showRight ? 'translate-x-0' : 'translate-x-[110%]'}`}>
            <div className="max-h-[calc(100vh-190px)] overflow-y-auto pr-0.5 damsafe-scroll">
              <GaugesPanel stats={stats} hydro={hydro} gaugeIdx={gaugeIdx} onGauge={setGaugeIdx} risk={risk} damId={damId} />
            </div>
          </div>
          <button
            aria-label={showRight ? 'Hide gauges' : 'Show gauges'}
            onClick={() => setShowRight((v) => !v)}
            className="absolute right-2 top-[112px] z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0a1526]/85 text-slate-300 backdrop-blur-md hover:bg-[#12213a]/90"
            style={{ right: showRight ? 290 : 10 }}
          >
            {showRight ? <ChevronRight className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
          </button>
        </>
      )}

      {/* layer legends */}
      {!cinematic && layer === 1 && (
        <div className="absolute bottom-[72px] left-2 z-20">
          <GradientLegend
            title="FLOOD DEPTH · m"
            stops={['#2988bf', '#1a6ba6', '#0f4085', '#081c57']}
            labels={['0', '4', '8+']}
          />
        </div>
      )}
      {!cinematic && layer === 2 && (
        <div className="absolute bottom-[72px] left-2 z-20">
          <GradientLegend
            title="FLOW VELOCITY · m/s"
            stops={['rgb(0,60,150)', 'rgb(0,192,240)', 'rgb(96,240,96)', 'rgb(240,240,64)', 'rgb(240,80,24)']}
            labels={['0', '4', '8+']}
          />
        </div>
      )}
      {!cinematic && layer === 3 && (
        <div className="absolute bottom-[72px] left-2 z-20">
          <GradientLegend
            title="FLOOD ARRIVAL · after breach"
            stops={['#29bf4d', '#a6d126', '#fab819', '#e54019', '#85198c']}
            labels={['15m', '1h', '4h+']}
          />
        </div>
      )}

      {/* scenario progress pill */}
      {!cinematic && running && stats && stats.stage >= 3 && stats.stage < 5 && (
        <div className="pointer-events-none absolute bottom-[72px] left-1/2 z-20 -translate-x-1/2">
          <span className="rounded bg-red-950/80 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-red-200 backdrop-blur-sm">
            SIMULATED DAM FAILURE · breach {Math.round(stats.breach01 * 100)}% · flood T+{fmtRealTime(stats.realMin)}
          </span>
        </div>
      )}

      {/* timeline */}
      {!cinematic && (
        <TimelineBar
          snapCount={snapInfo.count}
          snapTimes={snapInfo.times}
          scrubIdx={scrubIdx}
          onScrub={onScrub}
          onLive={onLive}
          paused={paused}
          onPause={() => {
            engineRef.current?.setPaused(!paused);
            setPaused(!paused);
          }}
          stats={stats}
          cams={CAMS}
          onCam={(c) => engineRef.current?.setCamera(c)}
          cinematic={cinematic}
          onCinema={() => {
            engineRef.current?.setCinematic(!cinematic);
            setCinematic(!cinematic);
          }}
          timeMinPerSec={dam.timeMinPerSec}
        />
      )}

      {/* tab hint */}
      {!cinematic && (
        <p className="pointer-events-none absolute bottom-[60px] right-3 z-10 hidden text-[9px] text-slate-500 lg:block">
          {TABS.find((t) => t.id === tab)?.label} · Drag orbit · Scroll zoom · Right-drag pan
        </p>
      )}

      {/* exit cinema */}
      {cinematic && (
        <button
          onClick={() => {
            engineRef.current?.setCinematic(false);
            setCinematic(false);
          }}
          className="absolute right-4 top-[calc(7vh+12px)] z-40 rounded-lg border border-white/15 bg-[#0a1526]/85 px-3 py-1.5 text-[11px] text-slate-200 backdrop-blur-md hover:bg-[#12213a]/90"
        >
          Exit cinema
        </button>
      )}

      {/* loading / error */}
      {!ready && !error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#060b14]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            <p className="text-sm text-slate-300">Building the digital twin…</p>
            <p className="text-[10px] tracking-[0.2em] text-slate-500">DAMSAFE 3D</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#060b14]/95 p-6">
          <Panel className="max-w-md p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
            <h2 className="mb-2 text-sm font-semibold text-slate-100">WebGL initialization failed</h2>
            <p className="text-xs leading-relaxed text-slate-400">
              This digital twin needs a WebGL2-capable browser with floating-point render targets.
              {error ? ` Detail: ${error}` : ''}
            </p>
          </Panel>
        </div>
      )}
    </main>
  );
}
