// The full pipeline shared by the CLI, the Claude Code hook, and the MCP server.
import { parseDiff } from './diff.js';
import { scoreFiles } from './score.js';
import { findConfig, loadConfig, buildRules, pathFilter } from './config.js';
import { readGitDiff, newSideReader, repoRoot } from './git.js';

// Options:
//   diffText     diff to analyze; when omitted it is read from git using mode/args
//   mode         'worktree' | 'staged' | 'range'
//   args         git diff arguments for 'range' (and extra args for 'staged')
//   cwd          directory to run git in
//   configPath   explicit config file; otherwise .riskdiff.json in the repo root or cwd
//   untracked    include untracked files in 'worktree' mode (default true)
export async function analyze({ diffText, mode = 'worktree', args = [], cwd = process.cwd(), configPath, untracked = true } = {}) {
  const root = repoRoot(cwd);
  const config = loadConfig(configPath ?? findConfig([root, cwd]));
  const text = diffText ?? readGitDiff({ mode, args, untracked, cwd });
  const readNew = diffText === undefined ? newSideReader({ mode, args, cwd }) : () => null;

  const results = scoreFiles(parseDiff(text), {
    rules: buildRules(config),
    include: pathFilter(config.ignore),
    readNew,
  });
  return { results, config };
}
