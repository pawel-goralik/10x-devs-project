# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Toggle analytics off to work around Colima's vector-sidecar mount failure

- **Context**: Local Supabase dev stack (Colima) — any phase/change that runs `npx supabase start` locally under Colima.
- **Problem**: Under Colima, `supabase start` can fail with "failed to start docker container supabase_vector_<project>...mkdir ...: operation not supported" because Colima's docker.sock lives inside the virtiofs-shared home directory and can't be bind-mounted into the nested vector/analytics container. This blocks local verification and can look like it was caused by the current change, even though it's a pre-existing environment issue.
- **Rule**: If `supabase start` fails with a 'vector'/docker-socket mkdir error under Colima, first reproduce on the pre-change config.toml to confirm it's environmental, not a regression; then work around it by temporarily setting `[analytics] enabled = false` in supabase/config.toml, running `supabase start`, and re-enabling it afterward. Do not symlink `/var/run/docker.sock` or otherwise touch the system Docker socket without explicit user approval.
- **Applies to**: all
