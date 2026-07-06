import * as Tone from 'tone';

// ─── MOOG — Minimoog-style monophonic analog synth ────────────────────────────
// Signal flow (classic Model D):
//   3 × VCO (+ noise) → mixer → 24dB/oct lowpass ladder filter
//   with contour (filter envelope) → loudness contour (amp envelope) → out

type Wave = 'triangle' | 'sawtooth' | 'square' | 'pulse';
type Range = '32' | '16' | '8' | '4' | '2';

const RANGE_MULT: Record<Range, number> = { '32': 0.25, '16': 0.5, '8': 1, '4': 2, '2': 4 };

interface OscParams { wave: Wave; range: Range; detune: number; level: number; }

const P = {
  osc: [
    { wave: 'sawtooth' as Wave, range: '8'  as Range, detune: 0,   level: 0.8 },
    { wave: 'sawtooth' as Wave, range: '8'  as Range, detune: 7,   level: 0.55 },
    { wave: 'square'   as Wave, range: '16' as Range, detune: -5,  level: 0.4 },
  ] as OscParams[],
  noise:    0,
  cutoff:   1400,
  emphasis: 6,        // resonance Q
  contour:  3.2,      // filter env amount in octaves
  fAttack:  0.005, fDecay: 0.45, fSustain: 0.3,
  aAttack:  0.004, aDecay: 0.3,  aSustain: 0.85, aRelease: 0.35,
  glide:    0.04,
  lfoRate:  5,
  lfoAmt:   0,        // Hz onto filter cutoff
  volume:   0.75,
};

// ─── Audio graph (built lazily) ───────────────────────────────────────────────

let built = false;
let oscs: Tone.OmniOscillator<any>[] = [];
let oscGains: Tone.Gain[] = [];
let noise!: Tone.Noise;
let noiseGain!: Tone.Gain;
let filter!: Tone.Filter;
let filterEnv!: Tone.FrequencyEnvelope;
let ampEnv!: Tone.AmplitudeEnvelope;
let master!: Tone.Gain;
let lfo!: Tone.LFO;
let lfoGain!: Tone.Gain;

function buildGraph() {
  if (built) return;
  built = true;

  master = new Tone.Gain(P.volume).toDestination();
  ampEnv = new Tone.AmplitudeEnvelope({
    attack: P.aAttack, decay: P.aDecay, sustain: P.aSustain, release: P.aRelease,
  }).connect(master);

  filter = new Tone.Filter({ type: 'lowpass', rolloff: -24, frequency: P.cutoff, Q: P.emphasis })
    .connect(ampEnv);

  filterEnv = new Tone.FrequencyEnvelope({
    attack: P.fAttack, decay: P.fDecay, sustain: P.fSustain, release: 0.3,
    baseFrequency: P.cutoff, octaves: P.contour,
  });
  filterEnv.connect(filter.frequency);

  lfo = new Tone.LFO(P.lfoRate, -1, 1).start();
  lfoGain = new Tone.Gain(P.lfoAmt);
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  P.osc.forEach((op) => {
    const osc = new Tone.OmniOscillator(220, op.wave === 'pulse' ? 'pulse' : op.wave);
    osc.detune.value = op.detune;
    const g = new Tone.Gain(op.level).connect(filter);
    osc.connect(g).start();
    oscs.push(osc);
    oscGains.push(g);
  });

  noise = new Tone.Noise('white').start();
  noiseGain = new Tone.Gain(P.noise).connect(filter);
  noise.connect(noiseGain);
}

// ─── Note handling (mono, last-note priority, glide) ──────────────────────────

const heldNotes: number[] = [];
let currentMidi: number | null = null;

function midiToFreq(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }

function setPitch(midi: number, glide: boolean) {
  const base = midiToFreq(midi);
  oscs.forEach((osc, i) => {
    const f = base * RANGE_MULT[P.osc[i].range];
    if (glide && P.glide > 0.001) osc.frequency.rampTo(f, P.glide);
    else osc.frequency.setValueAtTime(f, Tone.now());
  });
}

export function moogNoteOn(midi: number) {
  buildGraph();
  const legato = heldNotes.length > 0;
  if (!heldNotes.includes(midi)) heldNotes.push(midi);
  currentMidi = midi;
  setPitch(midi, legato);
  if (!legato) {
    ampEnv.triggerAttack();
    filterEnv.triggerAttack();
  }
}

