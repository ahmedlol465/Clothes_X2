# Phase 1B — Build Stabilization Plan

## Current State

The NestJS build fails with **10 pre-existing TypeScript compilation errors**. All errors are in files converted from JavaScript to TypeScript. The Express backend remains operational and is not affected.

## Error Inventory

| # | File:Line | Error Code | Error Message | Root Cause |
|---|-----------|------------|---------------|------------|
| 1 | `src/common/filters/all-exceptions.filter.ts:26` | TS2322 | `Type 'string \| object' is not assignable to type 'string \| string[]'` | `exception.getResponse()` returns `string \| object`, but `message` is typed `string \| string[]` |
| 2 | `src/modules/auth/auth.controller.ts:60` | TS2554 | `Expected 1 arguments, but got 2` | Controller calls `this.auth.logout(userId, dto?.refreshToken)` but service `logout(userId: string)` only accepts 1 parameter |
| 3 | `src/modules/auth/auth.service.ts:189` | TS2769 | `No overload matches this call` | `jwt.signAsync()` `expiresIn: accessTtl` — `accessTtl` is `string` but `SignOptions.expiresIn` expects `StringValue \| number` |
| 4 | `src/modules/auth/auth.service.ts:193` | TS2769 | `No overload matches this call` | Same as #3, for refresh token `signAsync` call |
| 5 | `src/modules/outfits/outfits.service.ts:145` | TS2769 | `No overload matches this call` | `outfitRepo.create()` — `factorBreakdown: compat.breakdown` is an array of factor objects but entity expects `Record<string, number> \| null`. Also `userId` flagged due to cascading type confusion |
| 6 | `src/modules/outfits/outfits.service.ts:159` | TS2339 | `Property 'id' does not exist on type 'Outfit[]'` | Cascading from #5 — `save()` return type confused due to `create()` type errors |
| 7 | `src/modules/planner/planner.service.ts:144` | TS2322 | `Type 'string \| RegExp' is not assignable to type 'string'` | `pick?.name` from `generateOutfits()` (params typed `any`) is inferred as `string \| RegExp`, but `WeeklyPlan.outfitName` is `string` |
| 8 | `src/modules/stylist/stylist.service.ts:434` | TS2339 | `Property 'completeness' does not exist` | `scoreOutfit()` returns a union type; one member (empty-list case at scoring.ts:300) lacks `completeness` property |
| 9 | `src/modules/stylist/stylist.service.ts:537` | TS2339 | `Property 'constraints' does not exist` | `aiEngine.chatReply()` return type (union of object literals) does not include `constraints` property, but code accesses `fallback.constraints` |
| 10 | `src/modules/stylist/stylist.service.ts:807` | TS2339 | `Property 'outfit' does not exist` | `vision.matchSpec()` return type does not include `outfit` property, but code assigns `result.outfit = {...}` |

## Planned Fixes

### Fix #1 — all-exceptions.filter.ts (Local)
**Change**: Type `message` variable as `string | string[] | Record<string, unknown>`, then handle the object case by extracting `.message` with a type-safe check.
**Impact**: Local to this file. No behavior change.
**Risk**: Low.

### Fix #2 — auth.controller.ts + auth.service.ts (Local)
**Change**: Add optional `refreshToken?: string` parameter to `AuthService.logout(userId: string, refreshToken?: string)`.
**Impact**: Local to auth module. Service signature is backward-compatible (optional param).
**Risk**: Low.

### Fix #3-4 — auth.service.ts (Local)
**Change**: Cast `accessTtl` and `refreshTtl` to the proper `JwtSignOptions['expiresIn']` type when passing to `signAsync`.
**Impact**: Local to auth service. No behavior change.
**Risk**: Low.

### Fix #5 — outfits.service.ts (Local)
**Change**: Convert `compat.breakdown` (array of `{key, value, ...}` objects) to `Record<string, number>` using `Object.fromEntries()` before assigning to `factorBreakdown`.
**Impact**: Local to outfits service. No behavior change (data is preserved as key-value map).
**Risk**: Low.

### Fix #6 — outfits.service.ts (Local)
**Change**: Should be resolved by Fix #5. If `create()` returns proper `Outfit`, `save()` returns `Promise<Outfit>`, and `saved.id` works.
**Impact**: Local to outfits service.
**Risk**: Low.

### Fix #7 — planner.service.ts (Local)
**Change**: Convert `pick?.name` to string using `String()` before assigning to `outfitName`.
**Impact**: Local to planner service. No behavior change.
**Risk**: Low.

### Fix #8 — stylist.service.ts (Local)
**Change**: The `scoreOutfit()` return type is a union. One member lacks `completeness`. Use a type-safe access pattern — since `completeness` exists on the non-empty path, provide a default or narrow the type.
**Impact**: Local to stylist service.
**Risk**: Low.

### Fix #9 — stylist.service.ts (Local)
**Change**: `aiEngine.chatReply()` return type doesn't include `constraints`. Access via type-safe cast to a shape that includes optional `constraints`.
**Impact**: Local to stylist service.
**Risk**: Low.

### Fix #10 — stylist.service.ts (Local)
**Change**: `vision.matchSpec()` return type doesn't include `outfit`. The code does `result.outfit = {...}` which adds a property not in the type. Cast `result` to include `outfit` or spread into a new object.
**Impact**: Local to stylist service.
**Risk**: Low.

## Scope Boundaries

- **Do not** modify `ai-engine.ts`, `scoring.ts`, `vision.ts`, or `llm.ts` return types — these are shared modules used across modules
- **Do not** change database schema or entity definitions
- **Do not** add `any`, `@ts-ignore`, or `@ts-nocheck`
- **Do not** weaken TypeScript strict settings
- **Do not** modify Express `server.js`
- **Do not** wire additional NestJS modules

## Verification

After all fixes:
1. `npm run build` must pass with 0 errors
2. `npm test` must pass (40/40 tests)
3. No regressions in Express backend
