// DAMSAFE 3D — world dressing for the DIAGONAL CORNER map (reference layout):
// powerhouse at the dam toe, the downstream town on the left bank of the
// diagonal river, village upstream, agricultural bench, industrial estate,
// highway with the river bridge, power substation, farmland and the far
// terrain ring that closes the horizon beyond the solver domain.
//
// Layout (rotated frame s = downstream / t = cross-valley, see terrain.ts):
// dam + reservoir in the TOP-LEFT corner facing diagonally down-right, the
// river meanders to the BOTTOM-RIGHT exit through a broad floodplain, town on
// the south-west bank, village + industry + farms on the north-east bench.
//
// Everything here is VISUAL dressing: the GPU shallow-water solver keeps
// running on its own domain, so the powerhouse/town sit on bedAt() ground and
// the flood wave genuinely reaches them during scenarios.
import * as THREE from 'three';
import { LX, LZ, bedAt, terrainColor, fbm, st2xz, xz2st, axisT, DAM_S, DAM_TOE_S, SC, CREST, RES_LEVEL } from './terrain';

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

function hashRnd(i: number): number {
  const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// rotated-frame shortcut + range helper
const STP = (s: number, t: number): [number, number] => st2xz(s, t);
const range = (a: number, b: number, step: number): number[] => {
  const r: number[] = [];
  for (let v = a; v <= b + 1e-6; v += step) r.push(v);
  return r;
};

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// shared materials (kept local so world dressing disposes with the scene)
const matConcrete = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0xa8a296, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.3 });
const matConcreteDark = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x8b857a, roughness: 0.92, metalness: 0.02 });
const matSteel = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x66707a, roughness: 0.45, metalness: 0.62 });
const matGalvanised = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.55, metalness: 0.5 });
const matWhite = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0xdcd8cc, roughness: 0.75 });
const matDark = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x2c3438, roughness: 0.6, metalness: 0.3 });

// ============================================================ POWERHOUSE
// Authored in the rotated LOCAL dam frame (u downstream, w along-crest,
// w = -t) and mounted with rotation.y = -45° at the corner — the whole
// complex faces diagonally down the valley like the dam itself.
export interface PowerhouseProps {
  group: THREE.Group;
  rotors: THREE.Group[]; // spinning generator flywheels
}

// local (u,w) → world, plus the ground elevation there
function damXZ(u: number, w: number): [number, number] {
  return [DAM_S * SC + (u - w) * SC, DAM_S * SC - LZ / 2 + (u + w) * SC];
}
function damBed(u: number, w: number): number {
  const [x, z] = damXZ(u, w);
  return bedAt(x, z);
}

function makePylon(h: number): THREE.Group {
  const g = new THREE.Group();
  const mat = matGalvanised();
  const base = 1.5;
  const top = 0.45;
  // 4 splayed legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, h, 5), mat);
      const lx = (sx * (base + (top - base) * 0.5)) / 2;
      const lz = (sz * (base + (top - base) * 0.5)) / 2;
      leg.position.set(lx, h / 2, lz);
      leg.rotation.z = -sx * 0.115;
      leg.rotation.x = sz * 0.115;
      leg.castShadow = true;
      g.add(leg);
    }
  }
  // cross-braces on both faces (2 levels)
  for (const lvl of [0.3, 0.62]) {
    for (const sz of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(base * (1 - lvl * 0.55), 0.06, 0.06), mat);
      brace.position.set(0, h * lvl, (sz * base * (1 - lvl * 0.55)) / 2);
      brace.rotation.z = sz * 0.5;
      g.add(brace);
    }
  }
  // cross-arms (two levels) + peak
  const arm1 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.09, 0.09), mat);
  arm1.position.y = h * 0.8;
  const arm2 = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.09, 0.09), mat);
  arm2.position.y = h * 0.93;
  const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, h * 0.1, 5), mat);
  peak.position.y = h * 1.04;
  arm1.castShadow = arm2.castShadow = true;
  g.add(arm1, arm2, peak);
  return g;
}

function makeCable(a: THREE.Vector3, b: THREE.Vector3, sag: number, mat: THREE.Material): THREE.Mesh {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const geo = new THREE.TubeGeometry(curve, 20, 0.035, 5, false);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  return m;
}

export function buildPowerhouse(): PowerhouseProps {
  const group = new THREE.Group();
  const rotors: THREE.Group[] = [];
  const conc = matConcrete();
  const concDark = matConcreteDark();
  const steel = matSteel();

  // ---- intake tower in the reservoir (just upstream of the dam face)
  const intake = new THREE.Group();
  const iU = -5.2, iW = 24; // local dam frame (upstream of the face)
  const iBed = damBed(iU, iW);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 15, 4.6), conc);
  tower.position.set(iU, iBed + 6.6, iW); // top ≈ 25.1 (2 m above crest)
  tower.castShadow = tower.receiveShadow = true;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.32, 5.5), concDark);
  deck.position.set(iU, iBed + 14.0, iW);
  deck.castShadow = true;
  intake.add(tower, deck);
  // gantry hoist on the deck
  for (const dw of [-1.7, 1.7]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), steel);
    col.position.set(iU - 1.2, iBed + 15.3, iW + dw);
    intake.add(col, col.clone().translateX(2.4));
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.2), steel);
  beam.position.set(iU, iBed + 16.5, iW);
  const hoist = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.55), matDark());
  hoist.position.set(iU, iBed + 16.0, iW);
  intake.add(beam, hoist);
  // trash racks on the upstream face
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.4, 4.0), matDark());
  rackFrame.position.set(iU - 1.85, iBed + 6.4, iW);
  intake.add(rackFrame);
  for (let k = 0; k < 10; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 6.2, 0.09), steel);
    bar.position.set(iU - 1.92, iBed + 6.4, iW - 1.8 + k * 0.4);
    intake.add(bar);
  }
  // dark intake openings facing the dam + wet well rim
  for (const oy of [2.0, 4.6]) {
    const open = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 1.5), matDark());
    open.position.set(iU + 1.85, iBed + oy, iW);
    intake.add(open);
  }
  group.add(intake);

  // service bridge intake → crest
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.24, 2.1), concDark);
  bridge.position.set(iU + 3.4, iBed + 14.0, iW);
  bridge.castShadow = true;
  group.add(bridge);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 0.05), steel);
    rail.position.set(iU + 3.4, iBed + 14.42, iW + s * 0.95);
    group.add(rail);
  }

  // exposed conduit across the upstream face (tower → dam body, submerged)
  const feedCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(iU + 1.6, iBed + 7.1, iW),
    new THREE.Vector3(iU + 3.4, iBed + 7.1, iW),
    new THREE.Vector3(iU + 5.3, iBed + 7.1, iW),
  ]);
  const feed = new THREE.Mesh(new THREE.TubeGeometry(feedCurve, 8, 0.52, 10, false), steel);
  group.add(feed);

  // ---- penstocks down the downstream face → powerhouse
  const penMat = matSteel();
  const penW = [25.6, 22.4];
  for (const w of penW) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(4.9, 19.4, w),
      new THREE.Vector3(6.4, 15.8, w),
      new THREE.Vector3(8.1, 12.9, w),
      new THREE.Vector3(10.9, 12.4, w),
    ]);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.52, 12, false), penMat);
    pipe.castShadow = true;
    group.add(pipe);
    // ring collars
    for (const t of [0.3, 0.55, 0.8]) {
      const p = curve.getPoint(t);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 12), penMat);
      collar.position.copy(p);
      collar.rotation.x = Math.PI / 2 - 0.35;
      group.add(collar);
    }
  }

  // ---- powerhouse hall at the toe (open downstream bay showing the units)
  const ph = new THREE.Group();
  const phBed = damBed(14.3, 24);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.5, 10.2), concDark);
  floor.position.set(14.3, phBed + 0.25, 24);
  floor.receiveShadow = true;
  ph.add(floor);
  const wallH = 5.4;
  const backW = new THREE.Mesh(new THREE.BoxGeometry(0.35, wallH, 10.2), conc);
  backW.position.set(10.65, phBed + wallH / 2, 24);
  backW.castShadow = backW.receiveShadow = true;
  const sideA = new THREE.Mesh(new THREE.BoxGeometry(7.8, wallH, 0.35), conc);
  sideA.position.set(14.3, phBed + wallH / 2, 19.0);
  const sideB = sideA.clone();
  sideB.position.z = 29.0;
  ph.add(backW, sideA, sideB);
  // open front: columns + lintel
  for (const dw of [19.4, 28.6]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, wallH, 0.5), conc);
    col.position.set(18.0, phBed + wallH / 2, dw);
    col.castShadow = true;
    ph.add(col);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 10.2), conc);
  lintel.position.set(18.0, phBed + wallH - 0.55, 24);
  lintel.castShadow = true;
  ph.add(lintel);
  // roof + monitor
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.32, 10.9), matWhite());
  roof.position.set(14.3, phBed + wallH + 0.35, 24);
  roof.castShadow = true;
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 7.0), matSteel());
  monitor.position.set(14.3, phBed + wallH + 0.85, 24);
  ph.add(roof, monitor);
  // crane rail inside
  for (const dw of [19.7, 28.3]) {
    const railB = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 0.14), steel);
    railB.position.set(14.3, phBed + wallH - 0.25, dw);
    ph.add(railB);
  }
  // sign
  const signTex = canvasTex(256, 64, (c) => {
    c.fillStyle = '#e8e4d8';
    c.fillRect(0, 0, 256, 64);
    c.fillStyle = '#173a4a';
    c.font = 'bold 30px Arial';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('POWERHOUSE', 128, 34);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 0.85),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7 }),
  );
  sign.position.set(18.36, phBed + wallH - 0.55, 24);
  sign.rotation.y = Math.PI / 2;
  ph.add(sign);
  group.add(ph);

  // ---- 2 turbine-generator units (visible through the open bay)
  for (const uw of [26.4, 21.6]) {
    const unit = new THREE.Group();
    // spiral casing
    const casing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.36, 10, 22), steel);
    casing.rotation.x = Math.PI / 2;
    casing.position.y = phBed + 1.35;
    casing.castShadow = true;
    // generator barrel
    const gen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.88, 0.88, 1.8, 16),
      new THREE.MeshStandardMaterial({ color: 0x2f5a78, roughness: 0.42, metalness: 0.45 }),
    );
    gen.position.y = phBed + 2.9;
    gen.castShadow = true;
    // rotating flywheel + spokes (visible above the generator)
    const rotor = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), matDark());
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 20), new THREE.MeshStandardMaterial({ color: 0xc7b25a, roughness: 0.4, metalness: 0.6 }));
    wheel.rotation.x = Math.PI / 2;
    rotor.add(hub, wheel);
    for (let k = 0; k < 4; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.07), matDark());
      spoke.rotation.y = (k * Math.PI) / 4;
      rotor.add(spoke);
    }
    rotor.position.set(0, phBed + 4.05, 0);
    rotors.push(rotor);
    unit.add(casing, gen, rotor);
    unit.position.set(13.6, 0, uw);
    group.add(unit);
    // draft tube exit through the back wall
    const draft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), concDark);
    draft.position.set(10.2, phBed + 0.75, uw);
    group.add(draft);
  }

  // ---- tailrace guide walls
  for (const [w0, w1] of [[27.6, 26.2], [20.4, 21.8]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.7, 0.4), concDark);
    const mu = 21.4;
    const mw = (w0 + w1) / 2;
    wall.position.set(mu, damBed(mu, mw) + 0.6, mw);
    wall.rotation.y = Math.atan2(w1 - w0, 6.2) * -1;
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
  }

  // ---- transformer yard + switch gantry
  const yard = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.22, 6.2), new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.98 }));
  pad.position.set(21.2, damBed(21.2, 13.5) + 0.11, 13.5);
  pad.receiveShadow = true;
  yard.add(pad);
  for (const dw of [15.2, 11.8]) {
    const tr = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.7, 1.5), matGalvanised());
    body.position.y = 1.0;
    body.castShadow = true;
    tr.add(body);
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 1.3), matSteel());
      fin.position.set(-0.7 + f * 0.45, 1.0, 0);
      tr.add(fin);
    }
    for (const bx of [-0.55, 0, 0.55]) {
      const bush = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0xb9ae90, roughness: 0.5 }));
      bush.position.set(bx, 2.1, 0);
      tr.add(bush);
    }
    tr.position.set(20.2, pad.position.y, dw);
    yard.add(tr);
  }
  // switch gantry + first cable anchor
  for (const dw of [16.0, 11.0]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.0, 6), matGalvanised());
    col.position.set(24.4, damBed(24.4, dw) + 3.5, dw);
    col.castShadow = true;
    yard.add(col);
  }
  const gBeam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 5.4), matGalvanised());
  gBeam.position.set(24.4, damBed(24.4, 13.5) + 6.9, 13.5);
  yard.add(gBeam);
  group.add(yard);

  // ---- transmission line: powerhouse → town substation (down the NE bank)
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x30343a });
  // local (u,w) anchors along the valley (w = -t)
  const anchors: { u: number; w: number; h: number }[] = [
    { u: 24.4, w: 13.5, h: 7.0 },
    { u: 33, w: 12, h: 12.5 },
    { u: 47, w: 10, h: 13.0 },
    { u: 61, w: 8, h: 13.0 },
    { u: 75, w: 6, h: 12.5 },
    { u: 88, w: 5, h: 10.0 },
  ];
  const toV = (a: { u: number; w: number; h: number }, frac: number): THREE.Vector3 => {
    const [x, z] = damXZ(a.u, a.w);
    return new THREE.Vector3(x, bedAt(x, z) + a.h * frac, z);
  };
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i];
    const py = makePylon(b.h);
    const [px, pz] = damXZ(b.u, b.w);
    py.position.set(px, bedAt(px, pz) - 0.2, pz);
    group.add(py);
  }
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    const ya = bedAt(...damXZ(a.u, a.w)) + a.h * 0.9;
    const yb = bedAt(...damXZ(b.u, b.w)) + b.h * 0.9;
    const [ax, az] = damXZ(a.u, a.w);
    const [bx, bz] = damXZ(b.u, b.w);
    for (const off of [-1.1, 0, 1.1]) {
      const n = new THREE.Vector3(-(bz - az), 0, bx - ax).normalize().multiplyScalar(off);
      const ca = new THREE.Vector3(ax + n.x, ya, az + n.z);
      const cb = new THREE.Vector3(bx + n.x, yb, bz + n.z);
      group.add(makeCable(ca, cb, 1.4 + off * 0.1, cableMat));
    }
  }

  // mount the whole powerhouse in the rotated corner frame
  group.rotation.y = -Math.PI / 4;
  group.position.set(DAM_S * SC, 0, DAM_S * SC - LZ / 2);

  return { group, rotors };
}

