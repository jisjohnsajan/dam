// DAMSAFE 3D — world dressing: hydroelectric powerhouse (intake tower,
// penstocks, turbine hall, tailrace, transformers, transmission line), the
// downstream river town (open-world district), and the far terrain ring that
// closes the horizon beyond the solver domain.
//
// Everything here is VISUAL dressing: the GPU shallow-water solver keeps
// running on its own domain, so the powerhouse/town sit on bedAt() ground and
// the flood wave genuinely reaches them during scenarios.
import * as THREE from 'three';
import { LX, LZ, bedAt, terrainColor, fbm, BOWL_CX, BOWL_R } from './terrain';

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

function hashRnd(i: number): number {
  const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

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
export interface PowerhouseProps {
  group: THREE.Group;
  rotors: THREE.Group[]; // spinning generator flywheels
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

  // ---- intake tower in the reservoir (upstream face of the dam)
  const intake = new THREE.Group();
  const iBed = bedAt(106.8, -24); // ≈ 11.9
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 15, 4.6), conc);
  tower.position.set(106.8, iBed + 6.6, -24); // top ≈ 25.1 (2 m above crest)
  tower.castShadow = tower.receiveShadow = true;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.32, 5.5), concDark);
  deck.position.set(106.8, iBed + 14.0, -24);
  deck.castShadow = true;
  intake.add(tower, deck);
  // gantry hoist on the deck
  for (const dz of [-1.7, 1.7]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), steel);
    col.position.set(105.6, iBed + 15.3, -24 + dz);
    intake.add(col, col.clone().translateX(2.4));
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.2), steel);
  beam.position.set(106.8, iBed + 16.5, -24);
  const hoist = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.55), matDark());
  hoist.position.set(106.8, iBed + 16.0, -24);
  intake.add(beam, hoist);
  // trash racks on the upstream face
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.4, 4.0), matDark());
  rackFrame.position.set(104.95, iBed + 6.4, -24);
  intake.add(rackFrame);
  for (let k = 0; k < 10; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 6.2, 0.09), steel);
    bar.position.set(104.88, iBed + 6.4, -25.8 + k * 0.4);
    intake.add(bar);
  }
  // dark intake openings facing the dam + wet well rim
  for (const oy of [2.0, 4.6]) {
    const open = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 1.5), matDark());
    open.position.set(108.65, iBed + oy, -24);
    intake.add(open);
  }
  group.add(intake);

  // service bridge intake → crest
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.24, 2.1), concDark);
  bridge.position.set(110.2, iBed + 14.0, -24);
  bridge.castShadow = true;
  group.add(bridge);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 0.05), steel);
    rail.position.set(110.2, iBed + 14.42, -24 + s * 0.95);
    group.add(rail);
  }

  // exposed conduit across the upstream face (tower → dam body, submerged)
  const feedCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(108.4, iBed + 7.1, -24),
    new THREE.Vector3(110.2, iBed + 7.1, -24),
    new THREE.Vector3(112.1, iBed + 7.1, -24),
  ]);
  const feed = new THREE.Mesh(new THREE.TubeGeometry(feedCurve, 8, 0.52, 10, false), steel);
  group.add(feed);

  // ---- penstocks down the downstream face → powerhouse
  const penMat = matSteel();
  const penZ = [-25.6, -22.4];
  for (const z of penZ) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(116.9, 19.4, z),
      new THREE.Vector3(118.4, 15.8, z),
      new THREE.Vector3(120.1, 12.9, z),
      new THREE.Vector3(122.9, 12.4, z),
    ]);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.52, 12, false), penMat);
    pipe.castShadow = true;
    group.add(pipe);
    // ring collars
    for (const t of [0.3, 0.55, 0.8]) {
      const p = curve.getPoint(t);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 12), penMat);
      collar.position.copy(p);
      collar.rotation.z = Math.PI / 2 - 0.35;
      group.add(collar);
    }
  }

  // ---- powerhouse hall at the toe (open downstream bay showing the units)
  const ph = new THREE.Group();
  const phBed = bedAt(126, -24); // ≈ 11.2
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.5, 10.2), concDark);
  floor.position.set(126.3, phBed + 0.25, -24);
  floor.receiveShadow = true;
  ph.add(floor);
  const wallH = 5.4;
  const backW = new THREE.Mesh(new THREE.BoxGeometry(0.35, wallH, 10.2), conc);
  backW.position.set(122.65, phBed + wallH / 2, -24);
  backW.castShadow = backW.receiveShadow = true;
  const sideA = new THREE.Mesh(new THREE.BoxGeometry(7.8, wallH, 0.35), conc);
  sideA.position.set(126.3, phBed + wallH / 2, -29.0);
  const sideB = sideA.clone();
  sideB.position.z = -19.0;
  ph.add(backW, sideA, sideB);
  // open front: columns + lintel
  for (const dz of [-28.6, -19.4]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, wallH, 0.5), conc);
    col.position.set(130.0, phBed + wallH / 2, dz);
    col.castShadow = true;
    ph.add(col);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 10.2), conc);
  lintel.position.set(130.0, phBed + wallH - 0.55, -24);
  lintel.castShadow = true;
  ph.add(lintel);
  // roof + monitor
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.32, 10.9), matWhite());
  roof.position.set(126.3, phBed + wallH + 0.35, -24);
  roof.castShadow = true;
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 7.0), matSteel());
  monitor.position.set(126.3, phBed + wallH + 0.85, -24);
  ph.add(roof, monitor);
  // crane rail inside
  for (const dz of [-28.3, -19.7]) {
    const railB = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 0.14), steel);
    railB.position.set(126.3, phBed + wallH - 0.25, dz);
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
  sign.position.set(130.36, phBed + wallH - 0.55, -24);
  sign.rotation.y = Math.PI / 2;
  ph.add(sign);
  group.add(ph);

  // ---- 2 turbine-generator units (visible through the open bay)
  for (const uz of [-26.4, -21.6]) {
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
    unit.position.set(125.6, 0, uz);
    group.add(unit);
    // draft tube exit through the back wall
    const draft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), concDark);
    draft.position.set(122.2, phBed + 0.75, uz);
    group.add(draft);
  }

  // ---- tailrace guide walls
  for (const [z0, z1] of [[-27.6, -26.2], [-20.4, -21.8]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.7, 0.4), concDark);
    const mx = 133.4;
    const mz = (z0 + z1) / 2;
    wall.position.set(mx, bedAt(mx, mz) + 0.6, mz);
    wall.rotation.y = Math.atan2(z1 - z0, 6.2) * -1;
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
  }

  // ---- transformer yard + switch gantry
  const yard = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.22, 6.2), new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.98 }));
  pad.position.set(133.2, bedAt(133.2, -13.5) + 0.11, -13.5);
  pad.receiveShadow = true;
  yard.add(pad);
  for (const dz of [-15.2, -11.8]) {
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
    tr.position.set(132.2, pad.position.y, dz);
    yard.add(tr);
  }
  // switch gantry + first cable anchor
  for (const dz of [-16.0, -11.0]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.0, 6), matGalvanised());
    col.position.set(136.4, bedAt(136.4, dz) + 3.5, dz);
    col.castShadow = true;
    yard.add(col);
  }
  const gBeam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 5.4), matGalvanised());
  gBeam.position.set(136.4, bedAt(136.4, -13.5) + 6.9, -13.5);
  yard.add(gBeam);
  group.add(yard);

  // ---- transmission line: powerhouse → town substation
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x30343a });
  const anchors: { x: number; z: number; h: number }[] = [
    { x: 136.4, z: -13.5, h: 7.0 },
    { x: 141.5, z: -10.5, h: 12.5 },
    { x: 152.0, z: 6.5, h: 13.0 },
    { x: 163.5, z: 18.0, h: 13.0 },
    { x: 171.5, z: 17.5, h: 9.0 },
  ];
  for (let i = 1; i < anchors.length; i++) {
    const b = anchors[i];
    const py = makePylon(b.h);
    const gB = bedAt(b.x, b.z);
    py.position.set(b.x, gB - 0.2, b.z);
    group.add(py);
  }
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    const ya = bedAt(a.x, a.z) + a.h * 0.9;
    const yb = bedAt(b.x, b.z) + b.h * 0.9;
    for (const off of [-1.1, 0, 1.1]) {
      const n = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(off);
      const ca = new THREE.Vector3(a.x + n.x, ya, a.z + n.z);
      const cb = new THREE.Vector3(b.x + n.x, yb, b.z + n.z);
      group.add(makeCable(ca, cb, 1.4 + off * 0.1, cableMat));
    }
  }

  return { group, rotors };
}

