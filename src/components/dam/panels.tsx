'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Zap,
  DoorOpen,
  CloudRain,
  RotateCcw,
  Info,
  Volume2,
  VolumeX,
  Sparkles,
  Gauge,
  Waves,
} from 'lucide-react';

// ---------------------------------------------------------------- control panel
export interface ControlState {
  timeScale: number;
  paused: boolean;
  gravity: string;
  inflow: number;
  breachRate: number;
  foam: boolean;
  spray: boolean;
  speedMap: boolean;
  sound: boolean;
  overtopping: boolean;
}

interface ControlPanelProps {
  state: ControlState;
  onChange: (patch: Partial<ControlState>) => void;
  onBreak: () => void;
  onGates: () => void;
  onOvertop: () => void;
  onReset: () => void;
}

export function ControlPanel({ state, onChange, onBreak, onGates, onOvertop, onReset }: ControlPanelProps) {
  return (
    <div className="pointer-events-auto w-[290px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/10 bg-zinc-950/80 p-4 text-zinc-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Waves className="h-5 w-5 text-teal-400" />
        <div>
          <h1 className="text-sm font-semibold leading-tight tracking-wide">DAM BREAK LAB</h1>
          <p className="text-[10px] leading-tight text-zinc-400">
            2D shallow-water equations · GPU solver
          </p>
        </div>
      </div>

      <Separator className="my-3 bg-white/10" />

      <div className="flex flex-col gap-2">
        <Button
          onClick={onBreak}
          className="h-10 w-full bg-gradient-to-r from-red-600 to-amber-500 font-semibold text-white shadow-lg shadow-red-900/40 hover:from-red-500 hover:to-amber-400"
        >
          <Zap className="mr-1.5 h-4 w-4" />
          Break the Dam
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onGates} variant="outline" className="h-9 border-white/15 bg-white/5 hover:bg-white/10">
            <DoorOpen className="mr-1 h-3.5 w-3.5" />
            Spillway
          </Button>
          <Button
            onClick={onOvertop}
            variant="outline"
            className={`h-9 border-white/15 hover:bg-white/10 ${state.overtopping ? 'bg-sky-900/50 text-sky-200' : 'bg-white/5'}`}
          >
            <CloudRain className="mr-1 h-3.5 w-3.5" />
            {state.overtopping ? 'Stop rain' : 'Flash flood'}
          </Button>
        </div>
        <Button onClick={onReset} variant="ghost" className="h-8 text-zinc-400 hover:text-zinc-100">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset simulation
        </Button>
      </div>

      <Separator className="my-3 bg-white/10" />

      <div className="flex flex-col gap-3.5 text-xs">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-zinc-300">
            <span>Time scale</span>
            <span className="font-mono text-teal-300">{state.timeScale.toFixed(2)}×</span>
          </div>
          <Slider
            value={[state.timeScale]}
            min={0.1}
            max={2}
            step={0.05}
            onValueChange={([v]) => onChange({ timeScale: v })}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-zinc-300">
            <span>River inflow</span>
            <span className="font-mono text-teal-300">{state.inflow} m³/s</span>
          </div>
          <Slider
            value={[state.inflow]}
            min={0}
            max={80}
            step={2}
            onValueChange={([v]) => onChange({ inflow: v })}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-zinc-300">
            <span>Breach erosion rate</span>
            <span className="font-mono text-teal-300">{state.breachRate.toFixed(1)}×</span>
          </div>
          <Slider
            value={[state.breachRate]}
            min={0.4}
            max={3}
            step={0.1}
            onValueChange={([v]) => onChange({ breachRate: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-300">Gravity</span>
          <Select value={state.gravity} onValueChange={(v) => onChange({ gravity: v })}>
            <SelectTrigger className="h-7 w-[130px] border-white/15 bg-white/5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="9.81">Earth · 9.81</SelectItem>
              <SelectItem value="3.71">Mars · 3.71</SelectItem>
              <SelectItem value="1.62">Moon · 1.62</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator className="my-3 bg-white/10" />

      <div className="flex flex-col gap-2.5 text-xs text-zinc-300">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-teal-400" /> Foam &amp; spray
          </span>
          <Switch checked={state.foam} onCheckedChange={(b) => onChange({ foam: b, spray: b })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 text-teal-400" /> Flow speed map
          </span>
          <Switch checked={state.speedMap} onCheckedChange={(b) => onChange({ speedMap: b })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            {state.sound ? (
              <Volume2 className="h-3.5 w-3.5 text-teal-400" />
            ) : (
              <VolumeX className="h-3.5 w-3.5 text-zinc-500" />
            )}
            Ambient sound
          </span>
          <Switch checked={state.sound} onCheckedChange={(b) => onChange({ sound: b })} />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-zinc-400 hover:text-zinc-100">
              <Info className="mr-1 h-3 w-3" />
              Physics model
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-80 border-white/15 bg-zinc-950/95 text-xs text-zinc-300">
            <p className="mb-2 font-semibold text-zinc-100">What is being solved?</p>
            <p className="mb-2">
              The water is a real numerical solution of the depth-averaged
              <span className="text-teal-300"> Saint-Venant (shallow water) equations</span> — the same model
              family used in professional dam-break flood studies (HEC-RAS 2D, TELEMAC):
            </p>
            <ul className="mb-2 list-disc space-y-1 pl-4">
              <li>∂η/∂t + ∇·(h<b>U</b>) = 0 — mass conservation</li>
              <li>∂(h<b>U</b>)/∂t + ∇·(h<b>UU</b>) = −gh∇η − S<sub>f</sub> — momentum</li>
              <li>HLL / Rusanov approximate Riemann flux at every cell face</li>
              <li>Hydrostatic reconstruction — lake stays perfectly still</li>
              <li>Manning bed friction (n = 0.028), wetting &amp; drying</li>
              <li>CFL-limited substeps (dt ≤ 8 ms) on a 384×224 GPU grid</li>
            </ul>
            <p>
              Foam, spray, floating debris and houses are driven by the computed velocity field —
              nothing is keyframed, everything you see is computed live.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- hydrograph
export function Hydrograph({ data, peak }: { data: { t: number; q: number }[]; peak: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth || 260;
    const H = c.clientHeight || 110;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padL = 4, padR = 4, padT = 8, padB = 14;
    const maxQ = Math.max(peak, 300);
    const t1 = Math.max(data.length ? data[data.length - 1].t : 20, 20);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = padT + ((H - padT - padB) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    if (data.length > 1) {
      // area fill
      ctx.beginPath();
      data.forEach((p, i) => {
        const x = padL + (p.t / t1) * (W - padL - padR);
        const y = H - padB - (Math.min(p.q, maxQ) / maxQ) * (H - padT - padB);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(padL + (data[data.length - 1].t / t1) * (W - padL - padR), H - padB);
      ctx.lineTo(padL, H - padB);
      ctx.closePath();
      ctx.fillStyle = 'rgba(45,212,191,0.15)';
      ctx.fill();

      // line
      ctx.beginPath();
      data.forEach((p, i) => {
        const x = padL + (p.t / t1) * (W - padL - padR);
        const y = H - padB - (Math.min(p.q, maxQ) / maxQ) * (H - padT - padB);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#2dd4bf';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // peak marker
      const pk = data.reduce((a, b) => (b.q > a.q ? b : a), data[0]);
      if (pk.q > 50) {
        const x = padL + (pk.t / t1) * (W - padL - padR);
        const y = H - padB - (Math.min(pk.q, maxQ) / maxQ) * (H - padT - padB);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(`${Math.round(pk.q)}`, Math.min(x + 4, W - 30), y - 3);
      }
    }

    // axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('0', padL, H - 3);
    const tLabel = `${Math.round(t1)}s`;
    ctx.fillText(tLabel, W - padR - ctx.measureText(tLabel).width, H - 3);
    ctx.fillText(`${Math.round(maxQ)} m³/s`, padL + 2, padT - 1);
  }, [data, peak]);

  return <canvas ref={ref} className="h-[110px] w-full" />;
}

// ------------------------------------------------------------------ stats panel
export interface DamStatsView {
  t: number;
  q: number;
  qPeak: number;
  level: number;
  vmax: number;
  froude: number;
  fps: number;
  phase: string;
}

const PHASE_LABEL: Record<string, { text: string; cls: string }> = {
  ready: { text: 'RESERVOIR STABLE', cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-500/30' },
  breach: { text: 'BREACH IN PROGRESS', cls: 'bg-red-900/60 text-red-300 border-red-500/40' },
  gates: { text: 'SPILLWAY OPEN', cls: 'bg-amber-900/60 text-amber-300 border-amber-500/40' },
  flood: { text: 'FLASH FLOOD INFLOW', cls: 'bg-sky-900/60 text-sky-300 border-sky-500/40' },
};

export function StatsPanel({
  stats,
  hydro,
}: {
  stats: DamStatsView | null;
  hydro: { t: number; q: number }[];
}) {
  const fmtTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  const phase = PHASE_LABEL[stats?.phase ?? 'ready'] ?? PHASE_LABEL.ready;

  const rows: [string, string][] = stats
    ? [
        ['Sim time', fmtTime(stats.t)],
        ['Reservoir level', `${stats.level.toFixed(2)} m`],
        ['Discharge @ gauge', `${Math.round(stats.q)} m³/s`],
        ['Peak discharge', `${Math.round(stats.qPeak)} m³/s`],
        ['Max velocity', `${stats.vmax.toFixed(1)} m/s`],
        ['Froude @ gauge', stats.froude.toFixed(2)],
        ['Solver', `384×224 · ${Math.round(stats.fps)} fps`],
      ]
    : [];

  return (
    <div className="pointer-events-auto w-[280px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/10 bg-zinc-950/80 p-4 text-zinc-100 shadow-2xl backdrop-blur-md">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wider text-zinc-300">GAUGE STATION · x = 150 m</h2>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${phase.cls}`}>
          {phase.text}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-y-1 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-white/5 py-0.5">
            <span className="text-zinc-400">{k}</span>
            <span className="font-mono tabular-nums text-teal-300">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 rounded-lg border border-white/10 bg-black/30 p-1.5">
        <p className="px-1 pb-1 text-[9px] tracking-wider text-zinc-500">
          FLOOD HYDROGRAPH — discharge vs time
        </p>
        <Hydrograph data={hydro} peak={stats?.qPeak ?? 300} />
      </div>
      {stats && stats.vmax > 6 && (
        <p className="mt-2 rounded bg-red-950/60 px-2 py-1 text-[10px] text-red-300">
          ⚠ Supercritical flow downstream — flood wave propagating at {stats.vmax.toFixed(1)} m/s
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ speed legend
export function SpeedLegend() {
  return (
    <div className="pointer-events-auto rounded-lg border border-white/10 bg-zinc-950/80 px-3 py-2 text-[10px] text-zinc-300 shadow-xl backdrop-blur-md">
      <p className="mb-1 tracking-wider">FLOW SPEED · m/s</p>
      <div
        className="h-2 w-44 rounded-sm"
        style={{
          background:
            'linear-gradient(to right, rgb(0,0,128), rgb(0,192,240), rgb(96,240,96), rgb(240,240,64), rgb(240,80,24), rgb(128,0,32))',
        }}
      />
      <div className="mt-0.5 flex w-44 justify-between font-mono text-zinc-400">
        <span>0</span>
        <span>4.5</span>
        <span>9+</span>
      </div>
    </div>
  );
}
