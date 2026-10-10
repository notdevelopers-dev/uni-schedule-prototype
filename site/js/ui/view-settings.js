// Налаштування й перший запуск: група, підгрупа, іноземна мова, вибіркові, сторонні дисципліни.

import { formatDateShort, weekdayShortByIndex } from '../lib/dates.js';
import { matchesQuery, plural, searchKey } from '../lib/text.js';
import { describeGroupCode } from '../domain/parse.js';
import { buildCatalog, listSubgroups, teacherDisciplines } from '../domain/electives.js';
import { clearPrefs, sameEntry, storageAvailable } from '../prefs.js';
import { append, h, icon, replaceChildren } from './dom.js';
import { href } from './router.js';
import { coverageNotice, notice, UNOFFICIAL } from './schedule.js';

const STATUS_LABEL = {
  ok: null,
  empty: 'пар немає',
  closed: 'розклад складається',
  paused: 'пауза',
  error: 'помилка',
  missing: 'немає даних',
};

// ---------- Вибір групи ----------

export async function renderGroupPicker(root, ctx, { setup = false } = {}) {
  ctx.setTitle(setup ? 'Розклад пар' : 'Вибір групи', setup ? 'крок 1 з 2 · група' : null);
  const groups = await ctx.repo.listGroups();
  if (!ctx.isCurrent()) return;

  const results = h('div', { class: 'results' });
  const input = h('input', {
    class: 'search-input', type: 'search', placeholder: 'Шифр групи, напр. ФЕІ-21', autocomplete: 'off',
    autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Пошук групи',
  });

  const draw = () => {
    const q = input.value;
    const found = groups.filter((g) => matchesQuery(searchKey(`${g.name} ${g.faculty}`), q));
    const byFaculty = new Map();
    for (const g of found) {
      const heading = g.faculty || (g.hint ? `Серія ${g.hint.series}` : 'Інші');
      if (!byFaculty.has(heading)) byFaculty.set(heading, []);
      byFaculty.get(heading).push(g);
    }
    const rows = [];
    for (const [heading, list] of [...byFaculty].sort((a, b) => a[0].localeCompare(b[0], 'uk'))) {
      rows.push(h('h2', { class: 'list-heading' }, heading));
      rows.push(h('ul', { class: 'list' }, list.map((g) => h('li', null,
        h('button', {
          class: ['list-row', ctx.prefs.group?.id === g.id && 'is-selected'],
          type: 'button',
          onclick: () => pick(g),
        },
        h('span', { class: 'list-main' },
          h('strong', null, g.name),
          h('span', { class: 'muted block' }, describeGroupCode(g.hint) || ' '),
        ),
        STATUS_LABEL[g.status] ? h('span', { class: `status status-${g.status}` }, STATUS_LABEL[g.status]) : null,
        icon('right'),
        )))));
    }
    if (!rows.length) rows.push(h('p', { class: 'empty' }, 'Групу не знайдено.'));
    replaceChildren(results, rows);
  };

  const pick = (g) => {
    const changed = ctx.prefs.group?.id !== g.id;
    ctx.setPrefs({ group: { id: g.id, name: g.name }, ...(changed ? { subgroup: null } : {}) });
    ctx.go(setup ? href('setup', ['options']) : href('settings'));
  };

  input.addEventListener('input', draw);
  draw();

  const c = ctx.meta.coverage;
  append(root,
    setup ? h('div', { class: 'intro' },
      h('h2', null, 'Вітаємо!'),
      h('p', null, 'Виберіть групу один раз — далі сайт одразу відкриватиме ваш розклад, лише для вашої підгрупи та ваших вибіркових.'),
      h('p', { class: 'muted small' }, UNOFFICIAL),
    ) : h('a', { class: 'back-link', href: href('settings') }, icon('left'), 'Налаштування'),
    h('div', { class: 'search' }, icon('search'), input),
    c && !c.complete && c.groupsTotal == null
      ? notice('info', `У прототипі дані є лише для ${c.groupsLoaded} ${plural(c.groupsLoaded, ['групи', 'груп', 'груп'])}.`)
      : null,
    results,
  );
  if (matchMedia('(hover: hover)').matches) ctx.afterMount(() => input.focus());
}

// ---------- Налаштування ----------

