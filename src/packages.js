// Checks for new dependencies: look-alike names and duplicate libraries (offline),
// plus an opt-in registry lookup for packages that don't exist, are brand new, or are barely used.
import { POPULAR, SAME_JOB } from './popular.js';
import { finalize, sortResults } from './score.js';

const DAY = 24 * 60 * 60 * 1000;
const NEW_PACKAGE_DAYS = 30;
const LOW_WEEKLY_DOWNLOADS = 500;
const POPULAR_WEEKLY_DOWNLOADS = 50_000;

export const normalize = (name, ecosystem) =>
  ecosystem === 'pypi' ? name.toLowerCase().replace(/[-_.]+/g, '-') : name.toLowerCase();

const popularSets = Object.fromEntries(
  Object.entries(POPULAR).map(([eco, names]) => [eco, new Set(names.map((n) => normalize(n, eco)))]),
);

// The popular package this name looks like, or null. Popular names never match themselves.
export function lookalike({ name, ecosystem }) {
  const popular = popularSets[ecosystem];
  if (!popular) return null;
  const n = normalize(name, ecosystem);
  if (popular.has(n) || n.length < 5) return null;
  const limit = n.length >= 8 ? 2 : 1;
  for (const p of POPULAR[ecosystem]) {
    const target = normalize(p, ecosystem);
    if (Math.abs(target.length - n.length) <= limit && editDistance(n, target) <= limit) return p;
  }
  return null;
}

// Other libraries already in the project that do the same job as `dep`, or null.
export function sameJob(dep, projectDeps) {
  const n = normalize(dep.name, dep.ecosystem);
  for (const group of SAME_JOB) {
    const members = (group[dep.ecosystem] ?? []).map((m) => normalize(m, dep.ecosystem));
    if (!members.includes(n)) continue;
    const others = projectDeps
      .filter((d) => d.ecosystem === dep.ecosystem)
      .map((d) => normalize(d.name, d.ecosystem))
      .filter((d) => d !== n && members.includes(d));
    if (others.length) return { job: group.job, others: [...new Set(others)] };
  }
  return null;
}

// Optimal string alignment distance (Levenshtein plus adjacent swaps).
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Looks up every npm and PyPI dependency in the results, adds findings, and re-sorts.
// Returns { checked, failed } so callers can warn when the network was unavailable.
export async function checkPackages(results, { fetch = globalThis.fetch, now = Date.now(), timeoutMs = 8000, rules } = {}) {
  const enabled = (id) => !rules || rules.some((r) => r.id === id);
  const weightOf = (id, fallback) => rules?.find((r) => r.id === id)?.weight ?? fallback;
  const unique = new Map();
  for (const r of results) for (const d of r.deps ?? []) if (d.ecosystem === 'npm' || d.ecosystem === 'pypi') unique.set(`${d.ecosystem}:${d.name}`, d);

  const lookups = new Map();
  let failed = 0;
  await pool([...unique.entries()], 8, async ([key, dep]) => {
    try {
      lookups.set(key, dep.ecosystem === 'npm' ? await npmInfo(dep.name, fetch, timeoutMs) : await pypiInfo(dep.name, fetch, timeoutMs));
    } catch {
      failed++;
    }
  });

  for (const r of results) {
    if (r.ignored === 'all') continue;
    const skip = new Set(Array.isArray(r.ignored) ? r.ignored : []);
    const add = (id, fallback, reason) => {
      if (!enabled(id) || skip.has(id) || r.findings.some((f) => f.id === id && f.reason === reason)) return;
      r.findings.push({ id, weight: weightOf(id, fallback), reason });
    };
    for (const d of r.deps ?? []) {
      const info = lookups.get(`${d.ecosystem}:${d.name}`);
      if (!info) continue;
      const registry = d.ecosystem === 'npm' ? 'npm' : 'PyPI';
      if (!info.exists) {
        add('package-not-found', 50, `${d.name} does not exist on ${registry}${d.name.startsWith('@') ? ' (or is private)' : ''}; possibly a hallucinated name`);
        continue;
      }
      if (info.created && now - info.created < NEW_PACKAGE_DAYS * DAY) {
        const days = Math.max(0, Math.floor((now - info.created) / DAY));
        add('package-new', 30, `${d.name} was first published ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`);
      }
      if (info.weeklyDownloads !== undefined && info.weeklyDownloads < LOW_WEEKLY_DOWNLOADS) {
        add('package-low-downloads', 15, `${d.name} had only ${info.weeklyDownloads} downloads last week`);
      }
      if (info.deprecated) add('package-deprecated', 15, `${d.name} is deprecated: ${String(info.deprecated).slice(0, 120)}`);
    }
    finalize(r);
  }
  sortResults(results);
  return { checked: unique.size - failed, failed };
}

async function getJson(url, fetch, timeoutMs) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function npmInfo(name, fetch, timeoutMs) {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const downloads = await getJson(`https://api.npmjs.org/downloads/point/last-week/${encoded}`, fetch, timeoutMs).catch(() => undefined);
  const weeklyDownloads = typeof downloads?.downloads === 'number' ? downloads.downloads : undefined;
  // Popular packages have huge registry documents; their age and existence aren't in question.
  if (weeklyDownloads >= POPULAR_WEEKLY_DOWNLOADS) return { exists: true, weeklyDownloads };

  const doc = await getJson(`https://registry.npmjs.org/${encoded}`, fetch, timeoutMs);
  if (!doc) return { exists: false };
  const latest = doc['dist-tags']?.latest;
  return {
    exists: true,
    created: Date.parse(doc.time?.created) || undefined,
    weeklyDownloads,
    deprecated: latest ? doc.versions?.[latest]?.deprecated : undefined,
  };
}

async function pypiInfo(name, fetch, timeoutMs) {
  const doc = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, fetch, timeoutMs);
  if (!doc) return { exists: false };
  let created;
  for (const files of Object.values(doc.releases ?? {})) {
    for (const f of files) {
      const t = Date.parse(f.upload_time_iso_8601 ?? f.upload_time);
      if (t && (!created || t < created)) created = t;
    }
  }
  return { exists: true, created, deprecated: doc.info?.yanked ? doc.info.yanked_reason || 'yanked' : undefined };
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}
