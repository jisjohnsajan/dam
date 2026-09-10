'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  RadioGroup, RadioGroupItem,
} from '@/components/ui/radio-group';
import type { GaugeStat, CamPreset } from '@/lib/dam/engine';
import type { ImpactResult, EvacPlan, RiskResult, ForecastPoint } from '@/lib/damsafe/analysis';
import {
  DAMS, fmtRealTime, MECHANISM_LABEL, RAIN_FACTORS,
  simToRealLevel, storagePercent,
  type BreachLocation, type DamId, type FailureMechanism, type RainScenario,
} from '@/lib/damsafe/config';
import { Bar, Chip, KPI, LevelTag, Panel, Row, SectionTitle } from './ui';
import {
  AlertTriangle, CheckCircle2, Play, Pause, RotateCcw, Radio, Satellite, Database, Cpu,
} from 'lucide-react';

export interface UIStats {
  t: number;
  realMin: number;
  level: number;
  levelFrac: number;
  vmax: number;
  froude: number;
  fps: number;
  phase: 'live' | 'scenario' | 'scrub';
  scenarioActive: boolean;
  breach01: number;
  progress01: number;
  stage: number;
  gauges: GaugeStat[];
  floodedCells: number;
  qOut: number;
}

export type TabId = 'command' | 'twin' | 'scenarios' | 'impact' | 'evac' | 'data';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'command', label: 'Command Center' },
  { id: 'twin', label: 'Digital Twin' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'impact', label: 'Flood Impact' },
  { id: 'evac', label: 'Evacuation' },
  { id: 'data', label: 'Data & Validation' },
];

// ============================================================ top bar
export function TopBar({
  damId, onDam, mode, onMode, tab, onTab,
}: {
  damId: DamId;
  onDam: (d: DamId) => void;
  mode: 'live' | 'scenario';
  onMode: (m: 'live' | 'scenario') => void;
  tab: TabId;
  onTab: (t: TabId) => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-2 right-2 top-2 z-30 rounded-lg border border-cyan-100/10 bg-[#0a1526]/92 shadow-2xl backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gradient-to-br from-cyan-500 to-blue-700 font-black text-white">D</div>
          <div className="leading-tight">
            <p className="text-[13px] font-bold tracking-wide text-white">DAMSAFE 3D</p>
            <p className="hidden text-[8.5px] tracking-[0.14em] text-cyan-200/60 sm:block">REAL-TIME DAM RISK &amp; FLOOD DIGITAL TWIN</p>
          </div>
        </div>
        <div className="mx-1 hidden h-7 w-px bg-white/10 sm:block" />
        <Select value={damId} onValueChange={(v) => onDam(v as DamId)}>
          <SelectTrigger className="h-8 w-[150px] border-white/10 bg-white/5 text-xs sm:w-[168px]" aria-label="Select dam">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DAMS) as DamId[]).map((id) => (
              <SelectItem key={id} value={id}>{DAMS[id].name} · {DAMS[id].damType.split('(')[0]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RadioGroup
          value={mode}
          onValueChange={(v) => onMode(v as 'live' | 'scenario')}
          className="flex items-center gap-3"
        >
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
            <RadioGroupItem value="live" className="h-3.5 w-3.5 border-emerald-400 text-emerald-400" />
            Live monitoring
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
            <RadioGroupItem value="scenario" className="h-3.5 w-3.5 border-amber-400 text-amber-400" />
            What-if scenario
          </label>
        </RadioGroup>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Chip kind="simulated">SIMULATED DATA</Chip>
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            SYSTEM ONLINE
          </span>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-t border-white/5 px-2 py-1 damsafe-scroll">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`shrink-0 rounded px-2.5 py-1 text-[10.5px] font-medium tracking-wide transition-colors ${
              tab === t.id
                ? 'bg-cyan-500/15 text-cyan-200 shadow-[inset_0_-2px_0_0_rgba(34,211,238,0.6)]'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================ hydrograph canvas
export function Hydrograph({
  data, peak, curT,
}: {
  data: { t: number; q: number }[];
  peak: number;
  curT: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth || 262;
    const H = c.clientHeight || 96;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const padL = 2, padR = 2, padT = 6, padB = 13;
    const maxQ = Math.max(peak, 300);
    const t1 = Math.max(data.length ? data[data.length - 1].t : 20, 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let i = 1; i < 4; i++) {
      const y = padT + ((H - padT - padB) * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    }
    if (data.length > 1) {
      const X = (t: number) => padL + (t / t1) * (W - padL - padR);
      const Y = (q: number) => H - padB - (Math.min(q, maxQ) / maxQ) * (H - padT - padB);
      ctx.beginPath();
      data.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.q)) : ctx.lineTo(X(p.t), Y(p.q))));
      ctx.lineTo(X(data[data.length - 1].t), H - padB);
      ctx.lineTo(X(data[0].t), H - padB);
      ctx.closePath();
      ctx.fillStyle = 'rgba(34,211,238,0.12)';
      ctx.fill();
      ctx.beginPath();
      data.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.q)) : ctx.lineTo(X(p.t), Y(p.q))));
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const pk = data.reduce((a, b) => (b.q > a.q ? b : a), data[0]);
      if (pk.q > 50) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(X(pk.t), Y(pk.q), 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    // current time cursor
    if (curT > 0 && curT <= t1) {
      const x = padL + (curT / t1) * (W - padL - padR);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('0', padL, H - 2);
    const tl = `${Math.round(t1)} s`;
    ctx.fillText(tl, W - padR - ctx.measureText(tl).width, H - 2);
    ctx.fillText(`${Math.round(maxQ)} m³/s`, padL + 2, padT + 7);
  }, [data, peak, curT]);
  return <canvas ref={ref} className="h-[96px] w-full" />;
}

