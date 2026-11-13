import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import { renderHeader, renderReviewLens, renderDiffLens, renderStoryLens, storyTitle, storyDataFor } from './lenses.mjs';
import { CLIENT_SOURCE } from './hunk-html.mjs';
import { inert } from './inert.mjs';
import { renderStoryData } from './story-data.mjs';
import { renderReportLens } from './report.mjs';
import { METRICS_CSS } from './metrics-blocks.mjs';
import { TOKENS_CSS, BASE_CSS, OUTCOME_CSS, THEME_TOGGLE_CSS, THEME_BOOTSTRAP, THEME_TOGGLE_JS, themeToggleButton } from './theme.mjs';

// Runs in <head> before first paint: the shared theme restore. The two
// view options are not remembered, so every page opens on project files
// only, changed hunks only.
const BOOTSTRAP = THEME_BOOTSTRAP;

const STYLE = `
${TOKENS_CSS}
${BASE_CSS}

/* ---- header ------------------------------------------------------------ */
.story-header { position: relative; overflow: hidden; background: var(--surface); border-bottom: 1px solid var(--border); }
.header-motif { position: absolute; top: -20px; right: 0; height: calc(100% + 40px); width: min(640px, 70%); color: var(--accent); opacity: calc(.18 * var(--motif)); pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 45%); mask-image: linear-gradient(90deg, transparent, #000 45%); }
.header-inner { position: relative; max-width: 1240px; margin: 0 auto; padding: 24px var(--gutter) 20px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 8px; }
.story-header h1 { margin: 0 0 10px; font-size: clamp(20px, 2.4vw, 28px); line-height: 1.2; letter-spacing: -.02em; font-weight: 700; max-width: 40ch; }
.story-header .meta { display: flex; flex-wrap: wrap; gap: 6px 10px; color: var(--text-2); font-size: 12px; margin-bottom: 14px; }
.story-header .meta > span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 3px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; }
.story-header .meta .cwd span { font-family: var(--mono); font-size: 11.5px; overflow-wrap: anywhere; }
.story-header .meta .commits code { font-family: var(--mono); font-size: 11px; background: var(--surface-3); border-radius: 4px; padding: 1px 5px; }
.eyebrow .outcome-pill { margin-left: 2px; padding: 2px 10px; font-size: 10px; }
.story-header .summary { margin: 0 0 16px; max-width: 80ch; font-size: 14px; line-height: 1.55; color: var(--text); padding: 10px 14px; background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.totals { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-width: 1180px; }
.stat-tile { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); min-width: 0; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
.stat-tile:hover { transform: translateY(-1px); box-shadow: var(--shadow-2); border-color: var(--border-strong); }
.stat-icon { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--accent-soft); color: var(--accent-ink); flex-shrink: 0; }
.stat-tile.added .stat-icon { background: var(--add-bg); color: var(--add); }
.stat-tile.removed .stat-icon { background: var(--del-bg); color: var(--del); }
.stat-text { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.stat-value { font-size: 20px; font-weight: 700; letter-spacing: -.02em; }
.stat-label { font-size: 11.5px; color: var(--text-2); }
.session-strip-wrap { max-width: 760px; margin-top: 14px; padding: 8px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.session-strip { display: flex; gap: 2px; height: 8px; }
.strip-seg { display: flex; gap: 2px; min-width: 6px; height: 100%; border-radius: 3px; overflow: hidden; background: var(--surface-3); }
.strip-seg.empty { flex-grow: 0 !important; width: 8px; border: 1px dashed var(--border-strong); background: transparent; }
.strip-caption { display: flex; justify-content: space-between; margin-top: 5px; font-family: var(--mono); font-size: 10.5px; color: var(--text-3); }
.blind-spots { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--text-2); }
.blind-spots li { display: flex; gap: 8px; align-items: flex-start; }
.blind-spots .icon { color: var(--text-3); margin-top: 1px; }

/* ---- activity bars (shared) -------------------------------------------- */
.turn-bars { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.bar-track { flex: 1; display: flex; gap: 2px; height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.bar-add { display: block; height: 100%; background: var(--add); border-radius: 0 3px 3px 0; }
.bar-del { display: block; height: 100%; background: var(--del); border-radius: 0 3px 3px 0; }
.bar-label, .edit-stats { font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-3); white-space: nowrap; }
.edit-stats { display: inline-flex; gap: 8px; margin-left: auto; }
.edit-stats .add { color: var(--add); }
.edit-stats .del { color: var(--del); }
.turn-usage { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 8px 0 0; font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-3); }
.tu-sub { color: var(--text-2); }
.tu-partial { font-style: italic; }
.tu-break { color: var(--text-2); }
.active-time { color: var(--text-3); }
.turn-skills { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 8px 0 0; color: var(--text-3); }
.turn-skills svg { width: 12px; height: 12px; margin-right: 2px; }
.skill-chip { padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--text-2); font-family: var(--mono); font-size: 11px; }
.turn-panel > .turn-skills { margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.share-track { flex-basis: 100%; height: 4px; background: var(--surface-3); border-radius: 2px; overflow: hidden; }
.share-fill { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
.turn-panel > .turn-usage { margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--border); }

/* ---- lens nav ----------------------------------------------------------- */
.lens-nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 10px; padding: 8px var(--gutter); background: color-mix(in srgb, var(--surface) 90%, transparent); backdrop-filter: saturate(1.5) blur(12px); -webkit-backdrop-filter: saturate(1.5) blur(12px); border-bottom: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,.03); }
.lens-nav .tabs { display: inline-flex; gap: 3px; padding: 3px; background: var(--surface-3); border: 1px solid var(--border); border-radius: 10px; }
.lens-tab { display: inline-flex; align-items: center; gap: 7px; background: none; border: none; color: var(--text-2); font: inherit; font-size: 12.5px; font-weight: 550; padding: 5px 12px; border-radius: 7px; cursor: pointer; transition: all .15s ease; }
.lens-tab:hover { color: var(--text); }
.lens-tab[aria-selected="true"] { background: var(--surface); color: var(--accent-ink); box-shadow: var(--shadow-1); font-weight: 650; }
.tab-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 17px; padding: 0 5px; font-size: 10.5px; font-weight: 700; border-radius: 999px; background: var(--surface-2); color: var(--text-3); font-family: var(--mono); border: 1px solid var(--border); transition: all .15s ease; }
.lens-tab[aria-selected="true"] .tab-badge { background: var(--accent-soft); color: var(--accent-ink); border-color: var(--accent-ring); }
.lens-nav { flex-wrap: wrap; }
.lens-hint { display: inline-flex; align-items: center; gap: 5px; color: var(--text-3); font-size: 11.5px; padding: 3px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; }
.lib-nav { display: inline-flex; align-items: center; gap: 8px; }
.lib-nav[hidden] { display: none; }
.lib-back { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text-2); font-size: 12px; text-decoration: none; }
.lib-back:hover { color: var(--text); border-color: var(--border-strong); }
.lib-switch { max-width: min(320px, 40vw); padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; }
.lib-switch:hover { color: var(--text); border-color: var(--border-strong); }
.lens-hint kbd { font-family: var(--mono); font-size: 10.5px; padding: 1px 5px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--surface); }
${THEME_TOGGLE_CSS}

/* ---- scope filter & full-file view ------------------------------------- */
.v-all { display: none; }
html.show-outside .v-in { display: none; }
html.show-outside .v-all { display: inline; }
html:not(.show-outside) [data-outside="1"] { display: none !important; }
html.show-outside .only-when-filtered { display: none; }
.session-strip[data-scope="all"], .bar-track[data-scope="all"] { display: none; }
html.show-outside .session-strip[data-scope="all"], html.show-outside .bar-track[data-scope="all"] { display: flex; }
html.show-outside .session-strip[data-scope="in"], html.show-outside .bar-track[data-scope="in"] { display: none; }
.view-full { display: none; }
/* Code views are rendered by the page script; say so when it cannot run. */
html:not(.js) .view-hunks[data-diff]::before { content: "This diff needs JavaScript to show."; display: block; padding: 12px 16px; color: var(--text-3); font-size: 12.5px; font-style: italic; }
.no-js-note { max-width: 1240px; margin: 12px auto 0; padding: 0 var(--gutter); color: var(--text-2); font-size: 13px; }
html.full-context #lens-review .view-full, html.full-context #lens-diff .view-full { display: block; }
html.full-context #lens-review .view-hunks, html.full-context #lens-diff .view-hunks { display: none; }
/* #lens-story always shows just the changes, so the toggle never empties a card. */
.approx-note { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 16px; background: var(--surface-2); border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 12px; }
.approx-note .icon { color: var(--text-3); margin-top: 1px; }
.outside-note { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; max-width: 72ch; font-size: 12.5px; color: var(--text-2); }
.outside-note .icon { color: var(--accent-ink); margin-top: 1px; }
.opt-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); font: inherit; font-size: 12.5px; cursor: pointer; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.opt-toggle:hover { color: var(--text); border-color: var(--border-strong); }
.opt-toggle[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.opt-toggle .icon { width: 14px; height: 14px; }
.nav-opts { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }

/* ---- lens sections & panels -------------------------------------------- */
.lens-section { max-width: 1240px; margin: 0 auto; padding: 28px var(--gutter) 56px; }
.lens-intro { margin: -8px 0 18px; color: var(--text-2); font-size: 13.5px; }
html.js .lens-section:not(.active) { display: none; }
html:not(.js) .lens-section + .lens-section { border-top: 1px solid var(--border); }
.panel-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); border-radius: var(--radius) var(--radius) 0 0; }
.turn-time { display: block; font-family: var(--mono); font-size: 11.5px; color: var(--text-3); margin-bottom: 6px; }
.panel-head .turn-time { display: inline; margin: 0; }
.panel-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.panel-title .icon { color: var(--accent-ink); }
.panel-meta { display: inline-flex; align-items: center; gap: 12px; margin-left: auto; font-size: 12px; color: var(--text-3); }
.panel-meta .edit-stats { margin-left: 0; }
.churn-note { color: var(--accent-ink); }
.no-edits { display: flex; align-items: center; gap: 8px; margin: 0; padding: 28px 16px; color: var(--text-3); font-style: italic; }

/* ---- review lens -------------------------------------------------------- */
.review-lens { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 24px; align-items: start; }
.timeline { position: sticky; top: 58px; max-height: calc(100vh - 78px); overflow-y: auto; list-style: none; margin: 0; padding: 4px 6px 4px 0; display: flex; flex-direction: column; gap: 10px; }
.timeline::before { content: ""; position: absolute; left: 15px; top: 16px; bottom: 16px; width: 2px; background: var(--border-strong); opacity: .7; }
.timeline-item { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; padding: 12px 14px 12px 0; border-radius: var(--radius); cursor: pointer; transition: background .15s ease; }
.timeline-item:hover { background: var(--surface); }
.timeline-item.selected { background: var(--surface); box-shadow: var(--shadow-1), inset 0 0 0 1px var(--border); }
.turn-index { position: relative; z-index: 1; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong); color: var(--text-2); font-family: var(--mono); font-size: 12px; font-weight: 600; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.timeline-item.selected .turn-index { background: var(--accent); border-color: var(--accent); color: #fff; box-shadow: 0 0 0 4px var(--accent-soft); }
.turn-body { min-width: 0; }
.turn-prompt, .story-prompt { margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: var(--text); font-size: 13.5px; overflow-wrap: anywhere; white-space: pre-wrap; }
.timeline-item.selected .turn-prompt { background: var(--surface-3); }
.turn-summary { margin: 8px 0 0; color: var(--text-2); font-size: 13px; }
.turn-panels { min-width: 0; }
.turn-panel { scroll-margin-top: 72px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-2); overflow: hidden; }
.turn-panel + .turn-panel { margin-top: 20px; }
html.js .turn-panel:not(.active) { display: none; }
.panel-prompt-wrap { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.panel-prompt-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.panel-prompt-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); }
.copy-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--surface-3); border: 1px solid var(--border); border-radius: 4px; color: var(--text-2); font: inherit; font-size: 11px; cursor: pointer; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.copy-btn:hover { color: var(--text); border-color: var(--border-strong); }
.copy-btn.copied { background: var(--add-bg); color: var(--add); border-color: var(--add); }
.panel-prompt { margin: 0; max-height: 14em; overflow: auto; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: var(--text); font-size: 13.5px; overflow-wrap: anywhere; white-space: pre-wrap; }
.turn-replies { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
.replies-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.replies-head .icon { color: var(--accent-ink); }
.replies-earlier { margin-top: 8px; }
.replies-earlier > summary { cursor: pointer; font-size: 12px; color: var(--text-3); margin-bottom: 6px; }
.replies-earlier > summary:hover { color: var(--text-2); }
.reply { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.55; color: var(--text); }
.replies-earlier .reply { color: var(--text-2); padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px dashed var(--border); }
.reply-final { max-height: 22em; overflow: auto; }
.reply .turn-time { margin-bottom: 2px; }
.file-filter { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
html:not(.js) .file-filter { display: none; }
.file-filter-btn { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; appearance: none; background: var(--surface-3); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; color: var(--text-2); font-family: var(--mono); font-size: 11.5px; line-height: 1.45; text-align: left; cursor: pointer; transition: color .15s ease, border-color .15s ease, background .15s ease; }
.file-filter-btn:hover { color: var(--text); border-color: var(--border-strong); }
.file-filter-btn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.file-filter-btn .icon { width: 13px; height: 13px; }
.file-filter-name { overflow-wrap: anywhere; }
.file-filter-btn .edit-stats { margin-left: 0; }
.edit.file-hidden { display: none; }
.pick-hint { display: none; align-items: center; gap: 8px; margin: 0; padding: 22px 16px; color: var(--text-3); font-size: 13px; }
html.js .turn-panel.no-pick .pick-hint { display: flex; }
/* Floating previous/next step buttons, only while Review is showing. */
.step-nav { position: fixed; right: 24px; bottom: 24px; z-index: 20; display: flex; align-items: center; gap: 4px; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; box-shadow: var(--shadow-2); }
.step-btn { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-2); cursor: pointer; transition: background .15s ease, color .15s ease; }
.step-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent-ink); }
.step-btn:focus-visible { outline: 2px solid var(--accent-ring); outline-offset: 1px; }
.step-btn:disabled { opacity: .35; cursor: default; }
.step-pos { min-width: 52px; text-align: center; font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-2); }
html:not(.js) .step-nav { display: none; }
.story-card .turn-replies { margin: 12px 0 0; border: 1px solid var(--border); border-radius: var(--radius-sm); }

/* ---- edits & hunks ------------------------------------------------------ */
.edit { scroll-margin-top: 72px; } /* clear the sticky lens nav when a diff link scrolls here */
.edit.flash { animation: flash 1.2s ease-out both; }
@keyframes flash { 0%, 40% { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent-ring); } 100% { background: transparent; box-shadow: inset 0 0 0 2px transparent; } }
.edit-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-family: var(--mono); font-size: 12.5px; padding: 9px 16px; background: var(--surface-2); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.panel-head + .edit-header, details > summary + .edit-header { border-top: none; }
.edit-header > .icon { color: var(--text-3); }
.edit-file { font-weight: 600; overflow-wrap: anywhere; }
.badge { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font); font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; border-radius: 4px; padding: 2px 7px; background: var(--surface-3); color: var(--text-2); }
.badge .icon { width: 12px; height: 12px; }
.badge.create { background: var(--add-bg); color: var(--add); }
.badge.subagent { background: var(--accent-soft); color: var(--accent-ink); }
.badge.delete { background: var(--del-bg); color: var(--del); }
.badge.shell { background: var(--surface-3); color: var(--text-2); font-family: var(--mono); text-transform: none; letter-spacing: 0; }
.edit-unknown { display: flex; align-items: center; gap: 8px; margin: 0; padding: 14px 16px; color: var(--text-3); font-style: italic; }
table.hunk { border-collapse: collapse; width: 100%; font-family: var(--mono); font-size: 12.5px; line-height: 1.6; }
table.hunk + table.hunk { border-top: 1px dashed var(--border-strong); }
table.hunk td { padding: 0; vertical-align: top; }
table.hunk td.ln { width: 44px; padding: 0 8px; text-align: right; color: var(--text-3); user-select: none; font-variant-numeric: tabular-nums; background: var(--surface-2); border-right: 1px solid var(--border); }
table.hunk td.ln.new { border-right: none; }
table.hunk td.code { padding: 0 14px 0 10px; white-space: pre; position: relative; }
table.hunk td.code::before { content: " "; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
tr.hunk-line.add td.code { background: var(--add-line); }
tr.hunk-line.add td.code::before { background: var(--add); }
tr.hunk-line.add td.ln.new { background: var(--add-bg); color: var(--add); }
tr.hunk-line.del td.code { background: var(--del-line); }
tr.hunk-line.del td.code::before { background: var(--del); }
tr.hunk-line.del td.ln.old { background: var(--del-bg); color: var(--del); }
.edit { min-width: 0; }
.view { overflow-x: auto; }
/* Off-screen code blocks skip layout and paint; a long file or turn renders only what is in view. */
.edit, .occurrence { content-visibility: auto; contain-intrinsic-size: auto 400px; }
.turn-panel, .file-panel, .story-code { overflow-x: auto; }

/* ---- diff lens ---------------------------------------------------------- */
.diff-lens { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 24px; align-items: start; }
.diff-lens.empty { display: block; }
.diff-lens.empty .no-edits { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.file-nav { position: sticky; top: 58px; max-height: calc(100vh - 78px); overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-right: 4px; }
.file-search { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); padding: 0 10px; color: var(--text-3); }
.file-search:focus-within { border-color: var(--accent-ring); }
.file-search input { flex: 1; min-width: 0; border: none; background: none; color: var(--text); font-family: var(--mono); font-size: 12.5px; padding: 8px 0; }
.file-search input:focus { outline: none; }
html:not(.js) .file-search { display: none; }
.file-tree-item.name-hidden { display: none; }
.file-search-empty { margin: 0; padding: 8px 10px; color: var(--text-3); font-size: 12.5px; font-style: italic; }
.file-tree { list-style: none; margin: 0; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); display: flex; flex-direction: column; gap: 2px; }
.file-tree-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 7px; cursor: pointer; font-family: var(--mono); font-size: 12.5px; color: var(--text-2); transition: background .15s ease, color .15s ease; }
.file-tree-item .icon { color: var(--text-3); }
.file-tree-item .file-name { min-width: 0; overflow-wrap: anywhere; }
.file-tree-item:hover { background: var(--surface-2); color: var(--text); }
.file-tree-item.selected { background: var(--accent-soft); color: var(--accent-ink); }
.file-tree-item.selected .icon { color: var(--accent-ink); }
.file-tree-item.churn .file-name::after { content: " •"; color: var(--accent); }
.file-panels { min-width: 0; }
.file-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-2); }
.file-panel + .file-panel { margin-top: 20px; }
html.js .file-panel:not(.active) { display: none; }
.turn-tag { display: inline-flex; align-items: center; gap: 6px; margin: 14px 16px 6px; padding: 4px 10px; font: inherit; font-size: 11.5px; font-weight: 600; color: var(--accent-ink); background: var(--accent-soft); border: 1px solid var(--accent-ring); border-radius: 999px; cursor: pointer; transition: background .15s ease, border-color .15s ease, transform .1s ease, color .15s ease; }
.turn-tag:hover { background: var(--accent); color: #fff; transform: translateY(-1px); }
.turn-tag .icon { width: 13px; height: 13px; }
.turn-tag .jump-arrow { font-size: 11px; margin-left: 2px; opacity: .8; }

/* ---- story lens --------------------------------------------------------- */
.story-lens { position: relative; max-width: 76ch; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; padding-left: 44px; }
.story-lens::before { content: ""; position: absolute; left: 15px; top: 24px; bottom: 24px; width: 2px; background: var(--border-strong); opacity: .7; }
.story-card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); padding: 18px 22px 16px; }
.story-index { position: absolute; left: -44px; top: 18px; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; font-family: var(--mono); font-size: 12px; font-weight: 600; box-shadow: 0 0 0 4px var(--bg); }
.story-prompt { font-size: 15px; margin-bottom: 12px; }
.story-summary { margin: 0; font-size: 14.5px; color: var(--text); }
.story-summary:empty { display: none; }
.turn-filecount { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; color: var(--text-3); font-size: 12px; }
.story-filecount { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; color: var(--text-3); font-size: 12.5px; }
.story-code { margin: 12px -22px -16px; border-top: 1px solid var(--border); }
.story-code summary { display: flex; align-items: center; gap: 6px; padding: 10px 22px; cursor: pointer; color: var(--accent-ink); font-size: 12.5px; font-weight: 600; list-style: none; }
.story-code summary::-webkit-details-marker { display: none; }
.story-code summary::after { content: "▸"; margin-left: auto; transition: transform .15s ease; }
.story-code[open] summary::after { transform: rotate(90deg); }
.story-code summary:hover { background: var(--surface-2); }

/* ---- report lens ---------------------------------------------------------- */
.report-lens { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.report-block { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); padding: 18px 22px; }
.report-block h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--text); }
.report-block h2 .icon { color: var(--accent-ink); }
.report-empty { margin: 0; color: var(--text-3); font-style: italic; font-size: 13px; }
.report-count { margin: 0 0 10px; color: var(--text-3); font-size: 12.5px; }
.report-summary, .report-plan-text { margin: 8px 0 0; font-size: 14px; color: var(--text); }
.report-summary:first-child, .report-plan-text:first-child { margin-top: 0; }
.report-decisions { margin: 0; padding-left: 20px; font-size: 13.5px; color: var(--text); }
.report-decisions li + li { margin-top: 4px; }
.report-turn-plan { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; }
.report-turn-plan summary { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--accent-ink); font-size: 12.5px; font-weight: 600; list-style: none; }
.report-turn-plan summary::-webkit-details-marker { display: none; }
.report-turn-plan pre, .report-test-output pre { margin: 8px 0 0; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }

${OUTCOME_CSS}
.outcome-note { margin: 8px 0 0; font-size: 13px; color: var(--text-2); }

.cmd-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 7px 0; border-top: 1px solid var(--border); font-size: 12.5px; }
.cmd-row:first-of-type { border-top: none; }
.cmd-rest > .cmd-row:first-of-type { border-top: 1px solid var(--border); }
.show-more { display: inline-flex; align-items: center; margin-top: 10px; padding: 6px 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--accent-ink); font: inherit; font-size: 12.5px; cursor: pointer; }
.show-more:hover { border-color: var(--accent-ring); }
.cmd-status { display: inline-flex; width: 16px; height: 16px; }
.cmd-status.ok .icon { color: var(--add); }
.cmd-status.fail .icon { color: var(--del); }
.cmd-status.unknown .icon { color: var(--text-3); }
.cmd-turn { color: var(--text-3); font-family: var(--mono); font-size: 11px; }
.cmd-category { text-transform: capitalize; }
.cmd-text { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: var(--mono); color: var(--text); }
.cmd-exit { color: var(--text-3); font-size: 11.5px; }
.cmd-more { color: var(--text-3); font-style: italic; }
.report-test-output { flex-basis: 100%; margin-top: 4px; }
.report-test-output summary { cursor: pointer; color: var(--accent-ink); font-size: 12px; font-weight: 600; list-style: none; }
.report-test-output summary::-webkit-details-marker { display: none; }

.error-row { padding: 10px 0; border-top: 1px solid var(--border); }
.error-row:first-of-type { border-top: none; }
.error-row .badge-error { background: var(--del-bg); color: var(--del); }
.error-row .badge-rejected { background: var(--surface-3); color: var(--text-2); }
.error-tool { margin-left: 4px; font-weight: 600; color: var(--text); font-size: 12.5px; }
.error-message { margin: 6px 0 0; font-family: var(--mono); font-size: 12px; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.error-resolution { display: flex; align-items: flex-start; gap: 6px; margin: 6px 0 0; font-size: 12.5px; color: var(--add); }
.error-resolution .icon { color: var(--add); margin-top: 1px; }

.dep-manifest { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 0; font-size: 12.5px; }
.dep-manifest + .dep-manifest { border-top: 1px solid var(--border); }
.dep-rel { font-family: var(--mono); font-weight: 600; color: var(--text); }
.dep-added { color: var(--add); font-family: var(--mono); font-size: 12px; }
.dep-removed { color: var(--del); font-family: var(--mono); font-size: 12px; }
.dep-installs, .dep-config { margin: 8px 0 0; padding-left: 20px; font-size: 12.5px; color: var(--text-2); }
.dep-installs code, .dep-config code { font-family: var(--mono); }

.git-branch, .git-range, .git-status { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 13px; color: var(--text-2); }
.git-range code, .git-commits code { font-family: var(--mono); font-size: 12px; background: var(--surface-2); border-radius: 4px; padding: 1px 5px; }
.git-commits { margin: 8px 0 0; padding-left: 20px; font-size: 12.5px; color: var(--text); }
.git-commits li + li { margin-top: 4px; }

/* ---- motion ------------------------------------------------------------- */
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.header-inner > * { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }
.header-inner > :nth-child(2) { animation-delay: .04s; }
.header-inner > :nth-child(3) { animation-delay: .08s; }
.header-inner > :nth-child(4) { animation-delay: .12s; }
.header-inner > :nth-child(5) { animation-delay: .16s; }
.header-inner > :nth-child(6) { animation-delay: .20s; }
.header-inner > :nth-child(7) { animation-delay: .24s; }
.header-inner > :nth-child(8) { animation-delay: .28s; }
/* Only the first few items stagger, so a long list settles within half a second. */
.timeline-item, .story-card, .file-tree-item { animation: rise .4s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(.06s + min(var(--i, 0), 8) * .03s); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}

/* ---- responsive --------------------------------------------------------- */
@media (max-width: 900px) {
  .review-lens, .diff-lens { grid-template-columns: 1fr; }
  .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lens-hint { display: none; }
  .nav-opts { margin-left: 0; width: 100%; }
  .opt-toggle { flex: 1; justify-content: center; }
  .header-motif { width: 90%; opacity: calc(.1 * var(--motif)); }
}
@media (max-width: 520px) {
  .story-lens { padding-left: 36px; }
  .story-index { left: -36px; width: 28px; height: 28px; font-size: 11px; }
  .story-lens::before { left: 13px; }
  .stat-tile { padding: 10px 12px; }
  .stat-value { font-size: 19px; }
}

/* ---- print -------------------------------------------------------------- */
${METRICS_CSS}
@media print {
  :root { --bg: #fff; --surface: #fff; --surface-2: #f6f6f6; --surface-3: #eee; --shadow-1: none; --shadow-2: none; }
  body { font-size: 12px; }
  .lens-nav, .header-motif, .lens-hint, .show-more, .step-nav { display: none !important; }
  .lens-section, .turn-panel, .file-panel { display: block !important; }
  .file-filter { display: none !important; }
  .edit.file-hidden { display: block; }
  .lens-section { padding: 16px 0; border-top: 1px solid #ccc; }
  .story-code { display: block; }
  .story-code summary { display: none; }
  .story-code:not([open]) > *:not(summary) { display: block; }
  .timeline-item, .story-card, .turn-panel, .file-panel { break-inside: avoid; }
  * { animation: none !important; }
  .edit, .occurrence { content-visibility: visible; }
}
`;

