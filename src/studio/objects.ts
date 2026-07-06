import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { AnimState, Keyframe } from './anim';
import { sampleKeyframes } from './anim';

export type ObjectKind =
  | 'box' | 'sphere' | 'torus' | 'torusKnot' | 'icosahedron' | 'cone' | 'cylinder'
  | 'rect' | 'circle' | 'ring' | 'star' | 'triangle' | 'text'
  | 'particles' | 'pointLight' | 'media'
  | 'cloudSphere' | 'cloudKnot' | 'cloudTorus' | 'cloudWave'
  | 'cloudBlob' | 'cloudGalaxy' | 'cloudNet';

export const KIND_LABEL: Record<ObjectKind, string> = {
  box: 'Würfel', sphere: 'Kugel', torus: 'Torus', torusKnot: 'Knoten',
  icosahedron: 'Ikosaeder', cone: 'Kegel', cylinder: 'Zylinder',
  rect: 'Rechteck', circle: 'Kreis', ring: 'Ring', star: 'Stern',
  triangle: 'Dreieck', text: 'Text', particles: 'Partikel', pointLight: 'Licht',
  media: 'Media',
  cloudSphere: 'Wolke·Kugel', cloudKnot: 'Wolke·Knoten',
  cloudTorus: 'Wolke·Torus', cloudWave: 'Wolke·Welle',
  cloudBlob: 'Wolke·Klumpen', cloudGalaxy: 'Wolke·Galaxie', cloudNet: 'Netz',
};

export const KIND_ICON: Record<ObjectKind, string> = {
  box: '◼', sphere: '●', torus: '◯', torusKnot: '✦', icosahedron: '◆',
  cone: '▲', cylinder: '▮', rect: '▭', circle: '⬤', ring: '◎', star: '★',
  triangle: '△', text: 'T', particles: '✳', pointLight: '☀', media: '🖼',
  cloudSphere: '✸', cloudKnot: '✸', cloudTorus: '✸', cloudWave: '≈',
  cloudBlob: '✸', cloudGalaxy: '✹', cloudNet: '⌗',
};

export interface ObjectExtra {
  text?: string;
  metalness?: number;
  roughness?: number;
  wireframe?: boolean;
  /** media: dataURL (nur kleine Bilder, sonst nicht persistiert) */
  src?: string;
  srcType?: 'image' | 'video';
  blend?: 'normal' | 'additive';
}

const MESH_3D: ObjectKind[] = ['box', 'sphere', 'torus', 'torusKnot', 'icosahedron', 'cone', 'cylinder'];
const MESH_2D: ObjectKind[] = ['rect', 'circle', 'ring', 'star', 'triangle'];
const CLOUDS: ObjectKind[] = [
  'cloudSphere', 'cloudKnot', 'cloudTorus', 'cloudWave',
  'cloudBlob', 'cloudGalaxy', 'cloudNet',
];

export const isCloud = (k: ObjectKind) => CLOUDS.includes(k);
export const is3D = (k: ObjectKind) => MESH_3D.includes(k);
export const is2D = (k: ObjectKind) => MESH_2D.includes(k);

