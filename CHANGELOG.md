# Changelog

## 0.6.0

- The CLI moved out of the skill folder into its own npm package, [`session-story`](https://www.npmjs.com/package/session-story) (source in `cli/`). The skill now runs it with `npx -y session-story@0.6.0`, pinned to the skill's version. The Claude Code plugin directory accepts only Markdown, text, JSON, YAML and images from unverified publishers, so `session-story/` now holds only `SKILL.md`, the schema, the plugin manifest and its icon.
- `session-story/.claude-plugin/marketplace.json` is removed: its `source` pointed at a folder that does not exist from inside the plugin. The repository's root `marketplace.json` still lists the plugin.
- `npm run smoke` checks the plugin folder against the directory's file rules and runs the CLI from a packed npm tarball.
- Releases publish `cli/` to npm.

## 0.5.1

- Start page: an animated demo under the hero plays the example session as a loop — three prompts and their edits in Claude Code, `/session-story`, then the story page with each prompt tied to its edits and the Diff, Story and Report views. It runs only while visible, steps under it jump to a scene, and with reduced motion it shows a still frame.
- `npm run record:demo` records one loop of it to `docs/assets/session-story-demo.mp4` and `.gif` (needs Playwright and ffmpeg, which the repo does not depend on).

## 0.5.0

- Plugin manifest: `session-story/.claude-plugin/` now holds `plugin.json`, a square listing icon and its own `marketplace.json`, so the skill folder validates as a plugin on its own.
- Extraction stays inside the project folder. When the project is a subfolder of a larger git repo, only files under it are credited to turns and read, by project-relative path; before, a file elsewhere in the repo could be credited and its committed contents shown. Files outside the project are never read from disk for the full-file view (their edits keep their diffs). `render --open` passes the path to the opener without a shell.

## 0.4.0

- Installable as a Claude Code plugin: the repository is a plugin marketplace (`.claude-plugin/marketplace.json`). Run `/plugin marketplace add nalaj/session-story`, then `/plugin install session-story@session-story`.
- Releases check that the marketplace's plugin version matches the skill's version.
- README logo reads "Session Story" in Figtree, replacing the Metafyl wordmark.
- Leftover Metafyl names are gone: stories record `session-story` as their generator, and the logo files under `docs/assets/` are renamed.

## 0.3.1

- Install docs: the Node.js 22.20+ installer requirement is stated up front, with a command for older Node that fetches Node 22 for the install only.

## 0.3.0

- Install docs and the site now offer Claude Code only. The skill reads Claude Code transcripts alone, so Codex, Cursor and OpenCode are no longer listed; support for them is planned.
- Start page header shows `/session-story` and uses the Metafyl mark as its favicon.
- README gains the logo and a hero screenshot.

## 0.2.0

- Active time: the header and Report show time without idle gaps over five minutes next to wall-clock time.
- Cache breaks: turns that re-sent over 100k input tokens past the prompt cache are counted per turn, in "Where it went", and in the Usage group, next to the share of input read from cache.
- Skills per turn: Skill calls and skill slash commands show as chips in Review and Story, and in the brief.
- Subagents from the legacy `Task` tool are recognised, typed from their `subagent_type` when there is no meta file.
- Token usage: a streamed API call keeps its largest output count, and calls a subagent transcript replays from the main session are no longer counted twice.

## 0.1.0 — first public release

- `session-story` skill: extract → summarize → validate → render a Claude Code session into one self-contained HTML page with Review, Diff, Story and Report views.
- Session library in `.session-stories/` with a gallery index, session switcher, hide and delete.
- Shell-driven edits recovered from git; `/clear`-split sessions joined automatically.
- Report metrics: per-turn duration and tokens, "Where it went", cost when Claude Code recorded it.
- `export` to a PR description or a handoff for a fresh session.
- Installable with `npx skills add nalaj/metafyl --skill session-story`.
