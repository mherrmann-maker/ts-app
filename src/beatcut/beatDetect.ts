// Rhythmus-Analyse: Onset-Erkennung per Spektralfluss, Tempo per Autokorrelation,
// Beat-Raster per Phasensuche über die Onset-Hüllkurve.

export interface BeatAnalysis {
  bpm: number
  /** Beat-Zeitpunkte in Sekunden */
  beats: number[]
  /** Stärke jedes Beats, normalisiert auf 0..1 */
  beatStrength: number[]
  duration: number
  envelope: Float32Array
  envelopeRate: number
}

const FRAME = 1024
// Kleiner Hop = feine Zeitauflösung der Hüllkurve; wichtig, damit Beat-Perioden
// nicht zwischen zwei Integer-Lags der Autokorrelation fallen.
const HOP = 256

export function analyzeBeats(buffer: AudioBuffer): BeatAnalysis {
  let samples = mixdown(buffer)
  let sr = buffer.sampleRate
  while (sr > 32000) {
    samples = downsample2(samples)
    sr /= 2
  }

  const envelope = onsetEnvelope(samples)
  const envelopeRate = sr / HOP
  const bpm = estimateTempo(envelope, envelopeRate)
  const period = (60 / bpm) * envelopeRate
  const phase = bestPhase(envelope, period)

  const beats: number[] = []
  const raw: number[] = []
  for (let p = phase; p < envelope.length; p += period) {
    beats.push(p / envelopeRate)
    raw.push(envelope[Math.min(envelope.length - 1, Math.round(p))])
  }
  let max = 1e-9
  for (const s of raw) max = Math.max(max, s)
  const beatStrength = raw.map((s) => s / max)

  return { bpm, beats, beatStrength, duration: buffer.duration, envelope, envelopeRate }
}

function mixdown(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) out[i] += data[i]
  }
  if (buffer.numberOfChannels > 1) {
    const g = 1 / buffer.numberOfChannels
    for (let i = 0; i < out.length; i++) out[i] *= g
  }
  return out
}

function downsample2(samples: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / 2))
  for (let i = 0; i < out.length; i++) {
    out[i] = (samples[2 * i] + samples[2 * i + 1]) * 0.5
  }
  return out
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/** In-place Radix-2 FFT */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const vRe = re[b] * curRe - im[b] * curIm
        const vIm = re[b] * curIm + im[b] * curRe
        re[b] = re[a] - vRe
        im[b] = im[a] - vIm
        re[a] += vRe
        im[a] += vIm
        const nRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nRe
      }
    }
  }
}

function onsetEnvelope(samples: Float32Array): Float32Array {
  const numFrames = Math.max(1, Math.floor((samples.length - FRAME) / HOP) + 1)
  const win = hann(FRAME)
  const flux = new Float32Array(numFrames)
  const re = new Float32Array(FRAME)
  const im = new Float32Array(FRAME)
  const prev = new Float32Array(FRAME / 2)

  for (let f = 0; f < numFrames; f++) {
    const off = f * HOP
    for (let i = 0; i < FRAME; i++) {
      re[i] = (samples[off + i] ?? 0) * win[i]
      im[i] = 0
    }
    fft(re, im)
    let sum = 0
    for (let k = 1; k < FRAME / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const d = mag - prev[k]
      if (d > 0) sum += d
      prev[k] = mag
    }
    flux[f] = sum
  }

  // Lokalen Mittelwert abziehen (adaptives Grundrauschen entfernen)
  const prefix = new Float64Array(numFrames + 1)
  for (let i = 0; i < numFrames; i++) prefix[i + 1] = prefix[i] + flux[i]
  const w = 21
  const out = new Float32Array(numFrames)
  for (let i = 0; i < numFrames; i++) {
    const a = Math.max(0, i - w)
    const b = Math.min(numFrames, i + w + 1)
    const mean = (prefix[b] - prefix[a]) / (b - a)
    out[i] = Math.max(0, flux[i] - mean)
  }
  return out
}

function estimateTempo(env: Float32Array, envRate: number): number {
  const minLag = Math.max(1, Math.floor((envRate * 60) / 200))
  const maxLag = Math.min(env.length - 1, Math.ceil((envRate * 60) / 60))
  if (maxLag <= minLag) return 120

  const corrMax = Math.min(env.length - 1, 2 * maxLag + 2)
  const corr = new Float64Array(corrMax + 1)
  for (let lag = minLag; lag <= corrMax; lag++) {
    let sum = 0
    for (let i = 0; i + lag < env.length; i++) sum += env[i] * env[i + lag]
    corr[lag] = sum
  }

  let bestScore = -Infinity
  let bestLag = minLag
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * envRate) / lag
    // Präferenz für musikalisch übliche Tempi um 120 BPM; harmonisches Scoring:
    // das echte Beat-Tempo wird durch seine Oktave (doppelter Lag) mitgestützt,
    // sonst gewinnen Half-Time-Elemente wie Claps auf 2 und 4.
    const octave = 2 * lag <= corrMax ? corr[2 * lag] : 0
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2))
    const score = (corr[lag] + 0.5 * octave) * weight
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (!isFinite(bestScore) || bestScore <= 0) return 120

  // Oktav-Korrektur: Wenn das doppelte Tempo (halber Lag) fast genauso stark
  // korreliert, ist es meist das eigentliche Beat-Tempo (Kick auf jedem Beat).
  while (true) {
    const half = Math.round(bestLag / 2)
    if (half < minLag || half > corrMax) break
    if (corr[half] > 0.65 * corr[bestLag]) bestLag = half
    else break
  }

  // Parabolische Interpolation um den Peak für sub-frame-genaues Tempo
  let refined = bestLag
  const a = corr[bestLag - 1]
  const b = corr[bestLag]
  const c = corr[bestLag + 1]
  if (bestLag > minLag && bestLag < maxLag) {
    const denom = a - 2 * b + c
    if (Math.abs(denom) > 1e-12) {
      const delta = (0.5 * (a - c)) / denom
      if (Math.abs(delta) <= 0.5) refined = bestLag + delta
    }
  }
  return (60 * envRate) / refined
}

function bestPhase(env: Float32Array, period: number): number {
  const steps = Math.max(1, Math.floor(period))
  let best = -1
  let bestOff = 0
  for (let off = 0; off < steps; off++) {
    let sum = 0
    let count = 0
    for (let p = off; p < env.length; p += period) {
      sum += env[Math.round(p)]
      count++
    }
    const s = count > 0 ? sum / count : 0
    if (s > best) {
      best = s
      bestOff = off
    }
  }
  return bestOff
}
