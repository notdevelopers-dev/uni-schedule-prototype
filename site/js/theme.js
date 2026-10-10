// Тема оформлення: null — як у системі, 'light' чи 'dark' — вибір користувача.
// Кольори в CSS задані через light-dark(), тож досить поставити color-scheme на <html>.
// Збережену тему ще до першого відмалювання застосовує скрипт у <head> index.html, щоб сторінка не блимала.

export const THEMES = ['light', 'dark'];

export function applyTheme(theme, doc = globalThis.document) {
  if (!doc) return;
  const forced = THEMES.includes(theme) ? theme : null;
  if (forced) doc.documentElement.style.colorScheme = forced;
  else doc.documentElement.style.removeProperty('color-scheme');

  // Колір рядка браузера: у <head> два meta з media для світлої й темної системи.
  // Коли тему вибрано явно, вмикаємо лише відповідний; «як у системі» повертає початкові media.
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    meta.dataset.media ??= meta.getAttribute('media') ?? '';
    const scheme = meta.dataset.media.includes('dark') ? 'dark' : 'light';
    meta.setAttribute('media', forced ? (forced === scheme ? 'all' : 'not all') : meta.dataset.media);
  }
}
