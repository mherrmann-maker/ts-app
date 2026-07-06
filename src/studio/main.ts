import './studio.css';
import * as THREE from 'three';
import { Engine } from './engine';
import {
  ClipObject, KIND_ICON, KIND_LABEL, freshId, is3D, isCloud,
} from './objects';
import type { ObjectKind, SerializedObject } from './objects';
import { sampleKeyframes, upsertKeyframe } from './anim';
import type { AnimState, EasingName, Keyframe } from './anim';
import { Timeline } from './timeline';
import { downloadBlob, exportWebM } from './exporter';

// ---------------------------------------------------------------- state

interface SceneSettings {
  bg: string;
  bloom: number;
  exposure: number;
  grain: number;
  scan: number;
  grid: number;
  vignette: number;
  rgb: number;
  warp: number;
  glitchFx: number;
  pixel: number;
  blur: number;
  tint: number;
  tintA: string;
  tintB: string;
  fog: number;
  fogColor: string;
  keyColor: string;
  keyIntensity: number;
  hemi: number;
  showGrid: boolean;
  showGround: boolean;
  duration: number;
  fps: number;
}

interface ProjectData {
  version: number;
  settings: SceneSettings;
  camera: { state: AnimState; keyframes: Keyframe[] };
  objects: SerializedObject[];
}

const DEFAULT_SETTINGS: SceneSettings = {
  bg: '#000000', bloom: 0.3, exposure: 1.1,
  grain: 0.05, scan: 0.1, grid: 0.1, vignette: 0.5,
  rgb: 0.12, warp: 0, glitchFx: 0, pixel: 0, blur: 0.2,
  tint: 0, tintA: '#0e2a38', tintB: '#ff9a3c',
  fog: 0.035, fogColor: '#000000',
  keyColor: '#ffffff', keyIntensity: 1.6, hemi: 0.5,
  showGrid: false, showGround: false,
  duration: 8, fps: 60,
};

const STORAGE_KEY = 'vk-motion-studio-v1';

let settings: SceneSettings = { ...DEFAULT_SETTINGS };
const objects: ClipObject[] = [];
let cameraKeyframes: Keyframe[] = [];
let selected: ClipObject | null = null;

let time = 0;
let playing = false;
let looping = true;
let autoKey = true;
let defaultEasing: EasingName = 'easeInOut';
let exporting = false;

// ---------------------------------------------------------------- dom

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} fehlt`);
  return node as T;
};

const canvas = $<HTMLCanvasElement>('stage');
const viewport = $('viewport');
const propsEl = $('props');
const sceneListEl = $('scene-list');
const timeDisplay = $('time-display');
const playBtn = $<HTMLButtonElement>('btn-play');
const easingSelect = $<HTMLSelectElement>('easing-select');

const engine = new Engine(canvas, viewport);

// ---------------------------------------------------------------- helpers

const tmpColor = new THREE.Color();

function rgbToHex(r: number, g: number, b: number): string {
  tmpColor.setRGB(r, g, b);
  return `#${tmpColor.getHexString()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  tmpColor.set(hex);
  return { r: tmpColor.r, g: tmpColor.g, b: tmpColor.b };
}

let dirtyTimer = 0;
function markDirty(): void {
  window.clearTimeout(dirtyTimer);
  dirtyTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    } catch { /* storage voll/gesperrt — ignorieren */ }
  }, 800);
}

// ---------------------------------------------------------------- camera track

function captureCameraState(): AnimState {
  return {
    px: engine.camera.position.x, py: engine.camera.position.y, pz: engine.camera.position.z,
    tx: engine.controls.target.x, ty: engine.controls.target.y, tz: engine.controls.target.z,
  };
}

function applyCameraState(s: AnimState): void {
  engine.camera.position.set(s.px, s.py, s.pz);
  engine.controls.target.set(s.tx, s.ty, s.tz);
}

// ---------------------------------------------------------------- timeline

const timeline = new Timeline($('tracks'), {
  getDuration: () => settings.duration,
  getTime: () => time,
  setTime: (t) => { setTime(t); },
  onSelectTrack: (id) => {
    const obj = objects.find((o) => o.id === id) ?? null;
    select(obj);
  },
  onChanged: () => markDirty(),
  onSelectKeyframe: (sel) => {
    if (sel) easingSelect.value = sel.kf.easing;
  },
});

function refreshTimeline(): void {
  timeline.setTracks(
    [
      { id: '@camera', name: '📷 Kamera', keyframes: cameraKeyframes },
      ...objects.map((o) => ({ id: o.id, name: o.name, keyframes: o.keyframes })),
    ],
    selected ? selected.id : null,
  );
}

// ---------------------------------------------------------------- playback

function setTime(t: number): void {
  time = Math.min(Math.max(t, 0), settings.duration);
  applyTime(time);
}

