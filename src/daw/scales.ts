import { state, selectedTrack } from './state';
import { MelodyTrack, ChordTrack } from './types';
import { rebuildSequence } from './audio';

// ─── Scale definitions ────────────────────────────────────────────────────────

const SCALE_INTERVALS: Record<string, number[]> = {
  major:          [0, 2, 4, 5, 7, 9, 11],
  minor:          [0, 2, 3, 5, 7, 8, 10],
  dorian:         [0, 2, 3, 5, 7, 9, 10],
  phrygian:       [0, 1, 3, 5, 7, 8, 10],
  lydian:         [0, 2, 4, 6, 7, 9, 11],
  mixolydian:     [0, 2, 4, 5, 7, 9, 10],
  locrian:        [0, 1, 3, 5, 6, 8, 10],
  pentatonicMaj:  [0, 2, 4, 7, 9],
  pentatonicMin:  [0, 3, 5, 7, 10],
  blues:          [0, 3, 5, 6, 7, 10],
  wholeTone:      [0, 2, 4, 6, 8, 10],
  diminished:     [0, 2, 3, 5, 6, 8, 9, 11],
  chromatic:      [0,1,2,3,4,5,6,7,8,9,10,11],
};

const ROOT_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_MIDI:  Record<string, number> = {
  'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11
};

export function getScaleNotes(root: string, type: string, octave = 4): string[] {
  const intervals = SCALE_INTERVALS[type] ?? SCALE_INTERVALS['major'];
  const rootMidi  = NOTE_MIDI[root] ?? 0;
  return intervals.map(i => {
    const midi = rootMidi + i;
    const name = ROOT_NOTES[midi % 12];
    const oct  = octave + Math.floor((rootMidi + i) / 12);
    return `${name}${oct}`;
  });
}

// ─── Chord progressions ───────────────────────────────────────────────────────

const CHORD_DEGREES: Record<string, number[][]> = {
  major: [
    [0,4,7],   // I   maj
    [2,5,9],   // ii  min
    [4,7,11],  // iii min
    [5,9,12],  // IV  maj
    [7,11,14], // V   maj
    [9,12,16], // vi  min
    [11,14,17],// vii dim
  ],
  minor: [
    [0,3,7],   // i   min
    [2,5,8],   // ii  dim
    [3,7,10],  // III maj
    [5,8,12],  // iv  min
    [7,10,14], // v   min
    [8,12,15], // VI  maj
    [10,14,17],// VII maj
  ],
};

export function getChordForDegree(root: string, scaleType: string, degree: number, octave = 4): string[] {
  const prog   = CHORD_DEGREES[scaleType] ?? CHORD_DEGREES['major'];
  const deltas = prog[degree % prog.length] ?? prog[0];
  const rootMidi = NOTE_MIDI[root] ?? 0;
  const base     = rootMidi + octave * 12;
  return deltas.map(d => {
    const midi = base + d;
    const name = ROOT_NOTES[midi % 12];
    const oct  = Math.floor(midi / 12);
    return `${name}${oct}`;
  });
}

// ─── UI rendering ─────────────────────────────────────────────────────────────

export function renderScalePanel(container: HTMLElement, onChange: () => void) {
  container.innerHTML = '';

  // Root picker
  const rootRow = document.createElement('div');
  rootRow.className = 'scale-row';
  rootRow.innerHTML = `<span class="scale-label">GRUNDTON</span>`;
  const rootSel = document.createElement('select');
  rootSel.className = 'scale-select';
  ROOT_NOTES.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    if (n === state.scale.root) opt.selected = true;
    rootSel.appendChild(opt);
  });
  rootSel.addEventListener('change', () => {
    state.scale.root = rootSel.value;
    renderKeyboard(kbEl);
    onChange();
  });
  rootRow.appendChild(rootSel);
  container.appendChild(rootRow);

  // Scale type picker
  const typeRow = document.createElement('div');
  typeRow.className = 'scale-row';
  typeRow.innerHTML = `<span class="scale-label">SKALA</span>`;
  const typeSel = document.createElement('select');
  typeSel.className = 'scale-select';
  Object.keys(SCALE_INTERVALS).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = k;
    if (k === state.scale.type) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener('change', () => {
    state.scale.type = typeSel.value;
    renderKeyboard(kbEl);
    onChange();
  });
  typeRow.appendChild(typeSel);
  container.appendChild(typeRow);

  // Keyboard display
  const kbEl = document.createElement('div');
  kbEl.className = 'scale-keyboard';
  renderKeyboard(kbEl);
  container.appendChild(kbEl);

  // Chord degree buttons
  const chordRow = document.createElement('div');
  chordRow.className = 'chord-degrees';
  chordRow.innerHTML = `<span class="scale-label">AKKORD-STUFEN</span>`;
  const prog = CHORD_DEGREES[state.scale.type] ?? CHORD_DEGREES['major'];
  prog.forEach((_, deg) => {
    const btn = document.createElement('button');
    btn.className = 'degree-btn' + (state.chordDegrees.includes(deg) ? ' active' : '');
    btn.textContent = ['I','II','III','IV','V','VI','VII'][deg];
    btn.addEventListener('click', () => {
      const idx = state.chordDegrees.indexOf(deg);
      if (idx >= 0) state.chordDegrees.splice(idx, 1);
      else          state.chordDegrees.push(deg);
      btn.classList.toggle('active', state.chordDegrees.includes(deg));
      applyChordDegrees();
      onChange();
    });
    chordRow.appendChild(btn);
  });
  container.appendChild(chordRow);
}

function renderKeyboard(container: HTMLElement) {
  container.innerHTML = '';
  const scaleNotes = getScaleNotes(state.scale.root, state.scale.type, 4);
  const noteNames  = scaleNotes.map(n => n.replace(/\d/, ''));
  const allNotes   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const isBlack    = (n: string) => n.includes('#');

  allNotes.forEach(n => {
    const key = document.createElement('div');
    key.className = 'piano-key' +
      (isBlack(n)          ? ' black'    : ' white') +
      (noteNames.includes(n) ? ' in-scale' : '');
    key.dataset.note = n;
    key.title = n;
    container.appendChild(key);
  });
}

function applyChordDegrees() {
  const track = selectedTrack();
  if (!track || track.type !== 'chord') return;
  const ct = track as ChordTrack;
  ct.chords = state.chordDegrees.map(deg =>
    getChordForDegree(state.scale.root, state.scale.type, deg)
  );
  rebuildSequence(track.id);
}
