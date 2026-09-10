'use client';

import type { ReactNode } from 'react';

// ---- design tokens: dark navy engineering dashboard, cyan water accents
export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`pointer-events-auto rounded-lg border border-cyan-100/10 bg-[#0a1526]/90 shadow-2xl backdrop-blur-md ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}

export function Row({ k, v, accent = 'text-cyan-300' }: { k: string; v: ReactNode; accent?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-[3px] text-[11px] last:border-0">
      <span className="text-slate-400">{k}</span>
      <span className={`font-mono tabular-nums ${accent}`}>{v}</span>
    </div>
  );
}

export function KPI({
  label,
  value,
  unit,
  tone = 'cyan',
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'cyan' | 'amber' | 'red' | 'green' | 'slate';
  sub?: string;
}) {
  const tones: Record<string, { bd: string; tx: string }> = {
    cyan: { bd: 'border-cyan-400/60', tx: 'text-cyan-300' },
    amber: { bd: 'border-amber-400/60', tx: 'text-amber-300' },
    red: { bd: 'border-red-500/60', tx: 'text-red-300' },
    green: { bd: 'border-emerald-400/60', tx: 'text-emerald-300' },
    slate: { bd: 'border-slate-400/40', tx: 'text-slate-200' },
  };
  const t = tones[tone];
  return (
    <div className={`rounded border border-white/5 border-l-2 ${t.bd} bg-white/[0.03] px-2.5 py-1.5`}>
      <p className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`font-mono text-[15px] font-semibold leading-tight tabular-nums ${t.tx}`}>
        {value}
        {unit && <span className="ml-0.5 text-[9px] font-normal text-slate-400">{unit}</span>}
      </p>
      {sub && <p className="mt-0.5 text-[9px] text-slate-500">{sub}</p>}
    </div>
  );
}

export function Chip({
  kind,
  children,
}: {
  kind: 'live' | 'forecast' | 'simulated' | 'historical' | 'ok' | 'warn' | 'crit';
  children: ReactNode;
}) {
  const map: Record<string, string> = {
    live: 'bg-emerald-900/50 text-emerald-300 border-emerald-500/40',
    forecast: 'bg-sky-900/50 text-sky-300 border-sky-500/40',
    simulated: 'bg-amber-900/40 text-amber-300 border-amber-500/30',
    historical: 'bg-violet-900/50 text-violet-300 border-violet-500/40',
    ok: 'bg-emerald-900/40 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-900/50 text-amber-300 border-amber-500/40',
    crit: 'bg-red-900/60 text-red-300 border-red-500/50',
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[8.5px] font-semibold tracking-[0.1em] ${map[kind]}`}>
      {children}
    </span>
  );
}

export function Bar({ frac, tone = 'cyan' }: { frac: number; tone?: 'cyan' | 'amber' | 'red' }) {
  const cols: Record<string, string> = {
    cyan: 'bg-gradient-to-r from-cyan-600 to-cyan-400',
    amber: 'bg-gradient-to-r from-amber-600 to-amber-400',
    red: 'bg-gradient-to-r from-red-600 to-red-400',
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-white/10">
      <div className={`h-full ${cols[tone]}`} style={{ width: `${Math.min(Math.max(frac, 0), 1) * 100}%` }} />
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{children}</p>;
}

export function LevelTag({ level }: { level: string }) {
  const map: Record<string, string> = {
    NORMAL: 'text-emerald-300',
    ELEVATED: 'text-yellow-300',
    HIGH: 'text-amber-300',
    EXTREME: 'text-red-300',
    LOW: 'text-emerald-300',
    MODERATE: 'text-yellow-300',
  };
  return <span className={`font-mono text-[10px] font-semibold ${map[level] ?? 'text-slate-300'}`}>{level}</span>;
}

// flow-speed / depth / arrival legends
export function GradientLegend({
  title,
  stops,
  labels,
}: {
  title: string;
  stops: string[];
  labels: string[];
}) {
  return (
    <div className="pointer-events-auto rounded-lg border border-white/10 bg-[#0a1526]/90 px-3 py-2 text-[10px] text-slate-300 shadow-xl backdrop-blur-md">
      <p className="mb-1 tracking-[0.14em] text-cyan-200/80">{title}</p>
      <div className="h-2 w-44 rounded-sm" style={{ background: `linear-gradient(to right, ${stops.join(',')})` }} />
      <div className="mt-0.5 flex w-44 justify-between font-mono text-slate-400">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}
