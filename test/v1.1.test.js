import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments, commentStyle } from '../src/source.js';
import { validateConfig, buildRules, globToRegExp, pathFilter } from '../src/config.js';
import { addedDeps } from '../src/deps.js';
import { diffOf, ids, tempRepo } from './helpers.js';

const js = commentStyle('a.js');
const py = commentStyle('a.py');

test('stripComments removes comments but keeps strings', () => {
  assert.equal(stripComments('run(); // eval(x)', js), 'run(); ');
  assert.equal(stripComments('const u = "http://x//y"; // c', js), 'const u = "http://x//y"; ');
  assert.equal(stripComments('a /* eval() */ b', js), 'a  b');
  assert.equal(stripComments(' * eval(x) is bad', js), '');
  assert.equal(stripComments('x = "#not" # eval(y)', py), 'x = "#not" ');
  assert.equal(stripComments('SELECT 1 -- DROP TABLE x', commentStyle('m.sql')), 'SELECT 1 ');
  assert.equal(stripComments('# eval(x)', commentStyle('notes.md')), '# eval(x)');
});

test('code rules ignore comments; secret and todo rules still see them', () => {
  assert.ok(!ids(diffOf('a.js', { added: ['// never call eval(input)'] })).includes('dangerous-exec'));
  assert.ok(!ids(diffOf('a.py', { added: ['# verify=False was here'] })).includes('security-disabled'));
  assert.ok(ids(diffOf('a.js', { added: ['// apiKey = "abcd1234efgh5678"'] })).includes('hardcoded-secret'));
  assert.ok(ids(diffOf('a.js', { added: ['// TODO: fix'] })).includes('todo-added'));
  // Removing a commented-out check is not removing a check.
  assert.ok(!ids(diffOf('r.js', { removed: ['// router.use(requireAuth);'] })).includes('auth-check-removed'));
});

test('riskdiff-ignore suppresses named rules or all rules for the hunk', () => {
  const named = diffOf('r.js', {
    removed: ['router.use(requireAuth);'],
    added: ['// riskdiff-ignore auth-check-removed: auth moved to middleware', 'eval(x)'],
  });
  const found = ids(named);
  assert.ok(!found.includes('auth-check-removed'));
  assert.ok(found.includes('dangerous-exec'));

  const all = diffOf('r.js', { removed: ['router.use(requireAuth);'], added: ['eval(x) // riskdiff-ignore'] });
  assert.deepEqual(ids(all), []);
});

test('config validation rejects bad input', () => {
  assert.throws(() => validateConfig({ nope: 1 }), /unknown key "nope"/);
  assert.throws(() => validateConfig({ rules: { 'not-a-rule': false } }), /unknown rule id/);
  assert.throws(() => validateConfig({ rules: { 'todo-added': 'high' } }), /must be false or a non-negative integer/);
  assert.throws(() => validateConfig({ failOn: 'extreme' }), /failOn/);
  assert.throws(() => validateConfig({ customRules: [{ id: 'x', weight: 5, reason: 'r', added: ['('] }] }), /invalid regex/);
  assert.throws(() => validateConfig({ customRules: [{ id: 'eval', weight: 5, reason: 'r' }] }), /exactly one of/);
  assert.throws(() => validateConfig({ customRules: [{ id: 'todo-added', weight: 5, reason: 'r', added: ['x'] }] }), /already used/);
  assert.doesNotThrow(() => validateConfig({ ignore: ['dist/**'], rules: { 'todo-added': false, 'new-dependency': 30 }, failOn: 'high' }));
});

test('config disables rules, overrides weights, and adds custom rules', () => {
  const config = validateConfig({
    rules: { 'todo-added': false, 'dangerous-exec': 60 },
    customRules: [{ id: 'no-console', weight: 5, reason: 'Adds console.log', added: ['console\\.log\\('] }],
  });
  const rules = buildRules(config);
  const text = diffOf('a.js', { added: ['// TODO', 'eval(x)', 'console.log(1)'] });
  const found = ids(text, { rules });
  assert.ok(!found.includes('todo-added'));
  assert.ok(found.includes('no-console'));
  assert.equal(rules.find((r) => r.id === 'dangerous-exec').weight, 60);
});

