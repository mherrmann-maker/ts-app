import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Screen-space finishing pass: glitch, warp, pixel mosaic, defocus, chromatic
// aberration, duotone grade, scanlines, film grain, overlay grid, vignette.
// All effects are mixable via their own uniform and driven by timeline time,
// so playback and export stay deterministic.
const FX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.05 },
    uScan: { value: 0.1 },
    uGrid: { value: 0.1 },
    uVignette: { value: 0.5 },
    uRgb: { value: 0 },
    uWarp: { value: 0 },
    uGlitchFx: { value: 0 },
    uPixel: { value: 0 },
    uBlur: { value: 0 },
    uTint: { value: 0 },
    uTintA: { value: new THREE.Color('#0e2a38') },
    uTintB: { value: new THREE.Color('#ff9a3c') },
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
    uniform float uRgb;
    uniform float uWarp;
    uniform float uGlitchFx;
    uniform float uPixel;
    uniform float uBlur;
    uniform float uTint;
    uniform vec3 uTintA;
    uniform vec3 uTintB;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec3 sampleScene(vec2 uv, float rad) {
      vec3 acc = texture2D(tDiffuse, uv).rgb;
      if (rad < 0.0006) return acc;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * rad).rgb;
      }
      return acc / 9.0;
    }

    void main() {
      vec2 uv = vUv;
      float tslice = floor(uTime * 9.0);

      // screen glitch: slices snap sideways, occasional whole-frame jump
      if (uGlitchFx > 0.001) {
        float slice = floor(uv.y * 28.0);
        float gate = step(1.0 - uGlitchFx * 0.4, hash(vec2(slice, tslice)));
        uv.x += (hash(vec2(slice * 1.71, tslice * 0.77)) - 0.5) * 0.3 * uGlitchFx * gate;
        uv.y += (hash(vec2(tslice, 9.13)) - 0.5) * 0.06 * uGlitchFx
          * step(0.93, hash(vec2(tslice, 3.71)));
      }

      // wave warp
      uv += vec2(sin(uv.y * 7.0 + uTime * 1.2), sin(uv.x * 6.0 - uTime * 0.9))
        * 0.02 * uWarp;

      // pixel mosaic
      if (uPixel > 0.001) {
        float cells = mix(420.0, 42.0, uPixel);
        vec2 g2 = vec2(cells * uRes.x / uRes.y, cells);
        uv = (floor(uv * g2) + 0.5) / g2;
      }

      // defocus: sharp centre, dreamy edges
      float dc = length(vUv - 0.5);
      float rad = uBlur * (0.0015 + 0.05 * dc * dc);
      vec3 col = sampleScene(uv, rad);

      // chromatic aberration
      if (uRgb > 0.001) {
        vec2 dir = vUv - 0.5;
        float ca = uRgb * 0.02 * (0.25 + dc);
        col.r = texture2D(tDiffuse, uv + dir * ca).r;
        col.b = texture2D(tDiffuse, uv - dir * ca).b;
      }

      // duotone grade
      if (uTint > 0.001) {
        float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
        vec3 duo = mix(uTintA, uTintB, pow(lum, 0.85));
        col = mix(col, duo, uTint);
      }

      // scanlines
      col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));

      // overlay grid (~96 px cells)
      vec2 gp = fract(vUv * uRes / 96.0);
      float line = max(step(gp.x, 1.6 / 96.0), step(gp.y, 1.6 / 96.0));
      col += line * uGrid * 0.35;

      // film grain
      col += (hash(vUv * uRes * 0.7 + fract(uTime * 0.37) * 91.0) - 0.5) * uGrain;

      // vignette
      float v = smoothstep(1.05, 0.35, dc * 1.35);
      col *= mix(1.0, v, uVignette);

      gl_FragColor = vec4(col, 1.0);
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
  key: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  /** Hooks um composer.render(): z. B. Kamera-Shake anlegen/zurücknehmen. */
  preRender?: () => void;
  postRender?: () => void;

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
    this.hemi = new THREE.HemisphereLight(0xdfe6ff, 0x0a0a12, 0.5);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(4, 6, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -8; this.key.shadow.camera.right = 8;
    this.key.shadow.camera.top = 8; this.key.shadow.camera.bottom = -8;
    this.key.shadow.bias = -0.0004;
    this.scene.add(this.key);

    // exp2 fog for built-in materials; the cloud shader mirrors it via uniforms
    this.fog = new THREE.FogExp2(0x000000, 0.00001);
    this.scene.fog = this.fog;

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
    if (this.controls.enabled) this.controls.update();
    this.preRender?.();
    this.composer.render();
    this.postRender?.();
  }
}
