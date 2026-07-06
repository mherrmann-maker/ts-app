import './strudel.css';
import * as Tone from 'tone';
import { state, loadDefaultProject, selectedTrack, addTrack } from './daw/state';
import {
  initAudio, startTransport, stopTransport, setBpm, getBpm,
  onStep, rebuildSequence, applyFx, disposeChain,
} from './daw/audio';
import { renderTrackList, highlightStep } from './daw/tracks';
import { initPianoRoll, setPianoRollStep } from './daw/pianoroll';
import { getScaleNotes, getChordForDegree } from './daw/scales';
import { generateCode } from './daw/codegen';
import { initEditor, updateEditorCode, getEditorCode } from './daw/editor';
import { playStrudel, stopStrudel, warmupStrudel, onStrudelError } from './daw/strudel-engine';
import { initMoog } from './daw/moog';
import { randomizeProject } from './daw/randomizer';
import { MelodyTrack, ChordTrack, DrumTrack } from './daw/types';

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadDefaultProject();
initAudio();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const btnPlay       = document.getElementById('btn-play')!;
const btnStop       = document.getElementById('btn-stop')!;
const icoPlay       = document.getElementById('ico-play')!;
const icoPause      = document.getElementById('ico-pause')!;
const bpmDisplay    = document.getElementById('bpm-display')!;
const bpmDn         = document.getElementById('bpm-dn')!;
const bpmUp         = document.getElementById('bpm-up')!;
const masterVol     = document.getElementById('master-vol') as HTMLInputElement;
const btnAutorun    = document.getElementById('btn-autorun')!;
const trackListEl   = document.getElementById('track-list')!;
const rollCanvas    = document.getElementById('roll-canvas') as HTMLCanvasElement;
const rollTrackName = document.getElementById('roll-track-name')!;
const rollOctDn     = document.getElementById('roll-oct-dn')!;
const rollOctUp     = document.getElementById('roll-oct-up')!;
const rollOctVal    = document.getElementById('roll-oct-val')!;
const browserCats   = document.getElementById('browser-cats')!;
const browserGrid   = document.getElementById('browser-grid')!;
const scaleRoots    = document.getElementById('scale-roots')!;
const scaleTypes    = document.getElementById('scale-types')!;
const scaleKeyboard = document.getElementById('scale-keyboard')!;
const chordDegreesEl = document.getElementById('chord-degrees')!;
const chordPreview  = document.getElementById('chord-preview')!;
const insertChords  = document.getElementById('insert-chords')!;
const codeDrawer    = document.getElementById('code-drawer')!;
const codeToggle    = document.getElementById('code-drawer-toggle')!;
const codeArrow     = document.getElementById('code-drawer-arrow')!;
const codeEditorEl  = document.getElementById('code-editor')!;
const btnCopyCode   = document.getElementById('btn-copy-code')!;
const btnRunCode    = document.getElementById('btn-run-code')!;
const fxOverlay     = document.getElementById('fx-overlay')!;
const fxTrackName   = document.getElementById('fx-track-name')!;
const fxKnobbsEl    = document.getElementById('fx-knobs')!;
const fxClose       = document.getElementById('fx-close')!;
const euclidN       = document.getElementById('euclid-n') as HTMLInputElement;
const euclidK       = document.getElementById('euclid-k') as HTMLInputElement;
const euclidRot     = document.getElementById('euclid-rot') as HTMLInputElement;
const euclidNVal    = document.getElementById('euclid-n-val')!;
const euclidKVal    = document.getElementById('euclid-k-val')!;
const euclidRVal    = document.getElementById('euclid-rot-val')!;
const euclidCanvas  = document.getElementById('euclid-canvas') as HTMLCanvasElement;
const applyEuclid   = document.getElementById('apply-euclid')!;
const pmSpeed       = document.getElementById('pm-speed') as HTMLInputElement;
const pmSpeedVal    = document.getElementById('pm-speed-val')!;
const pmRev         = document.getElementById('pm-rev')!;
const pmJux         = document.getElementById('pm-jux')!;
const pmPalindrome  = document.getElementById('pm-palindrome')!;
const pmDegrade     = document.getElementById('pm-degrade') as HTMLInputElement;
const pmDegradeVal  = document.getElementById('pm-degrade-val')!;
const applyPattern  = document.getElementById('apply-pattern')!;
const arpLen        = document.getElementById('arp-len') as HTMLInputElement;
const arpLenVal     = document.getElementById('arp-len-val')!;
const applyArp      = document.getElementById('apply-arp')!;

