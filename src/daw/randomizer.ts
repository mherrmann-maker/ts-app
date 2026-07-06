import { state } from './state';
import { DrumTrack, MelodyTrack, ChordTrack, TrackFx } from './types';
import { getScaleNotes, getChordForDegree } from './scales';

// ─── Random-Create: musically weighted generators ─────────────────────────────
// Not white noise — kicks favour downbeats, snares sit on 2+4, chords come
// from real progression catalogues, melodies stay in scale.

const rnd = Math.random;
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const range = (min: number, max: number) => min + rnd() * (max - min);

// ─── Scale & key ──────────────────────────────────────────────────────────────

const ROOTS  = ['C', 'D', 'D#', 'E', 'F', 'G', 'A', 'A#'];
const SCALES = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonicMin', 'blues'];

function randomizeKey() {
  state.scale.root = pick(ROOTS);
  state.scale.type = pick(SCALES);
}

// ─── Drums ────────────────────────────────────────────────────────────────────

function euclid(n: number, k: number, rot: number): boolean[] {
  const pattern: boolean[] = [];
  const ps = n / k;
  for (let i = 0; i < k; i++) {
    pattern.push(true);
    const gap = Math.round(ps * (i + 1)) - Math.round(ps * i) - 1;
    for (let j = 0; j < gap; j++) pattern.push(false);
  }
  while (pattern.length < n) pattern.push(false);
  const r = ((rot % n) + n) % n;
  const sliced = pattern.slice(0, n);
  return [...sliced.slice(r), ...sliced.slice(0, r)];
}

function kickPattern(len: number): boolean[] {
  const steps = new Array(len).fill(false);
  const style = pick(['fourFloor', 'broken', 'halftime']);
  if (style === 'fourFloor') {
    for (let i = 0; i < len; i += 4) steps[i] = chance(0.94);
    if (chance(0.4)) steps[pick([7, 10, 14])] = true;   // syncopation
  } else if (style === 'broken') {
    steps[0] = true;
    [3, 6, 8, 10, 13].forEach(i => { if (chance(0.35)) steps[i] = true; });
  } else {
    steps[0] = true; steps[8] = chance(0.8);
    if (chance(0.5)) steps[11] = true;
  }
  return steps;
}

function snarePattern(len: number): boolean[] {
  const steps = new Array(len).fill(false);
  steps[4] = true; steps[12] = true;                    // classic 2 + 4
  if (chance(0.3)) steps[pick([7, 10, 15])] = true;     // ghost hit
  if (chance(0.15)) { steps[12] = false; steps[13] = true; } // lazy snare
  return steps;
}

function hatPattern(len: number): boolean[] {
  const style = pick(['eighth', 'sixteenth', 'offbeat', 'euclid']);
  if (style === 'euclid') return euclid(len, pick([7, 9, 11]), Math.floor(rnd() * 4));
  const steps = new Array(len).fill(false);
  for (let i = 0; i < len; i++) {
    if (style === 'eighth'    && i % 2 === 0) steps[i] = chance(0.92);
    if (style === 'sixteenth')                steps[i] = chance(0.85);
    if (style === 'offbeat'   && i % 4 === 2) steps[i] = chance(0.95);
  }
  return steps;
}

function sparsePattern(len: number, p = 0.14): boolean[] {
  return Array.from({ length: len }, () => chance(p));
}

const DRUM_BANKS = ['RolandTR808', 'RolandTR909', 'LinnDrum', 'AkaiMPC60', 'EmuSP12'];

function randomizeDrums() {
  const bank = pick(DRUM_BANKS); // one machine for the whole kit = coherent sound
  state.tracks.forEach(t => {
    if (t.type !== 'drum') return;
    const d = t as DrumTrack;
    d.bank = bank;
    const len = d.steps.length;
    if (d.sound === 'bd')                       d.steps = kickPattern(len);
    else if (d.sound === 'sd' || d.sound === 'cp') d.steps = snarePattern(len);
    else if (d.sound === 'hh' || d.sound === 'oh') d.steps = hatPattern(len);
    else                                        d.steps = sparsePattern(len);
    d.mod.euclid = null; // pattern is baked into steps
  });
}

// ─── Chord progressions (degree catalogues) ───────────────────────────────────

const PROGRESSIONS: number[][] = [
  [0, 4, 5, 3],   // I  V  vi IV   (pop classic)
  [0, 5, 3, 4],   // I  vi IV V    (50s)
  [5, 3, 0, 4],   // vi IV I  V
  [0, 3, 4, 3],   // I  IV V  IV
  [1, 4, 0, 0],   // ii V  I  I    (jazz cadence)
  [0, 6, 5, 4],   // I  vii vi V
  [0, 2, 3, 4],   // I  iii IV V
  [5, 4, 3, 4],   // vi V  IV V
];

function randomizeChords() {
  const prog = pick(PROGRESSIONS);
  state.chordDegrees = [...prog];
  const octave = pick([3, 4]);
  state.tracks.forEach(t => {
    if (t.type !== 'chord') return;
    (t as ChordTrack).chords = prog.map(deg =>
      getChordForDegree(state.scale.root, state.scale.type, deg, octave));
  });
}

