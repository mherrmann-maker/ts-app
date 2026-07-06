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
  shake: number;
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
  shake: 0,
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
let paletteRecolor = true;
let mediaTarget: ClipObject | null = null;

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
const mediaInput = $<HTMLInputElement>('file-media');

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
  if (!playing && !exporting) {
    for (const obj of objects) obj.syncVideo(time);
  }
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
  for (const obj of objects) obj.setVideoPlaying(p);
}

// Handkamera-Wackeln: nur bei Playback/Export, deterministisch über die
// Timeline-Zeit; Offset wird nach dem Rendern zurückgenommen, damit
// OrbitControls nicht driften.
const shakeSaved = new THREE.Vector3();
let shakeApplied = false;
engine.preRender = () => {
  if (!(playing || exporting) || settings.shake <= 0) return;
  shakeSaved.copy(engine.camera.position);
  const s = settings.shake;
  const w = (f: number, ph: number) =>
    Math.sin(time * f + ph) + 0.55 * Math.sin(time * f * 2.63 + ph * 1.7);
  engine.camera.position.x += w(1.9, 1.0) * 0.035 * s;
  engine.camera.position.y += w(2.4, 4.2) * 0.028 * s;
  engine.camera.position.z += w(1.5, 8.9) * 0.02 * s;
  shakeApplied = true;
};
engine.postRender = () => {
  if (!shakeApplied) return;
  engine.camera.position.copy(shakeSaved);
  shakeApplied = false;
};

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
  if ('sw' in state) {
    const e = stateEditor(obj, 'sw');
    propsEl.appendChild(row('Abstraktion', rangeInput(e.get, e.set, 0, 1, 0.01)));
  }
  if ('wr' in state) {
    const e = stateEditor(obj, 'wr');
    propsEl.appendChild(row('Warp', rangeInput(e.get, e.set, 0, 1, 0.01)));
  }
  if ('pix' in state) {
    const e = stateEditor(obj, 'pix');
    propsEl.appendChild(row('Pixelraster', rangeInput(e.get, e.set, 0, 1, 0.01)));
  }
  if ('duo' in state) {
    const e = stateEditor(obj, 'duo');
    propsEl.appendChild(row('Palette-Mix', rangeInput(e.get, e.set, 0, 1, 0.01)));
  }
  if (obj.kind === 'media') {
    propsEl.appendChild(row('Additiv', checkbox(
      () => obj.extra.blend === 'additive',
      (v) => { obj.setBlend(v ? 'additive' : 'normal'); markDirty(); },
    )));
    const replaceRow = document.createElement('div');
    replaceRow.className = 'btn-row';
    replaceRow.append(button('🖼 Datei ersetzen', () => {
      mediaTarget = obj;
      mediaInput.click();
    }));
    propsEl.appendChild(replaceRow);
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

  propsEl.appendChild(heading('Palette'));
  const palGrid = document.createElement('div');
  palGrid.className = 'pal-grid';
  for (const p of PALETTES) {
    const chip = document.createElement('button');
    chip.className = 'pal-chip';
    chip.title = p.name;
    for (const col of [p.dark, p.light, p.accent]) {
      const dot = document.createElement('span');
      dot.style.background = col;
      chip.appendChild(dot);
    }
    chip.addEventListener('click', () => applyPalette(p, paletteRecolor));
    palGrid.appendChild(chip);
  }
  propsEl.appendChild(palGrid);
  const palRow = document.createElement('div');
  palRow.className = 'btn-row';
  palRow.append(button('🎨 Harmonie würfeln', () => applyPalette(harmonyPalette(), paletteRecolor)));
  propsEl.appendChild(palRow);
  propsEl.appendChild(row('Objekte umfärben', checkbox(
    () => paletteRecolor,
    (v) => { paletteRecolor = v; },
  )));

  propsEl.appendChild(heading('Kamera'));
  const camRow = document.createElement('div');
  camRow.className = 'btn-row';
  camRow.append(button('🎲 Kamerafahrt würfeln', randomCamera));
  propsEl.appendChild(camRow);
  slider('Wackeln', 'shake', 0, 1, 0.02);

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
  for (const obj of objects) {
    obj.setFog(settings.fogColor, settings.fog);
    obj.setDuoColors(settings.tintA, settings.tintB);
  }
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

// Bild/Video laden -> neues Media-Objekt oder Datei am ausgewählten ersetzen
$('btn-add-media').addEventListener('click', () => {
  mediaTarget = null;
  mediaInput.click();
  closeDrawers();
});
mediaInput.addEventListener('change', async () => {
  const f = mediaInput.files?.[0];
  mediaInput.value = '';
  const target = mediaTarget;
  mediaTarget = null;
  if (!f) return;
  const isVideo = f.type.startsWith('video');
  const src = isVideo
    ? URL.createObjectURL(f)
    : await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
      r.readAsDataURL(f);
    });
  const obj = target ?? spawn('media');
  try {
    await obj.setMediaSource(src, isVideo ? 'video' : 'image');
  } catch {
    alert('Datei konnte nicht geladen werden.');
    if (!target) removeObject(obj);
    return;
  }
  obj.setDuoColors(settings.tintA, settings.tintB);
  if (playing) obj.setVideoPlaying(true);
  select(obj);
  refreshTimeline();
  markDirty();
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
  engine.render();
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
  for (const obj of objects) {
    obj.syncVideo(0);
    obj.setVideoPlaying(true);
  }
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
        engine.render();
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
    for (const obj of objects) obj.setVideoPlaying(false);
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

// kuratierte harmonische Kino-Paletten
interface Palette {
  name: string;
  bg: string;
  dark: string;
  light: string;
  accent: string;
}

const PALETTES: readonly Palette[] = [
  { name: 'Teal & Orange', bg: '#02090e', dark: '#0e2a38', light: '#ff9a3c', accent: '#3ec6c0' },
  { name: 'Cyber', bg: '#070113', dark: '#1a0533', light: '#00eaff', accent: '#ff2ee6' },
  { name: 'Crimson', bg: '#070203', dark: '#160607', light: '#ff2e4d', accent: '#ff9d8a' },
  { name: 'Gold Noir', bg: '#050402', dark: '#0d0b06', light: '#ffd166', accent: '#c8873a' },
  { name: 'Acid', bg: '#010a05', dark: '#03170e', light: '#8dff57', accent: '#eaff2e' },
  { name: 'Mono', bg: '#000000', dark: '#050505', light: '#ffffff', accent: '#9aa0b5' },
  { name: 'Violet Dream', bg: '#060312', dark: '#120a2a', light: '#c77dff', accent: '#6f5cff' },
  { name: 'Ice', bg: '#010a12', dark: '#04141f', light: '#bfe9ff', accent: '#4ea0e1' },
  { name: 'Ember', bg: '#0c0300', dark: '#200a00', light: '#ff5e00', accent: '#ffc491' },
  { name: 'Emerald Neon', bg: '#000a07', dark: '#001a12', light: '#00ffc8', accent: '#7bffe6' },
  { name: 'Neon Noir', bg: '#050208', dark: '#150a20', light: '#ff2e88', accent: '#2ee6ff' },
  { name: 'Pastell', bg: '#0b0d12', dark: '#2a2438', light: '#ffd6e8', accent: '#bcd8ff' },
  { name: 'Sunset', bg: '#0a0410', dark: '#2b0a3d', light: '#ff7e5f', accent: '#feb47b' },
  { name: 'Deep Sea', bg: '#00060d', dark: '#02182b', light: '#37d6c3', accent: '#2a6fdb' },
];

let currentPalette: Palette = PALETTES[0];

/** Farbtheorie-Generator: Basiston + Schema -> garantiert harmonische Palette. */
function harmonyPalette(): Palette {
  const h = Math.random();
  const scheme = pick(['analog', 'komplementaer', 'triade', 'split'] as const);
  const hex = (hh: number, s: number, l: number) =>
    `#${new THREE.Color().setHSL(((hh % 1) + 1) % 1, s, l).getHexString()}`;
  let h2 = h, h3 = h;
  if (scheme === 'analog') { h2 = h + 0.08; h3 = h - 0.08; }
  else if (scheme === 'komplementaer') { h2 = h + 0.5; h3 = h + 0.56; }
  else if (scheme === 'triade') { h2 = h + 1 / 3; h3 = h + 2 / 3; }
  else { h2 = h + 0.42; h3 = h + 0.58; }
  return {
    name: 'Harmonie',
    bg: hex(h, rand(0.35, 0.6), rand(0.02, 0.05)),
    dark: hex(h, rand(0.45, 0.65), rand(0.09, 0.16)),
    light: hex(h2, rand(0.75, 0.95), rand(0.55, 0.7)),
    accent: hex(h3, rand(0.7, 0.95), rand(0.45, 0.62)),
  };
}

/** Palette auf den Look anwenden; optional alle Objekte harmonisch umfärben. */
function applyPalette(p: Palette, recolorObjects: boolean): void {
  currentPalette = p;
  settings.tintA = p.dark;
  settings.tintB = p.light;
  settings.bg = p.bg;
  settings.fogColor = p.bg;
  settings.keyColor = p.light;

  if (recolorObjects) {
    let lightIdx = 0;
    for (const obj of objects) {
      let hexColor: string | null = null;
      if (isCloud(obj.kind)) hexColor = chance(0.5) ? '#ffffff' : p.light;
      else if (obj.kind === 'pointLight') hexColor = lightIdx++ % 2 === 0 ? p.light : p.accent;
      else if (obj.kind === 'particles' || obj.kind === 'text') hexColor = p.light;
      else if (obj.kind !== 'media') hexColor = chance(0.5) ? p.accent : '#ffffff';
      if (!hexColor) continue;
      const col = hexToRgb(hexColor);
      const s = obj.captureState();
      if (!('cr' in s)) continue;
      s.cr = col.r; s.cg = col.g; s.cb = col.b;
      obj.applyState(s);
      // Keyframes mitziehen, sonst springt die Farbe beim Abspielen zurück
      for (const kf of obj.keyframes) {
        if ('cr' in kf.state) {
          kf.state.cr = col.r; kf.state.cg = col.g; kf.state.cb = col.b;
        }
      }
    }
  }
  applySettings();
  renderProps();
  markDirty();
}

const EASING_POOL = ['easeInOut', 'easeIn', 'easeOut', 'linear'] as const;

function randomLook(): void {
  const p = chance(0.55) ? pick(PALETTES) : harmonyPalette();
  applyPalette(p, false);
  settings.tint = chance(0.85) ? rand(0.45, 1) : 0;
  settings.bg = chance(0.6) ? '#000000' : p.bg;
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
  settings.fogColor = chance(0.5) ? '#000000' : p.bg;
  settings.keyColor = chance(0.6) ? p.light : '#ffffff';
  settings.keyIntensity = rand(0.8, 3);
  settings.hemi = rand(0.2, 0.9);
  settings.shake = chance(0.35) ? rand(0.1, 0.5) : 0;
  applySettings();
  renderProps();
  markDirty();
}

/** Drehung + Glitch-/Abstraktions-Pulse; Start = Ende -> sauberer Loop. */
function cloudAnim(obj: ClipObject): void {
  const dur = settings.duration;
  const turns = pick([-1, 1]) * pick([1, 1, 2]) * Math.PI * 2;
  const glLow = rand(0, 0.12);
  const swirly = chance(0.45);
  const swLow = rand(0, 0.15);
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
      ...(swirly ? { sw: isEdge ? swLow : rand(0.2, 0.85) } : {}),
    }, pick(EASING_POOL));
  });
}