// ============================================================ TOWN
interface StreetSeg { pts: [number, number][]; w: number }

const TOWN_STREETS: StreetSeg[] = [
  // right bank (z > 0) — main district
  { pts: [[152, 20.8], [158, 21.4], [166, 22.0], [174, 22.6], [182, 23.4], [186, 24.0]], w: 3.0 },
  { pts: [[156.5, 21.0], [157.2, 30], [157.6, 38]], w: 2.6 },
  { pts: [[164.5, 21.6], [165.2, 30], [165.8, 38.5]], w: 2.6 },
  { pts: [[172.5, 22.2], [173.2, 30], [173.8, 37]], w: 2.6 },
  { pts: [[180.5, 23.0], [181.2, 30], [181.8, 36]], w: 2.4 },
  { pts: [[153, 17.2], [160, 17.6], [168, 18.2], [176, 18.9], [184, 19.7]], w: 2.4 }, // river road
  // left bank (z < 0)
  { pts: [[152, -23.2], [160, -23.8], [168, -24.6], [176, -25.6], [183, -26.6]], w: 3.0 },
  { pts: [[158.5, -21.4], [159.2, -30], [159.8, -38]], w: 2.6 },
  { pts: [[168.5, -22.4], [169.2, -30], [169.8, -37]], w: 2.6 },
  { pts: [[153, -17.4], [160, -17.8], [168, -18.4], [176, -19.2]], w: 2.4 },
];

