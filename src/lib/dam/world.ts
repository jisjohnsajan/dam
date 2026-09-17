// DAMSAFE 3D — world dressing for the SQUARE CANVAS map: hydroelectric
// powerhouse (intake tower, penstocks, turbine hall, tailrace, transformers,
// transmission line), the downstream city districts, villages, farmland and
// the far terrain ring that closes the horizon beyond the solver domain.
//
// Layout: dam + reservoir in the TOP-LEFT corner, river running east along the
// upper canvas, city plain fanning across the centre/south-east, farmland on
// the southern belt + south-west lakeside quadrant.
//
// Everything here is VISUAL dressing: the GPU shallow-water solver keeps
// running on its own domain, so the powerhouse/town sit on bedAt() ground and
// the flood wave genuinely reaches them during scenarios.
import * as THREE from 'three';
import { LX, LZ, bedAt, terrainColor, fbm, AXIS_Z, DAM_X, axisAt } from './terrain';

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
  const iBed = bedAt(34.8, -69);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 15, 4.6), conc);
  tower.position.set(34.8, iBed + 6.6, -69); // top ≈ 25.1 (2 m above crest)
  tower.castShadow = tower.receiveShadow = true;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.32, 5.5), concDark);
  deck.position.set(34.8, iBed + 14.0, -69);
  deck.castShadow = true;
  intake.add(tower, deck);
  // gantry hoist on the deck
  for (const dz of [-1.7, 1.7]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), steel);
    col.position.set(33.6, iBed + 15.3, -69 + dz);
    intake.add(col, col.clone().translateX(2.4));
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.2), steel);
  beam.position.set(34.8, iBed + 16.5, -69);
  const hoist = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.55), matDark());
  hoist.position.set(34.8, iBed + 16.0, -69);
  intake.add(beam, hoist);
  // trash racks on the upstream face
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.4, 4.0), matDark());
  rackFrame.position.set(32.95, iBed + 6.4, -69);
  intake.add(rackFrame);
  for (let k = 0; k < 10; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 6.2, 0.09), steel);
    bar.position.set(32.88, iBed + 6.4, -70.8 + k * 0.4);
    intake.add(bar);
  }
  // dark intake openings facing the dam + wet well rim
  for (const oy of [2.0, 4.6]) {
    const open = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 1.5), matDark());
    open.position.set(36.65, iBed + oy, -69);
    intake.add(open);
  }
  group.add(intake);

  // service bridge intake → crest
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.24, 2.1), concDark);
  bridge.position.set(38.2, iBed + 14.0, -69);
  bridge.castShadow = true;
  group.add(bridge);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 0.05), steel);
    rail.position.set(38.2, iBed + 14.42, -69 + s * 0.95);
    group.add(rail);
  }

  // exposed conduit across the upstream face (tower → dam body, submerged)
  const feedCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(36.4, iBed + 7.1, -69),
    new THREE.Vector3(38.2, iBed + 7.1, -69),
    new THREE.Vector3(40.1, iBed + 7.1, -69),
  ]);
  const feed = new THREE.Mesh(new THREE.TubeGeometry(feedCurve, 8, 0.52, 10, false), steel);
  group.add(feed);

  // ---- penstocks down the downstream face → powerhouse
  const penMat = matSteel();
  const penZ = [-70.6, -67.4];
  for (const z of penZ) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(44.9, 19.4, z),
      new THREE.Vector3(46.4, 15.8, z),
      new THREE.Vector3(48.1, 12.9, z),
      new THREE.Vector3(50.9, 12.4, z),
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
  const phBed = bedAt(54.3, -69);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.5, 10.2), concDark);
  floor.position.set(54.3, phBed + 0.25, -69);
  floor.receiveShadow = true;
  ph.add(floor);
  const wallH = 5.4;
  const backW = new THREE.Mesh(new THREE.BoxGeometry(0.35, wallH, 10.2), conc);
  backW.position.set(50.65, phBed + wallH / 2, -69);
  backW.castShadow = backW.receiveShadow = true;
  const sideA = new THREE.Mesh(new THREE.BoxGeometry(7.8, wallH, 0.35), conc);
  sideA.position.set(54.3, phBed + wallH / 2, -74.0);
  const sideB = sideA.clone();
  sideB.position.z = -64.0;
  ph.add(backW, sideA, sideB);
  // open front: columns + lintel
  for (const dz of [-73.6, -64.4]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, wallH, 0.5), conc);
    col.position.set(58.0, phBed + wallH / 2, dz);
    col.castShadow = true;
    ph.add(col);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 10.2), conc);
  lintel.position.set(58.0, phBed + wallH - 0.55, -69);
  lintel.castShadow = true;
  ph.add(lintel);
  // roof + monitor
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.32, 10.9), matWhite());
  roof.position.set(54.3, phBed + wallH + 0.35, -69);
  roof.castShadow = true;
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 7.0), matSteel());
  monitor.position.set(54.3, phBed + wallH + 0.85, -69);
  ph.add(roof, monitor);
  // crane rail inside
  for (const dz of [-73.3, -64.7]) {
    const railB = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 0.14), steel);
    railB.position.set(54.3, phBed + wallH - 0.25, dz);
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
  sign.position.set(58.36, phBed + wallH - 0.55, -69);
  sign.rotation.y = Math.PI / 2;
  ph.add(sign);
  group.add(ph);

  // ---- 2 turbine-generator units (visible through the open bay)
  for (const uz of [-71.4, -66.6]) {
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
    unit.position.set(53.6, 0, uz);
    group.add(unit);
    // draft tube exit through the back wall
    const draft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), concDark);
    draft.position.set(50.2, phBed + 0.75, uz);
    group.add(draft);
  }

  // ---- tailrace guide walls
  for (const [z0, z1] of [[-72.6, -71.2], [-65.4, -66.8]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.7, 0.4), concDark);
    const mx = 61.4;
    const mz = (z0 + z1) / 2;
    wall.position.set(mx, bedAt(mx, mz) + 0.6, mz);
    wall.rotation.y = Math.atan2(z1 - z0, 6.2) * -1;
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
  }

  // ---- transformer yard + switch gantry
  const yard = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.22, 6.2), new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.98 }));
  pad.position.set(61.2, bedAt(61.2, -58.5) + 0.11, -58.5);
  pad.receiveShadow = true;
  yard.add(pad);
  for (const dz of [-60.2, -56.8]) {
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
    tr.position.set(60.2, pad.position.y, dz);
    yard.add(tr);
  }
  // switch gantry + first cable anchor
  for (const dz of [-61.0, -56.0]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.0, 6), matGalvanised());
    col.position.set(64.4, bedAt(64.4, dz) + 3.5, dz);
    col.castShadow = true;
    yard.add(col);
  }
  const gBeam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 5.4), matGalvanised());
  gBeam.position.set(64.4, bedAt(64.4, -58.5) + 6.9, -58.5);
  yard.add(gBeam);
  group.add(yard);

  // ---- transmission line: powerhouse → city substation
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x30343a });
  const anchors: { x: number; z: number; h: number }[] = [
    { x: 64.4, z: -58.5, h: 7.0 },
    { x: 69.5, z: -51.0, h: 12.5 },
    { x: 81.0, z: -34.0, h: 13.0 },
    { x: 96.0, z: -12.0, h: 13.0 },
    { x: 110.0, z: 6.0, h: 12.5 },
    { x: 123.0, z: 21.0, h: 10.0 },
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

// ============================================================ CITY LAYOUT
interface StreetSeg { pts: [number, number][]; w: number }

// Square-canvas street network: riverside drive hugging the channel's south
// bank, a city grid across the plain, north-bench service road, farm tracks.
const TOWN_STREETS: StreetSeg[] = [
  // riverside drive (south bank of the river, follows the axis drift)
  { pts: [[52, -34], [64, -33.6], [76, -33], [88, -32.4], [100, -31.8], [112, -31.2], [124, -30.6], [136, -30.2], [150, -29.8]], w: 3.2 },
  // north-bench service road (between channel and north rim)
  { pts: [[56, -58], [70, -58.6], [84, -59], [98, -59.2], [112, -59.4], [126, -59.4], [140, -59], [152, -58.4]], w: 2.8 },
  // city grid — east-west avenues
  { pts: [[62, -18], [78, -18.2], [94, -18.4], [110, -18.4], [126, -18.2], [142, -18]], w: 3.0 },
  { pts: [[64, -8], [80, -8.2], [96, -8.2], [112, -8], [128, -7.6], [144, -7.4]], w: 3.4 },
  { pts: [[64, 2], [80, 2], [96, 2.2], [112, 2.4], [128, 2.6], [144, 2.8]], w: 3.4 },
  { pts: [[68, 12], [84, 12.2], [100, 12.4], [116, 12.6], [132, 12.8], [146, 13]], w: 3.0 },
  { pts: [[74, 22], [88, 22.2], [102, 22.4], [116, 22.8], [130, 23]], w: 2.8 },
  { pts: [[80, 32], [94, 32.2], [108, 32.4], [122, 32.6], [136, 32.6]], w: 2.6 },
  // city grid — north-south streets
  { pts: [[72, -24], [72, -14], [72, -4], [72, 6], [72, 16]], w: 2.8 },
  { pts: [[82, -24], [82, -14], [82, -4], [82, 6], [82, 16], [82, 26]], w: 3.0 },
  { pts: [[92, -24], [92, -14], [92, -4], [92, 6], [92, 16], [92, 24]], w: 3.0 },
  { pts: [[102, -22], [102, -12], [102, -2], [102, 8], [102, 18], [102, 28]], w: 3.0 },
  { pts: [[112, -22], [112, -12], [112, -2], [112, 8], [112, 18], [112, 26]], w: 2.8 },
  { pts: [[122, -22], [122, -12], [122, -2], [122, 8], [122, 18], [122, 30]], w: 3.0 },
  { pts: [[132, -20], [132, -10], [132, 0], [132, 10], [132, 20], [132, 30]], w: 2.8 },
  { pts: [[142, -16], [142, -6], [142, 4], [142, 14], [142, 22]], w: 2.6 },
  // west quarter connector + market street
  { pts: [[58, -12], [64, -11], [72, -10]], w: 2.2 },
  { pts: [[58, 8], [66, 8.4], [74, 8.6]], w: 2.2 },
  // farm lanes — southern belt
  { pts: [[56, 40], [70, 41], [84, 42], [98, 43], [112, 44], [126, 44.5], [140, 45]], w: 2.2 },
  { pts: [[64, 46], [66, 54], [68, 60]], w: 1.9 },
  { pts: [[96, 45], [98, 52], [100, 58]], w: 1.9 },
  { pts: [[122, 46], [120, 53], [118, 58]], w: 1.9 },
  // SW lakeside lane (villages + orchards south of the reservoir)
  { pts: [[24, -4], [28, 4], [32, 12], [36, 20], [40, 28]], w: 2.0 },
  { pts: [[12, 10], [20, 14], [28, 18], [36, 22]], w: 1.8 },
  // east approach toward the rim villages
  { pts: [[146, 24], [150, 32], [152, 40]], w: 2.0 },
];

// clearance network: every street / expressway segment buildings must dodge
interface ClearSeg { ax: number; az: number; bx: number; bz: number }
const CLEAR_SEGS: ClearSeg[] = [];
function pushClear(pts: [number, number][]): void {
  for (let i = 0; i < pts.length - 1; i++)
    CLEAR_SEGS.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] });
}
for (const st of TOWN_STREETS) pushClear(st.pts);

