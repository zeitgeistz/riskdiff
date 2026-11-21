// Language-aware helpers for reading changed lines: comment stripping and ignore directives.

const HASH = /\.(py|rb|sh|bash|zsh|ya?ml|toml|r|pl|ps1|cfg|ini|conf)$|(^|\/)(Dockerfile[^/]*|Makefile|Gemfile|Rakefile|requirements[^/]*\.txt|\.env[^/]*)$/i;
const SLASH = /\.(m?[jt]sx?|cjs|cts|mts|java|kt|kts|go|c|h|cc|cpp|hpp|cs|rs|swift|scala|dart|groovy|gradle|vue|svelte|css|scss|less|jsonc)$/i;
const BOTH = /\.(php|tf|hcl)$/i;
const SQL = /\.sql$/i;

export function commentStyle(path = '') {
  if (BOTH.test(path)) return { hash: true, slash: true };
  if (SLASH.test(path)) return { slash: true };
  if (HASH.test(path)) return { hash: true };
  if (SQL.test(path)) return { dashes: true };
  return {};
}

// Removes comments from one line of code, leaving string literals intact.
// Works line by line, so a multi-line block comment is only caught by its leading "*".
export function stripComments(line, style) {
  if (!style.hash && !style.slash && !style.dashes) return line;
  if (style.slash && /^\s*(\*(\s|\/|$)|\/\*.*\*\/\s*$)/.test(line)) return '';

  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += line[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (style.hash && ch === '#') break;
    if (style.dashes && ch === '-' && line[i + 1] === '-') break;
    if (style.slash && ch === '/' && line[i + 1] === '/') break;
    if (style.slash && ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const DIRECTIVE = /riskdiff-ignore\b(.*)$/;

// Reads `riskdiff-ignore [rule-id, ...]` directives from added lines.
// Returns 'all', a Set of rule ids, or null when the hunk has no directive.
export function ignoredRules(addedLines, knownIds) {
  let ids = null;
  for (const line of addedLines) {
    const m = line.match(DIRECTIVE);
    if (!m) continue;
    const named = [];
    for (const token of m[1].split(/[\s,:;]+/).filter(Boolean)) {
      if (!knownIds.has(token)) break;
      named.push(token);
    }
    if (!named.length) return 'all';
    ids ??= new Set();
    for (const id of named) ids.add(id);
  }
  return ids;
}
