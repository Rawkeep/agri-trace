'use strict';

/*
 * Tests fuer die Datenbruecke (js/bridge.js): Import von Hofkette-v1-Belegen
 * in Chargen/Ereignisse/Links — idempotent, Massenbilanz-geprueft,
 * append-only-konform.
 */

const test = require('node:test');
const assert = require('node:assert');
const Bridge = require('../js/bridge.js');
const Hofkette = require('../js/hofkette.js');

// Beispiel-Kette: Muehle (Mais+Soja -> Futter), Stall (Verbrauch, Eier),
// Zukauf von der Partner-Farm, Verkauf.
const CSV = [
  'schema,event_id,ts,station,event_type,lot_id,parent_lot_ids,ref_event_id,product,qty_x10,unit,quality,origin,amount_minor,currency,actor,note',
  'hofkette-v1,fm-in-b1-mais,2026-08-01T08:00:00Z,feed-mill,VERARBEITUNG_IN,RM-mais,,fm-out-b1,mais,6000,kg,,farm,,,K. Mensah,',
  'hofkette-v1,fm-in-b1-soja,2026-08-01T08:00:00Z,feed-mill,VERARBEITUNG_IN,RM-soja,,fm-out-b1,soja,3000,kg,,farm,,,K. Mensah,',
  'hofkette-v1,fm-out-b1,2026-08-01T11:00:00Z,feed-mill,VERARBEITUNG_OUT,FEED-b1,RM-mais|RM-soja,,aliment,8800,kg,,farm,,,K. Mensah,Mahlverlust 20 kg',
  'hofkette-v1,af-feed-log1,2026-08-02T00:00:00Z,agri-flock,VERBRAUCH,FEED-b1,,,aliment,1250,kg,,farm,,,,Pondeuses A',
  'hofkette-v1,af-prod-flk1-2026-08-02,2026-08-02T00:00:00Z,agri-flock,PRODUKTION,EI-flk1-2026-08-02,,,oeufs,4380,stk,A,farm,,,,Pondeuses A',
  'hofkette-v1,af-ank-p7,2026-08-02T00:00:00Z,agri-flock,ANKAUF,EI-p7-2026-08-02,,,oeufs,2000,stk,B,partner:farm7,60000,XOF,,Zukauf',
  ''
].join('\n');

const EMPTY = { products: [], lots: [], links: [], events: [] };

test('planImport: legt Produkte, Chargen, Links und Ereignisse an', () => {
  const events = Hofkette.parseCsv(CSV);
  const plan = Bridge.planImport(events, EMPTY);
  assert.strictEqual(plan.events.length, 6);
  assert.strictEqual(plan.skippedEventIds.length, 0);
  // Produkte: mais, soja, aliment, oeufs (dedupliziert).
  assert.deepStrictEqual(plan.products.map((p) => p.id).sort(),
    ['prod-hk-aliment', 'prod-hk-mais', 'prod-hk-oeufs', 'prod-hk-soja']);
  // Chargen: RM-mais, RM-soja (aus IN-Zeilen), FEED-b1, EI-flk1, EI-p7.
  assert.deepStrictEqual(plan.lots.map((l) => l.id).sort(),
    ['EI-flk1-2026-08-02', 'EI-p7-2026-08-02', 'FEED-b1', 'RM-mais', 'RM-soja']);
});

test('planImport: Verarbeitung erzeugt Kind-Charge + Links mit IN-Anteilen', () => {
  const plan = Bridge.planImport(Hofkette.parseCsv(CSV), EMPTY);
  const feedLot = plan.lots.find((l) => l.id === 'FEED-b1');
  assert.strictEqual(feedLot.originType, 'verarbeitung');
  assert.strictEqual(feedLot.weightKg, 880);
  const links = plan.links.filter((l) => l.childLotId === 'FEED-b1');
  assert.strictEqual(links.length, 2);
  const mais = links.find((l) => l.parentLotId === 'RM-mais');
  assert.strictEqual(mais.shareKg, 600);
});

