import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// ─── Camera path waypoints ─────────────────────────────────────────────────
const CAM_PTS = [
  new THREE.Vector3(0,    0,   13),   // 0 – hero
  new THREE.Vector3(0.4,  0.8,  8),   // 1
  new THREE.Vector3(-0.3, 0.4,  3),   // 2
  new THREE.Vector3(0,    0,   -1),   // 3 – inside hero sphere
  new THREE.Vector3(0,    0,   -5),   // 4
  new THREE.Vector3(2.5,  0.5, -11),  // 5
  new THREE.Vector3(0,    0,   -17),  // 6 – works zone
  new THREE.Vector3(-1.5,-0.3, -23),  // 7
  new THREE.Vector3(0,    0,   -29),  // 8 – about zone
  new THREE.Vector3(0,    0.4, -35),  // 9 – contact
]

const LOOK_PTS = [
  new THREE.Vector3(0, 0,   0),
  new THREE.Vector3(0, 0,   0),
  new THREE.Vector3(0, 0,  -3),
  new THREE.Vector3(0, 0,  -6),
  new THREE.Vector3(0, 0,  -9),
  new THREE.Vector3(0, 0,  -15),
  new THREE.Vector3(0, 0,  -21),
  new THREE.Vector3(0, 0,  -27),
  new THREE.Vector3(0, 0,  -33),
  new THREE.Vector3(0, 0,  -41),
]

// ─── Globals ───────────────────────────────────────────────────────────────
export let renderer: THREE.WebGLRenderer
export let scene: THREE.Scene
export let camera: THREE.PerspectiveCamera
export let composer: EffectComposer
export let cameraPath: THREE.CatmullRomCurve3
export let lookAtPath: THREE.CatmullRomCurve3
export let clock: THREE.Clock

let particleMaterial: THREE.ShaderMaterial
export let heroMesh: THREE.Mesh
let heroInner: THREE.Mesh
let heroRings: THREE.Mesh[] = []

interface FloatingObj { mesh: THREE.Mesh; baseY: number; seed: number }
let floatingObjs: FloatingObj[] = []
export let workPortals: THREE.Group[] = []

// ─── Shaders ───────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute float aSize;
  attribute vec3  aColor;
  varying   vec3  vColor;
  varying   float vFade;
  uniform   float uTime;

  void main() {
    vColor = aColor;
    vec3 p = position;
    p.y += sin(uTime * 0.28 + position.x * 0.6) * 0.09;
    p.x += cos(uTime * 0.19 + position.z * 0.4) * 0.06;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (260.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
    vFade = smoothstep(80.0, 15.0, length(mv.xyz));
  }
`

const FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vFade;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * vFade * 0.85;
    gl_FragColor = vec4(vColor, a);
  }
`

// ─── Init ──────────────────────────────────────────────────────────────────
export function initWorld(canvas: HTMLCanvasElement): void {
  clock = new THREE.Clock()

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.outputColorSpace = THREE.SRGBColorSpace

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x06060A)
  scene.fog = new THREE.FogExp2(0x06060A, 0.011)

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 120)
  camera.position.copy(CAM_PTS[0])

  cameraPath = new THREE.CatmullRomCurve3(CAM_PTS, false, 'catmullrom', 0.5)
  lookAtPath  = new THREE.CatmullRomCurve3(LOOK_PTS, false, 'catmullrom', 0.5)

  camera.lookAt(LOOK_PTS[0])

  buildLights()
  buildParticles()
  buildHero()
  buildFloaters()
  buildPortals()
  buildPostFX()

  window.addEventListener('resize', onResize)
}

// ─── Lights ────────────────────────────────────────────────────────────────
function buildLights(): void {
  scene.add(new THREE.AmbientLight(0x10101A, 0.6))

  const gold = new THREE.PointLight(0xC9A84C, 60, 22)
  gold.position.set(3, 4, 2)
  scene.add(gold)

  const blue = new THREE.PointLight(0x4466FF, 35, 26)
  blue.position.set(-5, -3, -2)
  scene.add(blue)

  const purple = new THREE.PointLight(0x8833FF, 45, 22)
  purple.position.set(0, 3, -14)
  scene.add(purple)

  const warm = new THREE.PointLight(0xFFAA44, 30, 20)
  warm.position.set(1, 0, -30)
  scene.add(warm)
}