// ─── Error toast ──────────────────────────────────────────────────────────────

const toast = document.createElement('div');
toast.className = 'daw-toast hidden';
document.body.appendChild(toast);
let toastTimer = 0;

function showToast(msg: string, isError = true) {
  toast.textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 4000);
}

onStrudelError(msg => showToast(`Strudel: ${msg}`));

// ─── Transport ────────────────────────────────────────────────────────────────

let playing = false;
let engine: 'tone' | 'strudel' = 'tone';

Tone.getDestination().volume.value = -6;

function setPlayIcons(isPlaying: boolean) {
  icoPlay.style.display  = isPlaying ? 'none' : '';
  icoPause.style.display = isPlaying ? '' : 'none';
}

async function runStrudelCode(code: string) {
  // Never let both engines play at once
  Tone.getTransport().pause();
  try {
    await playStrudel(code);
    playing = true;
    setPlayIcons(true);
    showToast('〜 Strudel läuft', false);
  } catch (e) {
    showToast(`Strudel: ${e instanceof Error ? e.message : e}`);
  }
}

btnPlay.addEventListener('click', async () => {
  playing = !playing;
  if (playing) {
    if (engine === 'strudel') {
      await runStrudelCode(generateCode());
    } else {
      stopStrudel();
      await startTransport();
    }
    setPlayIcons(true);
    if (state.autoRun) codeChanged();
  } else {
    Tone.getTransport().pause();
    stopStrudel();
    setPlayIcons(false);
  }
});

btnStop.addEventListener('click', () => {
  stopTransport();
  stopStrudel();
  playing = false;
  setPlayIcons(false);
});

bpmDn.addEventListener('click', () => {
  setBpm(state.bpm - 1);
  bpmDisplay.textContent = String(state.bpm);
});
bpmUp.addEventListener('click', () => {
  setBpm(state.bpm + 1);
  bpmDisplay.textContent = String(state.bpm);
});

masterVol.addEventListener('input', () => {
  Tone.getDestination().volume.rampTo(parseFloat(masterVol.value), 0.1);
});

btnAutorun.addEventListener('click', () => {
  state.autoRun = !state.autoRun;
  btnAutorun.textContent = state.autoRun ? 'AUTO ●' : 'AUTO ○';
  btnAutorun.classList.toggle('active', state.autoRun);
});

// Engine toggle (Option B): TONE = interner Sequencer, STRUDEL = echte Engine
const btnEngine = document.getElementById('btn-engine');
btnEngine?.addEventListener('click', () => {
  const wasPlaying = playing;
  // Stop whatever is running before switching
  Tone.getTransport().pause();
  stopStrudel();
  playing = false;
  setPlayIcons(false);

  engine = engine === 'tone' ? 'strudel' : 'tone';
  btnEngine.textContent = engine === 'strudel' ? '〜 STRUDEL' : '⚡ TONE';
  btnEngine.classList.toggle('engine-strudel', engine === 'strudel');
  showToast(engine === 'strudel'
    ? 'Echte Strudel-Engine aktiv (strudel.cc Sound)'
    : 'Tone.js Engine aktiv', false);

  if (engine === 'strudel') warmupStrudel();
  if (wasPlaying) btnPlay.click();
});

// Pre-warm Strudel (loads 808/909/Piano-Samples) on the very first touch
document.addEventListener('pointerdown', () => warmupStrudel(), { once: true });

// ─── Random Create ────────────────────────────────────────────────────────────

