// Everything that talks to git: building the diff text and reading the new side of files.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_UNTRACKED_BYTES = 1024 * 1024;

export function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message;
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

export function repoRoot(cwd) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch {
    return null;
  }
}

// mode: 'worktree' (vs HEAD, plus untracked files), 'staged', or 'range' (git diff args).
export function readGitDiff({ mode, args = [], untracked = true, cwd }) {
  const base = ['diff', '--no-color', '--no-ext-diff', '-M'];
  if (mode === 'staged') return git([...base, '--cached', ...args], cwd);
  if (mode === 'range') return git([...base, ...args], cwd);

  let text;
  try {
    text = git([...base, 'HEAD'], cwd);
  } catch {
    // No commits yet: fall back to staged + unstaged.
    text = git([...base, '--cached'], cwd) + git(base, cwd);
  }
  return untracked ? text + untrackedDiff(cwd) : text;
}

// Builds "new file" diffs for untracked files, skipping ignored, binary, and huge files.
export function untrackedDiff(cwd) {
  const root = repoRoot(cwd);
  if (!root) return '';
  const paths = git(['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean);
  let out = '';
  for (const path of paths) {
    const full = join(root, path);
    let buf;
    try {
      if (statSync(full).size > MAX_UNTRACKED_BYTES) continue;
      buf = readFileSync(full);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    out += `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n`;
    if (lines.length) out += `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n';
  }
  return out;
}

// Returns (path) => content of the file on the "new" side of the diff, or null.
export function newSideReader({ mode, args = [], cwd }) {
  const root = repoRoot(cwd);
  if (!root) return () => null;
  let rev = null; // null means the working tree
  if (mode === 'staged') rev = '';
  else if (mode === 'range') rev = rightSide(args);

  return (path) => {
    try {
      if (rev === null) return readFileSync(join(root, path), 'utf8');
      return git(['show', `${rev}:${path}`], root);
    } catch {
      return null;
    }
  };
}

// The revision on the right of a diff range, or null when it is the working tree.
function rightSide(args) {
  const sep = args.indexOf('--');
  const list = (sep === -1 ? args : args.slice(0, sep)).filter((a) => !a.startsWith('-'));
  if (list.length === 1 && list[0].includes('..')) return list[0].split(/\.\.\.?/)[1] || 'HEAD';
  if (list.length >= 2) return list[1];
  return null;
}
