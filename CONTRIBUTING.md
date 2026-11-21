# Contributing to riskdiff

Thanks for helping. The most useful contributions are **new rules**, **fixes for false positives**, and **bug reports with a diff that reproduces them**.

## Setup

```bash
git clone https://github.com/zeitgeistz/riskdiff.git
cd riskdiff
npm test                 # node --test, nothing to install
node bin/riskdiff.js --help
```

riskdiff has no dependencies, so please don't add any. It needs Node.js 18.11+ and git.

## Reporting a false positive or a missed risk

Open an issue with the smallest diff that shows it. `git diff > case.patch` and paste the relevant part. Say which rule fired (or which one you expected) and why that's wrong.

## Adding or changing a rule

1. Rules live in [`src/rules.js`](src/rules.js). Each one has an `id`, a `weight`, a `reason`, and one of `path`, `added`, `removed`, or `match`.
2. Add tests in `test/` that prove the rule fires, and that it does **not** fire on a similar safe line. A rule without a negative test will get false positives.
3. Weights: 50 is high on its own, 25 is medium, and below that is low. Most rules should be 15–30.
4. Add the rule to the tables in the README.

Patterns run on added or removed lines with comments stripped (unless the rule has `raw: true`). Removal rules compare counts, so moved code doesn't fire them.

## Pull requests

- Keep each PR to one change and include tests.
- Run `npm test` on your machine. CI runs on Linux and Windows with Node 20, 22, and 24.
- Add a line to `CHANGELOG.md` under an "Unreleased" heading.
- Match the style of the code around your change: small functions, plain JavaScript, short comments only where something isn't obvious.

## Good first issues

Look for the [`good first issue`](https://github.com/zeitgeistz/riskdiff/labels/good%20first%20issue) label. They are usually one rule or one output tweak, with the files to touch listed in the issue.
