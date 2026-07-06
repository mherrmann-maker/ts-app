import { state } from './state';
import { Track, DrumTrack, MelodyTrack, ChordTrack, TrackMod, TrackFx } from './types';

// ─── Strudel code generation ──────────────────────────────────────────────────
// Emits VALID strudel.cc code: one setcpm() + one stack(...) expression,
// method-chain style so it runs 1:1 in the Strudel REPL.

// Synths that only exist in our Tone.js engine → closest Strudel sound
const SOUND_MAP: Record<string, string> = {
  moog: 'sawtooth',
};

function strudelSound(synth: string): string {
  return SOUND_MAP[synth] ?? synth;
}

function toMini(note: string): string {
  // "C#4" → "c#4"  (Strudel mini-notation prefers lowercase)
  return note.toLowerCase();
}

function modChain(mod: TrackMod): string {
  let s = '';
  if (mod.speed > 1)         s += `.fast(${mod.speed})`;
  else if (mod.speed < 1)    s += `.slow(${1 / mod.speed})`;
  if (mod.reverse)           s += `.rev()`;
  if (mod.palindrome)        s += `.palindrome()`;
  if (mod.jux)               s += `.jux(rev)`;
  if (mod.degrade > 0)       s += `.degradeBy(${mod.degrade})`;
  return s;
}

function fxChain(fx: TrackFx): string {
  const parts: string[] = [];
  if (fx.gain !== 1)      parts.push(`.gain(${fx.gain.toFixed(2)})`);
  // Strudel pan is 0..1 (0.5 = center); ours is -1..1
  if (fx.pan !== 0)       parts.push(`.pan(${((fx.pan + 1) / 2).toFixed(2)})`);
  if (fx.cutoff < 7900)   parts.push(`.lpf(${Math.round(fx.cutoff)})`);
  if (fx.res > 1)         parts.push(`.resonance(${fx.res.toFixed(1)})`);
  if (fx.room > 0)        parts.push(`.room(${fx.room.toFixed(2)})`);
  if (fx.delay > 0)       parts.push(`.delay(${fx.delay.toFixed(2)})`);
  if (fx.crush < 16)      parts.push(`.crush(${Math.round(fx.crush)})`);
  return parts.join('');
}

function drumCode(t: DrumTrack): string {
  let base: string;
  if (t.mod.euclid) {
    const { n, k, rot } = t.mod.euclid;
    base = rot
      ? `s("${t.sound}").euclidRot(${k}, ${n}, ${rot})`
      : `s("${t.sound}").euclid(${k}, ${n})`;
  } else {
    const pattern = t.steps.map(on => (on ? t.sound : '~')).join(' ');
    base = `s("${pattern}")`;
  }
  return `${base}.bank("${t.bank}")${modChain(t.mod)}${fxChain(t.fx)}`;
}

function melodyCode(t: MelodyTrack): string {
  const pattern = t.steps.map(n => (n ? toMini(n) : '~')).join(' ');
  let s = `note("${pattern}").sound("${strudelSound(t.synth)}")`;
  if (t.mod.euclid) s += `.euclid(${t.mod.euclid.k}, ${t.mod.euclid.n})`;
  if (t.mod.arpMode === 'down')    s += `.rev()`;
  if (t.mod.arpMode === 'updown')  s += `.palindrome()`;
  if (t.mod.arpMode === 'random')  s += `.shuffle(${t.mod.arpLen})`;
  return `${s}${modChain(t.mod)}${fxChain(t.fx)}`;
}

function chordCode(t: ChordTrack): string {
  // <...> = one chord per cycle; with setcpm(bpm/4) a cycle is one bar
  const seq = t.chords.map(c => `[${c.map(toMini).join(',')}]`).join(' ');
  let s = `note("<${seq}>").sound("${strudelSound(t.synth)}")`;
  return `${s}${modChain(t.mod)}${fxChain(t.fx)}`;
}

function trackCode(t: Track): string {
  if (t.type === 'drum')   return drumCode(t);
  if (t.type === 'melody') return melodyCode(t);
  return chordCode(t as ChordTrack);
}

export function generateCode(): string {
  const { bpm, scale } = state;
  const active = state.tracks.filter(t => !t.muted);

  const lines = [
    `// VK DAW → strudel.cc`,
    `// Tonart: ${scale.root} ${scale.type} · ${bpm} BPM`,
    `setcpm(${Math.round(bpm / 4)})`,
    ``,
  ];

  if (active.length === 0) {
    lines.push('silence');
    return lines.join('\n');
  }

  lines.push(`stack(`);
  active.forEach((t, i) => {
    const comma = i < active.length - 1 ? ',' : '';
    lines.push(`  // ${t.name}`);
    lines.push(`  ${trackCode(t)}${comma}`);
  });
  lines.push(`)`);

  return lines.join('\n');
}
