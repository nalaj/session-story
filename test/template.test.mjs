import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../cli/src/render/template.mjs';

function sampleStory() {
  return {
    schema_version: 1,
    session: {
      id: 's1', cwd: '/proj', git_branch: 'main', title: 'Panel title/subtitle',
      started_at: '2026-09-10T10:00:00.000Z', ended_at: '2026-09-10T10:05:30.000Z', duration_ms: 330000,
      summary: 'Added a title and subtitle to Panel.', blind_spots: [],
    },
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'Add a title prop', summary: 'Added title prop.', edits: [] }],
    files: [],
    totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 },
  };
}

test('renderPage stamps the page with the time it was rendered, or the time it is given', () => {
  const before = Date.now();
  const stamped = renderPage(sampleStory()).match(/class="generated"[^>]*>.*?<time class="local-time" datetime="([^"]+)"/);
  assert.ok(stamped, 'header carries a generation time');
  const at = new Date(stamped[1]).getTime();
  assert.ok(at >= before - 1000 && at <= Date.now() + 1000, `stamped ${stamped[1]}`);

  assert.match(renderPage(sampleStory(), { generatedAt: '2026-10-14T09:12:33.000Z' }), /datetime="2026-10-14T09:12:33.000Z"/);
});

test('renderPage produces a full HTML document with a title and all four lens sections', () => {
  const html = renderPage(sampleStory());

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Panel title\/subtitle<\/title>/);
  assert.match(html, /id="lens-review"/);
  assert.match(html, /id="lens-diff"/);
  assert.match(html, /id="lens-story"/);
  assert.match(html, /id="lens-report"/);
  assert.match(html, /<script>/);
  assert.match(html, /<style>/);
});

test('renderPage adds a Report tab alongside Review/Diff/Story, and degrades gracefully with no report field', () => {
  const html = renderPage(sampleStory());

  assert.match(html, /data-lens="report"/);
  assert.match(html, /id="tab-report"/);
  assert.match(html, /None recorded\./);
});

test('renderPage escapes a title containing HTML-significant characters', () => {
  const story = sampleStory();
  story.session.title = '<img src=x onerror=alert(1)>';

  const html = renderPage(story);

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('renderPage ships an accessible theme toggle, a no-flash theme bootstrap, and tab semantics on the lens nav', () => {
  const html = renderPage(sampleStory());

  // bootstrap runs in <head>, before the stylesheet, guarded against a throwing localStorage
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script>[^]*try[^]*localStorage\.getItem\('session-story-theme'\)[^]*<\/script>[^]*<style>/);
  assert.match(html, /<button class="theme-toggle" type="button" aria-label="Theme: system"/);
  assert.match(html, /<button class="lens-tab" role="tab" data-lens="review"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /prefers-reduced-motion/);
});

test('renderPage adds the scope and full-file toggles, always opening on project files and hunks', () => {
  const html = renderPage(sampleStory());

  assert.match(html, /class="opt-toggle" type="button" data-opt="scope" aria-pressed="true"/);
  assert.match(html, /class="opt-toggle" type="button" data-opt="view" aria-pressed="false"/);
  // Not remembered: file:// pages share storage, so a past choice would
  // override the default on every story.
  assert.doesNotMatch(html, /session-story-scope|session-story-view/);
  assert.match(html, /html:not\(\.show-outside\) \[data-outside="1"\]/);
  // the full-file view applies to the code-reading lenses; the narrative
  // lens always shows just the changes
  assert.match(html, /html\.full-context #lens-review \.view-full/);
  assert.match(html, /#lens-story/);
});

test('renderPage scrolls a revealed edit clear of the sticky lens nav, with no file chips left to wire', () => {
  const html = renderPage(sampleStory());

  // CSS: the scroll target (the Trace lens's diff links) clears the sticky nav and flashes on arrival
  assert.match(html, /\.edit \{ scroll-margin-top: \d+px; \}/);
  assert.match(html, /\.edit\.flash \{ animation: flash /);
  assert.match(html, /@keyframes flash /);
  assert.match(html, /scrollIntoView/);
  // The Review timeline shows a file count, not clickable file chips.
  assert.doesNotMatch(html, /\.turn-chips/);
  assert.doesNotMatch(html, /\.chip \{/);
});

test('renderPage includes sticky rails for timeline and file-nav with independent scrolling', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /\.timeline\s*\{[^}]*position:\s*sticky/);
  assert.match(html, /\.file-nav\s*\{[^}]*position:\s*sticky/);
});

test('renderPage supports [ and ] shortcuts to cycle through lenses', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /e\.key === '\['/);
  assert.match(html, /e\.key === '\]'/);
});

test('renderPage script wires data-jump-turn to switch to review and select turn', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /data-jump-turn/);
  assert.match(html, /showLens\('review'\)/);
});

test('renderPage includes copy button for prompts and clipboard handler', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /class="copy-btn"/);
  assert.match(html, /navigator\.clipboard/);
});

test('renderPage renders tab count badges on Review and Diff tabs', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /id="tab-review"[^>]*>[\s\S]*?<span class="tab-badge">1<\/span>/);
  assert.match(html, /id="tab-diff"[^>]*>[\s\S]*?<span class="tab-badge">0<\/span>/);
});

test('renderPage stays self-contained by default: no sidecar script, no library chrome', () => {
  const html = renderPage(sampleStory());

  // No sidecar to load, no chrome to show: the page is complete on its own.
  assert.doesNotMatch(html, /<script src=/);
  assert.doesNotMatch(html, /class="lib-nav"/);
  assert.doesNotMatch(html, /SESSION_STORY_LIBRARY/);
});

