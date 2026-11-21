import { LEVELS, testTamper } from './score.js';

const COLORS = { high: '\x1b[31m', medium: '\x1b[33m', low: '\x1b[36m', none: '\x1b[90m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };

export function summarize(results) {
  const counts = { high: 0, medium: 0, low: 0, none: 0 };
  for (const r of results) counts[r.level]++;
  return { files: new Set(results.map((r) => r.file)).size, hunks: results.length, ...counts, testTamper: testTamper(results) };
}

// "2 tests skipped, 1 assertion removed", or null when the tests were not weakened.
export function tamperLine({ testTamper: t }) {
  if (!t.total) return null;
  const parts = [
    [t.skipped, 'test skipped or focused', 'tests skipped or focused'],
    [t.assertionsRemoved, 'hunk removed assertions', 'hunks removed assertions'],
    [t.filesDeleted, 'test file deleted', 'test files deleted'],
  ].filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return `Tests weakened: ${parts.join(', ')}`;
}

export function formatText(results, { color = false, code = false } = {}) {
  const c = (name, s) => (color ? COLORS[name] + s + COLORS.reset : s);
  const s = summarize(results);
  const out = [
    c('bold', 'riskdiff') +
      ` · ${s.files} file${s.files === 1 ? '' : 's'}, ${s.hunks} hunk${s.hunks === 1 ? '' : 's'} · ` +
      [c('high', `${s.high} high`), c('medium', `${s.medium} medium`), c('low', `${s.low} low`)].join(' · '),
    '',
  ];
  const tamper = tamperLine(s);
  if (tamper) out.push(c('medium', `⚠  ${tamper}`), '');

  const shown = results.filter((r) => r.score > 0);
  if (!shown.length) out.push(c('dim', 'No risky changes found.'));

  for (const r of shown) {
    const tag = r.level.toUpperCase().padEnd(6);
    const where = `${r.file}:${r.line}`;
    const ctx = r.context ? c('dim', `  ${r.context}`) : '';
    out.push(`${c(r.level, tag)} ${String(r.score).padStart(3)}  ${c('bold', where)}${ctx}`);
    out.push(c('dim', `            +${r.added} −${r.removed}${r.status !== 'modified' ? `  (${r.status})` : ''}`));
    for (const f of r.findings) out.push(`            ${c(r.level, '•')} ${f.reason} ${c('dim', `[${f.id} +${f.weight}]`)}`);
    if (code) {
      for (const l of r.hunk.removed.slice(0, 20)) out.push(c('high', `            - ${l}`));
      for (const l of r.hunk.added.slice(0, 20)) out.push(c('low', `            + ${l}`));
    }
    out.push('');
  }
  return out.join('\n');
}

export function formatMarkdown(results) {
  const s = summarize(results);
  const out = [
    '## riskdiff report',
    '',
    `**${s.files}** files · **${s.hunks}** hunks · 🔴 ${s.high} high · 🟠 ${s.medium} medium · 🔵 ${s.low} low`,
    '',
  ];
  const tamper = tamperLine(s);
  if (tamper) out.push(`> [!WARNING]
> ${tamper}`, '');
  const shown = results.filter((r) => r.score > 0);
  if (!shown.length) return [...out, 'No risky changes found.', ''].join('\n');

  out.push('| Risk | Score | Location | Why |', '|---|---:|---|---|');
  const icon = { high: '🔴 High', medium: '🟠 Medium', low: '🔵 Low' };
  for (const r of shown) {
    const why = r.findings.map((f) => f.reason).join('<br>');
    out.push(`| ${icon[r.level]} | ${r.score} | \`${r.file}:${r.line}\` | ${why} |`);
  }
  return out.join('\n') + '\n';
}

export function formatJson(results) {
  return JSON.stringify(
    { summary: summarize(results), hunks: results.map(({ hunk, ...rest }) => rest) },
    null,
    2,
  );
}

export function atOrAbove(level, threshold) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(threshold);
}