// ---- ring-city layout (open-world district wrapped around the valley floor)
const TOWN_C: [number, number] = [BOWL_CX, 0]; // ring centre = circular bowl centre
const RINGS: { r: number; w: number }[] = [
  { r: 17.5, w: 4.0 },
  { r: 24.5, w: 4.2 },
  { r: 31.5, w: 4.0 },
  { r: 38.5, w: 3.8 },
  { r: 45.5, w: 3.4 },
];
const RING_HALF = 2.0; // rad — arcs wrap ~230° around the downstream bowl
const RADIAL_ANGLES = [0.42, 0.8, 1.18, 1.56]; // rad, mirrored per bank

function arcPts(r: number, half: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = -half + (2 * half * i) / n;
    pts.push([TOWN_C[0] + r * Math.cos(a), TOWN_C[1] + r * Math.sin(a)]);
  }
  return pts;
}
function rayPts(a: number, r0: number, r1: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const r = r0 + ((r1 - r0) * i) / n;
    pts.push([TOWN_C[0] + r * Math.cos(a), TOWN_C[1] + r * Math.sin(a)]);
  }
  return pts;
}

// clearance network: every street / expressway segment buildings must dodge
interface ClearSeg { ax: number; az: number; bx: number; bz: number }
const CLEAR_SEGS: ClearSeg[] = [];
function pushClear(pts: [number, number][]): void {
  for (let i = 0; i < pts.length - 1; i++)
    CLEAR_SEGS.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] });
}

const RING_PTS: [number, number][][] = RINGS.map((rg) => arcPts(rg.r, RING_HALF, 30));
for (const st of TOWN_STREETS) pushClear(st.pts);
for (const pts of RING_PTS) pushClear(pts);
const RADIAL_PTS: [number, number][][] = [];
for (const a of RADIAL_ANGLES)
  for (const s of [1, -1]) {
    const pts = rayPts(a * s, 15.5, 47.5, 10);
    RADIAL_PTS.push(pts);
    pushClear(pts);
  }

// elevated expressway + interchange (the reference map's spaghetti junction)
const EXP_A: [number, number][] = [[116, 29], [126, 27.5], [138, 26], [150, 25], [162, 24.5], [174, 25], [186, 26.5]];
const EXP_B: [number, number][] = [[168, 31.5], [161, 22], [155.5, 10], [153, -1], [154.5, -13], [160, -23], [166, -31.5]];
const RAMP_A1: [number, number][] = [[174, 25], [178.5, 29], [181.5, 33], [182.5, 36.5]];
const RAMP_A2: [number, number][] = [[116, 29], [112.5, 32.5], [111, 36]];
const RAMP_B1: [number, number][] = [[166, -31.5], [170.5, -35], [173.5, -38.5]];
const RAMP_AB: [number, number][] = [[161, 24.6], [164, 27.6], [167.2, 30.9]];
pushClear(EXP_A);
pushClear(EXP_B);
pushClear(RAMP_A1);
pushClear(RAMP_A2);
pushClear(RAMP_B1);
pushClear(RAMP_AB);

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

// landmark / kept-site clearance rectangles (cx, cz, w, d)
const CLEAR_RECTS: [number, number, number, number][] = [
  [166, 27.5, 12, 12], [160.5, 26.5, 10, 7], [172, 35.5, 21, 14], // plaza+clock, market, pitch
  [176, -30, 6, 6], [154, -34, 8, 6], [158, 36, 8, 8], // water tower, temple, park grove
  [176, -35, 14, 9], [180, -28, 10, 12], [174, 36, 13, 8], [182, 30, 9, 10], [186, -20, 8, 10], // farms
  [127.5, 27.5, 7, 6], [135, 29.5, 8, 6], [143, 28.5, 6, 6], // industry sheds
  [159, 17, 7, 7], [172, -18.5, 7, 7], [181, 29, 7, 7], [150, -24, 7, 7], [181, -31, 7, 7], // landmark towers
];
function clearOfSites(x: number, z: number, m = 1.4): boolean {
  for (const [cx, cz, w, d] of CLEAR_RECTS)
    if (Math.abs(x - cx) < w / 2 + m && Math.abs(z - cz) < d / 2 + m) return false;
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

function deckPiers(
  group: THREE.Group, P: { x: number; z: number; y: number }[],
  r: number, mat: THREE.Material, minH = 1.4,
): void {
  for (let i = 3; i < P.length - 2; i += 4) {
    const g = bedAt(P[i].x, P[i].z);
    const hh = P[i].y - g;
    if (hh < minH) continue;
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r, hh - 0.12, 8), mat);
    pier.position.set(P[i].x, g + (hh - 0.12) / 2, P[i].z);
    pier.castShadow = true;
    group.add(pier);
  }
}