// ============================================================ CITY LAYOUT
interface StreetSeg { pts: [number, number][]; w: number }

// Square-canvas street network authored in the rotated frame: riverside drive
// hugging the channel's south-west bank (a CONSTANT 13 m offset from the
// channel axis), town grid aligned to the diagonal, village lanes, industrial
// spur, farm tracks and the north-south HIGHWAY crossing the river on the
// bridge (reference layout).
function buildStreets(): StreetSeg[] {
  const streets: StreetSeg[] = [];
  // riverside drive (SW bank of the channel, tracks the meander)
  streets.push({ pts: range(76, 150, 7.5).map((s) => STP(s, axisT(s) - 13)), w: 3.2 });
  // NE bank road (village + industrial side)
  streets.push({ pts: range(78, 150, 7.5).map((s) => STP(s, axisT(s) + 15.5)), w: 3.0 });
  // town grid — avenues (running down-valley)
  for (const t of [-44, -36, -28]) {
    streets.push({ pts: range(92, 152, 10).map((s) => STP(s, t)), w: 3.2 });
  }
  streets.push({ pts: range(124, 152, 7).map((s) => STP(s, -20)), w: 2.8 });
  // town grid — cross streets (climbing from the bench road to the river drive)
  for (const s of [96, 104, 112, 120, 128, 136, 144, 152]) {
    streets.push({ pts: [STP(s, -48), STP(s, axisT(s) - 14.5)], w: 2.8 });
  }
  // village lanes (right bench, upstream of the town)
  streets.push({ pts: range(78, 96, 4.5).map((s) => STP(s, axisT(s) + 11)), w: 2.2 });
  streets.push({ pts: [[76, -18], [82, -15], [88, -12], [94, -10]].map(([s, t]) => STP(s, t)), w: 2.0 });
  // dam access spur (village lane → dam NE abutment)
  streets.push({ pts: [STP(76, -6), STP(70, -4), STP(64.5, -3)], w: 2.4 });
  // industrial spur (from the NE bank road into the estate)
  streets.push({ pts: range(104, 130, 6.5).map((s) => STP(s, 8)), w: 2.6 });
  streets.push({ pts: [STP(112, 2), STP(112, 14)], w: 2.2 });
  // farm lanes — agricultural bench (NE) + south-west bench
  streets.push({ pts: range(86, 130, 7.5).map((s) => STP(s, 10)), w: 2.2 });
  streets.push({ pts: range(92, 126, 8.5).map((s) => STP(s, 22)), w: 2.0 });
  streets.push({ pts: range(104, 138, 8.5).map((s) => STP(s, -44)), w: 2.2 });
  // HIGHWAY: north rim → river bridge → south rim (reference right-side road)
  const hw: [number, number][] = [
    [86, 84], [92, 68], [98, 52], [106, 34], [114, 16], [120, 0],
    [126, -16], [132, -34], [138, -50], [144, -64], [150, -76],
  ];
  streets.push({ pts: hw.slice(0, 5).map(([s, t]) => STP(s, t)), w: 4.6 }); // north approach
  streets.push({ pts: hw.slice(5).map(([s, t]) => STP(s, t)), w: 4.6 }); // south approach
  return streets;
}
const TOWN_STREETS: StreetSeg[] = buildStreets();
// the highway span over the river (deck drawn in buildTown)
const HIGHWAY_SPAN: [number, number][] = [[114, 16], [120, 0], [126, -16], [130, -28]];

// clearance network: every street segment buildings must dodge
interface ClearSeg { ax: number; az: number; bx: number; bz: number }
const CLEAR_SEGS: ClearSeg[] = [];
function pushClear(pts: [number, number][]): void {
  for (let i = 0; i < pts.length - 1; i++)
    CLEAR_SEGS.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] });
}
for (const st of TOWN_STREETS) pushClear(st.pts);

