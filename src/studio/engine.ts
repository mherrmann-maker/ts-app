import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Screen-space finishing pass: scanlines, film grain, overlay grid, vignette.
const FX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.08 },
    uScan: { value: 0.12 },
    uGrid: { value: 0.12 },
    uVignette: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uGrain;
    uniform float uScan;
    uniform float uGrid;
    uniform float uVignette;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // scanlines
      col.rgb *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));

      // overlay grid (~96 px cells)
      vec2 gp = fract(vUv * uRes / 96.0);
      float line = max(step(gp.x, 1.6 / 96.0), step(gp.y, 1.6 / 96.0));
      col.rgb += line * uGrid * 0.35;

      // film grain (driven by timeline time -> deterministic export)
      col.rgb += (hash(vUv * uRes * 0.7 + fract(uTime * 0.37) * 91.0) - 0.5) * uGrain;

      // vignette
      float v = smoothstep(1.05, 0.35, length(vUv - 0.5) * 1.35);
      col.rgb *= mix(1.0, v, uVignette);

      gl_FragColor = col;
    }
  `,
};

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  fxPass: ShaderPass;
  world: THREE.Group;
  grid: THREE.GridHelper;
  ground: THREE.Mesh;

  private wrap: HTMLElement;

  constructor(canvas: HTMLCanvasElement, wrap: HTMLElement) {
    this.wrap = wrap;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    this.camera.position.set(0, 0.6, 5.2);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.world = new THREE.Group();
    this.scene.add(this.world);

    // lights (only affect MeshStandardMaterial objects)
    const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x0a0a12, 0.5);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8; key.shadow.camera.right = 8;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    this.grid = new THREE.GridHelper(24, 24, 0x2a2e3c, 0x181b24);
    this.grid.position.y = -1.5;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    this.ground.position.y = -1.5;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.scene.add(this.ground);

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.scene.add(this.gizmo.getHelper());

    // post-processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.82);
    this.composer.addPass(this.bloomPass);
    this.fxPass = new ShaderPass({
      uniforms: THREE.UniformsUtils.clone(FX_SHADER.uniforms),
      vertexShader: FX_SHADER.vertexShader,
      fragmentShader: FX_SHADER.fragmentShader,
    });
    this.composer.addPass(this.fxPass);
    this.composer.addPass(new OutputPass());

    const ro = new ResizeObserver(() => this.resizeToViewport());
    ro.observe(wrap);
    this.resizeToViewport();
  }

  resizeToViewport(): void {
    const w = Math.max(2, this.wrap.clientWidth);
    const h = Math.max(2, this.wrap.clientHeight);
    this.setRenderSize(w, h, true);
  }

  setRenderSize(w: number, h: number, updateStyle: boolean): void {
    this.renderer.setSize(w, h, updateStyle);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    (this.fxPass.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
  }

  setFxTime(t: number): void {
    this.fxPass.uniforms.uTime.value = t;
  }

  render(): void {
    this.controls.update();
    this.composer.render();
  }
}