// elevated expressway: deck on pylons following ground + hAbove, edge beams,
// centre dashes, plus sloped ramps down to street level
function buildExpressway(group: THREE.Group): void {
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x58585e, roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide });
  const beamMat = matConcreteDark();
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.8 });

  const road = (pts: [number, number][], h0: number, h1: number, w: number): void => {
    const P = profileRibbon(group, pts, w, deckMat, (x, z, t) => bedAt(x, z) + h0 + (h1 - h0) * t);
    // edge beams slightly under the deck
    profileRibbon(group, pts, w + 0.7, beamMat, (x, z, t) => bedAt(x, z) + h0 + (h1 - h0) * t - 0.16, false);
    // pylons where the deck is well above ground (never in the river channel)
    for (let i = 3; i < P.length - 2; i += 4) {
      const g = bedAt(P[i].x, P[i].z);
      const hh = P[i].y - g;
      if (hh < 1.8 || Math.abs(P[i].z) < 13) continue;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.72, hh - 0.1, 0.72), beamMat);
      pylon.position.set(P[i].x, g + (hh - 0.1) / 2, P[i].z);
      pylon.castShadow = true;
      group.add(pylon);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.3, 1.0), beamMat);
      cap.position.set(P[i].x, P[i].y - 0.3, P[i].z);
      group.add(cap);
    }
    // centre dashes (instanced)
    const dashT: THREE.Matrix4[] = [];
    for (let i = 2; i < P.length - 2; i += 3) {
      const a = P[i], b = P[i + 1];
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const mm = new THREE.Matrix4();
      mm.makeRotationY(yaw);
      mm.setPosition(a.x, a.y + 0.04, a.z);
      dashT.push(mm);
    }
    if (dashT.length) {
      const dashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.04, 1.7), lineMat, dashT.length);
      dashT.forEach((mm, i) => dashMesh.setMatrixAt(i, mm));
      group.add(dashMesh);
    }
  };

  road(EXP_A, 5.6, 5.6, 5.0);   // +z bank elevated highway
  road(EXP_B, 5.2, 5.2, 5.0);   // signature river-crossing elevated highway
  road(RAMP_A1, 5.6, 0.16, 3.6); // down-ramp to the outer ring
  road(RAMP_A2, 5.6, 0.16, 3.6); // down-ramp near the dam bench
  road(RAMP_B1, 5.2, 0.16, 3.6); // down-ramp on the left bank
  road(RAMP_AB, 5.6, 5.2, 3.6);  // flyover connector A → B
}

