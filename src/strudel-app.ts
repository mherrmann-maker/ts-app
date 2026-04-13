import './strudel.css';

import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

// ─── Presets ───────────────────────────────────────────────────────────────

const PRESETS = [
  {
    label: 'DRUMS',
    code: `// 808 Beat — Kick, Snare, Hi-hat
stack(
  sound("bd ~ ~ bd ~").bank("RolandTR808").gain(0.85),
  sound("~ ~ sd ~ ~").bank("RolandTR808").gain(0.75),
  sound("hh*8").bank("RolandTR808").gain(0.45)
)`,
  },
  {
    label: 'MELODIE',
    code: `// Melodische Sequenz mit Piano
note("c4 e4 g4 b4 g4 e4 d4 f4")
  .s("piano")
  .slow(2)
  .room(0.3)`,
  },
  {
    label: 'AMBIENT',
    code: `// Ambient Pad — langsame Akkordfolge
stack(
  note("<c3 f3 g3 bb3>/4")
    .s("sawtooth")
    .cutoff(800)
    .resonance(10)
    .room(0.9)
    .gain(0.4)
    .slow(2),
  note("<c4 f4 g4 d4>/4")
    .s("sine")
    .room(0.95)
    .gain(0.25)
    .slow(2)
)`,
  },
  {
    label: 'KOMPLEX',
    code: `// Vollständige Komposition
stack(
  // Rhythmus
  sound("bd ~ bd ~, ~ sd ~ sd").bank("RolandTR808"),
  sound("hh*8").gain(0.35).bank("RolandTR808"),
  // Bass
  note("c2 ~ g2 ~, ~ ~ eb2 ~")
    .s("sawtooth").cutoff(400).gain(0.65),
  // Akkorde
  note("<[c4,e4,g4] [f4,a4,c5] [g4,b4,d5]>/2")
    .s("piano").gain(0.5).room(0.4)
)`,
  },
];

// ─── State ─────────────────────────────────────────────────────────────────

interface ActiveHap {
  note: number;         // MIDI note number
  freq: number;         // Hz
  gain: number;         // 0–1
  begin: number;        // cycle
  end: number;          // cycle
  part_begin: number;
  part_end: number;
  sound?: string;
}

let editor!: EditorView;
let strudelRepl: any = null;
let analyser: AnalyserNode | null = null;
let masterGain: GainNode | null = null;
let isPlaying = false;
let currentCycle = 0;
let eventCount = 0;
let activeHaps: ActiveHap[] = [];
let pianoHistory: ActiveHap[] = [];
let activeViz: 'spectrum' | 'waveform' | 'pianoroll' = 'spectrum';
let animFrameId = 0;

// ─── Error helpers ─────────────────────────────────────────────────────────

function showError(e: unknown) {
  const panel = document.getElementById('error-panel')!;
  const msg   = document.getElementById('error-message')!;
  const text  = e instanceof Error ? e.message : String(e);
  msg.textContent = text;
  panel.classList.remove('hidden');
}

function clearError() {
  document.getElementById('error-panel')!.classList.add('hidden');
}

// ─── Audio setup ───────────────────────────────────────────────────────────

async function initAudioChain(): Promise<void> {
  // Dynamic import so vite can tree-shake if Strudel isn't available
  const { initAudio, getAudioContext } = await import('@strudel/webaudio');
  await initAudio();
  const ctx = getAudioContext() as AudioContext;

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.84;

  // Intercept AudioNode.connect so all audio routed to ctx.destination
  // passes through our analyser first — enables real-time FFT visualization.
  const realDest = ctx.destination;
  let analyserPatched = false;
  const origConnect = AudioNode.prototype.connect as (
    dest: AudioNode, out?: number, inp?: number
  ) => AudioNode;

  (AudioNode.prototype as any).connect = function (
    destination: AudioNode,
    outputIndex?: number,
    inputIndex?: number
  ) {
    if (destination === realDest && !analyserPatched) {
      analyserPatched = true;
      origConnect.call(analyser!, realDest);
    }
    if (destination === realDest) {
      return origConnect.call(this, analyser!, outputIndex, inputIndex);
    }
    return origConnect.call(this, destination, outputIndex, inputIndex);
  };
}

