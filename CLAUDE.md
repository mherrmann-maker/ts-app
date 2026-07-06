# ts-app — Hinweise für Claude

## Nutzer-Präferenzen

- **Am Ende jeder Antwort immer die aktuellen Live-Links angeben:**
  - DAW: https://mherrmann-maker.github.io/ts-app/strudel.html
  - Session View: https://mherrmann-maker.github.io/ts-app/session.html
  - Hauptseite: https://mherrmann-maker.github.io/ts-app/
- Der Nutzer ist kein Entwickler und arbeitet auf dem iPhone — alle UI auf Deutsch, touch-freundlich, Antworten einfach erklären.

## Projekt

- Vite Multi-Page-App: `index.html` (3D-Studio-Seite), `strudel.html` (visuelle DAW), `session.html` (Ableton-style Session View).
- DAW-Logik modular in `src/daw/` (ein Modul pro Aufgabe; große Einzeldateien vermeiden — Timeout-Gefahr beim Generieren).
- Audio primär über Tone.js; echte Strudel-Engine (`src/daw/strudel-engine.ts`) für authentischen strudel.cc-Sound (Engine-Umschalter im Transport).
- `src/daw/codegen.ts` erzeugt gültigen strudel.cc-Code (setcpm + einzelnes stack, Methoden-Ketten).

## Deployment

- GitHub Pages via `.github/workflows/deploy.yml` → Branch `gh-pages`, ausgelöst durch Push auf `main` und die in der Workflow-Datei gelisteten `claude/*`-Branches.
- **Achtung:** Mehrere parallele Branches deployen auf dieselbe Pages-Seite — der letzte Push gewinnt. Nach fremden Deploys ggf. mit leerem Commit erneut triggern.
- Deploy dauert ~2–3 Min. Live-Check: Seite auf ein Marker-String der neuen Version pollen (Cache-Buster-Query verwenden).
