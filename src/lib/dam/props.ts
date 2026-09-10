// 3D props: detailed dam monoliths & gates, Kerala-style houses, palms & trees,
// roads & bridge, gauge stations, infra markers, floating debris, audio.
import * as THREE from 'three';
import { LX, LZ, DAM_X, CREST, RES_LEVEL, bedAt, APRON_TOP, BLOCK_Z0, BLOCK_Z1, BLOCK_N, BLOCK_W } from './terrain';
import { GAUGES } from '@/lib/damsafe/config';

// ---------------------------------------------------------------- CPU flow field
// Downsampled readback of the GPU state, used for prop physics + stats.
export class FlowField {
  readonly W = 48;
  readonly H = 28;
  readonly data = new Float32Array(48 * 28 * 4); // (eta, u, v, h)

  sample(x: number, z: number, out: { eta: number; u: number; v: number }): void {
    const fu = Math.min(Math.max((x / LX) * this.W - 0.5, 0), this.W - 1.001);
    const fv = Math.min(Math.max(((z + LZ / 2) / LZ) * this.H - 0.5, 0), this.H - 1.001);
    const i = Math.floor(fu), j = Math.floor(fv);
    const fx = fu - i, fy = fv - j;
    const i1 = Math.min(i + 1, this.W - 1), j1 = Math.min(j + 1, this.H - 1);
    const k00 = (j * this.W + i) * 4, k10 = (j * this.W + i1) * 4;
    const k01 = (j1 * this.W + i) * 4, k11 = (j1 * this.W + i1) * 4;
    const d = this.data;
    const e0 = d[k00] + (d[k10] - d[k00]) * fx;
    const e1 = d[k01] + (d[k11] - d[k01]) * fx;
    const u0 = d[k00 + 1] + (d[k10 + 1] - d[k00 + 1]) * fx;
    const u1 = d[k01 + 1] + (d[k11 + 1] - d[k01 + 1]) * fx;
    const v0 = d[k00 + 2] + (d[k10 + 2] - d[k00 + 2]) * fx;
    const v1 = d[k01 + 2] + (d[k11 + 2] - d[k01 + 2]) * fx;
    out.eta = e0 + (e1 - e0) * fy;
    out.u = u0 + (u1 - u0) * fy;
    out.v = v0 + (v1 - v0) * fy;
  }
}

// ------------------------------------------------------------------ textures
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

