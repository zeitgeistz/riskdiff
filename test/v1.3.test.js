import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiff } from '../src/diff.js';
import { scoreFiles } from '../src/score.js';
import { formatSarif, formatMarkdown } from '../src/report.js';
import { CLI, diffOf } from './helpers.js';

test('SARIF has one result per finding, with levels and locations', () => {
  const text = [
    diffOf('src/auth/login.js', { added: ['db.query(`SELECT * FROM u WHERE id = ${id}`)'] }),
    diffOf('src/fmt.js', { added: ['// TODO tidy'] }),
    diffOf('tests/old_test.py', { removed: ['x'], status: 'deleted' }),
  ].join('\n');
  const sarif = JSON.parse(formatSarif(scoreFiles(parseDiff(text)), { version: '9.9.9' }));
  assert.equal(sarif.version, '2.1.0');
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.version, '9.9.9');

  const byRule = Object.fromEntries(run.results.map((r) => [r.ruleId, r]));
  assert.equal(byRule['sql-injection'].level, 'error', 'a high hunk maps to error');
  assert.equal(byRule['auth-code'].level, 'error');
  assert.equal(byRule['todo-added'].level, 'note');
  assert.equal(byRule['sql-injection'].locations[0].physicalLocation.artifactLocation.uri, 'src/auth/login.js');
  assert.equal(byRule['sql-injection'].locations[0].physicalLocation.region.startLine, 10);
  assert.ok(!byRule['test-file-deleted'], 'deleted files have no location to annotate');
  assert.deepEqual(new Set(run.tool.driver.rules.map((r) => r.id)), new Set(run.results.map((r) => r.ruleId)));
});

test('markdown starts with the marker the Action uses to update its comment', () => {
  assert.ok(formatMarkdown([]).startsWith('<!-- riskdiff -->\n'));
});

test('CLI --sarif and --output write a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'riskdiff-out-'));
  try {
    const out = join(dir, 'r.sarif');
    const input = diffOf('a.js', { added: ['eval(x)'] });
    const stdout = execFileSync('node', [CLI, '-', '--sarif', '-o', out], { input, encoding: 'utf8' });
    assert.equal(stdout, '');
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).runs[0].results[0].ruleId, 'dangerous-exec');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI refuses two output formats at once', () => {
  assert.throws(
    () => execFileSync('node', [CLI, '-', '--json', '--md'], { input: '', stdio: 'pipe' }),
    (err) => err.status === 2 && /only one of/.test(err.stderr.toString()),
  );
});
