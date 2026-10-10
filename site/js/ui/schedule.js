// Спільний рендер розкладу для трьох режимів: «мій», «аудиторія», «викладач».

import {
  addDays, formatDateShort, formatDayLong, formatDuration, formatWeekRange, minutesNow,
  relativeDayLabel, startOfWeek, toMinutes, todayIso, weekDays, weekdayIndex, weekdayShort,
} from '../lib/dates.js';
import { plural } from '../lib/text.js';
import { groupByDate, groupBySlot } from '../domain/lessons.js';
import { KNOWN_ISSUES, issuesFor } from '../known-issues.js';
import { h, icon } from './dom.js';
import { href } from './router.js';

/** Діапазон, який треба завантажити для поточного вигляду (завжди тиждень — його вистачає і для дня). */
export function weekRange(date) {
  const from = startOfWeek(date);
  return { from, to: addDays(from, 6) };
}

export function inDataRange(date, meta) {
  const r = meta?.range;
  return !r || (date >= r.from && date <= r.to);
}

/** Ширина, з якої тиждень показується сіткою і відкривається за замовчуванням (як у CSS). */
const WIDE_QUERY = '(min-width: 960px)';

/** Вигляд «день/тиждень»: з адреси, інакше останній вибраний, інакше тиждень на десктопі й день на телефоні. */
export function pickView(route, ui) {
  const q = route.query.view;
  if (q === 'week' || q === 'day') return q;
  if (ui.view) return ui.view;
  return globalThis.matchMedia?.(WIDE_QUERY).matches ? 'week' : 'day';
}

/** Панель дат: ‹ дата › і «Сьогодні», коли показано не поточний день/тиждень. */
export function toolbar({ date, view, onChange }) {
  const step = view === 'week' ? 7 : 1;
  const today = todayIso();
  const isCurrent = view === 'week' ? startOfWeek(today) === startOfWeek(date) : today === date;
  const rel = view === 'day' ? relativeDayLabel(date) : isCurrent ? 'цей тиждень' : null;
  const label = view === 'week' ? `Тиждень ${formatWeekRange(date)}` : formatDayLong(date);

  return h('div', { class: 'toolbar' },
    h('div', { class: 'datenav' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': view === 'week' ? 'Попередній тиждень' : 'Попередній день', onclick: () => onChange({ date: addDays(date, -step) }) }, icon('left')),
      h('div', { class: 'datenav-label', 'aria-live': 'polite' },
        h('strong', null, label),
        rel || !isCurrent
          ? h('span', { class: 'datenav-sub' },
            rel ? h('span', { class: 'muted' }, rel) : null,
            isCurrent ? null : h('button', { class: 'today-btn', type: 'button', onclick: () => onChange({ date: today }) }, 'Сьогодні'))
          : null,
      ),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': view === 'week' ? 'Наступний тиждень' : 'Наступний день', onclick: () => onChange({ date: addDays(date, step) }) }, icon('right')),
    ),
  );
}

/** Перемикач «день ↔ тиждень» для верхньої панелі: підпис — вигляд, на який перемкне. */
export function viewSwitch({ view, onChange }) {
  const target = view === 'week' ? 'day' : 'week';
  return h('button', {
    class: 'view-switch',
    type: 'button',
    'aria-label': target === 'week' ? 'Показати тиждень' : 'Показати день',
    onclick: () => onChange({ view: target }),
  }, icon('calendar'), target === 'week' ? 'Тиждень' : 'День');
}

/** Свайп вліво/вправо по вмісту = наступний/попередній день чи тиждень. */
export function attachSwipe(el, { prev, next }) {
  let x0 = null;
  let y0 = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) (dx < 0 ? next : prev)?.();
  }, { passive: true });
}

/** Статус пари відносно «зараз»: past | now | future (+ прогрес для поточної). */
export function lessonTiming(lesson) {
  const today = todayIso();
  if (lesson.date !== today) return { state: lesson.date < today ? 'past' : 'future' };
  const nowMin = minutesNow();
  const s = toMinutes(lesson.start);
  const e = toMinutes(lesson.end);
  if (e != null && nowMin >= e) return { state: 'past' };
  if (s != null && nowMin >= s) {
    return { state: 'now', left: e != null ? e - nowMin : null, progress: s != null && e ? (nowMin - s) / (e - s) : null };
  }
  return { state: 'future', startsIn: s != null ? s - nowMin : null };
}

