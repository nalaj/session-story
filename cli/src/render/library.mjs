/**
 * The session library: many stories in one folder, browsable.
 *
 * A story page is still one self-contained file — the library only adds
 * siblings next to it. `index.json` is the durable manifest; `sessions.js`
 * and `index.html` are regenerated from it on every render. `sessions.js`
 * is a classic script rather than JSON on purpose: `fetch()` of a sibling
 * file is blocked under `file://`, but `<script src>` is not, which is what
 * lets a story page offer a session switcher with no server. A story
 * copied out of the folder simply loses that script and falls back to
 * being what it always was: one page, complete on its own.
 */
import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import {
  storyTitle, formatDuration, formatDate, plural, OUTCOME_LABELS, formatTokens, formatCost, usageTotals,
} from './lenses.mjs';
import {
  TOKENS_CSS,
  BASE_CSS,
  OUTCOME_CSS,
  THEME_TOGGLE_CSS,
  THEME_BOOTSTRAP,
  THEME_TOGGLE_JS,
  themeToggleButton,
} from './theme.mjs';

/** Default folder name, relative to the project the session ran in. */
export const LIBRARY_DIR = '.session-stories';
export const MANIFEST_FILE = 'index.json';
export const SESSIONS_FILE = 'sessions.js';
export const INDEX_FILE = 'index.html';

const SLUG_MAX = 60;
const MINUS = '−'; // U+2212, reads as a proper minus next to "+"

function slugify(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= SLUG_MAX) return slug;
  // Cut back to a word boundary so the filename doesn't end mid-word.
  const cut = slug.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > SLUG_MAX / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

