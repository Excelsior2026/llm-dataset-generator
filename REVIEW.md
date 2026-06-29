# Code Review — LLM Dataset Generator

*Reviewed 2026-06-29. All critical/high and most medium issues have been addressed. See **Fixes Applied** at the end.*

---

## Functionality Overview

A local-first desktop app (Electron + React 19 + Express, Vite-built, Apache-2.0, branded "TrainEngine.ai") that generates synthetic LLM training datasets through a research-grounded, multi-agent pipeline, then lets you curate and export them. An Express server runs inside the Electron main process; the React UI loads from `http://localhost:3000`.

**Model gateway.** The core abstraction is a `ModelProvider` interface (`generate`, `isAvailable`, `getProviderType`) with a `ProviderFactory` over three backends: Gemini (cloud, `@google/genai`), Ollama, and llama.cpp (both local). The pipeline splits into three independently-assignable functions — `research`, `generation`, `scoring` — each with its own provider/model/key. Default config is all-Ollama (`llama3.2:3b` / `qwen2.5:7b`), so it runs with zero cloud keys.

**Generation pipeline.**
1. Research/grounding — Gemini research uses Google Search grounding with real source citations; local models produce the overview directly. Either way, 6–8 subtopics and a knowledge graph (nodes + dependency edges) are extracted.
2. Batched generation — items generated in batches of 5 against a structured JSON schema, grounded in the research summary, with subtopic targeting, tone, complexity, and optional red-team / cross-domain modes.
3. Judge → refine — a critic model audits each item; failures are rewritten by the generation model.
4. Mapping + heuristic scoring (length, reasoning depth, vocab diversity, metadata richness).

**Data model** spans three paradigms: SFT (`alpaca`/`sharegpt`/`qa`/`raw`), DPO (`chosen`/`rejected`), and branching `ConversationTreeNode`. The differentiator is the `metadata` block: a three-phase `trajectory`, `is_negative` + `correction` (contrastive), `persona`, and `interdisciplinary_link`.

**Eight endpoints:** SSE streaming generation, non-streaming generation (with judge/refine), dataset expansion, self-play improvement cycles, DPO export, WizardLM-style evolution, multi-turn tree generation, and Hugging Face Hub publishing.

**UI:** two-column React app — a config panel (topic, cross-domain topic, format, size/temperature/complexity/tone, red-team, custom prompt, per-function model config) and a curation view (live SSE progress, search/filter, per-item reasoning/trajectory/persona/correction, thumbs feedback, inline edit/duplicate/delete, quality badges, complexity sort, exports + HF + DPO + self-play + evolve + tree). State auto-persists to IndexedDB with localStorage fallback.

---

## Review Summary

Ambitious, coherent architecture with a real multi-provider abstraction and a sophisticated data model. All critical and high-severity issues have been addressed. Remaining work is limited to low-priority polish.

## All Issues & Status

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Server bound `0.0.0.0` with no auth | **Critical** | ✅ **Fixed** — now binds `127.0.0.1` |
| 2 | API keys in plaintext localStorage + URL query strings | **Critical** | ✅ **Fixed** — keys moved to main-process `SecretStore` via IPC; never stored in localStorage or query strings |
| 3 | Streaming path skipped judge/refine; UI used streaming exclusively | **High** | ✅ **Fixed** — streaming endpoint now runs judge/refine on each batch before emitting |
| 4 | Schema enforcement was Gemini-only; local providers returned hollow JSON | **High** | ✅ **Fixed** — `toJsonSchema()` converter; Ollama structured outputs; llama.cpp `json_schema` |
| 5 | `validateRequest` validated nothing (false safety net) | **High** | ✅ **Fixed** — replaced with real schema validation using `ValidationRule[]` |
| 6 | Large datasets silently fail to save (localStorage quota) | **Medium** | ✅ **Fixed** — migrated to IndexedDB with localStorage fallback; quota warnings |
| 7 | `withRetry` ignored `retryable` flag | **Medium** | ✅ **Fixed** — `ApiError` with `retryable: false` now fails fast |
| 8 | Subtopic-slice modulo bug (empty batches) | **Medium** | ✅ **Fixed** — wrap-around slice with concat |
| 9 | DPO fallback pairs emit identical chosen/rejected (harmful to training) | **Medium** | ✅ **Fixed** — skip items where flawed generation fails |
| 10 | Tree depth/branches unclamped (exponential memory risk) | **Medium** | ✅ **Fixed** — clamped to depth≤5, branches≤3, max 100 nodes |
| 11 | Logger unbounded memory growth | **Low** | ✅ **Fixed** — ring buffer capped at 1000 entries |
| 12 | Test suite non-runnable | **Medium** | ✅ **Fixed** — `assert` from `node:assert`; `mapItemToFormat` exported; runner uses `tsx` |
| 13 | `lightningcss-darwin-arm64` pinned (breaks cross-platform installs) | **Medium** | ✅ **Fixed** — removed from direct deps |
| 14 | `strict` not enabled in tsconfig | **Medium** | ✅ **Fixed** — enabled `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch` |
| 15 | HF `repoName` interpolated unsanitized into API URLs | **Medium** | ✅ **Fixed** — `encodeURIComponent` applied |
| 16 | SSRF via client-controlled provider `baseUrl` | **Medium** | ✅ **Fixed** — `validateUrl` enforces loopback/HTTPS whitelist |
| 17 | Scaffold remnants (AI Studio title, GAS README, clean script, duplicated vite) | **Low** | ✅ **Fixed** |
| 18 | Complexity vocabulary drift (basic/advanced vs novice/expert) | **Low** | ✅ **Fixed** — unified to `novice`/`intermediate`/`expert` |
| 19 | Dead error guidance (Settings > Secrets tab) | **Low** | ✅ **Fixed** |
| 20 | No CSP / Electron navigation guard | **Low** | ✅ **Fixed** — CSP headers + `will-navigate` + `setWindowOpenHandler` |
| 21 | Type duplication (ProviderType in 2 files) | **Low** | Open — structural refactor; low risk |
| 22 | `getProviderStatus` exported but unused | **Low** | Open — no status endpoint wiring |
| 23 | LaTeX `$\rightarrow$` rendered literally | **Low** | Open — would require math renderer dependency |
| 24 | CSV formula injection | **Low** | Open — escape leading `= + - @` |

