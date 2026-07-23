'use strict';

// Testet die Modell-Validierung (Pflichtfelder, gueltige Ereignistypen usw.)
// und die Suche ueber lot_id / Farmer / Produkt / Zeitraum.

const test = require('node:test');
const assert = require('node:assert');

const Models = require('../js/models.js');
const Trace = require('../js/trace.js');

test('createLot verlangt productId und positives Gewicht', () => {
  assert.throws(() => Models.createLot({ weightKg: 10 }), /productId/);
  assert.throws(() => Models.createLot({ productId: 'p', weightKg: 0 }), /Gewicht/);
  const lot = Models.createLot({ productId: 'p', weightKg: 12.5, farmerId: 'f1', harvestDate: '2026-01-01' });
  assert.strictEqual(lot.weightKg, 12.5);
  assert.strictEqual(lot.status, 'aktiv');
  assert.strictEqual(lot.originType, 'ankauf');
});

test('createEvent lehnt unbekannte Ereignistypen ab', () => {
  assert.throws(() => Models.createEvent({ lotId: 'l', type: 'quatsch' }), /Ungueltiger Ereignistyp/);
  const ev = Models.createEvent({ lotId: 'l', type: 'ankauf' });
  assert.strictEqual(ev.type, 'ankauf');
  assert.ok(typeof ev.ts === 'string');
});

test('createEvent prueft Grade bei Grading', () => {
  assert.throws(() => Models.createEvent({ lotId: 'l', type: 'grading', payload: { grade: 'Z' } }), /Qualitaetsstufe/);
  const ev = Models.createEvent({ lotId: 'l', type: 'grading', payload: { grade: 'A' } });
  assert.strictEqual(ev.payload.grade, 'A');
});

test('createLotLink verbietet Selbstverweis', () => {
  assert.throws(() => Models.createLotLink({ parentLotId: 'x', childLotId: 'x', shareKg: 1 }), /identisch/);
});

test('searchLots filtert nach lot_id, Farmer, Produkt und Datumsbereich', () => {
  const lots = [
    Models.createLot({ id: 'lot_alpha', productId: 'cocoa', weightKg: 10, farmerId: 'f1', harvestDate: '2026-01-05' }),
    Models.createLot({ id: 'lot_beta', productId: 'cashew', weightKg: 10, farmerId: 'f2', harvestDate: '2026-02-05' }),
    Models.createLot({ id: 'lot_gamma', productId: 'cocoa', weightKg: 10, farmerId: 'f1', harvestDate: '2026-03-05' })
  ];

  assert.strictEqual(Trace.searchLots(lots, { lotId: 'beta' }).length, 1);
  assert.strictEqual(Trace.searchLots(lots, { farmerId: 'f1' }).length, 2);
  assert.strictEqual(Trace.searchLots(lots, { productId: 'cocoa' }).length, 2);
  assert.strictEqual(Trace.searchLots(lots, { dateFrom: '2026-02-01', dateTo: '2026-02-28' }).length, 1);
  assert.strictEqual(
    Trace.searchLots(lots, { productId: 'cocoa', dateFrom: '2026-03-01' }).length,
    1
  );
});
