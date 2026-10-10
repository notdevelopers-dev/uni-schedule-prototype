// Точка входу: завантаження даних, маршрутизація, спільний контекст для екранів.

import { DATA_SOURCE, REFRESH_AFTER_MS } from './config.js';
import { minutesNow, setNowOverride } from './lib/dates.js';
import { createRepository } from './data/repository.js';
import { makeClassifier } from './domain/electives.js';
import { defaultPrefs, loadPrefs, loadUi, savePrefs, saveUi } from './prefs.js';
import { h, replaceChildren } from './ui/dom.js';
import { go, href, parseHash } from './ui/router.js';
import { renderMy } from './ui/view-my.js';
import { renderLookup } from './ui/view-lookup.js';
import { renderExternal, renderGroupPicker, renderSettings } from './ui/view-settings.js';
import { renderIssues } from './ui/view-issues.js';

setNowOverride(new URLSearchParams(location.search).get('now'));

const repo = createRepository(DATA_SOURCE);
const state = {
  prefs: loadPrefs(),
  ui: loadUi(),
  session: { showHidden: false },
  meta: null,
  classify: makeClassifier(),
  nav: { prev: null, next: null },
};

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $subtitle = document.getElementById('subtitle');
const $toast = document.getElementById('toast');
const $actions = document.getElementById('topbar-actions');

let renderToken = 0;
let lastHash = null;

async function prepare() {
  await repo.load();
  state.meta = await repo.getMeta();
  // Кафедра викладача допомагає відрізнити іноземну мову від ДВВС (якщо в даних є obj_list викладачів).
  const teachers = await repo.listTeachers();
  const departments = new Map(teachers.filter((t) => t.department).map((t) => [t.key, t.department]));
  state.classify = makeClassifier((key) => departments.get(key) ?? '');
}

function setTitle(title, subtitle = null, link = null) {
  replaceChildren($title, link ? h('a', { href: link }, title) : title);
  $subtitle.textContent = subtitle ?? '';
  $subtitle.hidden = !subtitle;
  document.title = title && title !== 'Розклад пар' ? `${title} · Розклад пар` : 'Розклад пар';
}

let toastTimer = null;
/** Коротке повідомлення; action = { label, run } додає кнопку (наприклад, «Скасувати»). */
function toast(message, action = null) {
  const hide = () => $toast.classList.remove('is-visible', 'has-action');
  replaceChildren($toast, h('span', null, message),
    action ? h('button', { class: 'toast-action', type: 'button', onclick: () => { hide(); action.run(); } }, action.label) : null);
  $toast.classList.add('is-visible');
  $toast.classList.toggle('has-action', Boolean(action));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 5000 : 2600);
}

function makeContext(route, token) {
  const afterMount = [];
  const mount = { actions: null };
  const ctx = {
    repo,
    route,
    meta: state.meta,
    classify: state.classify,
    session: state.session,
    get prefs() { return state.prefs; },
    get ui() { return state.ui; },
    get nav() { return state.nav; },
    isCurrent: () => token === renderToken,
    setPrefs(patch) {
      state.prefs = { ...state.prefs, ...patch };
      savePrefs(state.prefs);
    },
    resetPrefs() {
      state.prefs = defaultPrefs();
    },
    setUi(patch) {
      state.ui = { ...state.ui, ...patch };
      saveUi(state.ui);
    },
    setNav(nav) {
      state.nav = nav;
    },
    setTitle,
    toast,
    go: (hash) => go(hash),
    redirect: (hash) => go(hash, { replace: true }),
    rerender: () => render(),
    afterMount: (fn) => afterMount.push(fn),
    // Кнопки праворуч у верхній панелі (напр. «День/Тиждень»); з'являються разом із новим екраном.
    setActions: (node) => { mount.actions = node; },
  };
  return { ctx, afterMount, mount };
}

async function render() {
  const token = ++renderToken;
  const route = parseHash();
  const hash = location.hash;
  const fresh = h('div', { class: 'view-inner' });
  state.nav = { prev: null, next: null };
  const { ctx, afterMount, mount } = makeContext(route, token);

  let name = route.name;
  if (!name) name = state.prefs.group ? 'my' : 'setup';
  document.body.classList.toggle('is-setup', name === 'setup');

  try {
    switch (name) {
      case 'my':
        await renderMy(fresh, ctx);
        break;
      case 'rooms':
      case 'teachers':
        await renderLookup(fresh, ctx, name);
        break;
      case 'settings':
        if (route.params[0] === 'group') await renderGroupPicker(fresh, ctx);
        else if (route.params[0] === 'external') await renderExternal(fresh, ctx);
        else await renderSettings(fresh, ctx);
        break;
      case 'issues':
        renderIssues(fresh, ctx);
        break;
      case 'setup':
        if (route.params[0] === 'options') await renderSettings(fresh, ctx, { setup: true });
        else await renderGroupPicker(fresh, ctx, { setup: true });
        break;
      default:
        ctx.redirect(href(state.prefs.group ? 'my' : 'setup'));
        return;
    }
  } catch (err) {
    console.error(err);
    fresh.replaceChildren(errorBox('Щось пішло не так під час показу розкладу.', err));
  }
  if (token !== renderToken) return;

  $view.replaceChildren(fresh);
  replaceChildren($actions, mount.actions);
  if (hash !== lastHash) window.scrollTo(0, 0);
  lastHash = hash;
  for (const a of document.querySelectorAll('.tabbar a')) {
    const active = a.dataset.tab === name;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  afterMount.forEach((fn) => fn());
}

function errorBox(message, err) {
  return h('div', { class: 'notice notice-warn error-box' },
    h('div', null,
      h('p', null, h('strong', null, message)),
      err ? h('p', { class: 'muted small' }, String(err.message ?? err)) : null,
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => location.reload() }, 'Спробувати ще раз'),
    ));
}

// Повернення на вкладку між парами: оновити час, а за потреби — і дані.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.meta) return;
  if (Date.now() - (repo.loadedAt ?? 0) > REFRESH_AFTER_MS && await repo.refresh()) {
    state.meta = await repo.getMeta();
    toast('Розклад оновлено');
  }
  render();
});

// Щохвилини оновлюємо «зараз / далі / прогрес» на екранах розкладу.
let lastMinute = minutesNow();
setInterval(() => {
  const m = minutesNow();
  if (m === lastMinute || document.visibilityState !== 'visible') return;
  lastMinute = m;
  const { name, params } = parseHash();
  if (name === 'my' || ((name === 'rooms' || name === 'teachers') && params[0])) render();
}, 15_000);

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowLeft') state.nav.prev?.();
  if (e.key === 'ArrowRight') state.nav.next?.();
});

window.addEventListener('hashchange', render);

prepare()
  .then(render)
  .catch((err) => {
    console.error(err);
    setTitle('Розклад пар');
    $view.replaceChildren(errorBox('Не вдалося завантажити розклад.', err));
  });
