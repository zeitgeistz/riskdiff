// Finds the dependencies a manifest hunk adds or changes.
// Returns [{ name, ecosystem }]; ecosystem is 'npm', 'pypi', or another registry name.

const NPM_META = new Set([
  'name', 'version', 'description', 'main', 'module', 'browser', 'types', 'typings', 'type', 'license',
  'author', 'homepage', 'private', 'packageManager', 'node', 'npm', 'yarn', 'pnpm', 'url', 'email',
]);
const TOML_META = new Set([
  'name', 'version', 'description', 'readme', 'license', 'authors', 'maintainers', 'keywords', 'homepage',
  'repository', 'documentation', 'edition', 'rust-version', 'python', 'requires-python', 'build-backend',
  'requires', 'packages', 'include', 'exclude', 'url', 'verify_ssl', 'python_version', 'publish', 'resolver',
]);
const NPM_DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function addedDeps(path, addedLines, newContent) {
  const base = path.split('/').pop();
  if (base === 'package.json') return npmDeps(addedLines, newContent);
  if (base === 'composer.json') return jsonKeyDeps(addedLines, 'packagist', (n) => n.includes('/'));
  if (/^requirements[^/]*\.txt$/.test(base)) return requirementsDeps(addedLines);
  if (base === 'pyproject.toml' || base === 'Pipfile') return pythonTomlDeps(addedLines);
  if (base === 'Cargo.toml') return tomlKeyDeps(addedLines, 'crates');
  if (base === 'go.mod') return goDeps(addedLines);
  if (base === 'Gemfile') return gemDeps(addedLines);
  return [];
}

function npmDeps(lines, content) {
  let declared = null;
  if (content) {
    try {
      const pkg = JSON.parse(content);
      declared = new Set(NPM_DEP_SECTIONS.flatMap((s) => Object.keys(pkg[s] ?? {})));
    } catch {
      // Unparseable package.json: fall back to the line heuristic.
    }
  }
  return jsonKeyDeps(lines, 'npm', (name, spec) =>
    declared ? declared.has(name) : !NPM_META.has(name) && looksLikeNpmSpec(spec),
  );
}

function jsonKeyDeps(lines, ecosystem, accept) {
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(/^"([^"]+)"\s*:\s*"([^"]*)",?$/);
    if (m && accept(m[1], m[2])) out.push({ name: m[1], ecosystem });
  }
  return unique(out);
}

function looksLikeNpmSpec(spec) {
  return /^([~^<>=]*\s*\d|\*$|latest$|next$|npm:|git|https?:|file:|link:|workspace:|[\w-]+\/[\w.-]+(#.*)?$)/.test(spec) && !/\s{2,}|\s(?![<>=|\d])/.test(spec);
}

function requirementsDeps(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('-')) continue;
    const m = t.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(==|>=|<=|~=|!=|===|>|<|;|@|$)/);
    if (m) out.push({ name: m[1], ecosystem: 'pypi' });
  }
  return unique(out);
}

function pythonTomlDeps(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    // PEP 621: "requests>=2.0",
    const pep = t.match(/^["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([<>=!~;@][^"']*)?["'],?$/);
    if (pep) {
      out.push({ name: pep[1], ecosystem: 'pypi' });
      continue;
    }
    // Poetry / Pipfile: requests = "^2.0" or requests = { version = "^2.0" }
    const kv = t.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(["{])/);
    if (kv && !TOML_META.has(kv[1])) out.push({ name: kv[1], ecosystem: 'pypi' });
  }
  return unique(out);
}

function tomlKeyDeps(lines, ecosystem) {
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(/^([A-Za-z0-9][A-Za-z0-9_-]*)\s*=\s*(["{])/);
    if (m && !TOML_META.has(m[1])) out.push({ name: m[1], ecosystem });
  }
  return unique(out);
}

function goDeps(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(/^(?:require\s+)?([\w.-]+\.[a-z]{2,}\/\S+)\s+v\d/);
    if (m) out.push({ name: m[1], ecosystem: 'go' });
  }
  return unique(out);
}

function gemDeps(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.trim().match(/^gem\s+["']([^"']+)["']/);
    if (m) out.push({ name: m[1], ecosystem: 'rubygems' });
  }
  return unique(out);
}

function unique(deps) {
  const seen = new Set();
  return deps.filter((d) => !seen.has(d.name) && seen.add(d.name));
}
