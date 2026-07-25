# agri-trace

Offline-first Web-App fuer **Chargen-Rueckverfolgbarkeit** in der Agrar-
Lieferkette Westafrikas (z. B. Kakao, Cashew). Chargen (Lots) mit Herkunft
(Farmer/Kooperative, Dorf, H3-Zelle, Erntedatum), eine **append-only**
Ereigniskette entlang der Stationen (Ankauf → Grading → Einlagerung →
Verarbeitung → Verpackung → Transport → Verkauf/Export), Verarbeitung mit
**Split/Merge** (Eltern→Kind-Chargen + Massenbilanz), ein druckbarer
**Chargen-Pass mit lokal erzeugtem QR-Code**, eine **Rueckruf-Simulation**
(Vorfahren/Nachkommen/Geschwister einer Charge) und **CSV/JSON-Export** der
Ereigniskette.

Vollstaendig lokal: Vanilla JS ohne Framework/Build-Tool, **keine externen
Requests zur Laufzeit** (kein CDN, kein fetch/XHR). Der QR-Code wird lokal
per eigenem ISO/IEC-18004-Encoder erzeugt (`js/qrcode.js`, Byte-Modus,
EC-Level M). Daten liegen im Browser (IndexedDB, Fallback localStorage) —
kein Backend, keine Datenbank-Server. UI-Sprachen: Englisch und Franzoesisch.

## Funktionen

- **Chargen (Lots) anlegen & suchen** — Produkt, Gewicht (kg), Farmer/
  Kooperative, Dorf, H3-Zelle, Erntedatum; Suche nach Lot-ID, Farmer,
  Produkt und Erntedatum-Zeitraum (View "Lots").
- **Append-only Ereigniskette pro Charge** — Ereignistypen `ankauf`,
  `grading` (Qualitaetsstufe A/B/C), `einlagerung` (inkl. Temperatur),
  `verarbeitung`, `verpackung` (Losnummer), `transport`, `verkauf`. Kein
  Update/Delete im UI; eine Korrektur erzeugt ein **Storno-Ereignis**, das
  ein vorheriges Ereignis fachlich aufhebt, ohne es zu veraendern.
- **Verarbeitung (Split/Merge)** — n Eltern-Chargen zu m Kind-Chargen
  verarbeiten; die App berechnet live Input-Summe, Output-Summe und
  Ausbeuteverlust und verweigert die Verarbeitung, sobald der Output den
  Input uebersteigt (Massenbilanz darf nicht negativ werden).
- **Chargen-Pass** — druckbare Ansicht einer Charge mit Stammdaten,
  vollstaendiger chronologischer Ereigniskette und einem lokal generierten
  QR-Code (SVG); eigenes Druck-Stylesheet blendet beim Drucken alles
  ausser dem Pass aus.
- **Rueckruf-Simulation** — fuer eine ausgewaehlte Charge werden transitiv
  alle Vorfahren, Nachkommen und Geschwister (ueber die Eltern→Kind-
  Verknuepfungen) ermittelt, inkl. betroffener Menge (kg) je Charge.
- **Export** — Ereigniskette (optional auf eine Charge beschraenkt) als
  JSON oder CSV, chronologisch sortiert, als lokaler Datei-Download.
- **Produktverwaltung** — Produkte mit zweisprachigem Namen (EN/FR) und
  HS-Code.
- **Zweisprachige UI** (Englisch/Franzoesisch) mit persistenter
  Sprachauswahl (localStorage).

## Tech-Stack

- **Vanilla JavaScript** (ES5-Stil, IIFE-Module), keine Frameworks, kein
  Bundler/Build-Tool. Jedes Modul haengt seine API an `window`/`globalThis`
  **und** exportiert zusaetzlich per `module.exports` (dual-export), damit
  dieselbe Logik unter Node lauffaehig und testbar ist.
- **Persistenz:** IndexedDB als primaerer Speicher, transparenter
  Fallback auf `localStorage`, wenn IndexedDB fehlt. Ausschliesslich
  Browser-eigene Storage-APIs, kein Server/keine DB.
- **QR-Code:** eigener, lokaler Encoder nach ISO/IEC 18004 (Reed-Solomon
  ueber GF(256), Masken-/Formatinformation), kein externes Paket.
- Reines HTML/CSS ohne CSS-Framework (`css/style.css`), inkl. Print-Styles
  fuer den Chargen-Pass.
- **Tests:** Node-Bordmittel (`node --test`, `node:assert`), keine
  npm-Abhaengigkeiten oder Test-Framework noetig.

## Starten

