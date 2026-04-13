import './session.css';
import * as Tone from 'tone';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Clip {
  id: string;
  name: string;
  color: string;           // hex
  type: 'drum' | 'melody' | 'chord' | 'custom';
  steps: boolean[];        // 16 steps (drum)
  notes: (string|null)[];  // 16 steps (melody)
  sound: string;           // e.g. "bd", "sawtooth", "piano"
  bank: string;            // e.g. "RolandTR808" or ""
  code: string;            // raw code override (custom)
}

interface Track {
  id: string;
  name: string;
  color: string;
  type: 'drum'|'melody'|'chord'|'bass';
  clips: (Clip|null)[];    // indexed by scene index
  volume: number;          // dB
  muted: boolean;
  solo: boolean;
  activeScene: number|null;
  queuedScene: number|null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCENE_COUNT  = 8;
const STEP_COUNT   = 16;
const NOTE_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CLIP_COLORS  = [
  '#00ff88','#00cfff','#a855f7','#f97316','#f43f5e',
  '#fbbf24','#3b82f6','#ec4899','#84cc16','#14b8a6',
];
const DRUM_SOUNDS_808 = ['bd','sd','hh','oh','cp','cb','mt','lt','ht','ma','rs','cl'];
const DRUM_SOUNDS_909 = ['bd','sd','hh','oh','cp'];
const MELODY_SOUNDS   = ['sawtooth','sine','square','triangle','piano','violin','flute'];

// ─── State ───────────────────────────────────────────────────────────────────

let tracks: Track[] = [];
let bpm = 120;
let quantize = '1m';
let playing = false;
let currentBeat = 0;

// Tone.js objects per track
const gainNodes  = new Map<string, Tone.Volume>();
const sequences  = new Map<string, Tone.Sequence>();

// ─── Initial demo tracks ──────────────────────────────────────────────────────

function makeClip(o: Partial<Clip> & { name: string; color: string }): Clip {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'drum',
    steps: new Array(STEP_COUNT).fill(false),
    notes: new Array(STEP_COUNT).fill(null),
    sound: 'bd',
    bank: 'RolandTR808',
    code: '',
    ...o,
  };
}

function makeTrack(o: Partial<Track> & { name: string; color: string }): Track {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'drum',
    clips: new Array(SCENE_COUNT).fill(null),
    volume: -6,
    muted: false,
    solo: false,
    activeScene: null,
    queuedScene: null,
    ...o,
  };
}