// ─── Particles ─────────────────────────────────────────────────────────────
function buildParticles(): void {
  const COUNT = window.innerWidth < 768 ? 7000 : 14000

  const pos    = new Float32Array(COUNT * 3)
  const colors = new Float32Array(COUNT * 3)
  const sizes  = new Float32Array(COUNT)

  const palette = [
    new THREE.Color(0xC9A84C),
    new THREE.Color(0xC9A84C),
    new THREE.Color(0xF0EDE6),
    new THREE.Color(0xF0EDE6),
    new THREE.Color(0x7B9FFF),
    new THREE.Color(0xD87BFF),
  ]

  for (let i = 0; i < COUNT; i++) {
    const t  = Math.random()
    const pt = cameraPath.getPoint(t)

    const r     = Math.pow(Math.random(), 0.5) * 18
    const angle = Math.random() * Math.PI * 2

    pos[i * 3]     = pt.x + Math.cos(angle) * r
    pos[i * 3 + 1] = pt.y + (Math.random() - 0.5) * 10
    pos[i * 3 + 2] = pt.z + Math.sin(angle) * r

    const c = palette[Math.floor(Math.random() * palette.length)]
    colors[i * 3]     = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b

    sizes[i] = Math.random() < 0.9 ? Math.random() * 1.6 + 0.4 : Math.random() * 4 + 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aColor',   new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1))

  particleMaterial = new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  scene.add(new THREE.Points(geo, particleMaterial))
}

// ─── Hero Object ───────────────────────────────────────────────────────────
function buildHero(): void {
  // Wireframe icosahedron
  const wGeo = new THREE.IcosahedronGeometry(2.6, 1)
  const wMat = new THREE.MeshBasicMaterial({ color: 0xC9A84C, wireframe: true, transparent: true, opacity: 0.35 })
  heroMesh = new THREE.Mesh(wGeo, wMat)
  scene.add(heroMesh)

  // Dark inner solid
  const iGeo = new THREE.IcosahedronGeometry(2.4, 1)
  const iMat = new THREE.MeshStandardMaterial({
    color: 0x08080F, emissive: 0x1A0800, emissiveIntensity: 0.5,
    roughness: 0.7, metalness: 0.3, transparent: true, opacity: 0.92,
  })
  heroInner = new THREE.Mesh(iGeo, iMat)
  scene.add(heroInner)

  // Orbit rings
  const rMat = new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.25 })
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.018, 8, 80), rMat)
  ring1.rotation.x = 0.35
  scene.add(ring1)

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.014, 8, 80), rMat.clone())
  ring2.rotation.x = Math.PI * 0.5
  ring2.rotation.y = 0.8
  scene.add(ring2)

  heroRings = [ring1, ring2]
}

// ─── Floating objects ──────────────────────────────────────────────────────
function buildFloaters(): void {
  const defs = [
    { geo: new THREE.OctahedronGeometry(0.55),     color: 0xC9A84C, emit: 0x3A2800, x:  4.2, y: 1.5,  z: -3   },
    { geo: new THREE.OctahedronGeometry(0.40),     color: 0x4466FF, emit: 0x080F30, x: -4.5, y:-1.0,  z: -5   },
    { geo: new THREE.TetrahedronGeometry(0.65),    color: 0xC9A84C, emit: 0x3A2800, x:  5.0, y: 0,    z: -8   },
    { geo: new THREE.TorusKnotGeometry(0.9, 0.28, 120, 16, 2, 3), color: 0xC9A84C, emit: 0x2A1500, x:-4.2, y:0, z:-7 },
    { geo: new THREE.OctahedronGeometry(0.50),     color: 0x8833FF, emit: 0x200050, x: -5.2, y: 2.0,  z: -10  },
    { geo: new THREE.IcosahedronGeometry(0.45, 0), color: 0x4466FF, emit: 0x080F30, x:  3.5, y:-1.8,  z: -13  },
    { geo: new THREE.TetrahedronGeometry(0.40),    color: 0xC9A84C, emit: 0x3A2800, x: -3.2, y: 1.2,  z: -16  },
    { geo: new THREE.TorusKnotGeometry(0.7, 0.2, 120, 16, 3, 5), color: 0x7B9FFF, emit: 0x101033, x: 5.5, y:1, z:-22 },
    { geo: new THREE.OctahedronGeometry(0.55),     color: 0xD87BFF, emit: 0x200035, x:  2.5, y: 2.5,  z: -25  },
    { geo: new THREE.IcosahedronGeometry(0.35, 0), color: 0xC9A84C, emit: 0x3A2800, x: -2.5, y:-1.5,  z: -29  },
  ]

  for (const d of defs) {
    const mat = new THREE.MeshStandardMaterial({
      color: d.color, emissive: d.emit, emissiveIntensity: 0.4,
      metalness: 0.85, roughness: 0.15,
    })
    const mesh = new THREE.Mesh(d.geo, mat)
    mesh.position.set(d.x, d.y, d.z)
    mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
    scene.add(mesh)
    floatingObjs.push({ mesh, baseY: d.y, seed: Math.random() * 100 })
  }
}

