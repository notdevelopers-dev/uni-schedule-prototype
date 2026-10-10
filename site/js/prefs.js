// Вибір користувача в localStorage: група, підгрупа, приховані й сторонні вибіркові, викладач англійської.
// Без localStorage (приватний режим, заблоковані дані) сайт працює, але вибір не збережеться.

const PREFS_KEY = 'lnu-rozklad:prefs:v1';
const UI_KEY = 'lnu-rozklad:ui:v1';
const RECENT_MAX = 6;

export function defaultPrefs() {
  return {
    version: 2,
    group: null, //             { id, name }
    subgroup: null, //          1 | 2 | … | null (не фільтрувати)
    englishTeacher: null, //    { key, name } | null — показувати всіх викладачів іноземної
    hiddenElectives: [], //     «не моє» з «Збірної групи»: [{ titleKey, title, teacherKey|null, teacherName|null }]
    externalElectives: [], //   сторонні дисципліни з розкладу викладача: [{ titleKey, title, teacherKey, teacherName }]
  };
}

function storage() {
  try {
    const s = window.localStorage;
    const probe = '__lnu_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export const storageAvailable = () => storage() !== null;

function readJson(key) {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : null);

const entry = (e) => ({
  titleKey: e.titleKey,
  title: str(e.title) ?? e.titleKey,
  teacherKey: str(e.teacherKey),
  teacherName: str(e.teacherName),
});
const entries = (list) => (Array.isArray(list) ? list.filter((e) => isObj(e) && str(e.titleKey)).map(entry) : []);

/** Перевіряє збережене значення поле за полем: зіпсований запис не ламає сайт. */
function sanitize(raw) {
  const p = defaultPrefs();
  if (!isObj(raw)) return p;
  if (isObj(raw.group) && (str(raw.group.id) || str(raw.group.name))) {
    p.group = { id: str(raw.group.id), name: str(raw.group.name) ?? '' };
  }
  if (Number.isInteger(raw.subgroup) && raw.subgroup > 0) p.subgroup = raw.subgroup;
  if (isObj(raw.englishTeacher) && str(raw.englishTeacher.key)) {
    p.englishTeacher = { key: raw.englishTeacher.key, name: str(raw.englishTeacher.name) ?? raw.englishTeacher.key };
  }
  p.hiddenElectives = entries(raw.hiddenElectives);
  p.externalElectives = entries(raw.externalElectives).filter((e) => e.teacherKey);
  // v1 зберігав «лише мої» вибіркові (electives). Тепер усе показується за замовчуванням,
  // тож переносимо тільки сторонні дисципліни, решта списку втрачає сенс.
  if (Array.isArray(raw.electives)) {
    p.externalElectives.push(...entries(raw.electives.filter((e) => isObj(e) && e.external)).filter((e) => e.teacherKey));
  }
  return p;
}

export function loadPrefs() {
  return sanitize(readJson(PREFS_KEY));
}

export function savePrefs(prefs) {
  return writeJson(PREFS_KEY, prefs);
}

export function clearPrefs() {
  try {
    const { theme } = loadUi(); // тема — не «мій вибір», її не скидаємо
    storage()?.removeItem(PREFS_KEY);
    storage()?.removeItem(UI_KEY);
    if (theme) saveUi({ theme });
  } catch {
    // нічого страшного
  }
}

/** Дрібні зручності інтерфейсу: тема, останній вигляд «день/тиждень», нещодавні аудиторії й викладачі. */
export function loadUi() {
  const raw = readJson(UI_KEY);
  const recent = (v) => (Array.isArray(v) ? v.filter((x) => isObj(x) && str(x.key) && str(x.label)).slice(0, RECENT_MAX) : []);
  return {
    view: raw?.view === 'week' || raw?.view === 'day' ? raw.view : null, // null — ще не вибирали: вирішує ширина екрана
    theme: raw?.theme === 'light' || raw?.theme === 'dark' ? raw.theme : null, // null — як у системі
    recentRooms: recent(raw?.recentRooms),
    recentTeachers: recent(raw?.recentTeachers),
  };
}

export function pushRecent(list, item) {
  return [item, ...list.filter((x) => x.key !== item.key)].slice(0, RECENT_MAX);
}

export function saveUi(ui) {
  writeJson(UI_KEY, ui);
}

/** Той самий запис: та сама дисципліна й той самий (або будь-який) викладач. */
export function sameEntry(a, b) {
  return a.titleKey === b.titleKey && (a.teacherKey ?? null) === (b.teacherKey ?? null);
}