const SCRIPT = THEME_TOGGLE_JS + CLIENT_SOURCE + `
(function () {
  // Times are rendered in UTC; .local-time ones are shown in the viewer's
  // own time zone instead, keeping the UTC value as the tooltip.
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  Array.prototype.forEach.call(document.querySelectorAll('time.local-time'), function (el) {
    var d = new Date(el.getAttribute('datetime'));
    if (isNaN(d.getTime())) return;
    var zone = '';
    try {
      var part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d)
        .filter(function (p) { return p.type === 'timeZoneName'; })[0];
      if (part) zone = ' ' + part.value;
    } catch (e) {}
    el.title = el.textContent;
    el.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + zone;
  });
})();
(function () {
  var root = document.documentElement;
  // The two view options: each maps to a class on <html>, so all the
  // filtering and view switching is CSS. "Project files only" on and
  // "Full file" off is the default, the *absence* of both classes; a page
  // always opens that way, since file:// pages share storage and one
  // remembered choice would carry into every other story.
  var OPTIONS = {
    scope: { cls: 'show-outside', pressedWhenSet: false },
    view: { cls: 'full-context', pressedWhenSet: true },
  };
  Array.prototype.forEach.call(document.querySelectorAll('.opt-toggle'), function (btn) {
    var opt = OPTIONS[btn.dataset.opt];
    if (!opt) return;
    function sync() {
      var set = root.classList.contains(opt.cls);
      btn.setAttribute('aria-pressed', String(opt.pressedWhenSet ? set : !set));
    }
    btn.addEventListener('click', function () {
      root.classList.toggle(opt.cls);
      sync();
      if (btn.dataset.opt === 'view') renderShown();
    });
    sync();
  });
  // Code is not in the markup: each .view names an entry in the story data
  // and is rendered the first time it is shown (src/render/story-data.mjs).
  var storyData = null;
  function codeData() {
    if (!storyData) {
      var el = document.getElementById('story-data');
      try { storyData = JSON.parse(el ? el.textContent : '{}'); } catch (e) { storyData = {}; }
      storyData.diffs = storyData.diffs || {};
      storyData.bases = storyData.bases || {};
    }
    return storyData;
  }
  // Parse the code data while the reader is still looking at the page, so the
  // first diff they open does not wait on it.
  if (window.requestIdleCallback) window.requestIdleCallback(codeData, { timeout: 4000 });
  // Story always shows hunks; Review and Diff show whichever Full file picks.
  function wanted(view) {
    var full = root.classList.contains('full-context');
    if (view.classList.contains('view-full')) return full;
    return !full || !view.closest('#lens-review, #lens-diff');
  }
  function renderView(view) {
    view.setAttribute('data-done', '');
    var data = codeData();
    var hunks = data.diffs[view.dataset.diff] || [];
    if (view.classList.contains('view-full')) {
      var base = data.bases[view.dataset.base];
      if (typeof base === 'string') view.insertAdjacentHTML('beforeend', fullTableHtml(spliceRows(base, hunks)));
    } else {
      view.innerHTML = hunksHtml(hunks);
    }
  }
  function renderPending(container) {
    if (!container) return;
    var views = container.querySelectorAll('.view-hunks[data-diff]:not([data-done]), .view-full[data-base]:not([data-done])');
    Array.prototype.forEach.call(views, function (view) { if (wanted(view)) renderView(view); });
  }
  // What is on screen now: the open turn's picked edits, the open file, open Story cards.
  function renderShown() {
    Array.prototype.forEach.call(
      document.querySelectorAll('.turn-panel.active .edit:not(.file-hidden), .file-panel.active, details.story-code[open]'),
      renderPending
    );
  }
  // Markup the reader has not reached yet is carried in <template data-inert>
  // (src/render/inert.mjs): parsed, but not styled, laid out or in the
  // accessibility tree. activate() swaps a shell's own template for its
  // content the first time that part is shown.
  function activate(el) {
    if (!el) return el;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName === 'TEMPLATE' && c.hasAttribute('data-inert')) { c.replaceWith(c.content); break; }
    }
    return el;
  }
  function activateAll(container) {
    var t;
    while ((t = container.querySelector('template[data-inert]'))) t.replaceWith(t.content);
  }
  // A closed <details> carries its body inert: fill it before it opens (a
  // summary click) or as it opens (script, keyboard), then render its code.
  function openDetails(details) {
    activate(details);
    if (details.classList.contains('story-code')) renderPending(details);
  }
  document.addEventListener('click', function (e) {
    var summary = e.target && e.target.closest ? e.target.closest('summary') : null;
    if (summary && summary.parentNode && summary.parentNode.tagName === 'DETAILS' && !summary.parentNode.open) openDetails(summary.parentNode);
  }, true);
  document.addEventListener('toggle', function (e) {
    var details = e.target;
    if (details && details.open && details.tagName === 'DETAILS') openDetails(details);
  }, true);
  // Print shows every lens, panel and diff.
  function renderAll() { activateAll(document); renderPending(document); }
  window.addEventListener('beforeprint', renderAll);
  if (window.matchMedia) {
    var printQuery = window.matchMedia('print');
    var onPrint = function (m) { if (m.matches) renderAll(); };
    if (printQuery.addEventListener) printQuery.addEventListener('change', onPrint);
    else if (printQuery.addListener) printQuery.addListener(onPrint);
  }

  // Generic master/detail wiring for clickable list items -> panels.
  function wireList(itemSelector, panelSelector, itemKey, panelKey, onActivate, scope) {
    var items = Array.prototype.slice.call(scope.querySelectorAll(itemSelector));
    var panels = Array.prototype.slice.call(scope.querySelectorAll(panelSelector));
    function select(key) {
      items.forEach(function (item) {
        var on = item.dataset[itemKey] === key;
        item.classList.toggle('selected', on);
        item.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      panels.forEach(function (panel) {
        var on = panel.dataset[panelKey] === key;
        if (on && !panel.classList.contains('active')) onActivate(activate(panel));
        panel.classList.toggle('active', on);
      });
    }
    items.forEach(function (item, i) {
      item.style.setProperty('--i', i);
      item.addEventListener('click', function () { select(item.dataset[itemKey]); });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { select(item.dataset[itemKey]); e.preventDefault(); }
      });
    });
    if (items.length > 0) select(items[0].dataset[itemKey]);
    return { items: items, select: select };
  }
  // A turn panel's file filter: show one file's edits, all of them (''), or
  // none (null) until the reader picks.
  function filterPanelFiles(panel, file) {
    panel.classList.toggle('no-pick', file === null);
    Array.prototype.forEach.call(panel.querySelectorAll('.file-filter-btn'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.fileFilter === file));
    });
    Array.prototype.forEach.call(panel.querySelectorAll('.edit'), function (edit) {
      var hidden = file === null || (!!file && edit.dataset.file !== file);
      edit.classList.toggle('file-hidden', hidden);
      if (!hidden) renderPending(edit);
    });
  }
  // Delegated: file filter buttons only exist once their panel is activated.
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.file-filter-btn') : null;
    if (btn) filterPanelFiles(btn.closest('.turn-panel'), btn.dataset.fileFilter);
    var more = e.target && e.target.closest ? e.target.closest('.show-more') : null;
    if (more) { activate(more.parentNode); more.remove(); }
    var copyBtn = e.target && e.target.closest ? e.target.closest('.copy-btn') : null;
    if (copyBtn) {
      var scope = copyBtn.closest('.panel-prompt-wrap') || copyBtn.parentElement;
      var target = scope ? scope.querySelector(copyBtn.dataset.copyTarget || '.panel-prompt') : null;
      if (target && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(target.innerText || target.textContent || '').then(function () {
          var original = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(function () {
            copyBtn.textContent = original;
            copyBtn.classList.remove('copied');
          }, 1500);
        });
      }
    }
    var stepBtn = e.target && e.target.closest ? e.target.closest('.step-btn') : null;
    if (stepBtn) stepTurn(Number(stepBtn.dataset.step));
    var jump = e.target && e.target.closest ? e.target.closest('[data-jump-turn]') : null;
    if (jump) {
      var turnNum = jump.dataset.jumpTurn;
      showLens('review');
      if (turns) {
        turns.select(turnNum);
        var panel = document.querySelector('.turn-panel[data-turn-panel="' + turnNum + '"]');
        if (panel) {
          panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
          panel.classList.remove('flash');
          void panel.offsetWidth;
          panel.classList.add('flash');
        }
      }
    }
  });
  // Hiding outside-project files must not leave a panel filtered to one of them.
  var scopeToggle = document.querySelector('.opt-toggle[data-opt="scope"]');
  if (scopeToggle) {
    scopeToggle.addEventListener('click', function () {
      if (root.classList.contains('show-outside')) return;
      Array.prototype.forEach.call(document.querySelectorAll('.file-filter-btn[data-outside="1"][aria-pressed="true"]'), function (btn) {
        filterPanelFiles(btn.closest('.turn-panel'), '');
      });
    });
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Each lens is wired the first time it is shown, after its markup is live.
  var turns = null;
  var fileTree = null;
  var LENS_INIT = {
    review: function (lens) {
      // Every time a turn is opened its code starts hidden, until a file or
      // "All changes" is picked.
      turns = wireList('.timeline-item', '.turn-panel', 'turn', 'turnPanel', function (panel) {
        filterPanelFiles(panel, null);
        updateStepNav(lens, panel.dataset.turnPanel);
      }, lens);
    },
    diff: function (lens) {
      fileTree = wireList('.file-tree-item', '.file-panel', 'file', 'filePanel', renderPending, lens);
      // Filter the Diff file tree by name. If the open file drops out, the
      // first match opens instead, so the panel always belongs to a listed file.
      var fileSearch = lens.querySelector('.file-search input');
      if (!fileSearch) return;
      var noMatch = lens.querySelector('.file-search-empty');
      function listed(item) {
        return !item.classList.contains('name-hidden') && (item.dataset.outside !== '1' || root.classList.contains('show-outside'));
      }
      function filterFiles() {
        var q = fileSearch.value.trim().toLowerCase();
        fileTree.items.forEach(function (item) {
          item.classList.toggle('name-hidden', !!q && item.dataset.file.toLowerCase().indexOf(q) === -1);
        });
        var shown = fileTree.items.filter(listed);
        if (noMatch) noMatch.hidden = shown.length > 0 || fileTree.items.length === 0;
        var current = fileTree.items.filter(function (item) { return item.classList.contains('selected'); })[0];
        if (shown.length > 0 && (!current || !listed(current))) fileTree.select(shown[0].dataset.file);
      }
      fileSearch.addEventListener('input', filterFiles);
      if (scopeToggle) scopeToggle.addEventListener('click', filterFiles);
      filterFiles();
    },
    story: function (lens) {
      Array.prototype.forEach.call(lens.querySelectorAll('.story-card'), function (card, i) { card.style.setProperty('--i', i); });
    },
  };
  // The floating step buttons follow whichever turn is open.
  function updateStepNav(lens, key) {
    var nav = lens.querySelector('.step-nav');
    if (!nav || !turns) return;
    var idx = turns.items.findIndex(function (i) { return i.dataset.turn === key; });
    nav.querySelector('.step-pos').textContent = (idx + 1) + ' / ' + turns.items.length;
    nav.querySelector('[data-step="-1"]').disabled = idx <= 0;
    nav.querySelector('[data-step="1"]').disabled = idx >= turns.items.length - 1;
  }
  // Open the turn delta steps away, keep its timeline entry in view, and
  // bring the panel's top back on screen if the reader had scrolled past it.
  function stepTurn(delta) {
    if (!turns) return;
    var idx = turns.items.findIndex(function (i) { return i.classList.contains('selected'); });
    var item = turns.items[idx + delta];
    if (!item) return;
    turns.select(item.dataset.turn);
    var timeline = item.parentNode;
    if (timeline.scrollHeight > timeline.clientHeight) {
      var top = item.offsetTop - timeline.offsetTop;
      if (top < timeline.scrollTop || top + item.offsetHeight > timeline.scrollTop + timeline.clientHeight) {
        timeline.scrollTop = top - (timeline.clientHeight - item.offsetHeight) / 2;
      }
    }
    var panel = document.querySelector('.turn-panel[data-turn-panel="' + item.dataset.turn + '"]');
    if (panel && panel.getBoundingClientRect().top < 58) {
      panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }
  function ensureLens(name) {
    var lens = document.getElementById('lens-' + name);
    if (!lens || lens.hasAttribute('data-ready')) return lens;
    lens.setAttribute('data-ready', '');
    activate(lens);
    if (LENS_INIT[name]) LENS_INIT[name](lens);
    return lens;
  }

  // Lens tabs, remembered in the URL hash.
  var lensButtons = Array.prototype.slice.call(document.querySelectorAll('.lens-tab'));
  var lensSections = Array.prototype.slice.call(document.querySelectorAll('.lens-section'));
  function showLens(name) {
    ensureLens(name);
    lensButtons.forEach(function (b) {
      var on = b.dataset.lens === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    lensSections.forEach(function (s) { s.classList.toggle('active', s.id === 'lens-' + name); });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }
  lensButtons.forEach(function (b, i) {
    b.addEventListener('click', function () { showLens(b.dataset.lens); });
    b.addEventListener('keydown', function (e) {
      var delta = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
      if (!delta) return;
      var next = lensButtons[(i + delta + lensButtons.length) % lensButtons.length];
      next.focus(); showLens(next.dataset.lens); e.preventDefault();
    });
  });
  var initialLens = (location.hash || '#review').slice(1);
  // The Trace view was folded into Report; old #trace links land there.
  if (initialLens === 'trace') initialLens = 'report';
  if (!document.getElementById('lens-' + initialLens)) initialLens = 'review';
  showLens(initialLens);

  // [ / ] cycle through lenses; j / k move between turns in the review lens.
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '[' || e.key === ']') {
      var activeIdx = lensButtons.findIndex(function (b) { return b.getAttribute('aria-selected') === 'true'; });
      if (activeIdx !== -1) {
        var step = e.key === ']' ? 1 : -1;
        var target = lensButtons[(activeIdx + step + lensButtons.length) % lensButtons.length];
        target.focus();
        showLens(target.dataset.lens);
        e.preventDefault();
      }
      return;
    }
    if (!turns || !document.getElementById('lens-review').classList.contains('active')) return;
    if (e.key === 'j') stepTurn(1);
    if (e.key === 'k') stepTurn(-1);
  });
})();
`;

