'use strict';

// Testet Verarbeitung mit Split/Merge (kg-Anteile) und die Massenbilanz:
// Sigma Input >= Sigma Output, Differenz = Ausbeuteverlust, nie negativ.

const test = require('node:test');
const assert = require('node:assert');

const Models = require('../js/models.js');
const Trace = require('../js/trace.js');

test('computeMassBalance liefert korrekten Ausbeuteverlust', () => {
  const balance = Trace.computeMassBalance([100, 50], [120]);
  assert.strictEqual(balance.inputSum, 150);
  assert.strictEqual(balance.outputSum, 120);
  assert.strictEqual(balance.yieldLoss, 30);
});

test('computeMassBalance verbietet negativen Ausbeuteverlust (Output > Input)', () => {
  assert.throws(() => Trace.computeMassBalance([100], [140]), /Massenbilanz verletzt/);
});

test('Split: eine Eltern-Charge -> zwei Kind-Chargen mit kg-Anteilen', () => {
  const parent = Models.createLot({ productId: 'prod_1', weightKg: 100 });
  const result = Trace.planProcessing({
    parents: [{ lotId: parent.id, inputKg: 100 }],
    children: [
      { productId: 'prod_1', weightKg: 60 },
      { productId: 'prod_1', weightKg: 30 }
    ],
    recordedBy: 'op1',
    ts: '2026-02-01T10:00:00.000Z'
  });

  assert.strictEqual(result.childLots.length, 2);
  assert.strictEqual(result.balance.inputSum, 100);
  assert.strictEqual(result.balance.outputSum, 90);
  assert.strictEqual(result.balance.yieldLoss, 10);
  // Zwei Verknuepfungen (ein Parent -> zwei Kinder).
  assert.strictEqual(result.links.length, 2);
  result.links.forEach((l) => assert.strictEqual(l.parentLotId, parent.id));
  // Summe der Link-Anteile entspricht der Gesamt-Ausbeute (Output).
  const shareSum = result.links.reduce((s, l) => s + l.shareKg, 0);
  assert.ok(Math.abs(shareSum - 90) < 1e-6);
  // Kind-Chargen sind als 'verarbeitung' markiert.
  result.childLots.forEach((c) => assert.strictEqual(c.originType, 'verarbeitung'));
  // Je Eltern-Charge ein verarbeitung-Ereignis.
  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(result.events[0].type, 'verarbeitung');
});

test('Merge: zwei Eltern-Chargen -> eine Kind-Charge, Anteile beider Eltern', () => {
  const p1 = Models.createLot({ productId: 'prod_1', weightKg: 40 });
  const p2 = Models.createLot({ productId: 'prod_1', weightKg: 60 });
  const result = Trace.planProcessing({
    parents: [
      { lotId: p1.id, inputKg: 40 },
      { lotId: p2.id, inputKg: 60 }
    ],
    children: [{ productId: 'prod_1', weightKg: 95 }],
    ts: '2026-02-02T10:00:00.000Z'
  });

  assert.strictEqual(result.childLots.length, 1);
  assert.strictEqual(result.balance.inputSum, 100);
  assert.strictEqual(result.balance.outputSum, 95);
  assert.strictEqual(result.balance.yieldLoss, 5);
  // Beide Eltern verlinken auf das eine Kind.
  assert.strictEqual(result.links.length, 2);
  const parents = result.links.map((l) => l.parentLotId).sort();
  assert.deepStrictEqual(parents, [p1.id, p2.id].sort());
  // Proportionale Anteile: 40% und 60% von 95 kg.
  const child = result.childLots[0];
  const byParent = {};
  result.links.forEach((l) => (byParent[l.parentLotId] = l.shareKg));
  assert.ok(Math.abs(byParent[p1.id] - 38) < 0.01, 'Anteil p1 ~ 38 kg');
  assert.ok(Math.abs(byParent[p2.id] - 57) < 0.01, 'Anteil p2 ~ 57 kg');
  result.links.forEach((l) => assert.strictEqual(l.childLotId, child.id));
  // Zwei Eltern -> zwei verarbeitung-Ereignisse.
  assert.strictEqual(result.events.length, 2);
});

test('planProcessing wirft bei Massenbilanz-Verletzung (Output > Input)', () => {
  const parent = Models.createLot({ productId: 'prod_1', weightKg: 100 });
  assert.throws(
    () =>
      Trace.planProcessing({
        parents: [{ lotId: parent.id, inputKg: 50 }],
        children: [{ productId: 'prod_1', weightKg: 80 }]
      }),
    /Massenbilanz verletzt/
  );
});

test('planProcessing verlangt mindestens einen Parent und ein Kind', () => {
  assert.throws(() => Trace.planProcessing({ parents: [], children: [{ productId: 'p', weightKg: 1 }] }), /Eltern-Charge/);
  assert.throws(
    () => Trace.planProcessing({ parents: [{ lotId: 'x', inputKg: 10 }], children: [] }),
    /Kind-Charge/
  );
});
