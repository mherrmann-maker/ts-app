import './style.css'
import * as THREE from 'three'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { initWorld, tick } from './world'
import { initScroll } from './scrollAnim'
import { works } from './worksConfig'

gsap.registerPlugin(ScrollTrigger)

// ─── Cursor ────────────────────────────────────────────────────────────────
function initCursor(): void {
  const dot  = document.getElementById('cursor')!
  const ring = document.getElementById('cursor-ring')!
  let rx = 0, ry = 0

  window.addEventListener('mousemove', (e) => {
    gsap.set(dot,  { x: e.clientX, y: e.clientY })
    gsap.to(ring, { x: e.clientX, y: e.clientY, duration: 0.18, ease: 'power2.out' })
    rx = e.clientX; ry = e.clientY
  })

  document.querySelectorAll('a, button, .work-card').forEach((el) => {
    el.addEventListener('mouseenter', () => gsap.to(ring, { scale: 1.8, duration: 0.25 }))
    el.addEventListener('mouseleave', () => gsap.to(ring, { scale: 1,   duration: 0.25 }))
  })
}

// ─── Loader ────────────────────────────────────────────────────────────────
function runLoader(): Promise<void> {
  return new Promise((resolve) => {
    const bar    = document.getElementById('loader-progress')!
    const pct    = document.getElementById('loader-pct')!
    const loader = document.getElementById('loader')!
    let p = 0

    const iv = setInterval(() => {
      p += Math.random() * 14 + 3
      if (p >= 100) {
        p = 100
        clearInterval(iv)
        bar.style.width = '100%'
        pct.textContent = '100'

        gsap.to(loader, {
          opacity: 0, duration: 0.9, delay: 0.5,
          onComplete: () => { loader.style.display = 'none'; resolve() },
        })
        return
      }
      bar.style.width = `${p}%`
      pct.textContent = String(Math.floor(p))
    }, 80)
  })
}

// ─── Mini Three.js scene inside each card placeholder ─────────────────────
function buildCardScenes(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('.card-mini-canvas')

  canvases.forEach((canvas, i) => {
    const w = canvas.clientWidth  || 300
    const h = canvas.clientHeight || 190

    const rend = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    rend.setSize(w, h)
    rend.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    rend.setClearColor(0x000000, 0)
    rend.toneMapping = THREE.ACESFilmicToneMapping

    const sc  = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(60, w / h, 0.1, 50)
    cam.position.set(0, 0, 3.2)

    // Soft lights
    sc.add(new THREE.AmbientLight(0xffffff, 0.3))
    const l1 = new THREE.PointLight(works[i]?.accent ?? '#C9A84C', 30, 12)
    l1.position.set(2, 2, 2); sc.add(l1)
    const l2 = new THREE.PointLight(0x4466FF, 15, 12)
    l2.position.set(-2, -1, 1); sc.add(l2)

    // Pick a distinct procedural object per card
    const shapes = [
      new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.TorusKnotGeometry(0.6, 0.2, 100, 12, 2, 3),
      new THREE.OctahedronGeometry(0.9),
      new THREE.TorusKnotGeometry(0.55, 0.18, 100, 12, 3, 4),
      new THREE.TetrahedronGeometry(0.9),
      new THREE.TorusKnotGeometry(0.65, 0.22, 100, 12, 2, 5),
    ]
    const accentCol = new THREE.Color(works[i]?.accent ?? '#C9A84C')
    const mat = new THREE.MeshStandardMaterial({
      color: accentCol,
      emissive: accentCol,
      emissiveIntensity: 0.2,
      metalness: 0.85,
      roughness: 0.12,
    })
    const mesh = new THREE.Mesh(shapes[i % shapes.length], mat)
    sc.add(mesh)

    // Particle ring
    const pCount = 280
    const pPos = new Float32Array(pCount * 3)
    for (let j = 0; j < pCount; j++) {
      const a = (j / pCount) * Math.PI * 2
      const r = 1.4 + (Math.random() - 0.5) * 0.4
      pPos[j * 3]     = Math.cos(a) * r
      pPos[j * 3 + 1] = (Math.random() - 0.5) * 0.6
      pPos[j * 3 + 2] = Math.sin(a) * r
    }
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
    const pMat = new THREE.PointsMaterial({
      color: accentCol, size: 0.025, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    sc.add(new THREE.Points(pGeo, pMat))

    const seed = i * 1.7
    let frame = 0
    const loop = () => {
      frame++
      const t = frame * 0.01
      mesh.rotation.x = t * 0.4 + seed
      mesh.rotation.y = t * 0.6
      rend.render(sc, cam)
      requestAnimationFrame(loop)
    }
    loop()
  })
}

// ─── Works Grid ────────────────────────────────────────────────────────────
function buildWorksGrid(): void {
  const grid = document.getElementById('works-grid')!

  works.forEach((w, i) => {
    const card = document.createElement('article')
    card.className = 'work-card'
    card.style.setProperty('--card-accent', w.accent)
    card.dataset.workId = w.id

    let previewHTML: string
    if (w.videoPath) {
      previewHTML = `<video src="${w.videoPath}" muted loop playsinline autoplay></video>`
    } else if (w.imagePath) {
      previewHTML = `<img src="${w.imagePath}" alt="${w.title}" loading="lazy">`
    } else {
      previewHTML = `<canvas class="card-mini-canvas"></canvas>`
    }

    card.innerHTML = `
      <div class="card-preview">
        ${previewHTML}
        <span class="card-badge">${w.year}</span>
      </div>
      <div class="card-info">
        <div class="card-meta">
          <span class="card-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="card-cat">${w.category}</span>
        </div>
        <h3 class="card-title">${w.title}</h3>
        <p class="card-desc">${w.description}</p>
        ${w.modelPath
          ? `<button class="card-cta" data-model="${w.modelPath}" data-title="${w.title}" data-cat="${w.category}">VIEW 3D ↗</button>`
          : ''}
      </div>
    `
    grid.appendChild(card)
  })
}

// ─── GLB Viewer Modal ──────────────────────────────────────────────────────
let viewerRend: THREE.WebGLRenderer | null = null
let viewerCtrl: OrbitControls | null = null
let viewerRAF: number | null = null

function initViewer(): void {
  document.getElementById('viewer-close')!.addEventListener('click', closeViewer)
  document.getElementById('viewer-modal')!.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeViewer()
  })

  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.card-cta')
    if (!btn) return
    const model = btn.dataset.model
    const title = btn.dataset.title ?? ''
    const cat   = btn.dataset.cat   ?? ''
    if (model) openViewer(model, title, cat)
  })
}

