import './strudel.css';
import * as Tone from 'tone';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = 16;
const DRUM_TRACKS = ['kick', 'snare', 'hihat', 'clap'] as const;
type DrumTrack = typeof DRUM_TRACKS[number];

// ─── Initial grid patterns ───────────────────────────────────────────────────

const drumGrid: Record<DrumTrack, boolean[]> = {
  kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0].map(Boolean),
  snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0].map(Boolean),
  hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0].map(Boolean),
  clap:  new Array(STEPS).fill(false),
};
const melodyGrid: (string | null)[] = new Array(STEPS).fill(null);

// ─── Audio engine ────────────────────────────────────────────────────────────

let reverb:   Tone.Reverb;
let delay:    Tone.FeedbackDelay;
let dist:     Tone.Distortion;
let masterVol: Tone.Volume;
let meter:    Tone.Analyser;

let kick:  Tone.MembraneSynth;
let snare: Tone.NoiseSynth;
let hihat: Tone.MetalSynth;
let clap:  Tone.NoiseSynth;
let lead:  Tone.PolySynth;
let bass:  Tone.MonoSynth;

function buildAudio() {
  masterVol = new Tone.Volume(-6).toDestination();
  reverb    = new Tone.Reverb({ decay: 2.0, wet: 0.1 }).connect(masterVol);
  delay     = new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.3, wet: 0.0 }).connect(reverb);
  dist      = new Tone.Distortion({ distortion: 0, wet: 1 }).connect(delay);
  meter     = new Tone.Analyser('fft', 128);
  masterVol.connect(meter);

  kick = new Tone.MembraneSynth({
    pitchDecay: 0.055, octaves: 8,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 },
  }).connect(dist);

  snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 },
  }).connect(dist);

  hihat = new Tone.MetalSynth({
    harmonicity: 5.1, modulationIndex: 32,
    resonance: 4000, octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
  }).connect(dist);

  clap = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.05 },
  }).connect(dist);

  lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.02, decay: 0.15, sustain: 0.5, release: 0.5 },
  }).connect(dist);

  bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', frequency: 800 },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.2 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2, baseFrequency: 200, octaves: 3 },
  }).connect(dist);
}

// ─── Sequencer ───────────────────────────────────────────────────────────────

let seq: Tone.Sequence;
let currentStep = -1;

function buildSequencer() {
  seq = new Tone.Sequence((time, step) => {
    const i = step as number;
    if (drumGrid.kick[i])  kick.triggerAttackRelease('C1', '8n',  time);
    if (drumGrid.snare[i]) snare.triggerAttackRelease('8n',        time);
    if (drumGrid.hihat[i]) hihat.triggerAttackRelease('C5', '32n', time);
    if (drumGrid.clap[i])  clap.triggerAttackRelease('16n',        time);
    const mel = melodyGrid[i];
    if (mel) lead.triggerAttackRelease(mel, '8n', time);

    Tone.getDraw().schedule(() => advancePlayhead(i), time);
  }, [...Array(STEPS).keys()], '16n');
  seq.start(0);
}

function advancePlayhead(step: number) {
  currentStep = step;
  document.querySelectorAll('.step-btn.playhead').forEach(el =>
    el.classList.remove('playhead')
  );
  document.querySelectorAll(`.step-btn[data-step="${step}"]`).forEach(el =>
    el.classList.add('playhead')
  );
}

// ─── Transport ───────────────────────────────────────────────────────────────

let running = false;

async function startStop() {
  await Tone.start(); // unlock audio on first gesture
  if (!running) {
    running = true;
    Tone.getTransport().start();
    document.getElementById('btn-play')!.classList.add('running');
    document.getElementById('ico-play')!.style.display  = 'none';
    document.getElementById('ico-pause')!.style.display = '';
  } else {
    Tone.getTransport().pause();
    running = false;
    document.getElementById('btn-play')!.classList.remove('running');
    document.getElementById('ico-play')!.style.display  = '';
    document.getElementById('ico-pause')!.style.display = 'none';
  }
}

function stop() {
  Tone.getTransport().stop();
  running = false;
  currentStep = -1;
  document.getElementById('btn-play')!.classList.remove('running');
  document.getElementById('ico-play')!.style.display  = '';
  document.getElementById('ico-pause')!.style.display = 'none';
  document.querySelectorAll('.step-btn.playhead').forEach(el =>
    el.classList.remove('playhead')
  );
}

// ─── Drum grid UI ────────────────────────────────────────────────────────────

function buildDrumGrid() {
  const container = document.getElementById('drum-sequencer')!;
  container.innerHTML = '';

  const LABELS: Record<DrumTrack, string> = {
    kick: 'KICK', snare: 'SNARE', hihat: 'HIHAT', clap: 'CLAP',
  };

  DRUM_TRACKS.forEach(track => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.track = track;

    const lbl = document.createElement('span');
    lbl.className = 'track-label';
    lbl.textContent = LABELS[track];
    row.appendChild(lbl);

    const steps = document.createElement('div');
    steps.className = 'steps';

    for (let i = 0; i < STEPS; i++) {
      const btn = document.createElement('button');
      btn.className = `step-btn${drumGrid[track][i] ? ' active' : ''}${i % 4 === 0 ? ' beat' : ''}`;
      btn.dataset.step = String(i);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        drumGrid[track][i] = !drumGrid[track][i];
        btn.classList.toggle('active', drumGrid[track][i]);
        // audition on tap
        if (drumGrid[track][i]) auditDrum(track);
      });
      steps.appendChild(btn);
    }
    row.appendChild(steps);
    container.appendChild(row);
  });
}