function buildDefaultTracks() {
  const kick = makeTrack({ name: 'KICK', color: '#00ff88', type: 'drum' });
  kick.clips[0] = makeClip({ name: 'Standard', color: '#00ff88', type: 'drum', sound: 'bd', bank: 'RolandTR808',
    steps: pat('x...x...x...x...')  });
  kick.clips[1] = makeClip({ name: 'Breaks', color: '#00ff88', type: 'drum', sound: 'bd', bank: 'RolandTR808',
    steps: pat('x..x..x.x...x...')  });
  kick.clips[2] = makeClip({ name: 'Four-on-Floor', color: '#00ff88', type: 'drum', sound: 'bd', bank: 'RolandTR808',
    steps: pat('x...x...x...x...')  });

  const snare = makeTrack({ name: 'SNARE', color: '#00cfff', type: 'drum' });
  snare.clips[0] = makeClip({ name: 'Standard', color: '#00cfff', type: 'drum', sound: 'sd', bank: 'RolandTR808',
    steps: pat('....x.......x...')  });
  snare.clips[1] = makeClip({ name: 'Synkopiert', color: '#00cfff', type: 'drum', sound: 'sd', bank: 'RolandTR808',
    steps: pat('..x...x...x..x..')  });

  const hihat = makeTrack({ name: 'HI-HAT', color: '#f97316', type: 'drum' });
  hihat.clips[0] = makeClip({ name: '8tel', color: '#f97316', type: 'drum', sound: 'hh', bank: 'RolandTR808',
    steps: pat('x.x.x.x.x.x.x.x.')  });
  hihat.clips[1] = makeClip({ name: '16tel', color: '#f97316', type: 'drum', sound: 'hh', bank: 'RolandTR808',
    steps: new Array(16).fill(true)  });
  hihat.clips[2] = makeClip({ name: 'Offen', color: '#fbbf24', type: 'drum', sound: 'oh', bank: 'RolandTR808',
    steps: pat('...x...x...x...x')  });

  const bass = makeTrack({ name: 'BASS', color: '#a855f7', type: 'melody' });
  bass.clips[0] = makeClip({ name: 'Groove', color: '#a855f7', type: 'melody', sound: 'sawtooth',
    notes: noteSeq(['C2','','','G2','','','Bb2','','C2','','','Eb2','','','','']) });
  bass.clips[1] = makeClip({ name: 'Walk', color: '#a855f7', type: 'melody', sound: 'sawtooth',
    notes: noteSeq(['C2','','D2','','E2','','G2','','A2','','','','C3','','','']) });

  const lead = makeTrack({ name: 'LEAD', color: '#f43f5e', type: 'melody' });
  lead.clips[0] = makeClip({ name: 'Phrase 1', color: '#f43f5e', type: 'melody', sound: 'sawtooth',
    notes: noteSeq(['C4','','E4','','G4','','B4','','G4','','E4','','D4','','','']) });
  lead.clips[1] = makeClip({ name: 'Phrase 2', color: '#f43f5e', type: 'melody', sound: 'sawtooth',
    notes: noteSeq(['F4','','','A4','','C5','','','Bb4','','','G4','','','E4','']) });

  const chords = makeTrack({ name: 'CHORDS', color: '#3b82f6', type: 'chord' });
  chords.clips[0] = makeClip({ name: 'Cm', color: '#3b82f6', type: 'chord', sound: 'sine',
    code: `note("<[c4,eb4,g4] [f4,ab4,c5] [g4,bb4,d5] [ab4,c5,eb5]>/4").s("triangle").gain(0.45).room(0.4)` });
  chords.clips[1] = makeClip({ name: 'C major', color: '#60a5fa', type: 'chord', sound: 'sine',
    code: `note("<[c4,e4,g4] [f4,a4,c5] [g4,b4,d5] [a4,c5,e5]>/4").s("triangle").gain(0.45).room(0.4)` });

  tracks = [kick, snare, hihat, bass, lead, chords];
}

function pat(s: string): boolean[] {
  return s.split('').filter((_,i) => i < 16).map(c => c === 'x');
}
function noteSeq(arr: string[]): (string|null)[] {
  return arr.map(n => n === '' ? null : n);
}

// ─── Audio engine ─────────────────────────────────────────────────────────────

let masterVol: Tone.Volume;
let masterReverb: Tone.Reverb;

// Instruments (shared pool)
const drumSynths: { kick: Tone.MembraneSynth; snare: Tone.NoiseSynth; hh: Tone.MetalSynth } = {} as any;
const melodySynths = new Map<string, Tone.PolySynth>();

function buildAudio() {
  masterReverb = new Tone.Reverb({ decay: 1.5, wet: 0.15 }).toDestination();
  masterVol    = new Tone.Volume(-6).connect(masterReverb);

  drumSynths.kick  = new Tone.MembraneSynth({ pitchDecay: .05, octaves: 8,
    envelope: { attack: .001, decay: .32, sustain: 0, release: .1 } }).connect(masterVol);
  drumSynths.snare = new Tone.NoiseSynth({ noise: { type: 'white' },
    envelope: { attack: .001, decay: .18, sustain: 0, release: .05 } }).connect(masterVol);
  drumSynths.hh    = new Tone.MetalSynth({ harmonicity: 5.1, modulationIndex: 32,
    resonance: 4000, octaves: 1.5,
    envelope: { attack: .001, decay: .08, release: .01 } }).connect(masterVol);

  // Per-track gain + sequences
  tracks.forEach(track => {
    const gain = new Tone.Volume(track.volume);
    gain.connect(masterVol);
    gainNodes.set(track.id, gain);
  });
}

