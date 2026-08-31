<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Form and Manage a Group Implementation Plan

- **Plan**: context/changes/form-and-manage-a-group/plan.md
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → SOUND (after triage fixes)
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts (pre-triage)

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

Grounding: 14/14 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — Departure email will silently send to nobody

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2 (`notifyGroupOfDeparture`) / Phase 3 (`leave.ts`)
- **Detail**: `notifyGroupOfDeparture` was specified to run "after `leaveGroup` succeeds, so the departed member is naturally excluded" — but it queries `group_members`/`profiles` using the leaving user's own RLS-scoped session. `group_members`' SELECT policy (`is_member_of`) requires the querier to currently be a member of that group. Once `leaveGroup`'s DELETE removes their own row, that querier no longer satisfies `is_member_of` for this group, so the "remaining members" query (and any group-name lookup done the same way) returns empty every time, not "everyone except me." The plan's own Desired End State ("A receives an email about it") would silently fail on every leave. Confirmed no service-role/admin client exists anywhere in this codebase to fall back on.
- **Fix A ⭐ Recommended (Applied)**: Fetch the group's name and full member list *before* calling `leaveGroup` (while still a member, RLS allows it); exclude self in application code; then delete; then email the pre-fetched list.
  - Strength: No schema changes, minimal edit to Phase 2/3 sequencing only.
  - Tradeoff: A tiny race window if membership changes between the fetch and the delete — negligible at this app's scale.
  - Confidence: HIGH — directly targets the RLS timing bug with data already legally queryable at that point.
  - Blind spot: Assumes leave stays a single request/response cycle (it does, per the current design).
- **Fix B**: Add an atomic `leave_group()` `SECURITY DEFINER` RPC that deletes the row and returns the group name + remaining emails in one call.
  - Strength: Atomic, no race condition, consistent with the plan's existing RPC pattern.
  - Tradeoff: A 5th RPC function in an already RPC-heavy Phase 1; partial-failure handling undesigned.
  - Confidence: MEDIUM — correct in principle, exact signature/error shape not yet designed.
  - Blind spot: Partial-failure handling (delete OK, email construction fails) not designed.
- **Decision**: FIXED (via Fix A)

### F2 — Phase 2 has an un-checkboxed Success Criteria bullet

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Success Criteria
- **Detail**: Phase 2's "#### Manual Verification:" had one bullet, "N/A for this phase...", with no matching Progress checkbox (Phase 2's Progress block correctly has no `#### Manual` subsection). Didn't break `/10x-implement`'s parsing (Progress itself was well-formed), but was a stray, inconsistent bullet.
- **Fix**: Remove the "#### Manual Verification:" heading and its "N/A" bullet entirely from Phase 2's Success Criteria — mirrors Progress's own "omit empty subsections" convention. Also removed the now-inapplicable "pause for manual confirmation" Implementation Note for this phase (caught during triage discussion), since there's no manual testing to confirm.
- **Decision**: FIXED

### F3 — Unbounded sequential email loop on leave

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 (`notifyGroupOfDeparture`)
- **Detail**: "Calls `sendEmail` once per remaining member" didn't specify loop mechanics. `sendEmail` has no timeout (confirmed in `src/lib/services/email.ts`). A sequential await-in-a-loop means the leave endpoint's latency is the sum of every member's email call, with no cap.
- **Fix A ⭐ Recommended (Applied)**: Use `Promise.all` to send in parallel.
  - Strength: One-line change; bounds total wait to the slowest single call instead of their sum; no new infra.
  - Tradeoff: A single very slow call still blocks the redirect for its own duration — no per-call timeout exists yet.
  - Confidence: HIGH — straightforward, no behavior change beyond ordering.
  - Blind spot: Doesn't add a timeout to `sendEmail` itself.
- **Fix B**: Fire-and-forget via Cloudflare's `ctx.waitUntil()`.
  - Strength: Leave redirects instantly regardless of email latency.
  - Tradeoff: Introduces a Cloudflare-specific pattern this codebase has never used; risk of silently dropped sends if wired incorrectly.
  - Confidence: LOW — no precedent to build on here.
  - Blind spot: Whether Astro's Cloudflare adapter exposes `ctx.waitUntil` at this call site is unverified.
- **Decision**: FIXED (via Fix A)

### F4 — Malformed invite token not validated before RPC call

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 (`groups/join/[token].astro`)
- **Detail**: A non-UUID path segment (e.g. `/groups/join/not-a-token`) would reach `get_group_preview`'s uuid-typed parameter and likely surface as a raw Postgres/PostgREST type-cast error, not the intended "invalid link" message.
- **Fix**: zod-validate the token param as a UUID before calling `previewInvite`; treat a validation failure identically to a not-found token.
- **Decision**: FIXED

### F5 — No "not found / not a member" branch for group detail page

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 4 (`groups/[id].astro`)
- **Detail**: `getGroupDetail` returns `null` for a non-member (RLS). The join-confirm page's contract explicitly handles its null case; the group detail page's contract didn't say what renders when null.
- **Fix**: Add the same kind of explicit branch used on the join-confirm page.
- **Decision**: ACCEPTED (documented in-plan: RLS already blocks any data exposure either way; this is a UX polish gap on a URL no real user flow leads to, not a security gap — revisit if it's ever actually hit)

### F6 — profiles.email doesn't sync on auth.users updates

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 1 (profiles trigger)
- **Detail**: The trigger only fires `AFTER INSERT ON auth.users`. No email-change feature exists in this app today, so this is currently harmless — but it will silently go stale if one is ever added without remembering this trigger.
- **Fix**: Add a one-line note in Phase 1's contract flagging this as a known, accepted limitation rather than an oversight.
- **Decision**: FIXED