export function moogNoteOff(midi: number) {
  const idx = heldNotes.indexOf(midi);
  if (idx >= 0) heldNotes.splice(idx, 1);
  if (heldNotes.length > 0) {
    const prev = heldNotes[heldNotes.length - 1];
    currentMidi = prev;
    setPitch(prev, true);
  } else if (currentMidi !== null) {
    currentMidi = null;
    ampEnv.triggerRelease();
    filterEnv.triggerRelease();
  }
}

// ─── Param appliers ───────────────────────────────────────────────────────────

function applyOsc(i: number) {
  if (!built) return;
  const op = P.osc[i];
  oscs[i].type = (op.wave === 'pulse' ? 'pulse' : op.wave) as any;
  oscs[i].detune.value = op.detune;
  oscGains[i].gain.rampTo(op.level, 0.03);
  if (currentMidi !== null) setPitch(currentMidi, false);
}

function applyFilter() {
  if (!built) return;
  filter.Q.rampTo(P.emphasis, 0.03);
  filterEnv.baseFrequency = P.cutoff;
  filterEnv.octaves = P.contour;
  filterEnv.attack  = P.fAttack;
  filterEnv.decay   = P.fDecay;
  filterEnv.sustain = P.fSustain;
  if (currentMidi === null) filter.frequency.rampTo(P.cutoff, 0.03);
}

function applyAmp() {
  if (!built) return;
  ampEnv.attack  = P.aAttack;
  ampEnv.decay   = P.aDecay;
  ampEnv.sustain = P.aSustain;
  ampEnv.release = P.aRelease;
}

function applyMisc() {
  if (!built) return;
  noiseGain.gain.rampTo(P.noise, 0.03);
  master.gain.rampTo(P.volume, 0.03);
  lfo.frequency.rampTo(P.lfoRate, 0.03);
  lfoGain.gain.rampTo(P.lfoAmt, 0.03);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function knob(label: string, min: number, max: number, get: () => number,
              set: (v: number) => void, fmt: (v: number) => string,
              log = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'moog-knob-wrap';
  const cvs = document.createElement('canvas');
  cvs.width = 58; cvs.height = 58;
  cvs.className = 'moog-knob';
  const val = document.createElement('span');
  val.className = 'moog-knob-val';
  const lbl = document.createElement('span');
  lbl.className = 'moog-knob-lbl';
  lbl.textContent = label;

  const toNorm = (v: number) => log
    ? Math.log(v / min) / Math.log(max / min)
    : (v - min) / (max - min);
  const fromNorm = (n: number) => log
    ? min * Math.pow(max / min, n)
    : min + n * (max - min);

  function draw() {
    const v = get();
    val.textContent = fmt(v);
    const ctx = cvs.getContext('2d')!;
    const W = 58, cx = 29, cy = 29, r = 22;
    const norm = Math.max(0, Math.min(1, toNorm(v)));
    const sa = Math.PI * 0.75, ea = sa + norm * Math.PI * 1.5;
    ctx.clearRect(0, 0, W, W);
    // body
    const grad = ctx.createRadialGradient(cx - 6, cy - 8, 4, cx, cy, r);
    grad.addColorStop(0, '#3a3a46');
    grad.addColorStop(1, '#15151c');
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    // arc track + value
    ctx.beginPath(); ctx.arc(cx, cy, r, sa, sa + Math.PI * 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, sa, ea);
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3; ctx.stroke();
    // pointer
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ea) * 6, cy + Math.sin(ea) * 6);
    ctx.lineTo(cx + Math.cos(ea) * (r - 6), cy + Math.sin(ea) * (r - 6));
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();
  }

  let dragging = false, startY = 0, startNorm = 0;
  cvs.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startNorm = toNorm(get());
    cvs.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const n = Math.max(0, Math.min(1, startNorm + (startY - e.clientY) / 140));
    set(fromNorm(n));
    draw();
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });

  draw();
  wrap.append(cvs, val, lbl);
  return wrap;
}