let nextId = 1;
export function freshId(): string {
  return `obj${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

// ---------------------------------------------------------------- geometry

function starShape(points: number, outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function triangleShape(size: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * size, y = Math.sin(a) * size;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function primitiveGeometry(kind: ObjectKind): THREE.BufferGeometry {
  switch (kind) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere': return new THREE.SphereGeometry(0.65, 48, 32);
    case 'torus': return new THREE.TorusGeometry(0.6, 0.22, 32, 96);
    case 'torusKnot': return new THREE.TorusKnotGeometry(0.55, 0.16, 200, 24);
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.7, 0);
    case 'cone': return new THREE.ConeGeometry(0.55, 1.1, 48);
    case 'cylinder': return new THREE.CylinderGeometry(0.45, 0.45, 1.1, 48);
    case 'rect': return new THREE.PlaneGeometry(1.2, 0.8);
    case 'circle': return new THREE.CircleGeometry(0.6, 64);
    case 'ring': return new THREE.RingGeometry(0.35, 0.6, 64);
    case 'star': return new THREE.ShapeGeometry(starShape(5, 0.7, 0.3));
    case 'triangle': return new THREE.ShapeGeometry(triangleShape(0.7));
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function blobGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 96, 64);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const s1 = Math.random() * 10, s2 = Math.random() * 10, s3 = Math.random() * 10;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const d = 1
      + 0.3 * Math.sin(3.0 * n.x + s1 + 2.0 * n.y)
      + 0.24 * Math.sin(4.0 * n.y + s2 + 3.0 * n.z)
      + 0.18 * Math.sin(5.0 * n.z + s3 + 2.0 * n.x);
    v.copy(n).multiplyScalar(Math.max(0.35, d));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function cloudSourceGeometry(kind: ObjectKind): THREE.BufferGeometry {
  switch (kind) {
    case 'cloudSphere': return new THREE.SphereGeometry(1, 64, 48);
    case 'cloudKnot': return new THREE.TorusKnotGeometry(0.85, 0.3, 220, 36);
    case 'cloudTorus': return new THREE.TorusGeometry(0.9, 0.35, 48, 140);
    case 'cloudBlob': return blobGeometry();
    case 'cloudWave': {
      const g = new THREE.PlaneGeometry(4.2, 2.4, 4, 4);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    default: return new THREE.SphereGeometry(1, 64, 48);
  }
}

/** Punkte entlang logarithmischer Spiralarme mit Streuung. */
function galaxyPositions(count: number): Float32Array {
  const pos = new Float32Array(count * 3);
  const arms = 2 + Math.floor(Math.random() * 3);
  const twist = 3.6 + Math.random() * 1.6;
  for (let i = 0; i < count; i++) {
    const arm = i % arms;
    const t = Math.pow(Math.random(), 0.6);
    const r = 0.12 + t * 1.9;
    const a = (arm / arms) * Math.PI * 2 + t * twist
      + (Math.random() - 0.5) * (0.65 - t * 0.4);
    pos[i * 3] = Math.cos(a) * r + (Math.random() - 0.5) * 0.07;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.18 * (1.25 - t);
    pos[i * 3 + 2] = Math.sin(a) * r + (Math.random() - 0.5) * 0.07;
  }
  return pos;
}

/** Zufällige nahe Punktpaare auf einer Knoten-Oberfläche als Liniennetz. */
function netGeometry(): THREE.BufferGeometry {
  const source = new THREE.TorusKnotGeometry(0.85, 0.3, 200, 32);
  const mesh = new THREE.Mesh(source);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const want = 2600;
  const pos = new Float32Array(want * 6);
  const rnd = new Float32Array(want * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let written = 0;
  let guard = 0;
  while (written < want && guard < want * 80) {
    guard++;
    sampler.sample(a);
    sampler.sample(b);
    if (a.distanceTo(b) > 0.34) continue;
    pos[written * 6] = a.x; pos[written * 6 + 1] = a.y; pos[written * 6 + 2] = a.z;
    pos[written * 6 + 3] = b.x; pos[written * 6 + 4] = b.y; pos[written * 6 + 5] = b.z;
    rnd[written * 2] = Math.random();
    rnd[written * 2 + 1] = Math.random();
    written++;
  }
  source.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, written * 6), 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd.subarray(0, written * 2), 1));
  return geo;
}

// ------------------------------------------------------- scan-cloud shader

const CLOUD_VERT = /* glsl */ `
uniform float uTime;
uniform float uDisplace;
uniform float uGlitch;
uniform float uSwirl;
uniform float uBands;
uniform float uSize;
attribute float aRnd;
varying float vShade;
varying float vDepth;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

void main() {
  vec3 p = position;

  // quantize into horizontal scan bands
  float band = floor((p.y + 4.0) * uBands);
  p.y = band / uBands - 4.0;

  // organic drift, mostly sideways so bands stay readable as lines
  float n = vnoise(p * 1.6 + vec3(0.0, uTime * 0.22, uTime * 0.13)) - 0.5;
  float n2 = vnoise(p * 3.1 + vec3(uTime * 0.17, 0.0, 7.0)) - 0.5;
  p.x += n * uDisplace;
  p.z += n2 * uDisplace;
  p.y += (vnoise(p * 2.0 + vec3(3.0, uTime * 0.1, 0.0)) - 0.5) * uDisplace * 0.25;

  // abstraction swirl: noise-driven curl around Y dissolves the shape
  if (uSwirl > 0.001) {
    float ang = (vnoise(p * 0.9 + vec3(0.0, uTime * 0.15, 5.0)) - 0.5) * 6.2832 * uSwirl
      + uSwirl * uTime * 0.35;
    float cs = cos(ang);
    float sn = sin(ang);
    p.xz = mat2(cs, -sn, sn, cs) * p.xz;
    p.y += (vnoise(p * 1.3 + vec3(2.0, uTime * 0.2, 0.0)) - 0.5) * uSwirl * 1.4;
  }

  // glitch: whole bands snap sideways, gated per time-slice
  float slice = floor(uTime * 7.0);
  float gate = step(1.0 - uGlitch * 0.55, hash1(band * 7.31 + slice * 13.7));
  float amount = (hash1(band * 3.77 + slice * 5.13) - 0.5) * 1.6;
  p.x += amount * gate * uGlitch;

  vShade = 0.3 + 0.7 * hash1(aRnd * 97.0 + band * 0.61);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(uSize * (10.0 / -mv.z) * (0.45 + aRnd * 0.85), 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vShade;
varying float vDepth;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  vec3 c = mix(uColor * vShade, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(c, uOpacity);
}
`;

// Netz-Variante: gleicher Vertex-Shader, Fragment ohne Point-Discard.
const NET_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vShade;
varying float vDepth;
void main() {
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  vec3 c = mix(uColor * vShade, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(c, uOpacity * 0.75);
}
`;

// ------------------------------------------------------------ media shader

const MEDIA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MEDIA_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uGl;
uniform float uWr;
uniform float uPx;
uniform float uDuo;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec3 uDuoA;
uniform vec3 uDuoB;
varying vec2 vUv;

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float vnoise2(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = vUv;
  float tslice = floor(uTime * 8.0);

  if (uGl > 0.001) {
    float slice = floor(uv.y * 30.0);
    float gate = step(1.0 - uGl * 0.45, hash2(vec2(slice, tslice)));
    uv.x += (hash2(vec2(slice * 1.31, tslice * 0.77)) - 0.5) * 0.35 * uGl * gate;
  }
  if (uWr > 0.001) {
    uv += (vec2(
      vnoise2(uv * 3.0 + uTime * 0.3),
      vnoise2(uv * 3.0 + 7.0 - uTime * 0.25)
    ) - 0.5) * 0.35 * uWr;
  }
  if (uPx > 0.001) {
    float cells = mix(240.0, 16.0, uPx);
    uv = (floor(uv * cells) + 0.5) / cells;
  }
  uv = clamp(uv, 0.0, 1.0);

  vec4 tex = texture2D(uMap, uv);
  vec3 col = tex.rgb * uColor;
  if (uDuo > 0.001) {
    float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    col = mix(col, mix(uDuoA, uDuoB, pow(lum, 0.9)), uDuo);
  }
  gl_FragColor = vec4(col, tex.a * uOpacity);
}
`;

function makePlaceholderTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 360;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#101218';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#2a2e3c';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.fillStyle = '#8b90a3';
  ctx.font = '28px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cloudUniformSet(kind: ObjectKind): { [k: string]: THREE.IUniform } {
  return {
    uTime: { value: 0 },
    uDisplace: { value: 0.25 },
    uGlitch: { value: 0.25 },
    uSwirl: { value: 0 },
    uBands: { value: kind === 'cloudWave' ? 26 : kind === 'cloudGalaxy' ? 90 : 46 },
    uSize: { value: 1.2 },
    uColor: { value: new THREE.Color(0xffffff) },
    uOpacity: { value: 0.95 },
    uFogColor: { value: new THREE.Color(0x000000) },
    uFogDensity: { value: 0 },
  };
}

function makeCloudPoints(kind: ObjectKind): THREE.Points | THREE.LineSegments {
  const uniforms = cloudUniformSet(kind);

  if (kind === 'cloudNet') {
    const mat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: NET_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms,
    });
    const lines = new THREE.LineSegments(netGeometry(), mat);
    lines.frustumCulled = false;
    return lines;
  }

  let geo: THREE.BufferGeometry;
  const count = kind === 'cloudWave' ? 30000 : 26000;
  if (kind === 'cloudGalaxy') {
    const pos = galaxyPositions(count);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) rnd[i] = Math.random();
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  } else {
    const source = cloudSourceGeometry(kind);
    const surface = new THREE.Mesh(source);
    const sampler = new MeshSurfaceSampler(surface).build();
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      sampler.sample(p);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      rnd[i] = Math.random();
    }
    source.dispose();
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  }

  const mat = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------- helpers

function makeTextTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  const font = '400 140px "Space Mono", monospace';
  const pad = 50;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.max(2, Math.ceil(ctx.measureText(text).width) + pad * 2);
  c.width = w;
  c.height = 240;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, c.height / 2 + 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

function makeParticles(): THREE.Points {
  const count = 900;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 2.5 * Math.cbrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const s = Math.sqrt(1 - z * z);
    pos[i * 3] = r * s * Math.cos(a);
    pos[i * 3 + 1] = r * z;
    pos[i * 3 + 2] = r * s * Math.sin(a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.02, transparent: true, opacity: 0.7,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

// ------------------------------------------------------------- ClipObject

export class ClipObject {
  id: string;
  kind: ObjectKind;
  name: string;
  root: THREE.Object3D;
  keyframes: Keyframe[] = [];
  extra: ObjectExtra = {};

  mesh: THREE.Mesh | THREE.Points | THREE.LineSegments | null = null;
  light: THREE.PointLight | null = null;
  video: HTMLVideoElement | null = null;

  constructor(kind: ObjectKind, name: string, extra: ObjectExtra = {}) {
    this.id = freshId();
    this.kind = kind;
    this.name = name;
    this.extra = { metalness: 0.35, roughness: 0.35, wireframe: false, ...extra };
    this.root = this.build();
    this.root.traverse((o) => { o.userData.objId = this.id; });
    this.root.userData.objId = this.id;
  }

  private build(): THREE.Object3D {
    const kind = this.kind;

    if (isCloud(kind)) {
      const points = makeCloudPoints(kind);
      this.mesh = points;
      return points;
    }

    if (kind === 'particles') {
      const points = makeParticles();
      this.mesh = points;
      return points;
    }

    if (kind === 'media') {
      const mat = new THREE.ShaderMaterial({
        vertexShader: MEDIA_VERT,
        fragmentShader: MEDIA_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uMap: { value: makePlaceholderTexture(this.extra.srcType ? 'Datei neu wählen' : 'Bild/Video laden') },
          uTime: { value: 0 },
          uGl: { value: 0 },
          uWr: { value: 0 },
          uPx: { value: 0 },
          uDuo: { value: 0 },
          uOpacity: { value: 1 },
          uColor: { value: new THREE.Color(0xffffff) },
          uDuoA: { value: new THREE.Color('#0e2a38') },
          uDuoB: { value: new THREE.Color('#ff9a3c') },
        },
      });
      if (this.extra.blend === 'additive') {
        mat.blending = THREE.AdditiveBlending;
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.78 * 1.8, 1.8), mat);
      this.mesh = mesh;
      return mesh;
    }

    if (kind === 'pointLight') {
      const light = new THREE.PointLight(0xffffff, 6, 0, 1.6);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      light.add(bulb);
      this.light = light;
      return light;
    }

    if (kind === 'text') {
      const { tex, aspect } = makeTextTexture(this.extra.text ?? 'motion');
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), mat);
      this.mesh = mesh;
      return mesh;
    }

    if (is2D(kind)) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(primitiveGeometry(kind), mat);
      mesh.castShadow = true;
      this.mesh = mesh;
      return mesh;
    }

    // 3D primitive
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: this.extra.metalness,
      roughness: this.extra.roughness,
      wireframe: this.extra.wireframe,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(primitiveGeometry(kind), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    return mesh;
  }

  /** Re-render the text texture (text objects only). */
  setText(text: string): void {
    if (this.kind !== 'text' || !this.mesh) return;
    this.extra.text = text;
    const mat = (this.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    const { tex, aspect } = makeTextTexture(text || ' ');
    mat.map = tex;
    mat.needsUpdate = true;
    (this.mesh as THREE.Mesh).geometry.dispose();
    (this.mesh as THREE.Mesh).geometry = new THREE.PlaneGeometry(aspect, 1);
  }

  setStaticMaterial(patch: { metalness?: number; roughness?: number; wireframe?: boolean }): void {
    Object.assign(this.extra, patch);
    const mat = this.materialOf();
    if (mat instanceof THREE.MeshStandardMaterial) {
      if (patch.metalness !== undefined) mat.metalness = patch.metalness;
      if (patch.roughness !== undefined) mat.roughness = patch.roughness;
      if (patch.wireframe !== undefined) mat.wireframe = patch.wireframe;
    } else if (mat instanceof THREE.MeshBasicMaterial && patch.wireframe !== undefined) {
      mat.wireframe = patch.wireframe;
    }
  }

  private materialOf(): THREE.Material | null {
    if (this.mesh) return (this.mesh as THREE.Mesh).material as THREE.Material;
    return null;
  }

  private cloudUniforms(): { [k: string]: THREE.IUniform } | null {
    if (!isCloud(this.kind) || !this.mesh) return null;
    return ((this.mesh as THREE.Points).material as THREE.ShaderMaterial).uniforms;
  }

  private mediaUniforms(): { [k: string]: THREE.IUniform } | null {
    if (this.kind !== 'media' || !this.mesh) return null;
    return ((this.mesh as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
  }

  setCloudTime(t: number): void {
    const u = this.cloudUniforms() ?? this.mediaUniforms();
    if (u) u.uTime.value = t;
  }

  /** Bild (dataURL) oder Video (objectURL/dataURL) als Textur laden. */
  async setMediaSource(src: string, type: 'image' | 'video'): Promise<void> {
    const u = this.mediaUniforms();
    if (!u || !this.mesh) return;
    let tex: THREE.Texture;
    let aspect = 16 / 9;

    if (type === 'video') {
      const video = document.createElement('video');
      video.src = src;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => resolve();
      });
      if (video.videoWidth > 0) aspect = video.videoWidth / video.videoHeight;
      void video.play().catch(() => { /* Autoplay-Block: startet mit ▶ */ });
      video.pause();
      this.video = video;
      tex = new THREE.VideoTexture(video);
    } else {
      tex = await new THREE.TextureLoader().loadAsync(src);
      const img = tex.image as { width: number; height: number };
      if (img?.width > 0) aspect = img.width / img.height;
    }
    tex.colorSpace = THREE.SRGBColorSpace;

    (u.uMap.value as THREE.Texture | null)?.dispose();
    u.uMap.value = tex;
    (this.mesh as THREE.Mesh).geometry.dispose();
    (this.mesh as THREE.Mesh).geometry = new THREE.PlaneGeometry(aspect * 1.8, 1.8);

    this.extra.srcType = type;
    // nur kleine Bilder persistieren (localStorage-Limit); Videos nie
    this.extra.src = (type === 'image' && src.startsWith('data:') && src.length <= 2_500_000)
      ? src : undefined;
  }

  setBlend(mode: 'normal' | 'additive'): void {
    this.extra.blend = mode;
    const mat = this.materialOf() as THREE.ShaderMaterial | null;
    if (!mat || this.kind !== 'media') return;
    mat.blending = mode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.needsUpdate = true;
  }

  setVideoPlaying(p: boolean): void {
    if (!this.video) return;
    if (p) void this.video.play().catch(() => { /* ignorieren */ });
    else this.video.pause();
  }

  /** Beim Scrubben (pausiert) Video-Frame zur Timeline-Zeit anzeigen. */
  syncVideo(t: number): void {
    if (!this.video || !this.video.duration) return;
    this.video.currentTime = t % this.video.duration;
  }

  /** Duotone-Farben des Media-Shaders an die Szenen-Palette koppeln. */
  setDuoColors(a: string, b: string): void {
    const u = this.mediaUniforms();
    if (!u) return;
    (u.uDuoA.value as THREE.Color).set(a);
    (u.uDuoB.value as THREE.Color).set(b);
  }

  /** Mirror the scene fog into the cloud shader (no-op for other kinds). */
  setFog(colorHex: string, density: number): void {
    const u = this.cloudUniforms();
    if (!u) return;
    (u.uFogColor.value as THREE.Color).set(colorHex);
    u.uFogDensity.value = density;
  }

  captureState(): AnimState {
    const s: AnimState = {
      px: this.root.position.x, py: this.root.position.y, pz: this.root.position.z,
      rx: this.root.rotation.x, ry: this.root.rotation.y, rz: this.root.rotation.z,
      sx: this.root.scale.x, sy: this.root.scale.y, sz: this.root.scale.z,
    };
    const cu = this.cloudUniforms();
    if (cu) {
      const c = cu.uColor.value as THREE.Color;
      s.cr = c.r; s.cg = c.g; s.cb = c.b;
      s.op = cu.uOpacity.value as number;
      s.di = cu.uDisplace.value as number;
      s.gl = cu.uGlitch.value as number;
      s.sw = cu.uSwirl.value as number;
      s.size = cu.uSize.value as number;
      return s;
    }
    const mu = this.mediaUniforms();
    if (mu) {
      const c = mu.uColor.value as THREE.Color;
      s.cr = c.r; s.cg = c.g; s.cb = c.b;
      s.op = mu.uOpacity.value as number;
      s.gl = mu.uGl.value as number;
      s.wr = mu.uWr.value as number;
      s.pix = mu.uPx.value as number;
      s.duo = mu.uDuo.value as number;
      return s;
    }
    if (this.light) {
      s.cr = this.light.color.r; s.cg = this.light.color.g; s.cb = this.light.color.b;
      s.in = this.light.intensity;
      return s;
    }
    const mat = this.materialOf();
    if (mat && 'color' in mat) {
      const c = (mat as THREE.MeshBasicMaterial).color;
      s.cr = c.r; s.cg = c.g; s.cb = c.b;
      s.op = mat.opacity;
    }
    if (mat instanceof THREE.MeshStandardMaterial) s.em = mat.emissiveIntensity;
    if (mat instanceof THREE.PointsMaterial) s.size = mat.size;
    return s;
  }

  applyState(s: AnimState): void {
    if ('px' in s) this.root.position.set(s.px, s.py, s.pz);
    if ('rx' in s) this.root.rotation.set(s.rx, s.ry, s.rz);
    if ('sx' in s) this.root.scale.set(s.sx, s.sy, s.sz);

    const cu = this.cloudUniforms();
    if (cu) {
      if ('cr' in s) (cu.uColor.value as THREE.Color).setRGB(s.cr, s.cg, s.cb);
      if ('op' in s) cu.uOpacity.value = s.op;
      if ('di' in s) cu.uDisplace.value = s.di;
      if ('gl' in s) cu.uGlitch.value = s.gl;
      if ('sw' in s) cu.uSwirl.value = s.sw;
      if ('size' in s) cu.uSize.value = s.size;
      return;
    }
    const mu = this.mediaUniforms();
    if (mu) {
      if ('cr' in s) (mu.uColor.value as THREE.Color).setRGB(s.cr, s.cg, s.cb);
      if ('op' in s) mu.uOpacity.value = s.op;
      if ('gl' in s) mu.uGl.value = s.gl;
      if ('wr' in s) mu.uWr.value = s.wr;
      if ('pix' in s) mu.uPx.value = s.pix;
      if ('duo' in s) mu.uDuo.value = s.duo;
      return;
    }
    if (this.light) {
      if ('cr' in s) {
        this.light.color.setRGB(s.cr, s.cg, s.cb);
        const bulb = this.light.children[0] as THREE.Mesh | undefined;
        if (bulb) (bulb.material as THREE.MeshBasicMaterial).color.setRGB(s.cr, s.cg, s.cb);
      }
      if ('in' in s) this.light.intensity = s.in;
      return;
    }
    const mat = this.materialOf();
    if (!mat) return;
    if ('cr' in s && 'color' in mat) {
      (mat as THREE.MeshBasicMaterial).color.setRGB(s.cr, s.cg, s.cb);
    }
    if ('op' in s) {
      mat.opacity = s.op;
      mat.transparent = this.kind === 'text' || this.kind === 'particles' || s.op < 0.999;
    }
    if ('em' in s && mat instanceof THREE.MeshStandardMaterial) {
      mat.emissiveIntensity = s.em;
      mat.emissive.copy(mat.color);
    }
    if ('size' in s && mat instanceof THREE.PointsMaterial) mat.size = s.size;
  }

  applyTime(t: number): void {
    this.setCloudTime(t);
    const s = sampleKeyframes(this.keyframes, t);
    if (s) this.applyState(s);
  }

  dispose(): void {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
    const mu = this.mediaUniforms();
    (mu?.uMap.value as THREE.Texture | null)?.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => {
          const anyM = mm as THREE.MeshBasicMaterial;
          anyM.map?.dispose();
          mm.dispose();
        });
      }
    });
  }

  toJSON(): SerializedObject {
    return {
      id: this.id,
      kind: this.kind,
      name: this.name,
      extra: { ...this.extra },
      state: this.captureState(),
      keyframes: this.keyframes.map((k) => ({ ...k, state: { ...k.state } })),
    };
  }

  static fromJSON(data: SerializedObject): ClipObject {
    const obj = new ClipObject(data.kind, data.name, data.extra);
    obj.id = data.id;
    obj.root.traverse((o) => { o.userData.objId = obj.id; });
    obj.applyState(data.state);
    obj.setStaticMaterial({
      metalness: data.extra.metalness,
      roughness: data.extra.roughness,
      wireframe: data.extra.wireframe,
    });
    obj.keyframes = data.keyframes.map((k) => ({ ...k, state: { ...k.state } }));
    obj.keyframes.sort((a, b) => a.time - b.time);
    if (data.kind === 'media' && data.extra.src) {
      void obj.setMediaSource(data.extra.src, data.extra.srcType ?? 'image')
        .then(() => obj.applyState(data.state));
    }
    return obj;
  }
}

export interface SerializedObject {
  id: string;
  kind: ObjectKind;
  name: string;
  extra: ObjectExtra;
  state: AnimState;
  keyframes: Keyframe[];
}
