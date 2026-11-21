// The full pipeline shared by the CLI, the Claude Code hook, and the MCP server.
import { parseDiff } from './diff.js';
import { scoreFiles } from './score.js';
import { findConfig, loadConfig, buildRules, pathFilter } from './config.js';
import { readGitDiff, newSideReader, repoRoot } from './git.js';
import { checkPackages } from './packages.js';

// Options:
//   diffText     diff to analyze; when omitted it is read from git using mode/args
//   mode         'worktree' | 'staged' | 'range'
//   args         git diff arguments for 'range' (and extra args for 'staged')
//   cwd          directory to run git in
//   configPath   explicit config file; otherwise .riskdiff.json in the repo root or cwd
//   untracked    include untracked files in 'worktree' mode (default true)
//   packages     look new npm/PyPI dependencies up in their registries (default: config.checkPackages)
//   fetch        fetch implementation for the registry lookups (tests pass a fake)
export async function analyze({ diffText, mode = 'worktree', args = [], cwd = process.cwd(), configPath, untracked = true, packages, fetch } = {}) {
  const root = repoRoot(cwd);
  const config = loadConfig(configPath ?? findConfig([root, cwd]));
  const text = diffText ?? readGitDiff({ mode, args, untracked, cwd });
  const readNew = diffText === undefined ? newSideReader({ mode, args, cwd }) : () => null;

  const rules = buildRules(config);
  const results = scoreFiles(parseDiff(text), { rules, include: pathFilter(config.ignore), readNew });
  const packageCheck = (packages ?? config.checkPackages) ? await checkPackages(results, { rules, fetch }) : null;
  return { results, config, packageCheck };
}