// ─── Strudel REPL init ────────────────────────────────────────────────────

async function initStrudel(): Promise<void> {
  await initAudioChain();

  const { repl }              = await import('@strudel/core');
  const { webaudioOutput, getAudioContext } = await import('@strudel/webaudio');
  const ctx = getAudioContext() as AudioContext;

  strudelRepl = repl({
    defaultOutput: webaudioOutput,
    getTime: () => ctx.currentTime,
    onSchedulerError: showError,
    onEvalError: showError,
    drawTime: [0, 2],
    onDraw: (haps: any[], time: number) => {
      currentCycle = time;
      eventCount   = haps.length;
      updateInfoBar();
      activeHaps = haps.map(hapToRecord);
      pianoHistory = [...pianoHistory, ...activeHaps].slice(-300);
    },
  });
}

function hapToRecord(hap: any): ActiveHap {
  const v = hap.value ?? {};
  let freq = v.freq ?? 440;
  let note = 69;
  if (typeof v.note === 'number') {
    note = v.note;
    freq = 440 * Math.pow(2, (note - 69) / 12);
  } else if (typeof freq === 'number') {
    note = Math.round(69 + 12 * Math.log2(freq / 440));
  } else if (typeof v.n === 'number') {
    note = 60 + v.n;
    freq = 440 * Math.pow(2, (note - 69) / 12);
  }
  return {
    note: Math.max(0, Math.min(127, note)),
    freq,
    gain:        v.gain  ?? 0.8,
    begin:       hap.whole?.begin ?? hap.part.begin,
    end:         hap.whole?.end   ?? hap.part.end,
    part_begin:  hap.part.begin,
    part_end:    hap.part.end,
    sound:       v.s ?? v.sound,
  };
}

// ─── Playback control ──────────────────────────────────────────────────────

async function evaluateCode(): Promise<void> {
  clearError();
  try {
    if (!strudelRepl) await initStrudel();
    const code = editor.state.doc.toString();
    await strudelRepl.evaluate(code);
    setPlayState(true);
    setEvalStatus('OK');
    setTimeout(() => setEvalStatus(''), 1500);
  } catch (e) {
    showError(e);
  }
}

function stopPlayback(): void {
  strudelRepl?.stop?.();
  setPlayState(false);
  activeHaps = [];
}

function setPlayState(playing: boolean): void {
  isPlaying = playing;
  const btn    = document.getElementById('btn-play')!;
  const label  = document.getElementById('btn-play-label')!;
  const iconP  = document.getElementById('icon-play')!;
  const iconPa = document.getElementById('icon-pause')!;
  const status = document.getElementById('play-status')!;

  btn.classList.toggle('playing', playing);
  label.textContent = playing ? 'PAUSE' : 'PLAY';
  iconP.style.display  = playing ? 'none'  : '';
  iconPa.style.display = playing ? ''      : 'none';

  status.textContent = playing ? 'LÄUFT' : 'GESTOPPT';
  status.className = 's-info-value ' + (playing ? 's-status-playing' : 's-status-stopped');
  if (!playing) {
    document.getElementById('cycle-val')!.textContent = '—';
    document.getElementById('event-val')!.textContent = '—';
    document.getElementById('freq-val')!.textContent  = '—';
  }
}

function setEvalStatus(text: string): void {
  document.getElementById('eval-status')!.textContent = text;
}

function updateInfoBar(): void {
  document.getElementById('cycle-val')!.textContent  = currentCycle.toFixed(2);
  document.getElementById('event-val')!.textContent  = String(eventCount);
  const topFreq = activeHaps.reduce(
    (max, h) => h.gain > max.gain ? h : max,
    { gain: 0, freq: 0 }
  );
  document.getElementById('freq-val')!.textContent =
    topFreq.freq > 0 ? topFreq.freq.toFixed(0) + ' Hz' : '—';
}

