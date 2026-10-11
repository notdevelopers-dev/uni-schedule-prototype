// Режим «Мій розклад»: група + підгрупа; «Збірна група» — усе, крім позначеного як «не моє».

import { addDays, formatDayLong, isIsoDate, startOfWeek, toUaDate, todayIso } from '../lib/dates.js';
import { plural } from '../lib/text.js';
import { addExternal, buildCatalog, filterForUser, listSubgroups, matchesElective } from '../domain/electives.js';
import { append, h, icon } from './dom.js';
import { href } from './router.js';
import {
  attachSwipe, dataFooter, dayBlock, inDataRange, lessonTiming, notice, pickView, toolbar, viewSwitch, weekBlock, weekRange,
} from './schedule.js';

/** Пари групи за діапазоном з урахуванням вибору користувача. */
async function loadMine(ctx, groupId, range) {
  const { repo, prefs, classify } = ctx;
  const { lessons } = await repo.getGroupSchedule(groupId, range);
  const { visible, hidden } = filterForUser(lessons, prefs, classify);

  const externals = prefs.externalElectives;
  const missingExternal = [];
  const externalLessons = [];
  await Promise.all(externals.map(async (e) => {
    const res = await repo.getTeacherSchedule(e.teacherKey, range).catch(() => null);
    if (!res?.teacher) missingExternal.push(e);
    for (const l of res?.lessons ?? []) if (l.titleKey === e.titleKey) externalLessons.push(l);
  }));
  return { visible: addExternal(visible, externalLessons), hidden, missingExternal };
}

/** Каталог «Збірна група» за весь знімок: потрібен, щоб знати, скільки викладачів у дисципліни. */
async function loadCatalog(ctx, groupId) {
  const range = ctx.meta.range ?? undefined;
  const { lessons } = await ctx.repo.getGroupSchedule(groupId, range);
  return { catalog: buildCatalog(lessons, ctx.classify), subgroups: listSubgroups(lessons) };
}

/**
 * Що показати, коли дати в адресі немає. lessons — «мої» пари від сьогодні вперед, відсортовані.
 * День: сьогодні, якщо ще є пари; інакше найближчий день з парами.
 * Тиждень: поточний, якщо на ньому ще є пари; інакше тиждень найближчої пари (у вихідні — зазвичай наступний).
 * found: false — попереду пар не знайдено, вирішує виклик.
 */
export function pickStart(lessons, view, today = todayIso()) {
  const next = lessons.find((l) => l.date > today || (l.date === today && lessonTiming(l).state !== 'past'));
  if (!next) return { date: today, found: false };
  if (view === 'week') {
    const weekEnd = addDays(startOfWeek(today), 6);
    if (next.date <= weekEnd) return { date: today, found: true };
    return {
      date: next.date,
      found: true,
      note: next.date <= addDays(weekEnd, 7)
        ? 'Цього тижня пар більше немає — показано наступний тиждень.'
        : 'Цього тижня пар більше немає — показано найближчий тиждень з парами.',
    };
  }
  if (next.date === today) return { date: today, found: true };
  return {
    date: next.date,
    found: true,
    note: lessons.some((l) => l.date === today)
      ? 'Сьогодні пари вже закінчилися — показано наступний день з парами.'
      : 'Сьогодні пар немає — показано найближчий день з парами.',
  };
}

async function pickDate(ctx, groupId, view) {
  const today = todayIso();
  const { visible } = await loadMine(ctx, groupId, { from: today, to: addDays(today, 13) });
  const picked = pickStart(visible, view, today);
  if (picked.found) return { date: picked.date, note: picked.note };
  const r = ctx.meta.range;
  if (r && (today < r.from || today > r.to)) {
    const { visible: all } = await loadMine(ctx, groupId, r);
    if (all.length) return { date: all[0].date, note: `На сьогодні даних немає: знімок охоплює ${toUaDate(r.from)} – ${toUaDate(r.to)}.` };
  }
  return { date: today };
}

