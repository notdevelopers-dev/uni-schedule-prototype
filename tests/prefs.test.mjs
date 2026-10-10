import test from 'node:test';
import assert from 'node:assert/strict';

// prefs.js читає window.localStorage — даємо мінімальну заміну в пам'яті.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
const { clearPrefs, defaultPrefs, loadPrefs, loadUi, savePrefs, saveUi } = await import('../site/js/prefs.js');

test('за замовчуванням нічого не приховано', () => {
  store.clear();
  const p = loadPrefs();
  assert.deepEqual(p, defaultPrefs());
  assert.deepEqual(p.hiddenElectives, []);
  assert.equal(p.englishTeacher, null);
});

test('міграція v1: «лише мої» відкидаються, сторонні зберігаються', () => {
  store.set('lnu-rozklad:prefs:v1', JSON.stringify({
    version: 1,
    group: { id: 'name:ФЕІ-22с', name: 'ФЕІ-22с' },
    subgroup: 1,
    englishTeacher: { key: 'довбенко лариса василівна', name: 'Довбенко Лариса Василівна' },
    electives: [
      { titleKey: 'основи wеb технологій', title: 'Основи web технологій', teacherKey: null, external: false },
      { titleKey: 'укр мова', title: 'Українська мова', teacherKey: 'щепанська христина андріївна', teacherName: 'Щепанська Х. А.', external: true },
    ],
  }));
  const p = loadPrefs();
  assert.equal(p.version, 2);
  assert.equal(p.subgroup, 1);
  assert.equal(p.englishTeacher.key, 'довбенко лариса василівна');
  assert.deepEqual(p.hiddenElectives, []);
  assert.deepEqual(p.externalElectives.map((e) => e.titleKey), ['укр мова']);
  assert.ok(!('electives' in p));
});

test('зіпсовані записи не ламають завантаження', () => {
  store.set('lnu-rozklad:prefs:v1', JSON.stringify({ hiddenElectives: [null, 5, { titleKey: 'x', teacherKey: 7 }], externalElectives: [{ titleKey: 'y' }] }));
  const p = loadPrefs();
  assert.deepEqual(p.hiddenElectives, [{ titleKey: 'x', title: 'x', teacherKey: null, teacherName: null }]);
  assert.deepEqual(p.externalElectives, [], 'стороння дисципліна без викладача не має сенсу');
  store.set('lnu-rozklad:prefs:v1', '{не json');
  assert.deepEqual(loadPrefs(), defaultPrefs());
});

test('збереження й повторне читання', () => {
  store.clear();
  const p = { ...defaultPrefs(), hiddenElectives: [{ titleKey: 'a', title: 'A', teacherKey: 'b', teacherName: 'B' }] };
  assert.equal(savePrefs(p), true);
  assert.deepEqual(loadPrefs(), p);
});

test('тема: за замовчуванням як у системі, сміття ігнорується', () => {
  store.clear();
  assert.equal(loadUi().theme, null);
  saveUi({ ...loadUi(), theme: 'dark' });
  assert.equal(loadUi().theme, 'dark');
  store.set('lnu-rozklad:ui:v1', JSON.stringify({ theme: 'purple' }));
  assert.equal(loadUi().theme, null);
});

test('«Скинути мій вибір» не скидає тему', () => {
  store.clear();
  savePrefs({ ...defaultPrefs(), subgroup: 2 });
  saveUi({ ...loadUi(), theme: 'light', view: 'week' });
  clearPrefs();
  assert.deepEqual(loadPrefs(), defaultPrefs());
  assert.equal(loadUi().theme, 'light');
  assert.equal(loadUi().view, null, 'решта налаштувань інтерфейсу скидається, як і раніше');
});