function auditDrum(track: DrumTrack) {
  if (!running) return;
  switch (track) {
    case 'kick':  kick.triggerAttackRelease('C1', '8n');  break;
    case 'snare': snare.triggerAttackRelease('8n');        break;
    case 'hihat': hihat.triggerAttackRelease('C5', '32n'); break;
    case 'clap':  clap.triggerAttackRelease('16n');        break;
  }
}

// ─── Melody grid UI ──────────────────────────────────────────────────────────

let selectedStep: number | null = null;

function buildMelodyGrid() {
  const container = document.getElementById('melody-sequencer')!;
  container.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'track-row';

  const lbl = document.createElement('span');
  lbl.className = 'track-label';
  lbl.textContent = 'NOTE';
  row.appendChild(lbl);

  const steps = document.createElement('div');
  steps.className = 'steps';

  for (let i = 0; i < STEPS; i++) {
    const btn = document.createElement('button');
    const note = melodyGrid[i];
    btn.className = `step-btn melody${note ? ' active' : ''}${selectedStep === i ? ' selected' : ''}`;
    btn.dataset.step = String(i);
    btn.textContent = note ? note.replace(/\d/, '') : '';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (selectedStep === i) {
        // deselect
        selectedStep = null;
      } else {
        selectedStep = i;
      }
      refreshMelodyGrid();
      refreshKeyboard();
    });
    steps.appendChild(btn);
  }
  row.appendChild(steps);
  container.appendChild(row);
}

function refreshMelodyGrid() {
  document.querySelectorAll<HTMLElement>('#melody-sequencer .step-btn').forEach((btn, i) => {
    const note = melodyGrid[i];
    btn.className = `step-btn melody${note ? ' active' : ''}${selectedStep === i ? ' selected' : ''}`;
    btn.textContent = note ? note.replace(/\d/, '') : '';
  });
}

// ─── Piano keyboard UI ───────────────────────────────────────────────────────

const NOTE_SEQUENCE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function buildKeyboard() {
  const kb = document.getElementById('keyboard')!;
  kb.innerHTML = '';

  for (let oct = 3; oct <= 5; oct++) {
    NOTE_SEQUENCE.forEach(name => {
      const full  = `${name}${oct}`;
      const black = name.includes('#');
      const key   = document.createElement('button');
      key.className = `piano-key ${black ? 'black' : 'white'}`;
      key.dataset.note = full;

      if (!black) {
        const lbl = document.createElement('span');
        lbl.className = 'key-lbl';
        lbl.textContent = name === 'C' ? full : name;
        key.appendChild(lbl);
      }

      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Tone.start();
        lead.triggerAttackRelease(full, '8n');

        if (selectedStep !== null) {
          // Toggle: tapping same note clears it
          melodyGrid[selectedStep] = melodyGrid[selectedStep] === full ? null : full;
          refreshMelodyGrid();
          refreshKeyboard();
        }
      });
      kb.appendChild(key);
    });
  }
}

function refreshKeyboard() {
  const activeNotes = new Set(melodyGrid.filter(Boolean));
  const selNote = selectedStep !== null ? melodyGrid[selectedStep] : null;

  document.querySelectorAll<HTMLElement>('.piano-key').forEach(key => {
    const note = key.dataset.note!;
    key.classList.toggle('lit', activeNotes.has(note) || note === selNote);
  });
}

// ─── Knob component ──────────────────────────────────────────────────────────

interface KnobState {
  val: number;
  min: number;
  max: number;
  log: boolean;
  onChange: (v: number) => void;
}

const knobStates = new Map<HTMLCanvasElement, KnobState>();

function initKnob(id: string, onChange: (v: number) => void) {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  if (!canvas) return;

  const min = parseFloat(canvas.dataset.min ?? '0');
  const max = parseFloat(canvas.dataset.max ?? '1');
  const val = parseFloat(canvas.dataset.val ?? String((min + max) / 2));
  const log = canvas.dataset.log === 'true';

  const state: KnobState = { val, min, max, log, onChange };
  knobStates.set(canvas, state);
  drawKnob(canvas, state);

  let startY = 0;
  let startVal = 0;

  const onMove = (clientY: number) => {
    const delta = (startY - clientY) / 150;
    const range = max - min;
    let newVal = Math.min(max, Math.max(min, startVal + delta * range));
    state.val = newVal;
    drawKnob(canvas, state);
    onChange(newVal);
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startY   = e.clientY;
    startVal = state.val;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0) return;
    onMove(e.clientY);
  });
}

