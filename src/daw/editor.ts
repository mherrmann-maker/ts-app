import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { generateCode } from './codegen';

// ─── CodeMirror editor ────────────────────────────────────────────────────────

let view: EditorView | null = null;
let evalCallback: ((code: string) => void) | null = null;

export function initEditor(container: HTMLElement, onEval: (code: string) => void) {
  evalCallback = onEval;

  const runKeymap = keymap.of([
    {
      key: 'Ctrl-Enter',
      run: () => { runCode(); return true; },
    },
    {
      key: 'Mod-Enter',
      run: () => { runCode(); return true; },
    },
  ]);

  view = new EditorView({
    doc: '// Drücke Strg+Enter zum Starten\n',
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      runKeymap,
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: '"Space Grotesk", monospace' },
      }),
    ],
    parent: container,
  });

  return view;
}

export function updateEditorCode(code: string) {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: code },
  });
}

export function refreshCode() {
  updateEditorCode(generateCode());
}

function runCode() {
  if (!view || !evalCallback) return;
  const code = view.state.doc.toString();
  evalCallback(code);
}

export function getEditorCode(): string {
  return view?.state.doc.toString() ?? '';
}

// ─── Code drawer (collapsible) ────────────────────────────────────────────────

export function initCodeDrawer(
  drawerEl: HTMLElement,
  toggleEl: HTMLElement,
  editorContainer: HTMLElement,
  onEval: (code: string) => void
) {
  let open = false;

  initEditor(editorContainer, onEval);

  toggleEl.addEventListener('click', () => {
    open = !open;
    drawerEl.classList.toggle('open', open);
    toggleEl.textContent = open ? '▼ CODE' : '▲ CODE';
    if (open) refreshCode();
  });

  // Run button inside drawer
  const runBtn = drawerEl.querySelector('.drawer-run');
  runBtn?.addEventListener('click', () => {
    const code = getEditorCode();
    onEval(code);
  });

  // Copy button
  const copyBtn = drawerEl.querySelector('.drawer-copy');
  copyBtn?.addEventListener('click', async () => {
    const code = getEditorCode();
    await navigator.clipboard.writeText(code).catch(() => {});
    if (copyBtn) {
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ KOPIERT';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    }
  });
}