// ─── Melodies & arpeggios ─────────────────────────────────────────────────────

function bassLine(len: number): (string | null)[] {
  // Root/fifth/octave riff from current scale, low register
  const notes = getScaleNotes(state.scale.root, state.scale.type, 2);
  const root = notes[0];
  const fifth = notes[Math.min(4, notes.length - 1)];
  const octaveUp = root.replace(/\d/, m => String(parseInt(m) + 1));
  const pool = [root, root, fifth, octaveUp];
  const steps: (string | null)[] = new Array(len).fill(null);
  steps[0] = root;
  [2, 3, 6, 8, 10, 11, 14].forEach(i => {
    if (chance(0.42)) steps[i] = pick(pool);
  });
  return steps;
}

function leadMotif(len: number): (string | null)[] {
  // 3–6 note motif from the scale, placed rhythmically, repeated w/ variation
  const octave = pick([4, 5]);
  const scaleNotes = getScaleNotes(state.scale.root, state.scale.type, octave);
  const motifLen = 3 + Math.floor(rnd() * 4);
  const motif = Array.from({ length: motifLen }, () => pick(scaleNotes));
  const steps: (string | null)[] = new Array(len).fill(null);
  const density = range(0.35, 0.6);
  let m = 0;
  for (let i = 0; i < len; i++) {
    if (chance(density)) {
      steps[i] = motif[m % motif.length];
      m++;
    }
  }
  if (!steps.some(Boolean)) steps[0] = motif[0];
  return steps;
}

function arpeggio(len: number): (string | null)[] {
  // Chord tones of the progression's first degree, straight 16ths runs
  const deg = state.chordDegrees[0] ?? 0;
  const chord = getChordForDegree(state.scale.root, state.scale.type, deg, pick([4, 5]));
  const dir = pick(['up', 'down', 'updown']);
  let seq = [...chord];
  if (dir === 'down') seq.reverse();
  if (dir === 'updown') seq = [...chord, ...[...chord].reverse().slice(1, -1)];
  const steps: (string | null)[] = new Array(len).fill(null);
  const skip = pick([1, 1, 2]); // straight or half-time arp
  for (let i = 0, m = 0; i < len; i += skip, m++) {
    steps[i] = seq[m % seq.length];
  }
  return steps;
}

function randomizeMelodies() {
  const melodies = state.tracks.filter(t => t.type === 'melody') as MelodyTrack[];
  melodies.forEach((t, idx) => {
    const isBass = /bass/i.test(t.name) || idx === 0;
    if (isBass) {
      t.steps = bassLine(t.steps.length);
      t.octave = 2;
      t.mod.arpMode = 'off';
    } else if (chance(0.45)) {
      t.steps = arpeggio(t.steps.length);
      t.octave = pick([4, 5]);
      t.mod.arpMode = pick(['off', 'up', 'updown']);
    } else {
      t.steps = leadMotif(t.steps.length);
      t.octave = pick([4, 5]);
      t.mod.arpMode = 'off';
    }
  });
}

// ─── Synth & FX settings ──────────────────────────────────────────────────────

const SYNTHS = ['sawtooth', 'square', 'triangle', 'sine', 'moog', 'piano'];

function randomFx(fx: TrackFx, isDrum: boolean) {
  if (isDrum) {
    fx.gain   = range(0.8, 1.05);
    fx.room   = chance(0.4) ? range(0, 0.3) : 0;
    fx.delay  = 0;
    fx.cutoff = 8000;
    fx.res    = 1;
    fx.crush  = chance(0.12) ? Math.round(range(8, 12)) : 16;
    fx.pan    = 0;
  } else {
    fx.gain   = range(0.7, 1);
    fx.pan    = range(-0.35, 0.35);
    fx.cutoff = Math.round(400 * Math.pow(2, rnd() * 4.3)); // 400 Hz – ~8 kHz, log
    fx.res    = chance(0.35) ? range(2, 9) : 1;
    fx.room   = range(0, 0.55);
    fx.delay  = chance(0.45) ? range(0.1, 0.4) : 0;
    fx.crush  = chance(0.1) ? Math.round(range(6, 12)) : 16;
  }
}

function randomizeSynths() {
  state.tracks.forEach(t => {
    if (t.type === 'melody' || t.type === 'chord') {
      (t as MelodyTrack | ChordTrack).synth = pick(SYNTHS);
    }
    randomFx(t.fx, t.type === 'drum');
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RandomizeOptions {
  key?: boolean; drums?: boolean; chords?: boolean;
  melodies?: boolean; synths?: boolean;
}

export function randomizeProject(opts: RandomizeOptions = {}) {
  const all = Object.keys(opts).length === 0;
  if (all || opts.key)      randomizeKey();
  if (all || opts.chords)   randomizeChords();   // before melodies (arps use degrees)
  if (all || opts.drums)    randomizeDrums();
  if (all || opts.melodies) randomizeMelodies();
  if (all || opts.synths)   randomizeSynths();
}
