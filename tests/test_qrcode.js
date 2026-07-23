'use strict';

// Testet den lokalen QR-Generator strukturell (ohne externen Decoder):
// korrekte Matrixgroesse, vorhandene Finder-Muster, Determinismus und
// Versionswahl nach Nutzdatenlaenge.

const test = require('node:test');
const assert = require('node:assert');

const QR = require('../js/qrcode.js');

test('toModules erzeugt eine quadratische Matrix aus 0/1', () => {
  const qr = QR.toModules('LOT-12345');
  assert.strictEqual(qr.size, qr.modules.length);
  qr.modules.forEach((row) => {
    assert.strictEqual(row.length, qr.size);
    row.forEach((cell) => assert.ok(cell === 0 || cell === 1));
  });
  // Kurzer Text passt in Version 1 (21x21).
  assert.strictEqual(qr.version, 1);
  assert.strictEqual(qr.size, 21);
});

test('Finder-Muster sitzen in den drei Ecken', () => {
  const qr = QR.toModules('LOT-12345');
  const m = qr.modules;
  const n = qr.size;

  function checkFinder(oy, ox) {
    // Aeussere Kante des 7x7-Finders komplett dunkel.
    for (let i = 0; i < 7; i++) {
      assert.strictEqual(m[oy][ox + i], 1, 'obere Kante');
      assert.strictEqual(m[oy + 6][ox + i], 1, 'untere Kante');
      assert.strictEqual(m[oy + i][ox], 1, 'linke Kante');
      assert.strictEqual(m[oy + i][ox + 6], 1, 'rechte Kante');
    }
    // Heller Ring (Position 1,1) und dunkler 3x3-Kern (Position 3,3).
    assert.strictEqual(m[oy + 1][ox + 1], 0);
    assert.strictEqual(m[oy + 3][ox + 3], 1);
  }

  checkFinder(0, 0); // oben links
  checkFinder(0, n - 7); // oben rechts
  checkFinder(n - 7, 0); // unten links
});

test('Timing-Muster alterniert auf Zeile/Spalte 6', () => {
  const qr = QR.toModules('LOT-12345');
  const m = qr.modules;
  for (let i = 8; i < qr.size - 8; i++) {
    assert.strictEqual(m[6][i], i % 2 === 0 ? 1 : 0);
    assert.strictEqual(m[i][6], i % 2 === 0 ? 1 : 0);
  }
});

test('gleicher Text ergibt identische Matrix (deterministisch)', () => {
  const a = QR.toModules('charge://lot_xyz');
  const b = QR.toModules('charge://lot_xyz');
  assert.deepStrictEqual(a.modules, b.modules);
});

test('laengere Nutzdaten erhoehen die Version', () => {
  const long = QR.toModules('X'.repeat(60));
  assert.ok(long.version > 1);
  assert.strictEqual(long.size, long.version * 4 + 17);
});

test('toSvgString liefert einen eigenstaendigen SVG-String', () => {
  const svg = QR.toSvgString('LOT-1');
  assert.ok(svg.indexOf('<svg') === 0);
  assert.ok(svg.indexOf('</svg>') !== -1);
  assert.ok(svg.indexOf('<path') !== -1);
});

test('zu lange Nutzdaten werden abgewiesen', () => {
  assert.throws(() => QR.toModules('Y'.repeat(500)), /zu lang/);
});