test('globs', () => {
  assert.ok(globToRegExp('dist/**').test('dist/a/b.js'));
  assert.ok(globToRegExp('**/*.snap').test('src/__snapshots__/a.snap'));
  assert.ok(globToRegExp('*.min.js').test('public/vendor/x.min.js'));
  assert.ok(globToRegExp('src/**/fixtures/*').test('src/fixtures/a.txt'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
  const include = pathFilter(['vendor/', '*.lock']);
  assert.equal(include('vendor/x/y.js'), false);
  assert.equal(include('yarn.lock'), false);
  assert.equal(include('src/a.js'), true);
});

test('addedDeps reads manifests and skips non-dependency keys', () => {
  const pkg = JSON.stringify({ name: 'x', scripts: { test: 'node --test' }, dependencies: { 'left-pad': '^1.3.0' } });
  assert.deepEqual(addedDeps('package.json', ['    "left-pad": "^1.3.0",', '    "test": "node --test",'], pkg), [{ name: 'left-pad', ecosystem: 'npm' }]);
  // Without file content, a line heuristic is used.
  assert.deepEqual(addedDeps('package.json', ['  "version": "1.2.0",', '  "test": "node --test",', '  "zod": "^3.0.0"'], null).map((d) => d.name), ['zod']);
  assert.deepEqual(addedDeps('requirements.txt', ['requests==2.32.0', '# comment', '-r base.txt', 'flask[async]>=3'], null).map((d) => d.name), ['requests', 'flask']);
  assert.deepEqual(addedDeps('pyproject.toml', ['  "httpx>=0.27",', 'name = "proj"', 'rich = "^13"'], null).map((d) => d.name), ['httpx', 'rich']);
  assert.deepEqual(addedDeps('go.mod', ['\tgithub.com/spf13/cobra v1.8.0'], null).map((d) => d.ecosystem), ['go']);
});

test('git: untracked files are included and ignored files are not', () => {
  const repo = tempRepo({ 'a.js': 'x\n', '.gitignore': 'secret/\n' });
  try {
    repo.write('new.js', 'eval(userInput)\n');
    repo.write('secret/key.js', 'eval(x)\n');
    const out = JSON.parse(repo.cli('--json'));
    assert.deepEqual(out.hunks.map((h) => h.file), ['new.js']);
    assert.equal(out.hunks[0].status, 'added');
    const without = JSON.parse(repo.cli('--json', '--no-untracked'));
    assert.equal(without.hunks.length, 0);
  } finally {
    repo.cleanup();
  }
});

test('git: config file in the repo root is applied, and package.json is read from disk', () => {
  const repo = tempRepo({
    'package.json': JSON.stringify({ name: 'x', scripts: {}, dependencies: {} }, null, 2) + '\n',
    'dist/out.js': 'x\n',
  });
  try {
    repo.write('.riskdiff.json', JSON.stringify({ ignore: ['dist/**'], rules: { 'todo-added': false } }));
    repo.write('dist/out.js', 'eval(x)\n');
    repo.write('src/a.js', '// TODO later\n');
    repo.write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node --test' }, dependencies: { zod: '^3.0.0' } }, null, 2) + '\n');
    const out = JSON.parse(repo.cli('--json'));
    const files = out.hunks.filter((h) => h.score > 0).map((h) => h.file);
    assert.deepEqual(files, ['package.json']);
    assert.deepEqual(out.hunks.find((h) => h.file === 'package.json').deps, [{ name: 'zod', ecosystem: 'npm' }]);
  } finally {
    repo.cleanup();
  }
});

test('git: --staged and ranges', () => {
  const repo = tempRepo({ 'a.js': 'x\n' });
  try {
    repo.write('a.js', 'eval(x)\n');
    assert.equal(JSON.parse(repo.cli('--json', '--staged')).hunks.length, 0);
    repo.run('add', 'a.js');
    assert.equal(JSON.parse(repo.cli('--json', '--staged')).hunks[0].findings[0].id, 'dangerous-exec');
    repo.run('commit', '-qm', 'two');
    assert.equal(JSON.parse(repo.cli('--json', 'HEAD~1..HEAD')).hunks[0].findings[0].id, 'dangerous-exec');
  } finally {
    repo.cleanup();
  }
});
