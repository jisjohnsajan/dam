// Sanity check for the circular-bowl terrain rewrite.
import { bedAt, DAM_X, RES_LEVEL, BOWL_CX, BOWL_R, LX, LZ } from '../src/lib/dam/terrain';

const r = (x: number, z: number) => Math.hypot(x - BOWL_CX, z);

console.log('--- 1. bowl floor flatness (r < 40, excluding river band |z|<12) ---');
let maxFloorSlope = 0;
for (const a of [0.3, 0.8, 1.3, 1.8, 2.4, 2.9]) {
  const x = BOWL_CX + 36 * Math.cos(a), z = 36 * Math.sin(a);
  const h = bedAt(x, z);
  const h2 = bedAt(BOWL_CX + 30 * Math.cos(a), 30 * Math.sin(a));
  maxFloorSlope = Math.max(maxFloorSlope, Math.abs(h - h2));
  console.log(`a=${a.toFixed(1)}  bed(${x.toFixed(0)},${z.toFixed(0)})=${h.toFixed(1)}m`);
}
console.log('max radial rise 30m->36m:', maxFloorSlope.toFixed(2), 'm (should be small <4)');

console.log('\n--- 2. rim rises all around beyond r=47 (angles sampled) ---');
for (const a of [0, 0.5, 1.0, 1.57, 2.2, 2.8, 3.5, 4.2, 4.7, 5.5]) {
  const x = BOWL_CX + 68 * Math.cos(a), z = 68 * Math.sin(a);
  const inside = bedAt(BOWL_CX + 38 * Math.cos(a), 38 * Math.sin(a));
  const outside = bedAt(x, z);
  const inDomain = x >= 0 && x <= LX && Math.abs(z) <= LZ / 2;
  console.log(`a=${a.toFixed(1)} r=38:${inside.toFixed(1)}m r=68:${outside.toFixed(1)}m (r=${r(x, z).toFixed(0)}) ${inDomain ? 'in-domain' : 'far'}`);
}

console.log('\n--- 3. river corridor open along z=0 (no wall blocking the exit) ---');
for (const x of [122, 135, 150, 165, 180, 190]) {
  console.log(`x=${x} z=0: bed=${bedAt(x, 0).toFixed(1)}m  z=8: ${bedAt(x, 8).toFixed(1)}m  z=20: ${bedAt(x, 20).toFixed(1)}m  z=35: ${bedAt(x, 35).toFixed(1)}m  z=52: ${bedAt(x, 52).toFixed(1)}m`);
}

console.log('\n--- 4. reservoir: bulge roundness + dam abutments ---');
for (const x of [20, 40, 64, 90, 108]) {
  // find shoreline: first |z| where bed > RES_LEVEL
  let shore = -1;
  for (let z = 0; z < 56; z += 0.5) { if (bedAt(x, z) > RES_LEVEL) { shore = z; break; } }
  console.log(`x=${x} reservoir half-width≈${shore < 0 ? '>56' : shore}m`);
}
for (const z of [-40, -33, 33, 40, 45]) {
  console.log(`abutment (113,${z}): bed=${bedAt(113, z).toFixed(1)}m  (121,${z}): ${bedAt(121, z).toFixed(1)}m`);
}

console.log('\n--- 5. dam site structure band stays below crest where needed ---');
let maxBedUnderDam = -1e9;
for (let z = -30; z <= 30; z += 1) maxBedUnderDam = Math.max(maxBedUnderDam, bedAt(114, z));
console.log('max bed under dam footprint (z -30..30):', maxBedUnderDam.toFixed(1), 'm (crest 23)');

console.log('\n--- 6. city building grounds inside bowl (sample ring positions) ---');
let bad = 0;
for (let ri = 0; ri < 9; ri++) {
  const r0 = 16 + ri * 3.5;
  for (let i = 0; i < 20; i++) {
    const a = -1.88 + (3.76 * i) / 19;
    const x = BOWL_CX + r0 * Math.cos(a), z = r0 * Math.sin(a);
    if (Math.abs(z) < 12.4) continue;
    const g = bedAt(x, z);
    if (g < 3.3 || g > 16.5) { bad++; if (bad < 8) console.log(`  OUT r=${r0} a=${a.toFixed(2)} (${x.toFixed(0)},${z.toFixed(0)}) ground=${g.toFixed(1)}m`); }
  }
}
console.log('building spots out of ground range:', bad, '/ ~full set');
