# UI Patterns — manfred-schedule-linkedin

Proven UI construction patterns, seeded from downstream projects (manfred-workshops,
2026-07-13). Reach for these before inventing a variant; extend the file as new patterns
prove themselves.

---

## Clickable card (stretched link)

Make the whole card a hit area without adding any new interactive element:

- `relative` on the Card; `after:absolute after:inset-0` on the **existing** title link.
- Card action buttons sit above the stretched link via `relative z-10`.

Keyboard and assistive-tech semantics are unchanged by construction — there is still
exactly one link, it just paints a bigger hit area.

```tsx
<Card className="relative">
  <a href={href} className="after:absolute after:inset-0">{title}</a>
  <Button className="relative z-10">Action</Button>
</Card>
```

---

## Card footer with actions

Don't put meta info and actions in one flex row — five items in a single row wraps into
a jumble as soon as two actions land. Instead, stack two rows behind a `border-t`:

1. **Meta row:** badges/counts left, right-aligned truncated attribution.
2. **Action bar:** right-aligned, below the meta row.

---

## Design-system icon gaps (stopgap)

When the design system's curated `IconName` set lacks a glyph, do **not** reach for a raw
emoji or an off-system icon library. Ship a local SVG drawn to the DS Icon conventions:

- Heroicons Outline path, `24` viewBox, `1.5` stroke, `currentColor`.
- Add a swap-later comment referencing the ticket that requests the icon upstream in
  `manfred-design-system` (`iconPaths.ts`).

Swap to the DS icon and delete the local SVG once the upstream icon ships.
