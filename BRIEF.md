# Brief 04 — agri-trace

**Position in der Kette:** Qualität & Rückverfolgbarkeit. Export- und
Supermarkt-Kanäle verlangen lückenlose Nachweise (Herkunft, Grading,
Behandlung, Kühlkette). Wer Traceability liefert, öffnet Farmern die
Premium-Märkte — und dockt direkt an die Export-Kompetenz von RAQ /
export-africa-pro / sap-agent an (32-Doku-Bundle, SONCAP/PVOC, Form M).

## Copy-&-Paste-Auftrag (CLI/UI)

```
Eine offline-first Web-App "agri-trace" für Chargen-Rückverfolgbarkeit in der Agrar-Lieferkette Westafrikas: Chargen (Lots) anlegen mit Herkunft (Farmer/Kooperative, Dorf, H3-Zelle, Erntedatum), Produkt und Menge kg; jede Station der Kette als Ereignis an die Charge hängen (Ankauf, Sortierung/Grading A/B/C, Einlagerung mit Temperatur, Verarbeitung mit Input-Output-Verknüpfung mehrerer Chargen, Verpackung mit Losnummer, Transport, Verkauf/Export); aus Verarbeitung entstehen Kind-Chargen mit Rückverweis auf Eltern-Chargen (Split und Merge); je Charge einen druckbaren Chargen-Pass mit QR-Code (lokal generiert, kein externer Dienst) der die komplette Ereigniskette chronologisch zeigt; Suche nach Charge, Farmer, Produkt, Zeitraum; Rückruf-Simulation: von einer verkauften Charge alle betroffenen Eltern-Chargen und Geschwister-Chargen finden; Export der Ereigniskette als CSV und JSON für Export-Dokumentation. Vanilla JS + localStorage/IndexedDB, keine externen Requests, UI Englisch und Französisch, alle Ereignisse unveränderlich (append-only, Korrektur nur durch Storno-Ereignis).
```

## Zielgruppe & Nutzenversprechen

- **Nutzer:** Aggregatoren, Verarbeiter und Exporteure, die supermarkt- oder
  exportfähig werden wollen; Qualitätsbeauftragte.
- **Nutzen:** Chargen-Pass als Verkaufsargument; Rückruf in Minuten statt
  Tagen; Vorstufe zu Zertifizierungen (GlobalG.A.P.-artige Dokumentation)
  und zu den Export-Dokumentenketten in RAQ/sap-agent.

## Kern-Datenmodell

| Tabelle | Felder (Auszug) |
|---|---|
| `lots` | lot_id, produkt_id, menge_kg, herkunft_farmer_id, dorf, h3_zelle, ernte_datum, status |
| `events` | event_id, lot_id, ts, typ (ankauf/grading/einlagerung/verarbeitung/verpackung/transport/verkauf/storno), payload_json, erfasser — **append-only** |
| `lot_links` | eltern_lot_id, kind_lot_id, anteil_kg (Split/Merge bei Verarbeitung) |
| `products` | produkt_id, name_en, name_fr, hs_code (für Export-Anschluss) |

## Akzeptanzkriterien (prüfbar)

1. Ereignisse sind unveränderlich: kein Update/Delete im UI; Korrektur
   erzeugt ein Storno-Ereignis, die Kette bleibt vollständig.
2. Verarbeitung: n Eltern-Chargen → m Kind-Chargen mit kg-Anteilen; die
   Massenbilanz (Σ Input ≥ Σ Output, Differenz = Ausbeute-Verlust) wird
   angezeigt und darf nicht negativ sein.
3. Chargen-Pass: druckbare Seite mit QR-Code (lokal per Canvas/JS-Snippet
   erzeugt, keine CDN-Library zur Laufzeit nachladen — gebündelt ist ok)
   und chronologischer Ereignis-Tabelle.
4. Rückruf-Simulation liefert für eine Charge in einem Klick: alle
   Vorfahren, alle Nachkommen, alle Geschwister (gleiche Eltern) — mit
   betroffenen kg.
5. CSV-/JSON-Export einer Kette enthält alle Ereignisse mit Zeitstempel.
6. Suche über lot_id, Farmer, Produkt, Datumsbereich.
7. Vollständig offline, EN/FR, keine externen Requests.

## Ausbau-Ideen (nicht Teil des MVP)

Anbindung an RAQ-Dokumentenketten (`document_chain`), sap-agent-Skill als
Prüfer der Ereigniskette, Foto je Ereignis, Sensor-Import Temperatur
(cold-chain-manager), GS1/EPCIS-Export.