test('planImport: Zukauf traegt die Partner-Herkunft in die Charge', () => {
  const plan = Bridge.planImport(Hofkette.parseCsv(CSV), EMPTY);
  const zukauf = plan.lots.find((l) => l.id === 'EI-p7-2026-08-02');
  assert.strictEqual(zukauf.farmerId, 'farm7');
  const eigen = plan.lots.find((l) => l.id === 'EI-flk1-2026-08-02');
  assert.strictEqual(eigen.farmerId, '');
});

test('planImport: idempotent — bekannte event_ids werden uebersprungen', () => {
  const events = Hofkette.parseCsv(CSV);
  const first = Bridge.planImport(events, EMPTY);
  const after = {
    products: first.products,
    lots: first.lots,
    links: first.links,
    events: first.events
  };
  const second = Bridge.planImport(events, after);
  assert.strictEqual(second.events.length, 0);
  assert.strictEqual(second.lots.length, 0);
  assert.strictEqual(second.skippedEventIds.length, 6);
});

test('planImport: Massenbilanz-Verletzung wirft', () => {
  const bad = CSV.replace('8800,kg', '9100,kg'); // Output > Input
  assert.throws(() => Bridge.planImport(Hofkette.parseCsv(bad), EMPTY),
    /Massenbilanz/);
});

test('planImport: fehlende IN-Zeile fuer eine Eltern-Charge wirft', () => {
  const events = Hofkette.parseCsv(CSV).filter((e) => e.event_id !== 'fm-in-b1-soja');
  // Ohne die Soja-IN-Zeile stimmt zuerst die Bilanz nicht mehr (600 < 880) —
  // mit passendem Output faellt dann die fehlende Eltern-Zeile auf.
  const smaller = events.map((e) => (e.event_id === 'fm-out-b1'
    ? Object.assign({}, e, { qty_x10: 5000 }) : e));
  assert.throws(() => Bridge.planImport(smaller, EMPTY),
    /keine VERARBEITUNG_IN-Zeile/);
});

test('planImport: seq setzt hinter bestehenden Ereignissen auf', () => {
  const existing = {
    products: [], lots: [], links: [],
    events: [{ id: 'alt', seq: 41 }]
  };
  const plan = Bridge.planImport(Hofkette.parseCsv(CSV), existing);
  assert.strictEqual(plan.events[0].seq, 42);
});

test('planImport: Ereignistypen sind gueltige agri-trace-Typen', () => {
  const Models = require('../js/models.js');
  const plan = Bridge.planImport(Hofkette.parseCsv(CSV), EMPTY);
  plan.events.forEach((e) => {
    assert.ok(Models.EVENT_TYPES.indexOf(e.type) !== -1,
      'unbekannter Typ: ' + e.type);
  });
  const prod = plan.events.find((e) => e.id === 'af-prod-flk1-2026-08-02');
  assert.strictEqual(prod.type, 'produktion');
  assert.strictEqual(prod.payload.grade, 'A');
});

test('applyPlan: persistiert ueber den Storage-Vertrag und zaehlt korrekt', async () => {
  const saved = { products: 0, lots: 0, links: 0, events: 0 };
  const fakeStorage = {
    saveProduct: () => { saved.products += 1; return Promise.resolve(); },
    saveLot: () => { saved.lots += 1; return Promise.resolve(); },
    saveLotLink: () => { saved.links += 1; return Promise.resolve(); },
    appendEvent: () => { saved.events += 1; return Promise.resolve(); }
  };
  const plan = Bridge.planImport(Hofkette.parseCsv(CSV), EMPTY);
  const result = await Bridge.applyPlan(plan, fakeStorage);
  assert.strictEqual(saved.events, 6);
  assert.strictEqual(saved.lots, 5);
  assert.deepStrictEqual(result, { imported: 6, skipped: 0 });
});
