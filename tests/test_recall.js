'use strict';

// Testet die Rueckruf-Simulation: fuer eine Charge werden in einem Aufruf
// alle Vorfahren, alle Nachkommen und alle Geschwister korrekt bestimmt.

const test = require('node:test');
const assert = require('node:assert');

const Models = require('../js/models.js');
const Trace = require('../js/trace.js');

// Lineage:
//   GP1 --\
//          >-- P --< C1
//   GP2 --/        \  C2
//                   \ C3
// (Merge GP1+GP2 -> P, danach Split P -> C1/C2/C3)
function buildLineage() {
  const GP1 = Models.createLot({ id: 'GP1', productId: 'prod_1', weightKg: 50 });
  const GP2 = Models.createLot({ id: 'GP2', productId: 'prod_1', weightKg: 50 });
  const P = Models.createLot({ id: 'P', productId: 'prod_1', weightKg: 95, originType: 'verarbeitung' });
  const C1 = Models.createLot({ id: 'C1', productId: 'prod_1', weightKg: 30, originType: 'verarbeitung' });
  const C2 = Models.createLot({ id: 'C2', productId: 'prod_1', weightKg: 30, originType: 'verarbeitung' });
  const C3 = Models.createLot({ id: 'C3', productId: 'prod_1', weightKg: 30, originType: 'verarbeitung' });
  const lots = [GP1, GP2, P, C1, C2, C3];
  const links = [
    Models.createLotLink({ parentLotId: 'GP1', childLotId: 'P', shareKg: 47.5 }),
    Models.createLotLink({ parentLotId: 'GP2', childLotId: 'P', shareKg: 47.5 }),
    Models.createLotLink({ parentLotId: 'P', childLotId: 'C1', shareKg: 30 }),
    Models.createLotLink({ parentLotId: 'P', childLotId: 'C2', shareKg: 30 }),
    Models.createLotLink({ parentLotId: 'P', childLotId: 'C3', shareKg: 30 })
  ];
  return { lots, links };
}

function ids(list) {
  return list.map((x) => x.lotId).sort();
}

test('Rueckruf auf verkaufte Kind-Charge findet Vorfahren, Geschwister, keine Nachkommen', () => {
  const { lots, links } = buildLineage();
  const recall = Trace.recallSimulation('C1', lots, links);

  // Vorfahren: direkter Parent P plus dessen Eltern GP1, GP2.
  assert.deepStrictEqual(ids(recall.ancestors), ['GP1', 'GP2', 'P']);
  // Geschwister: gleiche Eltern (P) -> C2, C3, ohne C1 selbst.
  assert.deepStrictEqual(ids(recall.siblings), ['C2', 'C3']);
  // C1 hat keine Nachkommen.
  assert.deepStrictEqual(ids(recall.descendants), []);
  // Betroffene kg werden mitgeliefert.
  const c2 = recall.siblings.find((s) => s.lotId === 'C2');
  assert.strictEqual(c2.weightKg, 30);
});

test('Rueckruf auf Zwischen-Charge liefert Nachkommen und Vorfahren', () => {
  const { lots, links } = buildLineage();
  const recall = Trace.recallSimulation('P', lots, links);

  assert.deepStrictEqual(ids(recall.descendants), ['C1', 'C2', 'C3']);
  assert.deepStrictEqual(ids(recall.ancestors), ['GP1', 'GP2']);
  // P ist einziges Kind von GP1/GP2 -> keine Geschwister.
  assert.deepStrictEqual(ids(recall.siblings), []);
});

test('Rueckruf auf Wurzel-Charge liefert alle Nachkommen transitiv', () => {
  const { lots, links } = buildLineage();
  const recall = Trace.recallSimulation('GP1', lots, links);

  // GP1 -> P -> C1/C2/C3 (transitiv abwaerts).
  assert.deepStrictEqual(ids(recall.descendants), ['C1', 'C2', 'C3', 'P']);
  assert.deepStrictEqual(ids(recall.ancestors), []);
  // GP2 ist Geschwister (teilt Kind P? nein) -> GP1/GP2 haben keine gemeinsamen Eltern.
  assert.deepStrictEqual(ids(recall.siblings), []);
});

test('Rueckruf auf unbekannte Charge wirft', () => {
  const { lots, links } = buildLineage();
  assert.throws(() => Trace.recallSimulation('XYZ', lots, links), /nicht gefunden/);
});
