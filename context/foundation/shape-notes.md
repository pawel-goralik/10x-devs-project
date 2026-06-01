 ---
project: "Resolution Circle"
context_type: greenfield
created: 2026-05-29
updated: 2026-06-01
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona scope"
      decision: "yearly-goal-setters who rarely finish, together with the friend/family circle who would witness them"
    - topic: "load-bearing differentiator"
      decision: "immutability + quarterly cadence + closed circle, as one bundle (removing any one breaks the mechanism)"
    - topic: "auth method"
      decision: "passwordless email magic-link only for MVP"
    - topic: "in-group role model"
      decision: "flat membership; anyone in a group can invite; no owner/admin distinction"
    - topic: "secondary success outcome"
      decision: "group retention — share of groups with ≥1 active member at month 12"
    - topic: "guardrails"
      decision: "goal immutability never circumvented; goals visible only within group(s), never public"
    - topic: "per-user goal cap"
      decision: "no cap; immutability already discourages over-commitment"
    - topic: "account deletion vs. immutability"
      decision: "anonymize — locked goals + frozen progress persist in group views as 'former member'; identity shed, promise kept (FR-014)"
    - topic: "privacy confinement level"
      decision: "elevated from guardrail to NFR ('closed-circle confinement')"
    - topic: "operator-side immutability"
      decision: "user-facing only for MVP; operators retain raw datastore access; operator-proof store out of scope (Non-Goal)"
  frs_drafted: 14
  quality_check_status: accepted
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Shape notes — New Year's resolutions accountability tracker

Seed source: `idea-notes.md` (root of repo). Original notes in Polish; this file is in English for downstream skill compatibility but preserves user-stated meaning.

## Vision & Problem Statement

People who set yearly goals — most visibly as New Year's resolutions — routinely abandon them as motivation fades. The dropout moment varies (some lose it by the second week of January, others by mid-February, others later in Q1), but the pattern is the same: no one is watching, effort quietly trails off, and the same goals roll over onto next year's list. The cost is years of recycled, unmet goals.

Existing trackers either focus on solo measurement or offer public / stranger-based social features. The insight here is that three constraints, bundled together, change the mechanism: goals are **immutable once committed** (no silent down-revision after the fact), the cadence is **quarterly** (slow enough not to burn out, frequent enough to matter), and the witnessing audience is a **closed circle of friends and family** — people whose opinion the user actually cares about. Removing any one of the three breaks the device.

### Scale considerations surfaced during shaping
- **Sender-domain spam reputation becomes load-bearing at ~100×+ scale.** At the MVP's "you + handful" target, individual recipients teach their inbox that the app's emails are wanted; at ~10k recipients on an unknown sender domain, Gmail / Outlook spam-categorization is a real product risk and may need active reputation management. Captured here as a future concern, not an MVP work item.
- **Quarterly cron fan-out tolerates a multi-hour delivery window.** The product does not require instant fire-at-midnight delivery; deliveries spread across the first day (or up to the first week, per the NFR) of the new quarter are acceptable. This pre-clears a class of scaling concerns: the digest sender does not need real-time fan-out infrastructure.

## User & Persona

Primary persona: a person who already sets yearly goals — typically as a New Year's resolutions list — and across years notices that they finish few of them. They want their friends and family to witness their commitments; the closed circle is treated as part of the product, not an add-on. They would invite that circle into the app at the moment they commit a goal (early January is the canonical moment, but the system does not assume calendar alignment).

The same persona shows up in two adjacent framings, both in scope for the MVP:
- The individual goal-setter looking for a commitment device.
- The friend/family group who already nudges each other informally (texts, dinner-table check-ins) and would adopt a shared surface for it.

These are not two personas; they are the same archetype seen from either side of an invitation.

## Access Control

The product is multi-user with personal identity. Authentication is **passwordless email magic-link only** for the MVP — the user enters their email address, receives a one-time link, and clicking it authenticates the browser session. There is no password to store, recover, or rotate.

Group membership is **flat**: every member of a group has the same capabilities as every other member. There is no owner / admin role. The person who creates a group has no special privileges after creation; any member may invite further members, and any member may leave the group on their own. This is the smallest access model that still supports the social-circle mechanism the product depends on.

