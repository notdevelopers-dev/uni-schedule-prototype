// Режими «Аудиторія» і «Викладач»: пошук об'єкта + його пари за день/тиждень.

import { addDays, isIsoDate, todayIso } from '../lib/dates.js';
import { matchesQuery, plural, searchKey } from '../lib/text.js';
import { pushRecent } from '../prefs.js';
import { append, h, icon, replaceChildren } from './dom.js';
import { href } from './router.js';
import {
  attachSwipe, coverageNotice, dataFooter, dayBlock, notice, pickView, toolbar, viewSwitch, weekBlock, weekRange,
} from './schedule.js';

const LIST_LIMIT = 80;

const KINDS = {
  rooms: {
    title: 'Аудиторії',
    placeholder: 'Аудиторія, напр. 129а або 8/Б',
    recentKey: 'recentRooms',
    list: (repo) => repo.listRooms(),
    get: (repo, key, range) => repo.getRoomSchedule(key, range),
    pick: (res) => res.room,
    label: (room) => room.label,
    // «№10/Б» знаходиться і як «10/б», і як «n10» (так його часто пишуть у даних і в пошуку).
    haystack: (room) => searchKey(`${room.label} ${room.label.replace('№', '')} ${room.lab ? room.label.replace('№', 'N') : ''} ${room.buildingName ?? ''}`),
    group: (room) => room.buildingName || (room.building ? `Корпус ${room.building}` : 'Без корпусу'),
    sort: (a, b) => a.label.localeCompare(b.label, 'uk', { numeric: true }),
    row: (room) => [h('strong', null, room.label), room.lab ? h('span', { class: 'muted' }, ' лабораторія') : null],
    what: 'Тут видно не всі пари.',
    // Верхня панель: [назва, підпис]; head — окремий заголовок на сторінці, коли назва в панелі скорочена.
    top: (room) => [`Аудиторія ${room.label}`, room.buildingName || (room.building ? `корпус ${room.building}` : '')],
    head: () => null,
    mode: 'room',
  },
  teachers: {
    title: 'Викладачі',
    placeholder: 'Прізвище викладача',
    recentKey: 'recentTeachers',
    list: (repo) => repo.listTeachers(),
    get: (repo, key, range) => repo.getTeacherSchedule(key, range),
    pick: (res) => res.teacher,
    label: (t) => t.short,
    haystack: (t) => searchKey(`${t.name} ${t.department ?? ''}`),
    group: (t) => t.department || null,
    sort: (a, b) => a.name.localeCompare(b.name, 'uk'),
    row: (t) => [h('strong', null, t.name), t.position || t.department ? h('span', { class: 'muted block' }, [t.position, t.department].filter(Boolean).join(' · ')) : null],
    what: 'Тут видно не всі пари.',
    // Повне ПІБ у панель поруч із «Тиждень» не вміщається — там «Прізвище І. П.», а повне — на сторінці.
    top: (t) => [t.short, t.position || 'викладач'],
    head: (t) => ({ title: t.name, sub: [t.position, t.department].filter(Boolean).join(' · ') }),
    mode: 'teacher',
  },
};

export async function renderLookup(root, ctx, kindName) {
  const kind = KINDS[kindName];
  const key = ctx.route.params[0];
  if (key) return renderObject(root, ctx, kindName, kind, key);
  return renderSearch(root, ctx, kindName, kind);
}

