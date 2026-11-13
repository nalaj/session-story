/**
 * Markup the reader cannot see yet, carried inert.
 *
 * Content inside `<template>` is parsed into a DocumentFragment but never
 * styled, laid out, painted or exposed to accessibility, and document-wide
 * `querySelectorAll` does not reach into it. Every hidden lens, turn panel,
 * file panel, closed details body and overflow list is wrapped this way, so
 * a long session keeps a few thousand live nodes instead of tens of
 * thousands. The page script swaps a template for its content the first
 * time that part is shown (`activate` in template.mjs); print activates all.
 *
 * The wrapper is a child of a small live shell that keeps the classes and
 * data attributes the script selects on, so wiring finds the shell before
 * its body exists. Templates nest (lens, then panel, then details body).
 *
 * @param {string} html - already-escaped markup
 * @returns {string}
 */
export function inert(html) {
  return html ? `<template data-inert>${html}</template>` : '';
}
