# Development Evidence Preservation and Retention Policy

**Status: REQUIRED upon human approval and merge.**
**Owner directive:** Preserve authentic engineering, human decision, and cross-model collaboration evidence. This policy supplements `AI_ATTRIBUTION.md`; it never reduces human authority.

## Scope and purpose

Applies to human and AI contributors, agents, automation, maintainers and release operations in this repository. Preserve evidence for debugging, security accountability, research, governance, project reconstruction, and potential authorized licensing. **Preservation is not permission to disclose, sell, or train on the data.** Keep confidential, third-party and regulated material within its applicable rights and controls.

## Non-destructive default

1. Do not delete, force-push, squash-away, rewrite, or garbage-collect unique development history solely for tidiness.
2. Do not automatically delete a branch after a PR merge or closure **until the archive gate below is independently verified**. Disable automatic merged-branch deletion in repository settings where authorized. Do not confuse retaining a branch with proving that its evidence is durably archived.
3. Prefer regular merge commits for substantive human/AI deliberation so original commits remain reachable. Squash and rebase are permitted only after verified preservation of the original PR head and commit graph.
4. Preserve abandoned, rejected, superseded, and unmerged proposals, including failures and disagreements; never represent them as approved or production-ready.
5. Never retrospectively modify historic authorship or attribute work to a different model. Record corrections in append-only attestations.

## PR evidence archive gate (required before deleting a source ref)

A responsible maintainer or approved automation must:

- Record repository, PR/issue identifiers, source branch name, source repository, target branch, **original head SHA**, base SHA, merge SHA (if any), original commit graph, and the merge/close disposition.
- Export full PR timeline where accessible: body revisions when recorded, discussion comments, review submissions and threads, requested changes, approvals, status checks, workflow results, issue/ADR links, and release references. Note inaccessible or expired artifacts explicitly.
- Preserve available agent/session transcripts, tool records, prompts and visible outputs, including parent/child session relationships and source-provider identifiers, under the approved private evidence system. Never claim to have captured hidden model reasoning.
- Record exact AI model/provider/tool identities, participant roles, timestamps, human authorization, relevant review head SHA, and conflicting/contested evidence **as observed**; mark reconstructed links or inferred intent as such.
- Store source artifacts in an access-controlled, encrypted archive outside the repository; generate SHA-256 content hashes and a versioned manifest with retention class, capture time, storage identifier, provenance, and restoration test result. **Do not commit raw conversations, customer data, tokens, credentials, or confidential evidence to Git.**
- Verify recoverability from the archive before authorizing deletion. A closed PR webpage alone is not a verified backup.

## Branch-specific preservation

- If a commit remains reachable from an appropriately retained protected branch, its Git history may already be preserved. Record that reachability; recreating the old branch name is optional.
- If a closed/merged/squashed branch has **unique commits not reachable from retained refs**, preserve them using a vetted, nondeploying `archive/` reference or a verified Git bundle in private storage before deleting the source. Use a reproducible link to the original PR and head SHA.
- Recovered or archival branches are **evidence only**: never deploy, merge, or restart feature development from them without independent current-state review and human approval.
- Check for secrets, confidentiality restrictions, malicious code, and third-party rights **before exposing or restoring a deleted ref**; quarantine unsafe material instead of publishing it via GitHub branches.
- Keep archive refs excluded from production deployments and privileged CI; archive branches must not trigger deployment. Document superseded alternatives without confusing them with the accepted implementation.

## Human authority, legal preservation, and disclosure

- Only authorized humans approve merge, deletion after archive, release, external access, commercial licensing, legal holds, and final records disposition. Models may recommend but cannot confer authority on themselves.
- Apply the governing records schedule, contractual restrictions, deletion requests, intellectual-property rights, and security incident obligations. A lawful or protective purge/redaction overrides ordinary retention, with a minimal non-sensitive disposition audit trail where permitted.
- Prepare external buyer samples **only from a separately approved, de-identified export** with explicit rights review; do not connect buyers to live accounts or repositories as an implicit consequence of this policy.
- Maintain access logs and versioned manifests; distinguish original evidence, independently corroborated facts, reconstruction inferences, and unresolved conflicts.

## Enforcement and adoption

This Markdown policy alone is **not a technical branch protection rule**. Repository administrators must independently configure GitHub deletion protections / rulesets and CI archive gates where supported. Until proven effective, custodians must use the manual archive gate.

A PR may not claim this policy is enforced by GitHub settings unless those settings and end-to-end archive/recovery tests have been verified. Policy exceptions must identify the human approver, reason, affected evidence, risk and mitigation.

## Model attribution for this policy

AI-Model: GPT-6
AI-Provider: OpenAI
AI-Tool: ChatGPT
AI-Role: Drafted
Independent-Cross-Model-Review: Pending
Human-Authority: Required