const AUDIENCE_TAG = {
  language: 'Ваш викладач',
  'section-mine': 'Ваш викладач',
  external: 'Стороння вибіркова',
};

/**
 * Картка пари.
 * mode: 'my' — показуємо аудиторію й викладача; 'room' — викладача й групи; 'teacher' — аудиторію й групи.
 */
export function lessonCard(lesson, { mode = 'my', compact = false, grid = false, timing = null, next = false, foreign = false, actions = null } = {}) {
  const tone = lesson.kind === 'lesson' ? lesson.type.tone : 'reserved';
  const title = lesson.kind === 'lesson' ? lesson.title : lesson.reservation || 'Слот без назви';
  const state = timing?.state;

  const badges = [];
  if (lesson.kind === 'lesson' && lesson.type.short) {
    badges.push(h('span', { class: 'badge badge-type', title: lesson.type.label }, compact ? lesson.type.short : lesson.type.label));
  }
  if (lesson.kind === 'reserved') badges.push(h('span', { class: 'badge badge-type' }, 'Зайнято'));
  if (lesson.kind === 'untitled') badges.push(h('span', { class: 'badge' }, 'можливо, ДВВС'));
  if (mode === 'my') {
    const tag = AUDIENCE_TAG[lesson.why] ?? (lesson.audience.kind === 'whole' ? null : lesson.audience.label);
    if (tag) badges.push(h('span', { class: `badge badge-aud aud-${lesson.why || lesson.audience.kind}` }, tag));
  }
  if (foreign) badges.push(h('span', { class: 'badge badge-foreign' }, 'приховано'));
  if (lesson.replacement) badges.push(h('span', { class: 'badge badge-alert' }, 'Заміна'));
  if (lesson.online || lesson.link) badges.push(h('span', { class: 'badge badge-online' }, 'Онлайн'));
  const issues = issuesFor(lesson);
  if (issues.length && compact) {
    badges.push(h('span', { class: 'badge badge-issue', title: issues.map((i) => i.title).join('; ') }, icon('warn'), 'відома проблема'));
  }
  const metaItems = [];
  if (mode !== 'room' && lesson.room) {
    metaItems.push(h('a', { class: 'meta-link', href: href('rooms', [lesson.room.key], { date: lesson.date }) }, icon('pin'), lesson.room.label));
  }
  if (mode !== 'teacher') {
    for (const t of [lesson.teacher, ...(lesson.extraTeachers ?? [])].filter(Boolean)) {
      // На вузьких екранах у повній картці — «Прізвище І. П.» (CSS перемикає), щоб аудиторія й викладач уміщалися в рядок.
      const name = compact ? t.short : [h('span', { class: 'name-full' }, t.name), h('span', { class: 'name-short' }, t.short)];
      metaItems.push(h('a', { class: 'meta-link', href: href('teachers', [t.key], { date: lesson.date }), title: [t.position, t.name].filter(Boolean).join(' ') }, icon('person'), name));
    }
  }
  if (mode !== 'my' && lesson.groups?.length) {
    const audiences = [...new Set((lesson.audiences ?? [lesson.audience]).map((a) => a.label).filter(Boolean))];
    metaItems.push(h('span', { class: 'meta-text' }, lesson.groups.join(', '), audiences.length ? h('span', { class: 'muted' }, ` · ${audiences.join(', ')}`) : null));
  } else if (mode !== 'my' && lesson.audience?.label) {
    metaItems.push(h('span', { class: 'meta-text' }, lesson.audience.label));
  }

  const extras = [];
  if (!compact) {
    if (lesson.replacement) extras.push(h('p', { class: 'note note-alert' }, h('strong', null, 'Заміна: '), lesson.replacement));
    if (lesson.link) {
      extras.push(h('a', { class: 'btn btn-small btn-online', href: lesson.link, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), lesson.linkText || 'Посилання на онлайн-заняття'));
    } else if (lesson.linkText) {
      extras.push(h('p', { class: 'note' }, lesson.linkText));
    }
    if (lesson.online) extras.push(h('p', { class: 'note' }, h('strong', null, 'Онлайн: '), lesson.online));
    if (lesson.comment) extras.push(h('p', { class: 'note' }, lesson.comment));
    if (lesson.half) extras.push(h('p', { class: 'note' }, h('strong', null, 'Частина: '), lesson.half));
    if (lesson.kind === 'untitled') extras.push(h('p', { class: 'note' }, 'Зайнятий слот без назви. На деяких факультетах так позначають місце під ДВВС.'));
    // Позначка для команди: відома проблема даних чи евристики, що стосується цієї пари.
    for (const issue of issues) {
      extras.push(h('details', { class: 'known-issue' },
        h('summary', { title: issue.short ?? issue.title }, icon('warn'), 'відома проблема'),
        h('p', null, h('strong', null, `${issue.short ?? issue.title}. `), issue.text),
        h('a', { href: href('issues') }, 'Усі відомі проблеми прототипу')));
    }
  }

  return h('article', {
    class: ['lesson', `tone-${tone}`, compact && 'is-compact', state && `is-${state}`, next && 'is-next', foreign && 'is-foreign', lesson.replacement && 'has-replacement'],
    dataset: { id: lesson.id },
  },
  compact && !grid ? h('span', { class: 'lesson-time' }, h('b', null, lesson.number), ' ', lesson.start) : null,
  h('div', { class: 'lesson-main' },
    // Компактна картка (тиждень): назва першою, мітки — в одному рядку з аудиторією/викладачем.
    compact ? null : badges.length ? h('div', { class: 'badges' }, badges) : null,
    h('h3', { class: 'lesson-title' }, title),
    compact
      ? h('div', { class: 'lesson-meta' }, badges, metaItems)
      : metaItems.length ? h('div', { class: 'lesson-meta' }, metaItems) : null,
    extras,
    compact ? null : lessonFoot(timing, { next, foreign, actions }),
  ));
}

