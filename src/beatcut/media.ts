// Laden der Medien-Pools (Bilder-Ordner und Videoclip-Ordner).

export interface ImageItem {
  kind: 'image'
  name: string
  el: HTMLImageElement
  width: number
  height: number
}

export interface VideoItem {
  kind: 'video'
  name: string
  el: HTMLVideoElement
  width: number
  height: number
  duration: number
}

export type MediaItem = ImageItem | VideoItem

export async function loadImages(files: File[]): Promise<ImageItem[]> {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'))
  const items = await Promise.all(imageFiles.map(loadImage))
  return items.filter((i): i is ImageItem => i !== null)
}

export async function loadVideos(files: File[]): Promise<VideoItem[]> {
  const videoFiles = files.filter((f) => f.type.startsWith('video/'))
  const items = await Promise.all(videoFiles.map(loadVideo))
  return items.filter((v): v is VideoItem => v !== null)
}

function loadImage(file: File): Promise<ImageItem | null> {
  return new Promise((resolve) => {
    const el = new Image()
    el.onload = () =>
      resolve({ kind: 'image', name: file.name, el, width: el.naturalWidth, height: el.naturalHeight })
    el.onerror = () => resolve(null)
    el.src = URL.createObjectURL(file)
  })
}

function loadVideo(file: File): Promise<VideoItem | null> {
  return new Promise((resolve) => {
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.loop = true
    el.preload = 'auto'
    el.onloadedmetadata = () => {
      if (!el.videoWidth || !isFinite(el.duration)) {
        resolve(null)
        return
      }
      resolve({
        kind: 'video',
        name: file.name,
        el,
        width: el.videoWidth,
        height: el.videoHeight,
        duration: el.duration,
      })
    }
    el.onerror = () => resolve(null)
    el.src = URL.createObjectURL(file)
  })
}
