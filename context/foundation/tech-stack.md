---
starter_id: 10x-astro-starter
package_manager: npm
project_name: resolution-circle
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

Resolution Circle is a small-scale web app one person is shipping after-hours in
three weeks, with passwordless magic-link auth and a quarterly email digest. The
10x Astro Starter is the recommended default for a JS/TS web app and clears all
four agent-friendly gates, so an AI agent can build against explicit TypeScript
schemas without running the program. Supabase supplies magic-link auth
(FR-001/002/003) plus Postgres for goals, groups, and progress out of the box —
collapsing the biggest build risks for a short, solo timeline. The quarterly
digest (FR-013) is scheduled background work, recorded as has_background_jobs;
the edge runtime constrains long-running tasks, but a quarterly cron writing to
Supabase is a well-trodden path. Payments, realtime, and AI are out of scope per
the PRD non-goals. Deployment targets Cloudflare Pages (the starter default) and
CI runs on GitHub Actions with auto-deploy on merge — the shape the starter
ships with. Bootstrapper confidence is first-class, so expect mostly-smooth
scaffolding with occasional manual steps.
