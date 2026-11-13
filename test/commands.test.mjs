import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, parseExitCode, parseCommitShas, isRejection } from '../cli/src/ir/commands.mjs';

test('classifyCommand recognizes common test runners', () => {
  assert.equal(classifyCommand('npm test'), 'test');
  assert.equal(classifyCommand('npm run test'), 'test');
  assert.equal(classifyCommand('pnpm test'), 'test');
  assert.equal(classifyCommand('yarn test'), 'test');
  assert.equal(classifyCommand('node --test test/'), 'test');
  assert.equal(classifyCommand('pytest -q'), 'test');
  assert.equal(classifyCommand('python -m pytest'), 'test');
  assert.equal(classifyCommand('cargo test'), 'test');
  assert.equal(classifyCommand('go test ./...'), 'test');
  assert.equal(classifyCommand('npx jest'), 'test');
  assert.equal(classifyCommand('npx vitest run'), 'test');
  assert.equal(classifyCommand('bundle exec rspec'), 'test');
  assert.equal(classifyCommand('dotnet test'), 'test');
});

test('classifyCommand recognizes lint/typecheck commands', () => {
  assert.equal(classifyCommand('eslint .'), 'lint');
  assert.equal(classifyCommand('npx prettier --check .'), 'lint');
  assert.equal(classifyCommand('ruff check .'), 'lint');
  assert.equal(classifyCommand('flake8'), 'lint');
  assert.equal(classifyCommand('black --check .'), 'lint');
  assert.equal(classifyCommand('mypy src'), 'lint');
  assert.equal(classifyCommand('tsc --noEmit'), 'lint');
  assert.equal(classifyCommand('npm run lint'), 'lint');
  assert.equal(classifyCommand('npm run typecheck'), 'lint');
  assert.equal(classifyCommand('cargo clippy'), 'lint');
  assert.equal(classifyCommand('cargo fmt --check'), 'lint');
  assert.equal(classifyCommand('golangci-lint run'), 'lint');
});

test('classifyCommand recognizes build commands', () => {
  assert.equal(classifyCommand('npm run build'), 'build');
  assert.equal(classifyCommand('tsc'), 'build');
  assert.equal(classifyCommand('cargo build'), 'build');
  assert.equal(classifyCommand('go build ./...'), 'build');
  assert.equal(classifyCommand('make'), 'build');
  assert.equal(classifyCommand('docker build .'), 'build');
  assert.equal(classifyCommand('vite build'), 'build');
  assert.equal(classifyCommand('next build'), 'build');
  assert.equal(classifyCommand('webpack --mode production'), 'build');
});

test('classifyCommand recognizes install commands', () => {
  assert.equal(classifyCommand('npm install'), 'install');
  assert.equal(classifyCommand('npm i lodash'), 'install');
  assert.equal(classifyCommand('npm ci'), 'install');
  assert.equal(classifyCommand('npm uninstall lodash'), 'install');
  assert.equal(classifyCommand('pnpm add react'), 'install');
  assert.equal(classifyCommand('yarn add react'), 'install');
  assert.equal(classifyCommand('pip install requests'), 'install');
  assert.equal(classifyCommand('uv pip install requests'), 'install');
  assert.equal(classifyCommand('poetry add requests'), 'install');
  assert.equal(classifyCommand('cargo add serde'), 'install');
  assert.equal(classifyCommand('go get github.com/x/y'), 'install');
  assert.equal(classifyCommand('go mod tidy'), 'install');
  assert.equal(classifyCommand('brew install jq'), 'install');
});

test('classifyCommand recognizes git/gh commands', () => {
  assert.equal(classifyCommand('git status'), 'git');
  assert.equal(classifyCommand('git commit -m "x"'), 'git');
  assert.equal(classifyCommand('gh pr create'), 'git');
});

test('classifyCommand falls back to other', () => {
  assert.equal(classifyCommand('ls -la'), 'other');
  assert.equal(classifyCommand('cat file.txt'), 'other');
  assert.equal(classifyCommand(''), 'other');
});

test('classifyCommand classifies compound commands by priority: test > lint > build > install > git > other', () => {
  assert.equal(classifyCommand('npm install && npm test'), 'test');
  assert.equal(classifyCommand('eslint . && npm run build'), 'lint');
  assert.equal(classifyCommand('npm install && npm run build'), 'build');
  assert.equal(classifyCommand('cd repo && npm install'), 'install');
  assert.equal(classifyCommand('git add -A && git commit -m "x"'), 'git');
  assert.equal(classifyCommand('ls && cat foo | head'), 'other');
});

test('parseExitCode reads the exit code from success and error output', () => {
  assert.equal(parseExitCode('Exit code 0\nsome output'), 0);
  assert.equal(parseExitCode('Exit code 2\nawk: syntax error'), 2);
  assert.equal(parseExitCode('Error: Exit code 1\nTraceback...'), 1);
  assert.equal(parseExitCode('no exit code here'), null);
});

test('parseCommitShas extracts commit hashes from git commit output', () => {
  assert.deepEqual(parseCommitShas('[main abc1234] Add feature\n 2 files changed'), ['abc1234']);
  assert.deepEqual(
    parseCommitShas('[main (root-commit) 1234567] Initial commit'),
    ['1234567']
  );
  assert.deepEqual(parseCommitShas('nothing to commit'), []);
});

test('isRejection detects a user-rejected tool use result', () => {
  assert.equal(isRejection('User rejected tool use'), true);
  assert.equal(isRejection('Error: Exit code 1\n...'), false);
  assert.equal(isRejection({ stdout: '', stderr: '' }), false);
  assert.equal(isRejection(undefined), false);
});