Authenticated capabilities (the role-to-capability matrix in PRD form):
- Any authenticated user can create their own goals, mark their own progress, create a group, leave a group they belong to, and view the goals of every member of every group they belong to.
- A user cannot view, modify, or mark progress on goals belonging to a person they share no group with.
- An unauthenticated visitor reaching a gated route is redirected to the magic-link request screen.

## Success Criteria

### Primary
- Users meet at least **70% of their annual goals**, measured at the year-end mark across the active user base. (Stated by user in seed; the headline product outcome.)

### Secondary
- **Group retention through year 1**: a non-trivial share of groups still have at least one active member at the 12-month mark from group creation. Proves the social-circle mechanism actually retains, not just attracts.

### Guardrails
- **Goal immutability is never circumvented after the 24-hour post-commit window closes.** A short edit-or-delete window (≤24h) is allowed for typos and misclicks; after the window closes, no edit, no soft-delete, no quiet revision — ever, by any actor. The bounded window preserves the commitment device while remaining humane.
- **Goals are visible only to members of the user's group(s).** Never public, never to strangers, never to authenticated users outside the user's groups. Closed-circle privacy is what makes the social pressure trusted; broadcasting breaks the product.

### First-session flow (MVP path)
This is the click-by-click flow whose end-to-end success = the product worked:

1. User lands on a sign-in page, enters their email, receives a magic link.
2. User clicks the link → authenticated session, lands on an empty goals screen.
3. User adds one or more goals. Each goal is a sentence plus a measure that is either a number target (e.g. "read 12 books") or binary yes/no (e.g. "no alcohol in January"). On save, the goal is committed and immutable.
4. User creates a group (names it, gets an invite mechanism to share) OR accepts an invite from someone else.
5. Once in a group, the user sees their own goals and every group member's goals on one view, with each goal's current progress.
6. User can mark progress on their own goals (bump the number / flip the yes-no).
7. At the next quarterly checkpoint (end of Mar / Jun / Sep / Dec), every member of every group receives an email summarizing where everyone in their group(s) stands.

First user-visible value lands at step 4–5 (goals committed and witnessed by a real human who cares). The system-driven quarterly email at step 7 is the long-tail mechanism.

### Timeline budget
~3 weeks of after-hours work to first ship. The fragile piece is the quarterly email scheduler (the only component that must "wake up" later). Everything else is straightforward auth + CRUD + email send.

## User Stories

### US-01: New user commits a goal and invites their circle

- **Given** a person with at least one yearly goal in mind and an email address
- **When** they sign up via magic link, add the goal, create a group, and send invites
- **Then** the goal is committed (immutable), visible on their personal view, and pending visibility to anyone who accepts the invite

#### Acceptance Criteria
- After step "save goal", the goal appears on the user's goals view and cannot be modified via any UI affordance.
- After step "create group", the user obtains a shareable invite mechanism (link or code).
- An invitee who accepts can see the goal on the group view; an authenticated non-member cannot.

## Functional Requirements

### Authentication
- FR-001: Visitor can request a magic link by submitting their email address. Priority: must-have
  > Socrates: Counter-argument considered: none ("stands as written"). Resolution: kept; deliverability and shared-inbox concerns are real but downstream design issues, not FR-level objections.
- FR-002: Visitor can authenticate by clicking a valid magic link, becoming a logged-in user. Priority: must-have
  > Socrates: Counter-argument considered: "link expiry vs. user lag — user requests, gets distracted, link expires, they retry, perception of broken product." Resolution: kept; expiry-window length and a clear 'request a new one' affordance are downstream UX concerns. The FR stands.
- FR-003: Authenticated user can sign out of the current session. Priority: must-have
  > Socrates: Counter-argument considered: "without explicit sign-out, shared devices leak the account; this is privacy-load-bearing." Resolution: this is a defense, not a critique — FR-003 is required, not optional.

### Goal commitment
- FR-004: Authenticated user can create a goal with a one-line description and one measure of either type (numeric target OR binary yes/no). Priority: must-have
  > Socrates: Counter-argument considered: "two measure types is too few — frequency goals (e.g. 'run 30 min, 3×/week') don't fit either numeric or yes/no cleanly." Resolution: gap accepted for MVP; frequency-style goals added to Non-Goals (see Phase 6) and routed to Open Questions for v2 consideration. FR-004 stands as written.
