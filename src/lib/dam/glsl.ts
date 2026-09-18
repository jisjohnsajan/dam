// GLSL shaders for the GPU shallow-water solver, water surface, foam and spray.
// All passes render fullscreen quads; state texture layout = (eta, u, v, h).

import { LX, LZ, NX, NZ, DAM_X, DAM_S, SC } from './terrain';

export const TEXEL: [number, number] = [1 / NX, 1 / NZ];
export const CELL: [number, number] = [LX / NX, LZ / NZ];

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- shared sim lib
const SIM_COMMON = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uState;   // (eta, u, v, h)
uniform sampler2D uBed;     // terrain bed elevation (r)
uniform sampler2D uStruct;  // dam structure elevation (r), -1000 = none
uniform vec2 uTexel;
uniform vec2 uCell;
uniform float uG;

float bedAt(vec2 uv) {
  return max(texture2D(uBed, uv).r, texture2D(uStruct, uv).r);
}

// Hydrostatic reconstruction (Audusse) of the states at a face between A and B.
void faceState(vec2 uvA, vec2 uvB,
               out float hA, out float hB,
               out float uA, out float uB,
               out float vA, out float vB) {
  vec4 A = texture2D(uState, uvA);
  vec4 B = texture2D(uState, uvB);
  float bF = max(bedAt(uvA), bedAt(uvB));
  hA = max(A.x - bF, 0.0);
  hB = max(B.x - bF, 0.0);
  uA = hA > 1e-5 ? A.y : 0.0;
  uB = hB > 1e-5 ? B.y : 0.0;
  vA = hA > 1e-5 ? A.z : 0.0;
  vB = hB > 1e-5 ? B.z : 0.0;
}

// Rusanov (local Lax-Friedrichs) mass flux across a face, un = normal velocity.
float massFlux(float hA, float hB, float unA, float unB) {
  float cA = sqrt(uG * hA);
  float cB = sqrt(uG * hB);
  float s = max(abs(unA) + cA, abs(unB) + cB);
  return 0.5 * (hA * unA + hB * unB) - 0.5 * s * (hB - hA);
}

// Momentum flux for the momentum component normal to the face (includes pressure).
float momFlux(float hA, float hB, float unA, float unB) {
  float cA = sqrt(uG * hA);
  float cB = sqrt(uG * hB);
  float s = max(abs(unA) + cA, abs(unB) + cB);
  float FA = hA * unA * unA + 0.5 * uG * hA * hA;
  float FB = hB * unB * unB + 0.5 * uG * hB * hB;
  return 0.5 * (FA + FB) - 0.5 * s * (hB * unB - hA * unA);
}

// Advective flux transporting tangential momentum q = h*w across the face.
float advFlux(float qA, float qB, float hA, float hB, float unA, float unB) {
  float cA = sqrt(uG * hA);
  float cB = sqrt(uG * hB);
  float s = max(abs(unA) + cA, abs(unB) + cB);
  return 0.5 * (qA * unA + qB * unB) - 0.5 * s * (qB - qA);
}