function flatRibbon(group: THREE.Group, pts: [number, number][], w: number, mat: THREE.Material, lift = 0.14): void {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s < 3; s++) {
      const t0 = s / 3, t1 = (s + 1) / 3;
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

export function buildTown(): { group: THREE.Group } {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x45454a, roughness: 0.95 });
  const paving = new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: 0.95 });

  // old-town grid streets
  for (const st of TOWN_STREETS) flatRibbon(group, st.pts, st.w, asphalt);

  // ---- ring boulevards — arched decks over the river channel (bridges);
  // lighter asphalt so the concentric arcs read from the air like the
  // reference map's ring highways
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x585862, roughness: 0.9 });
  RING_PTS.forEach((pts, ri) => {
    const P = profileRibbon(group, pts, RINGS[ri].w, ringMat, (x, z) => {
      const g = bedAt(x, z);
      const arch = Math.max(0, 1 - Math.abs(z) / 14);
      return Math.max(g + 0.16, bedAt(x, 0) + 3.6 + 1.15 * arch * arch);
    });
    deckPiers(group, P, 0.4, matConcreteDark());
  });

  // radial avenues linking the rings to the old core
  for (const pts of RADIAL_PTS) flatRibbon(group, pts, 2.5, asphalt);

  // riverside promenades (trees + lamps line these)
  flatRibbon(group, [[124, 12.4], [140, 12.2], [158, 12.2], [176, 12.4], [190, 12.8]], 1.9, paving);
  flatRibbon(group, [[124, -12.4], [140, -12.3], [158, -12.3], [176, -12.5], [190, -12.9]], 1.9, paving);

  // ---- elevated expressway + interchange
  buildExpressway(group);

  // ---- dense districts (instanced, three building classes)
  const bldTex = makeBuildingTex();
  const lowMat = new THREE.MeshStandardMaterial({ map: bldTex, roughness: 0.85, metalness: 0.05 });
  const midMat = new THREE.MeshStandardMaterial({ map: makeTowerTex(false), roughness: 0.68, metalness: 0.1 });
  const glassMat = new THREE.MeshStandardMaterial({ map: makeTowerTex(true), roughness: 0.38, metalness: 0.35, envMapIntensity: 0.35 });
  interface BSpot { x: number; z: number; w: number; d: number; h: number; rot: number; tone: number }
  const spotsL: BSpot[] = [];
  const spotsM: BSpot[] = [];
  const spotsH: BSpot[] = [];
  const tones = [0xd9cdb4, 0xcbb99b, 0xd8d2c4, 0xc2b49a, 0xd3c1a6, 0xbfae94, 0xded6c6, 0xb7a68c];
  const glassTones = [0x8fa4b2, 0xa3b8c4, 0x7f98a8, 0xb0c2cc];
  // deterministic scatter — CONCENTRIC RING DISTRICTS: buildings arrayed in
  // tangentially-oriented arcs around the bowl centre (the reference map's
  // circular city), towers toward the core, terraced low-rise at the rim
  let seed = 1;
  const nextRnd = () => hashRnd(seed++ * 12.9898);
  const RING_BUILD_R = [16, 19.5, 23, 26.5, 30, 33.5, 37, 40.5, 44];
  for (let ri = 0; ri < RING_BUILD_R.length; ri++) {
    const r0 = RING_BUILD_R[ri];
    const arc = 2 * RING_HALF * r0;
    const n = Math.max(8, Math.floor(arc / 4.2));
    for (let i = 0; i < n; i++) {
      const a = -RING_HALF + (2 * RING_HALF * i) / (n - 1) + (nextRnd() - 0.5) * (2.6 / r0);
      const r = r0 + (nextRnd() - 0.5) * 3.0;
      const x = TOWN_C[0] + r * Math.cos(a);
      const z = r * Math.sin(a);
      if (Math.abs(z) < 12.4 || Math.abs(z) > 52) continue; // river corridor
      if (distToPaths(x, z) < 3.0) continue;
      if (!clearOfSites(x, z)) continue;
      const ground = bedAt(x, z);
      if (ground < 3.3 || ground > 16.5) continue;
      const slope = Math.abs(bedAt(x + 2, z) - ground) + Math.abs(bedAt(x, z + 2) - ground);
      if (slope > 2.1) continue;
      if (nextRnd() < 0.13) continue;
      // tangential orientation — street fronts follow the ring curvature
      const rot = a + Math.PI / 2 + (nextRnd() - 0.5) * 0.26;
      // skyline weight — towers cluster on the inner rings near the dam
      const core = clamp(1 - (r - 15) / 30, 0, 1);
      const roll = nextRnd();
      if (core > 0.35 && roll < 0.06 + 0.22 * core) {
        spotsH.push({ x, z, w: 3.9 + nextRnd() * 1.6, d: 3.5 + nextRnd() * 1.5, h: 13.5 + nextRnd() * 9.5, rot, tone: Math.floor(nextRnd() * glassTones.length) });
      } else if (roll < 0.52) {
        spotsM.push({ x, z, w: 3.1 + nextRnd() * 1.4, d: 2.9 + nextRnd() * 1.3, h: 6.8 + nextRnd() * 6.2, rot, tone: Math.floor(nextRnd() * tones.length) });
      } else {
        spotsL.push({ x, z, w: 2.6 + nextRnd() * 1.6, d: 2.4 + nextRnd() * 1.5, h: 2.8 + nextRnd() * 3.4, rot, tone: Math.floor(nextRnd() * tones.length) });
      }
    }
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const col = new THREE.Color();
  const buildClass = (spots: BSpot[], mat: THREE.Material, tint: number[], roofsToo: boolean): void => {
    const inst = new THREE.InstancedMesh(boxGeo, mat, spots.length);
    spots.forEach((s, i) => {
      eu.set(0, s.rot, 0);
      q.setFromEuler(eu);
      m4.compose(new THREE.Vector3(s.x, bedAt(s.x, s.z) + s.h / 2 - 0.12, s.z), q, new THREE.Vector3(s.w, s.h, s.d));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.setHex(tint[s.tone]));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    if (!roofsToo) return;
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8d867b, roughness: 0.95 });
    const roofs = new THREE.InstancedMesh(boxGeo, roofMat, spots.length);
    let ri = 0;
    spots.forEach((s, i) => {
      if (hashRnd(i * 3.77 + s.x) < 0.45) return;
      m4.compose(new THREE.Vector3(s.x, bedAt(s.x, s.z) + s.h + 0.06, s.z), q.identity(), new THREE.Vector3(s.w + 0.35, 0.16, s.d + 0.35));
      roofs.setMatrixAt(ri++, m4);
    });
    roofs.count = ri;
    roofs.castShadow = true;
    group.add(roofs);
  };
  buildClass(spotsL, lowMat, tones, true);
  buildClass(spotsM, midMat, tones, true);
  buildClass(spotsH, glassMat, glassTones, false);

  // ---- landmark skyline towers (glass shafts + crowns + aviation beacons)
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff5540, emissive: 0xcc2200, emissiveIntensity: 1.4, roughness: 0.4 });
  for (const [tx, tz, th, gi] of [
    [159, 17, 24, 0], [172, -18.5, 21, 1], [181, 29, 18, 0], [150, -24, 19, 1], [181, -31, 16, 0],
  ] as const) {
    const tg = bedAt(tx, tz);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(4.4, th, 4.0), gi ? glassMat : midMat);
    shaft.position.y = th / 2 - 0.1;
    shaft.castShadow = shaft.receiveShadow = true;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.6, 4.4), matConcreteDark());
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

  // ---- city trees (instanced groves lining promenades + filling blocks)
  {
    const treeSpots: { x: number; z: number; s: number }[] = [];
    for (let x = 126; x <= 190; x += 3.6) {
      const k = Math.floor(x / 3.6) % 2;
      treeSpots.push({ x, z: 11.8 + k * 0.7, s: 0.85 + hashRnd(x) * 0.5 });
      treeSpots.push({ x: x + 1.8, z: -11.8 - k * 0.7, s: 0.85 + hashRnd(x * 3) * 0.5 });
    }
    // ring-boulevard tree lines — green arcs echoing the circular layout
    for (const rg of RINGS) {
      const arc = 2 * RING_HALF * rg.r;
      const nT = Math.max(10, Math.floor(arc / 6.2));
      for (let i = 0; i <= nT; i++) {
        const a = -RING_HALF + (2 * RING_HALF * i) / nT;
        for (const off of [2.3, -2.3]) {
          const x = TOWN_C[0] + (rg.r + off) * Math.cos(a);
          const z = (rg.r + off) * Math.sin(a);
          if (Math.abs(z) < 12.6) continue;
          if (distToPaths(x, z) < 2.6) continue;
          if (hashRnd(x * 5.1 + z * 3.3) < 0.3) continue;
          const ground = bedAt(x, z);
          if (ground < 3.3 || ground > 17) continue;
          treeSpots.push({ x, z, s: 0.8 + hashRnd(x * 7 + z) * 0.5 });
        }
      }
    }
    for (let x = 124; x <= 189; x += 5.1) {
      for (const zs of [1, -1]) {
        for (let g = 0; g < 9; g++) {
          const z = zs * (15 + g * 4.1);
          if (Math.abs(z) > 47) continue;
          if (distToPaths(x, z) < 3.4) continue;
          if (!clearOfSites(x, z, 0.4)) continue;
          const ground = bedAt(x, z);
          if (ground < 3.3 || ground > 16.5) continue;
          if (hashRnd(x * 3.1 + z * 7.7) < 0.6) continue;
          treeSpots.push({ x: x + hashRnd(x + z) * 2.2, z: z + hashRnd(x * 2 + z) * 2.2, s: 0.75 + hashRnd(x * 5 + z) * 0.7 });
        }
      }
    }
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.15, 1.7, 5);
    const folGeo = new THREE.IcosahedronGeometry(1.05, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
    const folMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const fols = new THREE.InstancedMesh(folGeo, folMat, treeSpots.length);
    const greens = [0x2f6d33, 0x3f7d3a, 0x54803c, 0x2c5c30, 0x4a7a35];
    treeSpots.forEach((s, i) => {
      const g = bedAt(s.x, s.z);
      m4.makeTranslation(s.x, g + 0.8 * s.s, s.z);
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(s.x, g + 2.1 * s.s, s.z), q.identity(), new THREE.Vector3(s.s, s.s * 1.25, s.s));
      fols.setMatrixAt(i, m4);
      fols.setColorAt(i, col.setHex(greens[Math.floor(hashRnd(s.x * 9 + s.z) * greens.length)]));
    });
    trunks.castShadow = true;
    fols.castShadow = true;
    group.add(trunks, fols);
  }

  // ---- landmarks
  // clock tower + plaza (right bank heart)
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(5.2, 26), paving);
  plaza.rotation.x = -Math.PI / 2;
  const pzG = bedAt(166, 27.5);
  plaza.position.set(166, pzG + 0.16, 27.5);
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
  towerG.position.set(166, pzG, 27.5);
  group.add(towerG);

  // water tower (left bank)
  const wt = new THREE.Group();
  const wtG = bedAt(176, -30);
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
  wt.position.set(176, wtG, -30);
  group.add(wt);

  // market canopy
  const mk = new THREE.Group();
  const mkG = bedAt(160.5, 26.5);
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
  mk.position.set(160.5, mkG, 26.5);
  group.add(mk);

  // football pitch
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(19, 12),
    new THREE.MeshStandardMaterial({ map: makePitchTex(), roughness: 0.95 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.rotation.z = 0.06;
  const piG = bedAt(172, 35.5);
  pitch.position.set(172, piG + 0.12, 35.5);
  pitch.receiveShadow = true;
  group.add(pitch);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 3.4), matWhite());
    post.position.set(172 + s * 9.2, piG + 0.75, 35.5);
    group.add(post);
  }

  // temple shrine (left bank)
  const tp = new THREE.Group();
  const tpG = bedAt(154, -34);
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
  tp.position.set(154, tpG, -34);
  group.add(tp);

  // park grove + benches
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.92, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
  const parkSpots: [number, number][] = [[157.5, 33], [159.5, 35.5], [156, 36.5], [161, 32.5], [158.5, 38]];
  for (const [px, pz] of parkSpots) {
    const g = bedAt(px, pz);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.8, 6), trunkMat);
    trunk.position.set(px, g + 0.9, pz);
    trunk.castShadow = true;
    const blob = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0 + hashRnd(px * 3 + pz) * 0.6, 0), leafMat);
    blob.position.set(px, g + 2.5, pz);
    blob.castShadow = true;
    group.add(trunk, blob);
  }
  for (const [bx, bz, r] of [[164.5, 29.5, 0.4], [167.8, 25.4, -0.6]] as const) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), trunkMat);
    bench.position.set(bx, bedAt(bx, bz) + 0.45, bz);
    bench.rotation.y = r;
    group.add(bench);
  }

  // streetlights (instanced) — old grid + ring boulevards
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
  for (const pts of RING_PTS) {
    for (let i = 0; i < pts.length - 1; i += 2) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      lightSpots.push([(ax + bx) / 2 + 1.6, (az + bz) / 2 + 1.3]);
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

  // farmland patches on the outskirts
  const crops: [number, number, number, number, string, string][] = [
    [176, -35, 13, 8, '#7a8f43', '#5d7034'],
    [180, -28, 9, 11, '#9a8a4a', '#7d7038'],
    [174, 36, 12, 7, '#8a9a4a', '#6d7d38'],
    [182, 30, 8, 9, '#a5935a', '#87754a'],
    [186, -20, 7, 9, '#7d8f4a', '#63753a'],
  ];
  for (const [fx, fz, fw, fd, ca, cb] of crops) {
    const g = bedAt(fx, fz);
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fd),
      new THREE.MeshStandardMaterial({ map: makeFieldTex(ca, cb), roughness: 1 }),
    );
    field.rotation.x = -Math.PI / 2;
    field.rotation.z = hashRnd(fx + fz) * 0.5;
    field.position.set(fx, g + 0.1, fz);
    field.receiveShadow = true;
    group.add(field);
  }

  // light-industry sheds near the dam (right bench)
  for (const [sx, sz, sw] of [[127.5, 27.5, 5.5], [135, 29.5, 6.5], [143, 28.5, 5.0]] as const) {
    const g = bedAt(sx, sz);
    const shed = new THREE.Mesh(new THREE.BoxGeometry(sw, 2.6, 4.2), matGalvanised());
    shed.position.set(sx, g + 1.3, sz);
    shed.castShadow = true;
    const shedRoof = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, sw, 10, 1, false, 0, Math.PI), matConcreteDark());
    shedRoof.rotation.z = Math.PI / 2;
    shedRoof.rotation.y = Math.PI / 2;
    shedRoof.scale.y = 0.45;
    shedRoof.position.set(sx, g + 2.6, sz);
    shedRoof.castShadow = true;
    group.add(shed, shedRoof);
  }

  return { group };
}