// One line under the tabs saying, in plain words, what each view is for.
const LENS_INTROS = {
  review: 'Each prompt you gave, next to the code changes it led to.',
  diff: 'Every file that changed, shown as a before-and-after diff.',
  story: 'A plain-language account of what happened in the session, step by step.',
  report: 'Checks, errors and how they were fixed, commands that ran, and what the session cost.',
};

function lensIntro(name) {
  return `<p class="lens-intro">${escapeHtml(LENS_INTROS[name])}</p>`;
}

function lensTab(name, label, badge = null) {
  const badgeHtml = badge != null ? `<span class="tab-badge">${badge}</span>` : '';
  return (
    `<button class="lens-tab" role="tab" data-lens="${name}" id="tab-${name}" aria-controls="lens-${name}" aria-selected="false" title="${escapeHtml(LENS_INTROS[name])}">` +
    `${icon(name)}<span>${label}</span>${badgeHtml}</button>`
  );
}

/**
 * The cross-session chrome: a link back to the index and a switcher. Both
 * start hidden and are only revealed once the sidecar manifest turns out
 * to be there, so a story page copied out of its folder is exactly the
 * self-contained page it was before the library existed.
 */
function libraryNav(story, library) {
  if (!library) return '';
  return (
    `<span class="lib-nav" hidden data-session-id="${escapeHtml(story.session.id || '')}">` +
    `<a class="lib-back" href="${escapeHtml(library.indexHref)}">${icon('back')}<span>All sessions</span></a>` +
    `<select class="lib-switch" aria-label="Switch session"></select>` +
    `</span>`
  );
}

