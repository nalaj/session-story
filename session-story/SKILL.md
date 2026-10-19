---
name: session-story
description: Generate a self-contained HTML "session story" that links each prompt in a vibe coding session to the file edits it caused, with a review timeline, a GitHub-style diff view, and a plain-language narrative. Use when the user asks for a session recap, changelog, review artifact, "what did Claude change", or wants to share a summary of a Claude Code session with a teammate or stakeholder.
license: MIT
metadata:
  version: "0.4.0"
  author: nalaj
  repository: https://github.com/nalaj/session-story
---

# Session Story

Turn the current (or a named) Claude Code session transcript into one
shareable HTML file: git tells you what changed, this tells you what
happened.

`<skill-dir>` below is the directory that contains this SKILL.md (where the
skill was installed). Run every command from the user's project directory,
not from `<skill-dir>`, so the session is found by the project's cwd.

## When to use

The user asks for a session recap, a changelog of what Claude did, a
review artifact for a teammate, or literally "make a story of this
session" / "/session-story".

## Steps

1. **Extract.** Run the CLI to pull the session transcript (and any
   subagent transcripts) into a Story IR JSON file:
   ```bash
   node <skill-dir>/bin/story.mjs extract -o <scratch>/story.json --brief
   ```
   Use `--session <id>` for a specific session or omit it (defaults to
   `--latest`) for the current one. Pass `--cwd <dir>` if the project
   differs from the current working directory. Sessions split by `/clear`
   are joined into one story automatically (`--no-chain` opts out), so the
   brief may carry turns from before the clear — `session.chain` lists the
   session ids included, oldest first. The `--brief` flag also
   prints a projection to stdout — **read only this projection, never the
   full story.json's hunks.** It carries, per turn: `prompt`,
   `edits[].{rel, kind, stats}`, `commands[].{command, category, ok,
   exit_code}`, `replies` (Claude's text replies, the last one longest), `errors[].{tool, target, message}`, and `plan.{approved,
   excerpt}` when a plan was proposed. An edit carrying `combined_into: N`
   is a file this turn changed through the shell whose diff git could only
   keep as the session's net change, shown on turn N — the turn did change
   code, so summarize it as a change, with zero stats rather than no edit.
   At the top level the brief carries
   `report.git` (branch and commit range, already extracted) and
   `report.dependencies` (manifest/install/config changes, already
   extracted), plus `hints` — a rough `outcome` guess from the last
   test/lint/build command and `failed_validations` excerpts to help you
   write resolutions. The brief also carries `metrics` (execution, code,
   validation, reads, usage — deterministic counts with `null` for anything
   the transcript did not record), `environment` (agent version and model
   ids) and, per turn, `duration_ms`, `tool_calls`, `output_tokens`,
   `share` (the turn's fraction of the session's output tokens, input
   tokens and duration, subagents included), `skills` (the skills the turn
   loaded) and `cache_breaks` (API calls that re-sent over 100k input
   tokens without the prompt cache). `metrics.execution.active_ms` is the
   session's time without idle gaps over five minutes; `metrics.usage`
   adds `cache_read_share` and `cache_breaks`. Use them to inform
   `report.outcome` and `outcome_note`; never restate or recompute them,
   and never write a number the brief shows as `null`. When one turn
   clearly dominated, you may say so in words ("most of the session went
   into the redesign"), never as a number or a cost. The same goes for
   skills and cache breaks: a turn summary may say "brainstormed the
   design first" or "re-read the whole context after a compaction", but
   the page already shows the names and counts.

2. **Summarize and write the report.** Using the brief projection from
   step 1, write directly into `<scratch>/story.json` with the Edit tool
   (touch nothing else in the file):
   - `session.title`: a short, plain-language name for the session — at
     most 60 characters, no trailing period. Name what the session *did*
     ("Session library for stories", "Fix flaky auth test"); never paste
     or truncate the first prompt. This is the page heading. The brief's
     `session.ai_title` is the harness's own name for the session — good
     source material, but rewrite it when it is vague or off.
   - `session.summary`: one or two sentences, at most 240 characters —
     the description under the heading, also shown in the Report lens and
     the library index. Lead with the outcome ("X now does Y"), name what
     was left out if anything, and don't restate the intent; the longer
     framing belongs in `report.plan`.
   - `turns[N].summary`: one sentence of intent per turn, in the same
     order as the brief output.
   - `turns[N].answer`: for every turn whose brief `replies` is not empty,
     a short summary (1-3 sentences, at most 400 characters) of what
     Claude answered or reported back to that prompt — the findings, the
     result, or the question it asked — written from `replies`. Review and
     Story show it as Claude's output and fold the original replies away,
     so it must stand on its own. Report only what the replies say; leave
     it out for turns with no replies.
   - `report.plan`: 2-4 sentences on what the session set out to do.
     Use any `turns[N].plan.excerpt` as source material when present.
   - `report.decisions`: notable technical decisions worth calling out
     (e.g. "used the existing service instead of a new endpoint"). Empty
     array if none stand out.
   - `report.outcome`: one of `completed`, `partial`, `failed`, `blocked`
     — your judgement call, informed by `hints.outcome` and whether any
     `errors[]` or failed commands were left unresolved.
   - `report.outcome_note`: optional one-liner, most useful when the
     outcome isn't `completed` (what it's blocked on, what's left).
   - `errors[N].resolution` (nested under each turn): fill in only for
     errors that mattered to the outcome — how it was fixed, or why it
     was left as-is. Leave `null` for noise (e.g. a `grep` that found
     nothing).

3. **Validate.**
   ```bash
   node <skill-dir>/bin/story.mjs validate <scratch>/story.json --strict
   ```
   If this reports missing summaries or report fields, go back to step 2.

4. **Render.**
   ```bash
   node <skill-dir>/bin/story.mjs render <scratch>/story.json --open
   ```
   This writes a self-contained HTML file (no server, no dependencies)
   with four switchable views — Review (timeline + a summary of Claude’s
   output, the original replies folded + diff,
   for you), Diff
   (file tree, GitHub-style, for a teammate), Story (narrative cards with Claude's
   output, for a stakeholder), Report (plan, commands, tests, errors, decisions,
   dependencies, git state, outcome, and the session metrics with token
   usage) — and opens it.

   The page lands in the project's `.session-stories/` library as
   `<date>-<session-id>-<slug>.html`, so each session keeps its own file
   instead of overwriting the last one, and a regenerated
   `.session-stories/index.html` lists every session with a search box,
   time period filters, and token and cost totals. Each
   page also gets a session switcher in its nav. Re-rendering the same
   session overwrites its file and refreshes its index entry. Pass
   `--library <dir>` for another folder, or `-o <file>` / `--no-library`
   for a single standalone page with no library around it. On the index
   page, each card's hide button takes a session out of the list and the
   switcher in that browser; the page stays on disk, and "Hidden (N)"
   brings it back. A session that is still running shows as Live and
   can't be hidden. Only when the user asks you to delete sessions for
   real, run `node <skill-dir>/bin/story.mjs delete <session-id>...` (or `--all`). It
   deletes their pages and rewrites the index; an id prefix of 4 or more
   characters is enough. It refuses a running session unless `--force`
   is passed, and `--all` keeps running sessions.

5. Report both paths — the story page and `.session-stories/index.html` —
   and the header numbers (turns, files, lines added/removed, outcome) to
   the user. If the story has token usage, report output tokens, the cost
   when recorded, and which turn used the most output tokens (the Report
   tab's "Where it went" ranks them).

6. **Optional: markdown.** If the user asks for a PR description or a
   handoff for a fresh session, run
   ```bash
   node <skill-dir>/bin/story.mjs export <scratch>/story.json [--template handoff]
   ```
   and give them the output (or pipe it to `pbcopy`). Every line comes
   from story.json; paste it as is and add no claims of your own. Files
   outside the project are left out unless `--all-files` is passed.

## Limits

- Another agent's session (Codex, Cursor, OpenCode, a headless Claude
  run, or a Paperclip run log) is read with `extract --log <file>` in
  step 1 instead of locating a Claude Code transcript. The page header
  names what that log does not record; never fill those gaps in the
  summary.
- `Edit`, `Write`, and `NotebookEdit` calls are read from the transcript.
  Changes made through `Bash` (`sed -i`, a heredoc script, a formatter)
  carry no diff there, so they are recovered from git instead: the tree is
  compared from the commit the session started on through to the working
  tree, and each change is credited to the turn whose commands account for
  it. Those edits are labelled on the page, and come with git's limits — a
  file edited again after the session shows both changes, and a commit made
  during the session by someone else looks like the session's own. Pass
  `--no-git` to `extract` to skip the git pass entirely (this also skips
  `report.git`; `report.dependencies` is still extracted).
- `report.plan`, `report.decisions`, `report.outcome`, `report.outcome_note`,
  and `errors[].resolution` are Claude's judgement calls, not something the
  extractor can verify — write them honestly from what the brief shows,
  including when the outcome isn't a clean success.
- A story page copied out of `.session-stories/` loses only the "All
  sessions" link and the switcher (they stay hidden when the sibling
  `sessions.js` is missing); everything else still works from `file://`.
- Requires Node.js 18.18+ and no other dependencies.