function segButtons(options: string[], get: () => string,
                    set: (v: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'moog-seg';
  options.forEach(opt => {
    const b = document.createElement('button');
    b.className = 'moog-seg-btn' + (get() === opt ? ' active' : '');
    b.textContent = opt;
    b.addEventListener('click', () => {
      set(opt);
      row.querySelectorAll('.moog-seg-btn').forEach(x =>
        x.classList.toggle('active', x.textContent === opt));
    });
    row.appendChild(b);
  });
  return row;
}

function section(title: string): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'moog-section';
  const h = document.createElement('div');
  h.className = 'moog-section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────

let kbOctave = 3; // C3 start

const WAVE_ICONS: Record<Wave, string> = {
  triangle: '△', sawtooth: '◺', square: '⊓', pulse: '⨅',
};

function buildKeyboard(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'moog-kb-wrap';

  const octRow = document.createElement('div');
  octRow.className = 'moog-oct-row';
  const octLbl = document.createElement('span');
  octLbl.className = 'moog-oct-lbl';
  const dn = document.createElement('button');
  dn.className = 'small-btn'; dn.textContent = 'Okt −';
  const up = document.createElement('button');
  up.className = 'small-btn'; up.textContent = 'Okt +';
  const updateLbl = () => { octLbl.textContent = `C${kbOctave} – C${kbOctave + 2}`; };
  dn.addEventListener('click', () => { kbOctave = Math.max(0, kbOctave - 1); updateLbl(); render(); });
  up.addEventListener('click', () => { kbOctave = Math.min(7, kbOctave + 1); updateLbl(); render(); });
  updateLbl();
  octRow.append(dn, octLbl, up);

  const kb = document.createElement('div');
  kb.className = 'moog-kb';

  const pointerNotes = new Map<number, number>();

  function render() {
    kb.innerHTML = '';
    const baseMidi = 12 * (kbOctave + 1); // C of kbOctave
    const isBlack = (semi: number) => [1, 3, 6, 8, 10].includes(semi % 12);

    for (let i = 0; i <= 24; i++) {
      const midi = baseMidi + i;
      const key = document.createElement('div');
      key.className = 'moog-key ' + (isBlack(i) ? 'black' : 'white');
      key.dataset.midi = String(midi);

      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pointerNotes.set(e.pointerId, midi);
        key.classList.add('down');
        Tone.start();
        moogNoteOn(midi);
      });
      const release = (e: PointerEvent) => {
        const m = pointerNotes.get(e.pointerId);
        if (m !== undefined) {
          pointerNotes.delete(e.pointerId);
          moogNoteOff(m);
          key.classList.remove('down');
        }
      };
      key.addEventListener('pointerup', release);
      key.addEventListener('pointercancel', release);
      key.addEventListener('pointerleave', release);
      kb.appendChild(key);
    }
  }
  render();

  wrap.append(octRow, kb);
  return wrap;
}

// ─── Panel init ───────────────────────────────────────────────────────────────

let initialized = false;

