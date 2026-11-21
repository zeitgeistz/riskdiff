#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fstatSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseDiff } from '../src/diff.js';
import { scoreFiles } from '../src/score.js';
import { formatText, formatMarkdown, formatJson, atOrAbove } from '../src/report.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `riskdiff ${VERSION} — rank the hunks of a diff by how risky they are to merge

Usage
  riskdiff                    Working tree and staged changes vs HEAD
  riskdiff --staged           Staged changes only
  riskdiff <git-diff-args>    Any git diff range, e.g. main...HEAD
  git diff | riskdiff         Read a diff from stdin (or pass "-")

Options
  --json                  Machine-readable output
  --md                    Markdown table (for PR comments)
  --code                  Show the changed lines under each hunk
  --fail-on <level>       Exit 1 if any hunk is at or above low|medium|high
  --no-color              Disable colors
  -h, --help              Show help
  -v, --version           Show version`;

function main() {
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

  let diffText;
  try {
    diffText = readDiff(opts, positionals);
  } catch (err) {
    return fail(err.message);
  }

  const results = scoreFiles(parseDiff(diffText));
  const color = !opts['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY;

  if (opts.json) console.log(formatJson(results));
  else if (opts.md) console.log(formatMarkdown(results));
  else console.log(formatText(results, { color, code: opts.code }));

  if (opts['fail-on'] && results.some((r) => r.score > 0 && atOrAbove(r.level, opts['fail-on']))) {
    process.exitCode = 1;
  }
}

function readDiff(opts, positionals) {
  if (positionals[0] === '-' || (!positionals.length && !opts.staged && stdinIsPiped())) {
    return readFileSync(0, 'utf8');
  }
  const base = ['diff', '--no-color', '--no-ext-diff', '-M'];
  if (opts.staged) return git([...base, '--cached', ...positionals]);
  if (positionals.length) return git([...base, ...positionals]);
  try {
    return git([...base, 'HEAD']);
  } catch {
    // No commits yet: fall back to staged + unstaged.
    return git([...base, '--cached']) + git(base);
  }
}

function stdinIsPiped() {
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isFile();
  } catch {
    return false;
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message;
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function fail(message) {
  console.error(`riskdiff: ${message}`);
  process.exitCode = 2;
}

main();