// elevated expressway along the corridor's north bench + dam access ramps
const EXP_A: [number, number][] = [[52, -62], [66, -63], [80, -63.6], [94, -64], [108, -64.2], [122, -64.2], [136, -63.8], [150, -63], [158, -62]];
const RAMP_A1: [number, number][] = [[52, -62], [49, -66], [47, -70]]; // down to the dam bench (west end)
const RAMP_A2: [number, number][] = [[158, -62], [160.5, -58], [161, -54]]; // east end exit ramp
const RAMP_A3: [number, number][] = [[108, -64.2], [106, -61], [105, -58]]; // spur to the north-bench road
pushClear(EXP_A);
pushClear(RAMP_A1);
pushClear(RAMP_A2);
pushClear(RAMP_A3);

// cross-river road bridges (decks drawn in buildTown; approaches here)
const BRIDGE_W: [number, number][] = [[124, -56], [124, -48], [124, -40], [124, -34]];
pushClear(BRIDGE_W);

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
  [98, -8, 8, 8], [92, -4, 8, 7], [110, 17, 22, 15], // plaza+clock, market, pitch
  [128, 14, 7, 7], [70, 6, 8, 7], [88, -14, 8, 7], // water tower, temple, park grove
  // farms — southern belt
  [56, 52, 13, 9], [72, 54, 13, 9], [90, 52, 12, 9], [108, 52, 12, 9], [124, 50, 12, 9], [140, 52, 11, 8],
  // farms — SW lakeside quadrant
  [18, 8, 11, 8], [30, 16, 10, 8], [20, 28, 10, 8], [34, 34, 9, 8],
  [146, 40, 10, 8], // east orchard
  // civic landmark complexes (hospital / school / factory / waterworks / fuel)
  [122, 10, 15, 11], [84, 12, 13, 11], [104, 35, 21, 12], [62, -34, 11, 10],
  [140, 18, 9, 8], [134, -4, 10, 8], [126, 26, 9, 8],
  // landmark towers
  [94, -12, 7, 7], [128, 0, 7, 7], [140, 26, 7, 7], [88, 8, 7, 7], [132, -12, 7, 7],
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
      if (hh < 1.8 || Math.abs(P[i].z - axisAt(P[i].x)) < 14) continue;
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

  road(EXP_A, 5.4, 5.4, 5.0);    // corridor expressway (north bench, full length)
  road(RAMP_A1, 5.4, 0.16, 3.4); // west down-ramp to the dam abutment bench
  road(RAMP_A2, 5.4, 0.16, 3.4); // east exit ramp toward the rim villages
  road(RAMP_A3, 5.4, 0.16, 3.0); // spur down to the north-bench service road
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
}

