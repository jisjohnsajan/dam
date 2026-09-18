// Numeric validation of the diagonal terrain design
import {
  bedAt, xz2st, st2xz, buildStructBase, buildInitState,
  DAM_S, DAM_TOE_S, T_DAM0, T_DAM1, BLOCK_Z0, BLOCK_Z1, SPILL_Z0, SPILL_Z1,
  RES_LEVEL, CREST, axisT, APRON_T, LX, LZ, NX, NZ, DX, DZ,
} from '../src/lib/dam/terrain';

const R = RES_LEVEL;
let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log((cond ? '  OK  ' : '  FAIL') + ' ' + msg);
  if (!cond) fails++;
};

console.log('--- reservoir covers inflow source band (bed < 14.5, water at R) ---');
for (const [x, z] of [[1.6, -3.6], [6, -3.6], [1.6, 3.6], [6, 3.6], [4, 0]] as const) {
  const b = bedAt(x, z);
  const [s, t] = xz2st(x, z);
  ok(b < 14.5, `band (${x},${z}) bed=${b.toFixed(2)} s=${s.toFixed(1)} t=${t.toFixed(1)}`);
}

console.log('--- lake pocket is water (bed < R) at sample points ---');
for (const [s, t] of [[30, -20], [40, -30], [50, -40], [55, -50], [20, 0], [10, 5], [45, 0]] as const) {
  const [x, z] = st2xz(s, t);
  const b = bedAt(x, z);
  ok(b < R - 1, `lake s=${s} t=${t} world=(${x.toFixed(1)},${z.toFixed(1)}) bed=${b.toFixed(2)}`);
}

console.log('--- lake shore rises above water (no spill NE / wedge dry) ---');
for (const [s, t, lbl] of [[55, 5, 'NE shore near dam'], [61.5, -3, 'NE massif'], [63, -63, 'SW wedge'], [58, 12, 'NE shore mid']] as const) {
  const [x, z] = st2xz(s, t);
  if (x < 0 || x > LX || z < -80 || z > 80) { console.log('  SKIP  outside', lbl); continue; }
  const b = bedAt(x, z);
  ok(b > R + 1.5, `${lbl} s=${s} t=${t} bed=${b.toFixed(2)}`);
}

console.log('--- dam struct band crest / blocks / spill ---');
const sb = buildStructBase();
const at = (x: number, z: number) => {
  const i = Math.min(NX - 1, Math.max(0, Math.floor(x / DX)));
  const j = Math.min(NZ - 1, Math.max(0, Math.floor((z + LZ / 2) / DZ)));
  return sb[j * NX + i];
};
ok(Math.abs(at(...st2xz(DAM_S + 1.5, -20).map((v, i) => i === 1 ? Math.round((v + 80) / DZ) * DZ - 80 + DZ / 2 : Math.round(v / DX) * DX + DX / 2) as [number, number]) - CREST) < 0.3, `holding section crest ≈ 23`);
const [bx, bz] = st2xz(DAM_S + 1.5, -22);
ok(Math.abs(at(bx, bz) - CREST) < 0.3, `block zone crest=${at(bx, bz).toFixed(2)} @(${bx.toFixed(1)},${bz.toFixed(1)})`);
const [sx, sz] = st2xz(DAM_S + 1.5, -46);
ok(Math.abs(at(sx, sz) - 22.8) < 0.3, `spillway sill crest=${at(sx, sz).toFixed(2)} @(${sx.toFixed(1)},${sz.toFixed(1)})`);
const [nx2, nz2] = st2xz(DAM_S + 4, 2);
ok(at(nx2, nz2) < -500 && bedAt(nx2, nz2) > R + 2, `no struct NE of dam end, massif dry (bed=${bedAt(nx2, nz2).toFixed(1)})`);

console.log('--- downstream channel + floodplain ---');
for (const s of [80, 100, 130, 160, 200, 220]) {
  const t = axisT(s);
  const [x, z] = st2xz(s, t);
  const b = bedAt(x, z);
  ok(b < 11, `channel at s=${s} world=(${x.toFixed(0)},${z.toFixed(0)}) bed=${b.toFixed(2)}`);
}
for (const [s, t] of [[110, -35], [150, 20], [180, -20], [200, 10], [150, -30], [170, 8]] as const) {
  const [x, z] = st2xz(s, t);
  const b = bedAt(x, z);
  ok(b < 9.5 && b > 2.5, `floodplain s=${s} t=${t} bed=${b.toFixed(2)}`);
}

console.log('--- town/industry/farm benches are buildable ---');
const zones: [string, number, number][] = [
  ['town core', 112, -22], ['town low', 100, -38], ['village', 88, -8],
  ['village far', 82, -14], ['industrial', 118, 10], ['agri low', 100, 12],
  ['agri mid', 112, 22], ['agri far', 124, 34], ['SW bench', 112, -42],
  ['substation', 136, -52], ['highway mid', 122, 12],
];
for (const [lbl, s, t] of zones) {
  const [x, z] = st2xz(s, t);
  const b = bedAt(x, z);
  const sl = Math.abs(bedAt(x + 2, z) - b) + Math.abs(bedAt(x, z + 2) - b);
  ok(b > 3 && b < 16 && sl < 2.4, `${lbl} world=(${x.toFixed(0)},${z.toFixed(0)}) bed=${b.toFixed(2)} slope=${sl.toFixed(2)}`);
}

console.log('--- init state: lake filled + channel river ---');
const init = buildInitState();
const iat = (x: number, z: number) => {
  const i = Math.min(NX - 1, Math.max(0, Math.floor(x / DX)));
  const j = Math.min(NZ - 1, Math.max(0, Math.floor((z + LZ / 2) / DZ)));
  return init[(j * NX + i) * 4];
};
ok(Math.abs(iat(...st2xz(40, -30)) - R) < 0.1, `lake cell at level ${iat(...st2xz(40, -30)).toFixed(2)}`);
ok(Math.abs(iat(...st2xz(58, -55)) - R) < 0.1, `SW lobe (source band zone) at level`);
const [rx, rz] = st2xz(120, axisT(120));
ok(iat(rx, rz) > bedAt(rx, rz), `river water in channel at s=120`);
const [dx2, dz2] = st2xz(110, -40);
ok(iat(dx2, dz2) < bedAt(dx2, dz2), `floodplain dry at rest`);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECKS FAILED`);
process.exit(fails === 0 ? 0 : 1);