function distToPaths(x: number, z: number): number {
  let best = 1e9;
  for (const s of CLEAR_SEGS) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// landmark / kept-site clearance rectangles in the ROTATED frame (s, t, w, d)
const CLEAR_RECTS: [number, number, number, number][] = [
  [114, -22, 8, 8], [108, -18, 8, 7], [124, -32, 22, 15], // plaza+clock, market, pitch
  [130, -22, 7, 7], [96, -30, 8, 7], [102, -24, 8, 7], // water tower, temple, park grove
  // farms — agricultural bench (NE)
  [88, 8, 12, 9], [96, 12, 12, 9], [104, 16, 12, 9], [112, 20, 12, 9],
  [120, 24, 12, 9], [128, 28, 12, 9], [100, 28, 12, 9], [116, 32, 11, 8],
  // farms — SW bench + lower east plain
  [106, -44, 12, 9], [116, -42, 12, 9], [126, -44, 12, 9], [134, -42, 11, 8],
  [146, -20, 11, 8], [156, -28, 11, 8], [164, -16, 11, 8],
  // civic landmark complexes (hospital / school / factory / waterworks / fuel)
  [120, -14, 15, 11], [106, -26, 13, 11], [118, -38, 21, 12], [88, -36, 11, 10],
  [132, -12, 10, 8], [128, -34, 9, 8], [146, -6, 12, 10],
  // industrial estate warehouses (NE bench beside the river)
  [106, 14, 13, 8], [114, 18, 13, 8], [122, 12, 13, 8],
  // landmark towers
  [110, -14, 7, 7], [128, -16, 7, 7], [136, -28, 7, 7], [104, -30, 7, 7], [124, -20, 7, 7],
];
function clearOfSites(x: number, z: number, m = 1.4): boolean {
  const [s, t] = xz2st(x, z);
  for (const [cs, ct, w, d] of CLEAR_RECTS)
    if (Math.abs(s - cs) < w / 2 + m && Math.abs(t - ct) < d / 2 + m) return false;
  return true;
}

// deck ribbon following an arbitrary elevation profile; returns the sampled
// centreline so callers can hang piers / dashes off it
function profileRibbon(
  group: THREE.Group, pts: [number, number][], w: number, mat: THREE.Material,
  yAt: (x: number, z: number, t: number) => number,
  castShadow = true,
): { x: number; z: number; y: number }[] {
  const n = Math.max(10, pts.length * 5);
  const P: { x: number; z: number; y: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const seg = Math.min(Math.floor(t * (pts.length - 1)), pts.length - 2);
    const lt = t * (pts.length - 1) - seg;
    const x = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * lt;
    const z = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * lt;
    P.push({ x, z, y: yAt(x, z, t) });
  }
  // smooth the elevation profile (endpoints pinned)
  for (let p = 0; p < 4; p++)
    for (let i = 1; i < P.length - 1; i++)
      P[i].y = (P[i - 1].y + 2 * P[i].y + P[i + 1].y) / 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(i - 1, 0)];
    const b = P[Math.min(i + 1, P.length - 1)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const dl = Math.hypot(dx, dz) || 1;
    const nx = (-dz / dl) * w * 0.5, nz = (dx / dl) * w * 0.5;
    pos.push(P[i].x - nx, P[i].y, P[i].z - nz, P[i].x + nx, P[i].y, P[i].z + nz);
    if (i > 0) {
      const q = (i - 1) * 2;
      idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return P;
}

function flatRibbon(group: THREE.Group, pts: [number, number][], w: number, mat: THREE.Material, lift = 0.14): void {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < 3; k++) {
      const t0 = k / 3, t1 = (k + 1) / 3;
      const x0 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t0;
      const z0 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t0;
      const x1 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t1;
      const z1 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t1;
      const dx = z1 - z0, dz = -(x1 - x0);
      const dl = Math.hypot(dx, dz) || 1;
      const nx = (dx / dl) * w * 0.5, nz = (dz / dl) * w * 0.5;
      const a = bedAt(x0 - nx, z0 - nz) + lift;
      const b = bedAt(x0 + nx, z0 + nz) + lift;
      const c = bedAt(x1 - nx, z1 - nz) + lift;
      const d = bedAt(x1 + nx, z1 + nz) + lift;
      const base = pos.length / 3;
      pos.push(x0 - nx, a, z0 - nz, x0 + nx, b, z0 + nz, x1 - nx, c, z1 - nz, x1 + nx, d, z1 + nz);
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function makeBuildingTex(): THREE.Texture {
  return canvasTex(128, 128, (c) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 128, 128);
    for (let ry = 0; ry < 4; ry++) {
      for (let rx = 0; rx < 4; rx++) {
        const lit = hashRnd(rx * 7 + ry * 13) > 0.55;
        c.fillStyle = lit ? 'rgba(255, 214, 140, 0.92)' : 'rgba(38, 52, 60, 0.85)';
        c.fillRect(10 + rx * 30, 12 + ry * 30, 17, 19);
      }
    }
  });
}

// mid-rise / glass-tower facades (8 window rows)
function makeTowerTex(glass: boolean): THREE.Texture {
  return canvasTex(128, 192, (c) => {
    c.fillStyle = glass ? '#aebcc6' : '#f0ede4';
    c.fillRect(0, 0, 128, 192);
    for (let ry = 0; ry < 8; ry++) {
      for (let rx = 0; rx < 4; rx++) {
        const lit = hashRnd(rx * 11 + ry * 29 + (glass ? 5.3 : 0)) > (glass ? 0.72 : 0.58);
        c.fillStyle = glass
          ? lit ? 'rgba(255, 232, 175, 0.95)' : 'rgba(54, 88, 112, 0.92)'
          : lit ? 'rgba(255, 214, 140, 0.92)' : 'rgba(40, 54, 64, 0.85)';
        c.fillRect(9 + rx * 30, 9 + ry * 23, 21, 14);
      }
    }
  });
}

function makePitchTex(): THREE.Texture {
  return canvasTex(256, 160, (c) => {
    c.fillStyle = '#3f7d3a';
    c.fillRect(0, 0, 256, 160);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      c.fillRect(i * 32, 0, 32, 160);
    }
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 3;
    c.strokeRect(8, 8, 240, 144);
    c.beginPath();
    c.moveTo(128, 8);
    c.lineTo(128, 152);
    c.stroke();
    c.beginPath();
    c.arc(128, 80, 26, 0, Math.PI * 2);
    c.stroke();
    c.strokeRect(8, 48, 30, 64);
    c.strokeRect(218, 48, 30, 64);
  });
}

function makeClockTex(): THREE.Texture {
  return canvasTex(128, 128, (c) => {
    c.fillStyle = '#f2ede0';
    c.beginPath();
    c.arc(64, 64, 56, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#22303a';
    c.lineWidth = 6;
    c.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.fillStyle = '#22303a';
      c.fillRect(64 + Math.cos(a) * 44 - 2, 64 + Math.sin(a) * 44 - 2, 4, 4);
    }
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(64, 64);
    c.lineTo(64, 26);
    c.stroke();
    c.beginPath();
    c.moveTo(64, 64);
    c.lineTo(90, 74);
    c.stroke();
  });
}

function makeAwningTex(): THREE.Texture {
  return canvasTex(128, 32, (c) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#c85a3c' : '#e8ddca';
      c.fillRect(i * 16, 0, 16, 32);
    }
  });
}

function makeFieldTex(a: string, b: string): THREE.Texture {
  return canvasTex(64, 64, (c) => {
    c.fillStyle = a;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = b;
    for (let y = 2; y < 64; y += 8) c.fillRect(0, y, 64, 3);
  });
}

// ------------------------------------------------------- floodable instances
export interface BSpot {
  x: number; z: number; w: number; d: number; h: number; rot: number; tone: number; ground: number;
}

export interface DistrictBldgs {
  mesh: THREE.InstancedMesh;
  roofMesh: THREE.InstancedMesh | null;
  roofOf: Int32Array; // building i → roof instance (or -1)
  spots: BSpot[];
  dmg: Float32Array; // 0 intact → 1 destroyed (engine-driven)
  tints: number[]; // base tint per instance
}

export interface FloodTrees {
  trunk: THREE.InstancedMesh;
  fol: THREE.InstancedMesh;
  spots: { x: number; z: number; ground: number; s: number; rot: number }[];
  prog: Float32Array; // 0 standing → 1 fallen (engine-driven)
  drift: Float32Array; // accumulated downstream wash, x/z per tree
}

// flood wreckage (broken slabs, timbers) scattered along the wave's path —
// hidden at rest, the engine surfaces each piece when the destructive flow
// (depth + velocity) reaches its spot, and it stays after the water recedes
export interface RubbleField {
  mesh: THREE.InstancedMesh;
  spots: { x: number; z: number; ground: number }[];
  mats: Float32Array; // final rest matrix per instance (16 floats each)
  prog: Float32Array; // 0 hidden → 1 settled (engine-driven)
}

