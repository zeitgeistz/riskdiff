# Changelog

## 1.3.0 — 2026-11-21

- **GitHub Action**: `uses: zeitgeistz/riskdiff@v1` posts (and keeps updating) a risk table on the PR, writes it to the job summary, and fails on a chosen level. Inputs: `base`, `fail-on`, `comment`, `check-packages`, `sarif`, `github-token`.
- **`--sarif`** output (SARIF 2.1.0) for GitHub code scanning and other viewers.
- **`-o, --output <file>`** writes the report to a file.
- Markdown reports start with a `<!-- riskdiff -->` marker so the Action can find its own comment.
- npm package is named `riskdiff-cli` (the command is still `riskdiff`), with a release workflow that publishes to npm when an `NPM_TOKEN` secret is set.
- Using two output formats at once (e.g. `--json --md`) is now an error.

## 1.2.0 — 2026-11-21

- **Package check.** Two new offline rules: `package-lookalike` (a new npm/PyPI dependency one or two edits from a popular package) and `duplicate-dependency` (a new library that does the same job as one already in the manifest).
- **`--check-packages`** (or `"checkPackages": true`) looks new npm and PyPI dependencies up in their registries and adds `package-not-found`, `package-new`, `package-low-downloads`, and `package-deprecated`. Only package names are sent. Unreachable registries produce a warning, not a failure.
- Rule reasons can now name the specific package or library involved.

## 1.1.0 — 2026-11-21

- **Comments are ignored.** Code rules no longer fire on comments (`// don't use eval()`), and removing commented-out code isn't treated as removing a check. `hardcoded-secret` and `todo-added` still read comments.
- **`riskdiff-ignore`** comment on an added line silences named rules (or all rules) for that hunk, with room for a reason.
- **`.riskdiff.json` config:** `ignore` globs, turn rules off or change weights with `rules`, add `customRules`, and set a default `failOn`. Invalid config exits with code 2 and a clear message. JSON schema in `schema/`.
- **Untracked files** are included by default when no range is given. `--no-untracked` turns this off.
- **Test tamper warning** at the top of text and Markdown output when a diff skips tests, removes assertions, or deletes test files. Also in JSON as `summary.testTamper`.
- **Better dependency detection:** `package.json` is read from the new side of the diff, so `scripts` and metadata are no longer mistaken for dependencies. JSON hunks now list `deps`.
- New `--config <path>` option.

## 1.0.0 — 2026-11-21

First release.

- `riskdiff` CLI that scores every hunk of a git diff and sorts hunks riskiest first.
- 21 rules covering secrets, dangerous exec, SQL injection and destructive SQL, disabled security checks, removed auth checks, removed error handling and validation, weakened or deleted tests, new dependencies, and sensitive paths (auth, payments, crypto, migrations, CI, `.env`).
- Removal rules ignore code that was moved or re-indented within a hunk.
- Text, `--json`, and `--md` output, plus `--code` to show changed lines.
- `--fail-on <level>` for CI and pre-commit hooks.
- Reads from git (working tree, `--staged`, any range) or from stdin.
- `zeit-riskdiff` Claude Code skill.
- Zero dependencies; Node.js 18.11+.
