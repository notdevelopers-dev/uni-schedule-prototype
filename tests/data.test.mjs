import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildIndex } from '../site/js/data/static-repository.js';
import { exportStatus } from '../site/js/data/psrozklad.js';
import { normalizeRozItem, mergeAcrossGroups } from '../site/js/domain/lessons.js';
import { addExternal, buildCatalog, filterForUser, makeClassifier } from '../site/js/domain/electives.js';
import { KNOWN_ISSUES, issuesFor } from '../site/js/known-issues.js';

const data = JSON.parse(readFileSync(new URL('./fixtures/sample-export.json', import.meta.url), 'utf8'));

const item = (over = {}) => ({
  object: 'ФЕІ-21с', date: '28.09.2026', comment: '', lesson_number: '2', lesson_name: '2',
  lesson_time: '10:10-11:30', half: '', teacher: 'доцент Цибуляк Богдан Зіновійович', teachers_add: '',
  room: '№8/Б', group: '(підгр. 1)', title: 'Організація баз даних та знань', type: 'Лаб',
  replacement: '', reservation: '', online: '', comment4link: '', link: '', ...over,
});

test('exportStatus: коди помилок деканату', () => {
  assert.equal(exportStatus('0').ok, true);
  assert.equal(exportStatus('-4').status, 'empty');
  assert.equal(exportStatus('-4').ok, true);
  assert.equal(exportStatus('-2').keepPrevious, true);
  assert.equal(exportStatus('-3').status, 'closed');
  assert.equal(exportStatus('-8').status, 'paused');
  assert.equal(exportStatus('-70').status, 'error');
  assert.equal(exportStatus('-99').ok, false);
});

test('normalizeRozItem: звичайна пара', () => {
  const l = normalizeRozItem(item());
  assert.equal(l.date, '2026-09-28');
  assert.equal(l.number, 2);
  assert.equal(l.start, '10:10');
  assert.equal(l.room.label, '№8/Б');
  assert.equal(l.teacher.short, 'Цибуляк Б. З.');
  assert.deepEqual(l.audience.subgroups, [1]);
  assert.deepEqual(l.groups, ['ФЕІ-21с']);
  assert.equal(l.kind, 'lesson');
  assert.equal(l.id, normalizeRozItem(item()).id, 'id стабільний');
});

test('normalizeRozItem: бронювання і слот без назви', () => {
  const reserved = normalizeRozItem(item({ title: '', teacher: '', room: '', group: '', type: '', reservation: 'Основи національного спротиву' }));
  assert.equal(reserved.kind, 'reserved');
  assert.equal(reserved.teacher, null);
  assert.equal(reserved.room, null);
  const untitled = normalizeRozItem(item({ title: '', teacher: '', room: '', group: '', type: '' }));
  assert.equal(untitled.kind, 'untitled');
});

test('mergeAcrossGroups: потокова лекція з кількох груп — одна пара', () => {
  const a = normalizeRozItem(item({ object: 'ФЕІ-21с', group: 'Потік', type: 'Л', room: ' 1/Б' }));
  const b = normalizeRozItem(item({ object: 'ФЕІ-22с', group: 'Потік', type: 'Л', room: ' 1/Б' }));
  const merged = mergeAcrossGroups([a, b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].groups, ['ФЕІ-21с', 'ФЕІ-22с']);
});

test('buildIndex на тестовому data.json', () => {
  const idx = buildIndex(data);
  assert.equal(idx.groups.size, 1);
  const [group] = idx.groups.values();
  assert.equal(group.name, 'ФЕІ-22с');
  assert.equal(group.status, 'ok');
  assert.equal(idx.groupLessons.get(group.id).length, 23);
  assert.deepEqual(idx.meta.range, { from: '2026-09-28', to: '2026-10-04' });
  assert.equal(idx.meta.coverage.complete, false);
  assert.equal(idx.meta.coverage.groupsTotal, null);
  assert.deepEqual(idx.meta.bells.map((b) => b.start), ['08:30', '10:10', '11:50', '13:30']);

  // «N10/Б» і «№10/Б» — одна аудиторія; « 1/Б» з NBSP нормалізовано.
  assert.ok(idx.rooms.has('№10/б'));
  assert.ok(idx.rooms.has('1/б'));
  assert.equal(idx.roomIndex.get('1/б').length, 5);
  // «Горон.» і «Горон» — один викладач.
  assert.equal(idx.teacherIndex.get('горон богдан ігорович').length, 2);
});