function drawKnob(canvas: HTMLCanvasElement, state: KnobState) {
  const ctx  = canvas.getContext('2d')!;
  const W    = canvas.width;
  const cx   = W / 2;
  const cy   = W / 2;
  const r    = W * 0.38;
  const norm = (state.val - state.min) / (state.max - state.min);

  const startA = Math.PI * 0.75;
  const endA   = Math.PI * 2.25;
  const curA   = startA + norm * (endA - startA);

  ctx.clearRect(0, 0, W, W);

  // Body
  const bg = ctx.createRadialGradient(cx, cy - 2, 2, cx, cy, r);
  bg.addColorStop(0, '#2a2a38');
  bg.addColorStop(1, '#161620');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fill();

  // Track
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA);
  ctx.stroke();

  // Fill arc
  const grad = ctx.createLinearGradient(0, 0, W, W);
  grad.addColorStop(0, '#00cfff');
  grad.addColorStop(1, '#a855f7');
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, curA);
  ctx.stroke();

  // Pointer dot
  const px = cx + Math.cos(curA) * r;
  const py = cy + Math.sin(curA) * r;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();

  // Value text
  const display = state.val >= 1000
    ? (state.val / 1000).toFixed(1) + 'k'
    : state.val < 10 ? state.val.toFixed(2) : state.val.toFixed(0);
  ctx.fillStyle = 'rgba(220,220,255,0.55)';
  ctx.font      = `bold 9px JetBrains Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(display, cx, cy);
}

// ─── Synth tab wiring ────────────────────────────────────────────────────────

function wireSynthTab() {
  // Waveform buttons
  document.querySelectorAll<HTMLButtonElement>('.wave-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wave-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.wave as OscillatorType;
      lead.set({ oscillator: { type } });
      bass.set({ oscillator: { type } });
    });
  });

  initKnob('knob-cutoff', v => {
    bass.set({ filter: { frequency: v } });
  });
  initKnob('knob-res', v => {
    bass.set({ filter: { Q: v } });
  });
  initKnob('knob-attack',  v => { lead.set({ envelope: { attack: v } }); });
  initKnob('knob-decay',   v => { lead.set({ envelope: { decay: v } }); });
  initKnob('knob-sustain', v => { lead.set({ envelope: { sustain: v } }); });
  initKnob('knob-release', v => { lead.set({ envelope: { release: v } }); });
}

// ─── FX tab wiring ────────────────────────────────────────────────────────────

function wireFxTab() {
  initKnob('knob-rev-wet',   v => { reverb.wet.value = v; });
  initKnob('knob-rev-decay', v => { reverb.decay = v; });
  initKnob('knob-del-wet',   v => { delay.wet.value = v; });
  initKnob('knob-del-feed',  v => { delay.feedback.value = v; });
  initKnob('knob-dist',      v => { dist.distortion = v; });
}

// ─── Visualizer ──────────────────────────────────────────────────────────────

function animateViz() {
  const canvas = document.getElementById('viz-canvas') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d')!;

  function frame() {
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
    }

    ctx.fillStyle = '#111114';
    ctx.fillRect(0, 0, W, H);

    if (meter && running) {
      const fft   = meter.getValue() as Float32Array;
      const count = fft.length;
      const bw    = W / count;

      for (let i = 0; i < count; i++) {
        const db  = Math.max(-80, fft[i] as number);
        const h   = ((db + 80) / 80) * H * 0.9;
        const hue = 150 + (i / count) * 160;
        ctx.fillStyle = `hsla(${hue},90%,60%,0.85)`;
        ctx.fillRect(i * bw, H - h, bw - 1, h);
      }
    } else {
      // Idle: gentle sine ripple
      const t = Date.now() / 1000;
      ctx.strokeStyle = 'rgba(0,207,255,0.2)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = H / 2 + Math.sin((x / W) * 8 + t * 2) * (H * 0.1);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  }
  frame();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function init() {
  buildAudio();
  buildSequencer();
  buildDrumGrid();
  buildMelodyGrid();
  buildKeyboard();
  wireSynthTab();
  wireFxTab();
  animateViz();

  // Transport buttons
  document.getElementById('btn-play')!.addEventListener('pointerdown', e => {
    e.preventDefault();
    startStop();
  });
  document.getElementById('btn-stop')!.addEventListener('pointerdown', e => {
    e.preventDefault();
    stop();
  });

  // BPM
  let bpm = 120;
  Tone.getTransport().bpm.value = bpm;
  const bpmEl = document.getElementById('bpm-val')!;
  document.getElementById('bpm-up')!.addEventListener('pointerdown', e => {
    e.preventDefault();
    bpm = Math.min(300, bpm + 2);
    bpmEl.textContent = String(bpm);
    Tone.getTransport().bpm.value = bpm;
  });
  document.getElementById('bpm-down')!.addEventListener('pointerdown', e => {
    e.preventDefault();
    bpm = Math.max(40, bpm - 2);
    bpmEl.textContent = String(bpm);
    Tone.getTransport().bpm.value = bpm;
  });

  // Volume
  document.getElementById('master-vol')!.addEventListener('input', e => {
    masterVol.volume.value = parseFloat((e.target as HTMLInputElement).value);
  });

  // Tabs
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${tab.dataset.tab}`)!;
      panel.classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