const LIBRARY_SCRIPT = `
(function () {
  var nav = document.querySelector('.lib-nav');
  var sessions = window.SESSION_STORY_LIBRARY;
  if (!nav || !Array.isArray(sessions) || !sessions.length) return;

  // Last active (matching the list order), in the viewer's local time.
  function localStamp(iso) {
    var d = new Date(iso || '');
    if (isNaN(d.getTime())) return '';
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '  ';
  }
  var select = nav.querySelector('.lib-switch');
  var current = nav.dataset.sessionId;
  // Sessions hidden on the index page stay out of the switcher too.
  var hidden = {};
  try {
    var dir = window.SESSION_STORY_LIBRARY_DIR;
    var stored = dir ? JSON.parse(localStorage.getItem('session-story-hidden:' + dir) || '[]') : [];
    if (Array.isArray(stored)) stored.forEach(function (id) { hidden[id] = true; });
  } catch (e) {}
  sessions.forEach(function (s) {
    if (hidden[s.id] && s.id !== current) return;
    var option = document.createElement('option');
    option.value = s.file;
    option.textContent = localStamp(s.ended_at || s.started_at) + (s.title || s.id);
    if (s.id === current) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', function () {
    if (select.value) location.href = select.value;
  });
  nav.hidden = false;
})();
`;