export async function renderSettings(root, ctx, { setup = false } = {}) {
  const { prefs, repo } = ctx;
  if (!prefs.group) {
    ctx.redirect(href('setup'));
    return;
  }
  ctx.setTitle(setup ? 'Розклад пар' : 'Налаштування', setup ? 'крок 2 з 2 · підгрупа й вибіркові' : null);
  const group = await repo.findGroup(prefs.group);
  const { lessons } = group ? await repo.getGroupSchedule(group.id, ctx.meta.range ?? undefined) : { lessons: [] };
  if (!ctx.isCurrent()) return;

  const catalog = buildCatalog(lessons, ctx.classify);
  const subgroups = listSubgroups(lessons);

  const sections = [
    groupSection(ctx, group, setup),
    subgroupSection(ctx, subgroups),
    catalog.languages.length ? languageSection(ctx, catalog.languages) : null,
    catalog.sections.length ? sectionsSection(ctx, catalog.sections) : null,
    electivesSection(ctx, catalog.electives, [...catalog.sections, ...catalog.electives]),
    externalSection(ctx),
  ];
  if (setup) {
    sections.push(h('div', { class: 'sticky-actions' },
      h('a', { class: 'btn btn-primary btn-block', href: href('my') }, 'Показати мій розклад')));
  } else {
    sections.push(themeSection(ctx), dataSection(ctx));
  }
  append(root, ...sections.filter(Boolean));
}

function section(title, hint, ...content) {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, title),
    hint ? h('p', { class: 'muted small' }, hint) : null,
    content,
  );
}

function groupSection(ctx, group, setup) {
  const status = group && STATUS_LABEL[group.status];
  return section('Група', null,
    h('div', { class: 'row-between' },
      h('div', null,
        h('strong', { class: 'big' }, ctx.prefs.group.name),
        group?.faculty ? h('span', { class: 'muted block' }, group.faculty) : null,
        group?.hint ? h('span', { class: 'muted block' }, describeGroupCode(group.hint)) : null,
        status ? h('span', { class: `status status-${group.status}` }, status) : null,
        !group ? h('span', { class: 'status status-error' }, 'немає в даних') : null,
      ),
      h('a', { class: 'btn btn-small', href: setup ? href('setup') : href('settings', ['group']) }, 'Змінити'),
    ),
  );
}

function subgroupSection(ctx, subgroups) {
  const options = subgroups.length ? subgroups : [1, 2];
  const current = ctx.prefs.subgroup;
  const choose = (value) => {
    ctx.setPrefs({ subgroup: value });
    ctx.rerender();
  };
  return section('Підгрупа', 'Пари іншої підгрупи не показуватимуться.',
    h('div', { class: 'segmented segmented-wide', role: 'radiogroup', 'aria-label': 'Підгрупа' },
      options.map((n) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === n), class: current === n ? 'is-active' : '', onclick: () => choose(n) }, `${n}`)),
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(current == null), class: current == null ? 'is-active' : '', onclick: () => choose(null) }, 'Усі'),
    ),
  );
}

function themeSection(ctx) {
  const current = ctx.ui.theme;
  const choose = (theme) => {
    ctx.setUi({ theme });
    ctx.rerender();
  };
  const options = [[null, 'Системна'], ['light', 'Світла'], ['dark', 'Темна']];
  return section('Тема', null,
    h('div', { class: 'segmented segmented-wide', role: 'radiogroup', 'aria-label': 'Тема' },
      options.map(([value, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === value), class: current === value ? 'is-active' : '', onclick: () => choose(value) }, label)),
    ),
  );
}

/** [{weekday: 1, number: 3}] -> 'вт 3' */
function slotsText(slots) {
  return slots.map((s) => `${weekdayShortByIndex(s.weekday).toLowerCase()} ${s.number}`).join(', ');
}