export function buildTown(): { group: THREE.Group; districts: DistrictBldgs[]; floodTrees: FloodTrees; rubble: RubbleField } {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.95 });
  const paving = new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: 0.95 });

  // city street grid + riverside drive + farm lanes + highway
  for (const st of TOWN_STREETS) flatRibbon(group, st.pts, st.w, asphalt);

  // ---- HIGHWAY BRIDGE across the river (the config 'bridge' pin) ----------
  {
    const A = HIGHWAY_SPAN[0], B = HIGHWAY_SPAN[3];
    const [ax, az] = STP(...A);
    const [bx, bz] = STP(...B);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az) + 6;
    const yaw = Math.atan2(bx - ax, bz - az);
    const midBed = bedAt(...STP(122, axisT(122)));
    const deckY = midBed + 4.4;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.5, len), matConcrete());
    deck.position.set(mx, deckY, mz);
    deck.rotation.y = yaw;
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    const deckRoad = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.06, len), asphalt);
    deckRoad.position.set(mx, deckY + 0.28, mz);
    deckRoad.rotation.y = yaw;
    group.add(deckRoad);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.8 });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, len), railMat);
      rail.position.set(mx + Math.cos(yaw) * 2.3 * s, deckY + 0.55, mz - Math.sin(yaw) * 2.3 * s);
      rail.rotation.y = yaw;
      group.add(rail);
    }
    // piers down to the bed near the two banks
    for (const f of [0.3, 0.7]) {
      const px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
      const g = bedAt(px, pz);
      const hh = deckY - g + 0.6;
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, hh, 8), matConcrete());
      pier.position.set(px, g + hh / 2 - 0.3, pz);
      pier.castShadow = true;
      group.add(pier);
    }
    // approach fills joining the highway ribbons
    flatRibbon(group, [STP(...HIGHWAY_SPAN[0]), STP(...HIGHWAY_SPAN[1])], 4.6, asphalt, 0.9);
    flatRibbon(group, [STP(...HIGHWAY_SPAN[2]), STP(...HIGHWAY_SPAN[3])], 4.6, asphalt, 0.9);
  }

  // ---- dense districts (instanced, three building classes)
  const bldTex = makeBuildingTex();
  const lowMat = new THREE.MeshStandardMaterial({ map: bldTex, roughness: 0.85, metalness: 0.05 });
  const midMat = new THREE.MeshStandardMaterial({ map: makeTowerTex(false), roughness: 0.68, metalness: 0.1 });
  const glassMat = new THREE.MeshStandardMaterial({ map: makeTowerTex(true), roughness: 0.38, metalness: 0.35, envMapIntensity: 0.35 });
  const tones = [0xd9cdb4, 0xcbb99b, 0xd8d2c4, 0xc2b49a, 0xd3c1a6, 0xbfae94, 0xded6c6, 0xb7a68c];
  const glassTones = [0x8fa4b2, 0xa3b8c4, 0x7f98a8, 0xb0c2cc];
  const spotsL: BSpot[] = [];
  const spotsM: BSpot[] = [];
  const spotsH: BSpot[] = [];

  // deterministic scatter — districts fill the town plain on the SW bank plus
  // the village bench (NE) and the lower floodplain; t-bands marked `rel` are
  // resolved relative to the channel axis per-s
  const DISTRICTS: { s0: number; s1: number; t0: number; t1: number; mix: 'core' | 'mid' | 'low' | 'village'; rel?: 'ne' | 'sw' }[] = [
    { s0: 102, s1: 132, t0: -40, t1: -24, mix: 'core' },
    { s0: 112, s1: 140, t0: -24, t1: -15, mix: 'mid' },
    { s0: 92, s1: 104, t0: -46, t1: -25, mix: 'low' },
    { s0: 116, s1: 148, t0: -48, t1: -41, mix: 'low' },
    { s0: 78, s1: 96, t0: 13, t1: 24, mix: 'village', rel: 'ne' },
    { s0: 106, s1: 132, t0: 4, t1: 15, mix: 'village' },
    { s0: 138, s1: 158, t0: -27, t1: -16, mix: 'village', rel: 'sw' },
  ];
  let seed = 1;
  const nextRnd = () => hashRnd(seed++ * 12.9898);
  for (const d of DISTRICTS) {
    const step = d.mix === 'village' ? 6.2 : 4.6;
    for (let gs = d.s0; gs <= d.s1; gs += step) {
      const t0 = d.rel === 'ne' ? axisT(gs) + d.t0 : d.rel === 'sw' ? axisT(gs) + d.t0 : d.t0;
      const t1 = d.rel === 'ne' ? axisT(gs) + d.t1 : d.rel === 'sw' ? axisT(gs) + d.t1 : d.t1;
      for (let gt = t0; gt <= t1; gt += step) {
        const [x, z] = STP(gs, gt);
        if (Math.abs(gt - axisT(gs)) < 12.8) continue; // river channel
        if (distToPaths(x, z) < 2.7) continue;
        if (!clearOfSites(x, z)) continue;
        const ground = bedAt(x, z);
        if (ground < 3.2 || ground > (d.mix === 'village' ? 20 : 15.5)) continue;
        const slope = Math.abs(bedAt(x + 2, z) - ground) + Math.abs(bedAt(x, z + 2) - ground);
        if (slope > 2.4) continue;
        if (nextRnd() < (d.mix === 'village' ? 0.3 : 0.08)) continue;
        const rot = d.mix === 'village'
          ? -Math.PI / 4 + (nextRnd() - 0.5) * 0.8
          : -Math.PI / 4 + (nextRnd() - 0.5) * 0.12;
        const roll = nextRnd();
        if (d.mix === 'core' && roll < 0.26) {
          spotsH.push({ x, z, w: 3.9 + nextRnd() * 1.6, d: 3.5 + nextRnd() * 1.5, h: 13.5 + nextRnd() * 9, rot, tone: Math.floor(nextRnd() * glassTones.length), ground });
        } else if ((d.mix === 'core' && roll < 0.68) || (d.mix === 'mid' && roll < 0.55) || (d.mix === 'low' && roll < 0.3)) {
          spotsM.push({ x, z, w: 3.1 + nextRnd() * 1.4, d: 2.9 + nextRnd() * 1.3, h: 6.8 + nextRnd() * 6, rot, tone: Math.floor(nextRnd() * tones.length), ground });
        } else if (d.mix === 'village') {
          spotsL.push({ x, z, w: 2.0 + nextRnd() * 1.1, d: 1.9 + nextRnd() * 1.0, h: 2.2 + nextRnd() * 1.4, rot, tone: Math.floor(nextRnd() * tones.length), ground });
        } else {
          spotsL.push({ x, z, w: 2.6 + nextRnd() * 1.6, d: 2.4 + nextRnd() * 1.5, h: 2.8 + nextRnd() * 3.2, rot, tone: Math.floor(nextRnd() * tones.length), ground });
        }
      }
    }
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const col = new THREE.Color();
  const districts: DistrictBldgs[] = [];
  const buildClass = (spots: BSpot[], mat: THREE.Material, tint: number[], roofsToo: boolean): void => {
    if (!spots.length) return;
    const inst = new THREE.InstancedMesh(boxGeo, mat, spots.length);
    const roofOf = new Int32Array(spots.length).fill(-1);
    let roofMesh: THREE.InstancedMesh | null = null;
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8d867b, roughness: 0.95 });
    if (roofsToo) {
      let nRoofs = 0;
      for (const s of spots) if (hashRnd(s.x * 3.77 + s.z) >= 0.45) nRoofs++;
      roofMesh = new THREE.InstancedMesh(boxGeo, roofMat, Math.max(nRoofs, 1));
      roofMesh.count = 0;
    }
    spots.forEach((s, i) => {
      eu.set(0, s.rot, 0);
      q.setFromEuler(eu);
      m4.compose(new THREE.Vector3(s.x, s.ground + s.h / 2 - 0.12, s.z), q, new THREE.Vector3(s.w, s.h, s.d));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.setHex(tint[s.tone]));
      if (roofMesh && hashRnd(s.x * 3.77 + s.z) >= 0.45) {
        const ri = roofMesh.count;
        m4.compose(new THREE.Vector3(s.x, s.ground + s.h + 0.06, s.z), q.identity(), new THREE.Vector3(s.w + 0.35, 0.16, s.d + 0.35));
        roofMesh.setMatrixAt(ri, m4);
        roofOf[i] = ri;
        roofMesh.count++;
      }
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
    if (roofMesh) {
      roofMesh.castShadow = true;
      roofMesh.instanceMatrix.needsUpdate = true;
      group.add(roofMesh);
    }
    districts.push({ mesh: inst, roofMesh, roofOf, spots, dmg: new Float32Array(spots.length), tints: spots.map((s) => tint[s.tone]) });
  };
  buildClass(spotsL, lowMat, tones, true);
  buildClass(spotsM, midMat, tones, true);
  buildClass(spotsH, glassMat, glassTones, false);

  // ---- flood rubble along the wave's path ---------------------------------
  const rubbleSpots: { x: number; z: number; ground: number }[] = [];
  const rubbleElems: number[] = [];
  const pushRubble = (x: number, z: number, ground: number, big: number): void => {
    const sx = (0.7 + hashRnd(x * 5.3 + z) * 1.5) * big;
    const sy = (0.22 + hashRnd(x + z * 3.1) * 0.42) * big;
    const sz = (0.5 + hashRnd(x * 2.9 + z * 1.7) * 1.1) * big;
    const yaw = hashRnd(x * 9.7 + z * 4.3) * Math.PI;
    const tilt = 0.25 + hashRnd(x * 6.1 + z * 8.9) * 0.85;
    eu.set((hashRnd(x * 4.7 + z * 2.3) * 2 - 1) * tilt, yaw, (hashRnd(x * 8.3 + z * 5.9) * 2 - 1) * tilt);
    q.setFromEuler(eu);
    m4.compose(new THREE.Vector3(x, ground + sy * 0.5 + 0.1, z), q, new THREE.Vector3(sx, sy, sz));
    rubbleElems.push(...m4.elements);
    rubbleSpots.push({ x, z, ground });
  };
  for (const sp of [...spotsL, ...spotsM, ...spotsH]) {
    pushRubble(sp.x + 1.1 + hashRnd(sp.x + sp.z), sp.z + 0.9 + hashRnd(sp.z * 2 + sp.x), sp.ground, sp.h > 8 ? 1.5 : 1);
    pushRubble(sp.x - 1.0 + hashRnd(sp.x * 2 + sp.z), sp.z - 1.2 + hashRnd(sp.x + sp.z * 3), sp.ground, sp.h > 8 ? 1.3 : 0.9);
  }
  // corridor streaks: wreckage along the channel banks, stilling basin and
  // floodplain on the wave's way to the bottom-right exit
  for (let k = 0; k < 280; k++) {
    const s = 68 + hashRnd(k * 17.7) * 156;
    const t = axisT(s) + (hashRnd(k * 7.3) - 0.5) * 46;
    const [x, z] = STP(s, t);
    if (x < 2 || x > 158 || z < -78 || z > 78) continue;
    const g = bedAt(x, z);
    if (g < 2.8 || g > 9.5) continue;
    pushRubble(x + (hashRnd(k * 3.1) - 0.5) * 3, z + (hashRnd(k * 11.9) - 0.5) * 3, g, 0.8 + hashRnd(k * 5.7) * 0.9);
  }
  // house-spot set for vegetation collision (keeps trees off roofs)
  const houseSpots = [...spotsL, ...spotsM, ...spotsH];
  const nearHouse = (x: number, z: number, m = 2.4): boolean => {
    for (const s of houseSpots) if (Math.abs(s.x - x) < m && Math.abs(s.z - z) < m) return true;
    return false;
  };
  const rubbleMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
    Math.max(rubbleSpots.length, 1),
  );
  const rubbleTints = [0x8d857a, 0x7a6a58, 0x6e4f3a, 0x9a9186, 0x5d554a];
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  rubbleSpots.forEach((sp, i) => {
    rubbleMesh.setMatrixAt(i, zeroM);
    rubbleMesh.setColorAt(i, col.setHex(rubbleTints[Math.floor(hashRnd(sp.x * 3.3 + sp.z) * rubbleTints.length)]));
  });
  rubbleMesh.castShadow = true;
  rubbleMesh.frustumCulled = false;
  const rubble: RubbleField = {
    mesh: rubbleMesh,
    spots: rubbleSpots,
    mats: new Float32Array(rubbleElems),
    prog: new Float32Array(rubbleSpots.length),
  };
  group.add(rubbleMesh);

  // ---- landmark skyline towers (glass shafts + crowns + aviation beacons)
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff5540, emissive: 0xcc2200, emissiveIntensity: 1.4, roughness: 0.4 });
  for (const [ts, tt, th, gi] of [
    [110, -14, 24, 0], [128, -16, 21, 1], [136, -28, 18, 0], [104, -30, 19, 1], [124, -20, 16, 0],
  ] as const) {
    const [tx, tz] = STP(ts, tt);
    const tg = bedAt(tx, tz);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(4.4, th, 4.0), gi ? glassMat : midMat);
    shaft.rotation.y = -Math.PI / 4;
    shaft.position.y = th / 2 - 0.1;
    shaft.castShadow = shaft.receiveShadow = true;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.6, 4.4), matConcreteDark());
    crown.rotation.y = -Math.PI / 4;
    crown.position.y = th + 0.2;
    crown.castShadow = true;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 3.0, 6), matSteel());
    spire.position.y = th + 1.9;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), beaconMat);
    beacon.position.y = th + 3.4;
    const tG = new THREE.Group();
    tG.add(shaft, crown, spire, beacon);
    tG.position.set(tx, tg - 0.1, tz);
    group.add(tG);
  }

    // ---- city + forest trees (instanced, floodable — engine tilts them in
  // high-velocity flow) — street lines, district groves, riverbank gallery,
  // flank forests + the gorge woodland (reference FOREST AREA)
  let floodTrees: FloodTrees;
  {
    const treeSpots: { x: number; z: number; s: number }[] = [];
    const inChannel = (x: number, z: number): number => {
      const [s, t] = xz2st(x, z);
      return Math.abs(t - axisT(s));
    };
    // street tree lines along the avenues
    for (const st of TOWN_STREETS) {
      if (st.w < 2.6) continue;
      for (let i = 0; i < st.pts.length - 1; i++) {
        const [ax, az] = st.pts[i];
        const [bx, bz] = st.pts[i + 1];
        const segLen = Math.hypot(bx - ax, bz - az);
        const nT = Math.max(1, Math.floor(segLen / 6.2));
        for (let k = 0; k < nT; k++) {
          const t = (k + 0.5) / nT;
          for (const side of [1, -1]) {
            const x = ax + (bx - ax) * t + (hashRnd(ax * 7 + k * 3) - 0.5) * 1.4;
            const z = az + (bz - az) * t + side * 2.3 + (hashRnd(x * 3 + az) - 0.5);
            if (inChannel(x, z) < 13) continue;
            if (distToPaths(x, z) < 2.4) continue;
            if (hashRnd(x * 5.1 + z * 3.3) < 0.35) continue;
            const ground = bedAt(x, z);
            if (ground < 3.2 || ground > 17) continue;
            treeSpots.push({ x, z, s: 0.8 + hashRnd(x * 7 + z) * 0.5 });
          }
        }
      }
    }
    // groves filling district blocks
    for (const d of DISTRICTS) {
      const area = (d.s1 - d.s0) * (d.t1 - d.t0);
      for (let k = 0; k < Math.floor(area / 46); k++) {
        const gs = d.s0 + hashRnd(k * 13.3 + d.s0) * (d.s1 - d.s0);
        const gt0 = d.rel ? axisT(gs) + d.t0 : d.t0;
        const gt = gt0 + hashRnd(k * 7.7 + d.s0 * 2) * (d.t1 - d.t0);
        const [x, z] = STP(gs, gt);
        if (inChannel(x, z) < 13) continue;
        if (distToPaths(x, z) < 3.2) continue;
        if (!clearOfSites(x, z, 0.4)) continue;
        const ground = bedAt(x, z);
        if (ground < 3.2 || ground > 16.5) continue;
        if (hashRnd(x * 3.1 + z * 7.7) < 0.45) continue;
        treeSpots.push({ x, z, s: 0.75 + hashRnd(x * 5 + z) * 0.7 });
      }
    }
    // riverbank gallery — broadleaf along both banks of the diagonal channel
    for (let s = 76; s <= 218; s += 3.1) {
      const az = axisT(s);
      for (const side of [1, -1]) {
        const [x, z] = STP(s, az + side * (14 + hashRnd(s * side) * 4.5));
        if (x < 2 || x > 158 || z < -78 || z > 78) continue;
        // keep the gallery out of the farm plots on the NE bench
        if (side > 0) {
          const [fs, ft] = xz2st(x, z);
          if (fs > 86 && fs < 132 && ft > 4 && ft < 36) continue;
        }
        const g = bedAt(x, z);
        if (g < 3.4 || g > 16) continue;
        if (nearHouse(x, z)) continue;
        if (hashRnd(s * 3.7 + side * 11) < 0.5) continue;
        treeSpots.push({ x, z, s: 0.95 + hashRnd(s * side * 2) * 0.7 });
      }
    }
    // gorge woodland — dense forest on the slopes between the dam toe and the
    // village (reference FOREST AREA, upper-left of centre)
    for (let gs = 70; gs <= 98; gs += 2.1) {
      for (let gt = -46; gt <= 30; gt += 2.1) {
        if (Math.abs(gt - axisT(gs)) < 15) continue;
        const [x, z] = STP(gs, gt);
        if (x < 2 || x > 158 || z < -78 || z > 78) continue;
        if (distToPaths(x, z) < 2.5) continue;
        if (nearHouse(x, z, 3.0)) continue;
        const g = bedAt(x, z);
        if (g < 8 || g > 32) continue;
        const slope = Math.abs(bedAt(x + 2, z) - g) + Math.abs(bedAt(x, z + 2) - g);
        if (slope > 2.4) continue;
        const h = hashRnd(x * 9.1 + z * 3.7);
        if (h < 0.42) continue;
        treeSpots.push({ x: x + (hashRnd(x + z) - 0.5) * 1.6, z: z + (hashRnd(x * 2 + z) - 0.5) * 1.6, s: 1.1 + h * 0.9 });
      }
    }
    // flank forest belts — the big green ranges framing the floodplain plus
    // the canvas rims, dense woodland everywhere the slopes are gentle
    for (let x = 8; x <= 154; x += 2.3) {
      for (let z = -78; z <= 78; z += 2.3) {
        const [s, t] = xz2st(x, z);
        const rimD = Math.min(x, LX - x, z + 74, 74 - z);
        const wallD = s > DAM_TOE_S ? Math.abs(t - axisT(s)) - 20 : 0;
        const inFlank = s > DAM_TOE_S + 6 && wallD > 6 && wallD < 70;
        const inRim = rimD > -4;
        if (!inFlank && !inRim) continue;
        if (inChannel(x, z) < 15) continue; // keep the river gorge open
        const g = bedAt(x, z);
        if (g < 9 || g > 34) continue;
        const slope = Math.abs(bedAt(x + 2, z) - g) + Math.abs(bedAt(x, z + 2) - g);
        if (slope > 2.9) continue;
        const h = hashRnd(x * 12.7 + z * 5.3);
        if (h < (inRim ? 0.58 : 0.5)) continue;
        treeSpots.push({ x: x + (hashRnd(x + z) - 0.5) * 1.8, z: z + (hashRnd(x * 2 + z) - 0.5) * 1.8, s: 1.15 + h * 0.9 });
      }
    }
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, 2.0, 5);
    const folGeo = new THREE.IcosahedronGeometry(1.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x634823, roughness: 0.95 });
    const folMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const fols = new THREE.InstancedMesh(folGeo, folMat, treeSpots.length);
    const greens = [0x275c2b, 0x2f6d33, 0x3a7440, 0x245227, 0x416f30, 0x356e3c];
    const fSpots: FloodTrees['spots'] = [];
    treeSpots.forEach((s, i) => {
      const g = bedAt(s.x, s.z);
      const rot = hashRnd(s.x * 7 + s.z) * Math.PI * 2;
      m4.makeTranslation(s.x, g + 0.95 * s.s, s.z);
      trunks.setMatrixAt(i, m4);
      eu.set(0, rot, 0);
      q.setFromEuler(eu);
      m4.compose(new THREE.Vector3(s.x, g + 2.5 * s.s, s.z), q, new THREE.Vector3(s.s, s.s * 1.3, s.s));
      fols.setMatrixAt(i, m4);
      fols.setColorAt(i, col.setHex(greens[Math.floor(hashRnd(s.x * 9 + s.z * 3) * greens.length)]));
      fSpots.push({ x: s.x, z: s.z, ground: g, s: s.s, rot });
    });
    trunks.castShadow = true;
    fols.castShadow = true;
    if (fols.instanceColor) fols.instanceColor.needsUpdate = true;
    group.add(trunks, fols);
    floodTrees = { trunk: trunks, fol: fols, spots: fSpots, prog: new Float32Array(fSpots.length), drift: new Float32Array(fSpots.length * 2) };
  }

  // ---- landmarks
  // clock tower + plaza (town heart, SW bank)
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(5.2, 26), paving);
  plaza.rotation.x = -Math.PI / 2;
  const [pzX, pzZ] = STP(114, -22);
  const pzG = bedAt(pzX, pzZ);
  plaza.position.set(pzX, pzG + 0.16, pzZ);
  plaza.receiveShadow = true;
  group.add(plaza);
  const towerG = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.1, 8.2, 2.1), matConcrete());
  shaft.position.y = 4.1;
  shaft.castShadow = true;
  const clockBox = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), matWhite());
  clockBox.position.y = 9.4;
  clockBox.castShadow = true;
  towerG.add(shaft, clockBox);
  const clockTex = makeClockTex();
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const holder = new THREE.Group();
    holder.position.y = 9.4;
    holder.rotation.y = ry;
    const f2 = new THREE.Mesh(
      new THREE.CircleGeometry(0.82, 22),
      new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.6 }),
    );
    f2.position.set(0, 0, 1.27);
    holder.add(f2);
    towerG.add(holder);
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.7, 4), matConcreteDark());
  spire.position.y = 11.5;
  spire.rotation.y = Math.PI / 4;
  spire.castShadow = true;
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.35, metalness: 0.6 }));
  finial.position.y = 12.45;
  towerG.add(spire, finial);
  towerG.position.set(pzX, pzG, pzZ);
  group.add(towerG);

  // water tower (east district)
  const wt = new THREE.Group();
  const [wtX, wtZ] = STP(130, -22);
  const wtG = bedAt(wtX, wtZ);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 8.4, 6), matSteel());
    leg.position.set(sx * 1.15, 4.2, sz * 1.15);
    leg.rotation.z = -sx * 0.07;
    leg.rotation.x = sz * 0.07;
    leg.castShadow = true;
    wt.add(leg);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.6, 16), matSteel());
  tank.position.y = 9.6;
  tank.castShadow = true;
  const tankTop = new THREE.Mesh(new THREE.ConeGeometry(2.0, 0.9, 16), matConcreteDark());
  tankTop.position.y = 11.35;
  wt.add(tank, tankTop);
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8.4, 6), matDark());
  riser.position.set(-1.45, 4.2, 0);
  wt.add(riser);
  wt.position.set(wtX, wtG, wtZ);
  wt.rotation.y = -Math.PI / 4;
  group.add(wt);

  // market canopy (core, off the high street)
  const mk = new THREE.Group();
  const [mkX, mkZ] = STP(108, -18);
  const mkG = bedAt(mkX, mkZ);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.7, 6), matSteel());
    post.position.set(sx * 3.6, 1.35, sz * 2.2);
    mk.add(post);
  }
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 0.1, 5.2),
    new THREE.MeshStandardMaterial({ map: makeAwningTex(), roughness: 0.8 }),
  );
  awning.position.y = 2.75;
  awning.rotation.z = 0.045;
  awning.castShadow = true;
  mk.add(awning);
  for (let k = 0; k < 3; k++) {
    const stall = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: k % 2 ? 0x9a6a45 : 0x6a8a55, roughness: 0.9 }));
    stall.position.set(-2.4 + k * 2.4, 0.45, (k % 2) * 1.2 - 0.6);
    stall.castShadow = true;
    mk.add(stall);
  }
  mk.position.set(mkX, mkG, mkZ);
  mk.rotation.y = -Math.PI / 4;
  group.add(mk);

  // football pitch
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(19, 12),
    new THREE.MeshStandardMaterial({ map: makePitchTex(), roughness: 0.95 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.rotation.z = -Math.PI / 4 + 0.06;
  const [piX, piZ] = STP(124, -32);
  const piG = bedAt(piX, piZ);
  pitch.position.set(piX, piG + 0.12, piZ);
  pitch.receiveShadow = true;
  group.add(pitch);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 0.08), matWhite());
    post.rotation.y = -Math.PI / 4;
    post.position.set(piX + s * 9.2 * SC, piG + 0.75, piZ + s * 9.2 * SC);
    group.add(post);
  }

  // temple shrine (west quarter)
  const tp = new THREE.Group();
  const [tpX, tpZ] = STP(96, -30);
  const tpG = bedAt(tpX, tpZ);
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.6, 3.2), new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.9 }));
  body.position.y = 1.3;
  body.castShadow = true;
  const roofMat2 = new THREE.MeshStandardMaterial({ color: 0x8a4a35, roughness: 0.88 });
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 3.6), roofMat2);
  s1.position.set(-0.92, 3.15, 0);
  s1.rotation.z = 0.58;
  const s2 = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 3.6), roofMat2);
  s2.position.set(0.92, 3.15, 0);
  s2.rotation.z = -0.58;
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.2, 6), matSteel());
  flagPole.position.set(2.6, 2.6, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshStandardMaterial({ color: 0xd85a28, roughness: 0.8, side: THREE.DoubleSide }));
  flag.position.set(3.1, 4.8, 0);
  tp.add(body, s1, s2, flagPole, flag);
  tp.position.set(tpX, tpG, tpZ);
  tp.rotation.y = -Math.PI / 4;
  group.add(tp);

  // park grove + benches
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.92, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
  const parkSpots: [number, number][] = [[102, -25], [104, -22.5], [101, -22], [105, -27], [103, -28]];
  for (const [ps, pt] of parkSpots) {
    const [px, pz] = STP(ps, pt);
    const g = bedAt(px, pz);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.8, 6), trunkMat);
    trunk.position.set(px, g + 0.9, pz);
    trunk.castShadow = true;
    const blob = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0 + hashRnd(px * 3 + pz) * 0.6, 0), leafMat);
    blob.position.set(px, g + 2.5, pz);
    blob.castShadow = true;
    group.add(trunk, blob);
  }
  for (const [bs, bt, r] of [[116, -20.5, 0.4], [111, -25.5, -0.6]] as const) {
    const [bx, bz] = STP(bs, bt);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), trunkMat);
    bench.position.set(bx, bedAt(bx, bz) + 0.45, bz);
    bench.rotation.y = r - Math.PI / 4;
    group.add(bench);
  }

  // streetlights (instanced) along the street grid
  const lightSpots: [number, number][] = [];
  for (const st of TOWN_STREETS) {
    for (let i = 1; i < st.pts.length; i += 1) {
      const [ax, az] = st.pts[i - 1];
      const [bx, bz] = st.pts[i];
      const segLen = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(segLen / 9));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        lightSpots.push([ax + (bx - ax) * t + 1.6, az + (bz - az) * t + 1.3]);
      }
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.045, 0.06, 3.3, 5);
  const poles = new THREE.InstancedMesh(poleGeo, matSteel(), lightSpots.length);
  const headGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf2e6c0, emissive: 0x93813f, emissiveIntensity: 0.9, roughness: 0.4 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lightSpots.length);
  lightSpots.forEach(([lx, lz], i) => {
    const g = bedAt(lx, lz);
    m4.makeTranslation(lx, g + 1.65, lz);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(lx - 0.28, g + 3.32, lz);
    heads.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  group.add(poles, heads);

    // ---- farmland: crop fields, farmsteads, hay bales -----------------------
  // agricultural bench (NE), SW bench and the lower east plain — the same
  // plots the terrain painter stains as farmland, so soil colour and props
  // agree. Fields are rotated 45° to align with the valley grain.
  {
    const FARMS: { s: number; t: number; w: number; d: number; k: number }[] = [
      { s: 88, t: 8, w: 12, d: 9, k: 0 }, { s: 96, t: 12, w: 12, d: 9, k: 1 },
      { s: 104, t: 16, w: 12, d: 9, k: 2 }, { s: 112, t: 20, w: 12, d: 9, k: 0 },
      { s: 120, t: 24, w: 12, d: 9, k: 1 }, { s: 128, t: 28, w: 12, d: 9, k: 2 },
      { s: 100, t: 28, w: 11, d: 8, k: 1 }, { s: 116, t: 32, w: 11, d: 8, k: 0 },
      { s: 106, t: -44, w: 12, d: 9, k: 1 }, { s: 116, t: -42, w: 12, d: 9, k: 2 },
      { s: 126, t: -44, w: 12, d: 9, k: 0 }, { s: 134, t: -42, w: 11, d: 8, k: 1 },
      { s: 146, t: -20, w: 11, d: 8, k: 2 }, { s: 156, t: -28, w: 11, d: 8, k: 0 },
      { s: 164, t: -16, w: 11, d: 8, k: 1 },
    ];
    const fieldMats = [
      new THREE.MeshStandardMaterial({ map: makeFieldTex('#8a7a3d', '#79692f'), roughness: 0.95 }), // ripe grain
      new THREE.MeshStandardMaterial({ map: makeFieldTex('#5d7a37', '#4e6a2c'), roughness: 0.95 }), // green crops
      new THREE.MeshStandardMaterial({ map: makeFieldTex('#7a5f38', '#6a5029'), roughness: 0.95 }), // tilled soil
    ];
    const cropGeo = new THREE.BoxGeometry(1, 0.2, 1);
    const cropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const cropColors = [0xcfc06a, 0x7fae4a, 0xa98d55];
    const cropRows = new THREE.InstancedMesh(cropGeo, cropMat, FARMS.length * 7);
    let ri = 0;
    const barnMat = new THREE.MeshStandardMaterial({ color: 0x8a3f2e, roughness: 0.85 });
    const barnRoofMat = new THREE.MeshStandardMaterial({ color: 0x5d5a52, roughness: 0.9 });
    const siloMat = new THREE.MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.7, metalness: 0.15 });
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xb59f4b, roughness: 1 });
    const hays = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.62, 9), hayMat, 26);
    let hi = 0;
    FARMS.forEach((f, fi) => {
      const [fx, fz] = STP(f.s, f.t);
      const g = bedAt(fx, fz);
      const fRot = -Math.PI / 4 + (hashRnd(fi * 3.3) - 0.5) * 0.16;
      const field = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), fieldMats[f.k]);
      field.rotation.x = -Math.PI / 2;
      field.rotation.z = fRot;
      field.position.set(fx, g + 0.09, fz);
      field.receiveShadow = true;
      group.add(field);
      // crop rows spanning the patch (instanced, tinted per crop)
      eu.set(0, fRot, 0);
      q.setFromEuler(eu);
      const dX = Math.cos(fRot), dZ = -Math.sin(fRot); // across-patch direction
      for (let k = 0; k < 7; k++) {
        const off = ((k + 0.5) / 7 - 0.5) * f.d * 0.82;
        m4.compose(new THREE.Vector3(fx - dZ * off, g + 0.16, fz + dX * off), q, new THREE.Vector3(f.w * 0.9, 1, 0.5));
        cropRows.setMatrixAt(ri, m4);
        cropRows.setColorAt(ri, col.setHex(cropColors[f.k]));
        ri++;
      }
      // farmstead: barn + silo at the south edge, clear of the lane
      const bs = f.s + (hashRnd(fi * 7.7) - 0.5) * f.w * 0.3;
      const bt = f.t + f.d * 0.62;
      const [bx, bz] = STP(bs, bt);
      const barn = new THREE.Group();
      const hall = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.7, 2.0), barnMat);
      hall.position.y = 0.85;
      hall.castShadow = true;
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 2.3), barnRoofMat);
      r1.position.set(-0.78, 1.98, 0);
      r1.rotation.z = 0.62;
      const r2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 2.3), barnRoofMat);
      r2.position.set(0.78, 1.98, 0);
      r2.rotation.z = -0.62;
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.8, 10), siloMat);
      silo.position.set(2.1, 1.4, 0.3);
      silo.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), siloMat);
      cap.position.set(2.1, 2.8, 0.3);
      barn.add(hall, r1, r2, silo, cap);
      barn.position.set(bx, bedAt(bx, bz), bz);
      barn.rotation.y = -Math.PI / 4 + hashRnd(fi * 5.1) * Math.PI * 2;
      group.add(barn);
      // hay bales
      const nH = 2 + Math.floor(hashRnd(fi * 9.9) * 2);
      for (let k = 0; k < nH && hi < 26; k++) {
        const hs = f.s + (hashRnd(fi * 13 + k) - 0.5) * f.w;
        const ht = f.t - f.d * 0.55 + (hashRnd(fi * 17 + k) - 0.5) * 2;
        const [hx, hz] = STP(hs, ht);
        m4.makeTranslation(hx, bedAt(hx, hz) + 0.42, hz);
        m4.multiply(new THREE.Matrix4().makeRotationY(hashRnd(hx * 3 + hz) * Math.PI));
        hays.setMatrixAt(hi++, m4);
      }
    });
    cropRows.count = ri;
    cropRows.castShadow = true;
    if (cropRows.instanceColor) cropRows.instanceColor.needsUpdate = true;
    group.add(cropRows);
    hays.count = hi;
    hays.castShadow = true;
    group.add(hays);
    // orchard — row-planted fruit trees on the lower east plot
    for (let ox = 0; ox < 4; ox++) {
      for (let oz = 0; oz < 3; oz++) {
        const [tx, tz] = STP(160 + ox * 2.6, -20 + oz * 2.8);
        const g = bedAt(tx, tz);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.1, 5), trunkMat);
        trunk.position.set(tx, g + 0.55, tz);
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72 + hashRnd(ox * 7 + oz) * 0.3, 0), leafMat);
        crown.position.set(tx, g + 1.45, tz);
        crown.castShadow = true;
        group.add(trunk, crown);
      }
    }
  }

  // ---- civic landmark complexes --------------------------------------------
  // hospital, school, factory, waterworks, fuel depot, substation, civic hall
  // (each tucked inside its reserved clear rect, dodging the street grid)
  const civicRed = new THREE.MeshStandardMaterial({ color: 0xc24338, roughness: 0.7 });
  const YAW = -Math.PI / 4;

  // hospital — white slab + rooftop cross + entrance canopy (town core)
  {
    const [hx, hz] = STP(120, -14);
    const g = bedAt(hx, hz);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(5.8, 5.6, 3.4), matWhite());
    slab.rotation.y = YAW;
    slab.position.set(hx, g + 2.8, hz);
    slab.castShadow = slab.receiveShadow = true;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.0, 3.2, 3.0), matWhite());
    wing.rotation.y = YAW;
    wing.position.set(hx, g + 1.6, hz - 2.5);
    wing.castShadow = true;
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.4), civicRed);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 1.5), civicRed);
    c1.rotation.y = YAW;
    c2.rotation.y = YAW;
    c1.position.set(hx, g + 5.85, hz);
    c2.position.set(hx, g + 5.85, hz);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.6), matConcrete());
    canopy.rotation.y = YAW;
    canopy.position.set(hx, g + 2.6, hz + 2.4);
    group.add(slab, wing, c1, c2, canopy);
  }

  // school — hall + paved yard + flagpole (west quarter)
  {
    const [sx2, sz2] = STP(106, -26);
    const g = bedAt(sx2, sz2);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.8, 3.2), matWhite());
    hall.rotation.y = YAW;
    hall.position.set(sx2, g + 1.4, sz2);
    hall.castShadow = hall.receiveShadow = true;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.4), paving);
    yard.rotation.x = -Math.PI / 2;
    yard.rotation.z = YAW;
    yard.position.set(sx2, g + 0.14, sz2 + 3.4);
    yard.receiveShadow = true;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.6, 6), matSteel());
    pole.position.set(sx2 - 3.4, g + 2.3, sz2 + 3.4);
    const flagS = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: 0x2f6db4, roughness: 0.8, side: THREE.DoubleSide }));
    flagS.position.set(sx2 - 3.85, g + 4.3, sz2 + 3.4);
    group.add(hall, yard, pole, flagS);
  }

  // factory — sawtooth-roof shed + chimneys (south civic band)
  {
    const [fx, fz] = STP(118, -38);
    const g = bedAt(fx, fz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 5.4), matConcreteDark());
    hall.rotation.y = YAW;
    hall.position.set(fx, g + 2.1, fz);
    hall.castShadow = hall.receiveShadow = true;
    group.add(hall);
    for (let k = 0; k < 4; k++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 5.8), matGalvanised());
      tooth.rotation.y = YAW;
      tooth.rotation.x = 0.5;
      tooth.position.set(fx + (k - 1.5) * 3.0 * SC, g + 4.85, fz + (k - 1.5) * 3.0 * SC);
      tooth.castShadow = true;
      group.add(tooth);
    }
    for (const cx of [-4, 4]) {
      const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 6.8, 9), matConcreteDark());
      chim.position.set(fx + cx * SC, g + 5.4, fz + cx * SC);
      chim.castShadow = true;
      group.add(chim);
    }
  }

  // waterworks — pump hall + twin tanks on the river bank (riverside drive)
  {
    const [wx, wz] = STP(88, -36);
    const g = bedAt(wx, wz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 3.0), matWhite());
    hall.rotation.y = YAW;
    hall.position.set(wx, g + 1.1, wz);
    hall.castShadow = true;
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x7fa3b8, roughness: 0.55, metalness: 0.3 });
    for (const tx of [-2.8, 2.8]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.2, 12), tankMat);
      tank.position.set(wx + tx * SC, g + 1.1, wz + tx * SC);
      tank.castShadow = true;
      group.add(tank);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.8, 7), matDark());
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = YAW;
    pipe.position.set(wx, g + 0.5, wz + 2.0);
    group.add(hall, pipe);
  }

  // fuel depot — horizontal tanks in a bund (east district)
  {
    const [fx, fz] = STP(132, -12);
    const g = bedAt(fx, fz);
    const bund = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.5, 8.2), matConcrete());
    bund.rotation.y = YAW;
    bund.position.set(fx, g + 0.1, fz);
    bund.receiveShadow = true;
    const tankMatF = new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.6, metalness: 0.25 });
    for (let k = 0; k < 3; k++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.6, 12), tankMatF);
      tank.rotation.x = Math.PI / 2;
      tank.rotation.z = YAW;
      tank.position.set(fx, g + 0.9, fz - 2.6 + k * 2.6);
      tank.castShadow = true;
      group.add(tank);
    }
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 1.5), matGalvanised());
    pump.position.set(fx + 2.2, g + 0.75, fz);
    pump.castShadow = true;
    group.add(bund, pump);
  }

  // POWER SUBSTATION — gravel pad, transformers, gantry + pylon cluster
  // (reference POWER SUBSTATION, lower-left bench)
  {
    const [vx, vz] = STP(140, -48);
    const g = bedAt(vx, vz);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.14, 7.5), new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.98 }));
    pad.rotation.y = YAW;
    pad.position.set(vx, g + 0.07, vz);
    pad.receiveShadow = true;
    for (const [tx, tz] of [[-2.2, -1.8], [-2.2, 1.8], [0.6, 0]] as const) {
      const xfmr = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 1.1), matDark());
      xfmr.rotation.y = YAW;
      xfmr.position.set(vx + (tx * Math.cos(YAW) + tz * Math.sin(YAW)), g + 0.8, vz + (-tx * Math.sin(YAW) + tz * Math.cos(YAW)));
      xfmr.castShadow = true;
      group.add(xfmr);
    }
    for (const gz2 of [-3.2, 3.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6), matGalvanised());
      post.position.set(vx + 2.6 * SC, g + 2.2, vz + 2.6 * SC + gz2 * 0.4);
      post.castShadow = true;
      group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 6.4), matGalvanised());
    beam.rotation.y = YAW;
    beam.position.set(vx + 2.6 * SC, g + 4.2, vz + 2.6 * SC);
    group.add(pad, beam);
    // two dead-end pylons framing the yard
    for (const [ps, pt] of [[137.5, -50.5], [143, -45.5]] as const) {
      const [px, pz] = STP(ps, pt);
      const py = makePylon(9.5);
      py.position.set(px, bedAt(px, pz), pz);
      py.rotation.y = YAW;
      group.add(py);
    }
  }

  // civic hall — columned portico + pediment (south civic band)
  {
    const [cx, cz] = STP(128, -34);
    const g = bedAt(cx, cz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.4, 3.6), matWhite());
    hall.rotation.y = YAW;
    hall.position.set(cx, g + 1.7, cz);
    hall.castShadow = hall.receiveShadow = true;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 1.6, 1.1, 3), matWhite());
    ped.rotation.x = Math.PI / 2;
    ped.rotation.y = Math.PI / 2 + YAW;
    ped.position.set(cx, g + 4.0, cz - 1.95);
    ped.castShadow = true;
    group.add(hall, ped);
    for (let k = 0; k < 4; k++) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.6, 8), matWhite());
      column.position.set(cx + (k - 1.5) * 1.2 * SC, g + 1.3, cz + (k - 1.5) * 1.2 * SC - 2.05);
      column.castShadow = true;
      group.add(column);
    }
  }

  // industrial estate — big gable-roof warehouses with loading bays, container
  // stacks and a shared parking apron (reference INDUSTRIAL AREA, NE bench)
  {
    const roofLight = new THREE.MeshStandardMaterial({ color: 0xd7dade, roughness: 0.65, metalness: 0.12 });
    const roofBlue = new THREE.MeshStandardMaterial({ color: 0x6d8fa8, roughness: 0.6, metalness: 0.15 });
    const wallLight = new THREE.MeshStandardMaterial({ color: 0xe3e1da, roughness: 0.85 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5d6266, roughness: 0.7, metalness: 0.3 });
    const contTints = [0xb4643c, 0x3f6e52, 0x4a6b8a, 0x9a4438, 0x8a8250];
    const SHEDS: { s: number; t: number; w: number; d: number; blue: boolean }[] = [
      { s: 106, t: 14, w: 11, d: 5.6, blue: true },
      { s: 114, t: 18, w: 11, d: 5.6, blue: false },
      { s: 122, t: 12, w: 10, d: 5.2, blue: true },
    ];
    for (const sd of SHEDS) {
      const [sx, sz] = STP(sd.s, sd.t);
      const g = bedAt(sx, sz);
      const shed = new THREE.Group();
      const hall = new THREE.Mesh(new THREE.BoxGeometry(sd.w, 3.6, sd.d), wallLight);
      hall.position.y = 1.8;
      hall.castShadow = hall.receiveShadow = true;
      shed.add(hall);
      // gable roof pair
      const rMat = sd.blue ? roofBlue : roofLight;
      const half = sd.d / 2 + 0.35;
      for (const side of [-1, 1]) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(sd.w + 0.6, 0.14, Math.hypot(half, 1.7)), rMat);
        slab.position.set(0, 4.35, side * half * 0.5);
        slab.rotation.x = side * -0.55;
        slab.castShadow = true;
        shed.add(slab);
      }
      // loading bay doors on the river side
      for (let k = 0; k < 3; k++) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 0.1), doorMat);
        door.position.set(-sd.w * 0.3 + k * sd.w * 0.3, 1.05, -sd.d / 2 - 0.04);
        shed.add(door);
      }
      shed.position.set(sx, g, sz);
      shed.rotation.y = YAW;
      group.add(shed);
      // apron + containers on the river side
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(sd.w + 3, 4.6), paving);
      apron.rotation.x = -Math.PI / 2;
      apron.rotation.z = YAW;
      apron.position.set(sx, g + 0.1, sz - sd.d / 2 - 2.6);
      apron.receiveShadow = true;
      group.add(apron);
      const nC = 2 + Math.floor(hashRnd(sx * 3.3) * 3);
      for (let k = 0; k < nC; k++) {
        const cx2 = sx - sd.w * 0.35 * SC + k * 2.5 * SC + hashRnd(sx + k) * 0.8;
        const cz2 = sz + sd.w * 0.35 * SC - sd.d / 2 - 2.2 - hashRnd(sz * 2 + k) * 1.2;
        const stack = 1 + Math.floor(hashRnd(sx * 7 + k * 3) * 2.4);
        for (let m = 0; m < stack; m++) {
          const cont = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.85, 1.0),
            new THREE.MeshStandardMaterial({ color: contTints[Math.floor(hashRnd(sz + k * 5 + m) * contTints.length)], roughness: 0.8, metalness: 0.1 }),
          );
          cont.position.set(cx2, bedAt(cx2, cz2) + 0.45 + m * 0.88, cz2);
          cont.rotation.y = YAW + (hashRnd(cx2 * 3 + m) - 0.5) * 0.2;
          cont.castShadow = true;
          group.add(cont);
        }
      }
    }
  }

  return { group, districts, floodTrees, rubble };
}