function applyTime(t: number): void {
  for (const obj of objects) obj.applyTime(t);
  const cam = sampleKeyframes(cameraKeyframes, t);
  if (cam) applyCameraState(cam);
  engine.setFxTime(t);
  timeline.updatePlayhead();
  updateTimeDisplay();
  refreshPropValues();
}

function updateTimeDisplay(): void {
  timeDisplay.textContent = `${time.toFixed(2)} / ${settings.duration.toFixed(2)} s`;
}

function setPlaying(p: boolean): void {
  playing = p;
  playBtn.textContent = p ? '⏸' : '▶';
  if (p && time >= settings.duration) time = 0;
}

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (!exporting) {
    if (playing) {
      time += dt;
      if (time >= settings.duration) {
        if (looping) time %= settings.duration;
        else { time = settings.duration; setPlaying(false); }
      }
      applyTime(time);
    }
    engine.render();
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- objects

function spawn(kind: ObjectKind, extra?: { text?: string }): ClipObject {
  const count = objects.filter((o) => o.kind === kind).length + 1;
  const name = count > 1 ? `${KIND_LABEL[kind]} ${count}` : KIND_LABEL[kind];
  const obj = new ClipObject(kind, name, extra ?? (kind === 'text' ? { text: 'motion' } : {}));
  obj.setCloudTime(time);
  obj.setFog(settings.fogColor, settings.fog);
  objects.push(obj);
  engine.world.add(obj.root);
  return obj;
}

function addObject(kind: ObjectKind): ClipObject {
  const obj = spawn(kind);
  select(obj);
  refreshTimeline();
  markDirty();
  return obj;
}

function removeObject(obj: ClipObject): void {
  const i = objects.indexOf(obj);
  if (i >= 0) objects.splice(i, 1);
  if (selected === obj) select(null);
  engine.world.remove(obj.root);
  obj.dispose();
  refreshSceneList();
  refreshTimeline();
  markDirty();
}

function duplicateObject(obj: ClipObject): void {
  const data = obj.toJSON();
  data.id = freshId();
  data.name = `${obj.name} Kopie`;
  data.state = { ...data.state, px: (data.state.px ?? 0) + 0.4 };
  data.keyframes = data.keyframes.map((k) => ({
    ...k, state: { ...k.state, px: (k.state.px ?? 0) + 0.4 },
  }));
  const copy = ClipObject.fromJSON(data);
  copy.setCloudTime(time);
  copy.setFog(settings.fogColor, settings.fog);
  objects.push(copy);
  engine.world.add(copy.root);
  select(copy);
  refreshTimeline();
  markDirty();
}

function select(obj: ClipObject | null): void {
  selected = obj;
  if (obj) engine.gizmo.attach(obj.root);
  else engine.gizmo.detach();
  refreshSceneList();
  refreshTimeline();
  renderProps();
}

function keyframeSelected(): void {
  if (!selected) return;
  upsertKeyframe(selected.keyframes, time, selected.captureState(), defaultEasing);
  refreshTimeline();
  markDirty();
}

function autoKeyframe(obj: ClipObject): void {
  if (!autoKey) return;
  upsertKeyframe(obj.keyframes, time, obj.captureState(), defaultEasing);
  refreshTimeline();
  markDirty();
}

// ---------------------------------------------------------------- scene list

function refreshSceneList(): void {
  sceneListEl.innerHTML = '';
  for (const obj of objects) {
    const li = document.createElement('li');
    if (obj === selected) li.classList.add('selected');

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = KIND_ICON[obj.kind];
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = obj.name;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Löschen';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeObject(obj); });

    li.append(kind, nm, del);
    li.addEventListener('click', () => { select(obj); closeDrawers(); });
    sceneListEl.appendChild(li);
  }
}

// ---------------------------------------------------------------- props panel

type Updater = () => void;
let propUpdaters: Updater[] = [];

function refreshPropValues(): void {
  for (const u of propUpdaters) u();
}

function row(label: string, ...inputs: HTMLElement[]): HTMLElement {
  const r = document.createElement('div');
  r.className = 'prop-row';
  const l = document.createElement('label');
  l.textContent = label;
  r.appendChild(l);
  inputs.forEach((i) => r.appendChild(i));
  return r;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function numInput(
  get: () => number, set: (v: number) => void, step: number,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.value = get().toFixed(2);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) set(v);
  });
  propUpdaters.push(() => {
    if (document.activeElement !== input) input.value = get().toFixed(2);
  });
  return input;
}

function rangeInput(
  get: () => number, set: (v: number) => void,
  min: number, max: number, step: number,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(get());
  input.addEventListener('input', () => set(parseFloat(input.value)));
  propUpdaters.push(() => {
    if (document.activeElement !== input) input.value = String(get());
  });
  return input;
}

