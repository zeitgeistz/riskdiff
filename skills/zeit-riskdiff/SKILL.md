---
name: zeit-riskdiff
description: Rank the current git changes by risk with the riskdiff CLI and review the riskiest hunks first. Use after making multi-file edits, before committing, when the user asks to review a diff or PR, or asks "what's risky in this change?".
---

# zeit-riskdiff

`riskdiff` scores every hunk of a git diff (removed auth checks, hardcoded secrets, SQL injection, skipped tests, new dependencies, CI changes, and more) and sorts them riskiest first.

## Steps

1. Pick the diff to check:
   - Uncommitted work (default): no arguments.
   - Staged only: `--staged`.
   - A branch or PR: a range such as `main...HEAD`.
2. Run it with JSON output:

   ```bash
   riskdiff --json            # if installed globally
   npx -y github:zeitgeistz/riskdiff#v1.0.0 --json   # otherwise
   ```

3. For every hunk with `level` of `high` or `medium`, open the file at `file:line`, read the change, and decide whether the finding is a real problem or a false positive.
4. Report to the user, riskiest first:
   - `file:line`, the rule ids, and one sentence on whether it is a real issue.
   - A fix for each real issue. Ask before applying fixes the user did not request.
   - A one-line count of low-risk hunks you skimmed.
5. If there are no high or medium hunks, say so in one line.

## Notes

- Untracked files are not in `git diff`. Run `git add -N <file>` first to include new files.
- A score is a prompt to look, not a verdict. Never claim something is safe only because riskdiff scored it low.