vec4 sampleBil(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 st = uv / texel - 0.5;
  vec2 base = (floor(st) + 0.5) * texel;
  vec2 f = fract(st);
  vec4 a = texture2D(tex, base);
  vec4 b = texture2D(tex, base + vec2(texel.x, 0.0));
  vec4 c = texture2D(tex, base + vec2(0.0, texel.y));
  vec4 d = texture2D(tex, base + texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

// ------------------------------------------------------------- pass: mass update
export const ETA_FRAG = /* glsl */ `
${SIM_COMMON}
uniform float uDt;
uniform float uSrcRate;     // eta raise rate (m/s) inside source box
uniform vec4 uSrcBox;       // xmin, xmax, vmin, vmax (uv space)
uniform float uDriveOn;     // reservoir level control (live monitoring)
uniform float uDriveEta;    // target level (m)
uniform float uDriveRate;   // m/s
uniform vec2 uDomain;
uniform float uResMaxX;     // drive only applies upstream of the dam

void main() {
  vec2 uvL = vUv - vec2(uTexel.x, 0.0);
  vec2 uvR = vUv + vec2(uTexel.x, 0.0);
  vec2 uvD = vUv - vec2(0.0, uTexel.y);
  vec2 uvU = vUv + vec2(0.0, uTexel.y);
  vec4 C = texture2D(uState, vUv);

  float hA, hB, uA, uB, vA, vB;
  faceState(uvL, vUv, hA, hB, uA, uB, vA, vB);
  float F_l = massFlux(hA, hB, uA, uB);
  faceState(vUv, uvR, hA, hB, uA, uB, vA, vB);
  float F_r = massFlux(hA, hB, uA, uB);
  faceState(uvD, vUv, hA, hB, uA, uB, vA, vB);
  float F_d = massFlux(hA, hB, vA, vB);
  faceState(vUv, uvU, hA, hB, uA, uB, vA, vB);
  float F_u = massFlux(hA, hB, vA, vB);

  float eta = C.x - uDt * ((F_r - F_l) / uCell.x + (F_u - F_d) / uCell.y);

  // river inflow strip (visible gorge inlet at the upstream end)
  if (vUv.x > uSrcBox.x && vUv.x < uSrcBox.y && vUv.y > uSrcBox.z && vUv.y < uSrcBox.w) {
    eta += uSrcRate * uDt;
  }

  // reservoir level control — smoothly drives the lake toward the slider target.
  // Lowering applies everywhere (drains shelf cells); raising only where the bed
  // is below the target so dry land above the target level never floods.
  // REGION TEST (rotated frame, see terrain.ts): "upstream of the dam" means
  // s = (x + z2)·cos45° < DAM_S. The legacy straight-line test wx < uResMaxX
  // cannot work on the diagonal corner map — west of x≈40 also contains a
  // wedge of the DOWNSTREAM valley at the toe, which the drive would flood to
  // lake level at rest. Purely a geometric binding fix; the drive body below
  // is unchanged.
  if (uDriveOn > 0.5) {
    float sRot = (vUv.x * uDomain.x + vUv.y * uDomain.y) * ${SC};
    if (sRot < ${DAM_S - 0.6}) {
      float d = uDriveEta - eta;
      if (d < 0.0) {
        eta += clamp(d, -uDriveRate * uDt, uDriveRate * uDt);
      } else {
        float b = bedAt(vUv);
        if (b < uDriveEta - 0.05) {
          eta += clamp(d, -uDriveRate * uDt, uDriveRate * uDt);
        }
      }
    }
  }

  // safety clamps (max 1 m change per substep, hard ceiling)
  eta = clamp(eta, C.x - 1.0, C.x + 1.0);
  eta = min(eta, 60.0);

  gl_FragColor = vec4(eta, C.y, C.z, 0.0);
}
`;

// --------------------------------------------------------- pass: momentum update
export const VEL_FRAG = /* glsl */ `
${SIM_COMMON}
uniform sampler2D uEtaNew;  // result of the mass pass (x component)
uniform float uDt;
uniform float uManning;

void main() {
  vec2 uvL = vUv - vec2(uTexel.x, 0.0);
  vec2 uvR = vUv + vec2(uTexel.x, 0.0);
  vec2 uvD = vUv - vec2(0.0, uTexel.y);
  vec2 uvU = vUv + vec2(0.0, uTexel.y);
  vec4 C = texture2D(uState, vUv);
  float etaN = texture2D(uEtaNew, vUv).x;
  float bC = bedAt(vUv);
  float hOld = max(C.x - bC, 0.0);
  float hC = max(etaN - bC, 0.0);

  float hA, hB, uA, uB, vA, vB;
  // left face (L -> C): C is the B side
  faceState(uvL, vUv, hA, hB, uA, uB, vA, vB);
  float G_l = momFlux(hA, hB, uA, uB);
  float Kv_l = advFlux(hA * vA, hB * vB, hA, hB, uA, uB);
  float hC_l = hB;
  // right face (C -> R): C is the A side
  faceState(vUv, uvR, hA, hB, uA, uB, vA, vB);
  float G_r = momFlux(hA, hB, uA, uB);
  float Kv_r = advFlux(hA * vA, hB * vB, hA, hB, uA, uB);
  float hC_r = hA;
  // bottom face (D -> C): C is the B side
  faceState(uvD, vUv, hA, hB, uA, uB, vA, vB);
  float K_d = advFlux(hA * uA, hB * uB, hA, hB, vA, vB);
  float Gv_d = momFlux(hA, hB, vA, vB);
  float hC_d = hB;
  // top face (C -> U): C is the A side
  faceState(vUv, uvU, hA, hB, uA, uB, vA, vB);
  float K_u = advFlux(hA * uA, hB * uB, hA, hB, vA, vB);
  float Gv_u = momFlux(hA, hB, vA, vB);
  float hC_u = hA;

  // Audusse well-balanced source: exactly cancels the reconstructed pressure
  // imbalance so a lake at rest (any bed profile, even against vertical walls)
  // stays perfectly still.
  float Sx = 0.5 * uG * (hC_r * hC_r - hC_l * hC_l) / uCell.x;
  float Sy = 0.5 * uG * (hC_u * hC_u - hC_d * hC_d) / uCell.y;

  float hu = hOld * C.y + uDt * (Sx - (G_r - G_l) / uCell.x - (K_u - K_d) / uCell.y);
  float hv = hOld * C.z + uDt * (Sy - (Kv_r - Kv_l) / uCell.x - (Gv_u - Gv_d) / uCell.y);

  float u = hC > 1e-4 ? hu / hC : 0.0;
  float v = hC > 1e-4 ? hv / hC : 0.0;

  // Manning friction, semi-implicit
  float spd = length(vec2(u, v));
  if (hC > 1e-4 && spd > 1e-5) {
    float f = uDt * uG * uManning * uManning * spd / pow(max(hC, 0.02), 1.33333);
    float damp = 1.0 / (1.0 + f);
    u *= damp;
    v *= damp;
  }

  u = clamp(u, -16.0, 16.0);
  v = clamp(v, -16.0, 16.0);

  gl_FragColor = vec4(etaN, u, v, hC);
}
`;

// ------------------------------------------------------------------- pass: foam
export const FOAM_FRAG = /* glsl */ `
${SIM_COMMON}
uniform sampler2D uFoam;
uniform float uDt;

void main() {
  float foam = texture2D(uFoam, vUv).r;
  vec4 C = texture2D(uState, vUv);
  float h = max(C.x - bedAt(vUv), 0.0);

  vec4 L = texture2D(uState, vUv - vec2(uTexel.x, 0.0));
  vec4 R = texture2D(uState, vUv + vec2(uTexel.x, 0.0));
  vec4 D = texture2D(uState, vUv - vec2(0.0, uTexel.y));
  vec4 U = texture2D(uState, vUv + vec2(0.0, uTexel.y));
  float dudx = (R.y - L.y) / (2.0 * uCell.x);
  float dvdx = (R.z - L.z) / (2.0 * uCell.x);
  float dudz = (U.y - D.y) / (2.0 * uCell.y);
  float dvdz = (U.z - D.z) / (2.0 * uCell.y);
  float strain = abs(dudx) + abs(dvdz) + abs(dudz + dvdx);
  float speed = length(C.yz);

  float dep = smoothstep(1.2, 3.6, speed) * 0.55 + smoothstep(0.7, 2.4, strain) * 0.95;
  foam = foam * 0.972 + dep * uDt * 1.7;
  if (h < 0.08) foam *= 0.86;

  gl_FragColor = vec4(clamp(foam, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

// ------------------------------------------------------------------ pass: spray
// Particles: (x [m], z [m], age [s], life [s]) in world coords.
export const SPRAY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uSpray;
uniform sampler2D uState;
uniform sampler2D uBed;
uniform sampler2D uStruct;
uniform vec2 uTexel;
uniform float uDt;
uniform float uTime;
uniform float uSpawnSpeed;
uniform vec2 uDomain;

float bedAt(vec2 uv) {
  return max(texture2D(uBed, uv).r, texture2D(uStruct, uv).r);
}
float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}
vec4 sampleBil(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 st = uv / texel - 0.5;
  vec2 base = (floor(st) + 0.5) * texel;
  vec2 f = fract(st);
  vec4 a = texture2D(tex, base);
  vec4 b = texture2D(tex, base + vec2(texel.x, 0.0));
  vec4 c = texture2D(tex, base + vec2(0.0, texel.y));
  vec4 d = texture2D(tex, base + texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec4 p = texture2D(uSpray, vUv);
  if (p.z >= p.w) {
    // dead -> try to respawn where the flow is energetic
    float n = vUv.x * 513.7 + vUv.y * 271.3 + uTime * 61.7;
    vec4 r = vec4(hash1(n), hash1(n + 19.19), hash1(n + 47.73), hash1(n + 83.13));
    vec2 cuv = r.xy;
    vec4 st = texture2D(uState, cuv);
    float h = max(st.x - bedAt(cuv), 0.0);
    float sp = length(st.yz);
    if (sp > uSpawnSpeed && h > 0.06 && h < 5.5 && r.w < 0.5) {
      gl_FragColor = vec4(cuv.x * uDomain.x, cuv.y * uDomain.y, 0.0, 0.7 + 1.6 * r.z);
    } else {
      gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);
    }
  } else {
    vec2 uv = vec2(p.x / uDomain.x, p.y / uDomain.y);
    vec4 st = sampleBil(uState, uv, uTexel);
    vec2 np = p.xy + st.yz * uDt * 0.85;
    np = clamp(np, vec2(0.0), uDomain);
    gl_FragColor = vec4(np.x, np.y, p.z + uDt, p.w);
  }
}
`;

// ------------------------------------------------------------------ pass: copy / down / snap
export const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uInit;
void main() {
  gl_FragColor = texture2D(uInit, vUv);
}
`;

export const DOWN_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uState;
void main() {
  gl_FragColor = texture2D(uState, vUv);
}
`;

// bilinear downsample of the full-res state for timeline snapshots
export const SNAP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 uTexel;
vec4 sampleBil(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 st = uv / texel - 0.5;
  vec2 base = (floor(st) + 0.5) * texel;
  vec2 f = fract(st);
  vec4 a = texture2D(tex, base);
  vec4 b = texture2D(tex, base + vec2(texel.x, 0.0));
  vec4 c = texture2D(tex, base + vec2(0.0, texel.y));
  vec4 d = texture2D(tex, base + texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  gl_FragColor = sampleBil(uState, vUv, uTexel);
}
`;

// ------------------------------------------------------------------ water surface
export const WATER_VERT = /* glsl */ `
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec2 uDomain;
varying vec2 vUvw;
varying vec3 vWorld;

vec4 sampleBil(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 st = uv / texel - 0.5;
  vec2 base = (floor(st) + 0.5) * texel;
  vec2 f = fract(st);
  vec4 a = texture2D(tex, base);
  vec4 b = texture2D(tex, base + vec2(texel.x, 0.0));
  vec4 c = texture2D(tex, base + vec2(0.0, texel.y));
  vec4 d = texture2D(tex, base + texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // geometry is baked with translate(LX/2, 0, 0): position.x in [0, LX],
  // position.z in [-LZ/2, LZ/2] -> uv = (x/LX, z/LZ + 0.5). NO extra +0.5 on x
  // (that half-domain shift used to render the lake and the breach jet ~96 m
  // upstream of the dam -- the "water in the wrong place" bug).
  vUvw = vec2(position.x / uDomain.x, position.z / uDomain.y + 0.5);
  float eta = sampleBil(uState, vUvw, uTexel).x;
  vec3 p = position;
  p.y = eta;
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const WATER_FRAG = /* glsl */ `
uniform sampler2D uState;
uniform sampler2D uBed;
uniform sampler2D uStruct;
uniform sampler2D uFoam;
uniform sampler2D uArrTex;   // arrival time (s), 48x28
uniform vec2 uTexel;
uniform vec2 uCell;
uniform vec2 uDomain;
uniform vec2 uDownGrid;      // 48, 28
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCamPos;
uniform float uShowSpeed;
uniform float uLayerMode;    // 0 natural, 1 depth, 2 velocity, 3 arrival
uniform float uTime;
uniform float uRain;         // 0..1 storm intensity (rain choppiness + glare damp)
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUvw;
varying vec3 vWorld;

float bedAt(vec2 uv) {
  return max(texture2D(uBed, uv).r, texture2D(uStruct, uv).r);
}
vec4 sampleBil(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 st = uv / texel - 0.5;
  vec2 base = (floor(st) + 0.5) * texel;
  vec2 f = fract(st);
  vec4 a = texture2D(tex, base);
  vec4 b = texture2D(tex, base + vec2(texel.x, 0.0));
  vec4 c = texture2D(tex, base + vec2(0.0, texel.y));
  vec4 d = texture2D(tex, base + texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash1(i);
  float b = hash1(i + vec2(1.0, 0.0));
  float c = hash1(i + vec2(0.0, 1.0));
  float d = hash1(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 skyColor(vec3 dir) {
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 horizon = vec3(0.66, 0.78, 0.90);
  vec3 zenith = vec3(0.10, 0.30, 0.62);
  vec3 col = mix(horizon, zenith, pow(t, 0.5));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * pow(sd, 700.0) * 4.0;
  col += uSunColor * pow(sd, 6.0) * 0.18;
  return col;
}
vec3 jet(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * t - 3.0), 1.5 - abs(4.0 * t - 2.0), 1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
}
// depth ramp (hydrology convention): shallow -> deep = cyan -> navy
vec3 depthRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.16, 0.55, 0.75);
  vec3 c1 = vec3(0.10, 0.42, 0.65);
  vec3 c2 = vec3(0.06, 0.25, 0.52);
  vec3 c3 = vec3(0.03, 0.11, 0.34);
  if (t < 0.33) return mix(c0, c1, t / 0.33);
  if (t < 0.66) return mix(c1, c2, (t - 0.33) / 0.33);
  return mix(c2, c3, (t - 0.66) / 0.34);
}
// arrival ramp: fast -> slow = green -> yellow -> orange -> red -> purple
vec3 arrivalRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(vec3(0.16, 0.75, 0.30), vec3(0.65, 0.82, 0.15), t / 0.25);
  if (t < 0.50) return mix(vec3(0.65, 0.82, 0.15), vec3(0.98, 0.72, 0.10), (t - 0.25) / 0.25);
  if (t < 0.75) return mix(vec3(0.98, 0.72, 0.10), vec3(0.90, 0.25, 0.10), (t - 0.50) / 0.25);
  return mix(vec3(0.90, 0.25, 0.10), vec3(0.52, 0.10, 0.55), (t - 0.75) / 0.25);
}

void main() {
  vec4 st = sampleBil(uState, vUvw, uTexel);
  float eta = st.x;
  float b = bedAt(vUvw);
  float depth = eta - b;
  if (depth < 0.02) discard;

  // normal from surface gradient
  float eL = sampleBil(uState, vUvw - vec2(uTexel.x, 0.0), uTexel).x;
  float eR = sampleBil(uState, vUvw + vec2(uTexel.x, 0.0), uTexel).x;
  float eD = sampleBil(uState, vUvw - vec2(0.0, uTexel.y), uTexel).x;
  float eU = sampleBil(uState, vUvw + vec2(0.0, uTexel.y), uTexel).x;
  vec3 N = normalize(vec3(-(eR - eL) / (2.0 * uCell.x), 1.0, -(eU - eD) / (2.0 * uCell.y)));

  vec2 vel = st.yz;
  float speed = length(vel);

  // animated micro-ripples, advected by the flow for a live look.
  // rain stitches the surface with extra high-frequency dapple.
  vec2 flowOff = vel * uTime * 0.55;
  float n1 = vnoise(vWorld.xz * 0.9 + vec2(uTime * 0.7, uTime * 0.45) + flowOff * 0.35);
  float n2 = vnoise(vWorld.xz * 2.6 - vec2(uTime * 1.1, uTime * 0.8) + flowOff);
  float n3 = vnoise(vWorld.xz * 6.5 + vec2(uTime * 1.9, -uTime * 1.4));
  float n4 = vnoise(vWorld.xz * 14.0 + vec2(uTime * 3.4, uTime * 2.7));
  vec3 rip = vec3(n1 - 0.5, 0.0, n2 - 0.5) * (0.075 * (1.0 + uRain * 1.3))
           + vec3(n3 - 0.5, 0.0, n1 - 0.5) * (0.03 * (1.0 + uRain * 2.0))
           + vec3(n4 - 0.5, 0.0, n3 - 0.5) * (0.05 * uRain);
  N = normalize(N + rip);

  vec3 V = normalize(uCamPos - vWorld);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  vec3 sky = skyColor(normalize(R)) * vec3(0.82, 0.93, 1.12) * 1.05; // blue-shifted sky reflection
  sky *= 1.0 - 0.35 * uRain; // overcast dims reflected sky

  float fres = 0.04 + 0.85 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

  // ---- water body colour: clear blue tint, absorption by depth.
  // Kept luminous (real reservoirs read as saturated blue-green, never black):
  // at typical viewing angles the old ramp crushed 8 m of depth to near-black
  // and the lake looked like a dry slate plateau.
  vec3 shallow = vec3(0.055, 0.438, 0.522); // vivid turquoise glacial tint
  vec3 deep    = vec3(0.010, 0.175, 0.332);
  float absorb = pow(clamp(depth / 11.0, 0.0, 1.0), 0.62);
  vec3 body = mix(shallow, deep, absorb);
  // in-scattered sky ambient keeps depth-coloured water luminous
  body += vec3(0.045, 0.148, 0.168) * (1.0 - absorb) * (1.0 - 0.5 * uRain);

  // foam + shoreline whiteness
  float foam = texture2D(uFoam, vUvw).r;
  float shore = smoothstep(0.30, 0.03, depth) * 0.18;
  body = mix(body, vec3(0.90, 0.94, 0.97), clamp(foam, 0.0, 1.0) * 0.85 + shore);

  // sun specular: tight glitter + broad gloss (damped under overcast).
  // The drive keeps the lake mirror-flat, so the tight lobe is capped low —
  // otherwise it blows out into long white slashes along the far shoreline.
  vec3 H = normalize(uSunDir + V);
  float spec = (pow(max(dot(N, H), 0.0), 320.0) * 1.5 + pow(max(dot(N, H), 0.0), 28.0) * 0.10) * (1.0 - 0.6 * uRain);

  // sky reflection with a small floor so the lake never loses its blue read,
  // even looking straight down (fresnel alone only kicks in at grazing angles)
  float mixF = clamp(fres * 1.05 + 0.13, 0.0, 1.0);
  vec3 col = mix(body, sky, mixF) + uSunColor * spec * (1.0 - 0.6 * foam);

  // ---- analysis layers (downstream of the dam only — the reservoir is storage)
  float wx = vUvw.x * uDomain.x;
  if (uLayerMode > 0.5 && wx > ${DAM_X + 2}.0) {
    if (uLayerMode < 1.5) {
      col = depthRamp(depth / 8.0);
    } else if (uLayerMode < 2.5) {
      col = jet(speed / 8.0);
    } else {
      float arr = texture2D(uArrTex, vUvw).r;
      if (arr > 0.5) col = arrivalRamp(arr / 14400.0); // 0..240 min, unflooded stays natural
    }
  } else if (uShowSpeed > 0.5) {
    col = mix(col, jet(speed / 9.0), 0.8);
  }

  // shoreline transparency ramp
  float alpha = clamp(0.72 + fres * 0.28 + foam * 0.25, 0.0, 0.97);
  alpha *= smoothstep(0.02, 0.22, depth);
  if (uLayerMode > 0.5) alpha = clamp(0.55 + 0.4 * smoothstep(0.02, 0.15, depth), 0.0, 0.92);
  alpha = clamp(alpha, 0.0, 0.97);

  // atmospheric fog
  float dist = length(uCamPos - vWorld);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);

  gl_FragColor = vec4(col, alpha);
}
`;

// ------------------------------------------------------------------- spray points
export const SPRAY_POINTS_VERT = /* glsl */ `
uniform sampler2D uSpray;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec2 uDomain;
uniform float uPixelRatio;
varying float vFade;

vec4 sampleBil(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 st = uv / texel - 0.5;
  vec2 base = (floor(st) + 0.5) * texel;
  vec2 f = fract(st);
  vec4 a = texture2D(tex, base);
  vec4 b = texture2D(tex, base + vec2(texel.x, 0.0));
  vec4 c = texture2D(tex, base + vec2(0.0, texel.y));
  vec4 d = texture2D(tex, base + texel);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  vec2 ref = position.xy; // 0..1 uv into the spray texture
  vec4 p = texture2D(uSpray, ref);
  float life = max(p.w, 0.001);
  float age = p.z;
  float rn = hash1(ref.x * 913.7 + ref.y * 271.3);

  vec2 uv = vec2(p.x / uDomain.x, p.y / uDomain.y);
  float eta = sampleBil(uState, uv, uTexel).x;

  // little ballistic arc: rises then settles back to the surface
  float t = clamp(age, 0.0, life);
  float v0 = 1.2 + 2.6 * rn;
  float y = eta + v0 * t - 0.5 * 4.2 * t * t;
  y = max(y, eta - 0.1);

  vec3 world = vec3(p.x, y, p.y);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  float lifeT = clamp(age / life, 0.0, 1.0);
  vFade = (1.0 - lifeT) * 0.4;
  float size = (1.1 + 2.0 * rn) * (0.6 + 0.6 * (1.0 - lifeT));
  gl_PointSize = clamp(size * uPixelRatio * 130.0 / max(-mv.z, 1.0), 1.0, 26.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const SPRAY_POINTS_FRAG = /* glsl */ `
varying float vFade;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.08, r) * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.93, 0.96, 1.0), a);
}
`;
