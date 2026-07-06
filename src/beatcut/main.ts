import './style.css'
import { analyzeBeats, type BeatAnalysis } from './beatDetect'
import { loadImages, loadVideos, type MediaItem } from './media'
import { buildTimeline } from './timeline'
import { Player } from './player'

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`Element fehlt: ${sel}`)
  return el
}

const audioInput = $<HTMLInputElement>('#audio-input')
const imageInput = $<HTMLInputElement>('#image-input')
const videoInput = $<HTMLInputElement>('#video-input')
const imageDirInput = $<HTMLInputElement>('#image-dir-input')
const videoDirInput = $<HTMLInputElement>('#video-dir-input')
const imageDirBtn = $<HTMLButtonElement>('#image-dir-btn')
const videoDirBtn = $<HTMLButtonElement>('#video-dir-btn')
const cardAudio = $<HTMLDivElement>('#card-audio')
const cardImages = $<HTMLDivElement>('#card-images')
const cardVideos = $<HTMLDivElement>('#card-videos')
const audioInfo = $<HTMLDivElement>('#audio-info')
const imageInfo = $<HTMLDivElement>('#image-info')
const videoInfo = $<HTMLDivElement>('#video-info')
const wave = $<HTMLCanvasElement>('#wave')
const waveWrap = wave.parentElement as HTMLDivElement
const stage = $<HTMLCanvasElement>('#stage')
const stageWrap = $<HTMLDivElement>('#stage-wrap')
const segBeats = $<HTMLDivElement>('#seg-beats')
const segRes = $<HTMLDivElement>('#seg-res')
const flashCheck = $<HTMLInputElement>('#flash')
const btnPreview = $<HTMLButtonElement>('#btn-preview')
const btnExport = $<HTMLButtonElement>('#btn-export')
const btnStop = $<HTMLButtonElement>('#btn-stop')
const progressFill = $<HTMLDivElement>('#progress-fill')
const status = $<HTMLDivElement>('#status')

let audioBuffer: AudioBuffer | null = null
let analysis: BeatAnalysis | null = null
let images: MediaItem[] = []
let videos: MediaItem[] = []
let player: Player | null = null
let waveBackground: HTMLCanvasElement | null = null
let wakeLock: { release(): Promise<void> } | null = null

/* ---------- Helfer ---------- */

function setStatus(text: string): void {
  status.textContent = text
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function segValue(seg: HTMLDivElement): string {
  return seg.querySelector<HTMLButtonElement>('button.active')?.dataset.v ?? ''
}

function initSegmented(seg: HTMLDivElement, onChange?: () => void): void {
  seg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button')
    if (!btn || player) return
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    onChange?.()
  })
}

function updateButtons(): void {
  const ready = analysis !== null && images.length + videos.length > 0 && player === null
  btnPreview.disabled = !ready
  btnExport.disabled = !ready
  btnStop.disabled = player === null
  for (const input of [audioInput, imageInput, videoInput, imageDirInput, videoDirInput]) {
    input.disabled = player !== null
  }
}

async function requestWakeLock(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> }
  }
  try {
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
}

function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => {})
  wakeLock = null
}

/* ---------- Medien-Eingaben ---------- */

// Ordner-Auswahl gibt es nur am Desktop – auf Touch-Geräten Multi-Select verwenden
const supportsDirectories =
  'webkitdirectory' in document.createElement('input') &&
  window.matchMedia('(pointer: fine)').matches
if (supportsDirectories) {
  imageDirBtn.classList.add('visible')
  videoDirBtn.classList.add('visible')
}

function wireCard(
  card: HTMLDivElement,
  input: HTMLInputElement,
  onFiles: (files: File[]) => void
): void {
  card.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.bc-dir-btn')) return
    if (!input.disabled) input.click()
  })
  input.addEventListener('change', () => onFiles(Array.from(input.files ?? [])))
  card.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (!input.disabled) card.classList.add('drag')
  })
  card.addEventListener('dragleave', () => card.classList.remove('drag'))
  card.addEventListener('drop', (e) => {
    e.preventDefault()
    card.classList.remove('drag')
    if (input.disabled) return
    onFiles(Array.from(e.dataTransfer?.files ?? []))
  })
}

function handleAudio(files: File[]): void {
  const file = files.find((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name))
  if (!file) return
  void (async () => {
    try {
      setStatus(`Analysiere Rhythmik von „${file.name}“ …`)
      audioInfo.textContent = 'ANALYSIERE RHYTHMIK …'
      cardAudio.classList.remove('loaded')
      const data = await file.arrayBuffer()
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AC()
      audioBuffer = await ac.decodeAudioData(data)
      await ac.close()
      analysis = analyzeBeats(audioBuffer)
      audioInfo.textContent =
        `${file.name} · ${formatTime(analysis.duration)} · ` +
        `${analysis.bpm.toFixed(1)} BPM · ${analysis.beats.length} BEATS`
      cardAudio.classList.add('loaded')
      waveBackground = null
      waveWrap.classList.add('has-audio')
      drawWave()
      setStatus('Rhythmus erkannt. Jetzt Bilder und/oder Clips wählen.')
    } catch (err) {
      audioBuffer = null
      analysis = null
      waveWrap.classList.remove('has-audio')
      audioInfo.textContent = 'DATEI KONNTE NICHT DEKODIERT WERDEN'
      setStatus(`Fehler bei der Audio-Analyse: ${err instanceof Error ? err.message : err}`)
    }
    updateButtons()
  })()
}