export async function renderMy(root, ctx) {
  const { repo, prefs, route } = ctx;
  if (!prefs.group) {
    ctx.redirect(href('setup'));
    return;
  }
  const group = await repo.findGroup(prefs.group);
  ctx.setTitle(prefs.group.name || 'Мій розклад', subgroupLabel(prefs.subgroup), href('settings'));
  if (!group) {
    append(root,
      notice('warn', `Групи «${prefs.group.name}» немає в поточних даних.`),
      h('p', null, h('a', { class: 'btn', href: href('settings', ['group']) }, 'Вибрати іншу групу')),
      dataFooter(ctx.meta),
    );
    return;
  }

  const view = pickView(route, ctx.ui);
  let date = isIsoDate(route.query.date) ? route.query.date : null;
  let autoNote = null;
  if (!date) {
    const picked = await pickDate(ctx, group.id, view);
    date = picked.date;
    autoNote = picked.note ?? null;
  }
  if (!ctx.isCurrent()) return;

  const range = view === 'week' ? weekRange(date) : { from: date, to: date };
  const [mine, { catalog, subgroups }] = await Promise.all([
    loadMine(ctx, group.id, range),
    loadCatalog(ctx, group.id),
  ]);
  if (!ctx.isCurrent()) return;
  const { hidden, missingExternal } = mine;
  const visible = markSections(mine.visible, catalog, prefs);

  const navigate = (patch) => {
    if (patch.view) ctx.setUi({ view: patch.view });
    ctx.go(href('my', [], { date, view, ...patch }));
  };
  const step = view === 'week' ? 7 : 1;
  ctx.setNav({ prev: () => navigate({ date: addDays(date, -step) }), next: () => navigate({ date: addDays(date, step) }) });
  ctx.setActions(viewSwitch({ view, onChange: navigate }));

  // Сповіщення над розкладом.
  const notes = [];
  if (ctx.meta.offline) notes.push(notice('warn', 'Немає зʼєднання — показано збережену копію даних.'));
  if (group.status !== 'ok' && group.status !== 'empty') {
    notes.push(notice('warn', h('strong', null, group.statusMessage), group.statusCode ? ` (код ${group.statusCode})` : ''));
  }
  if (autoNote) {
    notes.push(notice('info', autoNote, ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => navigate({ date: todayIso() }) },
      view === 'week' ? 'Показати цей тиждень' : 'Показати сьогодні')));
  }
  if (prefs.subgroup == null && subgroups.length > 1) {
    notes.push(notice('info', 'Підгрупу не вибрано — показано пари всіх підгруп. ', h('a', { href: href('settings') }, 'Вибрати підгрупу')));
  }
  const unchosen = [...new Set(visible.filter((l) => l.why === 'language-any' || l.why === 'section-any').map((l) => l.title))];
  if (unchosen.length) {
    notes.push(notice('info', `${unchosen.join(', ')}: показано всіх викладачів. Позначте свого кнопкою «Мій викладач».`));
  }
  for (const e of missingExternal) {
    notes.push(notice('warn', `Сторонню дисципліну «${e.title}» не показано: розкладу викладача ${e.teacherName ?? ''} немає в даних.`));
  }

  const showHidden = ctx.session.showHidden;
  if (hidden.length) {
    const where = view === 'week' ? 'цього тижня' : 'цього дня';
    notes.push(h('div', { class: 'hidden-bar' },
      h('span', null, `${showHidden ? 'Показано' : 'Приховано'} ${hidden.length} ${plural(hidden.length, ['пару', 'пари', 'пар'])} «Збірна група» ${where}, які не ваші.`),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ctx.session.showHidden = !showHidden; ctx.rerender(); } }, showHidden ? 'Сховати' : 'Показати'),
    ));
  }

  const hiddenIds = new Set(showHidden ? hidden.map((l) => l.id) : []);
  const shown = showHidden ? [...visible, ...hidden] : visible;
  const actionsFor = (lesson) => lessonActions(ctx, lesson, catalog);

  const body = view === 'week'
    ? weekBlock(date, shown, { mode: 'my', meta: ctx.meta, hiddenIds, dayHref: (d) => href('my', [], { date: d, view: 'day' }) })
    : dayBlock(date, shown, { mode: 'my', meta: ctx.meta, gaps: true, hiddenIds, actionsFor });

  const content = h('div', { class: 'schedule' }, body);
  attachSwipe(content, ctx.nav);

  append(root,
    toolbar({ date, view, onChange: navigate }),
    notes.length ? h('div', { class: 'notices' }, notes) : null,
    content,
    view === 'day' ? nextDayHint(ctx, group.id, date, visible) : null,
    dataFooter(ctx.meta),
  );
}

/**
 * Пари «Збірна група» звичайних дисциплін з кількома викладачами (catalog.sections):
 * 'section-any' — свого викладача ще не вибрано, 'section-mine' — вибрано (інших приховано).
 */
