import { DAWState, Track, defaultFx, defaultMod } from './types';

// ─── Singleton state ──────────────────────────────────────────────────────────

export const state: DAWState = {
  tracks:       [],
  selectedId:   null,
  bpm:          120,
  autoRun:      false,
  scale:        { root: 'C', type: 'major' },
  chordDegrees: [0, 3, 4, 5],
};

// ─── Track factories ──────────────────────────────────────────────────────────

let _id = 0;
function uid() { return `t${++_id}`; }

export function makeDrumTrack(name: string, sound: string, bank: string, color: string, steps?: boolean[]): Track {
  const STEPS = 16;
  return {
    id: uid(), type: 'drum', name, color, sound, bank,
    steps: steps ?? new Array(STEPS).fill(false),
    fx: defaultFx(), mod: defaultMod(), muted: false,
  };
}

export function makeMelodyTrack(name: string, synth: string, color: string): Track {
  const STEPS = 16;
  return {
    id: uid(), type: 'melody', name, color, synth,
    steps: new Array(STEPS).fill(null), octave: 4,
    fx: defaultFx(), mod: defaultMod(), muted: false,
  };
}

export function makeChordTrack(name: string, synth: string, color: string): Track {
  return {
    id: uid(), type: 'chord', name, color, synth,
    chords: [['C4','E4','G4'], ['F4','A4','C5'], ['G4','B4','D5'], ['A4','C5','E5']],
    fx: defaultFx(), mod: defaultMod(), muted: false,
  };
}

// ─── Default project ──────────────────────────────────────────────────────────

export function loadDefaultProject() {
  const p = (s: string) => s.split('').map(c => c === 'x');
  state.tracks = [
    makeDrumTrack('KICK',  'bd', 'RolandTR808', '#00ff88', p('x...x...x...x...')),
    makeDrumTrack('SNARE', 'sd', 'RolandTR808', '#00cfff', p('....x.......x...')),
    makeDrumTrack('HIHAT', 'hh', 'RolandTR808', '#f97316', p('x.x.x.x.x.x.x.x.')),
    makeMelodyTrack('BASS',   'sawtooth', '#a855f7'),
    makeMelodyTrack('LEAD',   'sawtooth', '#f43f5e'),
    makeChordTrack('AKKORDE', 'triangle', '#3b82f6'),
  ];
  state.selectedId = state.tracks[0].id;
}

export function selectedTrack(): Track | undefined {
  return state.tracks.find(t => t.id === state.selectedId);
}

export function addTrack(type: 'drum' | 'melody' | 'chord') {
  const colors: Record<string,string> = { drum:'#00ff88', melody:'#a855f7', chord:'#3b82f6' };
  let t: Track;
  if (type === 'drum')   t = makeDrumTrack('DRUM',    'bd',       'RolandTR808', colors.drum);
  else if (type === 'melody') t = makeMelodyTrack('MELODIE', 'sawtooth', colors.melody);
  else                   t = makeChordTrack('AKKORDE', 'triangle', colors.chord);
  state.tracks.push(t);
  state.selectedId = t.id;
  return t;
}

export function removeTrack(id: string) {
  state.tracks = state.tracks.filter(t => t.id !== id);
  if (state.selectedId === id) state.selectedId = state.tracks[0]?.id ?? null;
}