function getOrCreateMelodySynth(trackId: string, sound: string): Tone.PolySynth {
  if (!melodySynths.has(trackId)) {
    const type = (['sine','square','triangle','sawtooth'].includes(sound)
      ? sound : 'sawtooth') as OscillatorType;
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type },
      envelope: { attack: .02, decay: .15, sustain: .5, release: .4 },
    }).connect(gainNodes.get(trackId) ?? masterVol);
    melodySynths.set(trackId, synth);
  }
  return melodySynths.get(trackId)!;
}

// ─── Sequencer ────────────────────────────────────────────────────────────────

let beatSeq: Tone.Sequence;

function buildMainSequencer() {
  beatSeq = new Tone.Sequence((time, step) => {
    const s = step as number;
    currentBeat = s % 4;
    Tone.getDraw().schedule(() => updateBeatDots(currentBeat), time);

    tracks.forEach(track => {
      if (track.muted) return;
      if (track.activeScene === null) return;
      const clip = track.clips[track.activeScene];
      if (!clip) return;
      playClipStep(track, clip, s, time);
    });

    // Handle quantized launches at measure boundaries
    if (s === 0) {
      tracks.forEach(track => {
        if (track.queuedScene !== null) {
          track.activeScene = track.queuedScene;
          track.queuedScene = null;
          Tone.getDraw().schedule(() => renderGrid(), time);
        }
      });
    }
  }, [...Array(STEP_COUNT).keys()], '16n');

  beatSeq.start(0);
}

function playClipStep(track: Track, clip: Clip, step: number, time: number) {
  if (clip.type === 'drum') {
    if (!clip.steps[step]) return;
    const s = clip.sound;
    if (s === 'bd') drumSynths.kick.triggerAttackRelease('C1', '8n', time);
    else if (s === 'sd') drumSynths.snare.triggerAttackRelease('8n', time);
    else if (s === 'hh' || s === 'oh') drumSynths.hh.triggerAttackRelease('C5', s === 'hh' ? '32n' : '16n', time);
    else drumSynths.kick.triggerAttackRelease('C2', '8n', time);
  } else if (clip.type === 'melody') {
    const note = clip.notes[step];
    if (!note) return;
    const synth = getOrCreateMelodySynth(track.id, clip.sound);
    synth.triggerAttackRelease(note, '8n', time);
  } else if (clip.type === 'chord') {
    // Chord clips run every 4 steps = quarter note
    if (step % 4 !== 0) return;
    const chordIdx = Math.floor(step / 4);
    const synth = getOrCreateMelodySynth(track.id, 'triangle');
    const chords = [
      ['C4','Eb4','G4'], ['F4','Ab4','C5'], ['G4','Bb4','D5'], ['Ab4','C5','Eb5']
    ];
    const chord = chords[chordIdx % chords.length];
    synth.triggerAttackRelease(chord, '2n', time);
  }
  // Update progress bar
  Tone.getDraw().schedule(() => updateClipProgress(track.id, step), time);
}

// ─── Transport ────────────────────────────────────────────────────────────────

async function startStop() {
  await Tone.start();
  if (!playing) {
    playing = true;
    Tone.getTransport().start();
    document.getElementById('btn-play')!.classList.add('running');
    document.getElementById('ico-play')!.style.display  = 'none';
    document.getElementById('ico-stop2')!.style.display = '';
  } else {
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
    playing = false;
    document.getElementById('btn-play')!.classList.remove('running');
    document.getElementById('ico-play')!.style.display  = '';
    document.getElementById('ico-stop2')!.style.display = 'none';
    updateBeatDots(-1);
  }
}

// ─── Clip launching ───────────────────────────────────────────────────────────

function launchClip(trackId: string, sceneIdx: number) {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return;
  const clip = track.clips[sceneIdx];
  if (!clip) { openClipEditor(trackId, sceneIdx); return; }

  if (!playing) startStop();

  if (quantize === '0') {
    track.activeScene = sceneIdx;
    track.queuedScene = null;
  } else {
    if (track.queuedScene === sceneIdx) {
      track.queuedScene = null; // cancel queue
    } else {
      track.queuedScene = sceneIdx;
    }
  }
  renderGrid();
}

