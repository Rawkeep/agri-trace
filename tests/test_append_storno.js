'use strict';

// Testet die Append-only-Invariante: Eine Korrektur mutiert oder loescht nie
// ein bestehendes Ereignis, sondern erzeugt ein separates Storno-Ereignis.

const test = require('node:test');
const assert = require('node:assert');

const Models = require('../js/models.js');
const Trace = require('../js/trace.js');

function buildChain() {
  const lot = Models.createLot({ productId: 'prod_1', weightKg: 100, farmerId: 'f1' });
  const events = [
    Models.createEvent({ lotId: lot.id, type: 'ankauf', ts: '2026-01-01T08:00:00.000Z', seq: 0 }),
    Models.createEvent({
      lotId: lot.id,
      type: 'grading',
      ts: '2026-01-02T08:00:00.000Z',
      seq: 1,
      payload: { grade: 'A' }
    })
  ];
  return { lot, events };
}

test('Storno erzeugt ein neues Ereignis, ohne das Ziel zu mutieren', () => {
  const { events } = buildChain();
  const target = events[1];
  const snapshotBefore = JSON.stringify(target);
  const lengthBefore = events.length;

  const storno = Trace.makeStornoEvent(events, target.id, { reason: 'Falsches Grade', recordedBy: 'qa1' });

  // Ziel-Ereignis bleibt bitgenau unveraendert.
  assert.strictEqual(JSON.stringify(target), snapshotBefore);
  // Das Eingangs-Array wurde nicht mutiert (kein push/splice/delete).
  assert.strictEqual(events.length, lengthBefore);
  // Das Storno ist ein eigenstaendiges Ereignis mit Rueckverweis.
  assert.strictEqual(storno.type, 'storno');
  assert.strictEqual(storno.lotId, target.lotId);
  assert.strictEqual(storno.payload.stornoOf, target.id);
  assert.strictEqual(storno.payload.reason, 'Falsches Grade');
  assert.notStrictEqual(storno.id, target.id);
  // Storno erhaelt eine hoehere seq (nach dem Ziel in der Kette).
  assert.ok(storno.seq > target.seq);
});

test('stornoedEventIds markiert das aufgehobene Ereignis, Kette bleibt vollstaendig', () => {
  const { events } = buildChain();
  const target = events[1];
  const storno = Trace.makeStornoEvent(events, target.id, {});
  const full = events.concat([storno]);

  const flagged = Trace.stornoedEventIds(full);
  assert.strictEqual(flagged[target.id], true);
  // Beide Original-Ereignisse plus das Storno sind weiterhin vorhanden.
  assert.strictEqual(full.length, 3);
  assert.ok(full.some((e) => e.id === target.id));
});

test('Ein Storno kann nicht storniert werden', () => {
  const { events } = buildChain();
  const storno = Trace.makeStornoEvent(events, events[0].id, {});
  const withStorno = events.concat([storno]);
  assert.throws(() => Trace.makeStornoEvent(withStorno, storno.id, {}), /Storno-Ereignis kann nicht storniert/);
});

test('Storno auf unbekanntes Ereignis wirft', () => {
  const { events } = buildChain();
  assert.throws(() => Trace.makeStornoEvent(events, 'gibt_es_nicht', {}), /nicht gefunden/);
});

test('Modelle besitzen keine Update-/Delete-API fuer Ereignisse', () => {
  // Das Modell bietet nur Factories, keine Mutation. Der Storage-Layer
  // exponiert appendEvent, aber kein updateEvent/deleteEvent.
  const Storage = require('../js/storage.js');
  assert.strictEqual(typeof Storage.appendEvent, 'function');
  assert.strictEqual(typeof Storage.updateEvent, 'undefined');
  assert.strictEqual(typeof Storage.deleteEvent, 'undefined');
});
