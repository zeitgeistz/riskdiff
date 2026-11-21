import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiff } from '../src/diff.js';
import { scoreFiles } from '../src/score.js';
import { lookalike, sameJob, editDistance, checkPackages } from '../src/packages.js';
import { analyze } from '../src/analyze.js';
import { formatText } from '../src/report.js';
import { diffOf, ids } from './helpers.js';

const NOW = Date.parse('2026-11-21T00:00:00Z');
const DAY = 86400000;

// A fake fetch that serves registry responses from a table.
function fakeRegistry(table) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (table.fail) throw new Error('offline');
    const body = table[url];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, calls };
}

test('editDistance counts swaps as one edit', () => {
  assert.equal(editDistance('requests', 'reqeusts'), 1);
  assert.equal(editDistance('lodash', 'lodahs'), 1);
  assert.equal(editDistance('express', 'expres'), 1);
  assert.equal(editDistance('axios', 'axios'), 0);
});

test('lookalike flags near-misses of popular names only', () => {
  assert.equal(lookalike({ name: 'reqeusts', ecosystem: 'pypi' }), 'requests');
  assert.equal(lookalike({ name: 'expresss', ecosystem: 'npm' }), 'express');
  assert.equal(lookalike({ name: 'react-codeshift', ecosystem: 'npm' }), null);
  assert.equal(lookalike({ name: 'requests', ecosystem: 'pypi' }), null, 'a popular name is not a look-alike of itself');
  assert.equal(lookalike({ name: 'Python_Dotenv', ecosystem: 'pypi' }), null, 'PyPI names are normalized');
  assert.equal(lookalike({ name: 'ws2', ecosystem: 'npm' }), null, 'short names are skipped');
  assert.equal(lookalike({ name: 'serde', ecosystem: 'crates' }), null);
});

test('sameJob finds libraries that overlap with existing ones', () => {
  const project = [{ name: 'node-fetch', ecosystem: 'npm' }, { name: 'axios', ecosystem: 'npm' }, { name: 'zod', ecosystem: 'npm' }];
  assert.deepEqual(sameJob({ name: 'axios', ecosystem: 'npm' }, project), { job: 'HTTP client', others: ['node-fetch'] });
  assert.equal(sameJob({ name: 'zod', ecosystem: 'npm' }, project), null);
  assert.equal(sameJob({ name: 'left-pad', ecosystem: 'npm' }, project), null);
});

test('package-lookalike and duplicate-dependency rules fire offline', () => {
  const pkg = JSON.stringify({ dependencies: { 'node-fetch': '^3.0.0', axios: '^1.7.0', expresss: '^4.0.0' } });
  const text = diffOf('package.json', { added: ['    "axios": "^1.7.0",', '    "expresss": "^4.0.0",'] });
  const [r] = scoreFiles(parseDiff(text), { readNew: () => pkg });
  const byId = Object.fromEntries(r.findings.map((f) => [f.id, f.reason]));
  assert.match(byId['duplicate-dependency'], /Adds axios, but the project already has node-fetch \(HTTP client\)/);
  assert.match(byId['package-lookalike'], /expresss looks like express/);
  assert.ok(byId['new-dependency']);
});