function markSections(lessons, catalog, prefs) {
  const sections = new Map(catalog.sections.filter((e) => e.teachers.length > 1).map((e) => [e.titleKey, e]));
  return lessons.map((l) => {
    if (l.why !== 'mixed' || !sections.has(l.titleKey)) return l;
    const chosen = prefs.hiddenElectives.some((e) => e.titleKey === l.titleKey && e.teacherKey && e.teacherKey !== l.teacher?.key);
    return { ...l, why: chosen ? 'section-mine' : 'section-any' };
  });
}

function subgroupLabel(subgroup) {
  return subgroup ? `підгрупа ${subgroup}` : 'усі підгрупи';
}

/** Під порожнім днем — кнопка переходу до наступного дня з парами. */
function nextDayHint(ctx, groupId, date, visible) {
  if (visible.some((l) => l.date === date) || !inDataRange(date, ctx.meta)) return null;
  const holder = h('div', { class: 'next-hint' });
  loadMine(ctx, groupId, { from: addDays(date, 1), to: addDays(date, 30) }).then(({ visible: ahead }) => {
    const next = ahead[0];
    if (!next || !ctx.isCurrent()) return;
    holder.append(h('a', { class: 'btn', href: href('my', [], { date: next.date, view: 'day' }) },
      `Наступні пари: ${formatDayLong(next.date)}`, icon('right')));
  });
  return holder;
}

/**
 * Дії на картці «Збірна група»: «Мій викладач» (іноземна й дисципліни з кількома викладачами),
 * «Не моя» (вибіркові), «Показувати знову» (приховані). Кожну можна скасувати з тосту.
 */
function lessonActions(ctx, lesson, catalog) {
  const before = ctx.prefs;
  const apply = (patch, message, undo) => {
    ctx.setPrefs(patch);
    ctx.toast(message, { label: 'Скасувати', run: () => { ctx.setPrefs(undo); ctx.rerender(); } });
    ctx.rerender();
  };
  const action = (label, onclick, primary = false) => h('div', { class: 'lesson-actions' },
    h('button', { class: ['btn btn-small', primary ? 'btn-primary' : 'btn-quiet'], type: 'button', onclick }, label));

  // Звичайна дисципліна з кількома викладачами: «Мій викладач» ховає пари всіх інших.
  const section = catalog.sections.find((e) => e.titleKey === lesson.titleKey);
  if (section && section.teachers.length > 1 && lesson.teacher && (lesson.why === 'section-any' || lesson.why === 'hidden-by-user')) {
    const others = section.teachers
      .filter((t) => t.key !== lesson.teacher.key)
      .map((t) => ({ titleKey: section.titleKey, title: section.title, teacherKey: t.key, teacherName: t.name }));
    return action('Мій викладач', () => apply(
      { hiddenElectives: [...before.hiddenElectives.filter((e) => e.titleKey !== section.titleKey), ...others] },
      `${section.title}: лише ${lesson.teacher.short}`,
      { hiddenElectives: before.hiddenElectives },
    ), lesson.why === 'hidden-by-user');
  }

  switch (lesson.why) {
    case 'language-any':
    case 'other-language-teacher':
      if (!lesson.teacher) return null;
      return action('Мій викладач', () => apply(
        { englishTeacher: { key: lesson.teacher.key, name: lesson.teacher.name } },
        `Іноземна: лише ${lesson.teacher.short}`,
        { englishTeacher: before.englishTeacher },
      ), lesson.why === 'other-language-teacher');
    case 'mixed': {
      // Вибіркова (ДВВС). Якщо її ведуть кілька викладачів, ховаємо лише пари цього викладача.
      const entry = catalog.electives.find((e) => e.titleKey === lesson.titleKey);
      const byTeacher = Boolean(entry && entry.teachers.length > 1 && lesson.teacher);
      const hide = {
        titleKey: lesson.titleKey,
        title: lesson.title,
        teacherKey: byTeacher ? lesson.teacher.key : null,
        teacherName: byTeacher ? lesson.teacher.name : null,
      };
      return action('Не моя', () => apply(
        { hiddenElectives: [...before.hiddenElectives, hide] },
        `Приховано: ${lesson.title}${byTeacher ? ` (${lesson.teacher.short})` : ''}`,
        { hiddenElectives: before.hiddenElectives },
      ));
    }
    case 'hidden-by-user':
      return action('Показувати знову', () => apply(
        { hiddenElectives: before.hiddenElectives.filter((e) => !matchesElective(lesson, [e])) },
        `Знову показується: ${lesson.title}`,
        { hiddenElectives: before.hiddenElectives },
      ), true);
    default:
      return null;
  }
}
