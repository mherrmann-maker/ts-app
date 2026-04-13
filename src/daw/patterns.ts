import { state, selectedTrack } from './state';
import { TrackMod } from './types';
import { rebuildSequence } from './audio';

// ─── Pattern modifier panel ───────────────────────────────────────────────────

export function renderPatternPanel(container: HTMLElement, onChange: () => void) {
  const track = selectedTrack();
  container.innerHTML = '';

  if (!track) {
    container.innerHTML = '<p class="empty-msg">Kein Track gewählt</p>';
    return;
  }

  const mod = track.mod;

  // Speed
  container.appendChild(makeRow('SPEED', makeSelect(
    ['0.25','0.5','1','2','4'],
    String(mod.speed),
    v => { mod.speed = parseFloat(v); rebuild(); onChange(); }
  )));

  // Toggles
  const toggles: Array<[string, keyof TrackMod]> = [
    ['REVERSE',    'reverse'],
    ['JUX(REV)',   'jux'],
    ['PALINDROME', 'palindrome'],
  ];
  toggles.forEach(([label, key]) => {
    container.appendChild(makeRow(label, makeToggle(
      mod[key] as boolean,
      v => { (mod as any)[key] = v; rebuild(); onChange(); }
    )));
  });

  // Degrade
  container.appendChild(makeRow('DEGRADE', makeSlider(0, 0.9, 0.1, mod.degrade,
    v => { mod.degrade = v; rebuild(); onChange(); }
  )));

  // Euclid
  const euclidSection = document.createElement('div');
  euclidSection.className = 'pattern-section';
  euclidSection.innerHTML = `<span class="pattern-label">EUKLID</span>`;

  const euclidCanvas = document.createElement('canvas');
  euclidCanvas.className = 'euclid-canvas';
  euclidCanvas.width  = 120;
  euclidCanvas.height = 120;

  const eN = makeNumberInput(2, 32, mod.euclid?.n ?? 8,
    v => { ensureEuclid(mod); mod.euclid!.n = v; drawEuclid(euclidCanvas, mod); rebuild(); onChange(); });
  const eK = makeNumberInput(1, 32, mod.euclid?.k ?? 3,
    v => { ensureEuclid(mod); mod.euclid!.k = v; drawEuclid(euclidCanvas, mod); rebuild(); onChange(); });
  const eR = makeNumberInput(0, 31, mod.euclid?.rot ?? 0,
    v => { ensureEuclid(mod); mod.euclid!.rot = v; drawEuclid(euclidCanvas, mod); rebuild(); onChange(); });

  const euclidToggle = makeToggle(mod.euclid !== null, v => {
    mod.euclid = v ? { n: 8, k: 3, rot: 0 } : null;
    drawEuclid(euclidCanvas, mod);
    rebuild(); onChange();
  });

  euclidSection.appendChild(euclidToggle);
  euclidSection.appendChild(makeRow('N (Schritte)', eN));
  euclidSection.appendChild(makeRow('K (Pulse)',    eK));
  euclidSection.appendChild(makeRow('ROT',          eR));
  euclidSection.appendChild(euclidCanvas);
  container.appendChild(euclidSection);
  drawEuclid(euclidCanvas, mod);

  // Arp (melody tracks only)
  if (track.type === 'melody') {
    container.appendChild(makeRow('ARP MODUS', makeSelect(
      ['off','up','down','updown','random'],
      mod.arpMode,
      v => { mod.arpMode = v as TrackMod['arpMode']; rebuild(); onChange(); }
    )));
    container.appendChild(makeRow('ARP LÄNGE', makeSlider(2, 8, 1, mod.arpLen,
      v => { mod.arpLen = v; rebuild(); onChange(); }
    )));
  }
}

// ─── Euclidean visualizer ─────────────────────────────────────────────────────

function drawEuclid(canvas: HTMLCanvasElement, mod: TrackMod) {
  const ctx = canvas.getContext('2d')!;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  if (!mod.euclid) {
    ctx.fillStyle = '#ffffff22';
    ctx.fillRect(0, 0, W, H);
    return;
  }

  const { n, k, rot } = mod.euclid;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 8;
  const hits = euclidRhythm(n, k, rot);

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    ctx.beginPath();
    ctx.arc(x, y, hits[i] ? 7 : 4, 0, Math.PI * 2);
    ctx.fillStyle = hits[i] ? '#00ff88' : '#ffffff33';
    ctx.fill();
  }

  // Ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth   = 1;
  ctx.stroke();
}

function euclidRhythm(n: number, k: number, rot: number): boolean[] {
  // Bjorklund algorithm
  const result: boolean[] = new Array(n).fill(false);
  if (k <= 0 || n <= 0) return result;
  k = Math.min(k, n);

  let counts  = new Array(k).fill(Math.floor(n / k));
  let remainders = new Array(k).fill(0);
  let divisor = n - k * Math.floor(n / k);
  let level   = k;

  for (let i = 0; i < divisor; i++) counts[i]++;

  while (level > 1) {
    const newCounts: number[] = [];
    const newRemainders: number[] = [];
    divisor = level;
    level   = counts.filter(c => c === counts[counts.length - 1]).length;

    for (let i = 0; i < divisor; i++) {
      if (i < counts.length) {
        newCounts.push(counts[i]);
        newRemainders.push(0);
      }
    }
    counts      = newCounts;
    remainders  = newRemainders;
    if (counts.length <= 1) break;
  }

  // Flatten to pattern
  let pattern: boolean[] = [];
  let idx = 0;
  for (let g = 0; g < k; g++) {
    pattern.push(true);
    for (let j = 1; j < Math.round(n / k); j++) pattern.push(false);
    if (idx < n % k) { pattern.push(false); idx++; }
  }
  pattern = pattern.slice(0, n);

  // Rotate
  const r = ((rot % n) + n) % n;
  return [...pattern.slice(r), ...pattern.slice(0, r)];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rebuild() {
  const t = selectedTrack();
  if (t) rebuildSequence(t.id);
}

function ensureEuclid(mod: TrackMod) {
  if (!mod.euclid) mod.euclid = { n: 8, k: 3, rot: 0 };
}

function makeRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pattern-row';
  const lbl = document.createElement('span');
  lbl.className = 'pattern-label';
  lbl.textContent = label;
  row.appendChild(lbl);
  row.appendChild(control);
  return row;
}

function makeSelect(options: string[], current: string, onChange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'pattern-select';
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === current) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeToggle(current: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'pattern-toggle' + (current ? ' active' : '');
  btn.textContent = current ? 'AN' : 'AUS';
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('active');
    btn.classList.toggle('active', next);
    btn.textContent = next ? 'AN' : 'AUS';
    onChange(next);
  });
  return btn;
}

function makeSlider(min: number, max: number, step: number, current: number, onChange: (v: number) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type  = 'range';
  el.className = 'pattern-slider';
  el.min   = String(min);
  el.max   = String(max);
  el.step  = String(step);
  el.value = String(current);
  el.addEventListener('input', () => onChange(parseFloat(el.value)));
  return el;
}

function makeNumberInput(min: number, max: number, current: number, onChange: (v: number) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type  = 'number';
  el.className = 'pattern-number';
  el.min   = String(min);
  el.max   = String(max);
  el.value = String(current);
  el.addEventListener('change', () => onChange(parseInt(el.value)));
  return el;
}