// ============================================================ FAR TERRAIN
// The solver domain is a hard-edged plane; this dresses the world beyond it so
// the square canvas never shows its cut: the diagonal valley keeps running
// past the bottom-right exit (the flood river visibly continues toward the
// horizon) and a rounded forested mountain ring closes the view on all four
// sides. Heights blend out of bedAt() so the seam against the solver mesh is
// invisible, and colour comes from the same terrainColor painter.
export function buildFarTerrain(): { group: THREE.Group } {
  const group = new THREE.Group();

  const sstep = (a: number, b: number, v: number): number => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // distant backdrop: low matte base plain — the excess land around the map
  // is gone. Only a thin, dark apron continues the island outward (and
  // carries the exit river out of frame); the mountain continuation on the
  // north-west still blends out of the reservoir ring.
  const ringH = (x: number, z: number): number =>
    3.4 + 6.5 * fbm(x * 0.021 + 40.7, z * 0.021 - 13.3, 4)
     + 2.2 * fbm(x * 0.065 - 8.1, z * 0.065 + 21.4, 3);

  const farH = (x: number, z: number): number => {
    const [s, t] = xz2st(x, z);
    // past the bottom-right exit: the valley keeps running out along the
    // diagonal and the range closes over it further downstream
    if (s > 226.3 && Math.abs(t) < 70) {
      const wv = Math.max(8, 14 - (s - 226.3) * 0.06);
      const dtn = Math.abs(t) - wv;
      const valley = Math.max(2.5, 4.5 - (s - 226.3) * 0.02)
        + (dtn > 0 ? (1 - Math.exp(-dtn / 16)) * 10 : 0);
      const tt = Math.max(sstep(140, 260, s), sstep(34, 66, Math.abs(t)));
      return valley + (ringH(x, z) + 2 - valley) * tt;
    }
    // everywhere else: hold the boundary profile, fade into the range
    const dOut = Math.max(-x, x - LX, -LZ / 2 - z, z - LZ / 2, 0);
    const base = bedAt(clamp(x, 1.5, LX - 1.5), clamp(z, -LZ / 2 + 1, LZ / 2 - 1));
    const tt = sstep(2, 70, dOut);
    return base + (ringH(x, z) - base) * tt;
  };

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, envMapIntensity: 0.18 });
  const tc = { r: 0, g: 0, b: 0 };
  const col = new THREE.Color();

  const strip = (x0: number, x1: number, z0: number, z1: number, nx: number, nz: number): void => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = farH(x, z);
      pos.setY(i, y);
      const e = 3;
      const sx = (farH(x + e, z) - farH(x - e, z)) / (2 * e);
      const sz = (farH(x, z + e) - farH(x, z - e)) / (2 * e);
      terrainColor(x, z, y, Math.sqrt(sx * sx + sz * sz), tc);
      // keep the outer plain subdued: a touch of aerial haze so the base
      // reads as quiet ground, not a competing landscape
      const gr = (tc.r + tc.g + tc.b) / 3;
      const mu = 0.14;
      tc.r = tc.r * (1 - mu) + (gr * 0.78 + 0.1) * mu;
      tc.g = tc.g * (1 - mu) + (gr * 0.86 + 0.12) * mu;
      tc.b = tc.b * (1 - mu) + (gr * 0.84 + 0.14) * mu;
      col.setRGB(tc.r, tc.g, tc.b, THREE.SRGBColorSpace);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, mat));
  };

  // four aprons framing the canvas: north / south rims, west headwall, east
  // valley continuation (the far corner strip carries the river out of frame)
  strip(-200, 340, -210, -LZ / 2, 128, 30);
  strip(-200, 340, LZ / 2, 210, 128, 30);
  strip(-200, 0, -LZ / 2, LZ / 2, 46, 64);
  strip(LX, 340, -LZ / 2, LZ / 2, 50, 64);

  // haze backstop far below the terrain so no sky peeks under the outer ranges
  const back = new THREE.Mesh(
    new THREE.CircleGeometry(2600, 40),
    new THREE.MeshBasicMaterial({ color: 0xa8bcc8 }),
  );
  back.rotation.x = -Math.PI / 2;
  back.position.set(LX / 2, 0.4, 0);
  group.add(back);

  return { group };
}