function languageSection(ctx, languages) {
  const current = ctx.prefs.englishTeacher;
  const teachers = new Map();
  for (const lang of languages) {
    for (const t of lang.teachers) {
      const prev = teachers.get(t.key);
      teachers.set(t.key, prev ? { ...prev, slots: [...prev.slots, ...t.slots], rooms: [...new Set([...prev.rooms, ...t.rooms])] } : t);
    }
  }
  const choose = (t) => {
    ctx.setPrefs({ englishTeacher: t ? { key: t.key, name: t.name } : null });
    ctx.rerender();
  };
  const titles = languages.map((l) => l.title).filter((t) => t !== 'Іноземна мова');
  const list = [...teachers.values()];
  const knownCurrent = !current || teachers.has(current.key);
  return section('Іноземна мова',
    `${titles.length ? `${titles.join(', ')}. ` : ''}Кілька викладачів ведуть пари паралельно. Доки свого не вибрано, показуються всі; виберіть — і пари інших буде приховано.`,
    h('ul', { class: 'choice-list', role: 'radiogroup' },
      list.map((t) => choiceRow({
        type: 'radio', name: 'lang', checked: current?.key === t.key, onChange: () => choose(t),
        title: t.name, detail: `${slotsText(t.slots)} пара · ${t.rooms.join(', ')}`,
      })),
      !knownCurrent ? choiceRow({ type: 'radio', name: 'lang', checked: true, onChange: () => {}, title: current.name, detail: 'немає в розкладі цієї групи' }) : null,
      choiceRow({ type: 'radio', name: 'lang', checked: !current, onChange: () => choose(null), title: 'Усі викладачі', detail: 'показувати пари всіх груп' }),
    ),
  );
}

function choiceRow({ type, name, checked, onChange, title, detail, extra }) {
  return h('li', null,
    h('label', { class: ['choice', checked && 'is-checked'] },
      h('input', { type, name, checked, onchange: onChange }),
      h('span', { class: 'choice-text' },
        h('strong', null, title),
        detail ? h('span', { class: 'muted block small' }, detail) : null,
      ),
    ),
    extra ?? null,
  );
}

/** Записи прихованого для дисципліни та заміна їх новим списком. */
function hiddenEditor(ctx) {
  const { prefs } = ctx;
  return {
    hiddenFor: (titleKey) => prefs.hiddenElectives.filter((e) => e.titleKey === titleKey),
    setFor: (titleKey, list) => {
      ctx.setPrefs({ hiddenElectives: [...prefs.hiddenElectives.filter((e) => e.titleKey !== titleKey), ...list] });
      ctx.rerender();
    },
  };
}

/** Перемикачі «показувати пари викладача» для дисципліни, яку ведуть кілька викладачів. */
function teacherChips(entry, hidden, setFor) {
  const base = { titleKey: entry.titleKey, title: entry.title };
  const wholeHidden = hidden.some((e) => !e.teacherKey);
  const hiddenTeachers = new Set(hidden.map((e) => e.teacherKey).filter(Boolean));
  const isOn = (t) => !wholeHidden && !hiddenTeachers.has(t.key);
  const toggle = (t) => {
    if (isOn(t)) {
      setFor(entry.titleKey, [...hidden, { ...base, teacherKey: t.key, teacherName: t.name }]);
    } else if (wholeHidden) {
      // Було приховано все — вмикаємо лише цього викладача.
      setFor(entry.titleKey, entry.teachers.filter((x) => x.key !== t.key).map((x) => ({ ...base, teacherKey: x.key, teacherName: x.name })));
    } else {
      setFor(entry.titleKey, hidden.filter((e) => e.teacherKey !== t.key));
    }
  };
  return h('div', { class: 'chips', role: 'group', 'aria-label': 'Викладачі' },
    h('span', { class: 'muted small' }, 'Показувати пари викладачів:'),
    entry.teachers.map((t) => {
      const on = isOn(t);
      return h('button', { type: 'button', class: ['chip', on && 'is-active'], 'aria-pressed': String(on), title: `${slotsText(t.slots)} пара · ${t.rooms.join(', ')}`, onclick: () => toggle(t) },
        `${t.short} · ${t.types.join('/')} ${slotsText(t.slots)}`);
    }),
  );
}

function sectionsSection(ctx, sections) {
  const { hiddenFor, setFor } = hiddenEditor(ctx);
  const rows = sections.map((entry) => h('li', { class: 'choice-block' },
    h('strong', null, entry.title),
    h('span', { class: 'muted block small' }, [entry.types.join(', '), `${slotsText(entry.slots)} пара`].join(' · ')),
    entry.teachers.length > 1 ? teacherChips(entry, hiddenFor(entry.titleKey), setFor) : h('span', { class: 'muted block small' }, entry.teachers[0]?.name ?? ''),
  ));
  return section('Дисципліни з кількома викладачами',
    'Звичайні дисципліни вашої групи (у розкладі є ще й потоком чи підгрупою), але частину пар «Збірна група» ведуть кілька викладачів паралельно. Залиште свого — або натисніть «Мій викладач» на картці пари.',
    h('ul', { class: 'choice-list' }, rows),
  );
}

