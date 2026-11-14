import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
function method(name, next) {
  return source.slice(source.indexOf(`  ${name}(`), source.indexOf(next === 'handleShare' ? `  async ${next}(` : `  ${next}(`, source.indexOf(`  ${name}(`)));
}
function uiFor(code, globals = {}) {
  const ui = vm.runInNewContext(`new (class { ${code} })()`, globals);
  ui.elements = { birthdateInput: { value: '2000-01-01' } };
  return ui;
}
test('guest calculate retains date in live input without writing browser storage', () => {
  const result = { day: 4 };
  const fail = () => { throw new Error('Unexpected storage access'); };
  const ui = uiFor(method('handleCalculate', 'displayResult'), {
    calculateSineDayForTimezone: () => result,
    localStorage: { getItem: fail, setItem: fail }, sessionStorage: { getItem: fail, setItem: fail }
  });
  ui.displayResult = actual => assert.equal(actual, result);
  ui.handleCalculate(); ui.handleCalculate();
  assert.equal(ui.elements.birthdateInput.value, '2000-01-01');
});
test('cleanup removes only legacy guest date and clears live input', () => {
  const values = new Map([['sineday_birthdate', '2000-01-01'], ['account-data', 'preserve']]);
  const ui = uiFor(method('clearGuestBirthdate', 'handleShare'), { localStorage: { removeItem: key => values.delete(key) } });
  ui.currentDay = { day: 4 };
  ui.clearGuestBirthdate(); ui.clearGuestBirthdate();
  assert.equal(ui.elements.birthdateInput.value, '');
  assert.equal(ui.currentDay, null);
  assert.deepEqual([...values], [['account-data', 'preserve']]);
});
test('blocked storage cannot prevent guest cleanup', () => {
  const ui = uiFor(method('clearGuestBirthdate', 'handleShare'), { localStorage: { removeItem() { throw new Error('blocked'); } } });
  assert.doesNotThrow(() => ui.clearGuestBirthdate());
  assert.equal(ui.elements.birthdateInput.value, '');
});
test('initialization and page lifecycle clear dates including back-forward cache', () => {
  const listeners = {};
  const ui = uiFor(method('init', 'initHeroDepth'), { window: { addEventListener: (name, fn) => { listeners[name] = fn; } } });
  let cleared = 0, reset = 0;
  Object.assign(ui, { bindEvents() {}, initHeroDepth() {}, showInput() {}, clearGuestBirthdate() { cleared++; }, resetToInput() { reset++; } });
  ui.init();
  assert.equal(cleared, 1);
  listeners.pagehide(); assert.equal(cleared, 2);
  listeners.pageshow({ persisted: false }); assert.equal(reset, 0);
  listeners.pageshow({ persisted: true }); assert.equal(reset, 1);
  assert.doesNotMatch(source, /loadSavedBirthdate|saveBirthdate/);
  assert.match(source, /removeEventListener\('pagehide', this\._onGuestPageHide\)/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="birthdate-input"\s+autocomplete="off"/);
});
