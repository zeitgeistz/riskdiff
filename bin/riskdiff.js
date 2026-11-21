#!/usr/bin/env node
import { fstatSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { analyze } from '../src/analyze.js';
import { formatText, formatMarkdown, formatJson, formatSarif, atOrAbove } from '../src/report.js';
import { buildRules } from '../src/config.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `riskdiff ${VERSION} — rank the hunks of a diff by how risky they are to merge

Usage
  riskdiff                    Working tree, staged, and untracked changes vs HEAD
  riskdiff --staged           Staged changes only
  riskdiff <git-diff-args>    Any git diff range, e.g. main...HEAD
  git diff | riskdiff         Read a diff from stdin (or pass "-")

Options
  --json                  Machine-readable output
  --md                    Markdown table (for PR comments)
  --sarif                 SARIF 2.1.0 (for GitHub code scanning)
  -o, --output <file>     Write the report to a file instead of stdout
  --code                  Show the changed lines under each hunk
  --fail-on <level>       Exit 1 if any hunk is at or above low|medium|high
  --check-packages        Look new npm/PyPI dependencies up in their registries
  --config <path>         Config file (default: .riskdiff.json in the repo root)
  --no-untracked          Leave out untracked files
  --no-color              Disable colors
  -h, --help              Show help
  -v, --version           Show version`;

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        staged: { type: 'boolean' },
        json: { type: 'boolean' },
        md: { type: 'boolean' },
        sarif: { type: 'boolean' },
        output: { type: 'string', short: 'o' },
        code: { type: 'boolean' },
        'fail-on': { type: 'string' },
        config: { type: 'string' },
        'check-packages': { type: 'boolean' },
        'no-untracked': { type: 'boolean' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    return fail(`${err.message}\n\n${HELP}`);
  }
  const { values: opts, positionals } = args;

  if (opts.help) return console.log(HELP);
  if (opts.version) return console.log(VERSION);
  if ([opts.json, opts.md, opts.sarif].filter(Boolean).length > 1) return fail('use only one of --json, --md, --sarif');
  if (opts['fail-on'] && !['low', 'medium', 'high'].includes(opts['fail-on'])) {
    return fail(`--fail-on must be low, medium, or high (got "${opts['fail-on']}")`);
  }

  const fromStdin = positionals[0] === '-' || (!positionals.length && !opts.staged && stdinIsPiped());
  let results, config, packageCheck;
  try {
    ({ results, config, packageCheck } = await analyze({
      diffText: fromStdin ? readFileSync(0, 'utf8') : undefined,
      mode: opts.staged ? 'staged' : positionals.length ? 'range' : 'worktree',
      args: positionals,
      configPath: opts.config,
      untracked: !opts['no-untracked'],
      packages: opts['check-packages'],
    }));
  } catch (err) {
    return fail(err.message);
  }

  if (packageCheck?.failed) {
    console.error(`riskdiff: could not reach the registry for ${packageCheck.failed} package${packageCheck.failed === 1 ? '' : 's'}; they were not checked`);
  }
  const failOn = opts['fail-on'] ?? config.failOn;
  const color = !opts.output && !opts['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY;
  let report;
  if (opts.json) report = formatJson(results);
  else if (opts.sarif) report = formatSarif(results, { version: VERSION, rules: buildRules(config) });
  else if (opts.md) report = formatMarkdown(results);
  else report = formatText(results, { color, code: opts.code });

  if (opts.output) {
    try {
      writeFileSync(opts.output, `${report}\n`);
    } catch (err) {
      return fail(`cannot write ${opts.output}: ${err.message}`);
    }
  } else {
    console.log(report);
  }

  if (failOn && results.some((r) => r.score > 0 && atOrAbove(r.level, failOn))) process.exitCode = 1;
}

function stdinIsPiped() {
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isFile();
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`riskdiff: ${message}`);
  process.exitCode = 2;
}

main();