function electivesSection(ctx, electives, allWithHiding) {
  const { prefs } = ctx;
  const { hiddenFor, setFor } = hiddenEditor(ctx);

  const rows = electives.map((entry) => {
    const hidden = hiddenFor(entry.titleKey);
    const whole = { titleKey: entry.titleKey, title: entry.title, teacherKey: null, teacherName: null };
    const hiddenTeachers = new Set(hidden.map((e) => e.teacherKey).filter(Boolean));
    const shown = !hidden.some((e) => !e.teacherKey)
      && !(entry.teachers.length && entry.teachers.every((t) => hiddenTeachers.has(t.key)));
    const toggle = () => setFor(entry.titleKey, shown ? [whole] : []);
    const chips = shown && entry.teachers.length > 1 ? teacherChips(entry, hidden, setFor) : null;
    const detail = [
      entry.types.join(', '),
      `${slotsText(entry.slots)} пара`,
      entry.teachers.length === 1 ? entry.teachers[0].short : `${entry.teachers.length} викл.`,
      shown ? null : 'приховано',
    ].filter(Boolean).join(' · ');
    return choiceRow({
      type: 'checkbox', name: `el-${entry.titleKey}`, checked: shown, onChange: toggle,
      title: [entry.title, entry.likelyDvvs ? h('span', { class: 'badge badge-hint' }, 'ймовірно ДВВС') : null],
      detail,
      extra: chips,
    });
  });

  // Приховані раніше дисципліни, яких уже немає в розкладі групи (інший семестр, інша група).
  const known = new Set(allWithHiding.map((e) => e.titleKey));
  const orphaned = prefs.hiddenElectives.filter((e) => !known.has(e.titleKey));
  const orphanRows = orphaned.map((e) => h('li', { class: 'orphan' },
    h('span', null, e.title, e.teacherName ? h('span', { class: 'muted' }, ` · ${e.teacherName}`) : null, h('span', { class: 'muted block small' }, 'приховано, але немає в розкладі групи')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Прибрати ${e.title}`, onclick: () => { ctx.setPrefs({ hiddenElectives: prefs.hiddenElectives.filter((x) => !sameEntry(x, e)) }); ctx.rerender(); } }, icon('close')),
  ));

  return section('Вибіркові дисципліни (ДВВС)',
    electives.length
      ? 'Є в розкладі групи лише як «Збірна група» — схоже на дисципліни вільного вибору. Показуються всі; зніміть позначку з тих, які ви не відвідуєте, або натисніть «Не моя» на картці пари.'
      : 'У розкладі групи немає дисциплін, схожих на ДВВС.',
    rows.length ? h('ul', { class: 'choice-list' }, rows) : null,
    orphanRows.length ? h('ul', { class: 'choice-list' }, orphanRows) : null,
  );
}

function externalSection(ctx) {
  const externals = ctx.prefs.externalElectives;
  return section('Сторонні дисципліни',
    'ДВВС, яких немає в розкладі вашої групи (наприклад, з іншого факультету). Пари підтягуються з розкладу викладача.',
    externals.length ? h('ul', { class: 'choice-list' }, externals.map((e) => h('li', { class: 'orphan' },
      h('span', null, h('strong', null, e.title), h('span', { class: 'muted block small' }, e.teacherName ?? '')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Прибрати ${e.title}`, onclick: () => { ctx.setPrefs({ externalElectives: ctx.prefs.externalElectives.filter((x) => !sameEntry(x, e)) }); ctx.rerender(); } }, icon('close')),
    ))) : null,
    h('a', { class: 'btn btn-small', href: href('settings', ['external']) }, icon('plus'), 'Додати з розкладу викладача'),
  );
}

