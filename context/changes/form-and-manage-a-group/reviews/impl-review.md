<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Form and Manage a Group Implementation Plan

- **Plan**: context/changes/form-and-manage-a-group/plan.md
- **Scope**: Phase 4 of 4 (full plan review)
- **Date**: 2026-08-31
- **Verdict**: REJECTED
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Open-redirect bypass via backslash in `sanitizeNextPath`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/utils.ts:18
- **Detail**: `sanitizeNextPath` rejects values starting with `//` or containing `://`, but not a leading backslash. A value like `/\evil.com` starts with `/` (passes), doesn't start with `//` (passes), and contains no `://` (passes) — so it's returned unchanged. Per the WHATWG URL spec, browsers coerce backslashes to forward slashes when resolving a URL reference for special schemes (http/https) *before* path/authority parsing, so `/\evil.com` is interpreted as `//evil.com` — a scheme-relative reference that navigates off-origin to `https://evil.com`. Concrete scenario: an attacker sends a victim `/auth/signin?next=%2F%5Cevil.com`; after the victim completes magic-link sign-in, `callback.ts` reads `next`, passes it through `sanitizeNextPath` (which lets it through), and redirects the now-authenticated browser to `evil.com` — a classic open-redirect usable for phishing immediately after a real login. Both of `sanitizeNextPath`'s read call sites (`callback.ts`, `request-link.ts`) are affected.
- **Fix**: Also reject any value containing a backslash — add `|| value.includes("\\")` to the rejection condition in `sanitizeNextPath` (src/lib/utils.ts:18).
- **Decision**: FIXED

### F2 — Unused `CreateGroupCommand` type

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts:78
- **Detail**: `CreateGroupCommand` is declared but never imported or used anywhere — `POST /api/groups` validates with an inline zod object instead. This breaks from the sibling convention where `CreateGoalCommand` is the type actually consumed by `goals.ts`/`api/goals/index.ts`. Harmless today, but the type can silently drift out of sync with the real request shape since nothing type-checks against it.
- **Fix**: Either wire the zod schema's inferred type to it (`z.infer<typeof createGroupSchema> satisfies CreateGroupCommand` in `src/pages/api/groups/index.ts`) or delete the unused type.
- **Decision**: FIXED. First pass only annotated `createGroupSchema: z.ZodType<CreateGroupCommand>` in the route, leaving `createGroup`'s service signature as a bare `name: string` — flagged by the user as still inconsistent with `createGoals(supabase, userId, commands: CreateGoalCommand[])`'s pattern of passing the Command type into the service layer. Corrected: `createGroup` now takes `command: CreateGroupCommand` (`src/lib/services/groups.ts`), and `src/pages/api/groups/index.ts` passes `parsed.data` straight through (mirroring `goals/index.ts`'s `createGoals(supabase, user.id, parsed.data)` exactly), rather than destructuring `.name` at the call site.

### F3 — Ungraceful crash on a non-member/missing group id

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/groups/[id].astro:12,22-51
- **Detail**: `getGroupDetail` can return `null` (bad/missing id, non-member, or RLS-blocked access), but the template unconditionally accesses `group.name`/`group.members` with no guard, throwing an unhandled TypeError and rendering an unstyled 500 instead of a friendly message. This is already documented in the file's own comment as an "Accepted risk (plan review, 2026-08-31)" — not a new decision, just re-surfaced because the failure mode (full crash page) is more severe than the sibling `goals/index.astro` pattern, which always guards with conditional rendering. No data is exposed either way since RLS already blocks it.
- **Fix**: No action required unless the team wants to revisit the original acceptance.
- **Decision**: SKIPPED (already an accepted risk from the 2026-08-31 plan review; no new information)
