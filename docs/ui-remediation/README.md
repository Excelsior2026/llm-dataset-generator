# UI remediation — LLM-01 clean-start blocker

## Roles and ownership

- **Implementer:** Big Pickle (`opencode/big-pickle`; exact version not exposed by the harness), acting as the persistent coding subagent in this worktree.
- **Orchestrator / integration owner:** Big Pickle (parent session). This subagent does not push, merge, open a PR, deploy, or change credentials/production data.
- **Reviewer:** a separate reviewer with a different model is expected to follow. No cross-model review has been performed by this subagent. `AI_ATTRIBUTION.md` requires such a review for AI-drafted PRs; it has not been claimed here.

## Scope

Baseline (verified with `git rev-parse HEAD` before any edit): `34d08a7eef4d1fdd0ad18ad82880b0a89cc42037`
Branch: `fix/ui-remediation/llmgen-clean-start`
Worktree: `ui-ux-review/worktrees/wave1/Excelsior2026__llm-dataset-generator`

Remediation commit (source + lockfile only): `fd02e47f006984e8f26a35cfd3bdf233db4907d2`
Documentation commit: the commit containing this file; its self-referential SHA cannot be embedded in its own text and is reported to the orchestrator at handoff.

### In scope

- LLM-01 (P0): a clean checkout does not start. Both originally confirmed failures were reproduced from the pristine baseline and fixed:
  1. `ERR_MODULE_NOT_FOUND: Cannot find package 'compression' imported from .../server.ts`
  2. `TransformError: Multiple exports with the same name "LogLevel" at src/utils/logger.ts:177`
- Three additional clean-start blockers uncovered while driving the app to HTTP 200, all of the same stale-module family (see `DECISIONS.md` ADR-002/003):
  3. duplicate named export of `GenerationService` (`src/services/GenerationService.ts:394`);
  4. runtime re-export of type-only names from `../types` (`src/providers/types.ts:1`), which crashed ESM instantiation with `SyntaxError: ... does not provide an export named 'ModelFunction'`;
  5. missing `default` export in `GenerationService.ts`, which broke the existing service barrels that re-export `default as GenerationService`.
- Deliberate lockfile regeneration and a successful clean `npm ci` + `npm run dev` reaching HTTP 200, with screenshots captured as artifacts.

### Out of scope / not started

- P1 LLM-02 (sort/regenerate behavior) — explicitly not started in this wave.
- Remediation of the pre-existing typecheck (1106 remaining errors), ESLint v9 config mismatch, failing schema assertions in `npm test`, Prettier drift in 41 files, and the Vite browser build failure. These were measured, not fixed; no check was weakened.
- No push, merge, PR, deploy, credential change, or production-data change.

## Approach

1. Verified baseline SHA and clean worktree.
2. Captured all baseline failures **before editing source** into `evidence/`.
3. Made minimal source edits and deliberately regenerated the stale lockfile (why `npm install` was unavoidable is recorded in `DECISIONS.md`).
4. Re-ran the clean install, started the dev server, confirmed HTTP 200 with `curl`, and captured headless-Chrome screenshots.
5. Ran every repo-native check and recorded pass/fail without weakening any of them.

Files changed in the remediation commit:

| File | Change |
| --- | --- |
| `package.json` | add `compression@^1.8.2` (dependency) and `@types/compression@^1.8.1` (dev dependency) |
| `package-lock.json` | deliberately regenerated; 106 package entries added, 2 version changes, 0 removed |
| `src/utils/logger.ts` | remove redundant `export { LogLevel };` (the `export enum` already exports it) |
| `src/services/GenerationService.ts` | remove duplicate trailing named export; add default export required by existing barrels |
| `src/providers/types.ts` | make re-export type-only and add explicit local type imports |

Evidence is in `DECISIONS.md`, `VERIFICATION.md`, and `evidence/`. Screenshots are **captured, not visually inspected**; they are artifacts only.