function launchScene(sceneIdx: number) {
  if (!playing) startStop();
  tracks.forEach(track => {
    if (track.clips[sceneIdx]) {
      track.queuedScene = sceneIdx;
    }
  });
  renderGrid();
}

function stopTrack(trackId: string) {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return;
  track.activeScene = null;
  track.queuedScene = null;
  renderGrid();
}

// ─── Grid rendering ───────────────────────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById('session-grid')!;
  const N = tracks.length;

  // Dynamic grid columns: corner + N tracks + scene-launch
  grid.style.gridTemplateColumns =
    `36px repeat(${N},90px) 40px`;

  grid.innerHTML = '';

  // Row 1: headers
  const corner = el('div','scene-label-cell header-corner');
  grid.appendChild(corner);

  tracks.forEach(track => {
    const header = el('div','track-header');
    header.style.borderBottomColor = track.color;

    const label = el('div','track-header-label') as HTMLElement;
    label.textContent = track.name;
    label.contentEditable = 'true';
    label.addEventListener('blur', () => { track.name = label.textContent || ''; });
    header.appendChild(label);

    const controls = el('div','track-header-controls');
    const mBtn = el('button','th-btn' + (track.muted ? ' muted' : '')) as HTMLButtonElement;
    mBtn.textContent = 'M';
    mBtn.addEventListener('click', () => { track.muted = !track.muted; mBtn.classList.toggle('muted', track.muted); });
    controls.appendChild(mBtn);

    const sBtn = el('button','th-btn' + (track.solo ? ' solo' : '')) as HTMLButtonElement;
    sBtn.textContent = 'S';
    sBtn.addEventListener('click', () => { track.solo = !track.solo; sBtn.classList.toggle('solo', track.solo); });
    controls.appendChild(sBtn);
    header.appendChild(controls);

    const vol = el('input','track-vol-mini') as HTMLInputElement;
    vol.type = 'range'; vol.min = '-40'; vol.max = '0'; vol.step = '1';
    vol.value = String(track.volume);
    vol.addEventListener('input', () => {
      track.volume = parseInt(vol.value);
      gainNodes.get(track.id)?.volume.rampTo(track.volume, 0.05);
    });
    header.appendChild(vol);
    grid.appendChild(header);
  });

  // Scene launch header
  const slh = el('div','scene-launch-header');
  grid.appendChild(slh);

  // Scene rows
  for (let si = 0; si < SCENE_COUNT; si++) {
    // Scene label
    const scLbl = el('div','scene-label-cell') as HTMLElement;
    scLbl.textContent = String(si + 1);
    grid.appendChild(scLbl);

    // Clips
    tracks.forEach(track => {
      const clip = track.clips[si];
      const cell = el('div','clip-cell');
      const btn  = el('button', [
        'clip-btn',
        clip ? 'has-clip' : 'empty',
        track.activeScene === si ? 'playing' : '',
        track.queuedScene === si ? 'queued'  : '',
      ].filter(Boolean).join(' ')) as HTMLButtonElement;

      if (clip) {
        btn.style.background = clip.color + 'cc';
        btn.style.borderColor = clip.color;

        const lbl = el('div','clip-label');
        lbl.textContent = clip.name;
        btn.appendChild(lbl);

        const prog = el('div','clip-progress') as HTMLElement;
        prog.id = `prog-${track.id}-${si}`;
        btn.appendChild(prog);

        const tri = el('div','clip-play-tri');
        btn.appendChild(tri);

        btn.addEventListener('click', () => launchClip(track.id, si));
        btn.addEventListener('contextmenu', e => {
          e.preventDefault();
          openClipEditor(track.id, si);
        });
        // Long press to edit
        let lt: ReturnType<typeof setTimeout>;
        btn.addEventListener('pointerdown', () => { lt = setTimeout(() => openClipEditor(track.id, si), 600); });
        btn.addEventListener('pointerup', () => clearTimeout(lt));
      } else {
        btn.addEventListener('click', () => openClipEditor(track.id, si));
      }

      cell.appendChild(btn);
      grid.appendChild(cell);
    });

    // Scene launch
    const slCell = el('div','scene-launch-cell');
    const slBtn  = el('button','scene-launch-btn') as HTMLButtonElement;
    slBtn.textContent = '▶';
    slBtn.addEventListener('click', () => launchScene(si));
    slCell.appendChild(slBtn);
    grid.appendChild(slCell);
  }

  // Stop row
  const stopCorner = el('div','scene-label-cell stop-row');
  stopCorner.style.borderBottom = '2px solid var(--border2)';
  grid.appendChild(stopCorner);

  tracks.forEach(track => {
    const cell = el('div','clip-cell stop-row');
    const btn  = el('button','stop-track-btn') as HTMLButtonElement;
    btn.textContent = '■';
    btn.addEventListener('click', () => stopTrack(track.id));
    cell.appendChild(btn);
    grid.appendChild(cell);
  });

  const stopRight = el('div','scene-launch-header');
  stopRight.style.height = '36px';
  grid.appendChild(stopRight);
}

