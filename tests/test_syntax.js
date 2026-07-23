'use strict';

// Fuehrt fuer JEDE Datei in js/ `node --check` aus (Syntaxpruefung ohne
// Ausfuehrung). Schlaegt fehl, sobald ein Modul einen Syntaxfehler enthaelt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const jsDir = path.join(__dirname, '..', 'js');

test('node --check laeuft fuer jede js/-Datei fehlerfrei', () => {
  const files = fs
    .readdirSync(jsDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  assert.ok(files.length > 0, 'es muessen js-Dateien vorhanden sein');

  files.forEach((file) => {
    const full = path.join(jsDir, file);
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    }, 'Syntaxfehler in ' + file);
  });
});