function colorInput(get: () => string, set: (hex: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = get();
  input.addEventListener('input', () => set(input.value));
  propUpdaters.push(() => {
    if (document.activeElement !== input) input.value = get();
  });
  return input;
}

function checkbox(get: () => boolean, set: (v: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return input;
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

/** Edit one animatable state key on the selected object (+ auto-key). */
function stateEditor(obj: ClipObject, key: string, transform?: {
  toUi: (v: number) => number; fromUi: (v: number) => number;
}): { get: () => number; set: (v: number) => void } {
  const toUi = transform?.toUi ?? ((v: number) => v);
  const fromUi = transform?.fromUi ?? ((v: number) => v);
  return {
    get: () => toUi(obj.captureState()[key] ?? 0),
    set: (v: number) => {
      const s = obj.captureState();
      s[key] = fromUi(v);
      obj.applyState(s);
      autoKeyframe(obj);
      markDirty();
    },
  };
}

const DEG = { toUi: (v: number) => (v * 180) / Math.PI, fromUi: (v: number) => (v * Math.PI) / 180 };

function renderProps(): void {
  propUpdaters = [];
  propsEl.innerHTML = '';
  if (!selected) { renderSceneProps(); return; }
  const obj = selected;

  propsEl.appendChild(heading('Eigenschaften'));

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = obj.name;
  nameInput.addEventListener('change', () => {
    obj.name = nameInput.value || obj.name;
    refreshSceneList();
    refreshTimeline();
    markDirty();
  });
  propsEl.appendChild(row('Name', nameInput));

  if (obj.kind === 'text') {
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = obj.extra.text ?? '';
    textInput.addEventListener('change', () => {
      obj.setText(textInput.value);
      markDirty();
    });
    propsEl.appendChild(row('Text', textInput));
  }

  propsEl.appendChild(heading('Transform'));
  for (const [label, keys, step, tf] of [
    ['Position', ['px', 'py', 'pz'], 0.1, undefined],
    ['Rotation °', ['rx', 'ry', 'rz'], 5, DEG],
    ['Skalierung', ['sx', 'sy', 'sz'], 0.05, undefined],
  ] as const) {
    if (label === 'Rotation °' && obj.kind === 'pointLight') continue;
    propsEl.appendChild(row(
      label,
      ...keys.map((k) => {
        const e = stateEditor(obj, k, tf);
        return numInput(e.get, e.set, step);
      }),
    ));
  }

  propsEl.appendChild(heading('Aussehen'));
  const state = obj.captureState();

  if ('cr' in state) {
    propsEl.appendChild(row('Farbe', colorInput(
      () => { const s = obj.captureState(); return rgbToHex(s.cr, s.cg, s.cb); },
      (hex) => {
        const { r, g, b } = hexToRgb(hex);
        const s = obj.captureState();
        s.cr = r; s.cg = g; s.cb = b;
        obj.applyState(s);
        autoKeyframe(obj);
        markDirty();
      },
    )));
  }
  if ('op' in state) {
    const e = stateEditor(obj, 'op');
    propsEl.appendChild(row('Deckkraft', rangeInput(e.get, e.set, 0, 1, 0.01)));
  }
  if ('em' in state) {
    const e = stateEditor(obj, 'em');
    propsEl.appendChild(row('Glow', rangeInput(e.get, e.set, 0, 4, 0.05)));
  }
  if ('in' in state) {
    const e = stateEditor(obj, 'in');
    propsEl.appendChild(row('Intensität', rangeInput(e.get, e.set, 0, 30, 0.1)));
  }
  if ('di' in state) {
    const e = stateEditor(obj, 'di');
    propsEl.appendChild(row('Zerfall', rangeInput(e.get, e.set, 0, 1.5, 0.01)));
  }
  if ('gl' in state) {
    const e = stateEditor(obj, 'gl');
    propsEl.appendChild(row('Glitch', rangeInput(e.get, e.set, 0, 1, 0.01)));
  }
  if ('size' in state) {
    const e = stateEditor(obj, 'size');
    const max = isCloud(obj.kind) ? 4 : 0.12;
    const step = isCloud(obj.kind) ? 0.05 : 0.002;
    propsEl.appendChild(row('Punktgröße', rangeInput(e.get, e.set, 0.001, max, step)));
  }

  if (is3D(obj.kind)) {
    propsEl.appendChild(row('Metall', rangeInput(
      () => obj.extra.metalness ?? 0.35,
      (v) => { obj.setStaticMaterial({ metalness: v }); markDirty(); },
      0, 1, 0.01,
    )));
    propsEl.appendChild(row('Rauheit', rangeInput(
      () => obj.extra.roughness ?? 0.35,
      (v) => { obj.setStaticMaterial({ roughness: v }); markDirty(); },
      0, 1, 0.01,
    )));
    propsEl.appendChild(row('Drahtgitter', checkbox(
      () => obj.extra.wireframe ?? false,
      (v) => { obj.setStaticMaterial({ wireframe: v }); markDirty(); },
    )));
  }

  const btns = document.createElement('div');
  btns.className = 'btn-row';
  btns.append(
    button('◆ Keyframe', keyframeSelected),
    button('Duplizieren', () => duplicateObject(obj)),
    button('Löschen', () => removeObject(obj), 'danger'),
  );
  propsEl.appendChild(btns);
}

function renderSceneProps(): void {
  const settingColor = (label: string, key: 'bg' | 'tintA' | 'tintB' | 'fogColor' | 'keyColor') => {
    propsEl.appendChild(row(label, colorInput(
      () => settings[key],
      (hex) => { settings[key] = hex; applySettings(); markDirty(); },
    )));
  };
  const slider = (
    label: string, key: keyof SceneSettings, min: number, max: number, step: number,
  ) => {
    propsEl.appendChild(row(label, rangeInput(
      () => settings[key] as number,
      (v) => { (settings[key] as number) = v; applySettings(); markDirty(); },
      min, max, step,
    )));
  };

  propsEl.appendChild(heading('Zufall'));
  const rndRow = document.createElement('div');
  rndRow.className = 'btn-row';
  rndRow.append(
    button('🎲 Look würfeln', randomLook),
    button('🎲 Chaos-Mix', randomScene),
  );
  propsEl.appendChild(rndRow);

  propsEl.appendChild(heading('Szene'));
  settingColor('Hintergrund', 'bg');
  slider('Bloom / Glow', 'bloom', 0, 1.5, 0.02);
  slider('Belichtung', 'exposure', 0.4, 2.2, 0.02);

  propsEl.appendChild(heading('Cinematic FX'));
  slider('RGB-Shift', 'rgb', 0, 1, 0.01);
  slider('Screen-Glitch', 'glitchFx', 0, 1, 0.01);
  slider('Verzerrung', 'warp', 0, 1, 0.01);
  slider('Unschärfe', 'blur', 0, 1, 0.01);
  slider('Pixelraster', 'pixel', 0, 1, 0.01);
  slider('Duotone', 'tint', 0, 1, 0.01);
  settingColor('Farbe dunkel', 'tintA');
  settingColor('Farbe hell', 'tintB');

  propsEl.appendChild(heading('Atmosphäre'));
  slider('Nebel', 'fog', 0, 0.25, 0.005);
  settingColor('Nebelfarbe', 'fogColor');

  propsEl.appendChild(heading('Licht'));
  settingColor('Lichtfarbe', 'keyColor');
  slider('Intensität', 'keyIntensity', 0, 6, 0.05);
  slider('Ambient', 'hemi', 0, 2, 0.02);

  propsEl.appendChild(heading('Look (Retro)'));
  slider('Scanlines', 'scan', 0, 0.5, 0.01);
  slider('Grain', 'grain', 0, 0.3, 0.01);
  slider('Raster-Overlay', 'grid', 0, 0.6, 0.01);
  slider('Vignette', 'vignette', 0, 1, 0.02);

  propsEl.appendChild(heading('Hilfen'));
  propsEl.appendChild(row('Bodenraster', checkbox(
    () => settings.showGrid,
    (v) => { settings.showGrid = v; applySettings(); markDirty(); },
  )));
  propsEl.appendChild(row('Schattenboden', checkbox(
    () => settings.showGround,
    (v) => { settings.showGround = v; applySettings(); markDirty(); },
  )));

  propsEl.appendChild(heading('Clip'));
  propsEl.appendChild(row('Dauer (s)', numInput(
    () => settings.duration,
    (v) => {
      settings.duration = Math.min(Math.max(v, 1), 120);
      setTime(Math.min(time, settings.duration));
      refreshTimeline();
      updateTimeDisplay();
      markDirty();
    },
    0.5,
  )));

  const camReset = document.createElement('div');
  camReset.className = 'btn-row';
  camReset.append(
    button('Kamera zurücksetzen', () => {
      engine.camera.position.set(0, 0.6, 5.2);
      engine.controls.target.set(0, 0, 0);
    }),
    button('Kamera-Keyframes löschen', () => {
      cameraKeyframes.length = 0;
      refreshTimeline();
      markDirty();
    }, 'danger'),
  );
  propsEl.appendChild(camReset);

  const note = document.createElement('p');
  note.className = 'empty-note';
  note.style.marginTop = '14px';
  note.textContent = 'Kein Objekt ausgewählt. Links ein Objekt hinzufügen oder im Viewport anklicken.';
  propsEl.appendChild(note);
}

function applySettings(): void {
  (engine.scene.background as THREE.Color).set(settings.bg);
  engine.bloomPass.strength = settings.bloom;
  engine.renderer.toneMappingExposure = settings.exposure;
  const u = engine.fxPass.uniforms;
  u.uGrain.value = settings.grain;
  u.uScan.value = settings.scan;
  u.uGrid.value = settings.grid;
  u.uVignette.value = settings.vignette;
  u.uRgb.value = settings.rgb;
  u.uWarp.value = settings.warp;
  u.uGlitchFx.value = settings.glitchFx;
  u.uPixel.value = settings.pixel;
  u.uBlur.value = settings.blur;
  u.uTint.value = settings.tint;
  (u.uTintA.value as THREE.Color).set(settings.tintA);
  (u.uTintB.value as THREE.Color).set(settings.tintB);
  engine.fog.color.set(settings.fogColor);
  engine.fog.density = Math.max(settings.fog, 0.00001);
  engine.key.color.set(settings.keyColor);
  engine.key.intensity = settings.keyIntensity;
  engine.hemi.intensity = settings.hemi;
  for (const obj of objects) obj.setFog(settings.fogColor, settings.fog);
  engine.grid.visible = settings.showGrid;
  engine.ground.visible = settings.showGround;
}

// ---------------------------------------------------------------- picking

let downX = 0, downY = 0;
const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.12 };

canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
  const giz = engine.gizmo as unknown as { dragging: boolean; axis: string | null };
  if (giz.dragging || giz.axis) return;

  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, engine.camera);
  const hits = raycaster.intersectObjects(engine.world.children, true);
  for (const hit of hits) {
    const id = hit.object.userData.objId as string | undefined;
    if (id) {
      const obj = objects.find((o) => o.id === id);
      if (obj) { select(obj); return; }
    }
  }
  select(null);
});

