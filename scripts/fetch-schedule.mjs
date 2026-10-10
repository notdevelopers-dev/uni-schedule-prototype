// Збирач розкладу: тягне з деканату розклад вибраних груп і пише пакет lnu-rozklad-bundle/1 у site/data.json.
// Деканат — чужий сервер, тож запитів якомога менше: список груп береться з попереднього знімка (оновлюється раз на
// LIST_MAX_AGE_DAYS днів або коли групи бракує), на коді -8 чи збої мережі збір зупиняється, решта груп лишається як була.
// Запускається щотижня з .github/workflows/update-schedule.yml, можна й локально:
//   node scripts/fetch-schedule.mjs
// Налаштування через змінні середовища:
//   GROUPS  — префікси назв груп через кому (за замовчуванням ФЕІ-21…ФЕІ-25);
//   WEEKS   — скільки тижнів після поточного брати (за замовчуванням 4);
//   OUT     — куди писати (за замовчуванням site/data.json);
//   REFRESH_LIST=1 — примусово перезапитати список груп;
//   ENDPOINT — адреса експорту (для перевірки на моку).
// Без залежностей, потрібен Node 22+.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { addDays, startOfWeek, todayIso, toUaDate } from '../site/js/lib/dates.js';
import { cyrillicLookalikes, displayText } from '../site/js/lib/text.js';
import { exportStatus } from '../site/js/data/psrozklad.js';

export const ENDPOINT = process.env.ENDPOINT || 'https://dekanat.lnu.edu.ua/cgi-bin/timetable_export.cgi';
export const DEFAULT_PREFIXES = ['ФЕІ-21', 'ФЕІ-22', 'ФЕІ-23', 'ФЕІ-24', 'ФЕІ-25'];
const FORMAT = 'lnu-rozklad-bundle/1';
const PAUSE_BETWEEN_REQUESTS_MS = 3000;
const RETRY_DELAY_MS = 30_000;
export const LIST_MAX_AGE_DAYS = 28;

/** «ФЕІ 21с», «FEI-21c», «ФЕI–21с» → «ФЕІ-21С»: для порівняння назв груп. */
export function groupKey(name) {
  return cyrillicLookalikes(displayText(name))
    .toUpperCase()
    .replace(/\s*[-‐‑–—\s]\s*/g, '-');
}

/** Чи належить група до одного з префіксів. «ФЕІ-21» бере «ФЕІ-21с», «ФЕІ-21м», але не «ФЕІ-215». */
export function matchesPrefix(name, prefixes) {
  const key = groupKey(name);
  return prefixes.some((p) => {
    const pk = groupKey(p);
    return key.startsWith(pk) && !/\d/.test(key.charAt(pk.length));
  });
}

/** obj_list груп → той самий obj_list, лише з потрібними групами (порожні факультети викидаємо). */
export function filterGroupList(json, prefixes) {
  const body = json?.psrozklad_export ?? json ?? {};
  const departments = (body.departments ?? [])
    .map((dep) => ({ ...dep, objects: (dep.objects ?? []).filter((o) => matchesPrefix(o.name, prefixes)) }))
    .filter((dep) => dep.objects.length);
  return { psrozklad_export: { ...body, departments } };
}

export function listObjects(json) {
  const body = json?.psrozklad_export ?? json ?? {};
  return (body.departments ?? []).flatMap((dep) =>
    (dep.objects ?? []).map((o) => ({ id: String(o.ID ?? o.id ?? '').trim(), name: displayText(o.name) })),
  ).filter((o) => o.id);
}

/**
 * Список груп з попереднього знімка, якщо він свіжий і в ньому є група на кожен префікс; інакше null (треба запитати).
 * ID груп у деканаті стабільні, тож щотижня тягнути весь список факультетів немає сенсу.
 */
export function reusableGroupList(previous, prefixes, nowMs, maxAgeDays = LIST_MAX_AGE_DAYS) {
  if (previous?.format !== FORMAT || !previous.lists?.group) return null;
  const at = Date.parse(previous.lists_fetched_at ?? '');
  if (!Number.isFinite(at) || nowMs - at > maxAgeDays * 86_400_000) return null;
  const names = listObjects(previous.lists.group).map((g) => g.name);
  return prefixes.every((p) => names.some((n) => matchesPrefix(n, [p]))) ? previous.lists.group : null;
}

/** Поточний тиждень (з понеділка) плюс weeks наступних. */
export function dateRange(today, weeks) {
  const from = startOfWeek(today);
  return { from, to: addDays(from, 7 * (weeks + 1) - 1) };
}

export function objListUrl(mode = 'group') {
  const q = new URLSearchParams({ req_type: 'obj_list', req_mode: mode, show_ID: 'yes', req_format: 'json', coding_mode: 'UTF8', bs: 'ok' });
  return `${ENDPOINT}?${q}`;
}

export function rozkladUrl({ id, from, to, mode = 'group' }) {
  const q = new URLSearchParams({
    req_type: 'rozklad', req_mode: mode, OBJ_ID: id, OBJ_name: '', dep_name: '', ros_text: 'separated',
    begin_date: toUaDate(from), end_date: toUaDate(to), req_format: 'json', coding_mode: 'UTF8', bs: 'ok',
  });
  return `${ENDPOINT}?${q}`;
}

/**
 * Збирає новий пакет. Якщо деканат відповів кодом, після якого знімок не можна перезаписувати
 * (-2/-3/-8/-70 тощо), лишає попередній розклад групи з попереднього пакета, якщо він є.
 * results: [{ id, name, export?, error?, fetchedAt }]
 */
