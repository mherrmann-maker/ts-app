// Spielt die Schnittliste synchron zur Musik auf einem Canvas ab.
// Optional wird dabei per MediaRecorder ein WebM-Video (inkl. Ton) aufgezeichnet.

import type { BeatAnalysis } from './beatDetect'
import type { Segment } from './timeline'

export interface PlayerOptions {
  flash: boolean
  fps: number
}

export class Player {
  onProgress?: (t: number, duration: number) => void
  onDone?: (blob: Blob | null) => void

  private canvas: HTMLCanvasElement
  private ctx2d: CanvasRenderingContext2D
  private buffer: AudioBuffer
  private segments: Segment[]
  private analysis: BeatAnalysis
  private opts: PlayerOptions

  private audioCtx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private recorder: MediaRecorder | null = null
  private raf = 0
  private startTime = 0
  private segIndex = -1
  private preparedIndex = -1
  private beatIndex = -1
  private finished = false

  constructor(
    canvas: HTMLCanvasElement,
    buffer: AudioBuffer,
    segments: Segment[],
    analysis: BeatAnalysis,
    opts: PlayerOptions
  ) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D-Kontext nicht verfügbar')
    this.ctx2d = ctx
    this.buffer = buffer
    this.segments = segments
    this.analysis = analysis
    this.opts = opts
  }

  async start(record: boolean): Promise<void> {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    this.audioCtx = ctx
    await ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = this.buffer
    source.connect(ctx.destination)
    this.source = source

    if (record) {
      const dest = ctx.createMediaStreamDestination()
      source.connect(dest)
      let canvasStream: MediaStream
      try {
        canvasStream = this.canvas.captureStream(this.opts.fps)
      } catch {
        // Safari akzeptiert teils keinen fps-Parameter
        canvasStream = this.canvas.captureStream()
      }
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ])
      const mimeType = pickMimeType()
      const chunks: Blob[] = []
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 10_000_000 })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        this.onDone?.(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
      }
      this.recorder = recorder
      recorder.start(500)
    }

    this.segIndex = -1
    this.preparedIndex = -1
    this.beatIndex = -1
    this.finished = false

    source.onended = () => this.finish()
    source.start()
    this.startTime = ctx.currentTime
    this.tick()
  }

  stop(): void {
    this.finish()
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    cancelAnimationFrame(this.raf)
    try {
      this.source?.stop()
    } catch {
      // Quelle war bereits gestoppt
    }
    for (const seg of this.segments) {
      if (seg.media.kind === 'video') seg.media.el.pause()
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop() // onstop liefert den Blob an onDone
    } else {
      this.onDone?.(null)
    }
    this.recorder = null
    void this.audioCtx?.close()
    this.audioCtx = null
  }

  private tick = (): void => {
    if (this.finished || !this.audioCtx) return
    const t = this.audioCtx.currentTime - this.startTime

    while (
      this.segIndex + 1 < this.segments.length &&
      t >= this.segments[this.segIndex + 1].start
    ) {
      this.activate(this.segIndex + 1)
    }
    this.prepareNext(t)
    this.draw(t)
    this.onProgress?.(Math.min(t, this.buffer.duration), this.buffer.duration)

    if (t >= this.buffer.duration) {
      this.finish()
      return
    }
    this.raf = requestAnimationFrame(this.tick)
  }

  private activate(index: number): void {
    const prev = this.segments[this.segIndex]
    const seg = this.segments[index]
    this.segIndex = index
    if (prev && prev.media.kind === 'video' && prev.media.el !== (seg.media as { el?: unknown }).el) {
      prev.media.el.pause()
    }
    if (seg.media.kind === 'video') {
      const v = seg.media.el
      if (this.preparedIndex !== index) v.currentTime = seg.clipOffset
      void v.play().catch(() => {})
    }
  }

  /** Nächstes Video-Segment vorausschauend an die richtige Stelle spulen. */
  private prepareNext(t: number): void {
    const next = this.segIndex + 1
    if (next >= this.segments.length || this.preparedIndex >= next) return
    const seg = this.segments[next]
    if (seg.start - t > 1.5) return
    if (seg.media.kind === 'video') {
      const cur = this.segments[this.segIndex]
      const sameElement = cur?.media.kind === 'video' && cur.media.el === seg.media.el
      if (!sameElement) {
        seg.media.el.currentTime = seg.clipOffset
        this.preparedIndex = next
      }
    } else {
      this.preparedIndex = next
    }
  }

  private draw(t: number): void {
    const ctx = this.ctx2d
    const cw = this.canvas.width
    const ch = this.canvas.height
    const seg = this.segments[this.segIndex]

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cw, ch)
    if (!seg) return

    const segLen = Math.max(0.001, seg.end - seg.start)
    const p = Math.min(1, Math.max(0, (t - seg.start) / segLen))
    const m = seg.media
    const el = m.el
    const beat = this.lastBeat(t)
    const fx = this.opts.flash && beat !== null
    // Beat-Hüllkurve: 1 direkt auf dem Beat, klingt schnell ab
    const bs = fx ? beat!.strength : 0
    const env = fx ? Math.exp(-beat!.dt * 9) : 0

    let zoom = 1
    let panX = 0
    let panY = 0
    if (m.kind === 'image') {
      const e = easeInOut(p)
      zoom = seg.kb.z0 + (seg.kb.z1 - seg.kb.z0) * e
      panX = seg.kb.x0 + (seg.kb.x1 - seg.kb.x0) * e
      panY = seg.kb.y0 + (seg.kb.y1 - seg.kb.y0) * e
    } else {
      // Auch Clips bekommen eine langsame Zoom-Fahrt
      zoom = 1.02 + 0.06 * easeInOut(p)
    }

    if (fx) {
      // Zoom-Punch auf jedem Beat, Stärke folgt der Beat-Energie
      zoom *= 1 + 0.07 * bs * env
      // Harter Zoom-Einstieg auf jedem Schnitt (Schnitte liegen auf Beats)
      const tIn = t - seg.start
      zoom *= 1 + 0.06 * Math.exp(-tIn * 12)
    }

    const baseScale = Math.max(cw / m.width, ch / m.height)
    const s = baseScale * zoom
    const w = m.width * s
    const h = m.height * s
    const maxPanX = (w - cw) / 2
    const maxPanY = (h - ch) / 2
    let x = (cw - w) / 2 + panX * maxPanX
    let y = (ch - h) / 2 + panY * maxPanY

    if (fx && bs > 0.3) {
      // Kamera-Shake nach starken Beats – begrenzt auf den Überstand,
      // damit keine schwarzen Ränder sichtbar werden
      const margin = Math.max(0, Math.min(maxPanX - Math.abs(x - (cw - w) / 2), maxPanY - Math.abs(y - (ch - h) / 2)))
      const amp = Math.min(margin, 0.012 * cw * bs) * Math.exp(-beat!.dt * 14)
      x += (Math.random() * 2 - 1) * amp
      y += (Math.random() * 2 - 1) * amp
    }

    try {
      ctx.drawImage(el, x, y, w, h)
      // Ghost-Echo auf starken Beats: doppelt versetzt, additiv – wirkt wie
      // ein kurzer Chromatic-/Echo-Blitz exakt auf dem Schlag
      const ghost = fx && bs > 0.5 ? 0.3 * bs * env : 0
      if (ghost > 0.02) {
        const off = 0.012 * cw * env
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = ghost
        ctx.drawImage(el, x - off, y, w, h)
        ctx.drawImage(el, x + off, y + off * 0.4, w, h)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    } catch {
      // Frame noch nicht dekodiert – letztes Bild bleibt schwarz
    }

    if (fx) {
      const alpha = bs * Math.exp(-beat!.dt * 10) * 0.26
      if (alpha > 0.005) {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`
        ctx.fillRect(0, 0, cw, ch)
      }
    }
  }

  /** Letzter Beat vor Zeitpunkt t (sequenzieller Zeiger). */
  private lastBeat(t: number): { dt: number; strength: number } | null {
    const beats = this.analysis.beats
    while (this.beatIndex + 1 < beats.length && beats[this.beatIndex + 1] <= t) {
      this.beatIndex++
    }
    if (this.beatIndex < 0) return null
    return {
      dt: t - beats[this.beatIndex],
      strength: this.analysis.beatStrength[this.beatIndex] ?? 0,
    }
  }
}

function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    // iOS/macOS Safari nimmt kein WebM auf, aber MP4/H.264
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}