function makeConcreteTex(base = '#9b948a'): THREE.Texture {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 256);
    // aggregate speckle
    for (let i = 0; i < 2600; i++) {
      const v = 150 + Math.random() * 70;
      c.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.06 + Math.random() * 0.10})`;
      const s = 1 + Math.random() * 2.4;
      c.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
    // formwork panel joints + tie holes
    c.strokeStyle = 'rgba(0,0,0,0.14)';
    c.lineWidth = 2;
    for (let y = 0; y <= 256; y += 64) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke();
    }
    for (let x = 0; x <= 256; x += 86) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke();
      c.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 32; y < 256; y += 64) {
        c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
      }
    }
    // weather stains
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const g = c.createLinearGradient(x, y, x, y + 30 + Math.random() * 50);
      g.addColorStop(0, 'rgba(60,55,45,0.13)');
      g.addColorStop(1, 'rgba(60,55,45,0)');
      c.fillStyle = g;
      c.fillRect(x, y, 4 + Math.random() * 10, 30 + Math.random() * 55);
    }
  });
}

function makeAsphaltTex(): THREE.Texture {
  return canvasTex(128, 256, (c) => {
    c.fillStyle = '#4a4a4c';
    c.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 900; i++) {
      const v = 60 + Math.random() * 40;
      c.fillStyle = `rgba(${v},${v},${v + 3},${0.10 + Math.random() * 0.15})`;
      c.fillRect(Math.random() * 128, Math.random() * 256, 1.6, 1.6);
    }
    // center dashes
    c.fillStyle = 'rgba(230,225,190,0.85)';
    for (let y = 8; y < 256; y += 42) c.fillRect(61, y, 6, 22);
    // edge lines
    c.fillStyle = 'rgba(225,220,200,0.5)';
    c.fillRect(5, 0, 3, 256);
    c.fillRect(120, 0, 3, 256);
  });
}

// ------------------------------------------------------------------- dam meshes
export interface BreachBlock {
  group: THREE.Group;
  z0: number;
  z1: number;
}

export interface DamProps {
  group: THREE.Group;
  breachBlocks: BreachBlock[];
  gates: THREE.Mesh[];
  stainBand: THREE.Mesh;
}

export function buildDam(): DamProps {
  const group = new THREE.Group();
  const concTex = makeConcreteTex('#a09a8e');
  concTex.repeat.set(2.2, 1.2);
  const concTexDark = makeConcreteTex('#8f887b');
  concTexDark.repeat.set(2.2, 1.2);
  const concrete = new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.88, metalness: 0.02, envMapIntensity: 0.35 });
  const concreteDark = new THREE.MeshStandardMaterial({ map: concTexDark, roughness: 0.92, metalness: 0.02, envMapIntensity: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d6870, roughness: 0.5, metalness: 0.55 });
  const paintWhite = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.7, metalness: 0.05 });

  const monolith = (z0: number, z1: number, crestY: number, mat: THREE.Material): THREE.Mesh => {
    const s = new THREE.Shape();
    s.moveTo(0, 6);
    s.lineTo(0, crestY);
    s.lineTo(3.4, crestY);
    s.lineTo(8.6, 9.0);
    s.lineTo(8.6, 6);
    s.lineTo(0, 6);
    const geo = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
    geo.translate(DAM_X, 0, z0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // crest roadway + railings + lamps (across the whole dam)
  const CREST_Z0 = -38, CREST_Z1 = 38;
  const roadTex = makeAsphaltTex();
  roadTex.repeat.set(1, 10);
  const crestRoad = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 0.22, CREST_Z1 - CREST_Z0),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0.03 }),
  );
  crestRoad.position.set(DAM_X + 1.7, CREST + 0.1, 0);
  crestRoad.castShadow = crestRoad.receiveShadow = true;
  group.add(crestRoad);

  // railing posts (instanced) + rails
  const postCount = Math.floor((CREST_Z1 - CREST_Z0) / 2.4);
  const postGeo = new THREE.BoxGeometry(0.09, 0.85, 0.09);
  const posts = new THREE.InstancedMesh(postGeo, steel, postCount * 2);
  const m4 = new THREE.Matrix4();
  let pi = 0;
  for (let i = 0; i < postCount; i++) {
    const z = CREST_Z0 + 1 + i * 2.4;
    for (const side of [DAM_X + 0.3, DAM_X + 3.1]) {
      m4.makeTranslation(side, CREST + 0.62, z);
      posts.setMatrixAt(pi++, m4);
    }
  }
  posts.castShadow = true;
  group.add(posts);
  for (const side of [DAM_X + 0.3, DAM_X + 3.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, CREST_Z1 - CREST_Z0), steel);
    rail.position.set(side, CREST + 1.0, 0);
    group.add(rail);
    const rail2 = rail.clone();
    rail2.position.y = CREST + 0.55;
    group.add(rail2);
  }

  // lamp posts
  for (let z = -35; z <= 35; z += 14) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 6), steel);
    pole.position.set(DAM_X + 3.0, CREST + 1.5, z);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), steel);
    arm.position.set(DAM_X + 2.65, CREST + 2.78, z);
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8e4d4, emissive: 0x535134, roughness: 0.5 }),
    );
    head.position.set(DAM_X + 2.3, CREST + 2.72, z);
    group.add(pole, arm, head);
  }

  // intact outer monoliths
  group.add(monolith(-38, BLOCK_Z0, CREST, concrete));
  group.add(monolith(BLOCK_Z1, 18, CREST, concrete));
  group.add(monolith(18, 30, 22.2, concreteDark)); // spillway sill
  group.add(monolith(30, 38, CREST, concrete));

  // --- spillway: 3 piers, 2 radial gates, hoist bridge, trunnion arms
  const pierZ = [18.7, 24.0, 29.3];
  for (const zc of pierZ) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 15.2, 1.5), concreteDark);
    pier.position.set(DAM_X + 2.2, 17.4, zc);
    pier.castShadow = pier.receiveShadow = true;
    group.add(pier);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.6, 8, 1, false, 0, Math.PI), concreteDark);
    nose.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    nose.position.set(DAM_X + 0.9, 17.4, zc);
    group.add(nose);
  }
  const hoistDeck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 12.4), concreteDark);
  hoistDeck.position.set(DAM_X + 2.2, 25.3, 24);
  hoistDeck.castShadow = true;
  group.add(hoistDeck);
  const hoistRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 12.8), paintWhite);
  hoistRoof.position.set(DAM_X + 2.2, 26.6, 24);
  group.add(hoistRoof);
  for (const zh of [21.4, 26.6]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), steel);
    col.position.set(DAM_X + 1.15, 26.0, zh);
    group.add(col, col.clone().translateX(2.1));
  }

  const gates: THREE.Mesh[] = [];
  for (const zc of [21.3, 26.7]) {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.9, 4.9), steel);
    gate.position.set(DAM_X + 2.2, 18.85, zc);
    gate.castShadow = true;
    group.add(gate);
    gates.push(gate);
    // trunnion arm + hub
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), steel);
    arm.rotation.z = Math.PI / 2 - 0.62;
    arm.position.set(DAM_X + 3.6, 16.4, zc);
    group.add(arm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.6, 8), steel);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(DAM_X + 5.2, 14.9, zc);
    group.add(hub);
  }

  // upstream algal stain band (slightly proud of the face, subtle)
  const stainBand = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 2.0, 76),
    new THREE.MeshStandardMaterial({ color: 0x6b7362, roughness: 0.95, transparent: true, opacity: 0.16 }),
  );
  stainBand.position.set(DAM_X - 0.05, RES_LEVEL - 0.6, 0);
  group.add(stainBand);

  // control building on the right abutment
  const bld = new THREE.Group();
  const bBody = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 4.4), paintWhite);
  bBody.position.y = 1.3;
  bBody.castShadow = bBody.receiveShadow = true;
  const bRoof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.22, 4.8), concreteDark);
  bRoof.position.y = 2.72;
  const bWin = new THREE.Mesh(
    new THREE.BoxGeometry(3.42, 0.8, 2.6),
    new THREE.MeshStandardMaterial({ color: 0x27343c, roughness: 0.35, metalness: 0.4 }),
  );
  bWin.position.y = 1.55;
  const bDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 1.5, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x3d5a52, roughness: 0.6 }),
  );
  bDoor.position.set(-1.72, 0.75, 0);
  bld.add(bBody, bRoof, bWin, bDoor);
  bld.position.set(DAM_X + 5.4, CREST, 33.4);
  group.add(bld);
  // mast + antenna
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.4, 6), steel);
  mast.position.set(DAM_X + 4.6, CREST + 4.6, 33.4);
  group.add(mast);

  // --- breach monolith blocks (each sinks individually during a scenario)
  const breachBlocks: BreachBlock[] = [];
  for (let b = 0; b < BLOCK_N; b++) {
    const z0 = BLOCK_Z0 + b * BLOCK_W;
    const z1 = z0 + BLOCK_W;
    const bg = new THREE.Group();
    bg.add(monolith(z0, z1, CREST, concrete));
    // parapet segment on top of the block
    const len = z1 - z0;
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.0, len), concreteDark);
    p1.position.set(DAM_X + 0.25, CREST + 0.5, z0 + len / 2);
    const p2 = p1.clone();
    p2.position.x = DAM_X + 3.15;
    p1.castShadow = p2.castShadow = true;
    bg.add(p1, p2);
    // crest road patch belongs to the block so it sinks with it
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(3.1, 0.2, len),
      new THREE.MeshStandardMaterial({ map: roadTex.clone(), roughness: 0.85 }),
    );
    (patch.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
    (patch.material as THREE.MeshStandardMaterial).map!.needsUpdate = true;
    patch.position.set(DAM_X + 1.7, CREST + 0.1, z0 + len / 2);
    patch.castShadow = true;
    bg.add(patch);
    group.add(bg);
    breachBlocks.push({ group: bg, z0, z1 });
  }

  // stilling-basin apron + baffle blocks downstream — sits ON the channel bed
  // at the same elevation as the simulated apron shelf (APRON_TOP), so breach
  // flow visibly crashes onto it and churns over the baffles instead of
  // disappearing under a floating slab
  const apron = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, 60), concreteDark);
  apron.position.set(DAM_X + 15.6, APRON_TOP - 0.175, 0);
  apron.receiveShadow = true;
  group.add(apron);
  for (let i = 0; i < 3; i++) {
    for (let z = -24; z <= 24; z += 6) {
      const baf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 1.4), concreteDark);
      baf.position.set(DAM_X + 10 + i * 4.5, APRON_TOP + 0.55, z + (i % 2) * 3);
      baf.castShadow = true;
      group.add(baf);
    }
  }

  return { group, breachBlocks, gates, stainBand };
}

// ------------------------------------------------------------------- houses
export interface House {
  group: THREE.Group;
  ground: number;
  prog: number; // 0 intact → 1 collapsed
}

function makeHouse(idx: number): THREE.Group {
  const g = new THREE.Group();
  const wallColors = [0xd9cfba, 0xcdb998, 0xdcd2c0, 0xc4b69c, 0xd7c2a7, 0xd0c7b5, 0xc9bda4, 0xd5cbb8];
  const wall = new THREE.MeshStandardMaterial({ color: wallColors[idx % wallColors.length], roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6e5a45, roughness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2b3d46, roughness: 0.25, metalness: 0.5 });
  const flat = idx % 3 === 2;

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 3.2), concreteGrey());
  plinth.position.y = 0.15;
  plinth.receiveShadow = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 2.8), wall);
  body.position.y = 1.5;
  body.castShadow = body.receiveShadow = true;
  g.add(plinth, body);

  // windows front/back + door
  for (const zs of [-0.75, 0.75]) {
    for (const xo of [-0.95, 0.95]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.06), glass);
      w.position.set(xo, 1.7, 1.42);
      w.castShadow = true;
      g.add(w);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.67, 0.74, 0.04), trim);
      fr.position.set(xo, 1.7, 1.40);
      g.add(fr);
    }
    const wb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.06), glass);
    wb.position.set(0, 1.7, -1.42);
    g.add(wb);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.55, 0.07), trim);
  door.position.set(-0.85, 1.075, 1.43);
  g.add(door);

  if (flat) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 3.1), concreteGrey());
    roof.position.y = 2.8;
    roof.castShadow = true;
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.62, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e2224, roughness: 0.6 }),
    );
    tank.position.set(-0.9, 3.2, -0.6);
    tank.castShadow = true;
    g.add(roof, tank);
  } else {
    // pitched gable roof (Kerala tile colour)
    const roofMat = new THREE.MeshStandardMaterial({ color: idx % 2 ? 0x8a4a35 : 0x7a4438, roughness: 0.88 });
    const slope = 0.62;
    const slabG = new THREE.BoxGeometry(2.05, 0.09, 3.45);
    const s1 = new THREE.Mesh(slabG, roofMat);
    s1.position.set(-0.83, 3.32, 0);
    s1.rotation.z = slope;
    const s2 = new THREE.Mesh(slabG, roofMat);
    s2.position.set(0.83, 3.32, 0);
    s2.rotation.z = -slope;
    s1.castShadow = s2.castShadow = true;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 3.5), trim);
    ridge.position.y = 3.93;
    const gableG = new THREE.BufferGeometry();
    gableG.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -1.6, 2.7, 0, 1.6, 2.7, 0, 0, 3.62, 0,
          -1.6, 2.7, 0.02, 1.6, 2.7, 0.02, 0, 3.62, 0.02,
        ]),
        3,
      ),
    );
    gableG.computeVertexNormals();
    const gable = new THREE.Mesh(gableG, wall);
    gable.position.z = 1.41;
    g.add(s1, s2, ridge, gable);
  }
  return g;
}

function concreteGrey(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xa5a099, roughness: 0.94, metalness: 0.0 });
}

export function buildHouses(): { houses: House[]; group: THREE.Group } {
  const group = new THREE.Group();
  const houses: House[] = [];
  const spots: [number, number][] = [
    [140, -18], [148, -22], [158, -19], [145, 21], [156, 24], [166, 18],
    [163, -25], [173, -22], [179, 21], [151, 29],
  ];
  spots.forEach(([x, z], idx) => {
    const ground = bedAt(x, z);
    const g = makeHouse(idx);
    g.position.set(x, ground, z);
    g.rotation.y = (idx * 0.9) % (Math.PI * 2);
    group.add(g);
    houses.push({ group: g, ground, prog: 0 });
  });
  return { houses, group };
}

// ------------------------------------------------------------------- trees
export interface Tree {
  group: THREE.Group;
  ground: number;
  prog: number;
}

function makePalm(rnd: number): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.95 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3d7a34, roughness: 0.9, side: THREE.DoubleSide });
  const lean = (rnd - 0.5) * 0.5;
  let y = 0, x = 0;
  const h = 4.4 + rnd * 2.2;
  const seg = 4;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const len = h / seg;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * (1 - t1 * 0.45) + 0.05, 0.13 * (1 - t0 * 0.45) + 0.06, len, 6), trunkMat);
    x += lean * len * 0.45;
    y += len;
    cyl.position.set(x, y - len / 2, 0);
    cyl.rotation.z = -lean * 0.5;
    cyl.castShadow = true;
    g.add(cyl);
  }
  const crownY = h + 0.2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rnd;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.6, 4), frondMat);
    frond.scale.y = 0.22;
    frond.position.set(x + Math.cos(a) * 1.0, crownY + 0.25, Math.sin(a) * 1.0);
    frond.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9 - 0.25);
    frond.castShadow = true;
    g.add(frond);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.9 }),
    );
    nut.position.set(x + (i - 1) * 0.2, crownY - 0.05, (i % 2) * 0.2 - 0.1);
    g.add(nut);
  }
  return g;
}

function makeBroadleaf(rnd: number): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.92, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 1.9, 6), trunkMat);
  trunk.position.y = 0.95;
  trunk.castShadow = true;
  g.add(trunk);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const r = 0.9 + rnd * 0.7;
    const blob = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), leafMat);
    blob.position.set((rnd - 0.5) * 1.2, 2.4 + i * 0.55 + rnd * 0.4, (rnd - 0.5) * 1.2);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

function makeBanana(rnd: number): THREE.Group {
  const g = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a8a3c, roughness: 0.85, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.0 + rnd * 0.6, 4), leafMat);
    leaf.scale.y = 0.16;
    leaf.position.set(Math.cos(a) * 0.55, 1.15, Math.sin(a) * 0.55);
    leaf.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

export function buildTrees(): { trees: Tree[]; group: THREE.Group } {
  const group = new THREE.Group();
  const trees: Tree[] = [];
  const spots: [number, number, number][] = [
    // x, z, kind (0 palm, 1 broadleaf, 2 banana)
    [96, -34, 0], [104, 33, 0], [88, 34, 1], [128, -26, 0], [136, 26, 0], [152, -25, 1],
    [166, 26, 0], [120, 30, 2], [100, -36, 1], [174, -17, 0], [86, 30, 0], [146, -30, 0],
    [132, 32, 1], [160, 31, 2], [170, 30, 0], [185, 24, 1], [186, -24, 0], [175, -28, 2],
    [155, -30, 0], [142, 31, 0], [124, -31, 1], [112, 32, 0], [92, 30, 2], [181, 27, 0],
  ];
  spots.forEach(([x, z, kind], idx) => {
    const ground = bedAt(x, z);
    const rnd = ((x * 13 + z * 7) % 10) / 10;
    const g = kind === 0 ? makePalm(rnd) : kind === 1 ? makeBroadleaf(rnd) : makeBanana(rnd);
    g.position.set(x, ground - 0.05, z);
    const s = 0.85 + ((idx * 37) % 10) / 28;
    g.scale.setScalar(s);
    g.rotation.y = rnd * Math.PI * 2;
    group.add(g);
    trees.push({ group: g, ground, prog: 0 });
  });
  return { trees, group };
}

// -------------------------------------------------------------- roads + bridge
export function buildRoads(): { group: THREE.Group } {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x46464a, roughness: 0.95, metalness: 0.0 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.8 });

  const roadRibbon = (pts: [number, number][], w = 3.2): void => {
    // sample terrain-following ribbon
    const pos: number[] = [];
    const idxArr: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s < 4; s++) {
        const t0 = s / 4, t1 = (s + 1) / 4;
        const x0 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t0;
        const z0 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t0;
        const x1 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t1;
        const z1 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t1;
        const dx = z1 - z0, dz = -(x1 - x0);
        const dl = Math.hypot(dx, dz) || 1;
        const nx = (dx / dl) * w * 0.5, nz = (dz / dl) * w * 0.5;
        const a = bedAt(x0 - nx, z0 - nz) + 0.16;
        const b = bedAt(x0 + nx, z0 + nz) + 0.16;
        const c = bedAt(x1 - nx, z1 - nz) + 0.16;
        const d = bedAt(x1 + nx, z1 + nz) + 0.16;
        const base = pos.length / 3;
        pos.push(x0 - nx, a, z0 - nz, x0 + nx, b, z0 + nz, x1 - nx, c, z1 - nz, x1 + nx, d, z1 + nz);
        idxArr.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, asphalt);
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // main valley road along the +z bench
  roadRibbon([
    [117, 27.5], [124, 26], [132, 24.8], [140, 23.2], [148, 22.2], [156, 21.2],
    [164, 20.2], [172, 19.6], [180, 20.2], [188, 21.8],
  ]);
  // spur along the -z bench
  roadRibbon([
    [117, -27.5], [124, -26.5], [132, -25.5], [140, -24.5], [148, -23.5], [156, -23],
    [164, -23.5], [172, -24], [180, -24.5], [188, -25],
  ]);
  // access spur to the bridge head
  roadRibbon([[148, 22.4], [150, 20], [150, 17]], 2.6);
  roadRibbon([[150, -17], [150, -20], [148, -23.2]], 2.6);

  // center dashes on the main road
  for (let i = 0; i < 26; i++) {
    const x = 119 + i * 2.7;
    const z = 26.2 - (x - 119) * 0.075;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.22), lineMat);
    dash.position.set(x, bedAt(x, z) + 0.18, z);
    dash.rotation.y = -0.35;
    group.add(dash);
  }

  // bridge over the channel at x = 150
  const bridgeY = bedAt(150, 0) + 3.4;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 52), concreteGrey());
  deck.position.set(150, bridgeY, 0);
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);
  const deckRoad = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 52), asphalt);
  deckRoad.position.set(150, bridgeY + 0.28, 0);
  group.add(deckRoad);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 52), lineMat);
    rail.position.set(150 + s * 1.95, bridgeY + 0.55, 0);
    group.add(rail);
    for (let z = -24; z <= 24; z += 4) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), lineMat);
      post.position.set(150 + s * 1.95, bridgeY + 0.35, z);
      group.add(post);
    }
  }
  for (const zc of [-7, 7]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, bridgeY - bedAt(150, zc) + 0.6, 8), concreteGrey());
    pier.position.set(150, bedAt(150, zc) + (bridgeY - bedAt(150, zc)) / 2, zc);
    pier.castShadow = true;
    group.add(pier);
  }
  return { group };
}

// ------------------------------------------------------------- gauge stations
export function buildGaugeStations(): { group: THREE.Group } {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.6, metalness: 0.4 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xd9b23a, roughness: 0.6 });
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x1c2c46, roughness: 0.3, metalness: 0.4 });
  for (const g of GAUGES) {
    const ground = bedAt(g.x + 6, g.z + 8) < 30 ? bedAt(g.x + 6, g.z + 8) : bedAt(g.x, g.z + 10);
    const s = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.0, 6), poleMat);
    pole.position.y = 1.5;
    pole.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.38), cabMat);
    cab.position.y = 2.9;
    cab.castShadow = true;
    const solar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.35), solarMat);
    solar.position.set(0.1, 3.42, 0);
    solar.rotation.z = -0.4;
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.1, 4), poleMat);
    whip.position.set(-0.2, 3.9, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.8), concreteGrey());
    base.position.y = 0.12;
    base.castShadow = true;
    s.add(pole, cab, solar, whip, base);
    s.position.set(g.x + 6, ground, g.z + 8);
    group.add(s);
  }
  return { group };
}

// ---------------------------------------------------------- infra marker pins
export function buildInfraMarkers(): { group: THREE.Group } {
  const group = new THREE.Group();
  const colors: Record<string, number> = {
    hospital: 0xe34d4d, school: 0xe0a63c, bridge: 0x39c3d8, substation: 0x9a6ae0, waterworks: 0x2fae7e,
  };
  const kindOf: [number, number, string][] = [
    [164, -21, 'hospital'], [146, 25, 'school'], [180, -15, 'school'],
    [150, 2, 'bridge'], [172, 18, 'substation'], [127, -24, 'waterworks'],
  ];
  for (const [x, z, kind] of kindOf) {
    const ground = bedAt(x, z);
    const mat = new THREE.MeshStandardMaterial({ color: colors[kind], roughness: 0.5, emissive: colors[kind], emissiveIntensity: 0.25 });
    const pin = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5), mat);
    pole.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 4), mat);
    head.position.y = 3.2;
    head.rotation.x = Math.PI;
    head.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 6, 20), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    pin.add(pole, head, ring);
    pin.position.set(x, ground, z);
    group.add(pin);
  }
  return { group };
}

// ------------------------------------------------------------------- boats & dock
export function buildDockBoats(): { group: THREE.Group; boats: { mesh: THREE.Object3D }[] } {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3a, roughness: 0.9 });
  // jetty
  const dockX = 97, dockZ = -19;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.22, 2.2), woodMat);
  deck.position.set(dockX, RES_LEVEL + 0.35, dockZ);
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);
  for (let i = 0; i < 4; i++) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 10, 6), woodMat);
    pile.position.set(dockX - 2.7 + i * 1.8, RES_LEVEL - 4.6, dockZ + (i % 2 ? 0.8 : -0.8));
    group.add(pile);
  }
  const boats: { mesh: THREE.Object3D }[] = [];
  const hullMat = [new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x3f6f9e, roughness: 0.6 })];
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), hullMat[i]);
    hull.scale.set(1.6, 0.42, 0.55);
    hull.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.06, 6, 14), hullMat[i]);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.55, 1, 0.75);
    rim.position.y = 0.2;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.8), woodMat);
    bench.position.y = 0.16;
    b.add(hull, rim, bench);
    b.position.set(dockX - 1 + i * 3.4, RES_LEVEL - 0.1, dockZ - 2.6 - i * 1.6);
    b.rotation.y = 0.5 + i;
    group.add(b);
    boats.push({ mesh: b });
  }
  return { group, boats };
}

// ------------------------------------------------------------------- boulders
export function buildBoulders(): { group: THREE.Group } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.98, flatShading: true });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 0.98, flatShading: true });
  const rnd = (i: number) => ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 16; i++) {
    const onBench = i % 4 !== 3;
    const x = 60 + rnd(i) * 128;
    const z = onBench ? (rnd(i + 9) > 0.5 ? 1 : -1) * (33 + rnd(i + 3) * 5) : (rnd(i + 5) - 0.5) * 16;
    const wx = Math.min(x, 188);
    const s = 0.7 + rnd(i + 7) * 1.6;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), i % 2 ? mat : matDark);
    rock.position.set(wx, bedAt(wx, z) + s * 0.25, z);
    rock.rotation.set(rnd(i) * 3, rnd(i + 1) * 3, rnd(i + 2) * 3);
    rock.castShadow = rock.receiveShadow = true;
    group.add(rock);
  }
  return { group };
}

// ------------------------------------------------------------------- barrels
export interface Barrel {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  reset: () => void;
}

export function buildBarrels(): { barrels: Barrel[]; group: THREE.Group } {
  const group = new THREE.Group();
  const colors = [0xb4552d, 0xc9a227, 0x7d8b99, 0xa33c2a, 0x5e7a52];
  const barrels: Barrel[] = [];
  const starts: [number, number][] = [[70, -8], [82, 6], [92, -12], [98, 10], [60, 14]];
  starts.forEach(([x, z], i) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.05, 14),
      new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.7, metalness: 0.25 }),
    );
    mesh.castShadow = true;
    const y = 21.4;
    mesh.position.set(x, y, z);
    group.add(mesh);
    barrels.push({
      mesh,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(0, 0, 0),
      spin: 0,
      reset: () => {
        mesh.position.set(x, 21.4, z);
      },
    });
  });
  return { barrels, group };
}

// ------------------------------------------------------------------- debris
export interface Chunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  active: boolean;
}

export function buildDebris(): { chunks: Chunk[]; group: THREE.Group } {
  const group = new THREE.Group();
  const chunks: Chunk[] = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.95 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x837e72, roughness: 0.95 });
  for (let i = 0; i < 14; i++) {
    const s = 0.7 + ((i * 37) % 10) / 12;
    const mesh = new THREE.Mesh(
      i % 3 === 0 ? new THREE.IcosahedronGeometry(s * 0.6, 0) : new THREE.BoxGeometry(s, s * 0.7, s * 0.9),
      i % 2 ? mat : matDark,
    );
    mesh.castShadow = true;
    mesh.visible = false;
    group.add(mesh);
    chunks.push({ mesh, vel: new THREE.Vector3(), active: false });
  }
  return { chunks, group };
}

// ------------------------------------------------------------------- audio
export class RiverAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private riverGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  enabled = false;

  private ensure(): void {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      this.ctx = ctx;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;

      const mk = (freq: number, gain: number): { src: AudioBufferSourceNode; g: GainNode } => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(filt);
        filt.connect(g);
        g.connect(master);
        src.start();
        return { src, g };
      };
      const river = mk(750, 0.05);
      this.riverGain = river.g;
      const rumble = mk(120, 0.0);
      this.rumbleGain = rumble.g;
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(b: boolean): void {
    this.enabled = b;
    if (b) {
      this.ensure();
      if (this.ctx && this.master) {
        void this.ctx.resume();
        this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.2);
      }
    } else if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  setIntensity(v01: number): void {
    if (!this.ctx || !this.enabled || !this.riverGain || !this.rumbleGain) return;
    const t = this.ctx.currentTime;
    this.riverGain.gain.setTargetAtTime(0.03 + 0.30 * v01, t, 0.4);
    this.rumbleGain.gain.setTargetAtTime(Math.max(this.rumbleGain.gain.value, 0.16 * v01 * v01), t, 0.6);
  }

  burst(power = 1): void {
    if (!this.ctx || !this.enabled || !this.rumbleGain) return;
    const t = this.ctx.currentTime;
    const g = this.rumbleGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.001), t);
    g.linearRampToValueAtTime(0.65 * power, t + 0.15);
    g.setTargetAtTime(0.02, t + 0.4, 1.4);
  }

  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
