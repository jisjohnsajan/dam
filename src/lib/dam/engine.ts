// Dam-break hydrodynamics engine: Three.js scene + GPU shallow-water solver.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

import {
  LX, LZ, NX, NZ, DX, DZ,
  DAM_X, CREST, RES_LEVEL,
  SPILL_CREST_CLOSED, GATE_OPEN_ELEV,
  BREACH_BOTTOM,
  bedAt, fbm, buildStructBase, applyStructState, buildInitState, terrainColor,
} from './terrain';
import {
  QUAD_VERT, ETA_FRAG, VEL_FRAG, FOAM_FRAG, SPRAY_FRAG, COPY_FRAG, DOWN_FRAG,
  WATER_VERT, WATER_FRAG, SPRAY_POINTS_VERT, SPRAY_POINTS_FRAG, TEXEL, CELL,
} from './glsl';
import {
  FlowField, buildDam, buildHouses, buildTrees, buildBarrels, buildDebris,
  RiverAudio, type DamProps, type House, type Tree, type Barrel, type Chunk,
} from './props';

export type Phase = 'ready' | 'breach' | 'gates' | 'flood';
export type CamPreset = 'overview' | 'dam' | 'valley' | 'top';

export interface DamStats {
  t: number;
  q: number;
  qPeak: number;
  level: number;
  vmax: number;
  froude: number;
  fps: number;
  phase: Phase;
  overtopping: boolean;
}

