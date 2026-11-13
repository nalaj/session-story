/**
 * Inline SVG icons for the rendered page. Each is a 16x16 stroke icon drawn
 * in currentColor so it inherits text color and theme; all are decorative
 * (aria-hidden) and always sit next to a text label.
 */

const ICONS = {
  turns: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  files: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/>',
  moon: '<path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"/>',
  auto: '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>',
  review: '<path d="M2.5 4h11M2.5 8h11M2.5 12h7"/>',
  diff: '<path d="M2.5 2.5h4.5v11H2.5zM9 2.5h4.5v11H9z"/>',
  story: '<path d="M2.5 3h4.5a1 1 0 0 1 1 1v9.5H3.5a1 1 0 0 1-1-1zM13.5 3H9a1 1 0 0 0-1 1v9.5h4.5a1 1 0 0 0 1-1z"/>',
  folder: '<path d="M1.5 4h4l1.5 1.5h7.5v7.5h-13z"/>',
  branch: '<circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M4 4.5v7M12 6.5c0 3-8 2-8 5"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
  sparkle: '<path d="M8 1.5l1.6 4.4L14 7.5l-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6z"/>',
  robot: '<rect x="2.5" y="5.5" width="11" height="8" rx="1.5"/><path d="M8 2.5v3M5.5 9h.01M10.5 9h.01"/>',
  warning: '<path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5V10M8 12h.01"/>',
  terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6.5L7 9l-2.5 2.5M8.5 11.5h3"/>',
  code: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>',
  filter: '<path d="M2 3h12l-4.7 5.6V13L6.7 11.2V8.6z"/>',
  expand: '<path d="M6 2.5H2.5V6M10 13.5h3.5V10M13.5 6V2.5H10M2.5 10v3.5H6"/>',
  keyboard: '<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6"/>',
  report: '<path d="M4 1.5h8v13H4z"/><path d="M6.5 5h3M6.5 8h3M6.5 11h2"/>',
  check: '<path d="M3 8.5l3.2 3.2L13 5"/>',
  cross: '<path d="M4 4l8 8M12 4l-8 8"/>',
  commit: '<circle cx="8" cy="8" r="2.5"/><path d="M1.5 8h4M10.5 8h4"/>',
  package: '<path d="M8 2l6 3.2v5.6L8 14l-6-3.2V5.2z"/><path d="M2 5.2L8 8.4l6-3.2M8 8.4V14"/>',
  plan: '<path d="M4 1.5h8v13H4z"/><path d="M6.5 5h3M6.5 8h3"/><path d="M6 11l1.3 1.3L10.5 9"/>',
  decision: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5l2.2 1.3"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  back: '<path d="M13 8H3"/><path d="M6.5 4.5L3 8l3.5 3.5"/>',
  prev: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  next: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  trace: '<path d="M2.5 3.5h3M2.5 8h6M2.5 12.5h4.5"/><circle cx="8" cy="3.5" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="9.5" cy="12.5" r="1.3"/>',
  retry: '<path d="M13 8a5 5 0 1 1-1.5-3.55"/><path d="M13 2.5v3h-3"/>',
  'eye-off': '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 2.5l11 11"/>',
  cost: '<circle cx="8" cy="8" r="6"/><path d="M10 5.8c-.4-.6-1.1-.9-2-.9-1.2 0-2 .6-2 1.5 0 2 4 1 4 3.1 0 .9-.9 1.6-2.1 1.6-.9 0-1.7-.4-2.1-1M8 3.6v1.3M8 11.1v1.3"/>',
};

export const ICON_NAMES = Object.keys(ICONS);

export function icon(name) {
  const body = ICONS[name];
  if (!body) throw new Error(`unknown icon: ${name}`);
  return (
    `<svg class="icon icon-${name}" viewBox="0 0 16 16" width="16" height="16" ` +
    `fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}
