// WebM video export via canvas.captureStream + MediaRecorder (realtime capture).

export interface ExportOptions {
  canvas: HTMLCanvasElement;
  duration: number;
  fps: number;
  /** Called every captured frame with the timeline time to render. */
  seek: (t: number) => void;
  onProgress: (fraction: number) => void;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    // iOS/Safari: MediaRecorder kann nur MP4/H.264
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export function exportWebM(opts: ExportOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const mimeType = pickMimeType();
    if (!mimeType) {
      reject(new Error('Video-Aufnahme wird von diesem Browser nicht unterstützt.'));
      return;
    }
    const stream = opts.canvas.captureStream(opts.fps);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 16_000_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = () => reject(new Error('Aufnahme fehlgeschlagen.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));

    recorder.start(250);
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= opts.duration) {
        opts.seek(opts.duration);
        opts.onProgress(1);
        // small grace period so the last frames land in the stream
        setTimeout(() => recorder.stop(), 150);
        return;
      }
      opts.seek(t);
      opts.onProgress(t / opts.duration);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