// gizmo mode buttons (mobile has no W/E/R keys)
type GizmoMode = 'translate' | 'rotate' | 'scale';
function setGizmoMode(mode: GizmoMode): void {
  engine.gizmo.setMode(mode);
  for (const m of ['translate', 'rotate', 'scale'] as const) {
    $(`mode-${m}`).classList.toggle('on', m === mode);
  }
}
(['translate', 'rotate', 'scale'] as const).forEach((m) => {
  $(`mode-${m}`).addEventListener('click', () => setGizmoMode(m));
});

// drawers (mobile)
function closeDrawers(): void {
  document.body.classList.remove('left-open', 'right-open');
}
$('fab-left').addEventListener('click', () => {
  document.body.classList.toggle('left-open');
  document.body.classList.remove('right-open');
});
$('fab-right').addEventListener('click', () => {
  document.body.classList.toggle('right-open');
  document.body.classList.remove('left-open');
});
$('backdrop').addEventListener('click', closeDrawers);
canvas.addEventListener('pointerdown', closeDrawers);

// gizmo edits -> live prop refresh + auto-key on release
engine.gizmo.addEventListener('objectChange', () => refreshPropValues());
engine.gizmo.addEventListener('dragging-changed', (e) => {
  const dragging = (e as unknown as { value: boolean }).value;
  if (!dragging && selected) autoKeyframe(selected);
});

