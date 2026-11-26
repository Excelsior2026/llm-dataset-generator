# Verification record — LLM-01

Model attribution: AI-Model: Big Pickle (opencode/big-pickle; exact version not exposed) | AI-Provider: opencode | AI-Role: Authored

All commands were run in the assigned worktree at baseline `34d08a7eef4d1fdd0ad18ad82880b0a89cc42037` unless stated otherwise. Full output is in `evidence/`. Classifications: **passed**, **failed**, **blocked**, **not-run**. No check was weakened, skipped, or edited to make it pass.

## Environment

| Item | Value |
| --- | --- |
| `git rev-parse HEAD` (before edit) | `34d08a7eef4d1fdd0ad18ad82880b0a89cc42037` (clean worktree, branch `fix/ui-remediation/llmgen-clean-start`) |
| OS | macOS (Darwin) |
| Node | `v22.23.4` |
| npm | `12.2.0` (`allow-remote=none`, install scripts gated by `allowScripts`) |
| `.nvmrc` | `20` — Node 20 runtime verification: **not-run** |
| `gtimeout` | `/opt/local/bin/gtimeout` (used to bound server/check runs) |
| Chrome | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Lockfile tool | npm `11.11.0` via `npx --yes npm@11.11.0` (npm 12 blocked lockfile regeneration; see ADR-001) |

## Baseline (captured **before** any source or manifest edit)

| # | Command (exact) | Result | Evidence |
| --- | --- | --- | --- |
| B1 | `git rev-parse HEAD && git status --short && git branch --show-current` | **passed** — SHA matched baseline, no changes, correct branch | README.md |
| B2 | `npm ci` (wrapped: `gtimeout 300s npm ci`) | **failed** — `EUSAGE`: lockfile out of sync with `package.json`; missing `eslint`, `prettier`, `@typescript-eslint/*`, `swagger-ui-express` and transitive entries. This is a pre-existing defect independent of `compression`. | `evidence/baseline-npm-ci.log` |
| B3 | `npm install --package-lock=false --no-audit --no-fund` | **passed** — 603 packages added in 32s; lockfile untouched (`git status` clean). Baseline setup only, not the fix. | `evidence/baseline-install-nolock.log` |
| B4 | `npm run dev` (`gtimeout 20s npm run dev`) | **failed** — `ERR_MODULE_NOT_FOUND: Cannot find package 'compression' imported from .../server.ts`; exit 1 | `evidence/baseline-npm-run-dev.log` |
| B5 | `node --import tsx --eval 'import("./src/utils/logger.ts").catch(e => { console.error(e); process.exitCode = 1; })'` | **failed** — `TransformError` at `src/utils/logger.ts:177:9`: `Multiple exports with the same name "LogLevel"`; exit 1 | `evidence/baseline-logger-transform.log` |
| B6 | `npm run typecheck` (`gtimeout 180s npm run typecheck`) | **failed** — 1118 `error TS` lines, exit 2 (includes the `compression` import and duplicate-export errors) | `evidence/baseline-typecheck.log` |
| B7 | `npm run lint` (`gtimeout 180s npm run lint`) | **failed** — ESLint v9 cannot find `eslint.config.(js\|mjs\|cjs)`; repo only has `.eslintrc.json`; exit 2 | `evidence/baseline-lint.log` |
| B8 | `npm test` (`gtimeout 180s npm test`) | **failed** — same `LogLevel` `TransformError`, exit 1; tests never started | `evidence/baseline-test.log` |
| B9 | `npm run format:check` | **not-run** at baseline | — |
| B10 | `npm run build` | **not-run** at baseline | — |

## Lockfile regeneration attempts and fix

