# Changelog

## Unreleased

- Stories from other agents: `extract --log <file>` reads Codex session files and the JSON output of `codex exec`, Cursor Agent, OpenCode and headless Claude Code, including Paperclip run logs that wrap them. Each format is translated into Claude Code records, so every view, metric and export works unchanged; what a format does not record is named on the page.
- The Usage panel names the agent that did or did not report a cost, instead of always citing Claude Code.

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