// ---------------------------------------------------------------- toolbar / transport

document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    addObject(btn.dataset.add as ObjectKind);
    closeDrawers();
  });
});

playBtn.addEventListener('click', () => setPlaying(!playing));
$('btn-rewind').addEventListener('click', () => setTime(0));
$('btn-loop').addEventListener('click', () => {
  looping = !looping;
  $('btn-loop').classList.toggle('on', looping);
});
$('btn-autokey').addEventListener('click', () => {
  autoKey = !autoKey;
  $('btn-autokey').classList.toggle('on', autoKey);
});
$('btn-key').addEventListener('click', keyframeSelected);
$('btn-camkey').addEventListener('click', () => {
  upsertKeyframe(cameraKeyframes, time, captureCameraState(), defaultEasing);
  refreshTimeline();
  markDirty();
});
easingSelect.addEventListener('change', () => {
  defaultEasing = easingSelect.value as EasingName;
  if (timeline.selected) {
    timeline.selected.kf.easing = defaultEasing;
    markDirty();
  }
});

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement
    || t instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.code === 'KeyW') {
    setGizmoMode('translate');
  } else if (e.code === 'KeyE') {
    setGizmoMode('rotate');
  } else if (e.code === 'KeyR') {
    setGizmoMode('scale');
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    if (timeline.deleteSelected()) return;
    if (selected) removeObject(selected);
  } else if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (selected) duplicateObject(selected);
  }
});

// ---------------------------------------------------------------- project io

