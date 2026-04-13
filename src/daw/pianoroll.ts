import { state, selectedTrack } from './state';
import { MelodyTrack } from './types';
import { rebuildSequence } from './audio';

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const OCTAVES    = [6, 5, 4, 3, 2];
const STEP_W     = 48;
const NOTE_H     = 18;
const KEY_W      = 44;
const TOTAL_NOTES = NOTE_NAMES.length * OCTAVES.length;

// ─── State ────────────────────────────────────────────────────────────────────

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let playheadStep = 0;
let rafId = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noteIndex(noteName: string): number {
  const match = noteName.match(/^([A-G]#?)(\d)$/);
  if (!match) return -1;
  const [, name, octStr] = match;
  const oct = parseInt(octStr);
  const ni  = NOTE_NAMES.indexOf(name);
  return OCTAVES.indexOf(oct) * 12 + ni;
}

function indexToNote(row: number): string {
  const octIdx = Math.floor(row / 12);
  const ni     = row % 12;
  return `${NOTE_NAMES[ni]}${OCTAVES[octIdx]}`;
}

function isBlack(ni: number) {
  return [1,3,6,8,10].includes(ni % 12);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function draw() {
  const track = selectedTrack();
  if (!canvas || !ctx) return;

  const steps  = (track?.type === 'melody') ? (track as MelodyTrack).steps.length : 16;
  const width  = KEY_W + steps * STEP_W;
  const height = TOTAL_NOTES * NOTE_H;

  canvas.width  = width;
  canvas.height = height;

  // Background rows
  for (let row = 0; row < TOTAL_NOTES; row++) {
    const ni   = row % 12;
    ctx.fillStyle = isBlack(ni) ? '#1a1a2e' : '#12122a';
    ctx.fillRect(KEY_W, row * NOTE_H, steps * STEP_W, NOTE_H);
  }

  // Vertical step lines
  ctx.strokeStyle = '#ffffff18';
  ctx.lineWidth   = 1;
  for (let s = 0; s <= steps; s++) {
    const x = KEY_W + s * STEP_W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Playhead
  if (track && playheadStep >= 0) {
    ctx.fillStyle = '#ffffff22';
    ctx.fillRect(KEY_W + playheadStep * STEP_W, 0, STEP_W, height);
  }

  // Notes
  if (track?.type === 'melody') {
    const mt = track as MelodyTrack;
    mt.steps.forEach((note, stepIdx) => {
      if (!note) return;
      const row = noteIndex(note);
      if (row < 0) return;
      ctx.fillStyle = track.color + 'cc';
      ctx.fillRect(KEY_W + stepIdx * STEP_W + 2, row * NOTE_H + 2, STEP_W - 4, NOTE_H - 4);
    });
  }

  // Piano keys
  for (let row = 0; row < TOTAL_NOTES; row++) {
    const ni    = row % 12;
    const black = isBlack(ni);
    ctx.fillStyle = black ? '#111' : '#e8e8e8';
    ctx.fillRect(0, row * NOTE_H, KEY_W - 1, NOTE_H - 1);

    if (!black) {
      ctx.fillStyle = '#888';
      ctx.font      = '9px monospace';
      ctx.fillText(indexToNote(row), 2, row * NOTE_H + NOTE_H - 4);
    }
  }

  rafId = requestAnimationFrame(draw);
}

// ─── Interaction ──────────────────────────────────────────────────────────────

function handleClick(e: PointerEvent) {
  const track = selectedTrack();
  if (!track || track.type !== 'melody') return;
  const mt = track as MelodyTrack;

  const rect = canvas.getBoundingClientRect();
  const x    = e.clientX - rect.left;
  const y    = e.clientY - rect.top;
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx   = x * scaleX;
  const cy   = y * scaleY;

  if (cx < KEY_W) return; // piano key click — preview note later

  const step  = Math.floor((cx - KEY_W) / STEP_W);
  const row   = Math.floor(cy / NOTE_H);
  if (step < 0 || step >= mt.steps.length || row < 0 || row >= TOTAL_NOTES) return;

  const note = indexToNote(row);
  mt.steps[step] = mt.steps[step] === note ? null : note;
  rebuildSequence(track.id);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initPianoRoll(canvasEl: HTMLCanvasElement) {
  canvas = canvasEl;
  ctx    = canvas.getContext('2d')!;
  canvas.addEventListener('pointerdown', handleClick);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(draw);
}

export function setPianoRollStep(step: number) {
  playheadStep = step;
}

export function destroyPianoRoll() {
  cancelAnimationFrame(rafId);
}
