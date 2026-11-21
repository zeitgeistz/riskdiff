// Claude Code PostToolUse hook: after Claude edits a file, scan that file's uncommitted
// changes and hand any medium or high risk hunks back to Claude as extra context.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { analyze } from './analyze.js';
import { formatText } from './report.js';
import { repoRoot } from './git.js';

const MAX_CONTEXT = 9000; // Claude Code caps additionalContext at 10k characters

// Takes the hook's stdin JSON; returns the JSON to print, or null to stay silent.
export async function runHook(input) {
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath) return null;
  const cwd = input.cwd || process.cwd();
  const root = repoRoot(cwd);
  if (!root) return null;

  const rel = relative(root, isAbsolute(filePath) ? filePath : resolve(cwd, filePath)).split(sep).join('/');
  if (!rel || rel.startsWith('../')) return null;

  const { results } = await analyze({ mode: 'worktree', cwd: root });
  const risky = results.filter((r) => r.file === rel && (r.level === 'high' || r.level === 'medium'));
  if (!risky.length) return null;

  let text =
    `riskdiff flagged the uncommitted changes in ${rel}. ` +
    'Check each finding below: fix it if it is a real problem, or tell the user why it is safe.\n\n' +
    formatText(risky, { code: true });
  if (text.length > MAX_CONTEXT) text = text.slice(0, MAX_CONTEXT) + '\n… (truncated; run riskdiff for the full report)';
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } };
}
