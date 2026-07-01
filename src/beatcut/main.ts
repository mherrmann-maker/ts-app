import './style.css'
import { analyzeBeats, type BeatAnalysis } from './beatDetect'
import { loadImages, loadVideos, type MediaItem } from './media'
import { buildTimeline } from './timeline'
import { Player } from './player'

const audioInput = document.querySelector<HTMLInputElement>('#audio-input')!
const imageInput = document.querySelector<HTMLInputElement>('#image-input')!
const videoInput = document.querySelector<HTMLInputElement>('#video-input')!
const audioInfo = document.querySelector<HTMLDivElement>('#audio-info')!
const imageInfo = document.querySelector<HTMLDivElement>('#image-info')!
const videoInfo = document.querySelector<HTMLDivElement>('#video-info')!
const wave = document.querySelector<HTMLCanvasElement>('#wave')!
const stage = document.querySelector<HTMLCanvasElement>('#stage')!
const beatsPerCutSel = document.querySelector<HTMLSelectElement>('#beats-per-cut')!
const resolutionSel = document.querySelector<HTMLSelectElement>('#resolution')!
const flashCheck = document.querySelector<HTMLInputElement>('#flash')!
const btnPreview = document.querySelector<HTMLButtonElement>('#btn-preview')!
const btnExport = document.querySelector<HTMLButtonElement>('#btn-export')!
const btnStop = document.querySelector<HTMLButtonElement>('#btn-stop')!
const progress = document.querySelector<HTMLProgressElement>('#progress')!
const status = document.querySelector<HTMLDivElement>('#status')!

let audioBuffer: AudioBuffer | null = null
let analysis: BeatAnalysis | null = null
let images: MediaItem[] = []
let videos: MediaItem[] = []
let player: Player | null = null
let waveBackground: HTMLCanvasElement | null = null

function setStatus(text: string): void {
  status.textContent = text
}

function updateButtons(): void {
  const ready = analysis !== null && images.length + videos.length > 0 && player === null
  btnPreview.disabled = !ready
  btnExport.disabled = !ready
  btnStop.disabled = player === null
  audioInput.disabled = player !== null
  imageInput.disabled = player !== null
  videoInput.disabled = player !== null
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

audioInput.addEventListener('change', () => {
  const file = audioInput.files?.[0]
  if (!file) return
  void (async () => {
    try {
      setStatus(`Lade und analysiere „${file.name}“ …`)
      audioInfo.textContent = 'Analysiere Rhythmus …'
      const data = await file.arrayBuffer()
      const ac = new AudioContext()
      audioBuffer = await ac.decodeAudioData(data)
      await ac.close()
      analysis = analyzeBeats(audioBuffer)
      audioInfo.textContent =
        `${file.name} · ${formatTime(analysis.duration)} · ` +
        `${analysis.bpm.toFixed(1)} BPM · ${analysis.beats.length} Beats erkannt`
      drawWave()
      setStatus('Rhythmus erkannt. Jetzt Bilder und/oder Videoclips wählen.')
    } catch (err) {
      audioBuffer = null
      analysis = null
      audioInfo.textContent = 'Datei konnte nicht dekodiert werden.'
      setStatus(`Fehler bei der Audio-Analyse: ${err instanceof Error ? err.message : err}`)
    }
    updateButtons()
  })()
})

imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files ?? [])
  void (async () => {
    imageInfo.textContent = 'Lade Bilder …'
    images = await loadImages(files)
    imageInfo.textContent = `${images.length} Bild(er) geladen`
    updateButtons()
  })()
})

videoInput.addEventListener('change', () => {
  const files = Array.from(videoInput.files ?? [])
  void (async () => {
    videoInfo.textContent = 'Lade Clips …'
    videos = await loadVideos(files)
    videoInfo.textContent = `${videos.length} Clip(s) geladen`
    updateButtons()
  })()
})

function drawWave(playhead = -1): void {
  if (!audioBuffer || !analysis) return
  const ctx = wave.getContext('2d')!
  const w = wave.width
  const h = wave.height

  if (!waveBackground) {
    waveBackground = document.createElement('canvas')
    waveBackground.width = w
    waveBackground.height = h
    const bg = waveBackground.getContext('2d')!
    bg.fillStyle = '#0b0d10'
    bg.fillRect(0, 0, w, h)

    const data = audioBuffer.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / w))
    bg.fillStyle = '#3d4654'
    for (let x = 0; x < w; x++) {
      let min = 1
      let max = -1
      const off = x * step
      for (let i = 0; i < step; i += 16) {
        const v = data[off + i] ?? 0
        if (v < min) min = v
        if (v > max) max = v
      }
      const y0 = ((1 - max) * h) / 2
      const y1 = ((1 - min) * h) / 2
      bg.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
    for (let i = 0; i < analysis.beats.length; i++) {
      const x = (analysis.beats[i] / analysis.duration) * w
      const s = analysis.beatStrength[i]
      bg.fillStyle = `rgba(211, 185, 138, ${(0.25 + s * 0.75).toFixed(2)})`
      bg.fillRect(x, 0, 1, h)
    }
  }

  ctx.drawImage(waveBackground, 0, 0)
  if (playhead >= 0) {
    const x = (playhead / analysis.duration) * w
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, 0, 2, h)
  }
}

function applyResolution(): void {
  const [w, h] = resolutionSel.value.split('x').map(Number)
  stage.width = w
  stage.height = h
}

function run(record: boolean): void {
  if (!audioBuffer || !analysis) return
  const pool = [...images, ...videos]
  if (pool.length === 0) {
    setStatus('Bitte zuerst Bilder oder Videoclips laden.')
    return
  }
  applyResolution()
  const beatsPerCut = Number(beatsPerCutSel.value)
  const segments = buildTimeline(analysis, pool, beatsPerCut)
  const p = new Player(stage, audioBuffer, segments, analysis, {
    flash: flashCheck.checked,
    fps: 30,
  })
  player = p
  p.onProgress = (t, d) => {
    progress.value = d > 0 ? t / d : 0
    drawWave(t)
  }
  p.onDone = (blob) => {
    player = null
    updateButtons()
    drawWave()
    if (record && blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `beatcut-${Date.now()}.webm`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setStatus(`Export abgeschlossen (${(blob.size / 1024 / 1024).toFixed(1)} MB) – Download gestartet.`)
    } else if (record) {
      setStatus('Export abgebrochen – kein Video erzeugt.')
    } else {
      setStatus('Vorschau beendet.')
    }
  }
  setStatus(
    record
      ? `Exportiere in Echtzeit (${formatTime(analysis.duration)}) … Tab geöffnet lassen.`
      : `Vorschau läuft · ${segments.length} Schnitte · ${analysis.bpm.toFixed(1)} BPM`
  )
  updateButtons()
  void p.start(record).catch((err) => {
    setStatus(`Fehler beim Start: ${err instanceof Error ? err.message : err}`)
    player = null
    updateButtons()
  })
}

btnPreview.addEventListener('click', () => run(false))
btnExport.addEventListener('click', () => {
  if (typeof MediaRecorder === 'undefined') {
    setStatus('Dieser Browser unterstützt keinen Video-Export (MediaRecorder fehlt).')
    return
  }
  run(true)
})
btnStop.addEventListener('click', () => player?.stop())

updateButtons()