// ─── Visualization ─────────────────────────────────────────────────────────

function getCanvas(id: string): HTMLCanvasElement {
  return document.getElementById(id) as HTMLCanvasElement;
}

/** Spectrum: real FFT when analyser available, or note-driven fallback */
function drawSpectrum(W: number, H: number): void {
  const canvas = getCanvas('canvas-spectrum');
  const ctx    = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, W, H);

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#070712');
  bg.addColorStop(1, '#0a0a1a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const BAR_COUNT = 80;
  const barW = (W / BAR_COUNT) - 1;
  const heights = new Float32Array(BAR_COUNT);

  if (analyser) {
    const fft = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(fft);
    const step = Math.floor(fft.length / BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      let s = 0;
      for (let j = 0; j < step; j++) s += fft[i * step + j];
      heights[i] = (s / step / 255) * H * 0.92;
    }
  } else {
    // Note-driven fallback: light up bands based on active hap frequencies
    const t = Date.now() / 1000;
    for (let i = 0; i < BAR_COUNT; i++) {
      heights[i] = 2 + Math.abs(Math.sin(t * 0.7 + i * 0.35)) * 4;
    }
    activeHaps.forEach((hap) => {
      // Map MIDI note to bar index  (note 24=C1 to note 108=C8)
      const band = Math.floor(((hap.note - 24) / 84) * BAR_COUNT);
      const spread = 7;
      for (let di = -spread; di <= spread; di++) {
        const bi = band + di;
        if (bi < 0 || bi >= BAR_COUNT) continue;
        const falloff = 1 - Math.abs(di) / (spread + 1);
        heights[bi] = Math.max(heights[bi], falloff * hap.gain * H * 0.85);
      }
    });
  }

  // Draw bars
  for (let i = 0; i < BAR_COUNT; i++) {
    const h   = Math.max(heights[i], 2);
    const x   = i * (barW + 1);
    const hue = 185 + (i / BAR_COUNT) * 130; // cyan → purple

    const grad = ctx.createLinearGradient(0, H - h, 0, H);
    grad.addColorStop(0, `hsla(${hue},85%,62%,0.9)`);
    grad.addColorStop(1, `hsla(${hue},65%,42%,0.4)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, H - h, barW, h);

    if (h > 3) {
      ctx.fillStyle = `hsla(${hue},100%,82%,0.75)`;
      ctx.fillRect(x, H - h - 2, barW, 2);
    }
  }

  // Grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth   = 1;
  for (let row = 1; row <= 3; row++) {
    const y = (H / 4) * row;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Frequency labels
  ctx.fillStyle = 'rgba(220,220,255,0.25)';
  ctx.font = '9px JetBrains Mono, monospace';
  const labels = ['63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  labels.forEach((lbl, i) => {
    const x = ((i + 1) / labels.length) * W;
    ctx.fillText(lbl, x, H - 4);
  });
}

/** Waveform / Oscilloscope */
function drawWaveform(W: number, H: number): void {
  const canvas = getCanvas('canvas-waveform');
  const ctx    = canvas.getContext('2d')!;
  const cx     = H / 2;

  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, W, H);

  // Center dashes
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.setLineDash([4, 8]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cx); ctx.lineTo(W, cx); ctx.stroke();
  ctx.setLineDash([]);

  if (analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);

    const draw = (alpha: number, lw: number) => {
      ctx.lineWidth = lw;
      ctx.beginPath();
      const sliceW = W / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128 - 1;
        const x = i * sliceW;
        const y = cx + v * (H * 0.44);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   '#00d4ff');
    grad.addColorStop(0.5, '#b06aff');
    grad.addColorStop(1,   '#00d4ff');

    ctx.strokeStyle = `rgba(0,212,255,0.12)`;
    draw(8, 8);
    ctx.strokeStyle = grad;
    draw(1.5, 1.5);
  } else {
    // Idle sine wave, ripples from active haps
    const t = Date.now() / 1000;
    const amp = isPlaying
      ? 0.1 + activeHaps.reduce((a, h) => a + h.gain * 0.08, 0)
      : 0.02;

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(0,212,255,0.5)');
    grad.addColorStop(0.5, 'rgba(176,106,255,0.5)');
    grad.addColorStop(1,   'rgba(0,212,255,0.5)');

    ctx.strokeStyle = grad;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const phase = (x / W) * Math.PI * 6;
      const y     = cx + Math.sin(phase + t * 3) * H * amp
                       + Math.sin(phase * 0.5 + t * 1.5) * H * amp * 0.5;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,212,255,0.08)';
    ctx.lineWidth   = 7;
    ctx.stroke();
  }

  // Scope border
  ctx.strokeStyle = 'rgba(0,212,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}

/** Piano Roll */
function drawPianoRoll(W: number, H: number): void {
  const canvas = getCanvas('canvas-pianoroll');
  const ctx    = canvas.getContext('2d')!;

  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, W, H);

  const haps = pianoHistory.length > 0 ? pianoHistory : activeHaps;

  if (haps.length === 0) {
    ctx.fillStyle = 'rgba(220,220,255,0.15)';
    ctx.font      = '12px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▶  Starte die Wiedergabe, um Noten zu sehen', W / 2, H / 2);
    ctx.textAlign = 'left';
    return;
  }

  const notes    = haps.map((h) => h.note);
  const minNote  = Math.max(0,   Math.min(...notes) - 2);
  const maxNote  = Math.min(127, Math.max(...notes) + 2);
  const noteSpan = Math.max(maxNote - minNote, 12);
  const noteH    = H / noteSpan;

  const beginTimes = haps.map((h) => h.begin);
  const endTimes   = haps.map((h) => h.end);
  const minT       = Math.min(...beginTimes);
  const maxT       = Math.max(...endTimes, minT + 4);
  const timeSpan   = Math.max(maxT - minT, 0.0001);

  // Piano key background
  for (let n = minNote; n <= maxNote; n++) {
    const isBlack = [1, 3, 6, 8, 10].includes(n % 12);
    const y = H - (n - minNote + 1) * noteH;
    ctx.fillStyle = isBlack ? '#0c0c1c' : '#0e0e1e';
    ctx.fillRect(0, y, W, noteH);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, y + noteH - 1, W, 1);
  }

  // Beat grid lines
  for (let t = Math.floor(minT); t <= Math.ceil(maxT); t++) {
    const x = ((t - minT) / timeSpan) * W;
    ctx.fillStyle = Number.isInteger(t)
      ? 'rgba(255,255,255,0.07)'
      : 'rgba(255,255,255,0.03)';
    ctx.fillRect(x, 0, 1, H);
  }

  // Note blocks
  haps.forEach((hap) => {
    const x  = ((hap.begin - minT) / timeSpan) * W;
    const bw = Math.max(((hap.end - hap.begin) / timeSpan) * W - 1, 3);
    const y  = H - (hap.note - minNote + 1) * noteH;
    const hue = (hap.note % 12) * 30;
    const active = hap.part_begin <= currentCycle && currentCycle < hap.part_end;
    const alpha  = active ? 1 : 0.65;

    ctx.fillStyle = `hsla(${hue},80%,58%,${alpha})`;
    ctx.fillRect(x, y + 1, bw, noteH - 2);

    if (active) {
      ctx.fillStyle = `hsla(${hue},100%,80%,0.3)`;
      ctx.fillRect(x - 1, y, bw + 2, noteH);
    }

    // Note name
    if (bw > 22) {
      ctx.fillStyle = `rgba(255,255,255,${active ? 0.9 : 0.5})`;
      ctx.font = `${Math.min(noteH - 2, 9)}px JetBrains Mono,monospace`;
      const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      ctx.fillText(names[hap.note % 12], x + 3, y + noteH - 3);
    }
  });

  // Playhead
  const playX = ((currentCycle - minT) / timeSpan) * W;
  if (playX >= 0 && playX <= W) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(playX, 0, 2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(playX - 1, 0, 4, H);
  }
}

// ─── Animation loop ────────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const container = canvas.parentElement!;
  const rect      = container.getBoundingClientRect();
  if (canvas.width  !== Math.floor(rect.width ) ||
      canvas.height !== Math.floor(rect.height)) {
    canvas.width  = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
  }
}

function renderFrame(): void {
  const specCanvas  = getCanvas('canvas-spectrum');
  const waveCanvas  = getCanvas('canvas-waveform');
  const pianoCanvas = getCanvas('canvas-pianoroll');

  [specCanvas, waveCanvas, pianoCanvas].forEach(resizeCanvas);
  const W = specCanvas.width;
  const H = specCanvas.height;

  if (activeViz === 'spectrum')  drawSpectrum(W, H);
  if (activeViz === 'waveform')  drawWaveform(waveCanvas.width, waveCanvas.height);
  if (activeViz === 'pianoroll') drawPianoRoll(pianoCanvas.width, pianoCanvas.height);

  animFrameId = requestAnimationFrame(renderFrame);
}

// ─── Editor ────────────────────────────────────────────────────────────────

function buildEditor(container: HTMLElement, code: string): EditorView {
  const evalKeys = keymap.of([
    {
      key: 'Ctrl-Enter',
      run() { evaluateCode(); return true; },
    },
    {
      key: 'Ctrl-.',
      run() { stopPlayback(); return true; },
    },
  ]);

  const state = EditorState.create({
    doc: code,
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      Prec.high(evalKeys),
    ],
  });

  return new EditorView({ state, parent: container });
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

function init(): void {
  // Editor
  editor = buildEditor(
    document.getElementById('editor')!,
    PRESETS[0].code
  );

  // Preset buttons
  document.querySelectorAll<HTMLButtonElement>('.s-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx    = parseInt(btn.dataset.preset ?? '0', 10);
      const preset = PRESETS[idx];
      if (!preset) return;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: preset.code },
      });
    });
  });

  // Play / pause
  document.getElementById('btn-play')!.addEventListener('click', () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      evaluateCode();
    }
  });

  // Stop
  document.getElementById('btn-stop')!.addEventListener('click', stopPlayback);

  // BPM
  document.getElementById('bpm')!.addEventListener('change', (e) => {
    const bpm = parseInt((e.target as HTMLInputElement).value, 10);
    if (strudelRepl?.scheduler?.setTempo) strudelRepl.scheduler.setTempo(bpm);
  });

  // Volume
  document.getElementById('volume')!.addEventListener('input', (e) => {
    const vol = parseFloat((e.target as HTMLInputElement).value);
    if (masterGain) masterGain.gain.value = vol;
  });

  // Viz tabs
  document.querySelectorAll<HTMLButtonElement>('.s-viz-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.s-viz-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.s-canvas').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      activeViz = tab.dataset.viz as 'spectrum' | 'waveform' | 'pianoroll';
      document.getElementById(`canvas-${activeViz}`)!.classList.add('active');
    });
  });

  // Error close
  document.getElementById('error-close')!.addEventListener('click', clearError);

  // Mobile panel switcher
  document.querySelectorAll<HTMLButtonElement>('.s-mobile-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.s-mobile-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.panel;
      const editorPanel = document.querySelector<HTMLElement>('.s-editor-panel')!;
      const vizPanel    = document.querySelector<HTMLElement>('.s-viz-panel')!;
      editorPanel.classList.toggle('s-hidden', target !== 'editor');
      vizPanel.classList.toggle('s-hidden',    target !== 'viz');
    });
  });

  // Start render loop
  renderFrame();
}

document.addEventListener('DOMContentLoaded', init);