function serialize(): ProjectData {
  return {
    version: 1,
    settings: { ...settings },
    camera: {
      state: captureCameraState(),
      keyframes: cameraKeyframes.map((k) => ({ ...k, state: { ...k.state } })),
    },
    objects: objects.map((o) => o.toJSON()),
  };
}

function clearProject(): void {
  select(null);
  for (const obj of [...objects]) {
    engine.world.remove(obj.root);
    obj.dispose();
  }
  objects.length = 0;
  cameraKeyframes = [];
  setPlaying(false);
  time = 0;
}

function loadProject(data: ProjectData): void {
  clearProject();
  settings = { ...DEFAULT_SETTINGS, ...data.settings };
  cameraKeyframes = (data.camera?.keyframes ?? []).map((k) => ({ ...k }));
  if (data.camera?.state) applyCameraState(data.camera.state);
  for (const so of data.objects) {
    const obj = ClipObject.fromJSON(so);
    objects.push(obj);
    engine.world.add(obj.root);
  }
  applySettings();
  refreshSceneList();
  refreshTimeline();
  renderProps();
  setTime(0);
}

$('btn-save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'motion-clip.json');
});

const fileInput = $<HTMLInputElement>('file-load');
$('btn-load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    loadProject(JSON.parse(await file.text()) as ProjectData);
    markDirty();
  } catch {
    alert('Datei konnte nicht geladen werden.');
  }
});

$('btn-new').addEventListener('click', () => {
  if (!confirm('Projekt zurücksetzen? Nicht gespeicherte Änderungen gehen verloren.')) return;
  clearProject();
  settings = { ...DEFAULT_SETTINGS };
  applySettings();
  refreshSceneList();
  refreshTimeline();
  renderProps();
  markDirty();
});

// ---------------------------------------------------------------- export

function exportSize(): { w: number; h: number } {
  const sel = $<HTMLSelectElement>('export-res').value;
  if (sel === '1080p') return { w: 1920, h: 1080 };
  if (sel === 'square') return { w: 1080, h: 1080 };
  if (sel === 'vertical') return { w: 1080, h: 1920 };
  return { w: viewport.clientWidth, h: viewport.clientHeight };
}

function beginRenderMode(): () => void {
  const { w, h } = exportSize();
  const gizmoWasAttached = selected;
  const gridWas = engine.grid.visible;
  engine.gizmo.detach();
  engine.grid.visible = false;
  engine.controls.enabled = false;
  engine.renderer.setPixelRatio(1);
  engine.setRenderSize(w, h, false);
  return () => {
    engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    engine.resizeToViewport();
    engine.grid.visible = gridWas;
    engine.controls.enabled = true;
    if (gizmoWasAttached) engine.gizmo.attach(gizmoWasAttached.root);
  };
}

$('btn-png').addEventListener('click', () => {
  const restore = beginRenderMode();
  applyTime(time);
  engine.composer.render();
  const url = canvas.toDataURL('image/png');
  restore();
  const a = document.createElement('a');
  a.href = url;
  a.download = 'frame.png';
  a.click();
});

$('btn-export').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;
  setPlaying(false);
  const overlay = $('export-overlay');
  const progress = $('export-progress');
  const status = $('export-status');
  overlay.hidden = false;
  const restore = beginRenderMode();
  try {
    const blob = await exportWebM({
      canvas,
      duration: settings.duration,
      fps: settings.fps,
      seek: (t) => {
        time = Math.min(t, settings.duration);
        for (const obj of objects) obj.applyTime(time);
        const cam = sampleKeyframes(cameraKeyframes, time);
        if (cam) applyCameraState(cam);
        engine.setFxTime(time);
        engine.composer.render();
      },
      onProgress: (f) => {
        progress.style.width = `${Math.round(f * 100)}%`;
        status.textContent = `${Math.round(f * 100)} %`;
      },
    });
    downloadBlob(blob, blob.type.includes('mp4') ? 'motion-clip.mp4' : 'motion-clip.webm');
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Export fehlgeschlagen.');
  } finally {
    restore();
    overlay.hidden = true;
    exporting = false;
    setTime(0);
  }
});

// ---------------------------------------------------------------- randomizer

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const chance = (p: number): boolean => Math.random() < p;

// kuratierte Kino-Paletten: [Schatten, Licht]
const PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#0e2a38', '#ff9a3c'], // Teal & Orange
  ['#1a0533', '#00eaff'], // Cyber
  ['#160607', '#ff2e4d'], // Crimson
  ['#0d0b06', '#ffd166'], // Gold Noir
  ['#03170e', '#8dff57'], // Acid
  ['#050505', '#ffffff'], // Mono
  ['#120a2a', '#c77dff'], // Violet Dream
  ['#04141f', '#bfe9ff'], // Ice
  ['#200a00', '#ff5e00'], // Ember
  ['#001a12', '#00ffc8'], // Emerald Neon
];

