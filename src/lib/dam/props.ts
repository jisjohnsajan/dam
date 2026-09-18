// 3D props: detailed dam monoliths & gates (DIAGONAL corner dam), Kerala-style
// houses, palms & trees, roads & bridge, gauge stations, infra markers,
// floating debris, audio.
//
// The dam + powerhouse are authored in a LOCAL dam frame (u = downstream,
// w = along-crest with w = -t) and mounted with rotation.y = -45° at the
// top-left corner, so the whole structure faces diagonally down the valley
// (reference map layout). See terrain.ts for the rotated frame definition.
import * as THREE from 'three';
import { LX, LZ, DAM_S, CREST, RES_LEVEL, bedAt, APRON_TOP, BLOCK_Z0, BLOCK_Z1, BLOCK_N, BLOCK_W, SC, st2xz, axisT } from './terrain';
import { GAUGES } from '@/lib/damsafe/config';

// Local dam frame → world. u: downstream from the upstream face, w: along the
// crest (w = -t; w=5 is the NE abutment end, w=61 the SW end at the edge).
const ANCHOR_X = DAM_S * SC;
const ANCHOR_Z = DAM_S * SC - LZ / 2;
export function damXZ(u: number, w: number): [number, number] {
  return [ANCHOR_X + (u - w) * SC, ANCHOR_Z + (u + w) * SC];
}

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
  z0: number; // block span start (t, rotated frame)
  z1: number; // block span end (t)
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

  // monolith profile in the LOCAL dam frame: x = downstream (u), extruded
  // along z = along-crest (w). Crest span w ∈ [5, 61] (t ∈ [-61, -5]).
  const monolith = (w0: number, w1: number, crestY: number, mat: THREE.Material): THREE.Mesh => {
    const s = new THREE.Shape();
    s.moveTo(0, 6);
    s.lineTo(0, crestY);
    s.lineTo(3.4, crestY);
    s.lineTo(8.6, 9.0);
    s.lineTo(8.6, 6);
    s.lineTo(0, 6);
    const geo = new THREE.ExtrudeGeometry(s, { depth: w1 - w0, bevelEnabled: false, curveSegments: 1 });
    geo.translate(0, 0, w0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // crest roadway + railings + lamps (across the whole dam — the outer ends
  // run into the raised abutment rock so the structure reads as complete)
  const CREST_W0 = 3, CREST_W1 = 63;
  const roadTex = makeAsphaltTex();
  roadTex.repeat.set(1, 10);
  const crestRoad = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 0.22, CREST_W1 - CREST_W0),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0.03 }),
  );
  crestRoad.position.set(1.7, CREST + 0.1, (CREST_W0 + CREST_W1) / 2);
  crestRoad.castShadow = crestRoad.receiveShadow = true;
  group.add(crestRoad);

  // railing posts (instanced) + rails
  const postCount = Math.floor((CREST_W1 - CREST_W0) / 2.4);
  const postGeo = new THREE.BoxGeometry(0.09, 0.85, 0.09);
  const posts = new THREE.InstancedMesh(postGeo, steel, postCount * 2);
  const m4 = new THREE.Matrix4();
  let pi = 0;
  for (let i = 0; i < postCount; i++) {
    const w = CREST_W0 + 1 + i * 2.4;
    for (const side of [0.3, 3.1]) {
      m4.makeTranslation(side, CREST + 0.62, w);
      posts.setMatrixAt(pi++, m4);
    }
  }
  posts.castShadow = true;
  group.add(posts);
  for (const side of [0.3, 3.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, CREST_W1 - CREST_W0), steel);
    rail.position.set(side, CREST + 1.0, (CREST_W0 + CREST_W1) / 2);
    group.add(rail);
    const rail2 = rail.clone();
    rail2.position.y = CREST + 0.55;
    group.add(rail2);
  }

  // lamp posts
  for (let w = 8; w <= 58; w += 10) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 6), steel);
    pole.position.set(3.0, CREST + 1.5, w);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), steel);
    arm.position.set(2.65, CREST + 2.78, w);
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8e4d4, emissive: 0x535134, roughness: 0.5 }),
    );
    head.position.set(2.3, CREST + 2.72, w);
    group.add(pole, arm, head);
  }

  // intact outer monoliths — extended deep into both abutments (the raised
  // flank terrain swallows the outer ends, keying the dam into the rock)
  // local w spans: 5..10 NE of the blocks, 34..40 between blocks & spillway,
  // 40..52 spillway sill, 52..61 down to the SW end at the domain edge.
  group.add(monolith(5, 10, CREST, concrete));
  group.add(monolith(34, 40, CREST, concrete));
  group.add(monolith(40, 52, 22.8, concreteDark)); // spillway sill (SPILL_CREST_CLOSED)
  group.add(monolith(52, 61, CREST, concrete));

  // abutment contact detail: stepped gallery blocks where the monoliths meet
  // the rising rock (small concrete steps climbing the shoulder line)
  for (const wc of [7, 56]) {
    for (let k = 0; k < 4; k++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(7.5, 1.2, 2.1),
        concreteDark,
      );
      const gy = CREST - 0.2 + k * 1.2;
      step.position.set(4.3, gy, wc + (wc < 30 ? -k * 2.0 : k * 2.0));
      step.castShadow = step.receiveShadow = true;
      group.add(step);
    }
  }

  // --- spillway: 3 piers, 2 radial gates, hoist bridge, trunnion arms
  // (aligned with the simulated gate band t ∈ [-52, -40] → w ∈ [40, 52])
  const pierW = [40.7, 46.0, 51.3];
  for (const wc of pierW) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.5, 15.2, 2.6), concreteDark);
    pier.position.set(2.2, 17.4, wc);
    pier.castShadow = pier.receiveShadow = true;
    group.add(pier);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.6, 8, 1, false, 0, Math.PI), concreteDark);
    nose.rotation.set(0, Math.PI / 2, Math.PI / 2);
    nose.position.set(0.9, 17.4, wc);
    group.add(nose);
  }
  const hoistDeck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 12.4), concreteDark);
  hoistDeck.position.set(2.2, 25.3, 46);
  hoistDeck.castShadow = true;
  group.add(hoistDeck);
  const hoistRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 12.8), paintWhite);
  hoistRoof.position.set(2.2, 26.6, 46);
  group.add(hoistRoof);
  for (const wh of [43.4, 48.6]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), steel);
    col.position.set(1.15, 26.0, wh);
    group.add(col, col.clone().translateX(2.1));
  }

  const gates: THREE.Mesh[] = [];
  for (const wc of [43.3, 48.7]) {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(4.9, 7.5, 0.9), steel);
    gate.position.set(2.2, 19.05, wc); // closed gate top = 22.8 (sill elevation)
    gate.castShadow = true;
    group.add(gate);
    gates.push(gate);
    // trunnion arm + hub
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), steel);
    arm.rotation.x = -(Math.PI / 2 - 0.62);
    arm.position.set(3.6, 16.4, wc);
    group.add(arm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.6, 8), steel);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(5.2, 14.9, wc);
    group.add(hub);
  }

  // upstream algal stain band (slightly proud of the face, subtle)
  const stainBand = new THREE.Mesh(
    new THREE.BoxGeometry(88, 2.0, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x6b7362, roughness: 0.95, transparent: true, opacity: 0.16 }),
  );
  stainBand.rotation.y = Math.PI / 2;
  stainBand.position.set(-0.05, RES_LEVEL - 0.6, 33);
  group.add(stainBand);

  // control building on the north-east abutment
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
  bld.position.set(5.4, CREST, 7);
  group.add(bld);
  // mast + antenna
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.4, 6), steel);
  mast.position.set(4.6, CREST + 4.6, 7);
  group.add(mast);

  // --- breach monolith blocks (each sinks individually during a scenario)
  // block b spans t ∈ [BLOCK_Z0 + b·W, …] → local w ∈ [−t1, −t0]
  const breachBlocks: BreachBlock[] = [];
  for (let b = 0; b < BLOCK_N; b++) {
    const t0 = BLOCK_Z0 + b * BLOCK_W;
    const t1 = t0 + BLOCK_W;
    const w0 = -t1;
    const w1 = -t0;
    const bg = new THREE.Group();
    bg.add(monolith(w0, w1, CREST, concrete));
    // parapet segment on top of the block
    const len = w1 - w0;
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.0, len), concreteDark);
    p1.position.set(0.25, CREST + 0.5, w0 + len / 2);
    const p2 = p1.clone();
    p2.position.x = 3.15;
    p1.castShadow = p2.castShadow = true;
    bg.add(p1, p2);
    // crest road patch belongs to the block so it sinks with it
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(3.1, 0.2, len),
      new THREE.MeshStandardMaterial({ map: roadTex.clone(), roughness: 0.85 }),
    );
    (patch.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
    (patch.material as THREE.MeshStandardMaterial).map!.needsUpdate = true;
    patch.position.set(1.7, CREST + 0.1, w0 + len / 2);
    patch.castShadow = true;
    bg.add(patch);
    group.add(bg);
    breachBlocks.push({ group: bg, z0: t0, z1: t1 });
  }

  // stilling-basin apron + baffle blocks downstream — sits ON the channel bed
  // at the same elevation as the simulated apron shelf (APRON_TOP), so breach
  // flow visibly crashes onto it and churns over the baffles instead of
  // disappearing under a floating slab (local: u 8.6..22.6, w 11..47)
  const apron = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, 36), concreteDark);
  apron.position.set(15.6, APRON_TOP - 0.175, 29);
  apron.receiveShadow = true;
  group.add(apron);
  for (let i = 0; i < 3; i++) {
    for (let w = 13; w <= 45; w += 6) {
      const baf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.9), concreteDark);
      baf.position.set(10 + i * 4.5, APRON_TOP + 0.55, w + (i % 2) * 3);
      baf.castShadow = true;
      group.add(baf);
    }
  }

  // mount the whole dam in the rotated corner frame (faces down-valley at 45°)
  group.rotation.y = -Math.PI / 4;
  group.position.set(ANCHOR_X, 0, ANCHOR_Z);

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