// ============================================================ right: gauges + alerts
export function GaugesPanel({
  stats, hydro, gaugeIdx, onGauge, risk, damId,
}: {
  stats: UIStats | null;
  hydro: { t: number; q: number }[];
  gaugeIdx: number;
  onGauge: (i: number) => void;
  risk: RiskResult | null;
  damId: DamId;
}) {
  const g = stats?.gauges[gaugeIdx];
  const phaseChip = stats?.phase === 'scrub'
    ? <Chip kind="historical">HISTORICAL</Chip>
    : stats?.scenarioActive
      ? <Chip kind="crit">SIMULATED SCENARIO</Chip>
      : <Chip kind="live">LIVE</Chip>;
  return (
    <div className="flex flex-col gap-2">
      <Panel
        title="Gauge network"
        right={phaseChip}
      >
        <div className="mb-2 grid grid-cols-4 gap-1">
          {stats?.gauges.map((gg, i) => (
            <button
              key={gg.id}
              onClick={() => onGauge(i)}
              className={`rounded border px-1 py-0.5 text-[9px] font-semibold tracking-wide ${
                i === gaugeIdx ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
              }`}
            >
              {gg.id}
            </button>
          ))}
        </div>
        {g && (
          <>
            <p className="mb-1 text-[10px] text-slate-400">
              {g.id} · {g.label} · {(g.distKm).toFixed(1)} km {DAMS[damId].name === 'Idukki' ? '' : ''}downstream
            </p>
            <Row k="Discharge" v={`${Math.round(g.q).toLocaleString('en-IN')} m³/s`} />
            <Row k="Peak discharge" v={`${Math.round(g.qPeak).toLocaleString('en-IN')} m³/s`} />
            <Row k="Water depth" v={`${g.depth.toFixed(2)} m`} />
            <Row k="Velocity" v={`${g.vel.toFixed(1)} m/s`} />
            <Row k="Flood arrival" v={g.arrivalMin !== null ? fmtRealTime(g.arrivalMin) : 'not arrived'} accent={g.arrivalMin !== null ? 'text-amber-300' : 'text-slate-400'} />
            <div className="mt-2 rounded border border-white/5 bg-black/30 p-1">
              <p className="px-1 pb-0.5 text-[8.5px] tracking-[0.14em] text-slate-500">FLOOD HYDROGRAPH · DISCHARGE VS TIME</p>
              <Hydrograph data={hydro} peak={g.qPeak} curT={stats?.t ?? 0} />
            </div>
          </>
        )}
        {!g && <p className="text-[10px] text-slate-500">Waiting for solver…</p>}
      </Panel>

      <Panel title="Alerts">
        <div className="flex flex-col gap-1.5">
          {risk && risk.status !== 'LOW' && (
            <AlertLine kind="warn" text={`Reservoir risk ${risk.status} — score ${risk.score}/100`} />
          )}
          {stats && stats.breach01 > 0.02 && stats.breach01 < 1 && (
            <AlertLine kind="crit" text={`CRITICAL SCENARIO — breach forming (${Math.round(stats.breach01 * 100)}%)`} />
          )}
          {stats && stats.breach01 >= 1 && (
            <AlertLine kind="crit" text="Breach fully formed — flood wave propagating downstream" />
          )}
          {stats && stats.gauges.some((gg) => gg.vel > 6) && (
            <AlertLine kind="warn" text={`High velocity ${Math.max(...stats.gauges.map((x) => x.vel)).toFixed(1)} m/s — danger to life in channel`} />
          )}
          {(!risk || risk.status === 'LOW') && (!stats || stats.breach01 <= 0.02) && (
            <AlertLine kind="ok" text="Reservoir conditions normal — no active warnings" />
          )}
          <p className="mt-1 text-[8.5px] leading-relaxed text-slate-500">
            Prototype alerts · not official government warnings
          </p>
        </div>
      </Panel>
    </div>
  );
}

