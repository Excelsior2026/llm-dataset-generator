# Architecture decision records — LLM-01

Model attribution: AI-Model: Big Pickle (opencode/big-pickle; exact version not exposed) | AI-Provider: opencode | AI-Role: Authored

## ADR-001 — Declare `compression` and regenerate the stale lockfile deliberately

**Status:** applied.

**Context**

- `server.ts:7` imports `compression` and `server.ts:119` uses it, but `package.json` did not declare it. Baseline `npm run dev` failed with `ERR_MODULE_NOT_FOUND`.
- The **pristine baseline lockfile was already out of sync with `package.json`**, independently of `compression`: `npm ci` at baseline failed with `EUSAGE` and listed missing dev dependencies (`eslint`, `prettier`, `@typescript-eslint/*`, `swagger-ui-express`, and their transitive packages). The original clone's uncommitted install-regenerated lockfile is consistent with that finding.
- Environment: Node `v22.23.4`, npm `12.2.0` (repo `.nvmrc` requests Node 20), npm 12 default `allow-remote=none`.

**Decision**

1. Add `"compression": "^1.8.2"` to `dependencies` and `"@types/compression": "^1.8.1"` to `devDependencies` (the latter removes a new `TS2307` for the import; it does not weaken any check).
2. Regenerate `package-lock.json` with `npx --yes npm@11.11.0 install --package-lock-only --no-audit --no-fund`, then verify with npm 12 `npm ci`. `npm install` was therefore **deliberately required** because the committed lockfile could not satisfy `npm ci` at baseline.
3. Keep the regenerated lockfile committed so future clean checkouts are deterministic.

**Why npm 11 was used for lockfile generation:** npm 12.2.0 with `allow-remote=none` refused to fetch the optional `https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.0.tgz` during `--package-lock-only` resolution (`EALLOWREMOTE`). Three local attempts (plain, `--omit=optional`, `--offline`) all failed identically and are logged. npm 11.11.0 completed the same command successfully. No `.npmrc` or npm security policy was changed or committed.

**Risks / residual risk**

- Lockfile churn: 106 package entries added, 2 version changes, 0 removed relative to baseline. Fresh resolution can shift transitive versions; this must be reviewed by the integration owner.
- `npm ci` under npm 12 reports 7 install scripts blocked by the `allowScripts` policy and 23 vulnerabilities (1 low, 9 moderate, 11 high, 2 critical). Both are inherited from dependency policy/environment, not introduced by the source fix; neither was suppressed.
- `npx npm@11.11.0` is a temporary tool fetch from the configured public registry. It was used only to write the lockfile; no runtime dependency on npm 11 was added.
- Node 22 was used although `.nvmrc` pins 20; behavior under Node 20 was **not-run**.

**Rejected alternatives**

- `npm install --package-lock=false` alone: succeeded at installing into `node_modules` but intentionally writes no lockfile, leaving clean checkouts non-deterministic. Used only for baseline capture, not as the fix.
- Hand-editing `package-lock.json` to add entries: error-prone and not reproducible.
- `--allow-remote=all` / relaxing npm's supply-chain guard: unnecessary once npm 11 was available, and would have changed local security posture.
- Removing the `compression` middleware: changes app behavior instead of fixing the missing declaration.
- Adding `winston` just to satisfy an unused type-only import in `server.ts:18`: out of scope and expands the dependency surface.

## ADR-002 — Remove duplicate trailing exports instead of renaming symbols

**Status:** applied.

**Context**

- `src/utils/logger.ts:6` declares `export enum LogLevel` and line 177 re-exported the same name via `export { LogLevel };`. esbuild/tsx rejected the module with `TransformError: Multiple exports with the same name "LogLevel"`.
- After that fix, the next startup exposed the identical pattern in `src/services/GenerationService.ts`: `export class GenerationService` (line 57) plus `export { GenerationService }` (line 394).

**Decision**

Delete only the redundant trailing `export { ... };` statements. The `export enum` / `export class` declarations already provide the same named exports, so all existing named imports (including `server.ts:13` and `server.ts:20`) keep working. No consumer import was rewritten.

**Risks**

- Any tooling that relied on the exact *second* export declaration would change, but duplicate exports are invalid ESM and cannot be relied on at runtime.
- Typecheck error diff confirms these removals only: baseline errors `TS2484`/`TS2323` for both files disappeared; no new typecheck error lines were introduced.

**Rejected alternatives**

- Renaming the enum/class or aliasing imports would ripple through consumers and change public shapes.
- TypeScript-only suppression (e.g. `// @ts-ignore`) would leave the runtime `TransformError` intact.

## ADR-003 — Make cross-module re-exports runtime-safe

**Status:** applied.

**Context**

- `src/providers/types.ts:1` used `export { ProviderType, ModelFunction, ModelFunctionConfig, ProviderConfig } from '../types';`. All four targets are TypeScript types/interfaces, so they are erased at runtime; Node ESM instantiation failed with `SyntaxError: The requested module '../types' does not provide an export named 'ModelFunction'`. The same line also produced four baseline `TS1205` errors (`isolatedModules`) and two `TS2304` errors because local type usages had no local binding.
- `src/utils/index.ts:13` and `src/utils/services.ts:2` re-export `default as GenerationService`, but `GenerationService.ts` had no default export (the other four services do). This would break ESM instantiation of the `utils/index` barrel once the earlier crash was cleared.

**Decision**

- Change line 1 to `import type { ProviderType, ProviderConfig } from '../types';` plus `export type { ProviderType, ModelFunction, ModelFunctionConfig, ProviderConfig } from '../types';`. This preserves both local type usage and the public type re-export while erasing it safely at runtime.
- Add `export default GenerationService;` to `GenerationService.ts`, matching the pattern already used by `CacheService`, `MetricsService`, `ProviderService`, and `QualityService`, so the existing barrels resolve without editing two additional files.

**Risks**

- Consumers that imported those types as *values* would break; repository scan found only type positions.
- Adding a default export is additive; no existing named import was changed.

**Rejected alternatives**

- Editing both barrels to use named exports would work but touches more files and leaves `GenerationService` inconsistent with sibling services.
- Adding value stubs in `src/types.ts` for type-only names would invent runtime API that does not exist.
- Disabling `isolatedModules` would hide the TypeScript diagnostic without fixing the runtime ESM failure.
