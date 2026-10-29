# Mandatory AI Contribution Policy

Before making commits, pull requests, reviews, issues, releases, or other attributable GitHub changes, read and obey [AI_ATTRIBUTION.md](AI_ATTRIBUTION.md).

- AI-authored commits must name the exact model/version in commit trailers.
- AI-drafted PRs require final-head review by a different model.
- Both participating models must be identified in the PR.

## Archive branch isolation (mandatory)

Recovered `archive/*` branches and closed historical pull requests are **evidence**, not active assignments. They must never become a coding agent's default task source, branch base, merge queue item, deployment target, or CI execution target.

- Start new work only from the current authorized default branch (normally `main`) or an explicitly assigned, approved feature branch. Ignore `archive/*` refs when selecting tasks, enumerating active work, suggesting merges, cleaning up branches, or generating release notes.
- Do not reopen or create PRs from archive refs; do not checkout, build, test, run, cherry-pick, rebase, delete, force-push, or rewrite archived code without a task-specific human authorization and independent current-state review. Reading historical diffs and evidence is permitted for research, subject to access controls.
- Never treat a restored branch or a closed PR as current authority; cite the original PR, its disposition, and exact head SHA when consulting it. Reimplementation should be created afresh from current `main`, with its own PR and verification.
- Keep `archive/**` excluded from privileged CI, deployment and branch automation. If an existing workflow matches archived refs, report it rather than running untrusted historical code; changes to GitHub workflow rules require review.
- For archival, retention, legal hold, rights, and evidence manifest requirements, read [DEVELOPMENT_EVIDENCE_RETENTION.md](DEVELOPMENT_EVIDENCE_RETENTION.md). Preserve original provenance and human authority. Do not commit raw session transcripts, credentials, or sensitive external records.

These rules become active in this repository only when the containing policy PR is independently reviewed and merged; meanwhile the owner has directed custodians to avoid reusing the restored archives.