/**
 * Assemble the full, self-contained session-story HTML page: header,
 * lens navigation, every lens (Review, Diff, Story and Report), inline CSS
 * and JS.
 * @param {object} story - the Story IR
 * @param {object} [opts]
 * @param {{indexHref: string, manifestHref: string}} [opts.library] - when the
 *   page is written into a session library, the relative paths of the index
 *   and the sidecar manifest; omit it for a standalone page.
 * @returns {string}
 */
export function renderPage(story, opts = {}) {
  const title = storyTitle(story);
  const library = opts.library || null;
  // The page says when it was made: a story can be re-rendered long after
  // the session, and the tree it reads git from moves on.
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const turnCount = story.totals ? story.totals.turns : (story.turns ? story.turns.length : 0);
  const fileCount = story.totals ? story.totals.files : (story.files ? story.files.length : 0);

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<script>${BOOTSTRAP}</script>\n` +
    (library ? `<script src="${escapeHtml(library.manifestHref)}"></script>\n` : '') +
    `<style>${STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    renderHeader(story, { generatedAt }) +
    `<nav class="lens-nav">` +
    libraryNav(story, opts.library) +
    `<div class="tabs" role="tablist" aria-label="Views">` +
    lensTab('review', 'Review', turnCount) + lensTab('diff', 'Diff', fileCount) + lensTab('story', 'Story') + lensTab('report', 'Report') +
    `</div>` +
    `<span class="lens-hint">${icon('keyboard')}<kbd>j</kbd><kbd>k</kbd> turns</span>` +
    `<span class="nav-opts">` +
    `<button class="opt-toggle" type="button" data-opt="scope" aria-pressed="true" ` +
    `title="Hide edits to files outside this project">${icon('filter')}<span>Project files only</span></button>` +
    `<button class="opt-toggle" type="button" data-opt="view" aria-pressed="false" ` +
    `title="Show the whole file around each change">${icon('expand')}<span>Full file</span></button>` +
    `</span>` +
    themeToggleButton() +
    `</nav>\n` +
    `<noscript><p class="no-js-note">This page needs JavaScript to show its views.</p></noscript>\n` +
    `<section class="lens-section" id="lens-review" role="tabpanel" aria-labelledby="tab-review">${lensIntro('review')}${inert(renderReviewLens(story))}</section>\n` +
    `<section class="lens-section" id="lens-diff" role="tabpanel" aria-labelledby="tab-diff">${lensIntro('diff')}${inert(renderDiffLens(story))}</section>\n` +
    `<section class="lens-section" id="lens-story" role="tabpanel" aria-labelledby="tab-story">${lensIntro('story')}${inert(renderStoryLens(story))}</section>\n` +
    `<section class="lens-section" id="lens-report" role="tabpanel" aria-labelledby="tab-report">${lensIntro('report')}${inert(renderReportLens(story))}</section>\n` +
    renderStoryData(storyDataFor(story).data) + `\n` +
    `<script>${SCRIPT}</script>\n` +
    (library ? `<script>${LIBRARY_SCRIPT}</script>\n` : '') +
    `</body>\n` +
    `</html>\n`
  );
}
