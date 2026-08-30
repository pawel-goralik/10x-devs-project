---
change_id: email-sending-infrastructure
title: Email-sending infrastructure
status: planned
created: 2026-08-30
updated: 2026-08-30
archived_at: null
---

## Notes

Extracted as its own foundation item (F-02) while planning `form-and-manage-a-group` (S-02): FR-010's leave-a-group notification needs a real email, not just an in-app record, and that requires the same Brevo REST API integration that S-05 (quarterly digest) already needed. Building it once here unblocks both S-02 and S-05 instead of duplicating the setup.

Scope correction (2026-08-30): Brevo's SMTP side (account, sender verification, magic-link email through Supabase Auth) is already done — see `context/changes/deployment/deployment-plan.md` Phase 1c/4, confirmed by a real received magic-link email from the Brevo-substituted sender address. This item is scoped to the still-missing piece only: generating a Brevo **REST API key** (confirmed not yet generated — no API keys visible in the Brevo dashboard), storing it as the `BREVO_API_KEY` Worker secret, and building the reusable send-email service.

S-02's plan is paused pending this change.
