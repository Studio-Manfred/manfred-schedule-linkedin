# manfred-schedule-linkedin



A Manfred project scaffolded from **my-process** — React + Vite + Tailwind + the Manfred
design system, with the way-of-working baked in.

## Quick start
```bash
# one-time: a GitHub token with read:packages, for the private design system
export GITHUB_TOKEN=$(gh auth token)   # or a classic PAT with read:packages
npm install
npm run dev
```

## Scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build |
| `npm run preview` | serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc`, no emit |
| `npm run test` | Vitest (watch) |
| `npm run test:coverage` | Vitest with coverage |
| `npm run coverage:check` | coverage ratchet gate |
| `npm run test:e2e` | Playwright E2E + axe a11y |

## Where the way-of-working lives
- `AGENTS.md` / `CLAUDE.md` — how agents (and people) work in this repo
- `MEMORY.md` — the session log
- `knowledge/` — the project flywheel (`INDEX.md` + `ERRORS.md`)

## Testing
- Unit / component: `npm run test`
- E2E: `npm run test:e2e`
- Accessibility: part of E2E (axe sweep); `AXE_ENFORCE=1 npm run test:e2e` makes it blocking
- Coverage ratchet: `npm run coverage:check`

The full team workflow is documented in the my-process docs.