/** Низ картки: «ще N хв» з прогресом для поточної пари, «через N хв» для наступної, дії праворуч. */
function lessonFoot(timing, { next, foreign, actions }) {
  let status = null;
  // Для чужих (прихованих) пар час не показуємо — лише шум.
  if (!foreign && timing?.state === 'now') {
    const pct = timing.progress != null ? Math.round(timing.progress * 100) : null;
    status = h('div', { class: 'lesson-status is-now' },
      pct != null
        ? h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Минуло від початку пари', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
          h('span', { style: `width:${pct}%` }))
        : null,
      h('span', null, timing.left != null ? `ще ${formatDuration(timing.left)}` : 'зараз'));
  } else if (!foreign && next && timing?.startsIn != null) {
    status = h('div', { class: 'lesson-status is-next' }, `Далі · через ${formatDuration(timing.startsIn)}`);
  }
  if (!status && !actions) return null;
  return h('div', { class: 'lesson-foot' }, status, actions);
}

/**
 * Один день: пари по слотах, «вікна» між ними, порожні слоти для аудиторії.
 * opts.freeSlots — показувати незайняті номери пар (режим «аудиторія»); opts.bells — «дзвінки» з даних.
 */
export function dayBlock(date, lessons, opts) {
  const { mode, meta, freeSlots = false, gaps = false, hiddenIds = new Set(), actionsFor } = opts;
  if (!inDataRange(date, meta)) return noData(date, meta);

  let slots = groupBySlot(lessons);
  if (freeSlots && meta?.bells?.length) {
    const byNumber = new Map(slots.map((s) => [s.number, s]));
    const maxUsed = Math.max(0, ...slots.map((s) => s.number));
    const bells = meta.bells.filter((b) => b.number <= Math.max(maxUsed, 6));
    slots = [...bells.map((b) => byNumber.get(b.number) ?? { ...b, lessons: [] }),
      ...slots.filter((s) => !bells.some((b) => b.number === s.number))].sort((a, b) => a.number - b.number);
  }
  if (!slots.length) return h('div', { class: 'empty' }, h('p', null, 'Пар немає'));

  const nextId = findNext(lessons.filter((l) => !hiddenIds.has(l.id)));
  const complete = meta?.coverage?.complete;
  const out = [];
  let prevEnd = null;
  for (const slot of slots) {
    const startMin = toMinutes(slot.start);
    if (gaps && prevEnd != null && startMin != null && slot.lessons.length && startMin - prevEnd > 30) {
      out.push(h('div', { class: 'gap' }, `Вікно · ${formatDuration(startMin - prevEnd)}`));
    }
    if (slot.lessons.length) prevEnd = toMinutes(slot.end) ?? prevEnd;
    const timing = slot.lessons.length ? lessonTiming(slot.lessons[0]) : null;
    out.push(h('section', { class: ['slot', timing?.state && `is-${timing.state}`, !slot.lessons.length && 'is-free'] },
      h('div', { class: 'slot-time' },
        h('span', { class: 'slot-num' }, slot.number || '–'),
        h('span', null, slot.start),
        h('span', { class: 'muted' }, slot.end),
      ),
      h('div', { class: 'slot-body' },
        slot.lessons.length
          ? slot.lessons.map((l) => lessonCard(l, {
            mode,
            timing: lessonTiming(l),
            next: l.id === nextId,
            foreign: hiddenIds.has(l.id),
            actions: actionsFor?.(l) ?? null,
          }))
          : h('div', { class: 'free' }, complete ? 'Вільно' : 'Пар у наявних даних немає'),
      ),
    ));
  }
  return h('div', { class: 'day' }, out);
}

