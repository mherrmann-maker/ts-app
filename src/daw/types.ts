// ─── Core types for the DAW ───────────────────────────────────────────────────

export type TrackType = 'drum' | 'melody' | 'chord';

export interface TrackFx {
  gain:    number;   // 0–2
  pan:     number;   // -1–1
  cutoff:  number;   // 80–20000 Hz
  res:     number;   // 0–20
  room:    number;   // 0–1
  delay:   number;   // 0–1
  crush:   number;   // 1–16 (bit depth)
}

export interface TrackMod {
  speed:    number;   // 0.25 | 0.5 | 1 | 2 | 4
  reverse:  boolean;
  jux:      boolean;
  palindrome: boolean;
  degrade:  number;  // 0–0.9
  euclid:   { n: number; k: number; rot: number } | null;
  arpMode:  'off'|'up'|'down'|'updown'|'random';
  arpLen:   number;  // 2–8
}

export interface DrumTrack {
  id:    string;
  type:  'drum';
  name:  string;
  color: string;
  sound: string;     // e.g. "bd", "sd", "hh"
  bank:  string;     // e.g. "RolandTR808"
  steps: boolean[];  // STEPS length
  fx:    TrackFx;
  mod:   TrackMod;
  muted: boolean;
}

export interface MelodyTrack {
  id:    string;
  type:  'melody';
  name:  string;
  color: string;
  synth: string;     // e.g. "sawtooth", "piano"
  steps: (string|null)[];  // note per step, null = rest
  octave: number;
  fx:    TrackFx;
  mod:   TrackMod;
  muted: boolean;
}

export interface ChordTrack {
  id:    string;
  type:  'chord';
  name:  string;
  color: string;
  synth: string;
  chords: string[][];   // array of chord (note arrays)
  fx:    TrackFx;
  mod:   TrackMod;
  muted: boolean;
}

export type Track = DrumTrack | MelodyTrack | ChordTrack;

export interface DAWState {
  tracks:      Track[];
  selectedId:  string | null;
  bpm:         number;
  autoRun:     boolean;
  scale: {
    root:  string;   // "C"
    type:  string;   // "major"
  };
  chordDegrees: number[];  // selected degrees for chord progression
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function defaultFx(): TrackFx {
  return { gain: 1, pan: 0, cutoff: 8000, res: 1, room: 0, delay: 0, crush: 16 };
}

export function defaultMod(): TrackMod {
  return { speed: 1, reverse: false, jux: false, palindrome: false,
           degrade: 0, euclid: null, arpMode: 'off', arpLen: 4 };
}