export function buildTown(): { group: THREE.Group; districts: DistrictBldgs[]; floodTrees: FloodTrees } {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x45454a, roughness: 0.95 });
  const paving = new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: 0.95 });

  // city street grid + riverside drive + farm lanes
  for (const st of TOWN_STREETS) flatRibbon(group, st.pts, st.w, asphalt);

  // ---- elevated expressway + ramps along the corridor bench
  buildExpressway(group);

  // ---- road bridge across the river at x = 124 (the config 'bridge' pin)
  {
    const bx = 124;
    const deckY = bedAt(bx, -42) + 3.4;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.5, 30), matConcrete());
    deck.position.set(bx, deckY, -41);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    const deckRoad = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.06, 30), asphalt);
    deckRoad.position.set(bx, deckY + 0.28, -41);
    group.add(deckRoad);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 30), new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.8 }));
      rail.position.set(bx + s * 1.85, deckY + 0.55, -41);
      group.add(rail);
    }
    for (const zc of [-48, -34]) {
      const g = bedAt(bx, zc);
      const hh = deckY - g + 0.6;
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, hh, 8), matConcrete());
      pier.position.set(bx, g + hh / 2 - 0.3, zc);
      pier.castShadow = true;
      group.add(pier);
    }
    // approach fills
    flatRibbon(group, [[124, -26], [124, -30.2]], 3.0, asphalt);
    flatRibbon(group, [[124, -55.6], [124, -58.6]], 3.0, asphalt);
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

  // deterministic scatter — SQUARE GRID DISTRICTS filling the city plain:
  // towers in the core, mid-rise east, terraced low-rise and villages around
  const DISTRICTS: { x0: number; z0: number; x1: number; z1: number; mix: 'core' | 'mid' | 'low' | 'village' }[] = [
    { x0: 78, z0: -21, x1: 112, z1: 14, mix: 'core' },
    { x0: 60, z0: -21, x1: 76, z1: 16, mix: 'low' },
    { x0: 114, z0: -21, x1: 148, z1: 15, mix: 'mid' },
    { x0: 66, z0: 17, x1: 100, z1: 33, mix: 'low' },
    { x0: 102, z0: 17, x1: 146, z1: 31, mix: 'low' },
    { x0: 114, z0: 34, x1: 148, z1: 45, mix: 'village' },
    { x0: 8, z0: 0, x1: 44, z1: 42, mix: 'village' },
  ];
  let seed = 1;
  const nextRnd = () => hashRnd(seed++ * 12.9898);
  for (const d of DISTRICTS) {
    const step = d.mix === 'village' ? 6.2 : 4.6;
    for (let gz = d.z0; gz <= d.z1; gz += step) {
      for (let gx = d.x0; gx <= d.x1; gx += step) {
        const x = gx + (nextRnd() - 0.5) * 2.2;
        const z = gz + (nextRnd() - 0.5) * 2.2;
        if (Math.abs(z - axisAt(x)) < 12.8) continue; // river channel
        if (distToPaths(x, z) < 2.7) continue;
        if (!clearOfSites(x, z)) continue;
        const ground = bedAt(x, z);
        if (ground < 3.2 || ground > (d.mix === 'village' ? 20 : 15.5)) continue;
        const slope = Math.abs(bedAt(x + 2, z) - ground) + Math.abs(bedAt(x, z + 2) - ground);
        if (slope > 2.4) continue;
        if (nextRnd() < (d.mix === 'village' ? 0.3 : 0.08)) continue;
        const rot = d.mix === 'village'
          ? nextRnd() * Math.PI
          : (nextRnd() - 0.5) * 0.12;
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

  // ---- landmark skyline towers (glass shafts + crowns + aviation beacons)
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff5540, emissive: 0xcc2200, emissiveIntensity: 1.4, roughness: 0.4 });
  for (const [tx, tz, th, gi] of [
    [94, -12, 24, 0], [128, 0, 21, 1], [140, 26, 18, 0], [88, 8, 19, 1], [132, -12, 16, 0],
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

  // ---- city + forest trees (instanced, floodable — engine tilts them in
  // high-velocity flow) — street lines, district groves, riverbank gallery,
  // rim forest belts
  {
    const treeSpots: { x: number; z: number; s: number }[] = [];
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
            const px = ax + (bx - ax) * t + Math.cos(0) * 0; // jitter below
            const x = px + (hashRnd(ax * 7 + k * 3) - 0.5) * 1.4;
            const z = az + (bz - az) * t + side * 2.3 + (hashRnd(x * 3 + az) - 0.5);
            if (Math.abs(z - axisAt(x)) < 13) continue;
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
      for (let k = 0; k < Math.floor(((d.x1 - d.x0) * (d.z1 - d.z0)) / 46); k++) {
        const x = d.x0 + hashRnd(k * 13.3 + d.x0) * (d.x1 - d.x0);
        const z = d.z0 + hashRnd(k * 7.7 + d.z0 * 2) * (d.z1 - d.z0);
        if (Math.abs(z - axisAt(x)) < 13) continue;
        if (distToPaths(x, z) < 3.2) continue;
        if (!clearOfSites(x, z, 0.4)) continue;
        const ground = bedAt(x, z);
        if (ground < 3.2 || ground > 16.5) continue;
        if (hashRnd(x * 3.1 + z * 7.7) < 0.45) continue;
        treeSpots.push({ x, z, s: 0.75 + hashRnd(x * 5 + z) * 0.7 });
      }
    }
    // riverbank gallery — broadleaf along both banks of the downstream channel
    for (let x = 54; x <= 152; x += 3.1) {
      const az = axisAt(x);
      for (const side of [1, -1]) {
        const z = az + side * (14 + hashRnd(x * side) * 4.5);
        const g = bedAt(x, z);
        if (g < 3.4 || g > 16) continue;
        if (hashRnd(x * 3.7 + side * 11) < 0.5) continue;
        treeSpots.push({ x, z, s: 0.95 + hashRnd(x * side * 2) * 0.7 });
      }
    }
    // rim forest belts — north rim, west headwall shoulders, east rim,
    // reservoir south shore — dense woodland framing the canvas
    for (let x = 8; x <= 154; x += 2.6) {
      for (let z = -78; z <= 78; z += 2.6) {
        const rimD = Math.min(x, LX - x, -(z + 74), z - 70);
        const inRim = rimD > -4;
        const westShore = x < 42 && z > -10 && z < 2;
        const swWoods = x < 44 && z > 24 && z < 46 && Math.abs(z - axisAt(x)) > 14;
        if (!inRim && !westShore && !swWoods) continue;
        if (Math.abs(z - axisAt(x)) < 14.5) continue; // keep the river gorge open
        const g = bedAt(x, z);
        if (g < 9 || g > 34) continue;
        const slope = Math.abs(bedAt(x + 2, z) - g) + Math.abs(bedAt(x, z + 2) - g);
        if (slope > 2.2) continue;
        const h = hashRnd(x * 12.7 + z * 5.3);
        if (h < (inRim ? 0.4 : 0.55)) continue;
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
    var floodTrees: FloodTrees = { trunk: trunks, fol: fols, spots: fSpots, prog: new Float32Array(fSpots.length) };
  }

  // ---- landmarks
  // clock tower + plaza (city heart)
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(5.2, 26), paving);
  plaza.rotation.x = -Math.PI / 2;
  const pzG = bedAt(98, -8);
  plaza.position.set(98, pzG + 0.16, -8);
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
  towerG.position.set(98, pzG, -8);
  group.add(towerG);

  // water tower (east district)
  const wt = new THREE.Group();
  const wtG = bedAt(128, 14);
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
  wt.position.set(128, wtG, 14);
  group.add(wt);

  // market canopy (core, off the high street)
  const mk = new THREE.Group();
  const mkG = bedAt(92, -4);
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
  mk.position.set(92, mkG, -4);
  group.add(mk);

  // football pitch
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(19, 12),
    new THREE.MeshStandardMaterial({ map: makePitchTex(), roughness: 0.95 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.rotation.z = 0.06;
  const piG = bedAt(110, 17);
  pitch.position.set(110, piG + 0.12, 17);
  pitch.receiveShadow = true;
  group.add(pitch);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 0.08), matWhite());
    post.position.set(110 + s * 9.2, piG + 0.75, 17);
    group.add(post);
  }

  // temple shrine (west quarter)
  const tp = new THREE.Group();
  const tpG = bedAt(70, 6);
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
  tp.position.set(70, tpG, 6);
  group.add(tp);

  // park grove + benches
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.92, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
  const parkSpots: [number, number][] = [[86, -16], [88, -13], [85, -12], [90, -17], [87, -18]];
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
  for (const [bx, bz, r] of [[101, -5.5, 0.4], [95, -10.5, -0.6]] as const) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), trunkMat);
    bench.position.set(bx, bedAt(bx, bz) + 0.45, bz);
    bench.rotation.y = r;
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
  // southern belt + SW lakeside quadrant + east orchard — the same plots the
  // terrain painter stains as farmland, so soil colour and props agree
  {
    const FARMS: { x: number; z: number; w: number; d: number; k: number }[] = [
      { x: 56, z: 52, w: 13, d: 9, k: 0 }, { x: 72, z: 54, w: 13, d: 9, k: 1 },
      { x: 90, z: 52, w: 12, d: 9, k: 2 }, { x: 108, z: 52, w: 12, d: 9, k: 0 },
      { x: 124, z: 50, w: 12, d: 9, k: 1 }, { x: 140, z: 52, w: 11, d: 8, k: 2 },
      { x: 18, z: 8, w: 11, d: 8, k: 1 }, { x: 30, z: 16, w: 10, d: 8, k: 2 },
      { x: 20, z: 28, w: 10, d: 8, k: 0 }, { x: 34, z: 34, w: 9, d: 8, k: 1 },
      { x: 146, z: 40, w: 10, d: 8, k: 2 }, // east orchard plot
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
      const g = bedAt(f.x, f.z);
      const fRot = (hashRnd(fi * 3.3) - 0.5) * 0.16;
      const field = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.d), fieldMats[f.k]);
      field.rotation.x = -Math.PI / 2;
      field.rotation.z = fRot;
      field.position.set(f.x, g + 0.09, f.z);
      field.receiveShadow = true;
      group.add(field);
      // crop rows spanning the patch (instanced, tinted per crop)
      eu.set(0, fRot, 0);
      q.setFromEuler(eu);
      for (let k = 0; k < 7; k++) {
        const zz = f.z + ((k + 0.5) / 7 - 0.5) * f.d * 0.82;
        m4.compose(new THREE.Vector3(f.x, g + 0.16, zz), q, new THREE.Vector3(f.w * 0.9, 1, 0.5));
        cropRows.setMatrixAt(ri, m4);
        cropRows.setColorAt(ri, col.setHex(cropColors[f.k]));
        ri++;
      }
      // farmstead: barn + silo at the south edge, clear of the lane
      const bx = f.x + (hashRnd(fi * 7.7) - 0.5) * f.w * 0.3;
      const bz = f.z + f.d * 0.62;
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
      barn.rotation.y = hashRnd(fi * 5.1) * Math.PI * 2;
      group.add(barn);
      // hay bales
      const nH = 2 + Math.floor(hashRnd(fi * 9.9) * 2);
      for (let k = 0; k < nH && hi < 26; k++) {
        const hx = f.x + (hashRnd(fi * 13 + k) - 0.5) * f.w;
        const hz = f.z - f.d * 0.55 + (hashRnd(fi * 17 + k) - 0.5) * 2;
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
    // east orchard — row-planted fruit trees on the east plot
    for (let ox = 0; ox < 4; ox++) {
      for (let oz = 0; oz < 3; oz++) {
        const tx = 142 + ox * 2.6;
        const tz = 37 + oz * 2.8;
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

  // hospital — white slab + rooftop cross + entrance canopy (NE quadrant)
  {
    const hx = 126.8, hz = 7.4;
    const g = bedAt(hx, hz);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(5.8, 5.6, 3.4), matWhite());
    slab.position.set(hx, g + 2.8, hz);
    slab.castShadow = slab.receiveShadow = true;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.0, 3.2, 3.0), matWhite());
    wing.position.set(hx, g + 1.6, hz - 2.5);
    wing.castShadow = true;
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.4), civicRed);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 1.5), civicRed);
    c1.position.set(hx, g + 5.85, hz);
    c2.position.set(hx, g + 5.85, hz);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.6), matConcrete());
    canopy.position.set(hx, g + 2.6, hz + 2.4);
    group.add(slab, wing, c1, c2, canopy);
  }

  // school — hall + paved yard + flagpole (west quarter)
  {
    const sx2 = 87, sz2 = 8.4;
    const g = bedAt(sx2, sz2);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.8, 3.2), matWhite());
    hall.position.set(sx2, g + 1.4, sz2);
    hall.castShadow = hall.receiveShadow = true;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.4), paving);
    yard.rotation.x = -Math.PI / 2;
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
    const fx = 104, fz = 37.2;
    const g = bedAt(fx, fz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 5.4), matConcreteDark());
    hall.position.set(fx, g + 2.1, fz);
    hall.castShadow = hall.receiveShadow = true;
    group.add(hall);
    for (let k = 0; k < 4; k++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 5.8), matGalvanised());
      tooth.position.set(fx - 4.5 + k * 3.0, g + 4.85, fz);
      tooth.rotation.z = 0.5;
      tooth.castShadow = true;
      group.add(tooth);
    }
    for (const cx of [fx - 4, fx + 4]) {
      const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 6.8, 9), matConcreteDark());
      chim.position.set(cx, g + 5.4, fz + 1.2);
      chim.castShadow = true;
      group.add(chim);
    }
  }

  // waterworks — pump hall + twin tanks on the river bank (riverside drive)
  {
    const wx = 62, wz = -37;
    const g = bedAt(wx, wz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 3.0), matWhite());
    hall.position.set(wx, g + 1.1, wz);
    hall.castShadow = true;
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x7fa3b8, roughness: 0.55, metalness: 0.3 });
    for (const tx of [wx - 2.8, wx + 2.8]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.2, 12), tankMat);
      tank.position.set(tx, g + 1.1, wz + 0.4);
      tank.castShadow = true;
      group.add(tank);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.8, 7), matDark());
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(wx, g + 0.5, wz + 2.0);
    group.add(hall, pipe);
  }

  // fuel depot — horizontal tanks in a bund (east district)
  {
    const fx = 137.2, fz = 18;
    const g = bedAt(fx, fz);
    const bund = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.5, 8.2), matConcrete());
    bund.position.set(fx, g + 0.1, fz);
    bund.receiveShadow = true;
    const tankMatF = new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.6, metalness: 0.25 });
    for (let k = 0; k < 3; k++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.6, 12), tankMatF);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(fx, g + 0.9, fz - 2.6 + k * 2.6);
      tank.castShadow = true;
      group.add(tank);
    }
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 1.5), matGalvanised());
    pump.position.set(fx + 2.2, g + 0.75, fz);
    pump.castShadow = true;
    group.add(bund, pump);
  }

  // substation — gravel pad, transformers, gantry (east district)
  {
    const vx = 136.2, vz = -2.9;
    const g = bedAt(vx, vz);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.14, 5.6), new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.98 }));
    pad.position.set(vx, g + 0.07, vz);
    pad.receiveShadow = true;
    for (const [tx, tz] of [[vx - 1.1, vz - 1.2], [vx - 1.1, vz + 1.2]] as const) {
      const xfmr = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 1.1), matDark());
      xfmr.position.set(tx, g + 0.8, tz);
      xfmr.castShadow = true;
      group.add(xfmr);
    }
    for (const gz2 of [vz - 2.2, vz + 2.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 6), matGalvanised());
      post.position.set(vx + 1.6, g + 2.2, gz2);
      post.castShadow = true;
      group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 4.6), matGalvanised());
    beam.position.set(vx + 1.6, g + 4.2, vz);
    group.add(pad, beam);
  }

  // civic hall — columned portico + pediment (south civic band)
  {
    const cx = 127, cz = 26.4;
    const g = bedAt(cx, cz);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.4, 3.6), matWhite());
    hall.position.set(cx, g + 1.7, cz);
    hall.castShadow = hall.receiveShadow = true;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 1.6, 1.1, 3), matWhite());
    ped.rotation.x = Math.PI / 2;
    ped.rotation.y = Math.PI / 2;
    ped.position.set(cx, g + 4.0, cz - 1.95);
    ped.castShadow = true;
    group.add(hall, ped);
    for (let k = 0; k < 4; k++) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.6, 8), matWhite());
      column.position.set(cx - 1.8 + k * 1.2, g + 1.3, cz - 2.05);
      column.castShadow = true;
      group.add(column);
    }
  }

  return { group, districts, floodTrees };
}

