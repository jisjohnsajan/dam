// 3D props: dam monoliths & gates, houses, trees, floating barrels, debris, audio.
import * as THREE from 'three';
import { LX, LZ, DAM_X, CREST, bedAt } from './terrain';

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

// ------------------------------------------------------------------- dam meshes
export interface DamProps {
  group: THREE.Group;
  breachGroup: THREE.Group;
  gate: THREE.Mesh;
  breachBaseY: number;
}

export function buildDam(): DamProps {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9e988c, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.2 });
  const concreteDark = new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.93, metalness: 0.02, envMapIntensity: 0.2 });

  const monolith = (z0: number, z1: number, crestY: number, mat: THREE.Material): THREE.Mesh => {
    const s = new THREE.Shape();
    s.moveTo(0, 6);
    s.lineTo(0, crestY);
    s.lineTo(3.4, crestY);
    s.lineTo(8.6, 9.0);
    s.lineTo(8.6, 6);
    s.lineTo(0, 6);
    const geo = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false });
    geo.translate(DAM_X, 0, z0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  const parapet = (z0: number, z1: number, crestY: number): THREE.Mesh => {
    const len = z1 - z0;
    const g = new THREE.Group();
    const geoU = new THREE.BoxGeometry(0.45, 1.0, len);
    const p1 = new THREE.Mesh(geoU, concreteDark);
    p1.position.set(DAM_X + 0.25, crestY + 0.5, z0 + len / 2);
    const p2 = new THREE.Mesh(geoU, concreteDark);
    p2.position.set(DAM_X + 3.15, crestY + 0.5, z0 + len / 2);
    p1.castShadow = p2.castShadow = true;
    g.add(p1, p2);
    return g as unknown as THREE.Mesh;
  };

  group.add(monolith(-38, -14, CREST, concrete));
  group.add(parapet(-38, -14, CREST));
  group.add(monolith(10, 18, CREST, concrete));
  group.add(parapet(10, 18, CREST));
  group.add(monolith(18, 30, 22.2, concreteDark)); // spillway sill
  group.add(monolith(30, 38, CREST, concrete));
  group.add(parapet(30, 38, CREST));

  // gate piers + bridge over the spillway
  const pierGeo = new THREE.BoxGeometry(2.4, 14.5, 1.6);
  for (const zc of [17.4, 30.6]) {
    const pier = new THREE.Mesh(pierGeo, concreteDark);
    pier.position.set(DAM_X + 2.2, 17.2, zc);
    pier.castShadow = true;
    group.add(pier);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 15.6), concreteDark);
  bridge.position.set(DAM_X + 2.2, 24.6, 24);
  bridge.castShadow = true;
  group.add(bridge);
  const hoist = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 3.2), concreteDark);
  hoist.position.set(DAM_X + 2.2, 25.7, 24);
  group.add(hoist);

  // radial gate panel (slides up when opened)
  const gate = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 6.7, 11.2),
    new THREE.MeshStandardMaterial({ color: 0x6f7a80, roughness: 0.55, metalness: 0.5 }),
  );
  gate.position.set(DAM_X + 2.2, 18.85, 24);
  gate.castShadow = true;
  group.add(gate);

  // breach monolith (own group so it can collapse)
  const breachGroup = new THREE.Group();
  breachGroup.add(monolith(-14, 10, CREST, concrete));
  breachGroup.add(parapet(-14, 10, CREST));
  group.add(breachGroup);

  return { group, breachGroup, gate, breachBaseY: 0 };
}

// ------------------------------------------------------------------- houses
export interface House {
  group: THREE.Group;
  ground: number;
  prog: number; // 0 intact → 1 collapsed
}

export function buildHouses(): { houses: House[]; group: THREE.Group } {
  const group = new THREE.Group();
  const houses: House[] = [];
  const wallColors = [0xd8cdb8, 0xcbb89a, 0xdcd2c0, 0xc2b49a, 0xd5c0a5, 0xcfc6b4];
  const spots: [number, number][] = [
    [140, -18], [148, -22], [158, -19], [145, 21], [156, 24], [166, 18],
  ];
  spots.forEach(([x, z], idx) => {
    const ground = bedAt(x, z);
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.5, 2.8),
      new THREE.MeshStandardMaterial({ color: wallColors[idx], roughness: 0.9 }),
    );
    body.position.y = 1.25;
    body.castShadow = true;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 1.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x7a4438, roughness: 0.85 }),
    );
    roof.position.y = 3.25;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(body, roof);
    g.position.set(x, ground, z);
    g.rotation.y = (idx * 0.7) % Math.PI;
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

export function buildTrees(): { trees: Tree[]; group: THREE.Group } {
  const group = new THREE.Group();
  const trees: Tree[] = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.95 });
  const spots: [number, number][] = [
    [96, -34], [104, 33], [88, 34], [128, -26], [136, 26], [152, -25],
    [166, 26], [120, 30], [100, -36], [174, -17], [86, 30], [146, -30],
  ];
  spots.forEach(([x, z]) => {
    const ground = bedAt(x, z);
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.8, 6), trunkMat);
    trunk.position.y = 0.9;
    trunk.castShadow = true;
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3.0, 8), leafMat);
    canopy.position.y = 3.0;
    canopy.castShadow = true;
    g.add(trunk, canopy);
    g.position.set(x, ground, z);
    const s = 0.8 + ((x * 13 + z * 7) % 10) / 25;
    g.scale.setScalar(s);
    group.add(g);
    trees.push({ group: g, ground, prog: 0 });
  });
  return { trees, group };
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
        const ox = x, oz = z;
        mesh.position.set(ox, 21.4, oz);
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
  for (let i = 0; i < 12; i++) {
    const s = 0.7 + ((i * 37) % 10) / 12;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s * 0.9), mat);
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
