# Knowledge Index — manfred-schedule-linkedin

Progressive disclosure: read top-down, load only what you need. This is the per-project
flywheel. When a fact turns out to recur across projects, graduate it **up** into the team
base at `my-process/docs/knowledge/`.

## Categories

### Domain
<!-- What things are: product context, APIs, naming, team decisions. -->
- [ui-patterns.md](ui-patterns.md) — seeded UI construction patterns (clickable cards,
  card footers with actions, DS icon-gap stopgap).
- [zernio.md](zernio.md) — Zernio API domain notes: auth, `x-request-id` idempotency,
  409 content-hash dedup, presign media flow, temp-storage caveat. Full reference
  vendored at `docs/llms-full.txt`.

### Procedural
<!-- How to do things: deploy steps, test commands, review flows. -->

### Audit & status
<!-- Read-only audits, prioritised findings, remediation order. -->

### Plans
<!-- Decomposition plans for larger pieces of work. -->

## Maintenance rules
- Review at session start; merge overlaps; split files that grow too long.
- Remove inaccurate knowledge. Create categories when patterns emerge.
- `ERRORS.md` is the error log (see its header for the format).