test('buildIndex: пакет зі списком груп і кодами помилок', () => {
  const bundle = {
    format: 'lnu-rozklad-bundle/1',
    generated_at: '2026-09-26T06:00:00Z',
    range: { from: '01.09.2026', to: '31.12.2026' },
    lists: {
      group: { psrozklad_export: { departments: [{ name: 'Факультет електроніки та комп`ютерних технологій', objects: [
        { name: 'ФЕІ-21с', ID: '-503' }, { name: 'ФЕІ-22с', ID: '-504' }, { name: 'ФЕІ-23с', ID: '-505' },
      ] }], code: '0' } },
      teacher: { psrozklad_export: { departments: [{ name: 'Кафедра іноземних мов', objects: [{ name: 'Довбенко Лариса Василівна', ID: '-7' }] }], code: '0' } },
    },
    schedules: [
      { mode: 'group', id: '-503', name: 'ФЕІ-21с', export: { psrozklad_export: { roz_items: [item()], code: '0' } } },
      { mode: 'group', id: '-504', name: 'ФЕІ-22с', export: { psrozklad_export: { roz_items: [], code: '-2' } } },
      { mode: 'teacher', id: '-9', name: 'Демків Лідія Степанівна', export: { psrozklad_export: { roz_items: [
        item({ object: 'Демків Лідія Степанівна', teacher: '', group: 'Збірна група', title: 'Основи web технологій', type: 'Л', date: '29.09.2026', lesson_number: '3', lesson_time: '11:50-13:10', room: ' 3/Б' }),
      ], code: '0' } } },
    ],
  };
  const idx = buildIndex(bundle);
  assert.equal(idx.meta.format, 'bundle');
  assert.deepEqual(idx.meta.range, { from: '2026-09-01', to: '2026-12-31' });
  assert.equal(idx.groups.get('-503').faculty, 'Факультет електроніки та компʼютерних технологій');
  assert.equal(idx.groups.get('-504').status, 'closed');
  assert.equal(idx.groups.get('-505').status, 'missing');
  assert.equal(idx.meta.coverage.groupsTotal, 3);
  assert.equal(idx.meta.coverage.groupsLoaded, 1);
  assert.equal(idx.meta.coverage.complete, false);
  assert.equal(idx.teachers.get('довбенко лариса василівна').department, 'Кафедра іноземних мов');
  // Розклад викладача з пакета: пара, якої немає в жодному груповому розкладі.
  const demkiv = idx.teacherIndex.get('демків лідія степанівна');
  assert.equal(demkiv.length, 1);
  assert.equal(demkiv[0].teacher.name, 'Демків Лідія Степанівна');
});

test('filterForUser: «Збірна група» показується вся, доки її не приховано', () => {
  const idx = buildIndex(data);
  const [group] = idx.groups.values();
  const lessons = idx.groupLessons.get(group.id);
  const classify = makeClassifier();
  const base = { subgroup: 1, englishTeacher: null, hiddenElectives: [], externalElectives: [] };
  const mixedOf = (res) => res.visible.filter((l) => l.audience.kind === 'mixed');

  const plain = filterForUser(lessons, base, classify);
  assert.equal(mixedOf(plain).length, 10, 'за замовчуванням видно всі 10 записів «Збірна група»');
  assert.equal(plain.hidden.length, 0);
  assert.ok(plain.visible.every((l) => l.audience.kind !== 'subgroup' || l.audience.subgroups.includes(1)));
  assert.ok(plain.visible.some((l) => l.kind === 'reserved'), 'бронювання показуються');
  assert.ok(mixedOf(plain).filter((l) => l.title === 'Іноземна мова').every((l) => l.why === 'language-any'));

  const chosen = filterForUser(lessons, {
    ...base,
    englishTeacher: { key: 'довбенко лариса василівна', name: '' },
    hiddenElectives: [
      { titleKey: 'створення власного бізнесу', teacherKey: null },
      { titleKey: 'веб програмування на стороні сервера', teacherKey: 'чмихало олександр сергійович' },
    ],
  }, classify);
  const english = mixedOf(chosen).filter((l) => l.title === 'Іноземна мова');
  assert.equal(english.length, 2);
  assert.ok(english.every((l) => l.teacher.key === 'довбенко лариса василівна' && l.why === 'language'));
  assert.ok(!mixedOf(chosen).some((l) => l.titleKey === 'створення власного бізнесу'));
  const web = mixedOf(chosen).filter((l) => l.titleKey === 'веб програмування на стороні сервера');
  assert.deepEqual(web.map((l) => l.teacher.short), ['Гусак О. В.'], 'прихована лише секція Чмихала');
  assert.equal(mixedOf(chosen).filter((l) => l.titleKey === 'основи wеb технологій').length, 1);
  // Приховане: 4 пари інших викладачів іноземної + «Створення бізнесу» + секція Чмихала.
  assert.equal(chosen.hidden.length, 6);
  assert.deepEqual([...new Set(chosen.hidden.map((l) => l.why))].sort(), ['hidden-by-user', 'other-language-teacher']);

  const allSubgroups = filterForUser(lessons, { ...base, subgroup: null }, classify);
  assert.equal(allSubgroups.visible.filter((l) => l.audience.kind === 'subgroup').length, 6);
});

test('buildCatalog і addExternal', () => {
  const idx = buildIndex(data);
  const [group] = idx.groups.values();
  const lessons = idx.groupLessons.get(group.id);
  const catalog = buildCatalog(lessons, makeClassifier());
  assert.deepEqual(catalog.languages.map((l) => l.title), ['Іноземна мова']);
  assert.equal(catalog.languages[0].teachers.length, 3);
  // «Веб програмування…» є в розкладі ще й лекцією потоком — це звичайна дисципліна з двома викладачами, не ДВВС.
  assert.deepEqual(catalog.sections.map((e) => e.title), ['Веб програмування на стороні сервера']);
  assert.equal(catalog.sections[0].teachers.length, 2);
  assert.deepEqual(catalog.electives.map((e) => e.title), ['Основи web технологій', 'Створення власного бізнесу']);
  assert.ok(catalog.electives.every((e) => e.likelyDvvs));

  const [first] = lessons;
  const merged = addExternal([first], [first, { ...first, id: 'x', date: '2026-10-05' }]);
  assert.equal(merged.length, 2, 'дубль тієї самої пари не додається');
  assert.equal(merged[1].why, 'external');
});

test('відомі проблеми позначають відповідні пари', () => {
  const idx = buildIndex(data);
  const [group] = idx.groups.values();
  const lessons = idx.groupLessons.get(group.id);
  const flagged = lessons.filter((l) => issuesFor(l).length);
  assert.equal(flagged.length, 2, 'обидва бронювання «Основ національного спротиву»');
  assert.ok(flagged.every((l) => l.kind === 'reserved' && issuesFor(l)[0].id === 'ons-time'));
  assert.equal(new Set(KNOWN_ISSUES.map((i) => i.id)).size, KNOWN_ISSUES.length, 'id унікальні');
});
