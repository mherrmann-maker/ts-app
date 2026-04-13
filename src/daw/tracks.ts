import { state, addTrack, removeTrack, selectedTrack } from './state';
import { Track, DrumTrack } from './types';
import { rebuildSequence, applyFx, disposeChain } from './audio';

// ─── Callbacks ────────────────────────────────────────────────────────────────

type ChangeCallback = () => void;
const listeners: ChangeCallback[] = [];
export function onTracksChange(cb: ChangeCallback) { listeners.push(cb); }
function emit() { listeners.forEach(fn => fn()); }

// ─── Track list rendering ─────────────────────────────────────────────────────

export function renderTrackList(container: HTMLElement) {
  container.innerHTML = '';

  state.tracks.forEach(track => {
    const el = document.createElement('div');
    el.className = 'track' +
      (track.id === state.selectedId ? ' selected' : '') +
      (track.muted ? ' muted' : '');
    el.dataset.id = track.id;

    const typeIcon = { drum: '🥁', melody: '🎹', chord: '🎸' }[track.type];
    const soundLabel = track.type === 'drum'
      ? `${(track as DrumTrack).bank}:${(track as DrumTrack).sound}`
      : (track as any).synth;

    el.innerHTML = `
      <div class="track-header">
        <div class="track-color-bar" style="background:${track.color}"></div>
        <span class="track-type-icon">${typeIcon}</span>
        <span class="track-name-input" contenteditable="true" spellcheck="false">${track.name}</span>
        <button class="track-sound-btn" data-action="sound" title="Sound wählen">${soundLabel}</button>
        <div class="track-btns">
          <button class="track-icon-btn ${track.muted ? 'active-mute' : ''}" data-action="mute" title="Mute">M</button>
          <button class="track-icon-btn fx-btn"  data-action="fx"     title="FX">FX</button>
          <button class="track-icon-btn del-btn" data-action="delete" title="Löschen">✕</button>
        </div>
      </div>
    `;

    // Step buttons for drum tracks
    if (track.type === 'drum') {
      const seqEl = document.createElement('div');
      seqEl.className = 'track-seq';
      (track as DrumTrack).steps.forEach((on, i) => {
        const btn = document.createElement('button');
        btn.className = 'step' +
          (on ? ' on' : '') +
          (i % 4 === 0 ? ' beat-start' : '');
        btn.dataset.step = String(i);
        btn.style.setProperty('--track-color', track.color);
        if (on) btn.style.color = track.color;
        btn.addEventListener('click', () => {
          (track as DrumTrack).steps[i] = !(track as DrumTrack).steps[i];
          const isOn = (track as DrumTrack).steps[i];
          btn.classList.toggle('on', isOn);
          btn.style.color = isOn ? track.color : '';
          rebuildSequence(track.id);
          emit();
        });
        seqEl.appendChild(btn);
      });
      el.appendChild(seqEl);
    }

    // Select on header click
    el.querySelector('.track-header')!.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action]')) return;
      state.selectedId = track.id;
      renderTrackList(container);
      emit();
    });

    // Rename
    const nameEl = el.querySelector('.track-name-input') as HTMLElement;
    nameEl.addEventListener('blur', () => {
      track.name = nameEl.textContent?.trim() || track.name;
    });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });

    // Action buttons
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action!;
        if (action === 'mute') {
          track.muted = !track.muted;
          el.classList.toggle('muted', track.muted);
          btn.classList.toggle('active-mute', track.muted);
        } else if (action === 'fx') {
          document.dispatchEvent(new CustomEvent('daw:openFx', { detail: { id: track.id } }));
        } else if (action === 'delete') {
          disposeChain(track.id);
          removeTrack(track.id);
          renderTrackList(container);
          emit();
        }
      });
    });

    container.appendChild(el);
  });
}

// ─── Step highlight ───────────────────────────────────────────────────────────

let lastHighlightedStep = -1;

export function highlightStep(trackId: string, step: number) {
  if (step === lastHighlightedStep) return;
  lastHighlightedStep = step;

  // Remove previous playhead from all steps
  document.querySelectorAll('.step.playhead').forEach(s => s.classList.remove('playhead'));

  // Find the track element and highlight its step
  const trackEl = document.querySelector(`.track[data-id="${trackId}"]`);
  if (!trackEl) return;
  const stepEl = trackEl.querySelector(`.step[data-step="${step}"]`);
  stepEl?.classList.add('playhead');
}