- FR-005: Authenticated user can view all of their own goals on a personal view. Priority: must-have
  > Socrates: Counter-argument considered: "personal view duplicates the group view." Resolution: rejected on reflection; the personal view and the group view coexist as parallel surfaces serving different mental modes ('my own commitments' vs 'our circle's commitments'). FR-005 stands.
- FR-006: Within 24 hours of commit, the goal's author can edit or delete their own goal. After the 24-hour window closes, no actor — user, member, or system — can edit, delete, or revise the goal, ever. (Defensive FR; encodes the bounded-immutability guardrail.) Priority: must-have
  > Socrates: Counter-argument considered: "mistakes are human — a short edit window is humane without weakening the commitment device." Resolution: FR-006 revised to allow a 24-hour post-commit edit-or-delete window; after the window closes, hard immutability applies. The Guardrails section was updated in lockstep.

### Progress
- FR-007: Authenticated user can record progress on one of their own goals (increment numeric measure; flip binary measure to done). Priority: must-have
  > Socrates: Counter-argument considered: "manual tracking is the failure mode the seed criticized — users forget to update, digest becomes meaningless." Resolution: limitation accepted for MVP; the social cadence + closed-circle mechanism is the v1 mitigation. 'No third-party integrations' added to Non-Goals (see Phase 6); future external-source integration (Strava, Apple Health, etc.) routed to Open Questions for v2.

### Groups
- FR-008: Authenticated user can create a group. Naming the group is optional; if omitted, it defaults to "[Creator's first name]'s circle." The group may be renamed later by any member. Priority: must-have
  > Socrates: Counter-argument considered: "requiring a name adds friction — most users have one circle and the naming decision is unnecessary." Resolution: FR-008 revised to make naming optional with a sensible default; the rename affordance is preserved for groups with explicit identity needs.
- FR-009: Authenticated user can accept a group invite and become a member. Priority: must-have
  > Socrates: Counter-argument considered: "without an explicit accept step, people get auto-added to groups they didn't intend to join." Resolution: this is a defense, not a critique — explicit accept is a positive consent signal that matters more in a social-pressure product than the friction it adds. FR-009 stands.
- FR-010: Authenticated user can leave a group they belong to. When a member leaves, all remaining members of that group are notified of the departure. Priority: must-have
  > Socrates: Counter-argument considered: "allowing leave undermines commitment — if you can ghost out when it gets hard, the social pressure is fake." Resolution: FR-010 revised to add visible-departure notification; leaving remains possible (trapped membership is worse) but ghosting is no longer silent. The notification itself is accountability.
- FR-011: Group member can invite another person into the group via a shareable mechanism (link or code). Applies equally to the creator and any later member (flat-membership: no owner approval). Priority: must-have
  > Socrates: Counter-argument considered: "anyone-can-invite creates griefer risk / social-graph pollution." Resolution: the MVP explicitly assumes group composition is trusted — the closed-circle persona accepts that risk in exchange for the lower-friction invite model. Pollution mitigations (owner approval, invite caps, etc.) are deferred to a post-MVP version if the assumption breaks under real use.

### Cross-group visibility
- FR-012: Group member can view every goal AND current progress of every other member of every group they belong to. Priority: must-have
  > Socrates: Counter-argument considered: "full visibility is too aggressive — sensitive goals need per-goal privacy." Resolution: FR-012 stands; the privacy mechanism in MVP is membership-level (don't share the group with people you wouldn't share the goal with) rather than per-goal flags. A per-goal privacy mode is deferred to v2 if real-world use surfaces the need.

### Quarterly digest
- FR-013: At the end of each calendar quarter, every group member receives an email summarising the goals and current progress of every member of every group they belong to. Priority: must-have
  > Socrates: Counter-argument considered: "quarterly is too slow for shorter-cadence goals (e.g. 'one book per month') — three-month silence between digests lets users drift." Resolution: drift accepted as a deliberate tradeoff; the quarterly cadence is one of the three load-bearing pillars of the insight bundle (alongside immutability and closed-circle), and shortening it would walk back the differentiator. The digest is the SOCIAL heartbeat — between-digest progress updates are the user's job. FR-013 stands.

### Account lifecycle
- FR-014: Authenticated user can delete their own account. On deletion, the user's committed goals and frozen progress remain visible in every group they belonged to, but the author identity is replaced with "former member." Priority: must-have
  > Resolved post-shaping: anonymize rather than hard-delete or preserve-with-name. Hard-delete lets a member silently escape a committed promise; preserve-with-name exposes a departed person indefinitely. Anonymization honors immutability while shedding identity.

## Business Logic

Every committed goal is, after a 24-hour grace window, a fixed promise visible only to a chosen trusted circle, and the application surfaces each circle's collective progress to its members on a fixed quarterly cadence.

The rule consumes three user-facing inputs: the goal itself (a one-line description plus one measure — numeric target or binary yes/no), the goal author's group memberships at the time of viewing or digest send, and the calendar date. It does not consume external feeds, third-party progress signals, or any input the author has not chosen.

The rule produces three observable outputs. First, the editability state of every goal: mutable for 24 hours after commit, irrevocably locked thereafter. Second, the visibility scope of every goal: visible to every member of every group the goal's author belongs to, invisible to every other authenticated user and to every unauthenticated visitor. Third, the quarterly digest content: at the end of every calendar quarter, each group member receives a roll-up of every goal and current progress for every member of every group they belong to.

A user encounters the rule whenever they attempt to edit a goal (allowed only within the 24-hour window), view their own goals or any group surface (sees the goals and progress permitted by the visibility scope), or open the quarterly digest email (sees the closed circle's collective accountability fixed to the quarter boundary). The rule is not CRUD because the application — not the user — decides when a goal locks, who sees it, and when the social heartbeat fires.

## Non-Functional Requirements

- **Quarterly digest deliverability.** Each group member's quarterly digest email reaches their inbox within the first week of the following calendar quarter, except for hard refusals by the recipient's mail provider (e.g. mailbox-full bounces, permanent spam blocks). The digest is the system's social heartbeat; deliverability is treated as load-bearing, not best-effort.

(Note: privacy confinement and post-window immutability are captured at Guardrail level in `## Success Criteria` rather than at NFR level. The user considered and declined to elevate them to NFR commitments. /10x-prd should mirror them into Open Questions if the gap matters downstream.)

## Non-Goals

- **No notification channels other than email.** No push notifications, no SMS, no in-app banners. The quarterly digest is delivered via email and that is the only product channel. Stated by user in seed.
- **No user-configurable notification frequency.** Cadence is fixed at calendar-quarter end for every user, every group; no per-user, per-group, or per-goal cadence override. Per-user frequency is the exact failure mode the cadence insight prevents. Stated by user in seed.
- **No group-shared goals.** The MVP supports one-person-one-goal-with-witnesses; it does not support a goal that the entire group commits to together (no joint targets, no group quotas). A collective-goal model is a different product. Stated by user in seed.
- **No frequency-style goals.** Goal measures in the MVP are limited to numeric target OR binary yes/no (FR-004). Frequency goals such as "N times per period" (e.g. "run 3× per week") are not supported and would require a recurring-window state model. From FR-004 Socratic resolution.
- **No third-party progress integrations.** The MVP does not import progress from Strava, Apple Health, fitness wearables, calendar feeds, or any other external system. Progress is recorded manually by the goal author (FR-007). From FR-007 Socratic resolution. *Candidate for v2 if manual reporting proves a credibility limitation.*
- **No operator-proof immutability.** Post-window immutability (FR-006) binds the product surface only; the MVP does not build an append-only / tamper-evident store, and operators retain raw data access for maintenance. Resolved post-shaping.

## Open Questions (resolved post-shaping)

All five shaping-stage open questions were resolved on 2026-06-01. Recorded here for traceability; nothing remains for `/10x-prd` to surface:

1. **Frequency-style goals (v2)** — folded into `## Non-Goals` as a deferred v2 candidate. Not blocking.
2. **Third-party progress integrations (v2)** — folded into `## Non-Goals` as a deferred v2 candidate. Not blocking.
3. **Privacy confinement level** — RESOLVED: elevated from Guardrail to a measurable NFR ("closed-circle confinement").
4. **Operator-side immutability** — RESOLVED: user-facing only for MVP; operators retain datastore access; operator-proof store added as a Non-Goal.
5. **Account / data deletion vs. immutability** — RESOLVED: anonymize-to-"former member" (FR-014). Locked goals + frozen progress persist in group views; identity is shed.
6. **target_scale.qps / data_volume** — RESOLVED: set to `low` / `small` in frontmatter, consistent with `users: small`.




