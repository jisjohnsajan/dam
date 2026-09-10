// DAMSAFE 3D engine: Three.js scene + GPU shallow-water solver + digital-twin logic.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import {
  LX, LZ, NX, NZ, DX, DZ,
  DAM_X, CREST,
  SPILL_CREST_CLOSED, GATE_OPEN_ELEV,
  BREACH_BOTTOM, BLOCK_N, BLOCK_W, BLOCK_Z0,
  GORGE_HALF_W, SRC_X0, SRC_X1,
  bedAt, buildStructBase, applyStructState, buildInitState, terrainColor,
  type BreachSpan,
} from './terrain';
import {
  QUAD_VERT, ETA_FRAG, VEL_FRAG, FOAM_FRAG, SPRAY_FRAG, COPY_FRAG, DOWN_FRAG, SNAP_FRAG,
  WATER_VERT, WATER_FRAG, SPRAY_POINTS_VERT, SPRAY_POINTS_FRAG, TEXEL, CELL,
} from './glsl';
import {
  FlowField, buildDam, buildHouses, buildTrees, buildBarrels, buildDebris,
  buildRoads, buildGaugeStations, buildInfraMarkers, buildDockBoats, buildBoulders,
  RiverAudio, type DamProps, type House, type Tree, type Barrel, type Chunk,
} from './props';
import {
  DAMS, GAUGES, fracToSimLevel, simLevelToFrac,
  type DamId, type DamProfile, type FailureMechanism, type BreachLocation, type RainScenario,
} from '@/lib/damsafe/config';

export type Phase = 'live' | 'scenario' | 'scrub';
export type CamPreset = 'overview' | 'dam' | 'valley' | 'top' | 'reservoir' | 'impact';
export type LayerMode = 0 | 1 | 2 | 3; // natural | depth | velocity | arrival

export interface ScenarioParams {
  levelFrac: number;
  mechanism: FailureMechanism;
  breachWidthM: number;
  formationMin: number;
  location: BreachLocation;
  rain: RainScenario;
}

export interface GaugeStat {
  id: string;
  label: string;
  q: number; // demo m³/s
  qPeak: number;
  depth: number; // m
  vel: number; // m/s
  froude: number; // downstream Froude number at gauge
  arrivalMin: number | null; // real minutes
  distKm: number;
}

export interface DamStats {
  t: number; // demo sim seconds
  realMin: number; // scenario real minutes
  level: number; // demo sim m
  levelFrac: number;
  riseMPerHr: number; // real metres/hour (scaled)
  vmax: number;
  froude: number;
  fps: number;
  phase: Phase;
  scenarioActive: boolean;
  breach01: number;
  progress01: number;
  stage: number; // 0 idle, 1 preparing, 2 reservoir, 3 breach, 4 flood, 5 processing
  gauges: GaugeStat[];
  floodedCells: number;
  qOut: number; // demo m³/s through breach+gates (G1)
}