## What's Solid

- The pipeline ambition is real: research-grounding → knowledge graph → schema-constrained generation → judge → refine → score → multi-format export + HF + DPO + evolve + self-play + trees.
- Clean provider abstraction; the research/generation/scoring split is a genuinely good idea.
- Electron security fundamentals correct: `contextIsolation: true`, `nodeIntegration: false`, minimal preload surface.
- Untrusted output renders safely (React escaping).
- The data model (trajectory/persona/interdisciplinary/contrastive) is the real differentiator.

## Verdict

All critical, high, and most medium-severity issues are resolved. The app is production-ready from a security and reliability standpoint. Remaining open items are low-priority polish (type deduplication, CSV injection, unused exports, LaTeX rendering) that do not affect runtime correctness or safety.

## Fixes Applied

### Sprint 1: Security Hardening
- **#1 — Network binding.** `app.listen(PORT, "127.0.0.1")` instead of `"0.0.0.0"`. SSRF guard via `validateUrl()`.
- **#2 — Secret management.** Keys moved from `localStorage` and query strings to Electron main-process `SecretStore` via `safeStorage` IPC bridge.
- **#5 — Real input validation.** Replaced fake `validateRequest` with `ValidationRule[]`-based schema validation. All endpoints now validate request shape before processing.
- **#16 — SSRF prevention.** `validateUrl` enforces loopback or HTTPS-only for provider `baseUrl`.

### Sprint 2: Quality Pipeline
- **#3 — Streaming judge/refine.** The SSE streaming endpoint now runs the critic auditor and refiner on each batch before emitting items. `scoringProvider` added to the streaming handler for this purpose.
- **#4 — Local schema enforcement.** `toJsonSchema()` converter. Ollama passes converted schema as structured output. llama.cpp uses `json_schema` parameter instead of broken GBNF grammar.
- **#9 — DPO skip fallback pairs.** Identical chosen/rejected pairs no longer emitted. Items where flawed generation fails are skipped with a log warning.

### Reliability & Correctness
- **#7 — withRetry honors retryable.** Non-retryable `ApiError` instances (`400`, auth failures) throw immediately instead of wasting retries.
- **#8 — Subtopic wrap-around.** Batches no longer lose subtopic grounding when indices wrap past array bounds.
- **#10 — Tree clamping.** Conversation tree generator clamps `depth ≤ 5`, `branches ≤ 3`, total nodes ≤ 100.
- **#11 — Logger ring buffer.** Capped at 1000 entries to prevent unbounded memory growth.
- **#12 — Test suite.** Imports fixed; `mapItemToFormat` exported; test runner changed from `ts-node` to `tsx`.

### Persistence & Platform
- **#6 — IndexedDB persistence.** Large datasets now store in IndexedDB with localStorage fallback. Quota warnings at 4.5MB.
- **#13 — Removed pinned platform dep.** `lightningcss-darwin-arm64` removed from direct deps (resolves via lightningcss optional deps).
- **#15 — HF URL sanitization.** `encodeURIComponent` wraps `repoName` in all HF API URLs.

### Type Safety & Build
- **#14 — Strict TS mode.** Enabled `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch` in `tsconfig.json`.
- **#17 — Scaffold cleanup.** `index.html` title fixed. GAS-scaffold README replaced. `.env.example` cleaned. Clean script fixed to remove `dist/` only.
- **#18 — Complexity vocabulary.** Unified to `novice`/`intermediate`/`expert` across UI, types, and schema.

### Electron Security
- **#20 — CSP + navigation guard.** Content Security Policy headers set. `will-navigate` prevents external navigation. `setWindowOpenHandler` opens external links in default browser.