test('renderPage with a library adds the sidecar script, a back link and a session switcher', () => {
  const html = renderPage(sampleStory(), {
    library: { indexHref: 'index.html', manifestHref: 'sessions.js' },
  });

  assert.match(html, /<script src="sessions\.js"><\/script>/);
  assert.match(html, /class="lib-nav" hidden/);
  assert.match(html, /href="index\.html"/);
  assert.match(html, /class="lib-switch"/);
  assert.match(html, /SESSION_STORY_LIBRARY/);
});

test('renderPage library chrome tells the page which session it is', () => {
  const html = renderPage(sampleStory(), {
    library: { indexHref: 'index.html', manifestHref: 'sessions.js' },
  });

  assert.match(html, /data-session-id="s1"/);
});

test('a story with a trace gets no extra tab: its metrics are in Report', () => {
  const story = Object.assign(sampleStory(), {
    trace: { events: [{ id: 'u1', kind: 'prompt', turn: 1, status: 'ok', summary: 'x', started_at: null, ended_at: null, duration_ms: null, source: 'transcript' }], cost_states: [] },
    metrics: { execution: { turns: 1 }, code: {}, validation: { final_state: 'none' }, reads: {}, usage: { source: 'none' } },
  });
  const html = renderPage(story);
  assert.equal((html.match(/class="lens-tab"/g) || []).length, 4);
  assert.doesNotMatch(html, /tab-trace|id="lens-trace"/);
  assert.match(html, /<div class="metrics-groups">/);
});

test('an old #trace link opens the Report view', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /if \(initialLens === 'trace'\) initialLens = 'report';/);
});

test('the page references nothing over the network', () => {
  const html = renderPage(Object.assign(sampleStory(), { trace: { events: [] } }));
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
  assert.doesNotMatch(html, /@import|url\(http/);
});

test('the page script carries no Trace view wiring', () => {
  const html = renderPage(Object.assign(sampleStory(), { trace: { events: [] } }));
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(script, /traceLens|failures-only|revealEdit/);
});

function storyWithCode() {
  const story = sampleStory();
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-a', '+</script><!--<script>', '+<b>"x"</b>'] }];
  story.turns[0].edits = [{
    id: 'e1', tool: 'Write', file: '/proj/a.html', rel: 'a.html', kind: 'update', result: 'ok',
    before: 'a\n', hunks, stats: { added: 2, removed: 1 },
  }];
  story.files = [{ rel: 'a.html', language: 'html', turns: [1], churn: false, stats: { added: 2, removed: 1 } }];
  story.totals = { turns: 1, files: 1, added: 2, removed: 1, edits: 1 };
  return story;
}

function storyDataOf(html) {
  const blocks = [...html.matchAll(/<script type="application\/json" id="story-data">([^]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  return { text: blocks[0][1], data: JSON.parse(blocks[0][1]) };
}

test('renderPage carries the code once as inert JSON and renders no diff tables in the markup', () => {
  const html = renderPage(storyWithCode());
  const { text, data } = storyDataOf(html);

  // Code that would close or derail the script element survives the round trip.
  assert.doesNotMatch(text, /<\/|<!--/);
  const [key] = Object.keys(data.diffs);
  assert.deepEqual(data.diffs[key][0].lines, ['-a', '+</script><!--<script>', '+<b>"x"</b>']);
  assert.deepEqual(Object.values(data.bases), ['a\n']);
  // Review, Diff and Story each hold a placeholder naming the same entry.
  const markup = html.replace(/<script[^>]*>[^]*?<\/script>/g, '');
  assert.equal(markup.split(`class="view view-hunks" data-diff="${key}"`).length - 1, 3);
  assert.doesNotMatch(markup, /<table class="hunk/);
});

test('renderPage renders code on demand: on pick, file open, Story toggle, Full file, Trace jump and print', () => {
  const html = renderPage(storyWithCode());

  assert.match(html, /function hunkTableHtml\(hunk\)/);
  assert.match(html, /function spliceRows\(baseText, hunks\)/);
  assert.match(html, /function renderPending\(container\)/);
  assert.match(html, /if \(!hidden\) renderPending\(edit\)/); // Review file pick
  assert.match(html, /wireList\('\.file-tree-item', '\.file-panel', 'file', 'filePanel', renderPending, lens\)/);
  assert.match(html, /addEventListener\('toggle'/);
  assert.match(html, /renderShown\(\)/);
  assert.match(html, /addEventListener\('beforeprint', renderAll\)/);
  assert.match(html, /function renderAll\(\) \{ activateAll\(document\); renderPending\(document\); \}/);
  assert.match(html, /<noscript><p class="no-js-note">/);
  assert.doesNotMatch(html, /fillFullRefs|data-full-ref/);
});

test('renderPage carries every lens inert and wires each the first time it is shown', () => {
  const html = renderPage(Object.assign(storyWithCode(), { trace: { events: [] } }));
  for (const lens of ['review', 'diff', 'story', 'report']) {
    assert.match(html, new RegExp(`id="lens-${lens}" role="tabpanel" aria-labelledby="tab-${lens}"><p class="lens-intro">[^<]+</p><template data-inert>`));
  }
  assert.match(html, /function activate\(el\)/);
  assert.match(html, /function ensureLens\(name\)/);
  assert.match(html, /function showLens\(name\) \{\n    ensureLens\(name\);/);
  assert.match(html, /<noscript><p class="no-js-note">This page needs JavaScript to show its views\.<\/p><\/noscript>/);
});

test('renderPage wires the Review step buttons and hides them in print', () => {
  const html = renderPage(sampleStory());
  assert.match(html, /closest\('\.step-btn'\)/);
  assert.match(html, /\.step-nav\s*\{[^}]*position:\s*fixed/);
  assert.match(html, /@media print[\s\S]*\.step-nav/);
});
