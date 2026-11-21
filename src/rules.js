// Risk rules. Each rule matches a hunk by file path, added lines, or removed lines.
// A rule counts at most once per hunk; the hunk score is the sum of matched weights.

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|go\.sum|Cargo\.lock|Gemfile\.lock|composer\.lock)$/;

export const rules = [
  // --- Sensitive areas (by path) ---
  {
    id: 'auth-code',
    weight: 25,
    reason: 'Touches authentication, sessions, or permissions',
    path: /(auth|login|logout|session|passw(or)?d|permission|acl|oauth|jwt|rbac|credential)/i,
  },
  {
    id: 'payment-code',
    weight: 25,
    reason: 'Touches payments or billing',
    path: /(payment|billing|checkout|invoice|stripe|paypal|subscription|refund)/i,
  },
  {
    id: 'crypto-code',
    weight: 20,
    reason: 'Touches cryptography or hashing',
    path: /(crypto|encrypt|decrypt|cipher|hash|signing|signature)/i,
  },
  {
    id: 'migration',
    weight: 20,
    reason: 'Database migration or SQL file',
    path: /(migrations?\/|\.sql$|schema\.prisma$)/i,
  },
  {
    id: 'ci-infra',
    weight: 20,
    reason: 'CI, deployment, or infrastructure config',
    path: /(^\.github\/workflows\/|(^|\/)Dockerfile|docker-compose|\.tf$|(^|\/)(k8s|helm|deploy|infra)\/|\.gitlab-ci\.yml$|Jenkinsfile)/i,
  },
  {
    id: 'env-file',
    weight: 30,
    reason: 'Environment or secrets file',
    path: /(^|\/)\.env(\.|$)(?!example|sample|template)/i,
  },
  {
    id: 'lockfile',
    weight: 3,
    reason: 'Lockfile change (usually follows a manifest change)',
    path: LOCKFILE,
  },

  // --- Added code ---
  {
    id: 'hardcoded-secret',
    weight: 50,
    reason: 'Looks like a hardcoded secret or API key',
    added: [
      /(api[_-]?key|secret|passw(or)?d|token|private[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
      /\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ],
  },
  {
    id: 'dangerous-exec',
    weight: 30,
    reason: 'Runs dynamic code or shell commands',
    added: [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /child_process|\bexecSync\s*\(|\bspawnSync\s*\(/,
      /\bos\.system\s*\(|\bsubprocess\.\w+\(|shell\s*=\s*True/,
      /\b(Runtime\.getRuntime\(\)\.exec|ProcessBuilder)\b/,
    ],
  },
  {
    id: 'destructive-sql',
    weight: 35,
    reason: 'Destructive SQL (DROP, TRUNCATE, or DELETE without WHERE)',
    added: [/\bDROP\s+(TABLE|DATABASE|SCHEMA|COLUMN)\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\s+[\w."`]+\s*(;|["'`]|$)/i],
  },
  {
    id: 'sql-injection',
    weight: 25,
    reason: 'SQL built from string concatenation or interpolation',
    added: [
      /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;]*["'`]\s*\+\s*\w/i,
      /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;]*\$\{/i,
      /f["'][^"']*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{/i,
      /\b(SELECT|INSERT|UPDATE|DELETE)\b[^;]*["']\s*%\s*\(?\w/i,
    ],
  },
  {
    id: 'security-disabled',
    weight: 30,
    reason: 'Disables a security check (TLS, CORS, CSRF)',
    added: [
      /verify\s*=\s*False/,
      /rejectUnauthorized\s*:\s*false/,
      /NODE_TLS_REJECT_UNAUTHORIZED\s*=?\s*["']?0/,
      /InsecureSkipVerify\s*:\s*true/,
      /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i,
      /origin\s*:\s*["']\*["']/,
      /csrf[_-]?(exempt|disable)|csrf\(\)\.disable|@csrf_exempt/i,
    ],
  },
  {
    id: 'test-skipped',
    weight: 20,
    reason: 'Skips or focuses tests',
    added: [
      /\b(it|test|describe)\.(skip|only)\s*\(/,
      /\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(/,
      /@pytest\.mark\.(skip|xfail)/,
      /@(Disabled|Ignore)\b/,
      /\bt\.Skip\(/,
      /unittest\.skip/,
    ],
  },
  {
    id: 'swallowed-error',
    weight: 15,
    reason: 'Catches an error and ignores it',
    added: [/catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/, /except(\s+\w+(\s+as\s+\w+)?)?\s*:\s*pass\b/, /\.catch\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/],
  },
  {
    id: 'new-dependency',
    weight: 15,
    reason: 'Adds or changes a dependency',
    match: (file, hunk) => MANIFEST.test(file.path) && hunk.added.some(isDependencyLine),
  },
  {
    id: 'todo-added',
    weight: 5,
    reason: 'Adds a TODO, FIXME, or HACK',
    added: [/\b(TODO|FIXME|HACK|XXX)\b/],
  },

  // --- Removed code ---
  {
    id: 'auth-check-removed',
    weight: 50,
    reason: 'Removes an authentication or permission check',
    removed: [
      /\b(requireAuth|isAuthenticated|ensureAuth\w*|authorize\w*|checkPermission\w*|hasPermission|verifyToken|requireRole|canAccess)\b/,
      /@(login_required|permission_required|PreAuthorize|Secured|RolesAllowed|UseGuards)\b/,
    ],
  },
  {
    id: 'error-handling-removed',
    weight: 20,
    reason: 'Removes error handling',
    match: (file, hunk) => removedMore(file, hunk, /\b(try|catch|except|finally|throw|raise|rescue)\b|if\s+err\s*!=\s*nil/),
  },
  {
    id: 'validation-removed',
    weight: 20,
    reason: 'Removes input validation or sanitizing',
    match: (file, hunk) => removedMore(file, hunk, /\b(validate\w*|sanitiz\w*|escape\w*|assertValid\w*)\s*\(|\.parse\(|zod|Joi\./i),
  },
  {
    id: 'assertion-removed',
    weight: 20,
    reason: 'Removes test assertions',
    match: (file, hunk) =>
      TEST_PATH.test(file.path) && removedMore(file, hunk, /\b(expect|assert\w*|should)\b[.(]|^\s*assert\s|\bself\.assert\w+\(/),
  },
  {
    id: 'test-file-deleted',
    weight: 25,
    reason: 'Deletes a test file',
    match: (file) => file.status === 'deleted' && TEST_PATH.test(file.path),
  },
];

// True when the pattern appears on more removed lines than added lines,
// so moving or rewording the same code does not count as removal.
// Deleted files are covered by their own rules, so they never count here.
function removedMore(file, hunk, pattern) {
  if (file.status === 'deleted') return false;
  const count = (lines) => lines.filter((l) => pattern.test(l)).length;
  return count(hunk.removed) > count(hunk.added);
}

function isDependencyLine(line) {
  const t = line.trim();
  return (
    /^"[@\w./-]+"\s*:\s*"[~^<>=*\d\w.:/#-]+",?$/.test(t) || // package.json, composer.json
    /^[A-Za-z0-9_.-]+(\[[\w,]+\])?\s*(==|>=|<=|~=|>|<|!=)/.test(t) || // requirements.txt
    /^[A-Za-z0-9_.-]+\s*=\s*["{]/.test(t) || // pyproject.toml, Cargo.toml
    /^(require\s+)?[\w.-]+\.[a-z]{2,}\/\S+\s+v\d/.test(t) || // go.mod
    /^gem\s+["']/.test(t) // Gemfile
  );
}

export function matchRule(rule, file, hunk) {
  if (rule.match) return rule.match(file, hunk);
  if (rule.path) return rule.path.test(file.path ?? '');
  if (rule.added) return hunk.added.some((l) => rule.added.some((p) => p.test(l)));
  if (rule.removed) return rule.removed.some((p) => removedMore(file, hunk, p));
  return false;
}
