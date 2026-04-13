import { state, selectedTrack } from './state';
import { Track, TrackFx } from './types';
import { applyFx } from './audio';

// ─── FX Overlay Panel ─────────────────────────────────────────────────────────

let panel: HTMLElement | null = null;
let currentTrackId: string | null = null;

export function initFxPanel(overlayEl: HTMLElement) {
  panel = overlayEl;

  document.addEventListener('daw:openFx', (e: Event) => {
    const id = (e as CustomEvent).detail.id as string;
    openFxPanel(id);
  });

  overlayEl.querySelector('.fx-close')?.addEventListener('click', closeFxPanel);
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeFxPanel();
  });
}

function openFxPanel(id: string) {
  if (!panel) return;
  const track = state.tracks.find(t => t.id === id);
  if (!track) return;
  currentTrackId = id;
  renderFxControls(panel, track);
  panel.classList.add('open');
}

function closeFxPanel() {
  panel?.classList.remove('open');
  currentTrackId = null;
}

function renderFxControls(container: HTMLElement, track: Track) {
  const body = container.querySelector('.fx-body');
  if (!body) return;
  body.innerHTML = '';

  const title = container.querySelector('.fx-title');
  if (title) title.textContent = `FX — ${track.name}`;

  const fx = track.fx;

  const knobs: Array<{ label: string; key: keyof TrackFx; min: number; max: number; step: number }> = [
    { label: 'GAIN',    key: 'gain',   min: 0,    max: 2,     step: 0.01 },
    { label: 'PAN',     key: 'pan',    min: -1,   max: 1,     step: 0.01 },
    { label: 'CUTOFF',  key: 'cutoff', min: 80,   max: 20000, step: 10   },
    { label: 'RES',     key: 'res',    min: 0,    max: 20,    step: 0.1  },
    { label: 'REVERB',  key: 'room',   min: 0,    max: 1,     step: 0.01 },
    { label: 'DELAY',   key: 'delay',  min: 0,    max: 1,     step: 0.01 },
    { label: 'CRUSH',   key: 'crush',  min: 1,    max: 16,    step: 1    },
  ];

  const grid = document.createElement('div');
  grid.className = 'fx-grid';

  knobs.forEach(({ label, key, min, max, step }) => {
    const wrap = document.createElement('div');
    wrap.className = 'fx-knob-wrap';

    const canvas = document.createElement('canvas');
    canvas.className = 'fx-knob';
    canvas.width  = 64;
    canvas.height = 64;
    canvas.title  = label;

    const valEl = document.createElement('span');
    valEl.className = 'fx-knob-val';
    valEl.textContent = formatFxVal(key, fx[key]);

    drawKnob(canvas, fx[key], min, max, track.color);

    let dragging = false;
    let startY   = 0;
    let startVal = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY   = e.clientY;
      startVal = fx[key];
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const delta = (startY - e.clientY) / 120;
      const range = max - min;
      let   newVal = Math.min(max, Math.max(min, startVal + delta * range));
      newVal = Math.round(newVal / step) * step;
      (fx as any)[key] = newVal;
      valEl.textContent = formatFxVal(key, newVal);
      drawKnob(canvas, newVal, min, max, track.color);
      applyFx(track.id, fx);
    });

    canvas.addEventListener('pointerup', () => { dragging = false; });

    const lbl = document.createElement('span');
    lbl.className = 'fx-knob-label';
    lbl.textContent = label;

    wrap.appendChild(canvas);
    wrap.appendChild(valEl);
    wrap.appendChild(lbl);
    grid.appendChild(wrap);
  });

  body.appendChild(grid);
}

// ─── Knob canvas drawing ──────────────────────────────────────────────────────

function drawKnob(canvas: HTMLCanvasElement, value: number, min: number, max: number, color: string) {
  const ctx  = canvas.getContext('2d')!;
  const w    = canvas.width;
  const h    = canvas.height;
  const cx   = w / 2;
  const cy   = h / 2;
  const r    = Math.min(w, h) / 2 - 6;
  const norm = (value - min) / (max - min);
  const startAngle = Math.PI * 0.75;
  const endAngle   = startAngle + norm * Math.PI * 1.5;

  ctx.clearRect(0, 0, w, h);

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
  ctx.strokeStyle = '#333';
  ctx.lineWidth   = 5;
  ctx.stroke();

  // Value arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 5;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Pointer line
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(endAngle) * (r - 2), cy + Math.sin(endAngle) * (r - 2));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth   = 2;
  ctx.stroke();
}

function formatFxVal(key: keyof TrackFx, v: number): string {
  if (key === 'cutoff') return `${Math.round(v)}Hz`;
  if (key === 'crush')  return `${Math.round(v)}bit`;
  if (key === 'pan')    return v === 0 ? 'C' : v > 0 ? `R${(v*100).toFixed(0)}` : `L${(-v*100).toFixed(0)}`;
  return v.toFixed(2);
}