| # | Command (exact) | Result | Evidence |
| --- | --- | --- | --- |
| F1 | `npm install --package-lock-only --no-audit --no-fund` | **failed** — `EALLOWREMOTE`: npm 12 `allow-remote=none` refused `@tailwindcss/oxide-wasm32-wasi` tarball | `evidence/fix-npm-install-lockfile-only.log` |
| F2 | `npm install --package-lock-only --omit=optional --no-audit --no-fund` | **failed** — identical `EALLOWREMOTE` | `evidence/fix-npm-install-lockfile-only-omit-optional.log` |
| F3 | `npm install --package-lock-only --offline --no-audit --no-fund` | **failed** — identical `EALLOWREMOTE` | `evidence/fix-npm-install-lockfile-only-offline.log` |
| F4 | `npx --yes npm@11.11.0 install --package-lock-only --no-audit --no-fund` | **passed** — lockfile regenerated; `compression` and `@types/compression` present; 106 entries added / 2 version changed / 0 removed | `evidence/fix-npm11-install-lockfile-only.log` |
| F5 | `npm ci` (npm 12.2.0) | **passed** — exit 0. Reports 23 vulnerabilities and 7 blocked install scripts (warnings only, not suppressed) | `evidence/fix-npm-ci.log` |

## Startup blockers discovered after earlier fixes

These were not in the original two-item finding; each was captured before its fix and then removed.

| # | Command / condition | Result | Evidence |
| --- | --- | --- | --- |
| S1 | `PORT=3101 gtimeout 120s npm run dev &` + `curl` loop | **failed** — `TransformError: Multiple exports with the same name "GenerationService"` at `src/services/GenerationService.ts:394:9`; no listener; `curl` exit 7 | `evidence/dev-server.log`, `evidence/dev-verification.log` |
| S2 | `PORT=3102 gtimeout 120s npm run dev &` + `curl` loop (after S1 fix) | **failed** — `SyntaxError: The requested module '../types' does not provide an export named 'ModelFunction'` from `src/providers/types.ts:1`; no listener; `curl` exit 7 | `evidence/dev-server-after-fix.log`, `evidence/dev-verification-after-fix.log` |
| S3 | `PORT=3103 gtimeout 120s npm run dev &` + `curl` loop (after S2 fix) | **passed** — ready on attempt 10, HTTP 200 | `evidence/dev-server-attempt3.log`, `evidence/dev-verification-attempt3.log` |

## Final verification (all fixes applied, fresh `npm ci`)

