// Keyframe model + easing + sampling

export type AnimState = Record<string, number>;

export type EasingName =
  | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
  | 'back' | 'elastic' | 'bounce';

export interface Keyframe {
  time: number;
  state: AnimState;
  easing: EasingName; // easing INTO this keyframe
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  bounce: easeOutBounce,
};

const EPS = 1e-3;

/** Insert or replace a keyframe at `time`. Keeps the list sorted. */
export function upsertKeyframe(
  kfs: Keyframe[],
  time: number,
  state: AnimState,
  easing: EasingName,
): Keyframe {
  const existing = kfs.find((k) => Math.abs(k.time - time) < EPS);
  if (existing) {
    existing.state = { ...state };
    return existing;
  }
  const kf: Keyframe = { time, state: { ...state }, easing };
  kfs.push(kf);
  kfs.sort((a, b) => a.time - b.time);
  return kf;
}

/** Sample the track at time t. Returns null for an empty track. */
export function sampleKeyframes(kfs: Keyframe[], t: number): AnimState | null {
  if (kfs.length === 0) return null;
  if (t <= kfs[0].time) return kfs[0].state;
  const last = kfs[kfs.length - 1];
  if (t >= last.time) return last.state;

  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].time <= t) i++;
  const a = kfs[i], b = kfs[i + 1];
  const span = Math.max(b.time - a.time, EPS);
  const u = EASINGS[b.easing]((t - a.time) / span);

  const out: AnimState = {};
  for (const key of Object.keys(a.state)) {
    const av = a.state[key];
    const bv = key in b.state ? b.state[key] : av;
    out[key] = av + (bv - av) * u;
  }
  return out;
}