// Detailed flood-interactive homes: riverside villas upstream (village reach),
// town-edge cottages and floodplain farmsteads — authored in (s,t).
export function buildHouses(): { houses: House[]; group: THREE.Group } {
  const group = new THREE.Group();
  const houses: House[] = [];
  const ST: [number, number][] = [
    // village reach on the right bench upstream of the town
    [80, -10], [84, -6], [88, -12], [92, -7], [84, -16], [90, -17],
    [78, -16], [94, -13], [86, -3], [96, -18],
    // west edge of the town (low-rise quarter)
    [98, -34], [102, -40], [96, -42], [104, -30], [100, -26],
    // east town edge toward the highway
    [128, -24], [132, -18], [136, -26], [130, -10], [134, -32],
    // floodplain farmsteads (lower reach)
    [144, -34], [150, -26], [156, -36], [148, -20], [138, -40],
    [152, -42], [140, -14], [158, -30], [146, -46], [154, -16],
  ];
  ST.forEach(([s, t], idx) => {
    const [x, z] = st2xz(s, t);
    const ground = bedAt(x, z);
    if (ground < 3.2 || ground > 18) return; // stay on habitable ground
    const g = makeHouse(idx);
    g.position.set(x, ground, z);
    g.rotation.y = -Math.PI / 4 + ((idx * 0.9) % (Math.PI * 2)) * 0.35;
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

// Feature trees: riverbank gallery along the diagonal channel, reservoir
// shore clusters, floodplain strands — authored in (s,t) + shoreline scan.
export function buildTrees(): { trees: Tree[]; group: THREE.Group } {
  const group = new THREE.Group();
  const trees: Tree[] = [];
  const pts: { x: number; z: number; kind: number }[] = [];
  const rnd = (i: number) => ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;
  // riverbank gallery along both banks of the diagonal channel
  for (let s = 76; s <= 218; s += 3.4) {
    const az = axisT(s);
    for (const side of [1, -1]) {
      const t = az + side * (13.5 + rnd(s * side) * 5);
      const [x, z] = st2xz(s, t);
      if (x < 2 || x > 158 || z < -78 || z > 78) continue;
      pts.push({ x, z, kind: Math.floor(rnd(s * 3 + side) * 3) });
    }
  }
  // reservoir shore cluster (just above the waterline around the corner lake)
  for (let x = 2; x <= 62; x += 2.6) {
    for (let z = -79; z <= 6; z += 2.6) {
      const g = bedAt(x, z);
      if (g < 22.2 || g > 28) continue;
      if (rnd(x * 7 + z * 3) < 0.62) continue;
      pts.push({ x: x + (rnd(x + z) - 0.5), z: z + (rnd(x * 2 + z) - 0.5), kind: Math.floor(rnd(x * 5 + z) * 3) });
    }
  }
  // floodplain strands + gorge outcrop trees
  const strand: [number, number][] = [
    [96, 24], [104, 30], [112, 36], [98, -30], [110, -38], [122, 26],
    [132, 34], [140, 6], [150, -12], [158, 20], [166, -6], [174, 14],
    [130, -30], [142, -20], [120, -44], [136, -48],
  ];
  for (const [s, t] of strand) {
    const [x, z] = st2xz(s, t);
    pts.push({ x, z, kind: Math.floor(rnd(s + t) * 3) });
  }
  pts.forEach(({ x, z, kind }, idx) => {
    const ground = bedAt(x, z);
    if (ground < 3.2 || ground > 30) return; // stay on vegetable ground
    const r = rnd(x * 13 + z * 7);
    const g = kind === 0 ? makePalm(r) : kind === 1 ? makeBroadleaf(r) : makeBanana(r);
    g.position.set(x, ground - 0.05, z);
    const s = 0.85 + ((idx * 37) % 10) / 28;
    g.scale.setScalar(s);
    g.rotation.y = r * Math.PI * 2;
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
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 1) / 4;
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

  // valley roads following both banks of the diagonal channel
  const swBank: [number, number][] = [];
  const neBank: [number, number][] = [];
  for (let s = 76; s <= 196; s += 6) {
    const [x1, z1] = st2xz(s, axisT(s) - 16.5);
    swBank.push([x1, z1]);
    const [x2, z2] = st2xz(s + 3, axisT(s + 3) + 15.5);
    neBank.push([x2, z2]);
  }
  roadRibbon(swBank);
  roadRibbon(neBank);

  // centre dashes on the downstream (NE) bank road
  for (let i = 0; i < neBank.length - 1; i += 2) {
    const [ax, az] = neBank[i];
    const [bx, bz] = neBank[i + 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.22), lineMat);
    dash.position.set(mx, bedAt(mx, mz) + 0.18, mz);
    dash.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    group.add(dash);
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
export interface InfraPin {
  kind: string;
  x: number;
  z: number;
  head: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  baseColor: number;
}

// pins sit on the reference landmarks (positions match config.infra)
export function buildInfraMarkers(): { group: THREE.Group; pins: InfraPin[] } {
  const group = new THREE.Group();
  const pins: InfraPin[] = [];
  const colors: Record<string, number> = {
    hospital: 0xe34d4d, school: 0xe0a63c, bridge: 0x39c3d8, substation: 0x9a6ae0, waterworks: 0x2fae7e,
  };
  const ST: [number, number, string][] = [
    [120, -14, 'hospital'], [106, -26, 'school'], [100, -20, 'school'],
    [122, -4, 'bridge'], [140, -48, 'substation'], [88, -36, 'waterworks'],
  ];
  for (const [s, t, kind] of ST) {
    const [x, z] = st2xz(s, t);
    const ground = bedAt(x, z);
    const baseColor = colors[kind];
    const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.5, emissive: baseColor, emissiveIntensity: 0.25 });
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
    pins.push({ kind, x, z, head, mat, baseColor });
  }
  return { group, pins };
}

// ------------------------------------------- dam approach warning signage
export function buildWarningSigns(): { group: THREE.Group } {
  const group = new THREE.Group();
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf2c218, roughness: 0.6 });
  const inkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.4 });
  const makeSign = (x: number, z: number, yaw: number): void => {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 6), postMat);
    post.position.y = 0.85;
    post.castShadow = true;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 0.06), boardMat);
    board.position.y = 1.95;
    board.castShadow = true;
    // hazard triangle + "DAM BREAK FLOOD ZONE" bars
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.3, 3), inkMat);
    tri.position.set(0, 2.12, 0.035);
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.09, 0.03), inkMat);
    bar1.position.set(0, 1.88, 0.035);
    const bar2 = bar1.clone();
    bar2.position.y = 1.74;
    bar2.scale.setScalar(0.75);
    g.add(post, board, tri, bar1, bar2);
    g.position.set(x, bedAt(x, z), z);
    g.rotation.y = yaw;
    group.add(g);
  };
  // valley road approaches (both banks) + town-side approach
  const signSpot = (s: number, t: number, yaw: number): void => {
    const [x, z] = st2xz(s, t);
    makeSign(x, z, yaw);
  };
  signSpot(80, -21, 2.6 - Math.PI / 4);
  signSpot(84, 8, -2.6 - Math.PI / 4);
  signSpot(138, -36, 2.9 - Math.PI / 4);
  signSpot(146, 14, -2.9 - Math.PI / 4);
  return { group };
}

