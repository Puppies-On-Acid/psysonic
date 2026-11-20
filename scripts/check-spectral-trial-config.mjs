// Keep Spectral AutoDJ's experimental Tauri profile distinct from the
// ordinary installed/daily-drive application. No file or config is changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const trial = JSON.parse(readFileSync(new URL('../src-tauri/tauri.spectral-trial.conf.json', import.meta.url), 'utf8'));

assert.equal(typeof trial.identifier, 'string');
assert.equal(typeof base.identifier, 'string');
assert.notEqual(trial.identifier, base.identifier, 'Trial must never share the ordinary app identifier');
assert.match(trial.identifier, /^dev\.psysonic\.player\.spectraltrial$/);
assert.notEqual(trial.productName, base.productName);
assert.deepEqual(
  Object.keys(trial).sort(),
  ['$schema', 'bundle', 'identifier', 'productName'].sort(),
  'Trial config may override identity and dev icons only; do not persist production settings here',
);
assert.deepEqual(trial.bundle.icon, [
  'icons/32x32.png', 'icons/128x128.png',
  'icons/128x128@2x.png', 'icons/icon.ico',
]);
console.log('Spectral live-trial Tauri profile identity is isolated from normal Psysonic.');