function findNext(lessons) {
  const upcoming = lessons
    .map((l) => ({ l, t: lessonTiming(l) }))
    .filter(({ t }) => t.state === 'future' && t.startsIn != null)
    .sort((a, b) => a.t.startsIn - b.t.startsIn);
  // «далі» показуємо лише для сьогоднішніх пар; lessonTiming для інших днів не рахує startsIn.
  return upcoming[0]?.l.id ?? null;
}

function noData(date, meta) {
  const r = meta?.range;
  return h('div', { class: 'empty' },
    h('p', null, 'На цю дату даних немає.'),
    r ? h('p', { class: 'muted' }, `Розклад у знімку: ${formatDateShort(r.from)} – ${formatDateShort(r.to)}.`) : null,
  );
}

/**
 * Тиждень. Сб/Нд показуються, лише якщо в них є пари.
 * Рендеримо обидва вигляди, CSS показує один: список днів на телефоні, сітку «дні × пари» на десктопі.
 */
export function weekBlock(date, lessons, opts) {
  const byDate = groupByDate(lessons);
  const today = todayIso();
  const days = weekDays(date).filter((d) => weekdayIndex(d) < 5 || byDate.has(d) || d === today);
  return h('div', { class: 'week-wrap' }, weekList(days, byDate, opts), weekGrid(days, byDate, lessons, opts));
}

function weekList(days, byDate, { mode, meta, hiddenIds = new Set(), dayHref }) {
  const today = todayIso();
  return h('div', { class: 'week' }, days.map((d) => {
    const list = byDate.get(d) ?? [];
    const rel = relativeDayLabel(d);
    let body;
    if (!inDataRange(d, meta)) body = h('p', { class: 'muted small' }, 'Немає даних');
    else if (!list.length) body = h('p', { class: 'muted small' }, 'Пар немає');
    else body = list.map((l) => lessonCard(l, { mode, compact: true, timing: lessonTiming(l), foreign: hiddenIds.has(l.id) }));
    return h('section', { class: ['week-day', d === today && 'is-today'] },
      h('a', { class: 'week-day-head', href: dayHref(d) },
        h('span', { class: 'week-day-name' }, weekdayShort(d)),
        h('span', null, formatDayLong(d).split(', ')[1]),
        rel ? h('span', { class: 'muted' }, rel) : null,
        list.length ? h('span', { class: 'count' }, `${list.length} ${plural(list.length, ['пара', 'пари', 'пар'])}`) : null,
      ),
      h('div', { class: 'week-day-body' }, body),
    );
  }));
}

