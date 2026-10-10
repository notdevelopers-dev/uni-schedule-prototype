import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBundle, dateRange, filterGroupList, listObjects, matchesPrefix, rozkladUrl, sameContent, DEFAULT_PREFIXES,
} from '../scripts/fetch-schedule.mjs';
import { buildIndex } from '../site/js/data/static-repository.js';

const objList = {
  psrozklad_export: {
    departments: [
      { name: 'Факультет електроніки та комп. технологій', objects: [
        { name: 'ФЕІ-21с', ID: '-503' }, { name: 'ФЕІ-22с', ID: '-504' }, { name: 'ФЕI-25c', ID: '-510' },
        { name: 'ФЕІ-215', ID: '-600' }, { name: 'ФЕІ-11с', ID: '-400' }, { name: 'ФЕС-21с', ID: '-700' },
      ] },
      { name: 'Хімічний факультет', objects: [{ name: 'ХМХ-21с', ID: '-900' }] },
    ],
    code: '0',
  },
};

const item = (over = {}) => ({
  object: 'ФЕІ-21с', date: '12.10.2026', comment: '', lesson_number: '1', lesson_name: '1', lesson_time: '08:30-09:50',
  half: '', teacher: 'доцент Горон Богдан Ігорович', teachers_add: '', room: '№8/Б', group: '', title: 'Фізика', type: 'Л',
  replacement: '', reservation: '', online: '', comment4link: '', link: '', ...over,
});
const exp = (code, items = []) => ({ psrozklad_export: { roz_items: items, code } });
const range = { from: '2026-10-12', to: '2026-11-15' };

test('matchesPrefix: курс і номер групи, латинські двійники, без хибних збігів', () => {
  assert.ok(matchesPrefix('ФЕІ-21с', DEFAULT_PREFIXES));
  assert.ok(matchesPrefix('ФЕІ-25м', DEFAULT_PREFIXES));
  assert.ok(matchesPrefix('ФЕI-25c', DEFAULT_PREFIXES));
  assert.ok(matchesPrefix('ФЕІ 23с', DEFAULT_PREFIXES));
  assert.ok(!matchesPrefix('ФЕІ-215', DEFAULT_PREFIXES));
  assert.ok(!matchesPrefix('ФЕІ-11с', DEFAULT_PREFIXES));
  assert.ok(!matchesPrefix('ФЕС-21с', DEFAULT_PREFIXES));
});

test('filterGroupList: лише потрібні групи, ID — рядки', () => {
  const filtered = filterGroupList(objList, DEFAULT_PREFIXES);
  assert.equal(filtered.psrozklad_export.departments.length, 1);
  assert.deepEqual(listObjects(filtered).map((g) => g.id), ['-503', '-504', '-510']);
});

test('dateRange: поточний тиждень з понеділка + 4 тижні', () => {
  assert.deepEqual(dateRange('2026-10-12', 4), { from: '2026-10-12', to: '2026-11-15' });
  assert.deepEqual(dateRange('2026-10-10', 4), { from: '2026-10-05', to: '2026-11-08' });
});

test('rozkladUrl: параметри деканату', () => {
  const u = new URL(rozkladUrl({ id: '-503', ...range }));
  assert.equal(u.searchParams.get('req_type'), 'rozklad');
  assert.equal(u.searchParams.get('req_mode'), 'group');
  assert.equal(u.searchParams.get('OBJ_ID'), '-503');
  assert.equal(u.searchParams.get('begin_date'), '12.10.2026');
  assert.equal(u.searchParams.get('end_date'), '15.11.2026');
  assert.equal(u.searchParams.get('ros_text'), 'separated');
  assert.equal(u.searchParams.get('req_format'), 'json');
  assert.equal(u.searchParams.get('coding_mode'), 'UTF8');
});

test('buildBundle: -2/-3/-8/-70 і збій мережі не затирають попередній знімок', () => {
  const groupList = filterGroupList(objList, DEFAULT_PREFIXES);
  const previous = {
    format: 'lnu-rozklad-bundle/1',
    schedules: [
      { mode: 'group', id: '-504', name: 'ФЕІ-22с', fetched_at: 'old', export: exp('0', [item({ object: 'ФЕІ-22с' })]) },
      { mode: 'group', id: '-510', name: 'ФЕI-25c', fetched_at: 'old', export: exp('0', [item({ object: 'ФЕI-25c' })]) },
    ],
  };
  const { bundle } = buildBundle({
    generatedAt: 'now', range, groupList, previous,
    results: [
      { id: '-503', name: 'ФЕІ-21с', fetchedAt: 'now', export: exp('0', [item()]) },
      { id: '-504', name: 'ФЕІ-22с', fetchedAt: 'now', export: exp('-8') },
      { id: '-510', name: 'ФЕI-25c', fetchedAt: 'now', error: 'timeout' },
    ],
  });
  assert.equal(bundle.range.from, '12.10.2026');
  assert.equal(bundle.schedules[0].fetched_at, 'now');
  assert.equal(bundle.schedules[1].fetched_at, 'old');
  assert.equal(bundle.schedules[2].fetched_at, 'old');

  const idx = buildIndex(bundle);
  assert.equal(idx.meta.coverage.groupsTotal, 3);
  assert.equal(idx.meta.coverage.groupsLoaded, 3);
  assert.deepEqual(idx.meta.range, range);
});

test('buildBundle: -4 — це «пар немає», а не помилка; без попереднього знімка помилка лишається видимою', () => {
  const groupList = filterGroupList(objList, DEFAULT_PREFIXES);
  const { bundle } = buildBundle({
    generatedAt: 'now', range, groupList, previous: null,
    results: [
      { id: '-503', name: 'ФЕІ-21с', fetchedAt: 'now', export: exp('-4') },
      { id: '-504', name: 'ФЕІ-22с', fetchedAt: 'now', export: exp('-3') },
    ],
  });
  const idx = buildIndex(bundle);
  const byName = new Map([...idx.groups.values()].map((g) => [g.name, g]));
  assert.equal(byName.get('ФЕІ-21с').status, 'empty');
  assert.equal(byName.get('ФЕІ-22с').status, 'closed');
});

test('sameContent: час збору не рахується за зміну', () => {
  const a = { format: 'x', generated_at: '1', schedules: [{ id: '1', fetched_at: '1', export: exp('0') }] };
  const b = { format: 'x', generated_at: '2', schedules: [{ id: '1', fetched_at: '2', export: exp('0') }] };
  assert.ok(sameContent(a, b));
  assert.ok(!sameContent(a, { ...b, schedules: [{ id: '1', export: exp('0', [item()]) }] }));
});