function handleImages(files: File[]): void {
  void (async () => {
    imageInfo.textContent = 'LADE BILDER …'
    images = await loadImages(files)
    imageInfo.textContent = images.length > 0 ? `${images.length} BILD(ER) GELADEN` : 'KEINE BILDER GEFUNDEN'
    cardImages.classList.toggle('loaded', images.length > 0)
    updateButtons()
  })()
}

function handleVideos(files: File[]): void {
  void (async () => {
    videoInfo.textContent = 'LADE CLIPS …'
    videos = await loadVideos(files)
    videoInfo.textContent = videos.length > 0 ? `${videos.length} CLIP(S) GELADEN` : 'KEINE CLIPS GEFUNDEN'
    cardVideos.classList.toggle('loaded', videos.length > 0)
    updateButtons()
  })()
}

wireCard(cardAudio, audioInput, handleAudio)
wireCard(cardImages, imageInput, handleImages)
wireCard(cardVideos, videoInput, handleVideos)
imageDirBtn.addEventListener('click', () => imageDirInput.click())
videoDirBtn.addEventListener('click', () => videoDirInput.click())
imageDirInput.addEventListener('change', () => handleImages(Array.from(imageDirInput.files ?? [])))
videoDirInput.addEventListener('change', () => handleVideos(Array.from(videoDirInput.files ?? [])))

/* ---------- Waveform ---------- */

function drawWave(playhead = -1): void {
  if (!audioBuffer || !analysis) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(wave.clientWidth * dpr))
  const h = Math.max(1, Math.round(wave.clientHeight * dpr))
  if (wave.width !== w || wave.height !== h) {
    wave.width = w
    wave.height = h
    waveBackground = null
  }
  const ctx = wave.getContext('2d')!

  if (!waveBackground) {
    waveBackground = document.createElement('canvas')
    waveBackground.width = w
    waveBackground.height = h
    const bg = waveBackground.getContext('2d')!
    bg.fillStyle = '#060608'
    bg.fillRect(0, 0, w, h)

    const data = audioBuffer.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / w))
    bg.fillStyle = 'rgba(240, 237, 230, 0.22)'
    for (let x = 0; x < w; x++) {
      let min = 1
      let max = -1
      const off = x * step
      for (let i = 0; i < step; i += 16) {
        const v = data[off + i] ?? 0
        if (v < min) min = v
        if (v > max) max = v
      }
      const y0 = ((1 - max * 0.9) * h) / 2
      const y1 = ((1 - min * 0.9) * h) / 2
      bg.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
    for (let i = 0; i < analysis.beats.length; i++) {
      const x = (analysis.beats[i] / analysis.duration) * w
      const s = analysis.beatStrength[i]
      bg.fillStyle = `rgba(201, 168, 76, ${(0.25 + s * 0.75).toFixed(2)})`
      bg.fillRect(x, 0, Math.max(1, dpr * 0.75), h)
    }
  }

  ctx.drawImage(waveBackground, 0, 0)
  if (playhead >= 0) {
    const x = (playhead / analysis.duration) * w
    ctx.fillStyle = '#F0EDE6'
    ctx.fillRect(x, 0, Math.max(1, dpr), h)
  }
}

window.addEventListener('resize', () => drawWave())

/* ---------- Format / Bühne ---------- */

function applyResolution(): void {
  const [w, h] = segValue(segRes).split('x').map(Number)
  stage.width = w
  stage.height = h
  stageWrap.classList.toggle('portrait', h > w)
}

// Auf dem Handy ist Hochformat der sinnvollere Standard
const defaultRes = window.matchMedia('(max-width: 640px)').matches ? '1080x1920' : '1920x1080'
segRes.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
  b.classList.toggle('active', b.dataset.v === defaultRes)
})
initSegmented(segBeats)
initSegmented(segRes, applyResolution)
applyResolution()

/* ---------- Abspielen / Export ---------- */

function run(record: boolean): void {
  if (!audioBuffer || !analysis) return
  const pool = [...images, ...videos]
  if (pool.length === 0) {
    setStatus('Bitte zuerst Bilder oder Clips laden.')
    return
  }
  applyResolution()
  const segments = buildTimeline(analysis, pool, Number(segValue(segBeats)) || 2)
  const p = new Player(stage, audioBuffer, segments, analysis, {
    flash: flashCheck.checked,
    fps: 30,
  })
  player = p
  p.onProgress = (t, d) => {
    progressFill.style.width = `${d > 0 ? (t / d) * 100 : 0}%`
    drawWave(t)
  }
  p.onDone = (blob) => {
    releaseWakeLock()
    player = null
    updateButtons()
    drawWave()
    if (record && blob) {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `beatcut-${Date.now()}.${ext}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setStatus(`Export abgeschlossen (${(blob.size / 1024 / 1024).toFixed(1)} MB, .${ext}) – Download gestartet.`)
    } else if (record) {
      setStatus('Export abgebrochen – kein Video erzeugt.')
    } else {
      setStatus('Vorschau beendet.')
    }
  }
  setStatus(
    record
      ? `Exportiere in Echtzeit (${formatTime(analysis.duration)}) … Bildschirm anlassen, Tab im Vordergrund.`
      : `Vorschau läuft · ${segments.length} Schnitte · ${analysis.bpm.toFixed(1)} BPM`
  )
  updateButtons()
  void requestWakeLock()
  void p.start(record).catch((err) => {
    releaseWakeLock()
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