const DT_MAX = 0.008;
const MANNING = 0.028;
const SPRAY_N = 128;
const DOWN_W = 48;
const DOWN_H = 28;
const SNAP_W = 192;
const SNAP_H = 112;
const SNAP_MAX = 42;
const SNAP_EVERY = 2.5; // demo s

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface Floater {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  home: THREE.Vector3;
}

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
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  // ---- GPU sim resources
  private rtStateA!: THREE.WebGLRenderTarget;
  private rtStateB!: THREE.WebGLRenderTarget;
  private rtEta!: THREE.WebGLRenderTarget;
  private rtFoamA!: THREE.WebGLRenderTarget;
  private rtFoamB!: THREE.WebGLRenderTarget;
  private rtSprayA!: THREE.WebGLRenderTarget;
  private rtSprayB!: THREE.WebGLRenderTarget;
  private rtDown!: THREE.WebGLRenderTarget;
  private rtSnap!: THREE.WebGLRenderTarget;
  private texBed!: THREE.DataTexture;
  private texStruct!: THREE.DataTexture;
  private texInit!: THREE.DataTexture;
  private texSprayInit!: THREE.DataTexture;
  private texBlack!: THREE.DataTexture;
  private texArr!: THREE.DataTexture;

  private etaPass!: FullScreenQuad;
  private velPass!: FullScreenQuad;
  private foamPass!: FullScreenQuad;
  private sprayPass!: FullScreenQuad;
  private copyPass!: FullScreenQuad;
  private downPass!: FullScreenQuad;
  private snapPass!: FullScreenQuad;

  private structArr!: Float32Array;
  private structBase!: Float32Array;
  private bedGrid!: Float32Array;

  // ---- scene objects
  private waterMat!: THREE.ShaderMaterial;
  private sprayMat!: THREE.ShaderMaterial;
  private dam!: DamProps;
  private houses: House[] = [];
  private trees: Tree[] = [];
  private barrels: Barrel[] = [];
  private chunks: Chunk[] = [];
  private floaters: Floater[] = [];
  private evacLine: THREE.Line | null = null;
  private audio = new RiverAudio();
  private sunDir = new THREE.Vector3(-0.42, 0.62, 0.28).normalize();
  // weather / storm system
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private skyU!: Record<string, THREE.IUniform>;
  private rainMesh!: THREE.LineSegments;
  private rainPos!: Float32Array;
  private rainVis = 0;
  private rainHeavy = false;
  private boltTimer = 9;
  private flash = 0;
  private fogDay = new THREE.Color(0xc6d8ea);
  private fogStorm = new THREE.Color(0x76838f);

  // ---- state
  private curState: THREE.WebGLRenderTarget;
  private nextState: THREE.WebGLRenderTarget;
  private curFoam!: THREE.WebGLRenderTarget;
  private nextFoam!: THREE.WebGLRenderTarget;
  private curSpray!: THREE.WebGLRenderTarget;
  private nextSpray!: THREE.WebGLRenderTarget;

  // ---- config
  private damProfile: DamProfile = DAMS.idukki;
  private liveFrac = 0.84;

  simTime = 0;
  private phase: Phase = 'live';
  // scenario state
  private scenario: ScenarioParams | null = null;
  private scenT = 0;
  private breachT: number | null = null;
  private breachTau = 15;
  private breachPre = 0; // piping pre-depth
  private breachSpan: BreachSpan | null = null;
  private breachDepth01 = 0;
  private breachInverts: number[] = [];
  private breachDelays: number[] = []; // staggered per-block failure (demo s)
  private gateT: number | null = null;
  private gateElev: number | null = null;
  private overtopT = 0;
  private structDirty = true;
  private shake = 0;
  private paused = false;
  private scrubbing = false;

  // params
  private timeScale = 1;
  private prevTimeScale = 1;
  private gravity = 9.81;
  private baseInflow = 8;
  private rainInflow = 0;
  private breachRate = 1;
  private foamOn = true;
  private sprayOn = true;
  private showSpeed = false;
  private layerMode: LayerMode = 0;
  private cinematic = false;
  private cinAngle = 0;

  // stats / readback
  private field = new FlowField();
  private readBuf = new Float32Array(DOWN_W * DOWN_H * 4);
  private arr = new Float32Array(DOWN_W * DOWN_H); // first-flood demo seconds (0 = dry)
  private arrDirty = true;
  private qPeak = 0;
  private frame = 0;
  private fpsEma = 60;
  private stripCells = 1;
  private srcRate = 0;
  private sample = { eta: 0, u: 0, v: 0 };
  private gaugePeaks = [0, 0, 0, 0];
  private gaugeArr: (number | null)[] = [null, null, null, null];
  private lastLevel = 0;
  private lastStatSimT = 0;
  private levelRise = 0; // demo m/s (ema)

  // timeline snapshots
  private snaps: { t: number; data: Float32Array }[] = [];
  private snapClock = 0;
  private snapReadBuf = new Float32Array(SNAP_W * SNAP_H * 4);

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
    this.renderer.toneMappingExposure = 0.85;
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
    this.skyU = su as unknown as Record<string, THREE.IUniform>;
    su.turbidity.value = 5.5;
    su.rayleigh.value = 2.4;
    su.mieCoefficient.value = 0.006;
    su.mieDirectionalG.value = 0.85;
    su.sunPosition.value.copy(this.sunDir);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(skyScene).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();
    this.scene.add(sky);

    // lights
    const sun = new THREE.DirectionalLight(0xffe8c8, 2.1);
    this.sunLight = sun;
    sun.position.copy(this.sunDir).multiplyScalar(420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 100; sc.far = 950;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.target.position.set(105, 10, 0);
    this.scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0xbfd8ef, 0x6b6354, 0.45);
    this.hemiLight = hemi;
    this.scene.add(hemi);

    this.buildTerrainMesh();
    this.buildGpuResources();
    this.buildWater();
    this.buildProps();
    this.buildRain();

    this.curState = this.rtStateA;
    this.nextState = this.rtStateB;
    this.curFoam = this.rtFoamA;
    this.nextFoam = this.rtFoamB;
    this.curSpray = this.rtSprayA;
    this.nextSpray = this.rtSprayB;
    this.resetSim();

    // post-processing: subtle bloom for sun glints & foam highlights
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.5, 0.3, 3.5,
    );
    this.bloomPass.enabled = false; // opt-in "HD glow" (HDR skies bloom easily)
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

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
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.22 }),
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
    this.rtSnap = this.mkRT(SNAP_W, SNAP_H, floatLinear ? THREE.LinearFilter : THREE.NearestFilter);

    this.structBase = buildStructBase();
    this.structArr = new Float32Array(this.structBase);
    this.texBed = new THREE.DataTexture(this.bedGrid, NX, NZ, THREE.RedFormat, THREE.FloatType);
    this.texBed.minFilter = this.texBed.magFilter = THREE.NearestFilter;
    this.texBed.needsUpdate = true;
    this.texStruct = new THREE.DataTexture(this.structArr, NX, NZ, THREE.RedFormat, THREE.FloatType);
    this.texStruct.minFilter = this.texStruct.magFilter = THREE.NearestFilter;
    this.texStruct.needsUpdate = true;
    this.texInit = new THREE.DataTexture(buildInitState(fracToSimLevel(this.liveFrac)), NX, NZ, THREE.RGBAFormat, THREE.FloatType);
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

    this.texArr = new THREE.DataTexture(this.arr, DOWN_W, DOWN_H, THREE.RedFormat, THREE.FloatType);
    this.texArr.minFilter = this.texArr.magFilter = foamFilter;
    this.texArr.needsUpdate = true;

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
      uSrcBox: { value: new THREE.Vector4(SRC_X0 / LX, SRC_X1 / LX, (-GORGE_HALF_W + LZ / 2) / LZ, (GORGE_HALF_W + LZ / 2) / LZ) },
      uDriveOn: { value: 1 },
      uDriveEta: { value: fracToSimLevel(this.liveFrac) },
      uDriveRate: { value: 1.2 },
      uDomain: { value: new THREE.Vector2(LX, LZ) },
      uResMaxX: { value: DAM_X - 0.4 },
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
      uSpawnSpeed: { value: 2.6 },
      uDomain: { value: new THREE.Vector2(LX, LZ) },
    }));
    this.copyPass = new FullScreenQuad(mat(COPY_FRAG, { uInit: { value: null } }));
    this.downPass = new FullScreenQuad(mat(DOWN_FRAG, { uState: { value: null } }));
    this.snapPass = new FullScreenQuad(mat(SNAP_FRAG, {
      uState: { value: null },
      uTexel: { value: new THREE.Vector2(TEXEL[0], TEXEL[1]) },
    }));

    // count inflow strip cells (gorge inlet)
    let n = 0;
    for (let j = 0; j < NZ; j++) {
      const z = (j + 0.5) * DZ - LZ / 2;
      if (Math.abs(z) > GORGE_HALF_W) continue;
      for (let i = Math.ceil(SRC_X0 / DX); i < Math.floor(SRC_X1 / DX); i++)
        if (this.bedGrid[j * NX + i] < 14.5) n++;
    }
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
        uArrTex: { value: this.texArr },
        uTexel: { value: new THREE.Vector2(TEXEL[0], TEXEL[1]) },
        uCell: { value: new THREE.Vector2(CELL[0], CELL[1]) },
        uDomain: { value: new THREE.Vector2(LX, LZ) },
        uDownGrid: { value: new THREE.Vector2(DOWN_W, DOWN_H) },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Vector3(1.0, 0.92, 0.8) },
        uCamPos: { value: new THREE.Vector3() },
        uShowSpeed: { value: 0 },
        uLayerMode: { value: 0 },
        uTime: { value: 0 },
        uRain: { value: 0 },
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
    const r = buildRoads();
    this.scene.add(r.group);
    const g = buildGaugeStations();
    this.scene.add(g.group);
    const m = buildInfraMarkers();
    this.scene.add(m.group);
    const bo = buildBoulders();
    this.scene.add(bo.group);
    const dock = buildDockBoats();
    this.scene.add(dock.group);
    for (const br of this.barrels) {
      this.floaters.push({ mesh: br.mesh, pos: br.pos, vel: br.vel, home: br.mesh.position.clone() });
    }
    for (const bt of dock.boats) {
      this.floaters.push({
        mesh: bt.mesh,
        pos: bt.mesh.position.clone(),
        vel: new THREE.Vector3(),
        home: bt.mesh.position.clone(),
      });
    }
  }

  // ==================================================================== rain
  private buildRain(): void {
    const N = 1100;
    this.rainPos = new Float32Array(N * 6);
    const p = this.rainPos;
    for (let i = 0; i < N; i++) {
      const x = -30 + Math.random() * (LX + 110);
      const y = Math.random() * 82;
      const z = -LZ / 2 - 40 + Math.random() * (LZ + 80);
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + 0.26; p[i * 6 + 4] = y + 1.5; p[i * 6 + 5] = z + 0.09;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xaaccee, transparent: true, opacity: 0, depthWrite: false });
    this.rainMesh = new THREE.LineSegments(geo, mat);
    this.rainMesh.visible = false;
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 9;
    this.scene.add(this.rainMesh);
  }

  // per-frame storm driver: rain streaks, darkened sky/fog, lightning flashes
  private updateWeather(dtReal: number): void {
    const target = this.rainInflow > 0 ? (this.rainHeavy ? 1 : 0.55) : 0;
    this.rainVis += (target - this.rainVis) * Math.min(1, dtReal * 1.4);
    const rv = this.rainVis;

    if (this.rainMesh) {
      this.rainMesh.visible = rv > 0.02;
      if (rv > 0.02) {
        const p = this.rainPos;
        const n = p.length / 6;
        const fall = 46 * dtReal;
        const drift = 8 * dtReal;
        for (let i = 0; i < n; i++) {
          const k = i * 6;
          p[k] += drift; p[k + 1] -= fall; p[k + 2] += drift * 0.35;
          p[k + 3] = p[k] + 0.26; p[k + 4] = p[k + 1] + 1.5; p[k + 5] = p[k + 2] + 0.09;
          if (p[k + 1] < 2.5) {
            const x = -30 + Math.random() * (LX + 110);
            const y = 48 + Math.random() * 34;
            const z = -LZ / 2 - 40 + Math.random() * (LZ + 80);
            p[k] = x; p[k + 1] = y; p[k + 2] = z;
            p[k + 3] = x + 0.26; p[k + 4] = y + 1.5; p[k + 5] = z + 0.09;
          }
        }
        (this.rainMesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.rainMesh.material as THREE.LineBasicMaterial).opacity = 0.38 * rv;
      }
    }

    // occasional lightning during heavy rain
    this.flash *= Math.exp(-dtReal * 6.5);
    if (rv > 0.6) {
      this.boltTimer -= dtReal;
      if (this.boltTimer <= 0) {
        this.boltTimer = 5 + Math.random() * 10;
        this.flash = 0.7 + Math.random() * 0.5;
      }
    }

    // dim / storm the atmosphere
    this.sunLight.intensity = 2.1 * (1 - 0.7 * rv) + this.flash * 5.5;
    this.sunLight.color.setHex(this.flash > 0.25 ? 0xdfe8ff : 0xffe8c8);
    this.hemiLight.intensity = 0.45 * (1 - 0.4 * rv) + this.flash * 1.2;
    this.scene.environmentIntensity = 0.32 * (1 - 0.5 * rv);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.fogDay).lerp(this.fogStorm, rv * 0.85);
    fog.near = 380 - 200 * rv;
    fog.far = 1600 - 700 * rv;
    this.renderer.toneMappingExposure = 0.85 - 0.13 * rv + this.flash * 0.12;
    const su = this.skyU;
    if (su) {
      su.turbidity.value = 5.5 + 4.5 * rv;
      su.rayleigh.value = Math.max(2.4 - 1.7 * rv, 0.3);
      su.mieCoefficient.value = 0.006 + 0.02 * rv;
    }

    // water shader: choppier ripples + storm fog match
    const wu = this.waterMat.uniforms;
    wu.uRain.value = rv;
    (wu.uFogColor.value as THREE.Color).copy(fog.color);
    wu.uFogNear.value = fog.near;
    wu.uFogFar.value = fog.far;
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
    this.snaps = [];
    this.arr.fill(0);
    this.arrDirty = true;
    this.gaugePeaks = [0, 0, 0, 0];
    this.gaugeArr = [null, null, null, null];
    this.applyStruct(null, null);
  }

  // ================================================================ scenarios
  private applyStruct(breach: BreachSpan | null, gate: number | null): void {
    applyStructState(this.structArr, this.structBase, breach, gate);
    this.texStruct.needsUpdate = true;
  }

  private breachSpanFor(widthM: number, loc: BreachLocation): BreachSpan {
    const count = clamp(Math.round(widthM / 32), 1, BLOCK_N);
    const start = loc === 'left' ? 0 : loc === 'right' ? BLOCK_N - count : Math.floor((BLOCK_N - count) / 2);
    return { start, count, depth01: 0 };
  }

  private blockInvert(zMid: number): number {
    const b = bedAt(DAM_X + 1.5, zMid);
    return clamp(b + 0.4, BREACH_BOTTOM - 1.2, BREACH_BOTTOM + 1.4);
  }

  // wire up a failing block span: invert elevations + staggered failure delays
  private initBreach(span: BreachSpan): void {
    this.breachSpan = span;
    this.breachInverts = [];
    for (let b = span.start; b < span.start + span.count; b++) {
      const z0 = BLOCK_Z0 + b * BLOCK_W;
      this.breachInverts.push(this.blockInvert(z0 + BLOCK_W / 2));
    }
    this.breachDelays = [];
    for (let k = 0; k < span.count; k++) {
      this.breachDelays.push(Math.random() * this.breachTau * 0.3);
    }
  }

  runScenario(p: ScenarioParams): void {
    if (this.scenario) return;
    this.scenario = p;
    this.phase = 'scenario';
    this.scenT = 0;
    this.snapClock = 0;
    this.overtopT = 0;
    this.rainInflow = p.rain === 'none' ? 0 : p.rain === 'moderate' ? 26 : 64;
    this.rainHeavy = p.rain === 'heavy';
    this.breachSpan = null;
    this.breachT = null;
    this.breachDepth01 = 0;
    this.structDirty = true;

    // reservoir set to the scenario level (drive takes it there quickly)
    const target = clamp(fracToSimLevel(p.levelFrac), 0, 24.4);
    const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
    eu.uDriveEta.value = target;
    eu.uDriveOn.value = 1;

    if (p.mechanism === 'overtopping') {
      // surge inflow pushes the lake above the crest; erosion follows
      eu.uDriveEta.value = Math.max(target, CREST + 1.0);
    } else {
      // schedule breach after the reservoir reaches level (~2-6 demo s)
      this.breachT = -clamp((target - this.lastLevel) / 1.4, 1.5, 5);
      this.breachTau = Math.max(p.formationMin / this.damProfile.timeMinPerSec, 4) / (p.mechanism === 'piping' ? 0.65 : 1) / this.breachRate;
      this.breachPre = p.mechanism === 'piping' ? 0.22 : 0;
      this.initBreach(this.breachSpanFor(p.breachWidthM, p.location));
    }
    this.audio.burst(0.2);
  }

  private triggerBreachErosion(): void {
    if (this.breachT === null || this.breachT >= 0) return;
    this.breachT = 0;
    this.shake = 1;
    this.audio.burst(1);
    this.spawnDebris();
  }

  openGates(): void {
    if (this.gateT !== null) return;
    this.gateT = 0;
    this.audio.burst(0.35);
  }

  reset(): void {
    this.phase = 'live';
    this.scenario = null;
    this.scenT = 0;
    this.breachT = null;
    this.breachTau = 15;
    this.breachPre = 0;
    this.breachSpan = null;
    this.breachDepth01 = 0;
    this.breachInverts = [];
    this.breachDelays = [];
    this.gateT = null;
    this.gateElev = null;
    this.overtopT = 0;
    this.shake = 0;
    this.scrubbing = false;
    this.paused = false;
    this.rainInflow = 0;
    this.breachRate = 1;
    for (const blk of this.dam.breachBlocks) {
      blk.group.position.y = 0;
      blk.group.rotation.set(0, 0, 0);
      blk.group.visible = true;
    }
    for (const g of this.dam.gates) g.position.y = 18.85;
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
    }
    for (const f of this.floaters) {
      f.pos.copy(f.home);
      f.vel.set(0, 0, 0);
      f.mesh.position.copy(f.home);
    }
    if (this.evacLine) {
      this.scene.remove(this.evacLine);
      this.evacLine.geometry.dispose();
      this.evacLine = null;
    }
    const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
    eu.uDriveEta.value = fracToSimLevel(this.liveFrac);
    eu.uDriveOn.value = 1;
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

    if (dtSim > 0 && !this.scrubbing) {
      this.stepScenario(dtSim);

      const curInflow = this.baseInflow + this.rainInflow;
      this.srcRate = curInflow / (this.stripCells * DX * DZ);

      if (this.structDirty) {
        this.applyStruct(this.breachSpan, this.gateElev);
        this.structDirty = false;
      }

      const sub = clamp(Math.ceil(dtSim / DT_MAX), 1, 14);
      const h = dtSim / sub;
      for (let i = 0; i < sub; i++) this.simSubstep(h);
      this.simTime += dtSim;
      this.updateProps(dtSim);

      // snapshots during a scenario for the time machine
      if (this.scenario) {
        this.snapClock += dtSim;
        if (this.snapClock >= SNAP_EVERY) {
          this.snapClock = 0;
          this.recordSnapshot();
        }
      }
    }

    // readback for CPU physics + stats
    if (this.frame % 2 === 0) {
      (this.downPass.material as THREE.ShaderMaterial).uniforms.uState.value = this.curState.texture;
      this.renderTo(this.downPass, this.rtDown);
      this.renderer.readRenderTargetPixels(this.rtDown, 0, 0, DOWN_W, DOWN_H, this.field.data);
      this.updateArrival();
    }

    this.updateCamera(dtReal);
    this.updateWeather(dtReal);
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
    this.composer.render();
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

  // ------------------------------------------------ scenario + gate animation
  private stepScenario(dt: number): void {
    const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
    const sc = this.scenario;

    if (this.gateT !== null && this.gateT < 1) {
      this.gateT = Math.min(1, this.gateT + dt / 2.5);
      const e = easeInOut(this.gateT);
      this.gateElev = SPILL_CREST_CLOSED + (GATE_OPEN_ELEV - SPILL_CREST_CLOSED) * e;
      for (const g of this.dam.gates) g.position.y = 18.85 + 6.9 * e;
      this.structDirty = true;
    }

    if (!sc) {
      // live monitoring: drive toward the user level target
      eu.uDriveOn.value = 1;
      return;
    }

    this.scenT += dt;

    if (sc.mechanism === 'overtopping') {
      this.overtopT += dt;
      // once overtopped for long enough, crest erosion begins
      if (this.overtopT > 7 && (this.breachT === null || this.breachT < 0)) {
        if (this.breachSpan === null) {
          this.breachTau = Math.max(sc.formationMin / this.damProfile.timeMinPerSec, 4) / this.breachRate;
          this.breachPre = 0;
          this.initBreach(this.breachSpanFor(sc.breachWidthM, sc.location));
        }
        this.triggerBreachErosion();
      }
    }

    // breach formation — each monolith block fails on a staggered delay, and the
    // simulated structure field descends per block with the SAME curve as the
    // visuals, so water always pours exactly through the visibly-open gap.
    if (this.breachT !== null && this.breachSpan) {
      this.breachT += dt;
      if (this.breachT > 0) {
        const tau = this.breachTau;
        const depths: number[] = [];
        let minP = 1;
        let maxD = 0;
        for (let k = 0; k < this.breachSpan.count; k++) {
          const tt = Math.max(this.breachT - (this.breachDelays[k] ?? 0), 0);
          const pk = 1 - Math.exp(-Math.pow(tt / tau, 1.7));
          const d = clamp(this.breachPre + (1 - this.breachPre) * pk, 0, 1);
          depths.push(d);
          if (d < minP) minP = d;
          if (d > maxD) maxD = d;
        }
        this.breachDepth01 = maxD;
        this.breachSpan.depth01 = maxD;
        this.breachSpan.depths = depths;
        this.structDirty = true;
        // sink the failing blocks with the SAME per-block curve as the struct field
        const bi = this.breachInverts;
        for (let k = 0; k < this.breachSpan.count; k++) {
          const blockIdx = this.breachSpan.start + k;
          const blk = this.dam.breachBlocks[blockIdx];
          if (!blk) continue;
          const d = depths[k];
          const drop = (CREST - bi[k]) * d;
          blk.group.position.y = -drop;
          blk.group.rotation.z = -0.06 * d;
          blk.group.rotation.x = (blockIdx % 2 === 0 ? 1 : -1) * 0.016 * d;
          blk.group.rotation.y = (blockIdx % 2 === 0 ? -1 : 1) * 0.012 * d;
        }
        if (minP > 0.995 && this.breachT > tau) {
          this.breachT = null; // formation complete; struct stays at full depth
        }
      }
      // stop the level drive once the breach starts draining the lake
      if (this.breachDepth01 > 0.02 && sc.mechanism !== 'overtopping') {
        eu.uDriveOn.value = 0;
      }
    }
  }

  // -------------------------------------------------------------- arrival map
  private updateArrival(): void {
    const d = this.field.data;
    let changed = false;
    // track only downstream of the dam (the reservoir is not "flood")
    const firstCol = Math.ceil((DAM_X + 2) / (LX / DOWN_W));
    for (let j = 0; j < DOWN_H; j++) {
      for (let i = firstCol; i < DOWN_W; i++) {
        const idx = j * DOWN_W + i;
        if (this.arr[idx] === 0 && d[idx * 4 + 3] > 0.2) {
          this.arr[idx] = this.simTime;
          changed = true;
        }
      }
    }
    if (changed) {
      this.arrDirty = true;
      // upload scaled to real seconds (arrivalRamp normalizes over 240 min)
      const scale = this.damProfile.timeMinPerSec * 60;
      const up = new Float32Array(DOWN_W * DOWN_H);
      for (let i = 0; i < up.length; i++) up[i] = this.arr[i] * scale;
      this.texArr.image.data = up;
      this.texArr.needsUpdate = true;
    }
  }

  // -------------------------------------------------------------- snapshots
  private recordSnapshot(): void {
    (this.snapPass.material as THREE.ShaderMaterial).uniforms.uState.value = this.curState.texture;
    this.renderTo(this.snapPass, this.rtSnap);
    this.renderer.readRenderTargetPixels(this.rtSnap, 0, 0, SNAP_W, SNAP_H, this.snapReadBuf);
    const copy = new Float32Array(this.snapReadBuf);
    this.snaps.push({ t: this.simTime, data: copy });
    if (this.snaps.length > SNAP_MAX) this.snaps.shift();
  }

  get snapCount(): number {
    return this.snaps.length;
  }

  get snapTimes(): number[] {
    return this.snaps.map((s) => s.t);
  }

  get isScrubbing(): boolean {
    return this.scrubbing;
  }

  scrubTo(idx: number): boolean {
    if (idx < 0 || idx >= this.snaps.length) return false;
    const snap = this.snaps[idx];
    // upload snapshot as a texture and restore into both state RTs + eta
    const tex = new THREE.DataTexture(snap.data, SNAP_W, SNAP_H, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const cu = (this.copyPass.material as THREE.ShaderMaterial).uniforms;
    cu.uInit.value = tex;
    this.renderTo(this.copyPass, this.rtStateA);
    this.renderTo(this.copyPass, this.rtStateB);
    this.renderTo(this.copyPass, this.rtEta);
    tex.dispose();
    this.simTime = snap.t;
    this.scrubbing = true;
    this.waterMat.uniforms.uState.value = this.curState.texture;
    return true;
  }

  exitScrub(): void {
    this.scrubbing = false;
    this.paused = false;
  }

  // ================================================================ props update
  private updateProps(dt: number): void {
    const f = this.field;
    const s = this.sample;

    for (const fl of this.floaters) {
      f.sample(fl.pos.x, fl.pos.z, s);
      const bed = bedAt(fl.pos.x, fl.pos.z);
      const dep = s.eta - bed;
      const isBoat = !((fl.mesh as THREE.Mesh).isMesh); // boats are Groups, barrels are Meshes
      if (dep > 0.35) {
        const bob = Math.sin(this.simTime * 1.7 + fl.pos.x) * 0.06;
        fl.pos.y += (s.eta + 0.15 + bob - fl.pos.y) * Math.min(1, dt * 5);
        const follow = isBoat ? 0.0 : 0.92; // moored boats only bob, don't drift
        fl.vel.x += (s.u * follow - fl.vel.x) * Math.min(1, dt * 2.2);
        fl.vel.z += (s.v * follow - fl.vel.z) * Math.min(1, dt * 2.2);
        fl.pos.x += fl.vel.x * dt;
        fl.pos.z += fl.vel.z * dt;
      } else {
        fl.vel.multiplyScalar(1 - Math.min(1, dt * 2.5));
        fl.pos.y += (bed + 0.3 - fl.pos.y) * Math.min(1, dt * 4);
      }
      fl.pos.x = clamp(fl.pos.x, 1, LX - 1);
      fl.pos.z = clamp(fl.pos.z, -LZ / 2 + 1, LZ / 2 - 1);
      const spd = Math.sqrt(fl.vel.x * fl.vel.x + fl.vel.z * fl.vel.z);
      fl.mesh.position.copy(fl.pos);
      fl.mesh.rotation.x = clamp(fl.vel.z * 0.1, -0.5, 0.5) + Math.sin(this.simTime * 2.1 + fl.pos.z) * 0.04;
      fl.mesh.rotation.z = clamp(-fl.vel.x * 0.1, -0.5, 0.5);
      if (!isBoat) fl.mesh.rotation.y += (0.2 + spd * 0.3) * dt;
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

    // keep the algal stain band near the waterline
    this.dam.stainBand.position.y = this.lastLevel - 0.6;
  }

  // ================================================================ stats
  private computeStats(): DamStats {
    const d = this.field.data;
    const dzC = LZ / DOWN_H;
    const gauges: GaugeStat[] = [];
    let vmax = 0;
    let level = 0;
    let floodedCells = 0;
    for (let i = 0; i < DOWN_W * DOWN_H; i++) {
      const k = i * 4;
      const sp = Math.sqrt(d[k + 1] * d[k + 1] + d[k + 2] * d[k + 2]);
      vmax = Math.max(vmax, sp);
      const col = i % DOWN_W;
      // reservoir pool level: deepest wet cells (depth > 0.5 m) so shelf puddles
      // cannot distort the stage reading
      if (col < 26 && d[k + 3] > 0.5) level = Math.max(level, d[k]);
      if (d[k + 3] > 0.12) floodedCells++;
    }
    // gauges
    for (let gi = 0; gi < GAUGES.length; gi++) {
      const g = GAUGES[gi];
      const gx = clamp(Math.round((g.x / LX) * DOWN_W), 1, DOWN_W - 2);
      let q = 0;
      let stage = 0;
      let gv = 0;
      let froude = 0;
      for (let j = 0; j < DOWN_H; j++) {
        const k = (j * DOWN_W + gx) * 4;
        const h = Math.max(d[k + 3], 0);
        const u = d[k + 1];
        const v = d[k + 2];
        q += u * h * dzC;
        stage = Math.max(stage, h);
        gv = Math.max(gv, Math.sqrt(u * u + v * v));
        if (h > 0.05) froude = Math.max(froude, Math.abs(u) / Math.sqrt(this.gravity * h));
      }
      q = Math.max(q, 0);
      if (q > this.gaugePeaks[gi]) this.gaugePeaks[gi] = q;
      if (this.gaugeArr[gi] === null && stage > 0.2 && g.x > DAM_X) this.gaugeArr[gi] = this.simTime;
      gauges.push({
        id: g.id,
        label: g.label,
        q,
        qPeak: this.gaugePeaks[gi],
        depth: stage,
        vel: gv,
        froude,
        arrivalMin: this.gaugeArr[gi] !== null ? this.gaugeArr[gi]! * this.damProfile.timeMinPerSec : null,
        distKm: (g.x - DAM_X) * this.damProfile.lenScale / 1000,
      });
    }
    const frG = gauges[0] ? gauges[0].q : 0;
    if (frG > this.qPeak) this.qPeak = frG;

    // level rate of rise (demo m/s, ema over stats ticks)
    const dtSimS = this.simTime - this.lastStatSimT;
    const riseMs = dtSimS > 0.05 && this.lastStatSimT > 0
      ? Math.max((level - this.lastLevel) / dtSimS, -2)
      : 0;
    this.levelRise = this.levelRise * 0.7 + riseMs * 0.3;
    this.lastStatSimT = this.simTime;
    this.lastLevel = level;

    // scenario progress + stage
    let progress01 = 0;
    let stage = 0;
    if (this.scenario) {
      const tau = this.breachTau || 15;
      const breachDone = this.breachDepth01;
      const floodT = clamp((this.scenT - tau) / 55, 0, 1);
      progress01 = clamp(0.12 * clamp(this.scenT / 4, 0, 1) + 0.38 * breachDone + 0.42 * floodT + 0.08 * clamp(floodT * 1.2, 0, 1), 0, 1);
      stage = this.scenT < 2 ? 1 : breachDone <= 0 ? 2 : breachDone < 0.98 ? 3 : floodT < 1 ? 4 : 5;
    }

    return {
      t: this.simTime,
      realMin: this.simTime * this.damProfile.timeMinPerSec,
      level,
      levelFrac: simLevelToFrac(level),
      riseMPerHr: this.levelRise * (60 / this.damProfile.timeMinPerSec),
      vmax,
      froude: gauges[0]?.froude ?? 0,
      fps: this.fpsEma,
      phase: this.scrubbing ? 'scrub' : this.scenario ? 'scenario' : 'live',
      scenarioActive: !!this.scenario,
      breach01: this.breachDepth01,
      progress01,
      stage,
      gauges,
      floodedCells,
      qOut: gauges[0]?.q ?? 0,
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
      reservoir: [new THREE.Vector3(74, 34, 44), new THREE.Vector3(20, 14, 0)],
      impact: [new THREE.Vector3(168, 105, 96), new THREE.Vector3(148, 2, 0)],
    };
    const [pos, tgt] = P[preset];
    this.tweenFrom.copy(this.camera.position);
    this.tweenFromT.copy(this.controls.target);
    this.tweenTo.copy(pos);
    this.tweenToT.copy(tgt);
    this.tweenT = 0;
  }

  focusOn(x: number, z: number, dist = 26): void {
    const ground = bedAt(x, z);
    this.tweenFrom.copy(this.camera.position);
    this.tweenFromT.copy(this.controls.target);
    this.tweenTo.set(x - dist * 0.55, ground + dist * 0.42, z + dist * 0.75);
    this.tweenToT.set(x, ground + 2, z);
    this.tweenT = 0;
  }

  // ================================================================ evac route
  drawEvacRoute(pts: [number, number][]): void {
    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map(([x, z]) => new THREE.Vector3(x, bedAt(x, z) + 1.6, z)),
    );
    if (this.evacLine) {
      this.scene.remove(this.evacLine);
      this.evacLine.geometry.dispose();
    }
    const mat = new THREE.LineDashedMaterial({
      color: 0x34e0a1,
      dashSize: 2.2,
      gapSize: 1.4,
      linewidth: 2,
    });
    this.evacLine = new THREE.Line(geo, mat);
    this.evacLine.computeLineDistances();
    this.scene.add(this.evacLine);
  }

  clearEvacRoute(): void {
    if (this.evacLine) {
      this.scene.remove(this.evacLine);
      this.evacLine.geometry.dispose();
      this.evacLine = null;
    }
  }

  // ================================================================ public API
  get profile(): DamProfile {
    return this.damProfile;
  }

  get scenarioActive(): boolean {
    return !!this.scenario;
  }

  getDownsample(): { data: Float32Array; w: number; h: number; arr: Float32Array } {
    return { data: this.field.data, w: DOWN_W, h: DOWN_H, arr: this.arr };
  }

  setDam(id: DamId, levelFrac: number): void {
    this.damProfile = DAMS[id];
    this.liveFrac = clamp(levelFrac, 0, 1);
    const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
    eu.uDriveEta.value = fracToSimLevel(this.liveFrac);
    eu.uDriveOn.value = 1;
  }

  setLiveLevel(frac: number): void {
    this.liveFrac = clamp(frac, 0, 1);
    if (!this.scenario) {
      const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
      eu.uDriveEta.value = fracToSimLevel(this.liveFrac);
      eu.uDriveOn.value = 1;
    }
  }

  // live-mode storm: inflow surge + reservoir swell + rain visuals. Also works
  // during a scenario, where it simply overrides the scenario rain inflow.
  setRain(r: RainScenario): void {
    this.rainHeavy = r === 'heavy';
    this.rainInflow = r === 'none' ? 0 : r === 'moderate' ? 26 : 64;
    if (!this.scenario) {
      const eu = (this.etaPass.material as THREE.ShaderMaterial).uniforms;
      const boost = this.rainInflow > 0 ? (this.rainHeavy ? 1.25 : 0.45) : 0;
      eu.uDriveEta.value = Math.min(fracToSimLevel(this.liveFrac) + boost, 24.2);
      eu.uDriveOn.value = 1;
    }
  }

  setTimeScale(v: number): void { this.timeScale = v; }
  setPaused(b: boolean): void { this.paused = b; }
  setGravity(g: number): void { this.gravity = g; }
  setBreachRate(v: number): void { this.breachRate = v; }
  setSpeedMap(b: boolean): void {
    this.showSpeed = b;
    this.waterMat.uniforms.uShowSpeed.value = b ? 1 : 0;
  }
  setLayer(m: LayerMode): void {
    this.layerMode = m;
    this.waterMat.uniforms.uLayerMode.value = m;
  }
  setHd(b: boolean): void { this.bloomPass.enabled = b; }
  setInfraVisible(b: boolean): void {
    this.scene.traverse((o) => {
      if (o.userData && (o.userData as { infra?: boolean }).infra) o.visible = b;
    });
  }
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
    this.composer.setSize(w, h);
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
      this.rtSprayA, this.rtSprayB, this.rtDown, this.rtSnap].forEach((rt) => rt.dispose());
    [this.etaPass, this.velPass, this.foamPass, this.sprayPass, this.copyPass, this.downPass, this.snapPass]
      .forEach((q) => q.dispose());
    [this.texBed, this.texStruct, this.texInit, this.texSprayInit, this.texBlack, this.texArr].forEach((t) => t.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
