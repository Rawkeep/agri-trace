# agri-trace

Offline-first Web-App fuer **Chargen-Rueckverfolgbarkeit** in der Agrar-
Lieferkette Westafrikas. Chargen (Lots) mit Herkunft, eine **append-only**
Ereigniskette entlang der Stationen (Ankauf → Grading → Einlagerung →
Verarbeitung → Verpackung → Transport → Verkauf/Export), Verarbeitung mit
**Split/Merge** (Eltern→Kind-Chargen + Massenbilanz), druckbarer **Chargen-
Pass mit lokal erzeugtem QR-Code**, **Rueckruf-Simulation** (Vorfahren /
Nachkommen / Geschwister) und **CSV/JSON-Export** der Ereigniskette.

Vollstaendig lokal: Vanilla JS, kein Build-Tool, **keine externen Requests**
(kein CDN, kein fetch/XHR). Der QR-Code wird lokal per eigenem Encoder
(`js/qrcode.js`, ISO/IEC 18004, Byte-Modus) erzeugt. UI Englisch **und**
Franzoesisch.

## Starten

Kein Build noetig. Einen beliebigen statischen Server im Projektordner starten,
z. B.:

```bash
python3 -m http.server 5180
# dann http://localhost:5180/ oeffnen
```

Oder `index.html` direkt im Browser oeffnen (IndexedDB/localStorage werden
lokal genutzt).

## Architektur

| Datei | Rolle |
|-------|-------|
| `js/models.js` | Datenmodell (Product, Lot, Event, LotLink) + Validierung |
| `js/storage.js` | Persistenz: IndexedDB primaer, localStorage-Fallback, Promise-basiert. Ereignis-Store ist **append-only** (kein Update/Delete) |
| `js/i18n.js` | Woerterbuch EN/FR + `t()` / Sprachumschaltung |
| `js/qrcode.js` | Lokaler QR-Encoder (rein funktional + Canvas-/SVG-Renderer) |
| `js/trace.js` | **Kern-IP** (rein funktional, Node-getestet): Storno, Massenbilanz, Split/Merge, Rueckruf, Suche, Export |
| `js/app.js` | Orchestrierung (nur Browser): DOM, i18n, Storage, Downloads |

Alle JS-Module haengen ihre API an `window`/`globalThis` **und** exportieren
zusaetzlich per `module.exports` (dual-export), damit die Logik unter Node
testbar ist.

## Invarianten

- **Ereignisse sind unveraenderlich.** Kein Update/Delete im UI; eine
  Korrektur erzeugt ein **Storno-Ereignis** (`trace.makeStornoEvent`), die
  Kette bleibt vollstaendig.
- **Massenbilanz:** Σ Input ≥ Σ Output; die Differenz ist der
  Ausbeuteverlust und darf **nicht negativ** werden
  (`trace.computeMassBalance` / `trace.planProcessing` werfen sonst).
- **QR-Code lokal:** keine Library zur Laufzeit nachgeladen.

## Tests

Reine Node-Tests ohne npm-Abhaengigkeiten (`node --test`):

```bash
node --test tests/*.js
```

Abgedeckt: Append-only + Storno, Split/Merge + Massenbilanz (negativ
verboten), Rueckruf-Simulation (Vorfahren/Nachkommen/Geschwister), CSV/JSON-
Export (chronologisch), Modell-/Suchlogik, QR-Encoder (Struktur) sowie
`node --check` fuer **jede** Datei in `js/`.