function updateBeatDots(beat: number) {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`b${i}`)?.classList.toggle('active', i === beat);
  }
}

function updateClipProgress(trackId: string, step: number) {
  const track = tracks.find(t => t.id === trackId);
  if (!track || track.activeScene === null) return;
  const id   = `prog-${trackId}-${track.activeScene}`;
  const prog = document.getElementById(id) as HTMLElement|null;
  if (prog) prog.style.width = `${((step + 1) / STEP_COUNT) * 100}%`;
}

// ─── Clip Editor ──────────────────────────────────────────────────────────────

let editingTrackId: string|null = null;
let editingSceneIdx: number|null = null;
let editClip: Clip|null = null;
let selectedNoteStep: number|null = null;

function openClipEditor(trackId: string, sceneIdx: number) {
  const track  = tracks.find(t => t.id === trackId)!;
  const existing = track.clips[sceneIdx];
  editingTrackId  = trackId;
  editingSceneIdx = sceneIdx;
  editClip = existing ? { ...existing,
    steps: [...existing.steps], notes: [...existing.notes] } : {
    id: Math.random().toString(36).slice(2),
    name: `Clip ${sceneIdx + 1}`,
    color: CLIP_COLORS[sceneIdx % CLIP_COLORS.length],
    type: track.type === 'drum' ? 'drum' : 'melody',
    steps: new Array(STEP_COUNT).fill(false),
    notes: new Array(STEP_COUNT).fill(null),
    sound: track.type === 'drum' ? 'bd' : 'sawtooth',
    bank: track.type === 'drum' ? 'RolandTR808' : '',
    code: '',
  };

  document.getElementById('sheet-title')!.textContent =
    `${track.name} — Szene ${sceneIdx + 1}`;
  (document.getElementById('clip-name-input') as HTMLInputElement).value = editClip.name;
  (document.getElementById('clip-code-editor') as HTMLTextAreaElement).value = editClip.code;

  buildColorSwatches();
  buildStepsEditor();
  buildNoteSteps();
  buildSoundSelector(track.type);
  buildMiniKeyboard();

  document.getElementById('sheet-overlay')!.classList.remove('hidden');
}

function closeClipEditor() {
  document.getElementById('sheet-overlay')!.classList.add('hidden');
  editingTrackId = null; editingSceneIdx = null; editClip = null;
  selectedNoteStep = null;
}

function saveClip() {
  if (!editClip || editingTrackId === null || editingSceneIdx === null) return;
  editClip.name  = (document.getElementById('clip-name-input') as HTMLInputElement).value || editClip.name;
  editClip.code  = (document.getElementById('clip-code-editor') as HTMLTextAreaElement).value;
  const track    = tracks.find(t => t.id === editingTrackId)!;
  track.clips[editingSceneIdx] = { ...editClip };
  closeClipEditor();
  renderGrid();
}

