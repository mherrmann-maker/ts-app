import * as Tone from 'tone';
import { state } from './state';
import { DrumTrack, MelodyTrack, ChordTrack, TrackFx, TrackMod } from './types';

// ─── Master chain ─────────────────────────────────────────────────────────────

const masterGain  = new Tone.Gain(0.85).toDestination();
const masterComp  = new Tone.Compressor(-18, 4).connect(masterGain);
const masterReverb = new Tone.Reverb({ decay: 1.5, wet: 0 }).connect(masterComp);

// ─── Per-track FX chains ──────────────────────────────────────────────────────

interface TrackChain {
  gain:    Tone.Gain;
  pan:     Tone.Panner;
  filter:  Tone.Filter;
  reverb:  Tone.Reverb;
  delay:   Tone.FeedbackDelay;
  crush:   Tone.BitCrusher;
}

const chains = new Map<string, TrackChain>();

export function getChain(id: string): TrackChain {
  if (!chains.has(id)) {
    const crush  = new Tone.BitCrusher(16).connect(masterReverb);
    const delay  = new Tone.FeedbackDelay('8n', 0.3).connect(crush);
    delay.wet.value = 0;
    const reverb = new Tone.Reverb({ decay: 2, wet: 0 }).connect(delay);
    const filter = new Tone.Filter(8000, 'lowpass').connect(reverb);
    const pan    = new Tone.Panner(0).connect(filter);
    const gain   = new Tone.Gain(1).connect(pan);
    chains.set(id, { gain, pan, filter, reverb, delay, crush });
  }
  return chains.get(id)!;
}

export function applyFx(id: string, fx: TrackFx) {
  const c = getChain(id);
  c.gain.gain.rampTo(fx.gain, 0.05);
  c.pan.pan.rampTo(fx.pan, 0.05);
  c.filter.frequency.rampTo(fx.cutoff, 0.05);
  c.filter.Q.rampTo(fx.res, 0.05);
  c.reverb.wet.rampTo(fx.room, 0.05);
  c.delay.wet.rampTo(fx.delay, 0.05);
  c.crush.bits.rampTo(Math.round(fx.crush), 0.05);
}

export function disposeChain(id: string) {
  const c = chains.get(id);
  if (!c) return;
  Object.values(c).forEach((n: any) => n.dispose());
  chains.delete(id);
}

// ─── Drum instruments ─────────────────────────────────────────────────────────

const drumInstruments = new Map<string, Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth>();

function getDrumInstrument(track: DrumTrack) {
  if (!drumInstruments.has(track.id)) {
    let instr: Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth;
    if (track.sound === 'bd') {
      instr = new Tone.MembraneSynth({
        pitchDecay: 0.08, octaves: 8,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 }
      });
    } else if (track.sound === 'sd' || track.sound === 'cp') {
      instr = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 }
      });
    } else {
      instr = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: track.sound === 'hh' ? 0.06 : 0.3, release: 0.01 },
        harmonicity: track.sound === 'hh' ? 5.1 : 12,
        modulationIndex: 16,
        resonance: 4000,
        octaves: 1.5,
      });
    }
    instr.connect(getChain(track.id).gain);
    drumInstruments.set(track.id, instr);
  }
  return drumInstruments.get(track.id)!;
}

// ─── Melody / Chord instruments ───────────────────────────────────────────────

const melodyInstruments = new Map<string, Tone.PolySynth>();
const melodyInstrumentType = new Map<string, string>();

function getMelodyInstrument(id: string, synthType: string): Tone.PolySynth {
  // Rebuild if the sound was switched (e.g. via sample browser)
  if (melodyInstruments.has(id) && melodyInstrumentType.get(id) !== synthType) {
    melodyInstruments.get(id)!.dispose();
    melodyInstruments.delete(id);
  }
  if (!melodyInstruments.has(id)) {
    let poly: Tone.PolySynth;
    if (synthType === 'moog') {
      // Minimoog-like voice: saw osc into 24dB ladder-style lowpass w/ contour
      poly = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'sawtooth' },
        filter: { type: 'lowpass', rolloff: -24, Q: 5 },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.35 },
        filterEnvelope: {
          attack: 0.005, decay: 0.45, sustain: 0.3, release: 0.3,
          baseFrequency: 900, octaves: 3.2,
        },
      } as any);
    } else {
      const typeMap: Record<string, any> = {
        sawtooth: { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.5 } },
        square:   { oscillator: { type: 'square'   }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 } },
        sine:     { oscillator: { type: 'sine'     }, envelope: { attack: 0.02, decay: 0.5, sustain: 0.5, release: 0.8 } },
        triangle: { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.4, sustain: 0.5, release: 0.6 } },
        piano:    { oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.8, sustain: 0.2, release: 1.2 } },
      };
      const opts = typeMap[synthType] ?? typeMap['sawtooth'];
      poly = new Tone.PolySynth(Tone.Synth, opts);
    }
    poly.connect(getChain(id).gain);
    melodyInstruments.set(id, poly);
    melodyInstrumentType.set(id, synthType);
  }
  return melodyInstruments.get(id)!;
}

