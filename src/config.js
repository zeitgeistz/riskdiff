// Loads .riskdiff.json and turns it into the rule list and path filter used for scoring.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtinRules } from './rules.js';

export const CONFIG_FILE = '.riskdiff.json';
const KEYS = new Set(['$schema', 'ignore', 'rules', 'customRules', 'failOn', 'checkPackages']);
const RULE_KEYS = new Set(['id', 'weight', 'reason', 'path', 'added', 'removed', 'flags', 'raw']);
const LEVELS = ['low', 'medium', 'high'];

export function findConfig(dirs) {
  for (const dir of dirs) {
    if (!dir) continue;
    const path = join(dir, CONFIG_FILE);
    if (existsSync(path)) return path;
  }
  return null;
}

export function loadConfig(path) {
  if (!path) return {};
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read config ${path}: ${err.message}`);
  }
  return validateConfig(data, path);
}

export function validateConfig(data, source = 'config') {
  const bad = (msg) => {
    throw new Error(`${source}: ${msg}`);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('must be a JSON object');
  for (const key of Object.keys(data)) if (!KEYS.has(key)) bad(`unknown key "${key}"`);

  if (data.ignore !== undefined && !isStringArray(data.ignore)) bad('"ignore" must be an array of glob strings');
  if (data.failOn !== undefined && !LEVELS.includes(data.failOn)) bad('"failOn" must be low, medium, or high');
  if (data.checkPackages !== undefined && typeof data.checkPackages !== 'boolean') bad('"checkPackages" must be true or false');

  const customIds = new Set();
  for (const [i, rule] of (data.customRules ?? []).entries()) {
    const where = `customRules[${i}]`;
    if (!rule || typeof rule !== 'object') bad(`${where} must be an object`);
    for (const key of Object.keys(rule)) if (!RULE_KEYS.has(key)) bad(`${where} has unknown key "${key}"`);
    if (typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(rule.id)) bad(`${where}.id must be lowercase letters, digits, and dashes`);
    if (builtinRules.some((r) => r.id === rule.id) || customIds.has(rule.id)) bad(`${where}.id "${rule.id}" is already used`);
    customIds.add(rule.id);
    if (!Number.isInteger(rule.weight) || rule.weight < 0) bad(`${where}.weight must be a non-negative integer`);
    if (typeof rule.reason !== 'string' || !rule.reason) bad(`${where}.reason is required`);
    const kinds = ['path', 'added', 'removed'].filter((k) => rule[k] !== undefined);
    if (kinds.length !== 1) bad(`${where} needs exactly one of "path", "added", or "removed"`);
    if (rule.path !== undefined && typeof rule.path !== 'string') bad(`${where}.path must be a regex string`);
    for (const k of ['added', 'removed']) {
      if (rule[k] !== undefined && !isStringArray(rule[k])) bad(`${where}.${k} must be an array of regex strings`);
    }
    for (const pattern of [rule.path, ...(rule.added ?? []), ...(rule.removed ?? [])].filter(Boolean)) {
      try {
        new RegExp(pattern, rule.flags ?? '');
      } catch (err) {
        bad(`${where}: invalid regex ${JSON.stringify(pattern)}: ${err.message}`);
      }
    }
  }

  const known = new Set([...builtinRules.map((r) => r.id), ...customIds]);
  if (data.rules !== undefined) {
    if (!data.rules || typeof data.rules !== 'object' || Array.isArray(data.rules)) bad('"rules" must be an object');
    for (const [id, value] of Object.entries(data.rules)) {
      if (!known.has(id)) bad(`"rules" has unknown rule id "${id}"`);
      if (value !== false && !(Number.isInteger(value) && value >= 0)) bad(`"rules.${id}" must be false or a non-negative integer weight`);
    }
  }
  return data;
}

// Built-in rules plus custom rules, with weights overridden and disabled rules removed.
export function buildRules(config = {}) {
  const custom = (config.customRules ?? []).map((r) => ({
    id: r.id,
    weight: r.weight,
    reason: r.reason,
    raw: Boolean(r.raw),
    path: r.path ? new RegExp(r.path, r.flags ?? '') : undefined,
    added: r.added?.map((p) => new RegExp(p, r.flags ?? '')),
    removed: r.removed?.map((p) => new RegExp(p, r.flags ?? '')),
  }));
  const overrides = config.rules ?? {};
  return [...builtinRules, ...custom]
    .filter((r) => overrides[r.id] !== false)
    .map((r) => (Number.isInteger(overrides[r.id]) ? { ...r, weight: overrides[r.id] } : r));
}

export function pathFilter(globs = []) {
  const regexes = globs.map(globToRegExp);
  return (path) => !regexes.some((re) => re.test(path));
}

// Glob syntax: `**` any number of directories, `*` anything but "/", `?` one character.
// A pattern with no "/" matches the file name in any directory, like .gitignore.
export function globToRegExp(glob) {
  let pattern = glob.replace(/^\.\//, '');
  if (!pattern.includes('/')) pattern = `**/${pattern}`;
  if (pattern.endsWith('/')) pattern += '**';
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      const slash = pattern[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}