// ============================================================ FAR TERRAIN
// Visual-only continuation of the world beyond the solver domain: the valley
// runs on, then a broad amphitheater of SMOOTH ROLLING HILLS closes the
// horizon — the user asked for NO jagged mountains, so every wall is a soft
// exponential dome modulated by gentle fbm (no ridged-noise crest lines).
function sstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
function farBed(x: number, z: number): number {
  const cx = clamp(x, 0.2, LX - 0.2);
  const cz = clamp(z, -LZ / 2 + 0.2, LZ / 2 - 0.2);
  let h = bedAt(cx, cz);
  // distance beyond each solver-domain edge
  const dUp = Math.max(-x, 0);
  const dDown = Math.max(x - LX, 0);
  const dNorth = Math.max(-LZ / 2 - z, 0);
  const dSouth = Math.max(z - LZ / 2, 0);
  // rolling amphitheater — each wall eases in exponentially and caps far below
  // the old jagged 260 m peaks: the north wall (behind the dam) is tallest
  // (~85 m over the valley), the upstream headwall ~65 m, the downstream east
  // wall ~75 m, and the south rim stays low (~40 m) so the default aerial
  // camera still looks over it into the city bowl
  const rise = Math.max(
    dUp > 0 ? (1 - Math.exp(-dUp / 55)) * 60 : 0,
    dDown > 0 ? (dDown > 34 ? (1 - Math.exp(-(dDown - 34) / 60)) * 70 : 0) : 0,
    dNorth > 0 ? (1 - Math.exp(-dNorth / 48)) * 72 : 0,
    dSouth > 0 ? (1 - Math.exp(-dSouth / 70)) * 38 : 0,
  );
  if (rise > 0) {
    // smooth fbm only — frequencies kept well below the terrain mesh sampling
    // rate (anything finer aliases into triangular spikes); the squared massif
    // mask gives broad dome-like ridges instead of sharp crests
    const m1 = fbm(x * 0.012 + 7.7, z * 0.012 + 2.9, 3); // broad massifs
    const m2 = fbm(x * 0.027 + 1.2, z * 0.027 + 8.8, 3); // gentle undulation
    const hills = 0.52 + 0.58 * m1 * m1; // 0.52..1.10 — rounded domes
    h += rise * hills * (0.7 + 0.55 * m2);
    h += (fbm(x * 0.033 + 3.3, z * 0.033 + 6.1, 2) - 0.5) * Math.min(2.2 + rise * 0.05, 5.5);
  }
  // Circular continuation of the city-bowl rim: beyond the solver domain the
  // amphitheater keeps curving around the map (downstream half) instead of
  // reading as a rectangular valley. Phased in over ~30 m past each domain
  // edge so the seam stays flush with the domain mesh, and carved along the
  // river corridor (|z| ≲ 10-26 m) so the waterway runs on to the horizon.
  const rC = Math.hypot(x - BOWL_CX, z);
  if (x > 104 && rC > BOWL_R) {
    const beyond = Math.max(dUp, dDown, dNorth, dSouth);
    const phase = sstep(1.5, 32, beyond);
    const gorge = sstep(10, 26, Math.abs(z));
    const rim = (1 - Math.exp(-(rC - BOWL_R) / 20)) * 30;
    const m2 = fbm(x * 0.027 + 1.2, z * 0.027 + 8.8, 3);
    h += rim * gorge * (0.7 + 0.55 * m2) * phase;
  }
  return h;
}

