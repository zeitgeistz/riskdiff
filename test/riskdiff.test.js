import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../src/diff.js';
import { scoreFiles } from '../src/score.js';
import { formatMarkdown, formatJson } from '../src/report.js';

const CLI = fileURLToPath(new URL('../bin/riskdiff.js', import.meta.url));

function diffOf(path, { added = [], removed = [], context = [], status } = {}) {
  const head = [`diff --git a/${path} b/${path}`];
  if (status === 'added') head.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`);
  else if (status === 'deleted') head.push('deleted file mode 100644', `--- a/${path}`, '+++ /dev/null');
  else head.push(`--- a/${path}`, `+++ b/${path}`);
  const body = [...context.map((l) => ' ' + l), ...removed.map((l) => '-' + l), ...added.map((l) => '+' + l)];
  head.push(`@@ -10,${context.length + removed.length} +10,${context.length + added.length} @@ function x() {`);
  return [...head, ...body].join('\n');
}

const ids = (text) => scoreFiles(parseDiff(text)).flatMap((r) => r.findings.map((f) => f.id));

test('parses files, status, and hunk line numbers', () => {
  const text = [
    diffOf('src/a.js', { context: ['keep'], added: ['new'] }),
    diffOf('src/b.js', { added: ['x'], status: 'added' }),
    diffOf('old.js', { removed: ['gone'], status: 'deleted' }),
  ].join('\n');
  const files = parseDiff(text);
  assert.deepEqual(files.map((f) => [f.path, f.status]), [
    ['src/a.js', 'modified'],
    ['src/b.js', 'added'],
    ['old.js', 'deleted'],
  ]);
  assert.equal(files[0].hunks[0].line, 11);
  assert.equal(files[0].hunks[0].context, 'function x() {');
});

test('parses renames', () => {
  const text = 'diff --git a/a.js b/b.js\nsimilarity index 100%\nrename from a.js\nrename to b.js\n';
  const [file] = parseDiff(text);
  assert.equal(file.status, 'renamed');
  assert.equal(file.path, 'b.js');
});

test('removed auth check ranks above a harmless change', () => {
  const text = [
    diffOf('src/utils/format.js', { added: ['return s.trim();'] }),
    diffOf('src/routes/admin.js', { removed: ['router.use(requireAuth);'] }),
  ].join('\n');
  const [first, second] = scoreFiles(parseDiff(text));
  assert.equal(first.file, 'src/routes/admin.js');
  assert.equal(first.findings[0].id, 'auth-check-removed');
  assert.equal(second.score, 0);
});

test('detects hardcoded secrets', () => {
  assert.ok(ids(diffOf('src/config.js', { added: ['const apiKey = "abcd1234efgh5678";'] })).includes('hardcoded-secret'));
  assert.ok(ids(diffOf('x.py', { added: ['KEY = "AKIAABCDEFGHIJKLMNOP"'] })).includes('hardcoded-secret'));
});

test('detects dangerous exec, destructive SQL, and SQL injection', () => {
  assert.ok(ids(diffOf('a.py', { added: ['subprocess.run(cmd, shell=True)'] })).includes('dangerous-exec'));
  assert.ok(ids(diffOf('a.js', { added: ['eval(userInput)'] })).includes('dangerous-exec'));
  assert.ok(ids(diffOf('m.sql', { added: ['DROP TABLE users;'] })).includes('destructive-sql'));
  assert.ok(ids(diffOf('a.js', { added: ['db.query(`SELECT * FROM users WHERE id = ${id}`)'] })).includes('sql-injection'));
  assert.ok(ids(diffOf('a.py', { added: ['cur.execute(f"SELECT * FROM t WHERE id = {uid}")'] })).includes('sql-injection'));
});

test('detects disabled security and swallowed errors', () => {
  assert.ok(ids(diffOf('a.py', { added: ['requests.get(url, verify=False)'] })).includes('security-disabled'));
  assert.ok(ids(diffOf('a.js', { added: ['app.use(cors({ origin: "*" }))'] })).includes('security-disabled'));
  assert.ok(ids(diffOf('a.js', { added: ['try { run() } catch (e) {}'] })).includes('swallowed-error'));
  assert.ok(ids(diffOf('a.py', { added: ['except Exception: pass'] })).includes('swallowed-error'));
});

test('detects weakened tests', () => {
  assert.ok(ids(diffOf('src/a.test.js', { added: ['it.skip("works", () => {'] })).includes('test-skipped'));
  assert.ok(ids(diffOf('tests/test_a.py', { removed: ['assert total == 10'] })).includes('assertion-removed'));
  assert.ok(ids(diffOf('tests/test_a.py', { removed: ['x'], status: 'deleted' })).includes('test-file-deleted'));
});

test('removal rules ignore moved code and deleted files', () => {
  const moved = diffOf('src/a.js', { removed: ['try {'], added: ['  try {'] });
  assert.ok(!ids(moved).includes('error-handling-removed'));
  const deleted = diffOf('src/old.js', { removed: ['try {', 'throw e'], status: 'deleted' });
  assert.ok(!ids(deleted).includes('error-handling-removed'));
});

test('detects new dependencies in manifests only', () => {
  assert.ok(ids(diffOf('package.json', { added: ['    "left-pad": "^1.3.0",'] })).includes('new-dependency'));
  assert.ok(ids(diffOf('requirements.txt', { added: ['requests==2.32.0'] })).includes('new-dependency'));
  assert.ok(!ids(diffOf('src/data.json', { added: ['    "name": "^1.3.0",'] })).includes('new-dependency'));
});

test('flags sensitive paths', () => {
  assert.ok(ids(diffOf('src/auth/session.ts', { added: ['x'] })).includes('auth-code'));
  assert.ok(ids(diffOf('.github/workflows/ci.yml', { added: ['x'] })).includes('ci-infra'));
  assert.ok(ids(diffOf('.env.production', { added: ['X=1'] })).includes('env-file'));
  assert.ok(!ids(diffOf('.env.example', { added: ['X='] })).includes('env-file'));
});

test('large hunks get a size bonus but lockfiles do not', () => {
  const big = Array.from({ length: 300 }, (_, i) => `line ${i}`);
  const [code] = scoreFiles(parseDiff(diffOf('src/a.js', { added: big })));
  assert.equal(code.score, 10);
  const [lock] = scoreFiles(parseDiff(diffOf('package-lock.json', { added: big })));
  assert.equal(lock.score, 3);
});

test('markdown and json output', () => {
  const results = scoreFiles(parseDiff(diffOf('src/routes/admin.js', { removed: ['router.use(requireAuth);'] })));
  assert.match(formatMarkdown(results), /\| 🔴 High \| 50 \| `src\/routes\/admin\.js:10` \|/);
  const json = JSON.parse(formatJson(results));
  assert.equal(json.summary.high, 1);
  assert.equal(json.hunks[0].hunk, undefined);
});

test('CLI reads stdin and --fail-on sets the exit code', () => {
  const input = diffOf('src/a.js', { added: ['eval(x)'] });
  const out = execFileSync('node', [CLI, '-', '--json'], { input, encoding: 'utf8' });
  assert.equal(JSON.parse(out).hunks[0].findings[0].id, 'dangerous-exec');

  assert.throws(
    () => execFileSync('node', [CLI, '-', '--fail-on', 'medium'], { input, stdio: 'pipe' }),
    (err) => err.status === 1,
  );
  execFileSync('node', [CLI, '-', '--fail-on', 'high'], { input, stdio: 'pipe' });
});

test('CLI rejects a bad --fail-on value', () => {
  assert.throws(
    () => execFileSync('node', [CLI, '-', '--fail-on', 'extreme'], { input: '', stdio: 'pipe' }),
    (err) => err.status === 2,
  );
});
