---
change_id: record-goal-progress
title: Record goal progress
status: archived
created: 2026-08-30
updated: 2026-08-31
archived_at: 2026-08-31T16:00:44Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Out-of-band fix (commit `a298030`, `supabase/config.toml`): while manually testing this plan's Phase 1/2, discovered that local magic-link sign-in redirects to production whenever the dev server isn't on port 4321 (only that exact port was allow-listed). Widened `additional_redirect_urls` to `http://localhost:*/**` and verified against the local GoTrue container across several ports. Unrelated to FR-007 — landed on this branch because it was found and fixed here, not because it's part of the record-goal-progress plan.