// ============================================================ FAR TERRAIN
// The solver domain is a hard-edged plane; this dresses the world beyond it so
// the square canvas never shows its cut: the downstream valley keeps running
// east past the exit gorge (the flood river visibly continues toward the
// horizon), and a rounded forested mountain ring closes the view on all four
// sides. Heights blend out of bedAt() so the seam against the solver mesh is
// invisible, and colour comes from the same terrainColor painter.
export function buildFarTerrain(): { group: THREE.Group } {
  const group = new THREE.Group();

  const sstep = (a: number, b: number, v: number): number => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // distant range: rolling, forested, no craggy peaks (matches the rim look)
  const ringH = (x: number, z: number): number =>
    20 + 26 * fbm(x * 0.021 + 40.7, z * 0.021 - 13.3, 4)
       + 7 * fbm(x * 0.065 - 8.1, z * 0.065 + 21.4, 3);

  const farH = (x: number, z: number): number => {
    // east corridor: bedAt stays well-behaved east of the canvas, so the
    // valley (channel + widening walls) keeps running out toward the horizon
    // and the range closes over it further downstream
    const dzo = z - axisAt(LX);
    if (x > LX && Math.abs(dzo) < 46) {
      const valley = bedAt(x, z);
      const t = Math.max(sstep(175, 255, x), sstep(34, 46, Math.abs(dzo)));
      return valley + (ringH(x, z) + 6 - valley) * t;
    }
    // everywhere else: hold the boundary profile, fade into the range
    const dOut = Math.max(-x, x - LX, -LZ / 2 - z, z - LZ / 2, 0);
    const base = bedAt(clamp(x, 1.5, LX - 1.5), clamp(z, -LZ / 2 + 1, LZ / 2 - 1));
    const t = sstep(2, 70, dOut);
    return base + (ringH(x, z) - base) * t;
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
  // valley continuation (the east strip carries the river out of frame)
  strip(-260, 420, -265, -LZ / 2, 150, 40);
  strip(-260, 420, LZ / 2, 265, 150, 40);
  strip(-260, 0, -LZ / 2, LZ / 2, 56, 72);
  strip(LX, 420, -LZ / 2, LZ / 2, 60, 72);

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



