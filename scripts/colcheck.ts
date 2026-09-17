import { bedAt, terrainColor } from '/home/z/my-project/src/lib/dam/terrain';
const pts: [number, number][] = [[200, 80], [150, 100], [250, 150], [146, 90], [90, -80], [180, 200], [220, 60], [150, 70]];
for (const [x, z] of pts) {
  // replicate farBed's clamped bed + far rise quickly via bedAt at clamped coords
  const cx = Math.min(Math.max(x, 0.2), 191.8);
  const cz = Math.min(Math.max(z, -55.8), 55.8);
  let h = bedAt(cx, cz);
  const dUp = Math.max(-x, 0), dDown = Math.max(x - 192, 0), dN = Math.max(-56 - z, 0), dS = Math.max(z - 56, 0);
  const rise = Math.max(
    dUp > 0 ? (1 - Math.exp(-dUp / 55)) * 60 : 0,
    dDown > 34 ? (1 - Math.exp(-(dDown - 34) / 60)) * 70 : 0,
    dN > 0 ? (1 - Math.exp(-dN / 48)) * 72 : 0,
    dS > 0 ? (1 - Math.exp(-dS / 70)) * 38 : 0,
  );
  h += rise;
  const e = 3.2;
  const sl = Math.hypot(bedAt(Math.min(cx + e, 191.8), cz) - bedAt(Math.max(cx - e, 0.2), cz), bedAt(cx, Math.min(cz + e, 55.8)) - bedAt(cx, Math.max(cz - e, -55.8))) / (2 * e);
  const tc = { r: 0, g: 0, b: 0 };
  terrainColor(x, z, h, sl, tc);
  console.log(`(${x},${z}) h=${h.toFixed(1)} slope=${sl.toFixed(2)} rgb=(${tc.r.toFixed(2)},${tc.g.toFixed(2)},${tc.b.toFixed(2)})`);
}