Kein Build noetig. Es gibt kein `package.json` und keine npm-Skripte —
einfach `index.html` oeffnen oder einen beliebigen statischen Server im
Projektordner starten, z. B.:

```bash
python3 -m http.server 5180
# dann http://localhost:5180/ im Browser oeffnen
```

Oder `index.html` direkt per Doppelklick im Browser oeffnen (IndexedDB/
localStorage werden lokal genutzt; einige Browser schraenken `file://`-
Storage-APIs ein, ein lokaler Server ist daher robuster).

Beim ersten Start ohne vorhandene Produkte legt die App automatisch zwei
Demo-Produkte an (Kakaobohnen/Cashewnuesse) als Startpunkt.

## Architektur

| Datei | Rolle |
|-------|-------|
| `index.html` | App-Shell: alle Views (Lots, Processing, Passport, Recall, Export, Products), laedt die Module per `<script>`-Tags in Abhaengigkeitsreihenfolge |
| `js/shared/offline-kit.js` | Geteilte generische Storage-/i18n-Engine (IndexedDB/localStorage-Backend, `t()`/`setLanguage()`/`getLanguage()`), byte-identisch in fuenf Schwester-Repos (agri-aggregator, agri-lease, cold-chain-manager, feed-mill, market-link). Keine App-spezifischen Daten |
| `js/models.js` | Datenmodell (Product, Lot, Event, LotLink) + Validierung; definiert erlaubte Ereignistypen/Qualitaetsstufen/Lot-Status |
| `js/storage.js` | Persistenz-Wrapper um `OfflineKit.createOfflineStorage` mit agri-trace-spezifischem DB-Namen/Stores. Ereignis-Store ist **append-only** (`appendEvent` verweigert das Ueberschreiben existierender IDs); es gibt bewusst keine generischen delete-Methoden in der oeffentlichen API |
| `js/i18n.js` | Woerterbuch Englisch/Franzoesisch via `OfflineKit.createI18n()` — `t()`/`setLanguage()`/`getLanguage()`, Sprachpersistenz in `localStorage` |
| `js/qrcode.js` | Lokaler QR-Encoder (rein funktional, `toModules`) + Canvas-/SVG-Renderer fuer den Chargen-Pass |
| `js/trace.js` | **Kern-Logik** (rein funktional, seiteneffektfrei, Node-getestet): Storno-Erzeugung, Massenbilanz, Split/Merge-Planung, Rueckruf-Simulation, Suche, JSON-/CSV-Export |
| `js/app.js` | Orchestrierung (nur Browser): DOM-Bindings, i18n-Anwendung, Aufruf von Storage/Trace, Datei-Downloads |
| `css/style.css` | Layout + Druck-Stylesheet fuer den Chargen-Pass |
| `tests/` | Node-Tests fuer Modelle, Storno/Append-only, Verarbeitung/Massenbilanz, Rueckruf, QR-Encoder, Export sowie ein Syntax-Check aller `js/`-Dateien |

Alle JS-Module sind klassische IIFEs, keine ES-Module — Ladereihenfolge in
`index.html` ist relevant (offline-kit → models → storage → i18n → qrcode →
trace → app).

## Invarianten

- **Ereignisse sind unveraenderlich.** Kein Update/Delete im UI; eine
  Korrektur erzeugt ein **Storno-Ereignis** (`trace.makeStornoEvent`), die
  Kette bleibt vollstaendig nachvollziehbar.
- **Massenbilanz:** Σ Input ≥ Σ Output bei einer Verarbeitung; die
  Differenz ist der Ausbeuteverlust und darf **nicht negativ** werden
  (`trace.computeMassBalance`/`trace.planProcessing` werfen sonst einen
  Fehler).
- **QR-Code lokal:** keine Library wird zur Laufzeit nachgeladen, kein
  Netzwerk-Zugriff.

## Tests

Reine Node-Tests ohne npm-Abhaengigkeiten (`node --test`):

```bash
node --test tests/*.js
```

Aktuell 32 Tests, abgedeckt werden: Append-only + Storno (`test_append_storno.js`),
Split/Merge + Massenbilanz inkl. Ablehnung bei negativem Ausbeuteverlust
(`test_processing.js`), Rueckruf-Simulation Vorfahren/Nachkommen/Geschwister
(`test_recall.js`), CSV-/JSON-Export chronologisch (`test_export.js`),
Modell-/Validierungslogik (`test_models.js`), QR-Encoder-Struktur
(`test_qrcode.js`) sowie `node --check` fuer jede Datei in `js/`
(`test_syntax.js`).
