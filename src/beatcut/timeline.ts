// Baut aus Beat-Raster und Medien-Pool die Schnittliste (Segmente).

import type { BeatAnalysis } from './beatDetect'
import type { MediaItem } from './media'

export interface KenBurns {
  z0: number
  z1: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Segment {
  start: number
  end: number
  media: MediaItem
  /** Startversatz im Clip (nur Videos) */
  clipOffset: number
  kb: KenBurns
}

export function buildTimeline(
  analysis: BeatAnalysis,
  pool: MediaItem[],
  beatsPerCut: number
): Segment[] {
  if (pool.length === 0) return []

  const cuts: number[] = [0]
  for (let i = 0; i < analysis.beats.length; i += beatsPerCut) {
    const t = analysis.beats[i]
    if (t > cuts[cuts.length - 1] + 0.05 && t < analysis.duration - 0.05) cuts.push(t)
  }
  cuts.push(analysis.duration)

  const order = makeOrder(pool, cuts.length - 1)
  const segments: Segment[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const media = order[i]
    const len = cuts[i + 1] - cuts[i]
    let clipOffset = 0
    if (media.kind === 'video') {
      const spare = Math.max(0, media.duration - len - 0.2)
      clipOffset = Math.random() * spare
    }
    segments.push({ start: cuts[i], end: cuts[i + 1], media, clipOffset, kb: randomKenBurns() })
  }
  return segments
}

/** Gemischte Reihenfolge ohne direkte Wiederholungen (soweit möglich). */
function makeOrder(pool: MediaItem[], count: number): MediaItem[] {
  const out: MediaItem[] = []
  let bag: MediaItem[] = []
  for (let i = 0; i < count; i++) {
    if (bag.length === 0) bag = shuffle([...pool])
    if (pool.length > 1 && bag[0] === out[out.length - 1]) bag.push(bag.shift()!)
    out.push(bag.shift()!)
  }
  return out
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function randomKenBurns(): KenBurns {
  const z0 = 1.05 + Math.random() * 0.1
  const dz = (0.08 + Math.random() * 0.1) * (Math.random() < 0.5 ? -1 : 1)
  return {
    z0,
    z1: Math.max(1.02, z0 + dz),
    x0: (Math.random() * 2 - 1) * 0.6,
    y0: (Math.random() * 2 - 1) * 0.6,
    x1: (Math.random() * 2 - 1) * 0.6,
    y1: (Math.random() * 2 - 1) * 0.6,
  }
}
