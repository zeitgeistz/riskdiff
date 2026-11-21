# Changelog

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
