#!/usr/bin/env node
import { fstatSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { analyze } from '../src/analyze.js';
import { formatText, formatMarkdown, formatJson, atOrAbove } from '../src/report.js';

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
  const color = !opts['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY;
  if (opts.json) console.log(formatJson(results));
  else if (opts.md) console.log(formatMarkdown(results));
  else console.log(formatText(results, { color, code: opts.code }));

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
