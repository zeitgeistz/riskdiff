import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../src/diff.js';
import { scoreFiles } from '../src/score.js';

export const CLI = fileURLToPath(new URL('../bin/riskdiff.js', import.meta.url));

export function diffOf(path, { added = [], removed = [], context = [], status } = {}) {
  const head = [`diff --git a/${path} b/${path}`];
  if (status === 'added') head.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`);
  else if (status === 'deleted') head.push('deleted file mode 100644', `--- a/${path}`, '+++ /dev/null');
  else head.push(`--- a/${path}`, `+++ b/${path}`);
  const body = [...context.map((l) => ' ' + l), ...removed.map((l) => '-' + l), ...added.map((l) => '+' + l)];
  head.push(`@@ -10,${context.length + removed.length} +10,${context.length + added.length} @@ function x() {`);
  return [...head, ...body].join('\n');
}

export const ids = (text, opts) => scoreFiles(parseDiff(text), opts).flatMap((r) => r.findings.map((f) => f.id));

// Creates a throwaway git repo with an initial commit of `files`; returns helpers.
export function tempRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'riskdiff-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (rel, content) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@example.com');
  run('config', 'user.name', 't');
  run('config', 'core.autocrlf', 'false');
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  if (Object.keys(files).length) {
    run('add', '-A');
    run('commit', '-qm', 'init');
  }
  const cli = (...args) => execFileSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { dir, run, write, cli, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