// ─── Sequences ────────────────────────────────────────────────────────────────

const sequences = new Map<string, Tone.Sequence>();
let stepCallback: ((trackId: string, step: number) => void) | null = null;

export function onStep(cb: (trackId: string, step: number) => void) {
  stepCallback = cb;
}

let currentStep = 0;

function buildDrumSequence(track: DrumTrack): Tone.Sequence {
  const instr = getDrumInstrument(track);
  return new Tone.Sequence((time, step) => {
    currentStep = step as number;
    stepCallback?.(track.id, step as number);
    if (track.muted) return;
    if (track.steps[step as number]) {
      if (instr instanceof Tone.MembraneSynth) instr.triggerAttackRelease('C1', '16n', time);
      else if (instr instanceof Tone.NoiseSynth) instr.triggerAttackRelease('16n', time);
      else (instr as Tone.MetalSynth).triggerAttackRelease('16n', time);
    }
  }, [...Array(track.steps.length).keys()], '16n');
}

function buildMelodySequence(track: MelodyTrack): Tone.Sequence {
  const instr = getMelodyInstrument(track.id, track.synth);
  return new Tone.Sequence((time, step) => {
    stepCallback?.(track.id, step as number);
    if (track.muted) return;
    const note = track.steps[step as number];
    if (note) instr.triggerAttackRelease(note, '8n', time);
  }, [...Array(track.steps.length).keys()], '16n');
}

function buildChordSequence(track: ChordTrack): Tone.Sequence {
  const instr = getMelodyInstrument(track.id, track.synth);
  const len   = track.chords.length;
  return new Tone.Sequence((time, step) => {
    stepCallback?.(track.id, step as number);
    if (track.muted) return;
    const chord = track.chords[(step as number) % len];
    if (chord?.length) instr.triggerAttackRelease(chord, '4n', time);
  }, [...Array(len).keys()], '1n');
}

export function rebuildSequence(id: string) {
  sequences.get(id)?.dispose();
  sequences.delete(id);

  const track = state.tracks.find(t => t.id === id);
  if (!track) return;

  let seq: Tone.Sequence;
  if (track.type === 'drum')    seq = buildDrumSequence(track);
  else if (track.type === 'melody') seq = buildMelodySequence(track);
  else                          seq = buildChordSequence(track as ChordTrack);

  const wasRunning = Tone.getTransport().state === 'started';
  if (wasRunning) seq.start(0);
  sequences.set(id, seq);
  applyFx(id, track.fx);
}

export function rebuildAll() {
  state.tracks.forEach(t => rebuildSequence(t.id));
}

// ─── Transport controls ───────────────────────────────────────────────────────

let started = false;

export async function startTransport() {
  await Tone.start();
  if (!started) {
    rebuildAll();
    sequences.forEach(s => s.start(0));
    started = true;
  }
  Tone.getTransport().start();
}

export function stopTransport() {
  Tone.getTransport().stop();
  Tone.getTransport().position = 0;
  currentStep = 0;
}

export function pauseTransport() {
  Tone.getTransport().pause();
}

export function setBpm(bpm: number) {
  Tone.getTransport().bpm.value = bpm;
  state.bpm = bpm;
}

export function getBpm() {
  return Tone.getTransport().bpm.value;
}

export function getTransportState() {
  return Tone.getTransport().state;
}

export function getCurrentStep() {
  return currentStep;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initAudio() {
  Tone.getTransport().bpm.value = state.bpm;
  Tone.getTransport().loop     = true;
  Tone.getTransport().loopStart = 0;
  Tone.getTransport().loopEnd  = '1m';
}