/** Сітка тижня: стовпці — дні, рядки — номери пар («дзвінки» з даних). */
function weekGrid(days, byDate, lessons, { mode, meta, hiddenIds = new Set(), dayHref }) {
  const today = todayIso();
  const used = lessons.map((l) => l.number).filter((n) => n != null);
  if (!used.length) {
    const anyData = days.some((d) => inDataRange(d, meta));
    return h('div', { class: 'week-grid-empty empty' }, h('p', null, anyData ? 'Цього тижня пар немає' : 'На цей тиждень даних немає'));
  }
  const min = Math.min(...used);
  const max = Math.max(...used);
  const bells = new Map((meta?.bells ?? []).map((b) => [b.number, b]));
  const numbers = [...new Set([...used, ...[...bells.keys()].filter((n) => n >= min && n <= max)])].sort((a, b) => a - b);
  const timeOf = (n) => bells.get(n) ?? lessons.find((l) => l.number === n) ?? {};

  const head = [h('div', { class: 'wg-corner' })];
  for (const d of days) {
    const count = (byDate.get(d) ?? []).length;
    const rel = relativeDayLabel(d);
    head.push(h('a', { class: ['wg-day', d === today && 'is-today'], href: dayHref(d) },
      h('span', { class: 'wg-day-name' }, weekdayShort(d), ' ', formatDayLong(d).split(', ')[1]),
      h('span', { class: 'muted' }, !inDataRange(d, meta) ? 'немає даних'
        : [rel, count ? `${count} ${plural(count, ['пара', 'пари', 'пар'])}` : 'пар немає'].filter(Boolean).join(' · ')),
    ));
  }
  const rows = numbers.flatMap((n) => {
    const t = timeOf(n);
    return [
      h('div', { class: 'wg-time' }, h('span', { class: 'slot-num' }, n), h('span', null, t.start ?? ''), h('span', { class: 'muted' }, t.end ?? '')),
      ...days.map((d) => {
        const cell = (byDate.get(d) ?? []).filter((l) => l.number === n);
        return h('div', { class: ['wg-cell', d === today && 'is-today', !inDataRange(d, meta) && 'is-nodata'] },
          cell.map((l) => lessonCard(l, { mode, compact: true, grid: true, timing: lessonTiming(l), foreign: hiddenIds.has(l.id) })));
      }),
    ];
  });
  return h('div', { class: 'week-grid', style: `--days:${days.length}` }, head, rows);
}

export function notice(kind, ...content) {
  return h('div', { class: `notice notice-${kind}`, role: kind === 'warn' ? 'status' : null },
    icon(kind === 'warn' ? 'warn' : 'info'),
    h('div', null, content),
  );
}

/** Банер «дані неповні» для режимів аудиторії/викладача. */
/** Короткий банер «дані неповні»; tail — що саме це означає для поточного екрана. */
export function coverageNotice(meta, tail) {
  const c = meta?.coverage;
  if (!c || c.complete) return null;
  const names = c.loadedNames.slice(0, 3).join(', ') + (c.loadedNames.length > 3 ? '…' : '');
  // «1 групи», «1 з 4 груп»: відмінок визначає останнє число.
  const count = c.groupsTotal != null ? `${c.groupsLoaded} з ${c.groupsTotal}` : `${c.groupsLoaded}`;
  const word = plural(c.groupsTotal ?? c.groupsLoaded, ['групи', 'груп', 'груп']);
  return notice('warn',
    h('strong', null, 'Дані неповні: '),
    `у знімку розклад лише ${count} ${word}${names ? ` (${names})` : ''}. ${tail}`,
  );
}

/** Сайт не має стосунку до університету — це треба бачити на кожному екрані. */
export const UNOFFICIAL = 'Неофіційний студентський сайт, не повʼязаний з університетом. Важливе звіряйте з офіційним розкладом.';

export function dataFooter(meta) {
  if (!meta) return null;
  const parts = [];
  if (meta.generatedAt) {
    const d = new Date(meta.generatedAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(`Дані оновлено ${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} о ${d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`);
    }
  }
  if (meta.range) parts.push(`знімок ${formatDateShort(meta.range.from)} – ${formatDateShort(meta.range.to)}`);
  if (meta.coverage && !meta.coverage.complete) parts.push('дані неповні');
  return h('p', { class: 'data-footer' },
    UNOFFICIAL,
    h('br'),
    parts.join(' · '),
    parts.length ? h('br') : null,
    h('a', { href: href('issues') }, `Відомі проблеми прототипу (${KNOWN_ISSUES.length})`));
}