function farPatch(
  x0: number, x1: number, z0: number, z1: number, sx: number, sz: number, sink = 0,
): THREE.Group {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const tc = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = farBed(x, z) - sink;
    pos.setY(i, y);
    const e = 3.2;
    const sl = Math.hypot(farBed(x + e, z) - farBed(x - e, z), farBed(x, z + e) - farBed(x, z - e)) / (2 * e);
    terrainColor(x, z, y, sl, tc);
    col.setRGB(tc.r, tc.g, tc.b, THREE.SRGBColorSpace);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Perimeter skirt: neighbouring patches share edge heights but have different
  // vertex spacings, so T-junction interpolation opens hairline cracks that
  // read as white specks from afar. Dropping a terrain-colored ribbon around
  // every edge hides any gap, whatever the viewing angle.
  const SKIRT = 7;
  const gridW = sx + 1;
  const gridH = sz + 1;
  const boundary: number[] = [];
  for (let ix = 0; ix < gridW; ix++) boundary.push(ix); // north row (z0)
  for (let iz = 1; iz < gridH; iz++) boundary.push(iz * gridW + gridW - 1); // east col
  for (let ix = gridW - 2; ix >= 0; ix--) boundary.push((gridH - 1) * gridW + ix); // south row
  for (let iz = gridH - 2; iz >= 1; iz--) boundary.push(iz * gridW); // west col
  const baseCount = pos.count;
  const skirtVerts = boundary.length * 2;
  const posArr = new Float32Array((baseCount + skirtVerts) * 3);
  posArr.set(pos.array as Float32Array);
  const colArr = new Float32Array((baseCount + skirtVerts) * 3);
  colArr.set(colors);
  for (let k = 0; k < boundary.length; k++) {
    const b = boundary[k];
    for (let c = 0; c < 3; c++) {
      posArr[(baseCount + k * 2) * 3 + c] = posArr[b * 3 + c];
      colArr[(baseCount + k * 2) * 3 + c] = colArr[b * 3 + c];
      posArr[(baseCount + k * 2 + 1) * 3 + c] = posArr[b * 3 + c];
      colArr[(baseCount + k * 2 + 1) * 3 + c] = colArr[b * 3 + c];
    }
    posArr[(baseCount + k * 2 + 1) * 3 + 1] -= SKIRT;
  }
  const idx = new Uint32Array(boundary.length * 6);
  for (let k = 0; k < boundary.length; k++) {
    const k2 = (k + 1) % boundary.length;
    const tA = baseCount + k * 2, bA = tA + 1, tB = baseCount + k2 * 2, bB = tB + 1;
    idx[k * 6] = tA; idx[k * 6 + 1] = tB; idx[k * 6 + 2] = bA;
    idx[k * 6 + 3] = bA; idx[k * 6 + 4] = tB; idx[k * 6 + 5] = bB;
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  skirtGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  skirtGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  skirtGeo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.97, metalness: 0, envMapIntensity: 0.18, side: THREE.DoubleSide,
  });
  const top = new THREE.Mesh(geo, mat);
  const skirt = new THREE.Mesh(skirtGeo, mat);
  skirt.receiveShadow = false;
  const group = new THREE.Group();
  group.add(top, skirt);
  return group;
}