function buildColorSwatches() {
  const wrap = document.getElementById('color-swatches')!;
  wrap.innerHTML = '';
  CLIP_COLORS.forEach(color => {
    const sw = el('button','color-swatch' + (editClip?.color === color ? ' active' : '')) as HTMLButtonElement;
    sw.style.background = color;
    sw.addEventListener('click', () => {
      if (editClip) editClip.color = color;
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
    wrap.appendChild(sw);
  });
}

function buildStepsEditor() {
  const wrap = document.getElementById('clip-steps')!;
  wrap.innerHTML = '';
  if (!editClip) return;
  for (let i = 0; i < STEP_COUNT; i++) {
    const s = el('button','ed-step' + (editClip.steps[i] ? ' on' : '') + (i % 4 === 0 ? ' beat-mark' : '')) as HTMLButtonElement;
    s.addEventListener('click', () => {
      if (!editClip) return;
      editClip.steps[i] = !editClip.steps[i];
      s.classList.toggle('on', editClip.steps[i]);
    });
    wrap.appendChild(s);
  }
}

function buildNoteSteps() {
  const wrap = document.getElementById('note-steps')!;
  wrap.innerHTML = '';
  if (!editClip) return;
  for (let i = 0; i < STEP_COUNT; i++) {
    const note = editClip.notes[i];
    const s = el('button','note-step' + (note ? ' has-note' : '') +
      (selectedNoteStep === i ? ' selected' : '')) as HTMLButtonElement;
    s.textContent = note ? note.replace(/\d/, '') : String(i + 1);
    s.addEventListener('click', () => {
      selectedNoteStep = selectedNoteStep === i ? null : i;
      buildNoteSteps();
      refreshMiniKeyboard();
    });
    wrap.appendChild(s);
  }
}

function buildSoundSelector(trackType: string) {
  const wrap = document.getElementById('sound-select-wrap')!;
  wrap.innerHTML = '';
  if (!editClip) return;
  const sounds = trackType === 'drum' ? DRUM_SOUNDS_808 : MELODY_SOUNDS;
  sounds.forEach(s => {
    const chip = el('button','sound-chip' + (editClip!.sound === s ? ' active' : '')) as HTMLButtonElement;
    chip.textContent = s.toUpperCase();
    chip.addEventListener('click', () => {
      if (!editClip) return;
      editClip.sound = s;
      wrap.querySelectorAll('.sound-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    wrap.appendChild(chip);
  });
}

function buildMiniKeyboard() {
  const kb = document.getElementById('mini-keyboard')!;
  kb.innerHTML = '';
  const noteSequence = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  for (let oct = 3; oct <= 5; oct++) {
    noteSequence.forEach(name => {
      const full  = `${name}${oct}`;
      const black = name.includes('#');
      const key   = el('button',`mk-${black?'black':'white'}`) as HTMLButtonElement;
      key.dataset.note = full;
      key.addEventListener('click', () => {
        if (!editClip || selectedNoteStep === null) {
          // just preview: TODO Tone.js preview
          return;
        }
        editClip.notes[selectedNoteStep] =
          editClip.notes[selectedNoteStep] === full ? null : full;
        buildNoteSteps();
        refreshMiniKeyboard();
      });
      kb.appendChild(key);
    });
  }
  refreshMiniKeyboard();
}

function refreshMiniKeyboard() {
  const activeNotes = new Set(editClip?.notes.filter(Boolean));
  document.querySelectorAll<HTMLElement>('.mini-keyboard .mk-white, .mini-keyboard .mk-black')
    .forEach(k => k.classList.toggle('lit', activeNotes.has(k.dataset.note ?? '')));
}

// ─── Add track ────────────────────────────────────────────────────────────────

function addTrack(type: 'drum'|'melody'|'chord'|'bass') {
  const colors: Record<string,string> = { drum:'#00ff88', melody:'#a855f7', chord:'#3b82f6', bass:'#f97316' };
  const names:  Record<string,string> = { drum:'DRUM', melody:'MELODIE', chord:'AKKORDE', bass:'BASS' };
  const t = makeTrack({ name: names[type], color: colors[type], type });
  tracks.push(t);
  const gain = new Tone.Volume(t.volume).connect(masterVol);
  gainNodes.set(t.id, gain);
  renderGrid();
}

// ─── Strudel code export ──────────────────────────────────────────────────────

function toStrudelCode(): string {
  const parts: string[] = [];
  tracks.forEach(track => {
    if (track.activeScene === null || track.muted) return;
    const clip = track.clips[track.activeScene];
    if (!clip) return;

    if (clip.code) { parts.push(clip.code); return; }

    if (clip.type === 'drum') {
      const pat = clip.steps.map(s => s ? clip.sound : '~').join(' ');
      let code = `sound("${pat}").bank("RolandTR808")`;
      if (track.volume !== -6) code += `.gain(${Tone.dbToGain(track.volume).toFixed(2)})`;
      parts.push(code);
    } else if (clip.type === 'melody') {
      const pat = clip.notes.map(n => n ?? '~').join(' ');
      parts.push(`note("${pat}").s("${clip.sound}")`);
    }
  });
  if (parts.length === 0) return '// Kein Clip aktiv';
  if (parts.length === 1) return parts[0];
  return `stack(\n  ${parts.join(',\n  ')}\n)`;
}

// ─── Sheet tab switching ──────────────────────────────────────────────────────

function initSheetTabs() {
  document.querySelectorAll<HTMLButtonElement>('.sh-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sh-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sh-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`sh-${tab.dataset.sh}`)!.classList.add('active');

      // Sync code tab
      if (tab.dataset.sh === 'code' && editClip) {
        (document.getElementById('clip-code-editor') as HTMLTextAreaElement).value =
          editClip.code || suggestCode();
      }
    });
  });
}

function suggestCode(): string {
  if (!editClip) return '';
  if (editClip.type === 'drum') {
    const pat = editClip.steps.map(s => s ? editClip!.sound : '~').join(' ');
    return `sound("${pat}").bank("RolandTR808")`;
  } else {
    const pat = editClip.notes.map(n => n ?? '~').join(' ');
    return `note("${pat}").s("${editClip.sound}")`;
  }
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function init() {
  buildDefaultTracks();
  buildAudio();
  buildMainSequencer();
  renderGrid();
  initSheetTabs();

  // Transport
  document.getElementById('btn-play')!.addEventListener('click', startStop);

  // BPM
  const bpmEl = document.getElementById('bpm-val')!;
  document.getElementById('bpm-dn')!.addEventListener('click', () => {
    bpm = Math.max(40, bpm - 2);
    bpmEl.textContent = String(bpm);
    Tone.getTransport().bpm.rampTo(bpm, 0.1);
  });
  document.getElementById('bpm-up')!.addEventListener('click', () => {
    bpm = Math.min(240, bpm + 2);
    bpmEl.textContent = String(bpm);
    Tone.getTransport().bpm.rampTo(bpm, 0.1);
  });
  Tone.getTransport().bpm.value = bpm;

  // Quantize
  document.getElementById('quant-select')!.addEventListener('change', e => {
    quantize = (e.target as HTMLSelectElement).value;
  });

  // Volume
  document.getElementById('master-vol')!.addEventListener('input', e => {
    masterVol.volume.rampTo(parseInt((e.target as HTMLInputElement).value), 0.05);
  });

  // Add track
  document.getElementById('btn-add-track')!.addEventListener('click', () => {
    const types: Array<'drum'|'melody'|'chord'|'bass'> = ['drum','melody','chord','bass'];
    const t = types[tracks.length % types.length];
    addTrack(t);
  });

  // Sheet close / save / delete
  document.getElementById('sheet-close')!.addEventListener('click', closeClipEditor);
  document.getElementById('sheet-overlay')!.addEventListener('click', e => {
    if (e.target === document.getElementById('sheet-overlay')) closeClipEditor();
  });
  document.getElementById('clip-save')!.addEventListener('click', saveClip);
  document.getElementById('clip-delete')!.addEventListener('click', () => {
    if (editingTrackId !== null && editingSceneIdx !== null) {
      const track = tracks.find(t => t.id === editingTrackId)!;
      track.clips[editingSceneIdx] = null;
      if (track.activeScene === editingSceneIdx) track.activeScene = null;
      if (track.queuedScene  === editingSceneIdx) track.queuedScene  = null;
    }
    closeClipEditor();
    renderGrid();
  });
}

document.addEventListener('DOMContentLoaded', init);