const EASING_POOL = ['easeInOut', 'easeIn', 'easeOut', 'linear'] as const;

function randomLook(): void {
  const [dark, light] = pick(PALETTES);
  settings.tintA = dark;
  settings.tintB = light;
  settings.tint = chance(0.85) ? rand(0.45, 1) : 0;
  settings.bg = chance(0.7) ? '#000000' : dark;
  settings.bloom = rand(0.25, 1.1);
  settings.exposure = rand(0.95, 1.5);
  settings.rgb = chance(0.7) ? rand(0.1, 0.6) : 0;
  settings.warp = chance(0.45) ? rand(0.08, 0.5) : 0;
  settings.glitchFx = chance(0.6) ? rand(0.1, 0.7) : 0;
  settings.pixel = chance(0.12) ? rand(0.15, 0.5) : 0;
  settings.blur = chance(0.55) ? rand(0.15, 0.8) : 0;
  settings.scan = chance(0.7) ? rand(0.05, 0.3) : 0;
  settings.grain = rand(0.02, 0.16);
  settings.grid = chance(0.5) ? rand(0.05, 0.25) : 0;
  settings.vignette = rand(0.35, 0.9);
  settings.fog = chance(0.6) ? rand(0.02, 0.1) : 0;
  settings.fogColor = chance(0.5) ? '#000000' : dark;
  settings.keyColor = chance(0.6) ? light : '#ffffff';
  settings.keyIntensity = rand(0.8, 3);
  settings.hemi = rand(0.2, 0.9);
  applySettings();
  renderProps();
  markDirty();
}

/** Drehung + Glitch-Pulse; Start- und Endzustand identisch -> sauberer Loop. */
function cloudAnim(obj: ClipObject): void {
  const dur = settings.duration;
  const turns = pick([-1, 1]) * pick([1, 1, 2]) * Math.PI * 2;
  const glLow = rand(0, 0.12);
  const mids = Array.from(
    { length: 2 + Math.floor(Math.random() * 3) },
    () => rand(0.5, dur - 0.5),
  ).sort((a, b) => a - b);
  const times = [0, ...mids, dur];
  times.forEach((t, i) => {
    const isEdge = i === 0 || i === times.length - 1;
    kfAt(obj, t, {
      ry: (t / dur) * turns,
      gl: isEdge ? glLow : rand(0.2, 1),
    }, pick(EASING_POOL));
  });
}

/** Kreisbahn um den Ursprung (linear -> gleichmäßige Bewegung, loopt sauber). */
function orbitAnim(obj: ClipObject, radius: number, y: number, dirTurns: number): void {
  const dur = settings.duration;
  const phase = rand(0, Math.PI * 2);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * dur;
    const a = phase + (t / dur) * dirTurns * Math.PI * 2;
    kfAt(obj, t, { px: Math.cos(a) * radius, py: y, pz: Math.sin(a) * radius }, 'linear');
  }
}

