// ─── Real Strudel engine ──────────────────────────────────────────────────────
// Evaluates generated (or hand-edited) Strudel code through @strudel/webaudio,
// so playback sounds exactly like strudel.cc — including the real drum-machine
// sample packs (TR-808/909 …) and piano samples.

let replInstance: {
  evaluate: (code: string) => Promise<void>;
  stop: () => void;
  scheduler: any;
} | null = null;

let initPromise: Promise<void> | null = null;
let playing = false;
let errorHandler: (msg: string) => void = (msg) => console.error('[strudel]', msg);

export function onStrudelError(cb: (msg: string) => void) {
  errorHandler = cb;
}

// Default sample maps — the same ones strudel.cc pre-loads
const DOUGH = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/';
const SAMPLE_MAPS = [
  `${DOUGH}tidal-drum-machines.json`, // RolandTR808, RolandTR909, AkaiMPC60 …
  `${DOUGH}piano.json`,
  `${DOUGH}Dirt-Samples.json`,        // plain bd / sd / hh …
];

async function doInit(): Promise<void> {
  const { repl, evalScope } = await import('@strudel/core');
  const wa = await import('@strudel/webaudio');

  await wa.initAudio();

  // Expose note/sound/stack/… on globalThis for eval'd code
  await evalScope(
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/webaudio'),
  );

  // Built-in waveform synths (sawtooth, square, sine, triangle)
  try { await wa.registerSynthSounds?.(); } catch { /* already registered */ }

  // Sample packs load in the background; playback works with synths meanwhile
  Promise.allSettled(
    SAMPLE_MAPS.map(url => wa.samples(url))
  ).then(results => {
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) console.warn(`[strudel] ${failed} sample map(s) failed to load`);
  });

  const ctx = wa.getAudioContext();

  replInstance = repl({
    defaultOutput: wa.webaudioOutput,
    getTime: () => ctx.currentTime,
    onSchedulerError: (e: Error) => errorHandler(e.message),
    onEvalError: (e: Error) => errorHandler(e.message),
  });
}

function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

/** Pre-warm engine + samples (call on first user gesture). */
export function warmupStrudel(): void {
  ensureInit().catch(e => errorHandler(String(e)));
}

export async function playStrudel(code: string): Promise<void> {
  await ensureInit();
  await replInstance!.evaluate(code);
  playing = true;
}

export function stopStrudel(): void {
  if (!replInstance) return;
  try { replInstance.stop(); } catch { /* not started yet */ }
  playing = false;
}

export function isStrudelPlaying(): boolean {
  return playing;
}