export function initMoog(root: HTMLElement) {
  if (initialized) return;
  initialized = true;
  buildGraph();

  root.innerHTML = '';
  root.className = 'moog-root';

  // Oscillator bank
  const oscSec = section('OSZILLATOR-BANK');
  P.osc.forEach((op, i) => {
    const row = document.createElement('div');
    row.className = 'moog-osc-row';
    const name = document.createElement('span');
    name.className = 'moog-osc-name';
    name.textContent = `VCO ${i + 1}`;
    row.appendChild(name);
    row.appendChild(segButtons(
      Object.keys(WAVE_ICONS).map(w => WAVE_ICONS[w as Wave]),
      () => WAVE_ICONS[op.wave],
      (icon) => {
        op.wave = (Object.keys(WAVE_ICONS) as Wave[])
          .find(w => WAVE_ICONS[w] === icon)!;
        applyOsc(i);
      }));
    row.appendChild(segButtons(
      ['32', '16', '8', '4', '2'],
      () => op.range,
      (v) => { op.range = v as Range; applyOsc(i); }));
    row.appendChild(knob('DETUNE', -50, 50,
      () => op.detune, v => { op.detune = v; applyOsc(i); },
      v => `${v.toFixed(0)}ct`));
    row.appendChild(knob('LEVEL', 0, 1,
      () => op.level, v => { op.level = v; applyOsc(i); },
      v => v.toFixed(2)));
    oscSec.appendChild(row);
  });
  root.appendChild(oscSec);

  // Mixer
  const mixSec = section('MIXER');
  const mixRow = document.createElement('div');
  mixRow.className = 'moog-knob-row';
  mixRow.appendChild(knob('NOISE', 0, 0.6,
    () => P.noise, v => { P.noise = v; applyMisc(); }, v => v.toFixed(2)));
  mixRow.appendChild(knob('VOLUME', 0, 1,
    () => P.volume, v => { P.volume = v; applyMisc(); }, v => v.toFixed(2)));
  mixSec.appendChild(mixRow);
  root.appendChild(mixSec);

  // Filter
  const filtSec = section('LADDER-FILTER (24dB)');
  const fRow1 = document.createElement('div');
  fRow1.className = 'moog-knob-row';
  fRow1.appendChild(knob('CUTOFF', 60, 16000,
    () => P.cutoff, v => { P.cutoff = v; applyFilter(); },
    v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`, true));
  fRow1.appendChild(knob('EMPHASIS', 0, 18,
    () => P.emphasis, v => { P.emphasis = v; applyFilter(); }, v => v.toFixed(1)));
  fRow1.appendChild(knob('CONTOUR', 0, 6,
    () => P.contour, v => { P.contour = v; applyFilter(); }, v => v.toFixed(1)));
  filtSec.appendChild(fRow1);
  const fRow2 = document.createElement('div');
  fRow2.className = 'moog-knob-row';
  fRow2.appendChild(knob('ATTACK', 0.001, 2,
    () => P.fAttack, v => { P.fAttack = v; applyFilter(); },
    v => `${(v * 1000).toFixed(0)}ms`, true));
  fRow2.appendChild(knob('DECAY', 0.01, 3,
    () => P.fDecay, v => { P.fDecay = v; applyFilter(); },
    v => `${(v * 1000).toFixed(0)}ms`, true));
  fRow2.appendChild(knob('SUSTAIN', 0, 1,
    () => P.fSustain, v => { P.fSustain = v; applyFilter(); }, v => v.toFixed(2)));
  filtSec.appendChild(fRow2);
  root.appendChild(filtSec);

  // Loudness contour
  const ampSec = section('LOUDNESS-KONTUR');
  const aRow = document.createElement('div');
  aRow.className = 'moog-knob-row';
  aRow.appendChild(knob('ATTACK', 0.001, 2,
    () => P.aAttack, v => { P.aAttack = v; applyAmp(); },
    v => `${(v * 1000).toFixed(0)}ms`, true));
  aRow.appendChild(knob('DECAY', 0.01, 3,
    () => P.aDecay, v => { P.aDecay = v; applyAmp(); },
    v => `${(v * 1000).toFixed(0)}ms`, true));
  aRow.appendChild(knob('SUSTAIN', 0, 1,
    () => P.aSustain, v => { P.aSustain = v; applyAmp(); }, v => v.toFixed(2)));
  aRow.appendChild(knob('RELEASE', 0.01, 4,
    () => P.aRelease, v => { P.aRelease = v; applyAmp(); },
    v => `${(v * 1000).toFixed(0)}ms`, true));
  ampSec.appendChild(aRow);
  root.appendChild(ampSec);

  // Modulation
  const modSec = section('MODULATION & GLIDE');
  const mRow = document.createElement('div');
  mRow.className = 'moog-knob-row';
  mRow.appendChild(knob('LFO RATE', 0.1, 20,
    () => P.lfoRate, v => { P.lfoRate = v; applyMisc(); },
    v => `${v.toFixed(1)}Hz`, true));
  mRow.appendChild(knob('LFO→FILTER', 0, 4000,
    () => P.lfoAmt, v => { P.lfoAmt = v; applyMisc(); },
    v => `${Math.round(v)}`));
  mRow.appendChild(knob('GLIDE', 0, 1,
    () => P.glide, v => { P.glide = v; },
    v => `${(v * 1000).toFixed(0)}ms`));
  modSec.appendChild(mRow);
  root.appendChild(modSec);

  // Keyboard
  const kbSec = section('KEYBOARD');
  kbSec.appendChild(buildKeyboard());
  root.appendChild(kbSec);
}