const btnRandom = document.getElementById('btn-random');
btnRandom?.addEventListener('click', () => {
  const ico = btnRandom.querySelector('.dice-ico');
  ico?.classList.remove('rolling');
  void (ico as HTMLElement)?.offsetWidth; // restart animation
  ico?.classList.add('rolling');

  randomizeProject();
  state.tracks.forEach(t => rebuildSequence(t.id));
  renderTracks();
  renderScalePanel();
  updatePianoRoll();
  codeChanged();
  showToast(`🎲 ${state.scale.root} ${state.scale.type} — neuer Zufalls-Groove`, false);
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const name = (tab as HTMLElement).dataset.tab!;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${name}`)?.classList.add('active');
    if (name === 'roll')    updatePianoRoll();
    if (name === 'scales')  renderScalePanel();
    if (name === 'browser') renderBrowser();
    if (name === 'moog')    initMoog(document.getElementById('moog-root')!);
  });
});

// ─── Track list ───────────────────────────────────────────────────────────────

function renderTracks() {
  renderTrackList(trackListEl);
}

onStep((trackId, step) => {
  highlightStep(trackId, step);
  setPianoRollStep(step);
});

renderTracks();

// Add-track buttons in HTML outside track-list
document.querySelectorAll('.add-btn[data-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = (btn as HTMLElement).dataset.type as 'drum' | 'melody' | 'chord';
    const t = addTrack(type);
    rebuildSequence(t.id);
    renderTracks();
    codeChanged();
  });
});

// ─── Piano Roll ───────────────────────────────────────────────────────────────

initPianoRoll(rollCanvas);

function updatePianoRoll() {
  const track = selectedTrack();
  if (track?.type === 'melody') {
    const mt = track as MelodyTrack;
    rollTrackName.textContent = track.name;
    rollOctVal.textContent    = String(mt.octave);
    initPianoRoll(rollCanvas);
  } else {
    rollTrackName.textContent = '— kein Melodie-Track ausgewählt —';
  }
}

rollOctDn.addEventListener('click', () => {
  const t = selectedTrack();
  if (t?.type !== 'melody') return;
  (t as MelodyTrack).octave = Math.max(1, (t as MelodyTrack).octave - 1);
  rollOctVal.textContent = String((t as MelodyTrack).octave);
});
rollOctUp.addEventListener('click', () => {
  const t = selectedTrack();
  if (t?.type !== 'melody') return;
  (t as MelodyTrack).octave = Math.min(8, (t as MelodyTrack).octave + 1);
  rollOctVal.textContent = String((t as MelodyTrack).octave);
});

// ─── Sample Browser ───────────────────────────────────────────────────────────

const SAMPLE_BANKS: Record<string, Record<string, string[]>> = {
  'DRUMS':  { 'RolandTR808':['bd','sd','hh','oh','cp','mt','lt','ht','rim','rs','cb','cy'],
               'RolandTR909':['bd','sd','hh','oh','cp','lt','mt','ht'],
               'AkaiMPC':    ['bd','sd','hh','oh','cp','tom1','tom2','clap'] },
  'SYNTHS': { 'Waveform':['sawtooth','square','sine','triangle'],
               'Analog':  ['moog'],
               'Piano':   ['piano'],
               'Pad':     ['pad','superpad','superpiano'] },
  'BASS':   { 'Bass':    ['bass','bass2','bass3','808bass'] },
  'PADS':   { 'Strings': ['strings','strings2','violin','cello'] },
};

let activeCat = 'DRUMS';

function renderBrowser() {
  browserCats.innerHTML = '';
  Object.keys(SAMPLE_BANKS).forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'browser-cat' + (cat === activeCat ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => { activeCat = cat; renderBrowser(); });
    browserCats.appendChild(btn);
  });

  browserGrid.innerHTML = '';
  const banks = SAMPLE_BANKS[activeCat] ?? {};
  Object.entries(banks).forEach(([bank, sounds]) => {
    const section = document.createElement('div');
    section.className = 'browser-section';
    const head = document.createElement('div');
    head.className   = 'browser-bank-head';
    head.textContent = bank;
    section.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'browser-bank-grid';
    sounds.forEach(sound => {
      const chip = document.createElement('button');
      chip.className   = 'browser-chip';
      chip.textContent = sound.toUpperCase();
      chip.addEventListener('click', () => {
        const track = selectedTrack();
        if (!track) return;
        if (track.type === 'drum') {
          (track as DrumTrack).sound = sound;
          (track as DrumTrack).bank  = bank;
        } else {
          (track as any).synth = sound;
        }
        rebuildSequence(track.id);
        codeChanged();
        chip.classList.add('applied');
        setTimeout(() => chip.classList.remove('applied'), 600);
      });
      grid.appendChild(chip);
    });
    section.appendChild(grid);
    browserGrid.appendChild(section);
  });
}

renderBrowser();

// ─── Scale Panel ──────────────────────────────────────────────────────────────

const ROOT_NOTES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SCALE_TYPES  = ['major','minor','dorian','phrygian','lydian','mixolydian',
                      'pentatonicMaj','pentatonicMin','blues','wholeTone','diminished','chromatic'];
const DEG_LABELS   = ['I','II','III','IV','V','VI','VII'];

function renderScalePanel() {
  scaleRoots.innerHTML = '';
  ROOT_NOTES.forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'scale-root-btn' + (n === state.scale.root ? ' active' : '');
    btn.textContent = n;
    btn.addEventListener('click', () => { state.scale.root = n; renderScalePanel(); codeChanged(); });
    scaleRoots.appendChild(btn);
  });

  scaleTypes.innerHTML = '';
  SCALE_TYPES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'scale-type-btn' + (t === state.scale.type ? ' active' : '');
    btn.textContent = t;
    btn.addEventListener('click', () => { state.scale.type = t; renderScalePanel(); codeChanged(); });
    scaleTypes.appendChild(btn);
  });

  // Keyboard
  scaleKeyboard.innerHTML = '';
  const sNotes  = getScaleNotes(state.scale.root, state.scale.type, 4);
  const inScale = new Set(sNotes.map(n => n.replace(/\d/, '')));
  ROOT_NOTES.forEach(n => {
    const key = document.createElement('div');
    key.className = ['piano-key', n.includes('#') ? 'black' : 'white', inScale.has(n) ? 'in-scale' : ''].join(' ').trim();
    key.textContent = n.includes('#') ? '' : n;
    scaleKeyboard.appendChild(key);
  });

  // Chord degrees
  chordDegreesEl.innerHTML = '';
  for (let deg = 0; deg < 7; deg++) {
    const ch  = getChordForDegree(state.scale.root, state.scale.type, deg);
    const btn = document.createElement('button');
    btn.className   = 'degree-btn' + (state.chordDegrees.includes(deg) ? ' active' : '');
    btn.textContent = DEG_LABELS[deg];
    btn.title       = ch.join(' ');
    btn.addEventListener('click', () => {
      const idx = state.chordDegrees.indexOf(deg);
      if (idx >= 0) state.chordDegrees.splice(idx, 1);
      else          state.chordDegrees.push(deg);
      btn.classList.toggle('active', state.chordDegrees.includes(deg));
      renderChordPreview();
    });
    chordDegreesEl.appendChild(btn);
  }
  renderChordPreview();
}

function renderChordPreview() {
  chordPreview.innerHTML = '';
  [...state.chordDegrees].sort((a,b)=>a-b).forEach(deg => {
    const ch   = getChordForDegree(state.scale.root, state.scale.type, deg);
    const pill = document.createElement('div');
    pill.className   = 'chord-pill';
    pill.textContent = `${DEG_LABELS[deg]}: ${ch.join('-')}`;
    chordPreview.appendChild(pill);
  });
}

insertChords.addEventListener('click', () => {
  const track = selectedTrack();
  if (track?.type !== 'chord') { alert('Bitte Akkord-Track auswählen'); return; }
  const chosen = [...state.chordDegrees].sort((a,b)=>a-b);
  if (!chosen.length) return;
  (track as ChordTrack).chords = chosen.map(deg =>
    getChordForDegree(state.scale.root, state.scale.type, deg));
  rebuildSequence(track.id);
  codeChanged();
});

renderScalePanel();

// ─── Euclid Pattern ───────────────────────────────────────────────────────────

function euclidRhythm(n: number, k: number, rot: number): boolean[] {
  const out: boolean[] = new Array(n).fill(false);
  if (k <= 0 || n <= 0) return out;
  k = Math.min(k, n);
  let pattern: boolean[] = [];
  const ps = n / k;
  for (let i = 0; i < k; i++) {
    pattern.push(true);
    const gap = Math.round(ps * (i+1)) - Math.round(ps * i) - 1;
    for (let j = 0; j < gap; j++) pattern.push(false);
  }
  while (pattern.length < n) pattern.push(false);
  pattern = pattern.slice(0, n);
  const r = ((rot % n) + n) % n;
  return [...pattern.slice(r), ...pattern.slice(0, r)];
}

function drawEuclidCanvas() {
  const n   = parseInt(euclidN.value);
  const k   = parseInt(euclidK.value);
  const rot = parseInt(euclidRot.value);
  euclidNVal.textContent = String(n);
  euclidKVal.textContent = String(k);
  euclidRVal.textContent = String(rot);
  const ctx = euclidCanvas.getContext('2d')!;
  const W = euclidCanvas.width, H = euclidCanvas.height;
  const cx = W/2, cy = H/2, r = Math.min(W,H)/2 - 12;
  ctx.clearRect(0,0,W,H);
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.strokeStyle='#ffffff22'; ctx.lineWidth=1; ctx.stroke();
  euclidRhythm(n,k,rot).forEach((hit,i) => {
    const a = (2*Math.PI*i/n) - Math.PI/2;
    const x = cx+Math.cos(a)*r, y = cy+Math.sin(a)*r;
    ctx.beginPath(); ctx.arc(x,y,hit?8:4,0,Math.PI*2);
    ctx.fillStyle = hit ? '#00ff88' : '#ffffff33'; ctx.fill();
  });
}

[euclidN,euclidK,euclidRot].forEach(el => el.addEventListener('input', drawEuclidCanvas));
drawEuclidCanvas();

applyEuclid.addEventListener('click', () => {
  const track = selectedTrack();
  if (!track) return;
  const n   = parseInt(euclidN.value);
  const k   = parseInt(euclidK.value);
  const rot = parseInt(euclidRot.value);
  if (track.type === 'drum') {
    const hits = euclidRhythm(n,k,rot);
    const dt   = track as DrumTrack;
    dt.steps = hits.slice(0, dt.steps.length);
  } else {
    track.mod.euclid = { n, k, rot };
  }
  rebuildSequence(track.id);
  renderTracks();
  codeChanged();
});

// ─── Pattern controls ─────────────────────────────────────────────────────────

const speedMap = [-3,-2,-1,0,1,2,3].map(i => [0.125,0.25,0.5,1,2,4,8][i+3]);

pmSpeed.addEventListener('input', () => {
  const v = speedMap[parseInt(pmSpeed.value)+3] ?? 1;
  pmSpeedVal.textContent = `${v}×`;
});

[pmRev,pmJux,pmPalindrome].forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('active'));
});

pmDegrade.addEventListener('input', () => {
  pmDegradeVal.textContent = `${Math.round((1-parseFloat(pmDegrade.value))*100)}%`;
});

applyPattern.addEventListener('click', () => {
  const track = selectedTrack();
  if (!track) return;
  const v = speedMap[parseInt(pmSpeed.value)+3] ?? 1;
  track.mod.speed     = v as any;
  track.mod.reverse   = pmRev.classList.contains('active');
  track.mod.jux       = pmJux.classList.contains('active');
  track.mod.palindrome = pmPalindrome.classList.contains('active');
  track.mod.degrade   = parseFloat(pmDegrade.value);
  rebuildSequence(track.id);
  codeChanged();
});

// Arp
let selectedArpMode = 'off';
document.querySelectorAll('[data-arp]').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = (btn as HTMLElement).dataset.arp!;
    selectedArpMode = selectedArpMode === mode ? 'off' : mode;
    document.querySelectorAll('[data-arp]').forEach(b =>
      b.classList.toggle('active', (b as HTMLElement).dataset.arp === selectedArpMode));
  });
});
arpLen.addEventListener('input', () => { arpLenVal.textContent = arpLen.value; });
applyArp.addEventListener('click', () => {
  const track = selectedTrack();
  if (track?.type !== 'melody') return;
  track.mod.arpMode = selectedArpMode as any;
  track.mod.arpLen  = parseInt(arpLen.value);
  rebuildSequence(track.id);
  codeChanged();
});

// ─── FX Overlay ───────────────────────────────────────────────────────────────

fxClose.addEventListener('click', () => fxOverlay.classList.add('hidden'));
fxOverlay.addEventListener('click', (e) => {
  if (e.target === fxOverlay) fxOverlay.classList.add('hidden');
});

document.addEventListener('daw:openFx', (e: Event) => {
  const id    = (e as CustomEvent).detail.id as string;
  const track = state.tracks.find(t => t.id === id);
  if (!track) return;
  fxTrackName.textContent = `FX — ${track.name}`;
  fxKnobbsEl.innerHTML = '';

  type FxKey = keyof typeof track.fx;
  const defs: Array<{ label:string; key:FxKey; min:number; max:number; step:number }> = [
    { label:'GAIN',   key:'gain',   min:0,    max:2,     step:0.01 },
    { label:'PAN',    key:'pan',    min:-1,   max:1,     step:0.01 },
    { label:'CUTOFF', key:'cutoff', min:80,   max:20000, step:10   },
    { label:'RES',    key:'res',    min:0,    max:20,    step:0.1  },
    { label:'REVERB', key:'room',   min:0,    max:1,     step:0.01 },
    { label:'DELAY',  key:'delay',  min:0,    max:1,     step:0.01 },
    { label:'CRUSH',  key:'crush',  min:1,    max:16,    step:1    },
  ];

  defs.forEach(({ label, key, min, max, step }) => {
    const wrap = document.createElement('div');
    wrap.className = 'fx-knob-wrap';
    const cvs = document.createElement('canvas');
    cvs.className = 'fx-knob-canvas'; cvs.width = 70; cvs.height = 70;
    const valEl = document.createElement('span'); valEl.className = 'fx-val';
    const lblEl = document.createElement('span'); lblEl.className = 'fx-lbl';
    lblEl.textContent = label;

    const fmtVal = (v: number) => {
      if (key === 'cutoff') return `${Math.round(v)}Hz`;
      if (key === 'crush')  return `${Math.round(v)}b`;
      if (key === 'pan')    return v===0 ? 'C' : v>0 ? `R${(v*100).toFixed(0)}` : `L${(-v*100).toFixed(0)}`;
      return v.toFixed(2);
    };

    const drawKnob = (v: number) => {
      const ctx = cvs.getContext('2d')!;
      const W=cvs.width, H=cvs.height, cx=W/2, cy=H/2, r=Math.min(W,H)/2-7;
      const norm=(v-min)/(max-min), sa=Math.PI*0.75, ea=sa+norm*Math.PI*1.5;
      ctx.clearRect(0,0,W,H);
      ctx.beginPath(); ctx.arc(cx,cy,r,sa,sa+Math.PI*1.5); ctx.strokeStyle='#333'; ctx.lineWidth=5; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx,cy,r,sa,ea); ctx.strokeStyle=track.color; ctx.lineWidth=5; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fillStyle=track.color; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(ea)*(r-2), cy+Math.sin(ea)*(r-2));
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    };

    valEl.textContent = fmtVal(track.fx[key]);
    drawKnob(track.fx[key]);

    let dragging=false, startY=0, startVal=0;
    cvs.addEventListener('pointerdown', (e) => {
      dragging=true; startY=e.clientY; startVal=track.fx[key]; cvs.setPointerCapture(e.pointerId);
    });
    cvs.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const delta=(startY-e.clientY)/150;
      let nv=Math.min(max,Math.max(min,startVal+delta*(max-min)));
      nv=Math.round(nv/step)*step;
      (track.fx as any)[key]=nv; valEl.textContent=fmtVal(nv); drawKnob(nv);
      applyFx(track.id, track.fx); codeChanged();
    });
    cvs.addEventListener('pointerup', () => { dragging=false; });

    wrap.appendChild(cvs); wrap.appendChild(valEl); wrap.appendChild(lblEl);
    fxKnobbsEl.appendChild(wrap);
  });

  fxOverlay.classList.remove('hidden');
});

// ─── Code drawer ─────────────────────────────────────────────────────────────

let drawerOpen = false;

codeToggle.addEventListener('click', () => {
  drawerOpen = !drawerOpen;
  codeDrawer.classList.toggle('open', drawerOpen);
  codeArrow.textContent = drawerOpen ? '▼' : '▲';
  if (drawerOpen) updateEditorCode(generateCode());
});

btnCopyCode.addEventListener('click', async () => {
  await navigator.clipboard.writeText(generateCode()).catch(() => {});
  const orig = btnCopyCode.textContent!;
  btnCopyCode.textContent = '✓ KOPIERT';
  setTimeout(() => { btnCopyCode.textContent = orig; }, 1500);
});

// AUSFÜHREN: play through the REAL Strudel engine (Option A).
// If the drawer is open the (possibly hand-edited) editor content runs,
// otherwise fresh code is generated from the current tracks.
btnRunCode.addEventListener('click', async () => {
  let code = drawerOpen ? getEditorCode().trim() : '';
  if (!code || code.startsWith('// Drücke')) {
    code = generateCode();
    updateEditorCode(code);
  }
  await runStrudelCode(code);
});

initEditor(codeEditorEl, (code) => { runStrudelCode(code); });

// ─── Code change helper ───────────────────────────────────────────────────────

let reEvalTimer = 0;

function codeChanged() {
  if (drawerOpen || state.autoRun) updateEditorCode(generateCode());
  // Live re-eval while the Strudel engine is playing (live-coding feel)
  if (engine === 'strudel' && playing) {
    clearTimeout(reEvalTimer);
    reEvalTimer = window.setTimeout(() => {
      playStrudel(generateCode()).catch(e => showToast(`Strudel: ${e?.message ?? e}`));
    }, 350);
  }
}
