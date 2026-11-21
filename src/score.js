import { rules, matchRule } from './rules.js';

export const LEVELS = ['none', 'low', 'medium', 'high'];

export function levelFor(score) {
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

// Scores every hunk and returns them sorted riskiest first.
export function scoreFiles(files) {
  const results = [];
  for (const file of files) {
    if (file.binary) continue;
    // A deleted file with no hunks (e.g. empty) still deserves a row.
    const hunks = file.hunks.length ? file.hunks : [{ header: '', context: '', line: 1, added: [], removed: [] }];
    for (const hunk of hunks) {
      const findings = rules
        .filter((rule) => matchRule(rule, file, hunk))
        .map(({ id, weight, reason }) => ({ id, weight, reason }));

      const changed = hunk.added.length + hunk.removed.length;
      let score = findings.reduce((sum, f) => sum + f.weight, 0);
      // Big hunks are harder to review; lockfile churn is not.
      const sizeBonus = findings.some((f) => f.id === 'lockfile') ? 0 : Math.min(10, Math.floor(changed / 25));
      if (sizeBonus) findings.push({ id: 'large-change', weight: sizeBonus, reason: `Large change (${changed} lines)` });
      score += sizeBonus;

      results.push({
        file: file.path,
        status: file.status,
        line: hunk.line,
        context: hunk.context,
        added: hunk.added.length,
        removed: hunk.removed.length,
        score,
        level: levelFor(score),
        findings: findings.sort((a, b) => b.weight - a.weight),
        hunk,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
}
