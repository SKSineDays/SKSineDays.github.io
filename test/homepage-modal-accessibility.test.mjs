import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
function method(name, next) {
  return source.slice(source.indexOf(`  ${name}(`), source.indexOf(`  ${next}(`, source.indexOf(`  ${name}(`)));
}
function element(tagName, ariaHidden = null, supportsInert = true) {
  let value = ariaHidden;
  return { tagName, ...(supportsInert ? { inert: false } : {}), getAttribute: () => value,
    setAttribute: (_, next) => { value = next; }, removeAttribute: () => { value = null; } };
}
test('About modal isolates every background sibling and preserves prior state', () => {
  const modal = element('DIV');
  const header = element('HEADER');
  const footer = element('FOOTER');
  const skip = element('A');
  const alreadyInert = element('DIV'); alreadyInert.inert = true;
  const hidden = element('DIV', 'true', false);
  const fallback = element('MAIN', null, false);
  const script = element('SCRIPT');
  const document = { body: { children: [skip, header, footer, alreadyInert, hidden, fallback, modal, script] } };
  const ui = vm.runInNewContext(`new (class { ${method('setAppInert', 'handleModalKeydown')} })()`, { document });
  ui.elements = { infoModal: modal };
  ui.setAppInert(true);
  assert.ok(header.inert && footer.inert && skip.inert);
  assert.equal(modal.inert, false);
  assert.equal(script.inert, false);
  assert.equal(fallback.getAttribute('aria-hidden'), 'true');
  ui.setAppInert(true);
  ui.setAppInert(false);
  assert.equal(header.inert, false);
  assert.equal(footer.inert, false);
  assert.equal(skip.inert, false);
  assert.equal(alreadyInert.inert, true);
  assert.equal(hidden.getAttribute('aria-hidden'), 'true');
  assert.equal(fallback.getAttribute('aria-hidden'), null);
  ui.setAppInert(false);
  assert.equal(alreadyInert.inert, true);
});
test('reopening an open About modal does not overwrite focus or install another handler', () => {
  const ui = vm.runInNewContext(`new (class { ${method('openInfoModal', 'closeInfoModal')} })()`, {});
  ui.elements = { infoModal: {} };
  ui._modalOpen = true;
  const opener = {};
  ui._lastFocus = opener;
  assert.doesNotThrow(() => ui.openInfoModal());
  assert.equal(ui._lastFocus, opener);
});