async function renderSearch(root, ctx, kindName, kind) {
  ctx.setTitle(kind.title);
  const items = await kind.list(ctx.repo);
  if (!ctx.isCurrent()) return;

  const results = h('div', { class: 'results' });
  const input = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: kind.placeholder,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': kind.placeholder,
    value: ctx.route.query.q ?? '',
  });

  const draw = () => {
    const q = input.value;
    let found = items.filter((it) => matchesQuery(kind.haystack(it), q));
    found = rank(found, q, kind);
    const rows = [];
    const recent = ctx.ui[kind.recentKey];
    if (!q && recent.length) {
      rows.push(h('h2', { class: 'list-heading' }, 'Нещодавні'));
      rows.push(h('ul', { class: 'list' }, recent.map((r) => h('li', null,
        h('a', { class: 'list-row', href: href(kindName, [r.key]) }, h('strong', null, r.label), icon('right'))))));
    }
    if (!found.length) {
      rows.push(h('p', { class: 'empty' }, items.length ? 'Нічого не знайдено.' : 'Список порожній.'));
    } else {
      const limited = found.slice(0, LIST_LIMIT);
      let currentGroup;
      let ul = null;
      for (const it of limited) {
        const g = q ? null : kind.group(it);
        if (!ul || g !== currentGroup) {
          if (g) rows.push(h('h2', { class: 'list-heading' }, g));
          ul = h('ul', { class: 'list' });
          rows.push(ul);
          currentGroup = g;
        }
        ul.append(h('li', null, h('a', { class: 'list-row', href: href(kindName, [it.key]) },
          h('span', { class: 'list-main' }, kind.row(it)),
          it.lessonsCount ? h('span', { class: 'count' }, `${it.lessonsCount} ${plural(it.lessonsCount, ['пара', 'пари', 'пар'])}`) : null,
          icon('right'),
        )));
      }
      if (found.length > limited.length) rows.push(h('p', { class: 'muted small' }, `Показано ${limited.length} з ${found.length}. Уточніть пошук.`));
    }
    replaceChildren(results, rows);
  };
  input.addEventListener('input', () => {
    draw();
    history.replaceState(null, '', href(kindName, [], { q: input.value }));
  });
  draw();

  append(root,
    h('div', { class: 'search' }, icon('search'), input),
    coverageNotice(ctx.meta, kind.what),
    results,
    dataFooter(ctx.meta),
  );
  if (!ctx.route.query.q && matchMedia('(hover: hover)').matches) ctx.afterMount(() => input.focus());
}

/** Спочатку точні збіги, потім ті, що починаються з запиту, далі решта. */
function rank(list, q, kind) {
  const qk = searchKey(q);
  const score = (it) => {
    if (!qk) return 0;
    const label = searchKey(kind.label(it)).replace('№', '');
    if (label === qk || label.split('/')[0] === qk) return 0;
    if (label.startsWith(qk) || searchKey(it.name ?? '').startsWith(qk)) return 1;
    return 2;
  };
  return [...list].sort((a, b) => score(a) - score(b)
    || (q ? 0 : (kind.group(a) ?? '').localeCompare(kind.group(b) ?? '', 'uk'))
    || kind.sort(a, b));
}

async function renderObject(root, ctx, kindName, kind, key) {
  const { route } = ctx;
  const view = pickView(route, ctx.ui);
  const date = isIsoDate(route.query.date) ? route.query.date : todayIso();
  const range = view === 'week' ? weekRange(date) : { from: date, to: date };
  const res = await kind.get(ctx.repo, key, range);
  if (!ctx.isCurrent()) return;
  const obj = kind.pick(res);

  const back = h('a', { class: 'back-link', href: href(kindName) }, icon('left'), kind.title);
  if (!obj) {
    ctx.setTitle(kind.title);
    append(root, back, notice('warn', 'Не знайдено в поточних даних.'), dataFooter(ctx.meta));
    return;
  }
  ctx.setTitle(...kind.top(obj));
  const head = kind.head(obj);
  ctx.setUi({ [kind.recentKey]: pushRecent(ctx.ui[kind.recentKey], { key, label: kind.label(obj) }) });

  const navigate = (patch) => {
    if (patch.view) ctx.setUi({ view: patch.view });
    ctx.go(href(kindName, [key], { date, view, ...patch }));
  };
  const step = view === 'week' ? 7 : 1;
  ctx.setNav({ prev: () => navigate({ date: addDays(date, -step) }), next: () => navigate({ date: addDays(date, step) }) });
  ctx.setActions(viewSwitch({ view, onChange: navigate }));

  const opts = { mode: kind.mode, meta: ctx.meta };
  const body = view === 'week'
    ? weekBlock(date, res.lessons, { ...opts, dayHref: (d) => href(kindName, [key], { date: d, view: 'day' }) })
    : dayBlock(date, res.lessons, { ...opts, freeSlots: kind.mode === 'room' });
  const content = h('div', { class: 'schedule' }, body);
  attachSwipe(content, ctx.nav);

  append(root,
    head
      ? h('div', { class: 'object-head' },
        h('a', { class: 'icon-btn', href: href(kindName), 'aria-label': `До списку: ${kind.title}` }, icon('left')),
        h('div', { class: 'object-head-text' },
          h('h2', null, head.title),
          head.sub ? h('p', { class: 'muted small' }, head.sub) : null))
      : back,
    toolbar({ date, view, onChange: navigate }),
    h('div', { class: 'notices' }, coverageNotice(ctx.meta, kind.what)),
    content,
    dataFooter(ctx.meta),
  );
}
