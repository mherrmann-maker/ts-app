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

function addObject(kind: ObjectKind): ClipObject {
  const count = objects.filter((o) => o.kind === kind).length + 1;
  const name = count > 1 ? `${KIND_LABEL[kind]} ${count}` : KIND_LABEL[kind];
  const extra = kind === 'text' ? { text: 'motion' } : {};
  const obj = new ClipObject(kind, name, extra);
  obj.setCloudTime(time);
  objects.push(obj);
  engine.world.add(obj.root);
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
  propsEl.appendChild(heading('Szene'));
  propsEl.appendChild(row('Hintergrund', colorInput(
    () => settings.bg,
    (hex) => { settings.bg = hex; applySettings(); markDirty(); },
  )));
  const slider = (
    label: string, key: keyof SceneSettings, min: number, max: number, step: number,
  ) => {
    propsEl.appendChild(row(label, rangeInput(
      () => settings[key] as number,
      (v) => { (settings[key] as number) = v; applySettings(); markDirty(); },
      min, max, step,
    )));
  };
  slider('Bloom', 'bloom', 0, 1.5, 0.02);
  slider('Belichtung', 'exposure', 0.4, 2.2, 0.02);

  propsEl.appendChild(heading('Look (Post-FX)'));
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
  engine.fxPass.uniforms.uGrain.value = settings.grain;
  engine.fxPass.uniforms.uScan.value = settings.scan;
  engine.fxPass.uniforms.uGrid.value = settings.grid;
  engine.fxPass.uniforms.uVignette.value = settings.vignette;
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