export function buildBundle({ generatedAt, range, groupList, listsFetchedAt = null, results, previous }) {
  const prevById = new Map(
    (previous?.format === FORMAT ? previous.schedules ?? [] : [])
      .filter((s) => (s.mode ?? 'group') === 'group')
      .map((s) => [String(s.id), s]),
  );
  const log = [];
  const schedules = results.map((r) => {
    const status = r.export ? exportStatus(r.export?.psrozklad_export?.code) : null;
    if (status && !status.keepPrevious) {
      const count = r.export.psrozklad_export?.roz_items?.length ?? 0;
      log.push(`${r.name}: ${status.status === 'ok' ? `${count} пар` : `${status.message} (код ${status.code})`}`);
      return { mode: 'group', id: r.id, name: r.name, fetched_at: r.fetchedAt, export: r.export };
    }
    const why = status ? `${status.message} (код ${status.code})`
      : r.error ? `помилка запиту: ${r.error}` : 'не запитувалося (збір зупинено)';
    const prev = prevById.get(String(r.id));
    if (prev) {
      log.push(`${r.name}: ${why} — лишаю знімок від ${prev.fetched_at ?? '?'}`);
      return prev;
    }
    log.push(`${r.name}: ${why} — попереднього знімка немає`);
    const exp = r.export ?? { psrozklad_export: { roz_items: [], code: '-1' } };
    return { mode: 'group', id: r.id, name: r.name, fetched_at: r.fetchedAt, export: exp };
  });
  const bundle = {
    format: FORMAT,
    generated_at: generatedAt,
    range: { from: toUaDate(range.from), to: toUaDate(range.to) },
    lists_fetched_at: listsFetchedAt,
    lists: { group: groupList },
    schedules,
  };
  return { bundle, log };
}

/** Чи відрізняються пакети чимось, крім часу збору. */
export function sameContent(a, b) {
  const strip = (x) => JSON.stringify(x && {
    ...x, generated_at: null, lists_fetched_at: null, schedules: (x.schedules ?? []).map((s) => ({ ...s, fetched_at: null })),
  });
  return strip(a) === strip(b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET + JSON. Мережевий збій чи 5xx — один повтор через 30 с; коди деканату (зокрема -8) не повторюємо:
 * -8 означає, що сервер перевантажений, і повтор лише додасть навантаження.
 */
async function fetchJson(url, { attempts = 2 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(RETRY_DELAY_MS);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'unofficial-rozklad-collector (weekly)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse((await res.text()).replace(/^\uFEFF/, ''));
    } catch (err) {
      lastError = err;
      console.warn(`  спроба ${i + 1}/${attempts}: ${err.message}`);
    }
  }
  throw lastError;
}

async function readPrevious(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const prefixes = (process.env.GROUPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const groupsWanted = prefixes.length ? prefixes : DEFAULT_PREFIXES;
  const weeks = Number.parseInt(process.env.WEEKS ?? '4', 10);
  const out = process.env.OUT ?? new URL('../site/data.json', import.meta.url).pathname;
  const range = dateRange(todayIso(), Number.isFinite(weeks) && weeks >= 0 ? weeks : 4);
  const previous = await readPrevious(out);

  console.log(`Групи: ${groupsWanted.join(', ')}; період ${toUaDate(range.from)}–${toUaDate(range.to)}`);

  let groupList = process.env.REFRESH_LIST ? null : reusableGroupList(previous, groupsWanted, Date.now());
  let listsFetchedAt = previous?.lists_fetched_at ?? null;
  if (groupList) {
    console.log(`Список груп — з попереднього знімка (${listsFetchedAt})`);
  } else {
    try {
      groupList = filterGroupList(await fetchJson(objListUrl('group')), groupsWanted);
      listsFetchedAt = new Date().toISOString();
    } catch (err) {
      if (previous?.format !== FORMAT || !previous.lists?.group) throw new Error(`Список груп недоступний: ${err.message}`);
      console.warn(`Список груп недоступний (${err.message}), беру з попереднього знімка`);
      groupList = previous.lists.group;
    }
  }
  const groups = listObjects(groupList);
  if (!groups.length) throw new Error(`У списку груп немає жодної з: ${groupsWanted.join(', ')}`);
  console.log(`Знайдено ${groups.length}: ${groups.map((g) => g.name).join(', ')}`);

  const results = [];
  let stopped = null;
  for (const g of groups) {
    if (stopped) {
      results.push({ ...g, fetchedAt: null });
      continue;
    }
    await sleep(PAUSE_BETWEEN_REQUESTS_MS);
    const fetchedAt = new Date().toISOString();
    try {
      const json = await fetchJson(rozkladUrl({ id: g.id, ...range }));
      results.push({ ...g, fetchedAt, export: json });
      if (String(json?.psrozklad_export?.code ?? '').trim() === '-8') stopped = 'деканат на паузі через навантаження (код -8)';
    } catch (err) {
      results.push({ ...g, fetchedAt, error: err.message });
      stopped = `запит не вдався (${err.message})`;
    }
    if (stopped) console.warn(`Зупиняю збір: ${stopped}. Решта груп лишається з попереднього знімка.`);
  }

  const { bundle, log } = buildBundle({ generatedAt: new Date().toISOString(), range, groupList, listsFetchedAt, results, previous });
  for (const line of log) console.log(`  ${line}`);

  if (results.every((r) => !r.export) && !bundle.schedules.some((s) => s.export?.psrozklad_export?.roz_items?.length)) {
    throw new Error('Жодного розкладу не отримано — data.json не чіпаю');
  }
  if (sameContent(bundle, previous)) {
    console.log('Розклад не змінився — data.json не чіпаю');
    return;
  }
  await writeFile(`${out}.tmp`, `${JSON.stringify(bundle, null, 2)}\n`);
  await rename(`${out}.tmp`, out);
  console.log(`Записано ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
