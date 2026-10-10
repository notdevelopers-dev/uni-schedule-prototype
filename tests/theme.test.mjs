import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTheme } from '../site/js/theme.js';

// Мінімальна заміна document: <html> зі style і два meta theme-color, як в index.html.
function fakeDoc() {
  const style = { colorScheme: '', removeProperty(name) { if (name === 'color-scheme') this.colorScheme = ''; } };
  const meta = (media) => {
    const attrs = { media };
    return { dataset: {}, getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; }, attrs };
  };
  const metas = [meta('(prefers-color-scheme: light)'), meta('(prefers-color-scheme: dark)')];
  return { documentElement: { style }, querySelectorAll: () => metas, metas };
}

test('applyTheme: явна тема ставить color-scheme і вмикає відповідний колір рядка браузера', () => {
  const doc = fakeDoc();
  applyTheme('dark', doc);
  assert.equal(doc.documentElement.style.colorScheme, 'dark');
  assert.deepEqual(doc.metas.map((m) => m.attrs.media), ['not all', 'all']);
  applyTheme('light', doc);
  assert.equal(doc.documentElement.style.colorScheme, 'light');
  assert.deepEqual(doc.metas.map((m) => m.attrs.media), ['all', 'not all']);
});

test('applyTheme: «як у системі» повертає все як було', () => {
  const doc = fakeDoc();
  applyTheme('dark', doc);
  applyTheme(null, doc);
  assert.equal(doc.documentElement.style.colorScheme, '');
  assert.deepEqual(doc.metas.map((m) => m.attrs.media), ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
  applyTheme('purple', doc);
  assert.equal(doc.documentElement.style.colorScheme, '', 'невідоме значення = як у системі');
});
