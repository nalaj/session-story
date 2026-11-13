/**
 * Theme tokens, the pre-paint theme bootstrap, and the theme toggle,
 * shared by the story page (src/render/template.mjs) and the session
 * library index (src/render/library.mjs) so both pages look like one
 * product and remember one theme choice.
 */
import { icon } from "./icons.mjs";

export const THEME_STORAGE_KEY = "session-story-theme";

const DARK_TOKENS = `
  --bg: #0e1014;
  --surface: #151820;
  --surface-2: #1a1e27;
  --surface-3: #21262f;
  --border: #262c37;
  --border-strong: #3a4250;
  --text: #e7e9ee;
  --text-2: #a3abb8;
  --text-3: #808896;
  --accent: #7b93ff;
  --accent-ink: #9fb0ff;
  --accent-soft: rgba(123,147,255,.14);
  --accent-ring: rgba(123,147,255,.45);
  --add: #4cc27a;
  --add-bg: #13291c;
  --add-line: rgba(76,194,122,.11);
  --del: #f07178;
  --del-bg: #2d171a;
  --del-line: rgba(240,113,120,.11);
  --shadow-1: 0 1px 2px rgba(0,0,0,.45);
  --shadow-2: 0 14px 34px -16px rgba(0,0,0,.7), 0 2px 6px -2px rgba(0,0,0,.5);
  --motif: .5;
`;

/** Light tokens on :root, with the dark set applied by scheme or by choice. */
export const TOKENS_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f8;
  --surface: #ffffff;
  --surface-2: #f7f8fa;
  --surface-3: #eef0f4;
  --border: #e1e4ea;
  --border-strong: #c9ced8;
  --text: #15181e;
  --text-2: #586170;
  --text-3: #737b89;
  --accent: #4c6ef5;
  --accent-ink: #3b5bdb;
  --accent-soft: rgba(76,110,245,.10);
  --accent-ring: rgba(76,110,245,.35);
  --add: #1a7a42;
  --add-bg: #e6f6ec;
  --add-line: rgba(31,138,76,.10);
  --del: #c9363f;
  --del-bg: #fbe9eb;
  --del-line: rgba(201,54,63,.09);
  --shadow-1: 0 1px 2px rgba(20,24,32,.06), 0 1px 0 rgba(20,24,32,.03);
  --shadow-2: 0 10px 28px -14px rgba(20,24,32,.22), 0 2px 6px -2px rgba(20,24,32,.08);
  --motif: .8;
  --radius: 10px;
  --radius-sm: 6px;
  --gutter: clamp(16px, 4vw, 40px);
  --font: "Avenir Next", "IBM Plex Sans", "Source Sans 3", "Segoe UI Variable Text", "Helvetica Neue", system-ui, sans-serif;
  --mono: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_TOKENS}}
}
:root[data-theme="dark"] {${DARK_TOKENS}}
`;

/** The handful of element-level resets both pages build on. */
export const BASE_CSS = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 var(--font); -webkit-font-smoothing: antialiased; }
a { color: var(--accent-ink); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.icon { width: 16px; height: 16px; flex-shrink: 0; vertical-align: -3px; }
`;

/** The outcome pill, shown on the story header and on every index card. */
export const OUTCOME_CSS = `
.outcome-pill { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; background: var(--surface-3); color: var(--text-2); }
.outcome-completed { background: var(--add-bg); color: var(--add); }
.outcome-partial { background: var(--accent-soft); color: var(--accent-ink); }
.outcome-failed, .outcome-blocked { background: var(--del-bg); color: var(--del); }
`;

export const THEME_TOGGLE_CSS = `
.theme-toggle { display: inline-grid; place-items: center; width: 34px; height: 34px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); cursor: pointer; transition: color .15s ease, border-color .15s ease; }
.theme-toggle:hover { color: var(--text); border-color: var(--border-strong); }
.theme-toggle .icon { display: none; }
:root:not([data-theme]) .theme-toggle .icon-auto { display: block; }
:root[data-theme="light"] .theme-toggle .icon-sun { display: block; }
:root[data-theme="dark"] .theme-toggle .icon-moon { display: block; }
`;

/**
 * Runs in <head> before first paint: marks the document as scripted (so CSS
 * can hide inactive panels) and restores a saved theme choice before
 * anything is drawn, which avoids a flash of the wrong theme.
 */
export const THEME_BOOTSTRAP = `
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  try {
    var saved = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) {}
})();
`;

/** Theme: system -> dark -> light -> system, persisted when storage allows. */
export const THEME_TOGGLE_JS = `
(function () {
  var root = document.documentElement;
  var themeBtn = document.querySelector('.theme-toggle');
  if (!themeBtn) return;
  function syncThemeLabel() {
    var name = root.getAttribute('data-theme') || 'system';
    themeBtn.setAttribute('aria-label', 'Theme: ' + name);
    themeBtn.title = 'Theme: ' + name + ' (click to change)';
  }
  themeBtn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : (current === 'light' ? null : 'dark');
    if (next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
    try {
      if (next) localStorage.setItem('${THEME_STORAGE_KEY}', next);
      else localStorage.removeItem('${THEME_STORAGE_KEY}');
    } catch (e) {}
    syncThemeLabel();
  });
  syncThemeLabel();
})();
`;

/** The toggle button itself; CSS shows whichever icon matches the state. */
export function themeToggleButton() {
  return (
    `<button class="theme-toggle" type="button" aria-label="Theme: system" title="Toggle theme">` +
    `${icon("sun")}${icon("moon")}${icon("auto")}</button>`
  );
}