const DT_MAX = 0.008;
const MANNING = 0.028;
const SPRAY_N = 128;
const DOWN_W = 48;
const DOWN_H = 28;

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class DamSim {
  // ---- three core
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private container: HTMLElement;
  private lastFrameTime = performance.now();
  private rafId = 0;
  private ro: ResizeObserver;

  // ---- GPU sim resources
  private rtStateA!: THREE.WebGLRenderTarget;
  private rtStateB!: THREE.WebGLRenderTarget;
  private rtEta!: THREE.WebGLRenderTarget;
  private rtFoamA!: THREE.WebGLRenderTarget;
  private rtFoamB!: THREE.WebGLRenderTarget;
  private rtSprayA!: THREE.WebGLRenderTarget;
  private rtSprayB!: THREE.WebGLRenderTarget;
  private rtDown!: THREE.WebGLRenderTarget;
  private texBed!: THREE.DataTexture;
  private texStruct!: THREE.DataTexture;
  private texInit!: THREE.DataTexture;
  private texSprayInit!: THREE.DataTexture;
  private texBlack!: THREE.DataTexture;

  private etaPass!: FullScreenQuad;
  private velPass!: FullScreenQuad;
  private foamPass!: FullScreenQuad;
  private sprayPass!: FullScreenQuad;
  private copyPass!: FullScreenQuad;
  private downPass!: FullScreenQuad;

  private structArr: Float32Array;
  private structBase: Float32Array;
  private bedGrid: Float32Array;

  // ---- scene objects
  private waterMat!: THREE.ShaderMaterial;
  private sprayMat!: THREE.ShaderMaterial;
  private dam!: DamProps;
  private houses: House[] = [];
  private trees: Tree[] = [];
  private barrels: Barrel[] = [];
  private chunks: Chunk[] = [];
  private audio = new RiverAudio();
  private sunDir = new THREE.Vector3(-0.42, 0.62, 0.28).normalize();

  // ---- state
  private curState: THREE.WebGLRenderTarget;
  private nextState: THREE.WebGLRenderTarget;
  private curFoam!: THREE.WebGLRenderTarget;
  private nextFoam!: THREE.WebGLRenderTarget;
  private curSpray!: THREE.WebGLRenderTarget;
  private nextSpray!: THREE.WebGLRenderTarget;

  simTime = 0;
  private phase: Phase = 'ready';
  private breachT: number | null = null;
  private breachElev: number | null = null;
  private gateT: number | null = null;
  private gateElev: number | null = null;
  private overtopping = false;
  private overtopT = 0;
  private structDirty = true;
  private shake = 0;
  private paused = false;

  // params
  private timeScale = 1;
  private prevTimeScale = 1;
  private gravity = 9.81;
  private inflowQ = 8;
  private breachRate = 1;
  private foamOn = true;
  private sprayOn = true;
  private showSpeed = false;
  private cinematic = false;
  private cinAngle = 0;

  // stats
  private field = new FlowField();
  private readBuf = new Float32Array(DOWN_W * DOWN_H * 4);
  private qPeak = 0;
  private frame = 0;
  private fpsEma = 60;
  private stripCells = 1;
  private srcRate = 0;
  private sample = { eta: 0, u: 0, v: 0 };

  // camera tween
  private tweenT = 1;
  private tweenFrom = new THREE.Vector3();
  private tweenFromT = new THREE.Vector3();
  private tweenTo = new THREE.Vector3();
  private tweenToT = new THREE.Vector3();

  onStats: ((s: DamStats) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.5, 6000);
    this.camera.position.set(150, 58, 132);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(100, 12, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.54;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 500;

    this.scene.fog = new THREE.Fog(0xc6d8ea, 380, 1600);

    // sky + environment
    const sky = new Sky();
    sky.scale.setScalar(12000);
    const su = sky.material.uniforms;
    su.turbidity.value = 6;
    su.rayleigh.value = 2.2;
    su.mieCoefficient.value = 0.006;
    su.mieDirectionalG.value = 0.85;
    su.sunPosition.value.copy(this.sunDir);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(skyScene).texture;
    this.scene.environmentIntensity = 0.22;
    pmrem.dispose();
    this.scene.add(sky);

    // lights
    const sun = new THREE.DirectionalLight(0xffe8c8, 2.0);
    sun.position.copy(this.sunDir).multiplyScalar(420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 100; sc.far = 950;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.target.position.set(105, 10, 0);
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ef, 0x6b6354, 0.42));

    this.buildTerrainMesh();
    this.buildGpuResources();
    this.buildWater();
    this.buildProps();

    this.curState = this.rtStateA;
    this.nextState = this.rtStateB;
    this.curFoam = this.rtFoamA;
    this.nextFoam = this.rtFoamB;
    this.curSpray = this.rtSprayA;
    this.nextSpray = this.rtSprayB;
    this.resetSim();

    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(container);

    (window as unknown as Record<string, unknown>).__damSim = this;
    this.lastFrameTime = performance.now();
    this.tick();
  }

  // ================================================================ terrain mesh
  private buildTerrainMesh(): void {
    // bed grid on cell centers
    this.bedGrid = new Float32Array(NX * NZ);
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++)
        this.bedGrid[j * NX + i] = bedAt((i + 0.5) * DX, (j + 0.5) * DZ - LZ / 2);

    const geo = new THREE.PlaneGeometry(LX, LZ, NX - 1, NZ - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(LX / 2, 0, 0);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const tc = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.sampleBed(x, z);
      pos.setY(i, y);
      const e = 1.2;
      const sx = (this.sampleBed(x + e, z) - this.sampleBed(x - e, z)) / (2 * e);
      const sz = (this.sampleBed(x, z + e) - this.sampleBed(x, z - e)) / (2 * e);
      const slope = Math.sqrt(sx * sx + sz * sz);
      terrainColor(x, z, y, slope, tc);
      col.setRGB(tc.r, tc.g, tc.b, THREE.SRGBColorSpace);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.18 }),
    );
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // surround plane so the domain doesn't float in the void
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ color: 0xa8ad97, roughness: 1, metalness: 0, envMapIntensity: 0.1 }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(LX / 2, 1.2, 0);
    this.scene.add(surround);
  }

  private sampleBed(x: number, z: number): number {
    const fu = clamp((x / DX) - 0.5, 0, NX - 1.001);
    const fv = clamp((z + LZ / 2) / DZ - 0.5, 0, NZ - 1.001);
    const i = Math.floor(fu), j = Math.floor(fv);
    const fx = fu - i, fy = fv - j;
    const i1 = Math.min(i + 1, NX - 1), j1 = Math.min(j + 1, NZ - 1);
    const g = this.bedGrid;
    const a = g[j * NX + i] + (g[j * NX + i1] - g[j * NX + i]) * fx;
    const b = g[j1 * NX + i] + (g[j1 * NX + i1] - g[j1 * NX + i]) * fx;
    return a + (b - a) * fy;
  }

  // ============================================================== GPU resources
  private mkRT(w: number, h: number, filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: filter,
      magFilter: filter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private buildGpuResources(): void {
    const gl = this.renderer.getContext();
    gl.getExtension('EXT_color_buffer_float');
    const floatLinear = !!gl.getExtension('OES_texture_float_linear');
    const foamFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;

    this.rtStateA = this.mkRT(NX, NZ, THREE.NearestFilter);
    this.rtStateB = this.mkRT(NX, NZ, THREE.NearestFilter);
    this.rtEta = this.mkRT(NX, NZ, THREE.NearestFilter);
    this.rtFoamA = this.mkRT(NX, NZ, foamFilter);
    this.rtFoamB = this.mkRT(NX, NZ, foamFilter);
    this.rtSprayA = this.mkRT(SPRAY_N, SPRAY_N, THREE.NearestFilter);
    this.rtSprayB = this.mkRT(SPRAY_N, SPRAY_N, THREE.NearestFilter);
    this.rtDown = this.mkRT(DOWN_W, DOWN_H, THREE.NearestFilter);

    this.structBase = buildStructBase();
    this.structArr = new Float32Array(this.structBase);
    this.texBed = new THREE.DataTexture(this.bedGrid, NX, NZ, THREE.RedFormat, THREE.FloatType);
    this.texBed.minFilter = this.texBed.magFilter = THREE.NearestFilter;
    this.texBed.needsUpdate = true;
    this.texStruct = new THREE.DataTexture(this.structArr, NX, NZ, THREE.RedFormat, THREE.FloatType);
    this.texStruct.minFilter = this.texStruct.magFilter = THREE.NearestFilter;
    this.texStruct.needsUpdate = true;
    this.texInit = new THREE.DataTexture(buildInitState(), NX, NZ, THREE.RGBAFormat, THREE.FloatType);
    this.texInit.minFilter = this.texInit.magFilter = THREE.NearestFilter;
    this.texInit.needsUpdate = true;

    const sprayInit = new Float32Array(SPRAY_N * SPRAY_N * 4);
    for (let i = 0; i < sprayInit.length; i += 4) {
      sprayInit[i] = 0; sprayInit[i + 1] = 0; sprayInit[i + 2] = 1; sprayInit[i + 3] = 1;
    }
    this.texSprayInit = new THREE.DataTexture(sprayInit, SPRAY_N, SPRAY_N, THREE.RGBAFormat, THREE.FloatType);
    this.texSprayInit.needsUpdate = true;
    this.texBlack = new THREE.DataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texBlack.needsUpdate = true;

    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

    const common = {
      uState: { value: null },
      uBed: { value: this.texBed },
      uStruct: { value: this.texStruct },
      uTexel: { value: new THREE.Vector2(TEXEL[0], TEXEL[1]) },
      uCell: { value: new THREE.Vector2(CELL[0], CELL[1]) },
      uG: { value: this.gravity },
    };

    this.etaPass = new FullScreenQuad(mat(ETA_FRAG, {
      ...common,
      uDt: { value: 0 },
      uSrcRate: { value: 0 },
      uSrcBox: { value: new THREE.Vector4(2 / LX, 8 / LX, (-34 + LZ / 2) / LZ, (34 + LZ / 2) / LZ) },
    }));
    this.velPass = new FullScreenQuad(mat(VEL_FRAG, {
      ...common,
      uEtaNew: { value: null },
      uDt: { value: 0 },
      uManning: { value: MANNING },
    }));
    this.foamPass = new FullScreenQuad(mat(FOAM_FRAG, {
      ...common,
      uFoam: { value: null },
      uDt: { value: 0 },
    }));
    this.sprayPass = new FullScreenQuad(mat(SPRAY_FRAG, {
      uSpray: { value: null },
      uState: { value: null },
      uBed: { value: this.texBed },
      uStruct: { value: this.texStruct },
      uTexel: { value: new THREE.Vector2(TEXEL[0], TEXEL[1]) },
      uDt: { value: 0 },
      uTime: { value: 0 },
      uSpawnSpeed: { value: 3.2 },
      uDomain: { value: new THREE.Vector2(LX, LZ) },
    }));
    this.copyPass = new FullScreenQuad(mat(COPY_FRAG, { uInit: { value: null } }));
    this.downPass = new FullScreenQuad(mat(DOWN_FRAG, { uState: { value: null } }));

    // count inflow strip cells (x ∈ [2,8], bed < 15)
    let n = 0;
    for (let j = 0; j < NZ; j++)
      for (let i = Math.ceil(2 / DX); i < Math.floor(8 / DX); i++)
        if (this.bedGrid[j * NX + i] < 15) n++;
    this.stripCells = Math.max(n, 1);
  }

  private renderTo(q: FullScreenQuad, target: THREE.WebGLRenderTarget | null): void {
    this.renderer.setRenderTarget(target);
    q.render(this.renderer);
    this.renderer.setRenderTarget(null);
  }

  // =================================================================== water
  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(LX, LZ, 320, 192);
    geo.rotateX(-Math.PI / 2);
    geo.translate(LX / 2, 0, 0);
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uState: { value: null },
        uBed: { value: this.texBed },
        uStruct: { value: this.texStruct },
        uFoam: { value: null },
        uTexel: { value: new THREE.Vector2(TEXEL[0], TEXEL[1]) },
        uCell: { value: new THREE.Vector2(CELL[0], CELL[1]) },
        uDomain: { value: new THREE.Vector2(LX, LZ) },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Vector3(1.0, 0.92, 0.8) },
        uCamPos: { value: new THREE.Vector3() },
        uShowSpeed: { value: 0 },
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(0xc6d8ea) },
        uFogNear: { value: 380 },
        uFogFar: { value: 1600 },
      },
    });
    const mesh = new THREE.Mesh(geo, this.waterMat);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    // spray points
    const pg = new THREE.BufferGeometry();
    const pp = new Float32Array(SPRAY_N * SPRAY_N * 3);
    for (let j = 0; j < SPRAY_N; j++)
      for (let i = 0; i < SPRAY_N; i++) {
        const k = (j * SPRAY_N + i) * 3;
        pp[k] = (i + 0.5) / SPRAY_N;
        pp[k + 1] = (j + 0.5) / SPRAY_N;
        pp[k + 2] = 0;
      }
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.sprayMat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_POINTS_VERT,
      fragmentShader: SPRAY_POINTS_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSpray: { value: null },
        uState: { value: null },
        uTexel: { value: new THREE.Vector2(TEXEL[0], TEXEL[1]) },
        uDomain: { value: new THREE.Vector2(LX, LZ) },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
    });
    const points = new THREE.Points(pg, this.sprayMat);
    points.renderOrder = 11;
    points.frustumCulled = false;
    this.scene.add(points);
  }

  // ==================================================================== props
  private buildProps(): void {
    this.dam = buildDam();
    this.scene.add(this.dam.group);
    const h = buildHouses();
    this.houses = h.houses;
    this.scene.add(h.group);
    const t = buildTrees();
    this.trees = t.trees;
    this.scene.add(t.group);
    const b = buildBarrels();
    this.barrels = b.barrels;
    this.scene.add(b.group);
    const d = buildDebris();
    this.chunks = d.chunks;
    this.scene.add(d.group);
  }

  // ================================================================ sim stepping
  private swapState(): void {
    const t = this.curState;
    this.curState = this.nextState;
    this.nextState = t;
  }

  private simSubstep(dt: number): void {
    const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
    eu.uState.value = this.curState.texture;
    eu.uDt.value = dt;
    eu.uG.value = this.gravity;
    eu.uSrcRate.value = this.srcRate;
    this.renderTo(this.etaPass, this.rtEta);

    const vu = (this.velPass.material as THREE.ShaderMaterial).uniforms;
    vu.uState.value = this.curState.texture;
    vu.uEtaNew.value = this.rtEta.texture;
    vu.uDt.value = dt;
    vu.uG.value = this.gravity;
    this.renderTo(this.velPass, this.nextState);
    this.swapState();

    if (this.foamOn) {
      const fu = (this.foamPass.material as THREE.ShaderMaterial).uniforms;
      fu.uState.value = this.curState.texture;
      fu.uFoam.value = this.curFoam.texture;
      fu.uDt.value = dt;
      fu.uG.value = this.gravity;
      this.renderTo(this.foamPass, this.nextFoam);
      const t = this.curFoam;
      this.curFoam = this.nextFoam;
      this.nextFoam = t;
    }

    if (this.sprayOn) {
      const su = (this.sprayPass.material as THREE.ShaderMaterial).uniforms;
      su.uSpray.value = this.curSpray.texture;
      su.uState.value = this.curState.texture;
      su.uDt.value = dt;
      su.uTime.value = this.simTime;
      this.renderTo(this.sprayPass, this.nextSpray);
      const t = this.curSpray;
      this.curSpray = this.nextSpray;
      this.nextSpray = t;
    }
  }

  private resetSim(): void {
    const cu = (this.copyPass.material as THREE.ShaderMaterial).uniforms;
    cu.uInit.value = this.texInit;
    this.renderTo(this.copyPass, this.rtStateA);
    this.renderTo(this.copyPass, this.rtStateB);
    this.renderTo(this.copyPass, this.rtEta);
    cu.uInit.value = this.texBlack;
    this.renderTo(this.copyPass, this.rtFoamA);
    this.renderTo(this.copyPass, this.rtFoamB);
    cu.uInit.value = this.texSprayInit;
    this.renderTo(this.copyPass, this.rtSprayA);
    this.renderTo(this.copyPass, this.rtSprayB);
    this.curState = this.rtStateA;
    this.nextState = this.rtStateB;
    this.curFoam = this.rtFoamA;
    this.nextFoam = this.rtFoamB;
    this.curSpray = this.rtSprayA;
    this.nextSpray = this.rtSprayB;
    this.simTime = 0;
    this.qPeak = 0;
    this.applyStruct(null, null);
  }

  // ================================================================ scenarios
  private applyStruct(breach: number | null, gate: number | null): void {
    applyStructState(this.structArr, this.structBase, breach, gate);
    this.texStruct.needsUpdate = true;
  }

  breakDam(): void {
    if (this.breachT !== null) return;
    this.phase = 'breach';
    this.breachT = 0;
    this.shake = 1;
    this.audio.burst(1);
    this.spawnDebris();
  }

  openGates(): void {
    if (this.gateT !== null) return;
    this.phase = 'gates';
    this.gateT = 0;
    this.audio.burst(0.35);
  }

  toggleOvertopping(): boolean {
    this.overtopping = !this.overtopping;
    if (this.overtopping) {
      this.overtopT = 0;
      this.phase = 'flood';
    } else {
      this.phase = 'ready';
    }
    return this.overtopping;
  }

  reset(): void {
    this.phase = 'ready';
    this.breachT = null;
    this.breachElev = null;
    this.gateT = null;
    this.gateElev = null;
    this.overtopping = false;
    this.overtopT = 0;
    this.shake = 0;
    this.dam.breachGroup.position.y = 0;
    this.dam.breachGroup.rotation.set(0, 0, 0);
    this.dam.gate.position.y = 18.85;
    for (const c of this.chunks) {
      c.active = false;
      c.mesh.visible = false;
    }
    for (const h of this.houses) {
      h.prog = 0;
      h.group.rotation.x = 0;
      h.group.rotation.z = 0;
      h.group.position.y = h.ground;
    }
    for (const t of this.trees) {
      t.prog = 0;
      t.group.rotation.x = 0;
      t.group.rotation.z = 0;
      t.group.position.y = t.ground;
    }
    for (const b of this.barrels) {
      b.pos.set(b.mesh.position.x, 21.4, b.mesh.position.z);
      b.vel.set(0, 0, 0);
    }
    this.resetSim();
  }

  private spawnDebris(): void {
    for (const c of this.chunks) {
      const r = Math.random();
      c.mesh.visible = true;
      c.active = true;
      c.mesh.position.set(DAM_X + 1 + Math.random() * 2.5, CREST + 0.5 + Math.random(), -13 + r * 22);
      c.vel.set(4 + Math.random() * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 9);
      c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
  }

  // ================================================================ main loop
  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dtReal = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    this.fpsEma = this.fpsEma * 0.95 + (1 / Math.max(dtReal, 1e-4)) * 0.05;
    const dtSim = this.paused ? 0 : dtReal * this.timeScale;

    if (dtSim > 0) {
      // scenario animation timers
      if (this.breachT !== null) {
        this.breachT += dtSim;
        const tau = 2.6 / this.breachRate;
        const p = 1 - Math.exp(-Math.pow(this.breachT / tau, 1.7));
        this.breachElev = CREST + (BREACH_BOTTOM - CREST) * p;
        this.dam.breachGroup.position.y = this.breachElev - CREST;
        this.dam.breachGroup.rotation.z = -0.05 * p;
        this.structDirty = true;
        if (p > 0.995) this.breachT = null;
      }
      if (this.gateT !== null && this.gateT < 1) {
        this.gateT = Math.min(1, this.gateT + dtSim / 2.5);
        const e = easeInOut(this.gateT);
        this.gateElev = SPILL_CREST_CLOSED + (GATE_OPEN_ELEV - SPILL_CREST_CLOSED) * e;
        this.dam.gate.position.y = 18.85 + 6.9 * e;
        this.structDirty = true;
      }
      if (this.overtopping) {
        this.overtopT += dtSim;
      }
      const curInflow = this.overtopping
        ? this.inflowQ + 272 * Math.min(this.overtopT / 18, 1)
        : this.inflowQ;
      this.srcRate = curInflow / (this.stripCells * DX * DZ);

      if (this.structDirty) {
        this.applyStruct(this.breachElev, this.gateElev);
        this.structDirty = false;
      }

      const sub = clamp(Math.ceil(dtSim / DT_MAX), 1, 8);
      const h = dtSim / sub;
      for (let i = 0; i < sub; i++) this.simSubstep(h);
      this.simTime += dtSim;
      this.updateProps(dtSim);
    }

    // readback for CPU physics + stats
    if (this.frame % 2 === 0) {
      (this.downPass.material as THREE.ShaderMaterial).uniforms.uState.value = this.curState.texture;
      this.renderTo(this.downPass, this.rtDown);
      this.renderer.readRenderTargetPixels(this.rtDown, 0, 0, DOWN_W, DOWN_H, this.field.data);
    }

    this.updateCamera(dtReal);

    // shader uniforms
    this.waterMat.uniforms.uState.value = this.curState.texture;
    this.waterMat.uniforms.uFoam.value = this.curFoam.texture;
    this.waterMat.uniforms.uTime.value = this.simTime;
    this.waterMat.uniforms.uCamPos.value.copy(this.camera.position);
    this.sprayMat.uniforms.uSpray.value = this.curSpray.texture;
    this.sprayMat.uniforms.uState.value = this.curState.texture;
    (this.sprayPass.material as THREE.ShaderMaterial).uniforms.uState.value = this.curState.texture;

    // render with camera shake
    let shook: THREE.Vector3 | null = null;
    if (this.shake > 0.002) {
      shook = new THREE.Vector3(
        (Math.random() - 0.5) * this.shake * 0.9,
        (Math.random() - 0.5) * this.shake * 0.9,
        (Math.random() - 0.5) * this.shake * 0.9,
      );
      this.camera.position.add(shook);
    }
    this.renderer.render(this.scene, this.camera);
    if (shook) {
      this.camera.position.sub(shook);
      this.shake *= Math.exp(-dtReal * 1.15);
    }

    // stats ~10 Hz
    if (this.frame % 6 === 0 && this.onStats) {
      const s = this.computeStats();
      this.onStats(s);
      const v01 = clamp(s.vmax / 10, 0, 1);
      this.audio.setIntensity(v01);
    }

    if (this.frame === 3) {
      (window as unknown as Record<string, unknown>).__damReady = true;
    }
    this.frame++;
  };

  // ================================================================ props update
  private updateProps(dt: number): void {
    const f = this.field;
    const s = this.sample;

    for (const b of this.barrels) {
      f.sample(b.pos.x, b.pos.z, s);
      const bed = bedAt(b.pos.x, b.pos.z);
      const dep = s.eta - bed;
      if (dep > 0.4) {
        const bob = Math.sin(this.simTime * 1.7 + b.pos.x) * 0.06;
        b.pos.y += (s.eta + 0.15 + bob - b.pos.y) * Math.min(1, dt * 5);
        b.vel.x += (s.u * 0.92 - b.vel.x) * Math.min(1, dt * 2.2);
        b.vel.z += (s.v * 0.92 - b.vel.z) * Math.min(1, dt * 2.2);
        b.pos.x += b.vel.x * dt;
        b.pos.z += b.vel.z * dt;
      } else {
        b.vel.multiplyScalar(1 - Math.min(1, dt * 2.5));
        b.pos.y += (bed + 0.3 - b.pos.y) * Math.min(1, dt * 4);
      }
      b.pos.x = clamp(b.pos.x, 1, LX - 1);
      b.pos.z = clamp(b.pos.z, -LZ / 2 + 1, LZ / 2 - 1);
      const spd = Math.sqrt(b.vel.x * b.vel.x + b.vel.z * b.vel.z);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x = clamp(b.vel.z * 0.1, -0.5, 0.5) + Math.sin(this.simTime * 2.1 + b.pos.z) * 0.04;
      b.mesh.rotation.z = clamp(-b.vel.x * 0.1, -0.5, 0.5);
      b.mesh.rotation.y += (0.2 + spd * 0.3) * dt;
    }

    for (const h of this.houses) {
      if (h.prog >= 1) continue;
      f.sample(h.group.position.x, h.group.position.z, s);
      const wd = s.eta - h.ground;
      if (wd > 0.55) {
        h.prog = Math.min(1, h.prog + dt * 0.4);
        const p = h.prog;
        const dir = Math.atan2(s.v, s.u);
        h.group.rotation.x = -Math.cos(dir) * p * 1.35;
        h.group.rotation.z = Math.sin(dir) * p * 1.35;
        h.group.position.x += s.u * dt * 0.45 * p;
        h.group.position.z += s.v * dt * 0.45 * p;
        h.group.position.y = h.ground - p * 0.5;
      }
    }

    for (const t of this.trees) {
      if (t.prog >= 1) continue;
      f.sample(t.group.position.x, t.group.position.z, s);
      const wd = s.eta - t.ground;
      if (wd > 0.7) {
        t.prog = Math.min(1, t.prog + dt * 0.6);
        const p = t.prog;
        const dir = Math.atan2(s.v, s.u);
        t.group.rotation.x = -Math.cos(dir) * p * 1.3;
        t.group.rotation.z = Math.sin(dir) * p * 1.3;
        t.group.position.x += s.u * dt * 0.25 * p;
        t.group.position.z += s.v * dt * 0.25 * p;
      }
    }

    for (const c of this.chunks) {
      if (!c.active) continue;
      c.vel.y -= 11 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.vel.z * dt * 0.15;
      c.mesh.rotation.z -= c.vel.x * dt * 0.15;
      const ground = bedAt(c.mesh.position.x, c.mesh.position.z) + 0.25;
      if (c.mesh.position.y < ground) {
        c.mesh.position.y = ground;
        c.vel.y *= -0.35;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        if (c.vel.lengthSq() < 0.4) c.active = false;
      }
      if (c.mesh.position.x > LX - 1) c.active = false;
    }
  }

  // ================================================================ stats
  private computeStats(): DamStats {
    const d = this.field.data;
    const dzC = LZ / DOWN_H;
    const gx = 37;
    let q = 0;
    let stage = 0;
    let froude = 0;
    for (let j = 0; j < DOWN_H; j++) {
      const k = (j * DOWN_W + gx) * 4;
      const h = Math.max(d[k + 3], 0);
      const u = d[k + 1];
      q += u * h * dzC;
      stage = Math.max(stage, h);
      if (h > 0.05) {
        froude = Math.max(froude, Math.abs(u) / Math.sqrt(this.gravity * h));
      }
    }
    let vmax = 0;
    let level = 0;
    for (let i = 0; i < DOWN_W * DOWN_H; i++) {
      const k = i * 4;
      const sp = Math.sqrt(d[k + 1] * d[k + 1] + d[k + 2] * d[k + 2]);
      vmax = Math.max(vmax, sp);
      if (i % DOWN_W < 18 && d[k + 3] > 0.1) level = Math.max(level, d[k]);
    }
    if (q > this.qPeak) this.qPeak = q;
    return {
      t: this.simTime,
      q: Math.max(q, 0),
      qPeak: this.qPeak,
      level,
      vmax,
      froude,
      fps: this.fpsEma,
      phase: this.phase,
      overtopping: this.overtopping,
    };
  }

  // ================================================================ camera
  private updateCamera(dt: number): void {
    if (this.cinematic) {
      this.cinAngle += dt * 0.05;
      const R = 95;
      this.camera.position.set(
        105 + R * Math.cos(this.cinAngle),
        42 + 10 * Math.sin(this.cinAngle * 0.7),
        R * Math.sin(this.cinAngle),
      );
      this.camera.lookAt(105, 14, 0);
      return;
    }
    if (this.tweenT < 1) {
      this.tweenT = Math.min(1, this.tweenT + dt / 1.2);
      const e = easeInOut(this.tweenT);
      this.camera.position.lerpVectors(this.tweenFrom, this.tweenTo, e);
      this.controls.target.lerpVectors(this.tweenFromT, this.tweenToT, e);
    }
    this.controls.update();
  }

  setCamera(preset: CamPreset): void {
    const P: Record<CamPreset, [THREE.Vector3, THREE.Vector3]> = {
      overview: [new THREE.Vector3(150, 58, 132), new THREE.Vector3(100, 12, 0)],
      dam: [new THREE.Vector3(76, 27, 52), new THREE.Vector3(114, 17, 0)],
      valley: [new THREE.Vector3(178, 9, 46), new THREE.Vector3(118, 10, -2)],
      top: [new THREE.Vector3(96, 195, 0.01), new THREE.Vector3(96, 0, 0)],
    };
    const [pos, tgt] = P[preset];
    this.tweenFrom.copy(this.camera.position);
    this.tweenFromT.copy(this.controls.target);
    this.tweenTo.copy(pos);
    this.tweenToT.copy(tgt);
    this.tweenT = 0;
  }

  // ================================================================ public API
  setTimeScale(v: number): void { this.timeScale = v; }
  setPaused(b: boolean): void { this.paused = b; }
  setGravity(g: number): void { this.gravity = g; }
  setInflow(q: number): void { this.inflowQ = q; }
  setBreachRate(v: number): void { this.breachRate = v; }
  setSpeedMap(b: boolean): void { this.waterMat.uniforms.uShowSpeed.value = b ? 1 : 0; }
  setFoam(b: boolean): void {
    this.foamOn = b;
    if (!b) {
      const cu = (this.copyPass.material as THREE.ShaderMaterial).uniforms;
      cu.uInit.value = this.texBlack;
      this.renderTo(this.copyPass, this.rtFoamA);
      this.renderTo(this.copyPass, this.rtFoamB);
      this.curFoam = this.rtFoamA;
      this.nextFoam = this.rtFoamB;
    }
  }
  setSpray(b: boolean): void { this.sprayOn = b; }
  setSound(b: boolean): void { this.audio.setEnabled(b); }
  setCinematic(b: boolean): void {
    this.cinematic = b;
    this.controls.enabled = !b;
    if (b) {
      this.cinAngle = Math.atan2(this.camera.position.z - 105, this.camera.position.x - 105);
      this.prevTimeScale = this.timeScale;
      this.timeScale = Math.min(this.timeScale, 0.5);
    } else {
      this.timeScale = this.prevTimeScale;
      this.controls.target.set(105, 14, 0);
    }
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.sprayMat.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.ro.disconnect();
    this.audio.dispose();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    [this.rtStateA, this.rtStateB, this.rtEta, this.rtFoamA, this.rtFoamB,
      this.rtSprayA, this.rtSprayB, this.rtDown].forEach((rt) => rt.dispose());
    [this.etaPass, this.velPass, this.foamPass, this.sprayPass, this.copyPass, this.downPass]
      .forEach((q) => q.dispose());
    [this.texBed, this.texStruct, this.texInit, this.texSprayInit, this.texBlack].forEach((t) => t.dispose());
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
