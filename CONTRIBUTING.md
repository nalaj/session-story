# Contributing

Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/nalaj/session-story && cd session-story
npm test          # no install step; there are no dependencies
npm run smoke     # checks the plugin payload and runs the packed npm CLI
```

To try your working copy as a live skill, link it into Claude Code and the CLI onto your PATH (so `npx session-story@<version>` resolves to your checkout once linked):

```bash
ln -sfn "$PWD/session-story" ~/.claude/skills/session-story
(cd cli && npm link)
```

## Ground rules

- **Two things ship.** `session-story/` is the skill and plugin: Markdown, JSON and images only, because the Claude Code plugin directory refuses code from unverified publishers (`npm run smoke` enforces this). `cli/` is the `session-story` npm package the skill runs through `npx`. Code in `cli/` resolves paths from `import.meta.url`, never from the repo root. Tests, scripts and the site stay outside both.
- **Zero runtime dependencies**, Node.js 18.18+.
- **TDD**: add or adjust a test in `test/` with each change.
- **Never commit a real session.** Fixtures and examples are synthetic (see `scripts/demo-session.mjs`).
- The page must stay self-contained: no remote scripts, styles or fonts.

## Releasing

1. Bump the version in `cli/package.json`, `cli/bin/story.mjs` (`story.generator`), `session-story/SKILL.md` (`metadata.version` and every `npx -y session-story@<version>` pin), `session-story/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the root `package.json`, the README badge and `site/index.html`'s footer; add a `CHANGELOG.md` entry.
2. `npm test && npm run smoke && npm run build:site`, then commit (including the refreshed `examples/story.html`).
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push --follow-tags`. The Release workflow checks that the tag matches the versions, publishes `cli/` to npm (needs the `NPM_TOKEN` repository secret) and publishes a GitHub Release.

Users update by rerunning the install command; `npx skills add` always fetches the default branch.