function randomScene(): void {
  if (objects.length > 0
    && !confirm('Aktuelle Szene durch einen zufälligen Chaos-Mix ersetzen?')) return;
  clearProject();
  settings.duration = pick([6, 8, 8, 10]);
  randomLook();
  const dur = settings.duration;
  const light = settings.tintB;

  const nClouds = chance(0.5) ? 2 : 1;
  const cloudKinds: readonly ObjectKind[] = ['cloudSphere', 'cloudKnot', 'cloudTorus', 'cloudWave'];
  for (let i = 0; i < nClouds; i++) {
    const obj = spawn(pick(cloudKinds));
    const sc = rand(0.7, 1.4);
    const col = chance(0.55) ? { r: 1, g: 1, b: 1 } : hexToRgb(light);
    obj.applyState({
      ...obj.captureState(),
      px: rand(-0.8, 0.8) * i, py: rand(-0.4, 0.4),
      sx: sc, sy: sc, sz: sc,
      di: rand(0.1, 0.55), size: rand(0.9, 2.2),
      cr: col.r, cg: col.g, cb: col.b, op: rand(0.75, 1),
    });
    cloudAnim(obj);
  }

  if (chance(0.55)) {
    const obj = spawn(pick(['torusKnot', 'icosahedron', 'torus', 'box'] as const));
    obj.setStaticMaterial({
      wireframe: chance(0.5), metalness: rand(0.3, 1), roughness: rand(0.05, 0.6),
    });
    const sc = rand(0.3, 0.7);
    const col = hexToRgb(chance(0.5) ? light : '#ffffff');
    obj.applyState({
      ...obj.captureState(),
      sx: sc, sy: sc, sz: sc,
      cr: col.r, cg: col.g, cb: col.b,
      em: chance(0.6) ? rand(0.4, 2.2) : 0,
    });
    orbitAnim(obj, rand(1.6, 2.6), rand(-0.6, 1.2), pick([-1, 1]));
  }

  if (chance(0.85)) {
    const p = spawn('particles');
    p.applyState({ ...p.captureState(), op: rand(0.25, 0.6), size: rand(0.008, 0.03) });
    kfAt(p, 0, { ry: 0 }, 'linear');
    kfAt(p, dur, { ry: pick([-1, 1]) * Math.PI * rand(0.3, 0.8) }, 'linear');
  }

  const nLights = chance(0.7) ? 1 + (chance(0.4) ? 1 : 0) : 0;
  for (let i = 0; i < nLights; i++) {
    const l = spawn('pointLight');
    const col = hexToRgb(chance(0.6) ? light : pick(PALETTES)[1]);
    l.applyState({
      ...l.captureState(),
      cr: col.r, cg: col.g, cb: col.b, in: rand(4, 14),
    });
    orbitAnim(l, rand(1.8, 3.2), rand(0, 2), pick([-1, 1]));
  }

  if (chance(0.45)) {
    const words = ['motion', 'pulse', 'flux', 'echo', 'void', 'drift', 'neon', 'fragment', 'signal', 'chaos'];
    const cap = spawn('text', { text: pick(words) });
    const sc = rand(0.3, 0.55);
    cap.applyState({
      ...cap.captureState(),
      py: rand(-2.1, -1.6), sx: sc, sy: sc, sz: sc, op: rand(0.5, 0.9),
    });
  }

  // langsame Kamerafahrt
  const a0 = rand(0, Math.PI * 2);
  const r0 = rand(4.6, 6.4);
  const y0 = rand(0.3, 1.6);
  const a1 = a0 + rand(-0.7, 0.7);
  const r1 = r0 * rand(0.72, 0.94);
  const y1 = y0 + rand(-0.4, 0.5);
  cameraKeyframes = [];
  upsertKeyframe(cameraKeyframes, 0, {
    px: Math.cos(a0) * r0, py: y0, pz: Math.sin(a0) * r0, tx: 0, ty: 0, tz: 0,
  }, 'easeInOut');
  upsertKeyframe(cameraKeyframes, dur, {
    px: Math.cos(a1) * r1, py: y1, pz: Math.sin(a1) * r1, tx: 0, ty: 0, tz: 0,
  }, 'easeInOut');

  refreshSceneList();
  refreshTimeline();
  renderProps();
  setTime(0);
  markDirty();
  setPlaying(true);
}

$('btn-rnd-look').addEventListener('click', randomLook);
$('btn-rnd-scene').addEventListener('click', randomScene);

// ---------------------------------------------------------------- demo scene

function kfAt(obj: ClipObject, t: number, patch: AnimState, easing: EasingName = 'easeInOut'): void {
  const s = { ...obj.captureState(), ...patch };
  upsertKeyframe(obj.keyframes, t, s, easing);
}

function buildDemo(): void {
  clearProject();
  settings = { ...DEFAULT_SETTINGS };

  const cloud = new ClipObject('cloudKnot', 'Figur');
  cloud.applyState({ ...cloud.captureState(), sx: 1.15, sy: 1.15, sz: 1.15, di: 0.3 });
  const glitchCurve: Array<[number, number]> = [
    [0, 0.06], [1.8, 0.85], [2.4, 0.12], [5.2, 0.7], [6.0, 0.15], [8, 0.06],
  ];
  for (const [t, gl] of glitchCurve) {
    const ry = (t / 8) * Math.PI * 2;
    kfAt(cloud, t, { gl, ry }, t === 1.8 || t === 5.2 ? 'easeIn' : 'easeOut');
  }
  objects.push(cloud);
  engine.world.add(cloud.root);

  const caption = new ClipObject('text', 'Caption', { text: 'motion' });
  caption.applyState({
    ...caption.captureState(),
    py: -1.9, sx: 0.45, sy: 0.45, sz: 0.45, op: 0.85,
  });
  objects.push(caption);
  engine.world.add(caption.root);

  const dust = new ClipObject('particles', 'Staub');
  dust.applyState({ ...dust.captureState(), op: 0.35, size: 0.012 });
  kfAt(dust, 0, { ry: 0 }, 'linear');
  kfAt(dust, 8, { ry: Math.PI * 0.5 }, 'linear');
  objects.push(dust);
  engine.world.add(dust.root);

  applySettings();
  refreshSceneList();
  refreshTimeline();
  renderProps();
  setTime(0);
}

// ---------------------------------------------------------------- boot

function boot(): void {
  let restored = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      loadProject(JSON.parse(raw) as ProjectData);
      restored = true;
    }
  } catch { /* defekter Speicherstand — Demo laden */ }
  if (!restored) buildDemo();
  updateTimeDisplay();
  requestAnimationFrame(frame);
}

boot();
