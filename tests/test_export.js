'use strict';

// Testet den Export der Ereigniskette als CSV und JSON: alle Ereignisse,
// chronologisch, mit Zeitstempel.

const test = require('node:test');
const assert = require('node:assert');

const Models = require('../js/models.js');
const Trace = require('../js/trace.js');

// Bewusst unsortiert angelegt, um die chronologische Sortierung zu pruefen.
function buildEvents() {
  const lotId = 'lot_A';
  return [
    Models.createEvent({ id: 'e3', lotId, type: 'transport', ts: '2026-03-03T00:00:00.000Z', seq: 2 }),
    Models.createEvent({ id: 'e1', lotId, type: 'ankauf', ts: '2026-03-01T00:00:00.000Z', seq: 0 }),
    Models.createEvent({ id: 'e2', lotId, type: 'grading', ts: '2026-03-02T00:00:00.000Z', seq: 1, payload: { grade: 'B' } })
  ];
}

test('JSON-Export enthaelt alle Ereignisse in chronologischer Reihenfolge', () => {
  const events = buildEvents();
  const json = Trace.exportChainJson(events, 'lot_A');
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.length, 3);
  assert.deepStrictEqual(
    parsed.map((e) => e.id),
    ['e1', 'e2', 'e3']
  );
  // Jeder Eintrag traegt einen Zeitstempel.
  parsed.forEach((e) => assert.ok(typeof e.ts === 'string' && e.ts.length > 0));
});

test('CSV-Export enthaelt Kopfzeile + alle Ereignisse chronologisch', () => {
  const events = buildEvents();
  const csv = Trace.exportChainCsv(events, 'lot_A');
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'event_id,lot_id,ts,seq,typ,erfasser,payload_json');
  assert.strictEqual(lines.length, 4); // Kopf + 3 Ereignisse
  assert.ok(lines[1].startsWith('e1,'));
  assert.ok(lines[2].startsWith('e2,'));
  assert.ok(lines[3].startsWith('e3,'));
  // Zeitstempel ist in jeder Datenzeile enthalten.
  assert.ok(lines[1].indexOf('2026-03-01T00:00:00.000Z') !== -1);
});

test('CSV maskiert Kommas/Anfuehrungszeichen im payload korrekt', () => {
  const events = [
    Models.createEvent({
      id: 'e1',
      lotId: 'lot_A',
      type: 'einlagerung',
      ts: '2026-03-01T00:00:00.000Z',
      seq: 0,
      payload: { note: 'Halle A, Regal "3"' }
    })
  ];
  const csv = Trace.exportChainCsv(events, 'lot_A');
  const dataLine = csv.split('\n')[1];
  // Die payload-Zelle ist quotiert und Anfuehrungszeichen sind verdoppelt.
  assert.ok(dataLine.indexOf('"') !== -1);
  assert.ok(dataLine.indexOf('""note""') !== -1, 'Anfuehrungszeichen verdoppelt');
  assert.ok(dataLine.indexOf('Halle A, Regal') !== -1, 'Komma bleibt im quotierten Feld erhalten');
  // CSV-Zelle wieder entpacken (fuehrendes/abschliessendes " entfernen, "" -> ").
  const cell = dataLine.slice(dataLine.indexOf('"') + 1, -1).replace(/""/g, '"');
  const parsed = JSON.parse(cell);
  assert.strictEqual(parsed.note, 'Halle A, Regal "3"');
});

test('Export ueber alle Lots mischt Ereignisse global chronologisch', () => {
  const events = [
    Models.createEvent({ id: 'b', lotId: 'lot_B', type: 'ankauf', ts: '2026-03-05T00:00:00.000Z', seq: 0 }),
    Models.createEvent({ id: 'a', lotId: 'lot_A', type: 'ankauf', ts: '2026-03-01T00:00:00.000Z', seq: 0 })
  ];
  const parsed = JSON.parse(Trace.exportChainJson(events));
  assert.deepStrictEqual(
    parsed.map((e) => e.id),
    ['a', 'b']
  );
});