// ─── Work Portals (glowing frames) ─────────────────────────────────────────
const PORTAL_DEFS = [
  { x: -4.5, z: -14, col: 0xC9A84C },
  { x:  4.5, z: -16, col: 0x7B9FFF },
  { x: -4.5, z: -18, col: 0xFF7C5C },
  { x:  4.5, z: -20, col: 0x5CFFB8 },
  { x: -4.5, z: -22, col: 0xFFB347 },
  { x:  4.5, z: -24, col: 0xD87BFF },
]

function buildPortals(): void {
  for (const def of PORTAL_DEFS) {
    const g = new THREE.Group()
    g.position.set(def.x, 0, def.z)

    // Frame edges
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 1.7, 0.02)),
      new THREE.LineBasicMaterial({ color: def.col, transparent: true, opacity: 0.55 }),
    )
    g.add(edges)

    // Glow plane
    g.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.7),
      new THREE.MeshBasicMaterial({ color: def.col, transparent: true, opacity: 0.025, side: THREE.DoubleSide }),
    ))

    // Corner dots
    for (const [cx, cy] of [[-1.25, 0.8], [1.25, 0.8], [-1.25, -0.8], [1.25, -0.8]] as [number,number][]) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 8),
        new THREE.MeshBasicMaterial({ color: def.col }),
      )
      dot.position.set(cx, cy, 0)
      g.add(dot)
    }

    scene.add(g)
    workPortals.push(g)
  }
}

// ─── Post FX ───────────────────────────────────────────────────────────────
function buildPostFX(): void {
  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.3,   // strength
    0.45,  // radius
    0.12,  // threshold
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
}

// ─── Resize ────────────────────────────────────────────────────────────────
function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  composer.setSize(window.innerWidth, window.innerHeight)
}

// ─── Camera update (called from scroll) ────────────────────────────────────
const _cp = new THREE.Vector3()
const _lp = new THREE.Vector3()

export function moveCameraTo(progress: number): void {
  const t = Math.max(0, Math.min(1, progress))
  cameraPath.getPoint(t, _cp)
  lookAtPath.getPoint(t, _lp)
  camera.position.copy(_cp)
  camera.lookAt(_lp)
}

// ─── Animation loop ────────────────────────────────────────────────────────
export function tick(): void {
  const e = clock.getElapsedTime()

  if (particleMaterial) particleMaterial.uniforms.uTime.value = e

  // Hero rotation
  heroMesh.rotation.y = e * 0.09
  heroMesh.rotation.x = e * 0.065
  heroInner.rotation.y = -e * 0.07
  heroInner.rotation.x = e * 0.05
  heroRings.forEach((r, i) => { r.rotation.z = e * (0.12 + i * 0.05) })

  // Floating objects
  floatingObjs.forEach(({ mesh, baseY, seed }, i) => {
    mesh.rotation.x += 0.003 + i * 0.0004
    mesh.rotation.y += 0.005 + i * 0.0003
    mesh.position.y = baseY + Math.sin(e * 0.45 + seed) * 0.18
    mesh.position.x += Math.cos(e * 0.22 + seed) * 0.0005
  })

  // Portal sway
  workPortals.forEach((p, i) => { p.rotation.y = Math.sin(e * 0.28 + i * 0.9) * 0.06 })

  composer.render()
  requestAnimationFrame(tick)
}