function openViewer(modelPath: string, title: string, cat: string): void {
  const modal  = document.getElementById('viewer-modal')!
  const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement

  document.getElementById('viewer-title')!.textContent    = title
  document.getElementById('viewer-category')!.textContent = cat
  modal.classList.add('open')

  const W = canvas.clientWidth  || window.innerWidth
  const H = canvas.clientHeight || window.innerHeight - 68

  const sc  = new THREE.Scene()
  sc.background = new THREE.Color(0x08080E)
  const cam = new THREE.PerspectiveCamera(55, W / H, 0.01, 100)
  cam.position.set(0, 1, 4.5)

  if (!viewerRend) {
    viewerRend = new THREE.WebGLRenderer({ canvas, antialias: true })
    viewerRend.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    viewerRend.toneMapping = THREE.ACESFilmicToneMapping
    viewerRend.outputColorSpace = THREE.SRGBColorSpace
  }
  viewerRend.setSize(W, H)

  sc.add(new THREE.AmbientLight(0xffffff, 0.4))
  const vl1 = new THREE.DirectionalLight(0xC9A84C, 2.5); vl1.position.set(5, 6, 5); sc.add(vl1)
  const vl2 = new THREE.DirectionalLight(0x4466FF,  1.5); vl2.position.set(-5,-3,-5); sc.add(vl2)

  if (viewerCtrl) viewerCtrl.dispose()
  viewerCtrl = new OrbitControls(cam, canvas)
  viewerCtrl.enableDamping = true
  viewerCtrl.dampingFactor = 0.06
  viewerCtrl.autoRotate    = true
  viewerCtrl.autoRotateSpeed = 0.8

  new GLTFLoader().load(modelPath, (gltf) => {
    const box    = new THREE.Box3().setFromObject(gltf.scene)
    const center = box.getCenter(new THREE.Vector3())
    const size   = box.getSize(new THREE.Vector3())
    gltf.scene.position.sub(center)
    gltf.scene.scale.setScalar(3.2 / Math.max(size.x, size.y, size.z))
    sc.add(gltf.scene)
  })

  if (viewerRAF) cancelAnimationFrame(viewerRAF)
  const loop = () => {
    viewerRAF = requestAnimationFrame(loop)
    viewerCtrl?.update()
    viewerRend?.render(sc, cam)
  }
  loop()
}

function closeViewer(): void {
  document.getElementById('viewer-modal')!.classList.remove('open')
  if (viewerRAF) { cancelAnimationFrame(viewerRAF); viewerRAF = null }
}

// ─── Hero intro animation ──────────────────────────────────────────────────
function playIntro(): void {
  gsap.from('.nav-logo, .nav-links li', { opacity: 0, y: -16, duration: 0.8, stagger: 0.08, ease: 'power3.out' })
  gsap.from('.hero-label', { opacity: 0, y: 20, duration: 0.7, delay: 0.4, ease: 'power3.out' })
  gsap.from('.hero-line', {
    opacity: 0, y: 80, duration: 1.1, delay: 0.55, stagger: 0.12,
    ease: 'power4.out',
  })
  gsap.from('.hero-sub', { opacity: 0, y: 24, duration: 0.8, delay: 1.0, ease: 'power3.out' })
  gsap.from('.scroll-hint', { opacity: 0, duration: 0.8, delay: 1.8, ease: 'power2.out' })
}

// ─── Boot ──────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  buildWorksGrid()

  const canvas = document.getElementById('webgl') as HTMLCanvasElement
  initWorld(canvas)
  tick()

  await runLoader()

  buildCardScenes()
  initScroll()
  initViewer()
  initCursor()
  playIntro()
}

boot()