// ------------------------------------------------------------------- boats & dock
export function buildDockBoats(): { group: THREE.Group; boats: { mesh: THREE.Object3D }[] } {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3a, roughness: 0.9 });
  // jetty reaching into the mountain-bounded lake (east shore, just
  // upstream of the dam face — the west shore is now the ring massif)
  const [dockX, dockZ] = st2xz(50, -14);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 7), woodMat);
  deck.rotation.y = -Math.PI / 4;
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
    const onBank = i % 4 !== 3;
    const s = 76 + rnd(i) * 130;
    const t = onBank
      ? axisT(s) + (rnd(i + 9) > 0.5 ? 1 : -1) * (12 + rnd(i + 3) * 4)
      : axisT(s) + (rnd(i + 5) - 0.5) * 16;
    const [wx, wz] = st2xz(Math.min(s, 220), t);
    const sz = 0.7 + rnd(i + 7) * 1.6;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(sz, 0), i % 2 ? mat : matDark);
    rock.position.set(wx, bedAt(wx, wz) + sz * 0.25, wz);
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

// barrels float in the reservoir near the breach zone and wash through it
export function buildBarrels(): { barrels: Barrel[]; group: THREE.Group } {
  const group = new THREE.Group();
  const colors = [0xb4552d, 0xc9a227, 0x7d8b99, 0xa33c2a, 0x5e7a52];
  const barrels: Barrel[] = [];
  const ST: [number, number][] = [[52, -26], [54, -18], [50, -34], [56, -42], [48, -22]];
  ST.forEach(([s, t], i) => {
    const [x, z] = st2xz(s, t);
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
      for (let i = 0; i < len; i++) {
        d[i] = Math.random() * 2 - 1;
      }

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