export function buildFarTerrain(): { group: THREE.Group } {
  const group = new THREE.Group();
  const E = 260; // how far the ring extends sideways
  const Z0 = -LZ / 2;
  const Z1 = LZ / 2;
  // Seam apron: the domain terrain mesh samples bedAt at CELL CENTERS while a
  // far patch at the exact edge samples the analytic bed — the half-cell offset
  // used to open hairline cracks (white streaks) along every domain edge once
  // the jagged peaks that hid them were removed. Each patch now extends ~2.5 m
  // INTO the domain, sunk 0.8 m below the bed, so the domain surface always
  // renders on top of a tucked-under apron — no crack can ever open.
  const OV = 2.5;
  const SINK = 0.8;
  // upstream continuation — rises into the headwall range that hugs the lake
  // (also covers both far corners)
  group.add(farPatch(-260, OV, -E, E, 60, 100, SINK));
  // downstream continuation toward the horizon (also covers both far corners)
  group.add(farPatch(LX - OV, LX + 260, -E, E, 60, 100, SINK));
  // side ranges — inset in x so they meet, never overlap, the upstream and
  // downstream patches
  group.add(farPatch(OV, LX - OV, Z0 - E, Z0 + OV, 76, 64, SINK));
  group.add(farPatch(OV, LX - OV, Z1 - OV, Z1 + E, 76, 64, SINK));
  return { group };
}