function AlertLine({ kind, text }: { kind: 'ok' | 'warn' | 'crit'; text: string }) {
  const map = {
    ok: { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />, cls: 'text-slate-300' },
    warn: { icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />, cls: 'text-amber-200' },
    crit: { icon: <AlertTriangle className="h-3.5 w-3.5 animate-pulse text-red-400" />, cls: 'text-red-200' },
  };
  return (
    <div className={`flex items-start gap-1.5 text-[10.5px] leading-snug ${map[kind].cls}`}>
      {map[kind].icon}
      <span>{text}</span>
    </div>
  );
}

// ============================================================ command center
export function CommandCenter({
  damId, stats, liveFrac, onLevel, risk, forecast,
}: {
  damId: DamId;
  stats: UIStats | null;
  liveFrac: number;
  onLevel: (f: number) => void;
  risk: RiskResult | null;
  forecast: ForecastPoint[];
}) {
  const dam = DAMS[damId];
  const realLevel = simToRealLevel(dam, stats?.level ?? 15.2 + liveFrac * 7.5);
  const storage = storagePercent(liveFrac);
  const inflow = Math.round(8 * dam.qScale); // base river inflow (demo 8 m³/s × dam scale)
  const rise = risk?.factors.find((f) => f.key === 'rise')?.note ?? '';
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Reservoir conditions" right={<Chip kind="live">LIVE</Chip>}>
        <div className="grid grid-cols-2 gap-1.5">
          <KPI label="Water level" value={realLevel.toFixed(1)} unit="m" sub="elevation a.s.l." />
          <KPI label="Storage" value={`${storage}`} unit="%" sub={`${dam.grossStorageMm3.toLocaleString()} Mm³ gross`} tone={storage > 90 ? 'amber' : 'cyan'} />
          <KPI label="Inflow" value={inflow.toLocaleString('en-IN')} unit="m³/s" />
          <KPI label="Outflow" value={Math.round((stats?.qOut ?? 0) * dam.qScale).toLocaleString('en-IN')} unit="m³/s" />
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>RESERVOIR LEVEL SLIDER</span>
            <span className="font-mono text-cyan-300">{realLevel.toFixed(1)} m · {(liveFrac * 100).toFixed(0)}%</span>
          </div>
          <Slider
            value={[liveFrac]}
            min={0.05}
            max={1}
            step={0.01}
            onValueChange={([v]) => onLevel(v)}
            aria-label="Reservoir level"
          />
          <div className="mt-0.5 flex justify-between text-[8.5px] text-slate-500">
            <span>Minimum drawdown {dam.minDrawdownM.toFixed(0)} m</span>
            <span>FRL {dam.frlM.toFixed(1)} m</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <KPI label="Rate of rise" value={rise.startsWith('+') ? rise.replace(' m/hr', '') : '0.00'} unit="m/hr" tone={rise.startsWith('+') ? 'amber' : 'cyan'} />
          <KPI label="3D sync" value={`${((stats?.level ?? 0)).toFixed(1)} m`} sub="digital twin surface" tone="slate" />
        </div>
      </Panel>

      <Panel title="Water level forecast" right={<Chip kind="forecast">FORECAST</Chip>}>
        {forecast.map((f) => (
          <Row
            key={f.label}
            k={f.label}
            v={`${f.realLevel.toFixed(1)} m ${f.delta >= 0 ? '▲' : '▼'}${Math.abs(f.delta).toFixed(2)}`}
            accent={f.delta > 0.4 ? 'text-amber-300' : 'text-cyan-300'}
          />
        ))}
        <p className="mt-1.5 text-[8.5px] leading-relaxed text-slate-500">
          Water-balance prototype (inflow − outflow over the area curve). Architecture ready for
          Random Forest / XGBoost / LSTM replacement — no deep learning without training data.
        </p>
      </Panel>

      <Panel title="Risk assessment" right={risk ? <Chip kind={risk.status === 'LOW' ? 'ok' : risk.status === 'EXTREME' ? 'crit' : 'warn'}>{risk.status}</Chip> : undefined}>
        {risk && (
          <>
            <div className="mb-2 flex items-end gap-2">
              <span className={`font-mono text-3xl font-bold leading-none ${
                risk.status === 'EXTREME' ? 'text-red-400' : risk.status === 'HIGH' ? 'text-amber-400' : risk.status === 'MODERATE' ? 'text-yellow-300' : 'text-emerald-400'
              }`}>{risk.score}</span>
              <span className="pb-0.5 text-[10px] text-slate-500">/ 100 weighted score</span>
            </div>
            <SectionTitle>Risk factors</SectionTitle>
            <div className="flex flex-col gap-1">
              {risk.factors.map((f) => (
                <div key={f.key} className="flex items-center justify-between text-[10.5px]">
                  <span className="text-slate-300">{f.label}</span>
                  <LevelTag level={f.level} />
                </div>
              ))}
            </div>
            {(risk.why.bad.length > 0 || risk.why.ok.length > 0) && (
              <>
                <SectionTitle>Why this score?</SectionTitle>
                <div className="flex flex-col gap-1">
                  {risk.why.bad.map((b, i) => (
                    <p key={`b${i}`} className="flex gap-1 text-[10px] leading-snug text-amber-200/90">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />{b}
                    </p>
                  ))}
                  {risk.why.ok.map((b, i) => (
                    <p key={`g${i}`} className="flex gap-1 text-[10px] leading-snug text-emerald-200/80">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />{b}
                    </p>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

// ============================================================ scenarios
export interface ScenarioForm {
  levelFrac: number;
  mechanism: FailureMechanism;
  breachWidthM: number;
  formationMin: number;
  location: BreachLocation;
  durationMin: number;
  rain: RainScenario;
}

export function ScenarioPanel({
  form, onChange, onRun, onReset, running, stats, damId,
}: {
  form: ScenarioForm;
  onChange: (p: Partial<ScenarioForm>) => void;
  onRun: () => void;
  onReset: () => void;
  running: boolean;
  stats: UIStats | null;
  damId: DamId;
}) {
  const stages = ['Preparing terrain', 'Loading reservoir', 'Building breach', 'Running hydraulic model', 'Processing flood extent', 'Calculating impacts'];
  const stageDone = (i: number): 'done' | 'active' | 'todo' => {
    const s = stats?.stage ?? 0;
    if (!running) return 'todo';
    if (i + 1 < s) return 'done';
    if (i + 1 === s) return 'active';
    return 'todo';
  };
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Failure scenario (assumed)" right={<Chip kind="simulated">WHAT-IF</Chip>}>
        <SectionTitle>Failure mechanism</SectionTitle>
        <RadioGroup value={form.mechanism} onValueChange={(v) => onChange({ mechanism: v as FailureMechanism })} className="gap-2">
          {(['overtopping', 'piping', 'structural'] as FailureMechanism[]).map((m) => (
            <label key={m} className="flex cursor-pointer items-start gap-2 text-[11px] text-slate-300">
              <RadioGroupItem value={m} className="mt-0.5 h-3.5 w-3.5" />
              <span>
                <span className="font-medium capitalize">{m === 'piping' ? 'Piping / internal erosion' : m}</span>
                <span className="block text-[9px] leading-tight text-slate-500">{MECHANISM_LABEL[m]}</span>
              </span>
            </label>
          ))}
        </RadioGroup>

        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span>INITIAL RESERVOIR LEVEL</span>
            <span className="font-mono text-cyan-300">{simToRealLevel(DAMS[damId], 15.2 + form.levelFrac * 7.5).toFixed(0)} m eq.</span>
          </div>
          <Slider value={[form.levelFrac]} min={0.3} max={1.12} step={0.01} onValueChange={([v]) => onChange({ levelFrac: v })} aria-label="Scenario reservoir level" />
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span>BREACH WIDTH</span>
            <span className="font-mono text-cyan-300">{form.breachWidthM} m</span>
          </div>
          <Slider value={[form.breachWidthM]} min={30} max={160} step={10} onValueChange={([v]) => onChange({ breachWidthM: v })} aria-label="Breach width" />
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span>BREACH FORMATION TIME</span>
            <span className="font-mono text-cyan-300">{form.formationMin} min</span>
          </div>
          <Slider value={[form.formationMin]} min={10} max={90} step={5} onValueChange={([v]) => onChange({ formationMin: v })} aria-label="Breach formation time" />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-[10px] text-slate-400">BREACH LOCATION</p>
            <Select value={form.location} onValueChange={(v) => onChange({ location: v as BreachLocation })}>
              <SelectTrigger className="h-7 border-white/10 bg-white/5 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left abutment</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right abutment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-[10px] text-slate-400">RAIN SCENARIO</p>
            <Select value={form.rain} onValueChange={(v) => onChange({ rain: v as RainScenario })}>
              <SelectTrigger className="h-7 border-white/10 bg-white/5 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RAIN_FACTORS) as RainScenario[]).map((r) => (
                  <SelectItem key={r} value={r}>{RAIN_FACTORS[r].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span>SIMULATION DURATION</span>
            <span className="font-mono text-cyan-300">{form.durationMin} min</span>
          </div>
          <Slider value={[form.durationMin]} min={60} max={720} step={60} onValueChange={([v]) => onChange({ durationMin: v })} aria-label="Simulation duration" />
        </div>

        <Button
          onClick={onRun}
          disabled={running}
          className="mt-3 h-10 w-full bg-gradient-to-r from-red-600 to-amber-500 font-semibold text-white shadow-lg shadow-red-900/40 hover:from-red-500 hover:to-amber-400"
        >
          {running ? 'SCENARIO RUNNING…' : 'RUN FAILURE SCENARIO'}
        </Button>
        <Button onClick={onReset} variant="ghost" className="mt-1 h-7 w-full text-[11px] text-slate-400 hover:text-slate-100">
          <RotateCcw className="mr-1.5 h-3 w-3" /> Reset to live monitoring
        </Button>
      </Panel>

      {running && (
        <Panel title="Simulation job" right={<span className="font-mono text-[10px] text-cyan-300">{Math.round((stats?.progress01 ?? 0) * 100)}%</span>}>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-400 transition-all" style={{ width: `${(stats?.progress01 ?? 0) * 100}%` }} />
          </div>
          {stages.map((s, i) => {
            const st = stageDone(i);
            return (
              <div key={s} className="flex items-center justify-between py-[2px] text-[10.5px]">
                <span className={st === 'todo' ? 'text-slate-500' : 'text-slate-300'}>{s}</span>
                <span className={`font-mono text-[9px] ${st === 'done' ? 'text-emerald-400' : st === 'active' ? 'text-cyan-300' : 'text-slate-600'}`}>
                  {st === 'done' ? '✓' : st === 'active' ? '···' : ''}
                </span>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}

// ============================================================ impact
export function ImpactPanel({
  impact, damId, onFocus,
}: {
  impact: ImpactResult | null;
  damId: DamId;
  onFocus: (x: number, z: number) => void;
}) {
  const dam = DAMS[damId];
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Flood impact" right={<Chip kind="simulated">SIMULATED ESTIMATE</Chip>}>
        {impact ? (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <KPI label="Flooded area" value={impact.floodedKm2.toFixed(1)} unit="km²" />
              <KPI label="Population exposed" value={impact.population.toLocaleString('en-IN')} tone={impact.population > 0 ? 'red' : 'cyan'} />
              <KPI label="Buildings" value={impact.buildings.toLocaleString('en-IN')} />
              <KPI label="Roads flooded" value={impact.roadsKm.toFixed(0)} unit="km" />
              <KPI label="Villages affected" value={`${impact.villages}/${dam.villages.length}`} />
              <KPI label="Bridges / hospitals / schools" value={`${impact.bridges} / ${impact.hospitals} / ${impact.schools}`} tone="slate" />
              <KPI label="Max depth" value={impact.maxDepthM.toFixed(1)} unit="m" />
              <KPI label="Max velocity" value={impact.maxVelMs.toFixed(1)} unit="m/s" />
            </div>
            <SectionTitle>Villages — arrival &amp; exposure</SectionTitle>
            <div className="flex flex-col gap-1">
              {impact.affectedVillages.map((v) => (
                <button
                  key={v.name}
                  onClick={() => {
                    const def = dam.villages.find((x) => x.name === v.name);
                    if (def) onFocus(def.x, def.z);
                  }}
                  className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] px-2 py-1 text-left text-[10.5px] hover:border-cyan-400/30 hover:bg-cyan-500/5"
                >
                  <span className="text-slate-200">{v.name}</span>
                  <span className="flex gap-2 font-mono text-[9.5px]">
                    <span className={v.arrivalMin !== null ? 'text-amber-300' : 'text-slate-500'}>
                      {v.arrivalMin !== null ? `⏱ ${fmtRealTime(v.arrivalMin)}` : 'dry'}
                    </span>
                    <span className="text-cyan-300">{v.depthM.toFixed(1)} m</span>
                    <span className="text-slate-400">{v.velMs.toFixed(1)} m/s</span>
                  </span>
                </button>
              ))}
            </div>
            <SectionTitle>Critical infrastructure</SectionTitle>
            <div className="grid grid-cols-1 gap-1">
              {impact.affectedInfra.map((f) => (
                <div key={f.name} className="flex items-center justify-between text-[10.5px]">
                  <span className="text-slate-300">{f.name}</span>
                  <span className={`font-mono text-[9px] font-semibold ${f.flooded ? 'text-red-300' : 'text-emerald-300'}`}>
                    {f.flooded ? 'INUNDATED' : 'SAFE'}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[10.5px] text-slate-500">Run a failure scenario to compute impact metrics.</p>
        )}
        <p className="mt-2 text-[8.5px] leading-relaxed text-slate-500">
          Calculated from spatial intersections of the simulated flood raster with the
          demonstration GIS layer. Demonstration dataset — not real asset counts.
        </p>
      </Panel>
    </div>
  );
}

// ============================================================ evacuation
export function EvacPanel({
  plans, shelters, onRoute, impact,
}: {
  plans: EvacPlan[];
  shelters: { name: string; capacity: number; risk: string }[];
  onRoute: (plan: EvacPlan | null) => void;
  impact: ImpactResult | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Safe zones & shelters">
        {shelters.map((s) => (
          <Row key={s.name} k={s.name} v={`cap ${s.capacity} · risk ${s.risk}`} accent="text-emerald-300" />
        ))}
        <p className="mt-1.5 text-[8.5px] leading-relaxed text-slate-500">
          Sited on high ground considering elevation, predicted flood extent and road connectivity (demo layout).
        </p>
      </Panel>
      <Panel title="Evacuation planner" right={impact && impact.villages > 0 ? <Chip kind="warn">{impact.villages} FLOODED</Chip> : <Chip kind="ok">READY</Chip>}>
        {plans.length === 0 && <p className="text-[10.5px] text-slate-500">Run a scenario to compute evacuation plans.</p>}
        <div className="flex flex-col gap-1.5">
          {plans.map((p) => (
            <div key={p.village} className="rounded border border-white/5 bg-white/[0.02] p-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-slate-200">{p.village}</p>
                <span className={`font-mono text-[9px] font-semibold ${p.safe ? 'text-emerald-300' : 'text-red-300'}`}>
                  {p.arrivalMin === null ? 'NOT FLOODED' : p.safe ? `MARGIN ${fmtRealTime(p.marginMin ?? 0)}` : `UNSAFE −${fmtRealTime(-(p.marginMin ?? 0))}`}
                </span>
              </div>
              <p className="mt-0.5 text-[9.5px] text-slate-400">
                → {p.shelter} · {p.distanceKm.toFixed(1)} km · travel {fmtRealTime(p.travelMin)}
                {p.arrivalMin !== null && <> · flood arrival {fmtRealTime(p.arrivalMin)}</>}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-6 border-emerald-500/30 bg-emerald-900/20 px-2 text-[9.5px] text-emerald-200 hover:bg-emerald-900/40"
                onClick={() => onRoute(p)}
              >
                Start evacuation route
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[8.5px] leading-relaxed text-slate-500">
          Routes avoid predicted flooded roads; travel time at 32 km/h demonstration speed.
        </p>
      </Panel>
    </div>
  );
}

// ============================================================ data & validation
export function DataPanel({
  damId, validation, iot, onIot,
}: {
  damId: DamId;
  validation: { agreementPct: number; overlapKm2: number; missedKm2: number; falseKm2: number } | null;
  iot: { connected: boolean; cm: number; log: string[] };
  onIot: (on: boolean) => void;
}) {
  const dam = DAMS[damId];
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Data freshness" right={<Chip kind="simulated">DEMO DATASET</Chip>}>
        <Row k="Buildings (OSM + survey)" v="updated 12 days ago" accent="text-slate-300" />
        <Row k="Roads" v="updated 5 days ago" accent="text-slate-300" />
        <Row k="Land cover" v="updated 23 days ago" accent="text-slate-300" />
        <Row k="Satellite scene" v="updated 2 days ago" accent="text-slate-300" />
        <Row k="DEM" v="reference dataset" accent="text-slate-300" />
        <Row k="Sensor feed" v={iot.connected ? 'ESP32 demo connected' : 'simulated feed'} accent={iot.connected ? 'text-emerald-300' : 'text-slate-300'} />
      </Panel>

      <Panel title="Predicted vs observed flood" right={<Chip kind="forecast">MODEL CHECK</Chip>}>
        {validation ? (
          <>
            <Row k="Model agreement" v={`${validation.agreementPct}%`} accent={validation.agreementPct > 80 ? 'text-emerald-300' : 'text-amber-300'} />
            <Row k="Overlap" v={`${validation.overlapKm2.toFixed(1)} km²`} accent="text-slate-300" />
            <Row k="Missed area" v={`${validation.missedKm2.toFixed(1)} km²`} accent="text-slate-300" />
            <Row k="False-positive area" v={`${validation.falseKm2.toFixed(1)} km²`} accent="text-slate-300" />
          </>
        ) : (
          <p className="text-[10.5px] text-slate-500">Comparison available after flood propagation.</p>
        )}
        <p className="mt-1.5 text-[8.5px] leading-relaxed text-slate-500">
          “Observed” extent is a simulated satellite-derived classification of the same flood —
          demonstrates the validation workflow without fabricating real imagery results.
        </p>
      </Panel>

      <Panel title="ESP32 hardware prototype" right={<Chip kind="simulated">MQTT · DEMO</Chip>}>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <Cpu className="h-3.5 w-3.5 text-cyan-400" /> Miniature dam sensor
          </span>
          <Switch checked={iot.connected} onCheckedChange={onIot} aria-label="Connect ESP32 demo" />
        </div>
        {iot.connected && (
          <>
            <Row k="Physical water level" v={`${iot.cm.toFixed(1)} cm`} accent="text-emerald-300" />
            <Row k="Digital twin equivalent" v={`${simToRealLevel(dam, 15.2 + (iot.cm / 30) * 7.5).toFixed(1)} m`} />
            <div className="mt-1.5 max-h-24 overflow-y-auto rounded bg-black/40 p-1.5 font-mono text-[8.5px] leading-relaxed text-emerald-200/80">
              {iot.log.slice(-6).map((l, i) => <p key={i}>{l}</p>)}
            </div>
          </>
        )}
        <p className="mt-1.5 text-[8.5px] leading-relaxed text-slate-500">
          Physical-digital sync demo: ultrasonic sensor → ESP32 → Wi-Fi MQTT → twin. Low-voltage
          demonstration hardware, not a real dam monitoring device.
        </p>
      </Panel>

      <Panel title="Hydraulic model & assumptions" right={<Chip kind="simulated">TECHNICAL</Chip>}>
        <Row k="Solver" v="2D shallow-water (Saint-Venant)" accent="text-slate-300" />
        <Row k="Grid" v="384 × 224 · 0.5 m cells" accent="text-slate-300" />
        <Row k="Gravity" v="9.81 m/s²" accent="text-slate-300" />
        <Row k="Flux scheme" v="HLL / Rusanov + hydrostatic reconstruction" accent="text-slate-300" />
        <Row k="Friction" v="Manning n = 0.028" accent="text-slate-300" />
        <Row k="Time step" v="CFL-limited ≤ 8 ms substeps" accent="text-slate-300" />
        <Row k="Boundary" v="reflective walls + gorge inflow" accent="text-slate-300" />
        <p className="mt-1.5 text-[8.5px] leading-relaxed text-slate-500">
          Risk assessment is based on available indicators, not certainty. Dam-break results are
          simulated downstream consequences under the selected breach scenario. Architecture
          supports HEC-RAS 2D integration for production validation.
        </p>
      </Panel>

      <Panel title="Urban change detection">
        <Row k="Comparison" v="2025 → 2026" accent="text-slate-300" />
        <Row k="New buildings" v="+342 (demo)" accent="text-slate-300" />
        <Row k="New roads" v="+12 km (demo)" accent="text-slate-300" />
        <Row k="Land-use change" v="4.8 km² (demo)" accent="text-slate-300" />
        <p className="mt-1.5 flex items-center gap-1 text-[8.5px] text-slate-500">
          <Satellite className="h-3 w-3" /> Periodic ingestion: satellite + OSM + government GIS (async jobs).
          <Database className="ml-1 h-3 w-3" />
        </p>
      </Panel>
    </div>
  );
}

// ============================================================ digital twin tab (layers + cameras)
export function TwinPanel({
  layer, onLayer, hd, onHd, infra, onInfra, foam, onFoam, spray, onSpray, speedMap, onSpeedMap, sound, onSound, timeScale, onTimeScale, fps,
}: {
  layer: number;
  onLayer: (m: number) => void;
  hd: boolean; onHd: (b: boolean) => void;
  infra: boolean; onInfra: (b: boolean) => void;
  foam: boolean; onFoam: (b: boolean) => void;
  spray: boolean; onSpray: (b: boolean) => void;
  speedMap: boolean; onSpeedMap: (b: boolean) => void;
  sound: boolean; onSound: (b: boolean) => void;
  timeScale: number; onTimeScale: (v: number) => void;
  fps: number;
}) {
  const layers: { id: number; label: string }[] = [
    { id: 0, label: 'Natural' },
    { id: 1, label: 'Flood depth' },
    { id: 2, label: 'Flow velocity' },
    { id: 3, label: 'Arrival time' },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Panel title="Map layers">
        <RadioGroup value={String(layer)} onValueChange={(v) => onLayer(Number(v))} className="gap-1.5">
          {layers.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
              <RadioGroupItem value={String(l.id)} className="h-3.5 w-3.5" />
              {l.label}
            </label>
          ))}
        </RadioGroup>
        <div className="mt-2 flex flex-col gap-2 border-t border-white/5 pt-2">
          <label className="flex items-center justify-between text-[11px] text-slate-300">
            Infrastructure markers
            <Switch checked={infra} onCheckedChange={onInfra} />
          </label>
          <label className="flex items-center justify-between text-[11px] text-slate-300">
            Foam &amp; spray
            <Switch checked={foam} onCheckedChange={onFoam} />
          </label>
          <label className="flex items-center justify-between text-[11px] text-slate-300">
            HD graphics (bloom)
            <Switch checked={hd} onCheckedChange={onHd} />
          </label>
          <label className="flex items-center justify-between text-[11px] text-slate-300">
            Ambient sound
            <Switch checked={sound} onCheckedChange={onSound} />
          </label>
        </div>
      </Panel>
      <Panel title="Engineering mode">
        <label className="flex items-center justify-between text-[11px] text-slate-300">
          Flow speed map
          <Switch checked={speedMap} onCheckedChange={onSpeedMap} />
        </label>
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span>TIME SCALE</span>
            <span className="font-mono text-cyan-300">{timeScale.toFixed(2)}×</span>
          </div>
          <Slider value={[timeScale]} min={0.1} max={2} step={0.05} onValueChange={([v]) => onTimeScale(v)} />
        </div>
        <label className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
          Spray particles
          <Switch checked={spray} onCheckedChange={onSpray} />
        </label>
      </Panel>
      <Panel title="Solver status">
        <Row k="Engine" v="GPU shallow water · WebGL2" accent="text-slate-300" />
        <Row k="Render" v={`${Math.round(fps)} fps`} accent="text-slate-300" />
      </Panel>
    </div>
  );
}

// ============================================================ timeline (time machine)
export function TimelineBar({
  snapCount, snapTimes, scrubIdx, onScrub, onLive, paused, onPause, stats, cams, onCam, cinematic, onCinema, timeMinPerSec,
}: {
  snapCount: number;
  snapTimes: number[];
  scrubIdx: number | null;
  onScrub: (i: number) => void;
  onLive: () => void;
  paused: boolean;
  onPause: () => void;
  stats: UIStats | null;
  cams: { id: CamPreset; label: string }[];
  onCam: (c: CamPreset) => void;
  cinematic: boolean;
  onCinema: () => void;
  timeMinPerSec: number;
}) {
  const maxIdx = Math.max(snapCount - 1, 0);
  return (
    <div className="pointer-events-auto absolute bottom-3 left-2 right-2 z-30 rounded-lg border border-cyan-100/10 bg-[#0a1526]/92 px-3 py-2 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3">
        <Button size="icon" variant="outline" onClick={onPause} aria-label={paused ? 'Play' : 'Pause'}
          className="h-8 w-8 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10">
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hidden shrink-0 text-[9px] tracking-[0.14em] text-slate-500 sm:inline">TIME MACHINE</span>
          <Slider
            value={[scrubIdx !== null ? scrubIdx : maxIdx]}
            min={0}
            max={Math.max(maxIdx, 1)}
            step={1}
            disabled={snapCount === 0}
            onValueChange={([v]) => onScrub(v)}
            aria-label="Simulation timeline"
            className="flex-1"
          />
          <span className="w-24 shrink-0 text-right font-mono text-[10px] text-cyan-300">
            {scrubIdx !== null ? `T+${fmtRealTime((snapTimes[scrubIdx] ?? 0) * timeMinPerSec)}` : `T+${fmtRealTime(stats?.realMin ?? 0)}`}
          </span>
          {scrubIdx !== null && (
            <Button size="sm" onClick={onLive} className="h-7 bg-cyan-600 px-2 text-[10px] text-white hover:bg-cyan-500">
              <Radio className="mr-1 h-3 w-3" /> LIVE
            </Button>
          )}
        </div>
        <div className="hidden items-center gap-1 lg:flex">
          {cams.map((c) => (
            <Button key={c.id} size="sm" variant="outline" onClick={() => onCam(c.id)}
              className="h-7 border-white/10 bg-white/5 px-2 text-[9.5px] text-slate-300 hover:bg-white/10">
              {c.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={onCinema}
            className={`h-7 border-white/10 px-2 text-[9.5px] ${cinematic ? 'bg-cyan-600/30 text-cyan-200' : 'bg-white/5 text-slate-300'} hover:bg-white/10`}>
            Cinema
          </Button>
        </div>
      </div>
    </div>
  );
}
