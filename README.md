<div align="center">

# 🎯 riskdiff

**Know which part of a diff to review first.**

riskdiff reads a `git diff`, scores every hunk for risk, and sorts the hunks riskiest first.
It's built for the moment an AI agent hands you 14 changed files and you have five minutes to review them.

[![CI](https://github.com/zeitgeistz/riskdiff/actions/workflows/ci.yml/badge.svg)](https://github.com/zeitgeistz/riskdiff/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zeitgeistz/riskdiff?color=blue)](https://github.com/zeitgeistz/riskdiff/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A518.11-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

[Quick start](#-quick-start) · [What it catches](#-what-it-catches) · [Integrations](#-integrations) · [How scoring works](#-how-scoring-works) · [FAQ](#-faq)

</div>

---

```text
$ riskdiff
riskdiff · 5 files, 5 hunks · 1 high · 2 medium · 1 low

⚠  Tests weakened: 1 test skipped or focused, 1 hunk removed assertions

HIGH    50  src/routes/admin.js:2
            +0 −1
            • Removes an authentication or permission check [auth-check-removed +50]

MEDIUM  40  test/users.test.js:1
            +1 −2
            • Skips or focuses tests [test-skipped +20]
            • Removes test assertions [assertion-removed +20]

MEDIUM  25  src/db/users.js:2
            +1 −1
            • SQL built from string concatenation or interpolation [sql-injection +25]

LOW     15  package.json:3
            +2 −1
            • Adds or changes a dependency [new-dependency +15]
```

In this diff the agent removed `requireAuth`, skipped a failing test instead of fixing it, swapped a parameterized query for string interpolation, and added a package called `react-codeshift`, a name AI models are known to invent. The harmless formatting change in `src/format.js` scored 0 and is hidden.

## 🤔 Why

AI writes a growing share of code, but reviewing it hasn't gotten faster:

- **96%** of developers don't fully trust AI-generated code, and surveys describe review as the new bottleneck ([Sonar, 2026](https://www.sonarsource.com/blog/state-of-code-developer-survey-report-the-current-reality-of-ai-coding/)).
- The top frustration is code that is **"almost right, but not quite"** ([Stack Overflow survey via VentureBeat](https://venturebeat.com/technology/stack-overflow-data-reveals-the-hidden-productivity-tax-of-almost-right-ai-code)).
- Agents skip tests, weaken assertions, and add packages instead of using the ones you already have.

A big diff gets read top to bottom, and attention runs out before the dangerous line. riskdiff doesn't replace review. It tells you **where to spend it**.

## ✨ Features

- 🧭 **Ranks hunks, not files.** Points you at `file:line`, not "somewhere in this 400-line file".
- 🔍 **21 built-in rules** for security, data, tests, dependencies, and infrastructure.
- 🧠 **Ignores moved code and comments.** Removal rules only fire when something actually disappears, and `// don't use eval()` isn't a call to `eval`.
- 🧪 **Test tamper warning.** One line tells you when a diff skipped tests, removed assertions, or deleted test files.
- ⚙️ **Configurable.** Ignore paths, turn rules off, change weights, and add your own rules in `.riskdiff.json`, or silence one hunk with `riskdiff-ignore`.
- 📦 **Zero dependencies.** Only Node.js and git.
- 🖥️ **Three output formats:** colored terminal, JSON for tools and agents, Markdown for PR comments.
- 🚦 **CI gate:** `--fail-on high` exits with code 1.
- 🤖 **Claude Code skill included**, so your agent can review its own changes.

## 🚀 Quick start

Requires **Node.js 18.11+** and **git**.

```bash
# Run without installing
npx -y github:zeitgeistz/riskdiff

# Or install globally
npm install -g github:zeitgeistz/riskdiff
riskdiff
```

## 📖 Usage

```bash
riskdiff                     # working tree + staged + untracked changes vs HEAD
riskdiff --staged            # staged changes only (what you're about to commit)
riskdiff main...HEAD         # everything on this branch since it left main
riskdiff HEAD~3              # any range git diff accepts
git diff main | riskdiff     # read a diff from stdin
riskdiff - < change.patch    # or from a file
```

| Option | Description |
|---|---|
| `--json` | Machine-readable output (see [JSON output](#-json-output)) |
| `--md` | Markdown table, ready for a PR comment |
| `--code` | Print the changed lines under each hunk |
| `--fail-on <level>` | Exit with code `1` if any hunk is at or above `low`, `medium`, or `high` |
| `--config <path>` | Use this config file instead of `.riskdiff.json` in the repo root |
| `--no-untracked` | Leave out untracked files (included by default when no range is given) |
| `--no-color` | Disable colors (also respects `NO_COLOR`) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

**Exit codes:** `0` OK · `1` `--fail-on` threshold reached · `2` usage, config, or git error.

Untracked files that aren't in `.gitignore` are included as new files. Binary files and files over 1 MB are skipped.

## ⚙️ Configuration

Put a `.riskdiff.json` in your repo root. Every key is optional.

```json
{
  "$schema": "https://raw.githubusercontent.com/zeitgeistz/riskdiff/main/schema/riskdiff.schema.json",
  "ignore": ["dist/**", "*.min.js", "**/__snapshots__/**"],
  "rules": {
    "todo-added": false,
    "new-dependency": 25
  },
  "customRules": [
    {
      "id": "no-console",
      "weight": 5,
      "reason": "Adds console.log",
      "added": ["console\\.log\\("]
    }
  ],
  "failOn": "high"
}
```

| Key | What it does |
|---|---|
| `ignore` | Globs for files to skip. `**` matches any folders, `*` anything except `/`. A pattern with no `/` matches the file name anywhere, like `.gitignore`. |
| `rules` | `false` turns a rule off. A number sets its weight. |
| `customRules` | Your own rules. Each needs `id`, `weight`, `reason`, and exactly one of `path` (regex string), `added`, or `removed` (arrays of regex strings). Optional: `flags` (e.g. `"i"`) and `raw: true` to also match inside comments. |
| `failOn` | Default for `--fail-on`. The flag wins when both are set. |

riskdiff exits with code `2` and a clear message if the config has an unknown key, a bad regex, or a rule id that doesn't exist.

## 🙈 Ignoring a finding

Add `riskdiff-ignore` in a comment on any added line of the hunk:

```js
// riskdiff-ignore auth-check-removed: auth now runs in the gateway middleware
router.get('/users', listUsers);
```

- `riskdiff-ignore rule-a, rule-b` silences those rules for that hunk.
- `riskdiff-ignore` on its own silences every rule for that hunk.
- Anything after the rule ids is free text, so you can leave the reason for reviewers.

Comments are otherwise ignored: `// don't call eval()` doesn't count as calling `eval`, and deleting a commented-out `requireAuth` doesn't count as removing an auth check. Two rules still read comments on purpose: `hardcoded-secret` (a key in a comment still leaks) and `todo-added`.

## 🔍 What it catches

### Code that was added

| Rule | Weight | Catches |
|---|---:|---|
| `hardcoded-secret` | 50 | `apiKey = "..."`, AWS `AKIA…`, `sk-…`, `ghp_…`, Slack tokens, private keys |
| `destructive-sql` | 35 | `DROP TABLE`, `TRUNCATE`, `DELETE FROM` without `WHERE` |
| `dangerous-exec` | 30 | `eval`, `new Function`, `child_process`, `os.system`, `shell=True` |
| `security-disabled` | 30 | `verify=False`, `rejectUnauthorized: false`, CORS `*`, CSRF exemptions |
| `sql-injection` | 25 | SQL built with `+`, `${}`, f-strings, or `%` formatting |
| `test-skipped` | 20 | `it.skip`, `.only`, `xit`, `@pytest.mark.skip`, `@Disabled`, `t.Skip()` |
| `swallowed-error` | 15 | `catch (e) {}`, `except: pass`, `.catch(() => {})` |
| `new-dependency` | 15 | New or changed entries in `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, and more |
| `todo-added` | 5 | New `TODO`, `FIXME`, `HACK`, `XXX` |

### Code that was removed

| Rule | Weight | Catches |
|---|---:|---|
| `auth-check-removed` | 50 | `requireAuth`, `isAuthenticated`, `authorize…`, `@login_required`, `@PreAuthorize`, `@UseGuards` |
| `test-file-deleted` | 25 | A whole test file deleted |
| `error-handling-removed` | 20 | `try`/`catch`/`except`/`throw`/`raise`, Go `if err != nil` |
| `validation-removed` | 20 | `validate…()`, `sanitize…()`, `escape…()`, schema `.parse()`, zod, Joi |
| `assertion-removed` | 20 | `expect(`, `assert…`, `self.assert…` in test files |

### Sensitive places

| Rule | Weight | Path matches |
|---|---:|---|
| `env-file` | 30 | `.env`, `.env.production` (not `.env.example`) |
| `auth-code` | 25 | `auth`, `login`, `session`, `password`, `permission`, `oauth`, `jwt`, `rbac` |
| `payment-code` | 25 | `payment`, `billing`, `checkout`, `invoice`, `stripe`, `subscription` |
| `crypto-code` | 20 | `crypto`, `encrypt`, `cipher`, `hash`, `signature` |
| `migration` | 20 | `migrations/`, `*.sql`, `schema.prisma` |
| `ci-infra` | 20 | `.github/workflows/`, `Dockerfile`, `docker-compose`, `*.tf`, `k8s/`, `helm/` |
| `lockfile` | 3 | `package-lock.json`, `yarn.lock`, `poetry.lock`, `go.sum`, … |
| `large-change` | 0–10 | +1 for every 25 changed lines in the hunk (not for lockfiles) |

## 🧮 How scoring works

1. The diff is split into **hunks** (the `@@ … @@` blocks).
2. Each rule is checked against the hunk's file path, added lines, and removed lines. A rule counts **once per hunk**.
3. The hunk's **score** is the sum of the weights that matched, plus the size bonus.
4. The score maps to a **level**:

| Level | Score |
|---|---|
| 🔴 **High** | 50+ |
| 🟠 **Medium** | 25–49 |
| 🔵 **Low** | 1–24 |
| ⚪ None | 0 (hidden) |

Rules stack. One removed auth check is already **high**. A new SQL string (`25`) in `src/auth/login.js` (`+25`) is also **high**, because the same mistake matters more in auth code.

Removal rules compare counts: if a hunk removes one `try` and adds one back, nothing was removed. Deleted files are handled by `test-file-deleted` only, so deleting dead code doesn't set off every removal rule.

## 🔌 Integrations

### 🤖 Claude Code skill

The repo includes a skill that runs riskdiff and has Claude review the high and medium hunks with you.

```bash
# macOS / Linux
cp -r skills/zeit-riskdiff ~/.claude/skills/

# Windows (PowerShell)
Copy-Item -Recurse skills\zeit-riskdiff $HOME\.claude\skills\
```

Then type `/zeit-riskdiff` in Claude Code, or ask *"what's risky in this change?"*.

### 🪝 Git pre-commit hook

Block commits that contain high-risk changes:

```bash
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
npx -y github:zeitgeistz/riskdiff#v1.0.0 --staged --fail-on high
EOF
chmod +x .git/hooks/pre-commit
```

Use `git commit --no-verify` to bypass it when you've reviewed the change.

### ⚙️ GitHub Actions: PR comment + gate

```yaml
name: riskdiff
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  riskdiff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Report
        run: npx -y github:zeitgeistz/riskdiff#v1.0.0 origin/${{ github.base_ref }}...HEAD --md > riskdiff.md

      - name: Comment on PR
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr comment ${{ github.event.pull_request.number }} --body-file riskdiff.md --edit-last || gh pr comment ${{ github.event.pull_request.number }} --body-file riskdiff.md

      - name: Fail on high risk
        run: npx -y github:zeitgeistz/riskdiff#v1.0.0 origin/${{ github.base_ref }}...HEAD --fail-on high
```

## 🧾 JSON output

`riskdiff --json` prints a summary plus every hunk, riskiest first:

```json
{
  "summary": { "files": 5, "hunks": 5, "high": 1, "medium": 2, "low": 1, "none": 1 },
  "hunks": [
    {
      "file": "src/routes/admin.js",
      "status": "modified",
      "line": 2,
      "context": "",
      "added": 0,
      "removed": 1,
      "score": 50,
      "level": "high",
      "findings": [
        { "id": "auth-check-removed", "weight": 50, "reason": "Removes an authentication or permission check" }
      ]
    }
  ]
}
```

`status` is `modified`, `added`, `deleted`, or `renamed`. `line` is the first changed line in the new file. `context` is the function name git prints in the hunk header, when there is one.

## ❓ FAQ

<details>
<summary><b>Is this a security scanner?</b></summary>

No. It's a **triage** tool built on fast regex heuristics. It will miss things and flag some false positives. Use it to decide what to read first, and keep using real tools (Semgrep, CodeQL, Snyk, secret scanners) for security.
</details>

<details>
<summary><b>Does it send my code anywhere?</b></summary>

No. It runs locally, makes no network calls, and uses no AI model. Your code stays on your machine.
</details>

<details>
<summary><b>Which languages does it support?</b></summary>

Rules are text-based, so any language works. Patterns are tuned for JavaScript/TypeScript, Python, Go, Java/Kotlin, Ruby, PHP, and SQL.
</details>

<details>
<summary><b>Why is a hunk scored 0 even though it's important?</b></summary>

No rule matched it. riskdiff only knows the patterns in the tables above, so "no findings" never means "safe". If a pattern keeps biting you, open an issue or a PR with a rule and a test.
</details>

<details>
<summary><b>Can I add my own rules or change weights?</b></summary>

Yes. Use `rules` and `customRules` in [`.riskdiff.json`](#%EF%B8%8F-configuration). Built-in rules live in [`src/rules.js`](src/rules.js) if you want to contribute one.
</details>

## 🛠️ Development

```bash
git clone https://github.com/zeitgeistz/riskdiff.git
cd riskdiff
npm test          # node --test, no install needed
node bin/riskdiff.js --help
```

```text
bin/riskdiff.js   CLI: argument parsing, output, exit codes
src/analyze.js    The pipeline: config → git diff → parse → score
src/git.js        Reading diffs, untracked files, and new file contents from git
src/diff.js       Unified diff parser → files and hunks
src/source.js     Comment stripping and riskdiff-ignore directives
src/deps.js       Finds the dependencies a manifest hunk adds
src/rules.js      Built-in risk rules and weights
src/config.js     .riskdiff.json loading, validation, globs
src/score.js      Scores and sorts hunks, maps scores to levels
src/report.js     Text, Markdown, and JSON output
schema/           JSON schema for .riskdiff.json
skills/           Claude Code skill
test/             Tests (node:test)
```

### Adding a rule

1. Add an object to `rules` in `src/rules.js` with `id`, `weight`, `reason`, and one of `path`, `added`, `removed`, or `match`.
2. Add a test in `test/riskdiff.test.js` that proves it fires, plus one that proves it doesn't fire on a similar safe line.
3. Add it to the tables in this README.

## 🗺️ Roadmap

- [ ] **Package check:** verify that new dependencies exist in the registry and flag very new or look-alike packages (slopsquatting)
- [x] Config file for custom rules, weights, and ignored paths (v1.1)
- [x] Include untracked files (v1.1)
- [x] Ignore comments, and `riskdiff-ignore` directives (v1.1)
- [ ] Published to npm (`npx riskdiff`)

## 📄 License

[MIT](LICENSE)
