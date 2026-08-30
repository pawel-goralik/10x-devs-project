---
change_id: commit-a-goal
title: Commit a goal
status: impl_reviewed
created: 2026-08-29
updated: 2026-08-29
archived_at: null
---

## Notes

Roadmap item S-01 (`context/foundation/roadmap.md`). Prerequisite F-01 (magic-link-auth) is shipped.

Key decisions made during planning (see `plan-brief.md` for the full table):

- Form POST + redirect for create/edit/delete, not a JSON/fetch API — these actions are rare, so the added complexity wouldn't pay for itself.
- 24h edit/delete window enforced in the service layer only, not RLS or a DB trigger — matches the PRD's explicit "product surface, not cryptographic" immutability scope, and this app is the only consumer of the DB.
- RLS is ownership-only (`auth.uid() = user_id`) on all 4 operations; S-03 will need to widen the SELECT policy once groups exist — expected, not a gap.
- Progress columns (`current_value`/`is_done`) included in this migration, defaulted — avoids a second migration right after this one; S-04 owns actually using them.
- Hard delete within the window; measure type locked once created (only description/target editable); one-time lock notice at creation instead of a countdown.
- `user_id` FK has no `ON DELETE` action deliberately — S-06 must explicitly detach it before removing an auth user, since FR-014 requires anonymization, not deletion.
- Goals are committed in a bundle (one form, dynamic rows, up to 20) rather than one at a time — all-or-nothing validation, and bundle members share `created_at` via a single multi-row insert so their windows lock in lockstep. Users can commit further bundles later; it's not a one-time action.
- Editing/deleting within the window happens through one consolidated manage form (all still-editable goals + per-row delete), not per-goal edit pages. The window check is enforced atomically in the UPDATE/DELETE query's own WHERE clause (`created_at > cutoff`), not via a separate fetch-then-check step.
