# Errors — manfred-schedule-linkedin

Project-local error log.

- **Deterministic errors** (bad schema, wrong type, missing field) → conclude immediately,
  fix, link the conclusion into a category file.
- **Infrastructure errors** (timeout, rate limit, network) → log only; no conclusion until
  a pattern emerges.

Format:

```markdown
## YYYY-MM-DD — short title

- **Symptom:**
- **Cause:**
- **Fix / conclusion:**
- **Graduated to:** knowledge/<category> or my-process/docs/knowledge/ (when recurring)
```

---

## 2026-07-20 — Vercel serverless functions crash with ERR_MODULE_NOT_FOUND

- **Symptom:** SPA loads (200) but every `/api/*` function returns 500
  `FUNCTION_INVOCATION_FAILED`. Runtime log: `Error [ERR_MODULE_NOT_FOUND]: Cannot find
  module '/var/task/api/_lib/http' imported from /var/task/api/cron/publish.js`. All local
  gates (tsc, vitest, Vite build, ESLint, Playwright) were green.
- **Cause:** `package.json` has `"type": "module"`, so Vercel emits the functions as ESM.
  Node's ESM loader requires **explicit file extensions** on relative imports, but the code
  used extensionless imports (`from '../_lib/http'`). Every local tool resolves these because
  all tsconfigs use `moduleResolution: "bundler"` and Vite/vitest use esbuild — so the bug is
  invisible until it runs on Vercel's plain Node ESM runtime, which does not bundle these
  shared `api/_lib/*` files.
- **Fix / conclusion:** add `.js` extensions to every relative import in the files Vercel runs
  (`api/**/*.ts` non-test + the `src/lib/*` modules they import). `.js` specifiers resolve
  correctly under `bundler` resolution too, so tsc/vitest/Vite stay green. This is a
  ship-with-the-stack gotcha for any Vite-SPA-plus-`api/`-functions project on Vercel.
- **Graduated to:** applies to every project using this SPA + serverless-functions shape.

## Seeded stack gotchas (ship with the starter — not incidents in this repo)

These were hit downstream (manfred-workshops, 2026-07-13) and will recur in any project
on this stack. Kept here so they are found *before* they cost debugging time again.

### TanStack Query v5 — `mutationFn` leaks a phantom 2nd argument

- **Symptom:** `expect(spy).toHaveBeenCalledWith(id)` fails — the spy received a second,
  unexpected object argument; APIs with an optional 2nd parameter can misbehave.
- **Cause:** v5 calls `mutationFn(variables, context)`. Passing a single-arg API function
  directly (`mutationFn: api.deleteThing`) forwards the context object as argument 2.
- **Fix / conclusion:** always wrap: `mutationFn: (id) => api.deleteThing(id)`.

### PGlite + parallel Vitest — intermittent hook timeouts in full runs

- **Symptom:** db test files all pass in isolation, but full runs intermittently blow the
  15s hook timeout.
- **Cause:** many Vitest workers each booting their own PGlite instance contend on startup.
- **Fix / conclusion:** if a PGlite test harness lands in this repo, mitigate up front:
  cap workers/pool for db suites, raise `hookTimeout`, or share a template database.
