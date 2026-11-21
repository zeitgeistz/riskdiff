# Changelog

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
