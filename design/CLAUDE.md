# VRE Design System — reference for Claude

This folder is a snapshot of the VRE frontend. Use it as a design reference when building new pages or components.

## Files

| File | What it is |
|------|-----------|
| `style.css` | Full shared stylesheet — tokens, layout, all components |
| `index.html` | Home page — hero, integrations strip, feature grid, CTA band |
| `play.html` | App page — form UI, result cards, live-raffle flow |
| `verify.html` | Verifier — signature input, timeline, MATCH/MISMATCH display |
| `build.html` | Docs page — stepper, code blocks, SDK reference |
| `spec.html` | Spec page — sticky TOC sidebar + long-form article layout |

## Key design tokens (from style.css :root)

```css
--bg:           #0d0f14   /* page background */
--bg-surface:   #13161e   /* card / nav surface */
--bg-surface-2: #1a1d28   /* elevated surface */
--border:       #252835
--border-strong:#323644

--text:         #ebeaf0
--text-dim:     #8b91a8
--text-faint:   #5a6078

--teal:         #14f195   /* primary accent — Solana green */
--violet:       #9945ff   /* secondary accent */
--red:          #f14d4d   /* error / mismatch */

--font-sans: 'Inter'
--font-mono: 'JetBrains Mono'

--radius-sm: 6px
--radius:    10px
--radius-lg: 14px
```

## Component patterns

**Buttons**: `.btn .btn-primary` / `.btn .btn-secondary` / `.btn .btn-ghost` + size `.btn-sm` / `.btn-lg`

**Cards**: `.card` — dark surface with border. `.card-accent` adds teal left-border highlight.

**Terminal block**: `.terminal > .terminal-head + .terminal-body` — use `.prompt`, `.comment`, `.ok`, `.out` spans inside body.

**Badges**: `.badge .badge-match` / `.badge-mismatch` / `.badge-pending` and use-case variants `.badge-use-*`

**Eyebrow**: `.eyebrow` with `.dot` inside — small teal-dot label above headings.

**Section heading**: `.section-heading` — centered heading block with eyebrow + h2 + lead paragraph.

**Feature grid**: `.feature-grid > .feature-card` — 2-col on mobile, 4-col on desktop.

**Stepper**: `.stepper > .step` — numbered vertical step list with connector lines.

**Page header**: `.page-head > .container > .eyebrow + .page-title + p`

**Spec layout**: `.grid.spec-layout` with `grid-template-columns: 240px 1fr` + `.spec-toc` aside sticky. Collapses to 1-col on mobile via `@media (max-width: 768px)`.

**Result section title**: `.result-section-title` — uppercase small tracking label inside cards.

## Rules when building new pages

1. Always link `<link rel="stylesheet" href="/css/style.css" />` — never copy styles inline.
2. Use existing tokens (CSS variables) — never hardcode hex colors.
3. Nav and footer markup should be copied exactly from any existing page.
4. Keep background gradient on `<body>` — it's set globally in style.css, no action needed.
5. Use `Inter` for body text, `JetBrains Mono` for code — both loaded via Google Fonts in style.css.
6. All asset paths are absolute from root: `/assets/logo.webp`, `/css/style.css`, `/js/main.js`.