test('checkPackages flags missing, new, unpopular, and deprecated packages', async () => {
  const { fetch } = fakeRegistry({
    'https://api.npmjs.org/downloads/point/last-week/fresh-pkg': { downloads: 12 },
    'https://registry.npmjs.org/fresh-pkg': { time: { created: new Date(NOW - 3 * DAY).toISOString() }, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } },
    'https://api.npmjs.org/downloads/point/last-week/old-pkg': { downloads: 2000 },
    'https://registry.npmjs.org/old-pkg': { time: { created: '2015-01-01T00:00:00Z' }, 'dist-tags': { latest: '2.0.0' }, versions: { '2.0.0': { deprecated: 'use new-pkg' } } },
    'https://api.npmjs.org/downloads/point/last-week/react': { downloads: 30_000_000 },
    'https://pypi.org/pypi/realpy/json': { releases: { '0.1': [{ upload_time_iso_8601: '2020-01-01T00:00:00Z' }] }, info: {} },
  });
  const text = [
    diffOf('package.json', { added: ['"react-codeshift": "^1.0.0",', '"fresh-pkg": "^1.0.0",', '"old-pkg": "^2.0.0",', '"react": "^19.0.0",'] }),
    diffOf('requirements.txt', { added: ['realpy==0.1', 'notreal-py==1.0'] }),
  ].join('\n');
  const results = scoreFiles(parseDiff(text));
  const stats = await checkPackages(results, { fetch, now: NOW });
  assert.deepEqual(stats, { checked: 6, failed: 0 });

  const reasons = results.flatMap((r) => r.findings.map((f) => `${f.id}: ${f.reason}`));
  const has = (re) => assert.ok(reasons.some((x) => re.test(x)), `missing ${re}\n${reasons.join('\n')}`);
  has(/package-not-found: react-codeshift does not exist on npm/);
  has(/package-not-found: notreal-py does not exist on PyPI/);
  has(/package-new: fresh-pkg was first published 3 days ago/);
  has(/package-low-downloads: fresh-pkg had only 12 downloads/);
  has(/package-deprecated: old-pkg is deprecated: use new-pkg/);
  assert.ok(!reasons.some((x) => /react[^-]/.test(x) && /package-/.test(x)), 'popular packages get no registry findings');

  // Scores were recomputed and results re-sorted.
  assert.equal(results[0].file, 'package.json');
  assert.equal(results[0].level, 'high');
});

test('checkPackages counts network failures and adds nothing', async () => {
  const { fetch } = fakeRegistry({ fail: true });
  const results = scoreFiles(parseDiff(diffOf('package.json', { added: ['"left-pad": "^1.3.0",'] })));
  const before = results[0].score;
  assert.deepEqual(await checkPackages(results, { fetch }), { checked: 0, failed: 1 });
  assert.equal(results[0].score, before);
});

test('registry rules respect config and riskdiff-ignore', async () => {
  const { fetch } = fakeRegistry({});
  const notFound = (results) => results[0].findings.some((f) => f.id === 'package-not-found');

  // JSON has no comments, so the directive goes in a "//" key, a common package.json convention.
  const ignored = diffOf('package.json', { added: ['"ghost-pkg": "^1.0.0",', '"//": "riskdiff-ignore package-not-found: private mirror"'] });
  assert.ok(!notFound((await analyze({ diffText: ignored, packages: true, fetch })).results));

  const plain = diffOf('package.json', { added: ['"ghost-pkg": "^1.0.0",'] });
  assert.ok(notFound((await analyze({ diffText: plain, packages: true, fetch })).results));

  const dir = mkdtempSync(join(tmpdir(), 'riskdiff-cfg-'));
  try {
    const configPath = join(dir, '.riskdiff.json');
    writeFileSync(configPath, JSON.stringify({ rules: { 'package-not-found': false } }));
    assert.ok(!notFound((await analyze({ diffText: plain, packages: true, fetch, configPath })).results));
    writeFileSync(configPath, JSON.stringify({ checkPackages: true }));
    assert.ok(notFound((await analyze({ diffText: plain, fetch, configPath })).results), 'config turns the check on');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('text output shows package reasons', async () => {
  const { fetch } = fakeRegistry({});
  const { results } = await analyze({ diffText: diffOf('package.json', { added: ['"ghost-pkg": "^1.0.0",'] }), packages: true, fetch });
  assert.match(formatText(results), /ghost-pkg does not exist on npm; possibly a hallucinated name \[package-not-found \+50\]/);
  assert.deepEqual(ids(diffOf('src/a.js', { added: ['"ghost-pkg": "^1.0.0",'] })), [], 'non-manifest files have no deps');
});
