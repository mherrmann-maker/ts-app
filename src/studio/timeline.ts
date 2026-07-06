import type { Keyframe } from './anim';

export interface Track {
  id: string;
  name: string;
  keyframes: Keyframe[];
}

export interface KeyframeSelection {
  trackId: string;
  kf: Keyframe;
}

export interface TimelineCallbacks {
  getDuration(): number;
  getTime(): number;
  setTime(t: number): void;
  onSelectTrack(id: string): void;
  onChanged(): void;
  onSelectKeyframe(sel: KeyframeSelection | null): void;
}

const SNAP = 0.05;

export class Timeline {
  selected: KeyframeSelection | null = null;

  private container: HTMLElement;
  private cb: TimelineCallbacks;
  private tracks: Track[] = [];
  private selectedTrackId: string | null = null;
  private area: HTMLElement | null = null;
  private playhead: HTMLElement | null = null;

  constructor(container: HTMLElement, cb: TimelineCallbacks) {
    this.container = container;
    this.cb = cb;
    window.addEventListener('resize', () => this.refresh());
  }

  setTracks(tracks: Track[], selectedTrackId: string | null): void {
    this.tracks = tracks;
    this.selectedTrackId = selectedTrackId;
    if (this.selected && !tracks.some((t) => t.id === this.selected!.trackId
      && t.keyframes.includes(this.selected!.kf))) {
      this.selected = null;
      this.cb.onSelectKeyframe(null);
    }
    this.refresh();
  }

  deleteSelected(): boolean {
    if (!this.selected) return false;
    const track = this.tracks.find((t) => t.id === this.selected!.trackId);
    if (!track) return false;
    const i = track.keyframes.indexOf(this.selected.kf);
    if (i >= 0) track.keyframes.splice(i, 1);
    this.selected = null;
    this.cb.onSelectKeyframe(null);
    this.cb.onChanged();
    this.refresh();
    return true;
  }

  refresh(): void {
    const scroll = this.container.scrollTop;
    this.container.innerHTML = '';

    const grid = el('div', 'tl-grid');
    const names = el('div', 'tl-names');
    const area = el('div', 'tl-area');
    this.area = area;

    // corner + ruler
    names.appendChild(el('div', 'tl-ruler'));
    const ruler = el('div', 'tl-ruler');
    area.appendChild(ruler);

    const duration = this.cb.getDuration();

    // rows
    for (const track of this.tracks) {
      const nameRow = el('div', 'tl-row');
      nameRow.textContent = track.name;
      if (track.id === this.selectedTrackId) nameRow.classList.add('selected');
      nameRow.addEventListener('pointerdown', () => this.cb.onSelectTrack(track.id));
      names.appendChild(nameRow);

      const row = el('div', 'tl-row');
      for (const kf of track.keyframes) {
        const key = el('div', 'tl-key');
        if (this.selected && this.selected.kf === kf) key.classList.add('selected');
        key.style.left = `${(kf.time / duration) * 100}%`;
        this.bindKeyDrag(key, track, kf);
        row.appendChild(key);
      }
      area.appendChild(row);
    }

    // playhead
    const playhead = el('div', '');
    playhead.id = 'playhead';
    area.appendChild(playhead);
    this.playhead = playhead;

    grid.appendChild(names);
    grid.appendChild(area);
    this.container.appendChild(grid);

    this.buildRulerTicks(ruler, duration);
    this.bindScrub(area);
    this.updatePlayhead();
    this.container.scrollTop = scroll;
  }

  updatePlayhead(): void {
    if (!this.playhead) return;
    const duration = this.cb.getDuration();
    this.playhead.style.left = `${(this.cb.getTime() / duration) * 100}%`;
  }

  private buildRulerTicks(ruler: HTMLElement, duration: number): void {
    const step = duration > 20 ? 2 : 1;
    for (let s = 0; s <= duration; s += step) {
      const tick = el('div', 'tick');
      tick.style.left = `${(s / duration) * 100}%`;
      tick.textContent = `${s}s`;
      ruler.appendChild(tick);
    }
  }

  private xToTime(clientX: number): number {
    if (!this.area) return 0;
    const rect = this.area.getBoundingClientRect();
    const duration = this.cb.getDuration();
    const t = ((clientX - rect.left) / Math.max(rect.width, 1)) * duration;
    return Math.min(Math.max(t, 0), duration);
  }

  private bindScrub(area: HTMLElement): void {
    area.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('tl-key')) return;
      area.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => this.cb.setTime(this.xToTime(ev.clientX));
      move(e);
      const up = () => {
        area.removeEventListener('pointermove', move);
        area.removeEventListener('pointerup', up);
      };
      area.addEventListener('pointermove', move);
      area.addEventListener('pointerup', up);
    });
  }

  private bindKeyDrag(keyEl: HTMLElement, track: Track, kf: Keyframe): void {
    keyEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      keyEl.setPointerCapture(e.pointerId);
      this.selected = { trackId: track.id, kf };
      this.cb.onSelectKeyframe(this.selected);
      this.container.querySelectorAll('.tl-key.selected')
        .forEach((k) => k.classList.remove('selected'));
      keyEl.classList.add('selected');

      let moved = false;
      const move = (ev: PointerEvent) => {
        moved = true;
        const duration = this.cb.getDuration();
        let t = this.xToTime(ev.clientX);
        t = Math.round(t / SNAP) * SNAP;
        kf.time = Math.min(Math.max(t, 0), duration);
        keyEl.style.left = `${(kf.time / duration) * 100}%`;
      };
      const up = () => {
        keyEl.removeEventListener('pointermove', move);
        keyEl.removeEventListener('pointerup', up);
        if (moved) {
          track.keyframes.sort((a, b) => a.time - b.time);
          this.cb.onChanged();
          this.refresh();
        }
      };
      keyEl.addEventListener('pointermove', move);
      keyEl.addEventListener('pointerup', up);
    });

    keyEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const i = track.keyframes.indexOf(kf);
      if (i >= 0) track.keyframes.splice(i, 1);
      if (this.selected?.kf === kf) {
        this.selected = null;
        this.cb.onSelectKeyframe(null);
      }
      this.cb.onChanged();
      this.refresh();
    });
  }
}

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}
