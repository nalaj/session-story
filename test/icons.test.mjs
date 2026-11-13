import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon, ICON_NAMES } from '../cli/src/render/icons.mjs';

test('icon returns an inline, decorative SVG for every known name', () => {
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    assert.match(svg, /^<svg /, name);
    assert.match(svg, /aria-hidden="true"/, name);
    assert.match(svg, /class="icon icon-[a-z-]+"/, name);
  }
});

test('icon throws on an unknown name so a typo fails at render time, not silently', () => {
  assert.throws(() => icon('nope'), /unknown icon/);
});