function dataSection(ctx) {
  const m = ctx.meta;
  const c = m.coverage;
  const rows = [
    ['Джерело', m.source === 'static' ? 'data.json (статичний знімок)' : m.source],
    m.generatedAt ? ['Оновлено', new Date(m.generatedAt).toLocaleString('uk-UA')] : null,
    m.range ? ['Період', `${formatDateShort(m.range.from)} – ${formatDateShort(m.range.to)}`] : null,
    c ? ['Групи', c.groupsTotal != null ? `${c.groupsLoaded} з ${c.groupsTotal}` : `${c.groupsLoaded} (повний список груп невідомий)`] : null,
  ].filter(Boolean);
  return section('Дані', null,
    h('dl', { class: 'facts' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('p', { class: 'muted small' }, UNOFFICIAL),
    coverageNotice(m, 'Аудиторії й викладачі показують не всі пари.'),
    m.errors?.length ? notice('warn', m.errors.join(' ')) : null,
    storageAvailable() ? null : notice('warn', 'Браузер не дозволяє зберігати дані сайту — вибір не збережеться після закриття сторінки.'),
    h('p', { class: 'small' }, h('a', { href: href('issues') }, 'Відомі проблеми прототипу')),
    h('button', {
      class: 'btn btn-small btn-danger', type: 'button',
      onclick: () => {
        if (!confirm('Скинути групу, підгрупу й вибіркові?')) return;
        clearPrefs();
        ctx.resetPrefs();
        ctx.go(href('setup'));
      },
    }, 'Скинути мій вибір'),
  );
}

// ---------- Стороння дисципліна: викладач -> дисципліна ----------

export async function renderExternal(root, ctx) {
  const teacherKey = ctx.route.params[1];
  const back = h('a', { class: 'back-link', href: teacherKey ? href('settings', ['external']) : href('settings') }, icon('left'), teacherKey ? 'Інший викладач' : 'Налаштування');

  if (!teacherKey) {
    ctx.setTitle('Стороння дисципліна', 'крок 1: викладач');
    const teachers = await ctx.repo.listTeachers();
    if (!ctx.isCurrent()) return;
    const results = h('ul', { class: 'list' });
    const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Прізвище викладача', autocomplete: 'off', 'aria-label': 'Прізвище викладача' });
    const draw = () => {
      const found = teachers.filter((t) => matchesQuery(searchKey(`${t.name} ${t.department ?? ''}`), input.value))
        .sort((a, b) => a.name.localeCompare(b.name, 'uk')).slice(0, 60);
      replaceChildren(results, found.map((t) => h('li', null, h('a', { class: 'list-row', href: href('settings', ['external', t.key]) },
        h('span', { class: 'list-main' }, h('strong', null, t.name), t.department ? h('span', { class: 'muted block' }, t.department) : null), icon('right')))));
    };
    input.addEventListener('input', draw);
    draw();
    append(root, back,
      h('p', { class: 'muted' }, 'Знайдіть викладача, який веде вашу дисципліну, і виберіть її з його розкладу.'),
      h('div', { class: 'search' }, icon('search'), input),
      coverageNotice(ctx.meta, 'Розклад викладача може бути неповним.'),
      results);
    if (matchMedia('(hover: hover)').matches) ctx.afterMount(() => input.focus());
    return;
  }

  const { teacher, lessons } = await ctx.repo.getTeacherSchedule(teacherKey, ctx.meta.range ?? undefined);
  if (!ctx.isCurrent()) return;
  ctx.setTitle('Стороння дисципліна', 'крок 2: дисципліна');
  if (!teacher) {
    append(root, back, notice('warn', 'Викладача не знайдено в даних.'));
    return;
  }
  const disciplines = teacherDisciplines(lessons);
  const add = (d) => {
    const entry = { titleKey: d.titleKey, title: d.title, teacherKey: teacher.key, teacherName: teacher.name };
    if (!ctx.prefs.externalElectives.some((e) => sameEntry(e, entry))) ctx.setPrefs({ externalElectives: [...ctx.prefs.externalElectives, entry] });
    ctx.toast(`Додано: ${d.title}`);
    ctx.go(href('settings'));
  };
  append(root, back,
    h('h2', { class: 'section-title' }, teacher.name),
    disciplines.length
      ? h('ul', { class: 'choice-list' }, disciplines.map((d) => h('li', { class: 'orphan' },
        h('span', null,
          h('strong', null, d.title),
          h('span', { class: 'muted block small' }, [d.types.join(', '), `${slotsText(d.slots)} пара`, [...d.audiences, ...d.groups].slice(0, 4).join(', ')].filter(Boolean).join(' · ')),
        ),
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => add(d) }, icon('plus'), 'Додати'),
      )))
      : notice('warn', 'У наявних даних немає пар цього викладача. У робочій версії розклад викладача братиметься з нашого API.'),
  );
}