| # | Command (exact) | Result | Evidence |
| --- | --- | --- | --- |
| V1 | `git rev-parse HEAD` | **passed** — remediation commit `fd02e47f006984e8f26a35cfd3bdf233db4907d2` | README.md |
| V2 | `gtimeout 300s npm ci` | **passed** — `npm_ci_exit=0` | `evidence/final-npm-ci.log` |
| V3 | `PORT=3104 gtimeout 150s npm run dev > .../final-dev-server.log 2>&1 &` | **passed** — `Server running on http://127.0.0.1:3104` | `evidence/final-dev-server.log` |
| V4 | `curl -sS -D .../final-http-root-headers.txt -o .../final-http-root-body.html -w "%{http_code}" http://127.0.0.1:3104/` | **passed** — `200`, `curl_exit=0`; headers `HTTP/1.1 200 OK`, `Content-Type: text/html`, Express/Vite app HTML with `<div id="root">` and `/src/main.tsx`. Ready on attempt 9. | `evidence/final-dev-verification.log`, `evidence/final-http-root-headers.txt`, `evidence/final-http-root-body.html` |
| V5 | `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-first-run --hide-scrollbars --window-size=1440,900 --virtual-time-budget=6000 --screenshot=docs/ui-remediation/evidence/screenshot-1440x900.png http://localhost:3104` | **passed** — `5851 bytes written`, exit 0; Chrome emitted non-fatal `CVDisplayLinkCreateWithCGDisplay failed` warnings | `evidence/final-dev-verification.log` |
| V6 | same command with `--window-size=375,812 --screenshot=.../screenshot-375x812.png` | **failed** — Chrome exited 2 with `Teardown watchdog expired; recording dump and terminating`, **but** PNG was written (2538 bytes); artifact usable, process exit not clean | `evidence/final-dev-verification.log` |
| V7 | `ls -lh` + `sips -g pixelWidth -g pixelHeight` on both PNGs | **passed** — `1440x900` and `375x812` confirmed | `evidence/final-dev-verification.log` |
| V8 | Screenshots visually inspected | **not-run** — both are **captured, not visually inspected**; artifacts only, no UI claim is made from them | `evidence/screenshot-1440x900.png`, `evidence/screenshot-375x812.png` |
| V9 | `gtimeout 180s npm run typecheck` | **failed** — 1106 `error TS` lines, exit 2. Baseline had 1118; sorted diff contains **only removals** (12 lines), including all five fixed defects; no new typecheck error was introduced. | `evidence/final-typecheck.log`, baseline log |
| V10 | `gtimeout 180s npm run lint` | **failed** — ESLint v9 config file still missing, exit 2 (pre-existing) | `evidence/final-lint.log` |
| V11 | `gtimeout 180s npm test` | **failed** — 18 tests run, 14 pass, 4 fail, exit 1. Tests now execute (baseline crashed at transform). Failures are all `getSchemaForFormat` assertions expecting format-specific keys; no touched file contains that logic. These are latent failures unmasked by the fix, **not** verified as passing at baseline. | `evidence/final-test.log` |
| V12 | `gtimeout 180s npm run format:check` | **failed** — 41 files flagged, exit 1 (pre-existing drift; includes files untouched by this change) | `evidence/final-format-check.log` |
| V13 | `gtimeout 180s npm run build` | **failed** — Vite/Rollup: `"EventEmitter" is not exported by "__vite-browser-external"`, from `src/utils/advanced.ts:6`; exit 1. Pre-existing browser-target issue, out of scope. | `evidence/final-build.log` |
| V14 | `for p in 3101 3102 3103 3104; do lsof ...; done` | **passed** — 0 listeners remain; all dev servers cleaned up | — |

## Environment limits, failures, and lessons

- `npm ci` is impossible at baseline: the checked-in lockfile is stale. Regeneration is not cosmetic; it is required for a reproducible clean start.
- npm 12.2.0's `allow-remote=none` prevents `--package-lock-only` resolution of an optional URL-hosted tarball even though the host matches the configured registry. npm 11.11.0 via `npx` completed the same work without changing any committed security setting.
- npm 12 blocks 7 dependency install scripts by `allowScripts`; the dev server still starts. No script approval or `--dangerously-allow-all-scripts` was used.
- A fix can reveal additional blockers behind the first crash. Three further stale-module defects had to be cleared before HTTP 200; all are documented above and in `DECISIONS.md`.
- Chrome headless on this host emits display-link errors. Desktop capture exits cleanly; mobile capture writes the PNG but exits 2 during teardown. Neither image was visually reviewed.
- Typecheck improved from 1118 to 1106 errors with **no new error lines**; it remains red. Test/lint/format/build remain red for unrelated, pre-existing reasons.

## Residual risks / decisions needed from owner

1. **Cross-model review required.** Per `AI_ATTRIBUTION.md`, a different model must review the final head before any AI-drafted PR is treated as merge-ready. This subagent has not performed or claimed that review.
2. **P1 LLM-02 (sort/regenerate) not started** — deliberately deferred to a later wave.
3. **Lockfile churn** (106 added entries, 2 version changes) needs integration review; npm 11 was used only as a lockfile-generation tool.
4. **Node version mismatch**: verified on Node 22, `.nvmrc` pins 20. Node 20 verification is `not-run`.
5. **Red checks remain**: typecheck (1106), lint (ESLint v9 config), test (4 schema assertions), format (41 files), build (Vite `EventEmitter`). None were weakened; all need separate owner prioritization.
6. **Screenshots not visually inspected** — no responsive-layout or visual verdict is asserted in this wave.