// -------------------------------------------------------- random camera

type CamPattern = 'orbit' | 'pushIn' | 'spiral' | 'drift' | 'riser';

/** Zufällige Kamerafahrt für die aktuelle Szene (ersetzt Kamera-Keyframes). */
function randomCamera(): void {
  const dur = settings.duration;
  const pattern: CamPattern = pick(['orbit', 'pushIn', 'spiral', 'drift', 'riser']);
  const a0 = rand(0, Math.PI * 2);
  const r0 = rand(4.4, 6.6);
  const y0 = rand(0.3, 1.8);
  cameraKeyframes = [];
  const put = (
    t: number, a: number, r: number, y: number, ty = 0,
    easing: 'easeInOut' | 'linear' = 'easeInOut',
  ) => {
    upsertKeyframe(cameraKeyframes, t, {
      px: Math.cos(a) * r, py: y, pz: Math.sin(a) * r, tx: 0, ty, tz: 0,
    }, easing);
  };

  if (pattern === 'orbit') {
    put(0, a0, r0, y0);
    put(dur, a0 + rand(-0.9, 0.9), r0 * rand(0.85, 1), y0 + rand(-0.3, 0.3));
  } else if (pattern === 'pushIn') {
    put(0, a0, r0, y0);
    put(dur, a0 + rand(-0.15, 0.15), r0 * rand(0.42, 0.62), y0 * rand(0.6, 0.9));
  } else if (pattern === 'spiral') {
    const dir = pick([-1, 1]);
    const sweep = rand(1.2, 2.2) * dir;
    const y1 = y0 + rand(0.8, 1.8);
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      put(f * dur, a0 + f * sweep, r0 * (1 - 0.4 * f), y0 + (y1 - y0) * f, 0, 'linear');
    }
  } else if (pattern === 'drift') {
    put(0, a0, r0, y0, rand(-0.4, 0.2));
    put(dur, a0 + rand(0.15, 0.35) * pick([-1, 1]), r0, y0 + rand(-0.2, 0.2), rand(0, 0.6));
  } else {
    // riser: von unten aufsteigen, Blick kippt nach unten
    put(0, a0, r0 * 0.9, rand(-1.4, -0.5), rand(0.4, 1));
    put(dur, a0 + rand(-0.4, 0.4), r0, rand(1.4, 2.6), rand(-0.4, 0));
  }

  refreshTimeline();
  applyTime(time);
  markDirty();
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
  const cloudKinds: readonly ObjectKind[] = [
    'cloudSphere', 'cloudKnot', 'cloudTorus', 'cloudWave',
    'cloudBlob', 'cloudGalaxy', 'cloudNet',
  ];
  for (let i = 0; i < nClouds; i++) {
    const obj = spawn(pick(cloudKinds));
    const sc = rand(0.7, 1.4);
    const col = chance(0.55) ? { r: 1, g: 1, b: 1 } : hexToRgb(light);
    obj.applyState({
      ...obj.captureState(),
      px: rand(-0.8, 0.8) * i, py: rand(-0.4, 0.4),
      sx: sc, sy: sc, sz: sc,
      di: rand(0.1, 0.55), sw: chance(0.4) ? rand(0.1, 0.6) : 0,
      size: rand(0.9, 2.2),
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
    const col = hexToRgb(chance(0.6) ? light : currentPalette.accent);
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

  randomCamera();

  refreshSceneList();
  refreshTimeline();
  renderProps();
  setTime(0);
  markDirty();
  setPlaying(true);
}

$('btn-rnd-look').addEventListener('click', randomLook);
$('btn-rnd-scene').addEventListener('click', randomScene);
$('btn-rnd-cam').addEventListener('click', randomCamera);

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
