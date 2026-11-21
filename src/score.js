import { builtinRules, matchRule, MANIFEST } from './rules.js';
import { commentStyle, stripComments, ignoredRules } from './source.js';
import { addedDeps, allDeps } from './deps.js';

export const LEVELS = ['none', 'low', 'medium', 'high'];
const TEST_RULES = new Set(['test-skipped', 'assertion-removed', 'test-file-deleted']);

export function levelFor(score) {
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

// Scores every hunk and returns them sorted riskiest first.
//   rules     rule list (built-in rules by default)
//   include   (path) => boolean, false to skip a file
//   readNew   (path) => new file content or null, used to read manifests
export function scoreFiles(files, { rules = builtinRules, include = () => true, readNew = () => null } = {}) {
  const knownIds = new Set(rules.map((r) => r.id));
  const results = [];
  for (const file of files) {
    if (file.binary || !include(file.path ?? '')) continue;
    const style = commentStyle(file.path);
    const isManifest = MANIFEST.test(file.path ?? '');
    let manifest, projectDeps;
    // A deleted file with no hunks (e.g. empty) still deserves a row.
    const hunks = file.hunks.length ? file.hunks : [{ header: '', context: '', line: 1, added: [], removed: [] }];

    for (const hunk of hunks) {
      hunk.addedCode = hunk.added.map((l) => stripComments(l, style));
      hunk.removedCode = hunk.removed.map((l) => stripComments(l, style));
      if (isManifest) {
        if (manifest === undefined) {
          manifest = readNew(file.path);
          projectDeps = allDeps(file.path, manifest);
        }
        hunk.deps = addedDeps(file.path, hunk.added, manifest);
        hunk.projectDeps = projectDeps.length ? projectDeps : hunk.deps;
      }
      const ignored = ignoredRules(hunk.added, knownIds);

      const findings = [];
      for (const rule of ignored === 'all' ? [] : rules) {
        if (ignored?.has(rule.id)) continue;
        const hit = matchRule(rule, file, hunk);
        if (hit) findings.push({ id: rule.id, weight: rule.weight, reason: typeof hit === 'string' ? hit : rule.reason });
      }

      const changed = hunk.added.length + hunk.removed.length;
      // Big hunks are harder to review; lockfile churn is not.
      const sizeBonus = findings.some((f) => f.id === 'lockfile') ? 0 : Math.min(10, Math.floor(changed / 25));
      if (sizeBonus && ignored !== 'all') findings.push({ id: 'large-change', weight: sizeBonus, reason: `Large change (${changed} lines)` });

      results.push(finalize({
        file: file.path,
        status: file.status,
        line: hunk.line,
        context: hunk.context,
        added: hunk.added.length,
        removed: hunk.removed.length,
        ignored: ignored === 'all' ? 'all' : ignored ? [...ignored] : undefined,
        deps: hunk.deps?.length ? hunk.deps : undefined,
        findings,
        hunk,
      }));
    }
  }
  return sortResults(results);
}

// Recomputes score and level from findings. Call again after adding findings.
export function finalize(result) {
  result.findings.sort((a, b) => b.weight - a.weight);
  result.score = result.findings.reduce((sum, f) => sum + f.weight, 0);
  result.level = levelFor(result.score);
  return result;
}

export function sortResults(results) {
  return results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
}

// Counts the findings that weaken the test suite across the whole diff.
export function testTamper(results) {
  const counts = { 'test-skipped': 0, 'assertion-removed': 0, 'test-file-deleted': 0 };
  for (const r of results) for (const f of r.findings) if (TEST_RULES.has(f.id)) counts[f.id]++;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, skipped: counts['test-skipped'], assertionsRemoved: counts['assertion-removed'], filesDeleted: counts['test-file-deleted'] };
}