function datePart(iso) {
  const d = iso ? new Date(iso) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

/**
 * The file a story is written to: dated so the folder sorts by eye, keyed
 * by session id so re-rendering the same session overwrites it rather than
 * piling up copies, and slugged so you can tell them apart in a file list.
 */
export function storyFileName(story) {
  const id = String(story.session.id || 'unknown').slice(0, 8);
  const slug = slugify(storyTitle(story)) || 'session';
  return `${datePart(story.session.started_at)}-${id}-${slug}.html`;
}

/** One manifest record: everything the index and the switcher render from. */
export function libraryEntry(story, { file, generatedAt }) {
  const { session, totals } = story;
  return {
    file,
    id: session.id,
    chain: session.chain || [session.id],
    title: storyTitle(story),
    summary: session.summary || '',
    cwd: session.cwd || '',
    started_at: session.started_at || null,
    ended_at: session.ended_at || null,
    duration_ms: session.duration_ms || 0,
    totals: totals || { turns: 0, files: 0, added: 0, removed: 0, edits: 0 },
    usage: usageTotals(story),
    outcome: (story.report && story.report.outcome) || null,
    generated_at: generatedAt || new Date().toISOString(),
  };
}

/**
 * When a session was last active: its end, or its start when no end was
 * recorded. A session joined across /clear starts early but ends late.
 */
function lastActive(entry) {
  return String(entry.ended_at || entry.started_at || '');
}

/**
 * Whether a Claude Code process is still running this entry's session, or
 * any session joined into it: `live` is a set of session ids.
 */
export function isLiveEntry(entry, live) {
  if (!live || !live.size) return false;
  return [entry.id, ...(entry.chain || [])].some((id) => live.has(id));
}

/** Add or replace `entry` by session id, most recently active session first. */
export function upsertEntry(entries, entry) {
  return [...entries.filter((e) => e.id !== entry.id), entry]
    .sort((a, b) => lastActive(b).localeCompare(lastActive(a)));
}

/** Shortest id prefix that counts as naming a session. */
const MIN_PREFIX = 4;

/**
 * Split the manifest by what `keys` name: a full session id, an id prefix
 * (the 8 characters in each file name are enough), or a file name. A key
 * that names nothing, or more than one session, is reported rather than
 * guessed at, so a delete never removes a session nobody meant.
 */
export function selectEntries(entries, keys) {
  const picked = new Set();
  const unknown = [];
  const ambiguous = [];
  for (const key of keys) {
    const exact = entries.filter((e) => e.id === key || e.file === key);
    const hits = exact.length
      ? exact
      : key.length >= MIN_PREFIX ? entries.filter((e) => String(e.id).startsWith(key)) : [];
    if (!hits.length) unknown.push(key);
    else if (hits.length > 1) ambiguous.push(key);
    else picked.add(hits[0]);
  }
  return {
    removed: entries.filter((e) => picked.has(e)),
    kept: entries.filter((e) => !picked.has(e)),
    unknown,
    ambiguous,
  };
}

/** A POSIX shell word: single-quoted, with any single quote spliced in. */
export function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

/**
 * The sidecar the story pages load. Only the fields the switcher needs, so
 * the file stays small even after a few hundred sessions. `library`, the
 * folder, lets the switcher leave out what the index page hid.
 */
export function renderSessionsJs(entries, { library = '' } = {}) {
  const slim = entries.map((e) => ({
    file: e.file,
    id: e.id,
    title: e.title,
    started_at: e.started_at,
    ended_at: e.ended_at || null,
    outcome: e.outcome,
    totals: e.totals,
  }));
  // `</script` inside a string would end the element that loads this file.
  const json = JSON.stringify(slim, null, 2).replace(/<\//g, '<\\/');
  const dir = JSON.stringify(String(library)).replace(/<\//g, '<\\/');
  return `window.SESSION_STORY_LIBRARY = ${json};\n` + (library ? `window.SESSION_STORY_LIBRARY_DIR = ${dir};\n` : '');
}

const INDEX_STYLE = `
${TOKENS_CSS}
${BASE_CSS}
${OUTCOME_CSS}
${THEME_TOGGLE_CSS}
body { padding-bottom: 64px; }
[hidden] { display: none !important; } /* cards and bars set display, which would beat the attribute */
.lib-header { background: var(--surface); border-bottom: 1px solid var(--border); }
.lib-header-inner { max-width: 1100px; margin: 0 auto; padding: 34px var(--gutter) 26px; display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; justify-content: space-between; }
.lib-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 10px; }
.lib-header h1 { margin: 0 0 10px; font-size: clamp(20px, 2.4vw, 27px); letter-spacing: -.015em; font-weight: 650; }
.lib-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--text-2); font-size: 13px; }
.lib-meta > span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.lib-meta .cwd span { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.lib-tools { display: flex; align-items: center; gap: 10px; }
.lib-search { display: inline-flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; color: var(--text-3); }
.lib-search input { border: none; background: none; color: var(--text); font: inherit; padding: 8px 0; width: 210px; max-width: 42vw; }
.lib-search input:focus { outline: none; }
.lib-main { max-width: 1100px; margin: 0 auto; padding: 26px var(--gutter) 0; }
.lib-count { color: var(--text-3); font-size: 12.5px; margin: 0 0 14px; }
.session-list { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); }
.session-card { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); color: inherit; text-decoration: none; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.session-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-2); transform: translateY(-1px); }
.card-top { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.card-date { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11.5px; color: var(--text-3); }
.card-top .outcome-pill { padding: 2px 9px; font-size: 10px; }
.session-card h2 { margin: 0; font-size: 15.5px; font-weight: 620; line-height: 1.35; letter-spacing: -.01em; }
.card-summary { margin: 0; font-size: 13px; color: var(--text-2); line-height: 1.5; }
.card-chips { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: auto; padding-top: 4px; font-size: 12px; color: var(--text-2); }
.card-chips span { display: inline-flex; align-items: center; gap: 5px; }
.card-chips .add { color: var(--add); font-family: var(--mono); font-size: 11.5px; }
.card-chips .del { color: var(--del); font-family: var(--mono); font-size: 11.5px; }
.card-chain { display: inline-flex; align-items: center; gap: 5px; color: var(--text-3); }
.lib-empty { padding: 40px 0; color: var(--text-2); }
.lib-empty code { font-family: var(--mono); font-size: 12.5px; background: var(--surface-3); border-radius: 4px; padding: 2px 6px; }
.no-matches { padding: 30px 0; color: var(--text-3); }
.lib-filters { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin: 0 0 14px; }
.lib-periods, .lib-outcomes { display: flex; flex-wrap: wrap; gap: 6px; }
.lib-period, .lib-outcome-btn { display: inline-flex; align-items: center; padding: 5px 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; transition: color .15s ease, border-color .15s ease, background .15s ease; }
.lib-period:hover, .lib-outcome-btn:hover { color: var(--text); border-color: var(--border-strong); }
.lib-period[aria-pressed="true"], .lib-outcome-btn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.lib-view { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 8px 0; font-size: 12.5px; color: var(--text-2); }
.lib-view select, .lib-clear, .lib-mode { font: inherit; padding: 4px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); cursor: pointer; }
.lib-mode[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.session-list.compact { grid-template-columns: 1fr; gap: 6px; }
.session-list.compact .session-card { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 8px 14px; }
.session-list.compact .card-summary { display: none; }
.session-list.compact h2 { flex: 1 1 260px; margin: 0; font-size: 14px; }
html:not(.js) .lib-view { display: none; }
.session-item { position: relative; display: flex; }
.session-item > .session-card { flex: 1; min-width: 0; }
.session-item .card-top { padding-right: 30px; }
.card-hide { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--text-3); cursor: pointer; opacity: 0; transition: opacity .15s ease, color .15s ease, border-color .15s ease; }
.session-item:hover .card-hide, .card-hide:focus-visible { opacity: 1; }
.card-hide:hover { color: var(--text); border-color: var(--border); background: var(--surface); }
@media (hover: none) { .card-hide { opacity: 1; } }
.session-list.compact .card-hide { top: 50%; transform: translateY(-50%); }
.card-unhide { display: none; }
.session-item.is-hidden > .session-card { opacity: .55; border-style: dashed; }
.session-item.is-hidden .card-hide { display: none; }
.session-item.is-hidden .card-top { padding-right: 76px; }
.session-item.is-hidden .card-unhide { position: absolute; top: 10px; right: 10px; display: inline-flex; font: inherit; font-size: 12px; padding: 3px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); cursor: pointer; }
.session-list.compact .session-item.is-hidden .card-unhide { top: 50%; transform: translateY(-50%); }
.live-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; background: var(--accent-soft); color: var(--accent-ink); }
.live-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.card-pills { display: inline-flex; align-items: center; gap: 6px; }
.lib-hidden-toggle { font: inherit; padding: 4px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-2); cursor: pointer; margin-left: auto; }
.lib-hidden-toggle[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.lib-undo { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; max-width: calc(100vw - 32px); display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-2); font-size: 13px; color: var(--text-2); }
.lib-undo span { overflow-wrap: anywhere; }
.lib-undo button { font: inherit; padding: 3px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); cursor: pointer; }
.lib-count .roll-note { color: var(--text-3); }
@media print { .lib-tools, .lib-periods, .lib-outcomes, .theme-toggle, .card-hide, .card-unhide, .lib-hidden-toggle, .lib-undo { display: none; } }
`;

const INDEX_SCRIPT = THEME_TOGGLE_JS + `
(function () {
  // Filtering is a substring match over each card's own text plus a time
  // period over when it was last active, so the index needs no data beyond what it
  // already rendered. The rollup line is recomputed from the shown cards.
  var input = document.querySelector('.lib-search input');
  var periodBar = document.querySelector('.lib-periods');
  var outcomeBar = document.querySelector('.lib-outcomes');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.session-item'));
  var empty = document.querySelector('.no-matches');
  var count = document.querySelector('.lib-count');
  if (!cards.length) return;
  var list = document.querySelector('.session-list');
  var sortSel = document.querySelector('.lib-sort');
  var clearBtn = document.querySelector('.lib-clear');
  var modeBtns = Array.prototype.slice.call(document.querySelectorAll('.lib-mode'));
  var SORT_KEY = 'session-story-sort', MODE_KEY = 'session-story-mode';
  var sort = 'active', mode = 'cards';
  try { sort = localStorage.getItem(SORT_KEY) || 'active'; mode = localStorage.getItem(MODE_KEY) || 'cards'; } catch (e) {}
  if (!sortSel || !sortSel.querySelector('[value="' + sort + '"]')) sort = 'active';
  if (mode !== 'compact') mode = 'cards';
  var original = cards.slice();
  // Missing numeric values always sort last; ties keep the newest-first manifest order.
  function sortCards() {
    var by = { active: null, title: 'title', duration: 'duration', cost: 'cost', changed: 'changed' }[sort];
    var ordered = original.slice();
    if (by) ordered.sort(function (a, b) {
      if (by === 'title') return a.dataset.title < b.dataset.title ? -1 : a.dataset.title > b.dataset.title ? 1 : original.indexOf(a) - original.indexOf(b);
      var x = a.dataset[by] === '' ? null : Number(a.dataset[by]);
      var y = b.dataset[by] === '' ? null : Number(b.dataset[by]);
      if (x === null && y === null) return original.indexOf(a) - original.indexOf(b);
      if (x === null) return 1;
      if (y === null) return -1;
      return (y - x) || (original.indexOf(a) - original.indexOf(b));
    });
    ordered.forEach(function (c) { list.appendChild(c); });
  }
  function setMode() {
    if (list) list.classList.toggle('compact', mode === 'compact');
    modeBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  }

  // Cards are rendered in UTC; show each last-active time in the viewer's own zone.
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  Array.prototype.slice.call(document.querySelectorAll('.card-date time[datetime]')).forEach(function (el) {
    var d = new Date(el.getAttribute('datetime'));
    if (isNaN(d.getTime())) return;
    el.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  });
  var PERIOD_KEY = 'session-story-period';
  var period = 'all';
  try { period = localStorage.getItem(PERIOD_KEY) || 'all'; } catch (e) {}
  if (periodBar && !periodBar.querySelector('[data-period="' + period + '"]')) period = 'all';

  var OUTCOME_KEY = 'session-story-outcome';
  var outcome = 'all';
  try { outcome = localStorage.getItem(OUTCOME_KEY) || 'all'; } catch (e) {}
  if (outcomeBar && !outcomeBar.querySelector('[data-outcome-filter="' + outcome + '"]')) outcome = 'all';

  // The [from, to) window of a period in the viewer's local time; null for all time.
  function windowOf(key) {
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    switch (key) {
      case 'today': return [new Date(y, m, d), null];
      case '7d': return [new Date(y, m, d - 6), null];
      case '30d': return [new Date(y, m, d - 29), null];
      case 'month': return [new Date(y, m, 1), null];
      case 'last-month': return [new Date(y, m - 1, 1), new Date(y, m, 1)];
      default: return null;
    }
  }
  function inPeriod(card, win) {
    if (!win) return true;
    var t = Date.parse(card.dataset.active || '');
    if (isNaN(t)) return false;
    return t >= win[0].getTime() && (!win[1] || t < win[1].getTime());
  }
  function num(card, key) {
    var v = card.dataset[key];
    return v === undefined || v === '' ? null : Number(v);
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  // Same output as formatTokens and formatCost in src/render/lenses.mjs.
  function fmtTokens(n) {
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1000).toFixed(1) + 'k';
    return (n / 1e6).toFixed(1) + 'M';
  }
  function fmtCost(usd) { return usd < 0.01 ? '<$0.01' : '$' + usd.toFixed(2); }
  function setRoll(key, text) {
    var el = count && count.querySelector('[data-roll="' + key + '"]');
    if (el) el.textContent = text;
  }
  function showPart(key, on) {
    var el = count && count.querySelector('[data-roll-part="' + key + '"]');
    if (el) el.hidden = !on;
  }

  // Hidden sessions are this browser's choice, stored per library folder:
  // every file:// page shares one localStorage, so the key names the folder.
  var HIDDEN_KEY = list && list.dataset.library ? 'session-story-hidden:' + list.dataset.library : '';
  var hidden = {};
  var showHidden = false;
  if (HIDDEN_KEY) {
    try {
      var stored = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
      if (Array.isArray(stored)) stored.forEach(function (id) { hidden[id] = true; });
    } catch (e) {}
  }
  function saveHidden() {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(Object.keys(hidden))); } catch (e) {}
  }
  // A live session is never hidden, even under an id stored before it was resumed.
  function isHidden(card) { return Boolean(hidden[card.dataset.id]) && card.dataset.live !== 'true'; }

  function apply() {
    var q = input ? input.value.trim().toLowerCase() : '';
    var win = windowOf(period);
    var shown = [];
    var hiddenHits = 0;
    cards.forEach(function (card) {
      var o = card.dataset.outcome || 'unknown';
      var outcomeHit = outcome === 'all' ||
        (outcome === 'failed' ? (o === 'failed' || o === 'blocked') : o === outcome);
      var hit = (!q || card.dataset.search.indexOf(q) !== -1) && inPeriod(card, win) && outcomeHit;
      var gone = isHidden(card);
      card.classList.toggle('is-hidden', gone);
      card.hidden = !hit || (gone && !showHidden);
      // A hidden card shown for unhiding doesn't count toward the totals.
      if (hit && !gone) shown.push(card);
      if (hit && gone) hiddenHits++;
    });
    if (hiddenBtn) {
      var hiddenCount = cards.filter(isHidden).length;
      if (!hiddenCount) showHidden = false;
      hiddenBtn.hidden = !hiddenCount;
      hiddenBtn.textContent = 'Hidden (' + hiddenCount + ')';
      hiddenBtn.setAttribute('aria-pressed', String(showHidden));
    }
    if (empty) empty.hidden = shown.length > 0 || (showHidden && hiddenHits > 0);
    if (clearBtn) clearBtn.hidden = !(q || period !== 'all' || outcome !== 'all');
    if (!count) return;
    var sum = { turns: 0, added: 0, removed: 0, input: 0, output: 0, cost: 0 };
    var known = { input: 0, output: 0, cost: 0 };
    shown.forEach(function (card) {
      ['turns', 'added', 'removed', 'input', 'output', 'cost'].forEach(function (key) {
        var v = num(card, key);
        if (v === null) return;
        sum[key] += v;
        if (key in known) known[key]++;
      });
    });
    setRoll('sessions', plural(shown.length, 'session'));
    setRoll('turns', plural(sum.turns, 'turn'));
    setRoll('added', '+' + sum.added);
    setRoll('removed', '−' + sum.removed);
    setRoll('input', fmtTokens(sum.input));
    setRoll('output', fmtTokens(sum.output));
    setRoll('cost', fmtCost(sum.cost));
    setRoll('cost-note', 'for ' + known.cost + ' of ' + shown.length);
    showPart('input', known.input > 0);
    showPart('output', known.output > 0);
    showPart('cost', known.cost > 0);
    showPart('cost-note', known.cost > 0 && known.cost < shown.length);
  }

  if (periodBar) {
    periodBar.hidden = false;
    var buttons = Array.prototype.slice.call(periodBar.querySelectorAll('.lib-period'));
    function press() {
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.period === period)); });
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        period = b.dataset.period;
        try { localStorage.setItem(PERIOD_KEY, period); } catch (e) {}
        press();
        apply();
      });
    });
    press();
  }
  if (outcomeBar) {
    outcomeBar.hidden = false;
    var outcomeButtons = Array.prototype.slice.call(outcomeBar.querySelectorAll('.lib-outcome-btn'));
    function pressOutcome() {
      outcomeButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.outcomeFilter === outcome)); });
    }
    outcomeButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        outcome = b.dataset.outcomeFilter;
        try { localStorage.setItem(OUTCOME_KEY, outcome); } catch (e) {}
        pressOutcome();
        apply();
      });
    });
    pressOutcome();
  }
  if (input) input.addEventListener('input', apply);
  if (sortSel) {
    sortSel.value = sort;
    sortSel.addEventListener('change', function () {
      sort = sortSel.value;
      try { localStorage.setItem(SORT_KEY, sort); } catch (e) {}
      sortCards();
    });
  }
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.dataset.mode;
      try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
      setMode();
    });
  });
  // Clearing resets what narrows the list, not how it is sorted or shown.
  if (clearBtn) clearBtn.addEventListener('click', function () {
    if (input) input.value = '';
    period = 'all'; outcome = 'all';
    try { localStorage.setItem(PERIOD_KEY, period); localStorage.setItem(OUTCOME_KEY, outcome); } catch (e) {}
    if (periodBar) Array.prototype.forEach.call(periodBar.querySelectorAll('.lib-period'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.period === 'all')); });
    if (outcomeBar) Array.prototype.forEach.call(outcomeBar.querySelectorAll('.lib-outcome-btn'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.outcomeFilter === 'all')); });
    apply();
  });
  // The page is a file and can't remove files, so "hide" is what it offers:
  // the session leaves this list (and the switcher on story pages) in this
  // browser, and its page stays on disk to come back to.
  var hiddenBtn = document.querySelector('.lib-hidden-toggle');
  var undoBox = document.querySelector('.lib-undo');
  var undoTimer = null;
  function setHidden(card, on) {
    if (on) hidden[card.dataset.id] = true;
    else delete hidden[card.dataset.id];
    saveHidden();
    apply();
  }
  if (HIDDEN_KEY) {
    cards.forEach(function (card) {
      var hideBtn = card.querySelector('.card-hide');
      var unhideBtn = card.querySelector('.card-unhide');
      if (hideBtn) {
        hideBtn.hidden = false;
        hideBtn.addEventListener('click', function () {
          setHidden(card, true);
          if (!undoBox) return;
          undoBox.querySelector('span').textContent = 'Hid \u201c' + hideBtn.dataset.title + '\u201d.';
          undoBox.hidden = false;
          undoBox.querySelector('button').onclick = function () {
            setHidden(card, false);
            undoBox.hidden = true;
          };
          clearTimeout(undoTimer);
          undoTimer = setTimeout(function () { undoBox.hidden = true; }, 8000);
        });
      }
      if (unhideBtn) unhideBtn.addEventListener('click', function () { setHidden(card, false); });
    });
    if (hiddenBtn) hiddenBtn.addEventListener('click', function () {
      showHidden = !showHidden;
      apply();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && undoBox) undoBox.hidden = true; });
  }
  var viewBar = document.querySelector('.lib-view');
  if (viewBar) viewBar.hidden = false;
  sortCards();
  setMode();
  apply();
})();
`;

function outcomePill(outcome) {
  if (!outcome) return '';
  return `<span class="outcome-pill outcome-${escapeHtml(outcome)}">${OUTCOME_LABELS[outcome] || escapeHtml(outcome)}</span>`;
}

const PERIODS = [
  ['today', 'Today'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['all', 'All time'],
];

/** Hidden until the page script runs: without it the buttons would do nothing. */
function periodFilter() {
  const buttons = PERIODS.map(([key, label]) =>
    `<button type="button" class="lib-period" data-period="${key}" aria-pressed="${key === 'all'}">${label}</button>`
  ).join('');
  return `<div class="lib-periods" role="group" aria-label="Time period" hidden>${buttons}</div>`;
}

const OUTCOMES = [
  ['all', 'All outcomes'],
  ['completed', 'Completed'],
  ['partial', 'Partial'],
  ['failed', 'Failed / Blocked'],
  ['unknown', 'Not recorded'],
];

function outcomeFilter() {
  const buttons = OUTCOMES.map(([key, label]) =>
    `<button type="button" class="lib-outcome-btn" data-outcome-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`
  ).join('');
  return `<div class="lib-outcomes" role="group" aria-label="Outcome filter" hidden>${buttons}</div>`;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** An entry's usage; manifests written before usage was recorded have none. */
function usageOf(entry) {
  const u = entry.usage || {};
  return {
    input_tokens: isNum(u.input_tokens) ? u.input_tokens : null,
    output_tokens: isNum(u.output_tokens) ? u.output_tokens : null,
    cost_usd: isNum(u.cost_usd) ? u.cost_usd : null,
  };
}

const dataNum = (v) => (isNum(v) ? String(v) : '');

function sessionCard(entry, { live = false, hideable = false } = {}) {
  const totals = entry.totals || {};
  const usage = usageOf(entry);
  const tokens = [
    usage.input_tokens !== null ? `${formatTokens(usage.input_tokens)} in` : '',
    usage.output_tokens !== null ? `${formatTokens(usage.output_tokens)} out` : '',
  ].filter(Boolean).join(' · ');
  const chain = (entry.chain || []).length;
  const search = [entry.title, entry.summary, entry.id, entry.started_at, entry.outcome]
    .filter(Boolean).join(' ').toLowerCase();

  return (
    `<div class="session-item" data-search="${escapeHtml(search)}"` +
    ` data-active="${escapeHtml(lastActive(entry))}" data-outcome="${escapeHtml(entry.outcome || 'unknown')}"` +
    ` data-turns="${totals.turns || 0}" data-title="${escapeHtml(String(entry.title || '').toLowerCase())}"` +
    ` data-duration="${dataNum(entry.duration_ms || null)}" data-changed="${(totals.added || 0) + (totals.removed || 0)}"` +
    ` data-added="${totals.added || 0}" data-removed="${totals.removed || 0}"` +
    ` data-input="${dataNum(usage.input_tokens)}" data-output="${dataNum(usage.output_tokens)}"` +
    ` data-cost="${dataNum(usage.cost_usd)}" data-id="${escapeHtml(entry.id)}"${live ? ' data-live="true"' : ''}>` +
    `<a class="session-card" href="${escapeHtml(entry.file)}">` +
    `<span class="card-top">` +
    `<span class="card-date" title="Last active">${icon('clock')}<time datetime="${escapeHtml(lastActive(entry))}">${escapeHtml(formatDate(lastActive(entry)))}</time></span>` +
    `<span class="card-pills">` +
    (live ? `<span class="live-pill" title="A Claude Code session is still running this">Live</span>` : '') +
    outcomePill(entry.outcome) +
    `</span>` +
    `</span>` +
    `<h2>${escapeHtml(entry.title || 'Session story')}</h2>` +
    (entry.summary ? `<p class="card-summary">${escapeHtml(entry.summary)}</p>` : '') +
    `<span class="card-chips">` +
    `<span>${icon('turns')}${totals.turns || 0} ${plural(totals.turns || 0, 'turn')}</span>` +
    `<span>${icon('files')}${totals.files || 0} ${plural(totals.files || 0, 'file')}</span>` +
    `<span class="add">+${totals.added || 0}</span>` +
    `<span class="del">${MINUS}${totals.removed || 0}</span>` +
    (entry.duration_ms ? `<span>${icon('clock')}${escapeHtml(formatDuration(entry.duration_ms))}</span>` : '') +
    (tokens ? `<span title="Tokens, input incl. cache">${icon('sparkle')}${tokens}</span>` : '') +
    (usage.cost_usd !== null ? `<span title="Estimated cost at API list prices">${icon('cost')}${formatCost(usage.cost_usd)}</span>` : '') +
    (chain > 1 ? `<span class="card-chain">${icon('branch')}${chain} joined</span>` : '') +
    `</span>` +
    `</a>` +
    // A running session can't be hidden: it is the one you are most likely to look for.
    (hideable && !live
      ? `<button type="button" class="card-hide" data-title="${escapeHtml(entry.title || 'Session story')}"` +
        ` aria-label="Hide this session" title="Hide this session" hidden>${icon('eye-off')}</button>` +
        `<button type="button" class="card-unhide">Unhide</button>`
      : '') +
    `</div>`
  );
}

/**
 * The gallery: one card per session, newest first, with a client-side
 * filter. Self-contained like the story pages, and links to them by
 * relative path so the whole folder can be moved or zipped as a unit.
 * `library` is the library's folder: it keys the sessions this browser
 * hides, and without it the page offers no hide actions. `live` is the set
 * of session ids still running, whose cards can't be hidden.
 */
export function renderIndexPage(entries, { cwd = '', library = '', live = new Set() } = {}) {
  const project = cwd ? cwd.split('/').filter(Boolean).pop() || cwd : 'Session stories';
  const rollup = { turns: 0, added: 0, removed: 0, input: 0, output: 0, cost: 0 };
  const known = { input: 0, output: 0, cost: 0 };
  for (const entry of entries) {
    const t = entry.totals || {};
    const u = usageOf(entry);
    rollup.turns += t.turns || 0;
    rollup.added += t.added || 0;
    rollup.removed += t.removed || 0;
    for (const [key, v] of [['input', u.input_tokens], ['output', u.output_tokens], ['cost', u.cost_usd]]) {
      if (v === null) continue;
      rollup[key] += v;
      known[key]++;
    }
  }
  // Every part carries a data-roll key so the page script can recompute it
  // for the sessions a filter leaves; usage parts hide when nothing shown has them.
  const part = (key, on, html) => `<span data-roll-part="${key}"${on ? '' : ' hidden'}>${html}</span>`;
  const count =
    `<p class="lib-count">` +
    `<span data-roll="sessions">${entries.length} ${plural(entries.length, 'session')}</span> · ` +
    `<span data-roll="turns">${rollup.turns} ${plural(rollup.turns, 'turn')}</span> · ` +
    `<span class="add" data-roll="added">+${rollup.added}</span> ` +
    `<span class="del" data-roll="removed">${MINUS}${rollup.removed}</span>` +
    part('input', known.input > 0, ` · <span data-roll="input">${formatTokens(rollup.input)}</span> in`) +
    part('output', known.output > 0, ` · <span data-roll="output">${formatTokens(rollup.output)}</span> out`) +
    part('cost', known.cost > 0, ` · <span data-roll="cost">${formatCost(rollup.cost)}</span>`) +
    part('cost-note', known.cost > 0 && known.cost < entries.length,
      ` <span class="roll-note">(cost <span data-roll="cost-note">for ${known.cost} of ${entries.length}</span>)</span>`) +
    `</p>`;

  const body = entries.length
    ? `<div class="lib-filters">${periodFilter()}${outcomeFilter()}</div>` +
      `<div class="lib-view" hidden>` +
      `<label>Sort <select class="lib-sort">` +
      `<option value="active">Last active</option><option value="title">Title A–Z</option>` +
      `<option value="duration">Longest duration</option><option value="cost">Highest cost</option>` +
      `<option value="changed">Most changed lines</option></select></label>` +
      `<span role="group" aria-label="Layout"><button type="button" class="lib-mode" data-mode="cards" aria-pressed="true">Cards</button> ` +
      `<button type="button" class="lib-mode" data-mode="compact" aria-pressed="false">Compact</button></span>` +
      `<button type="button" class="lib-clear" hidden>Clear filters</button>` +
      (library ? `<button type="button" class="lib-hidden-toggle" aria-pressed="false" hidden></button>` : '') +
      `</div>` +
      count +
      `<div class="session-list"${library ? ` data-library="${escapeHtml(library)}"` : ''}>` +
      `${entries.map((e) => sessionCard(e, { live: isLiveEntry(e, live), hideable: Boolean(library) })).join('')}</div>` +
      `<p class="no-matches" hidden>No sessions match these filters. Use Clear filters to see all.</p>` +
      (library
        ? `<div class="lib-undo" role="status" hidden><span></span><button type="button">Undo</button></div>`
        : '')
    : `<p class="lib-empty">No sessions yet. Run <code>story render</code> and this page will list it.</p>`;

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>Session stories — ${escapeHtml(project)}</title>\n` +
    `<script>${THEME_BOOTSTRAP}</script>\n` +
    `<style>${INDEX_STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<header class="lib-header"><div class="lib-header-inner">` +
    `<div>` +
    `<div class="lib-eyebrow">${icon('story')}<span>Session stories</span></div>` +
    `<h1>${escapeHtml(project)}</h1>` +
    `<div class="lib-meta">` +
    (cwd ? `<span class="cwd">${icon('folder')}<span>${escapeHtml(cwd)}</span></span>` : '') +
    `</div></div>` +
    `<div class="lib-tools">` +
    `<label class="lib-search">${icon('search')}` +
    `<input type="search" placeholder="Filter sessions" aria-label="Filter sessions">` +
    `</label>` +
    themeToggleButton() +
    `</div>` +
    `</div></header>\n` +
    `<main class="lib-main">${body}</main>\n` +
    `<script>${INDEX_SCRIPT}</script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
